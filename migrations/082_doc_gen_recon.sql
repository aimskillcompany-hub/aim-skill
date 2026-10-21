-- 082: етап 1 об'єднання документів — звірка «картка (documents) ↔ згенерований документ / PDF (generated_docs)».
--  doc_gen_mismatches_json() — ЛИШЕ ЧИТАННЯ: розбіжності полів (дата, номер, сума, ПДВ, контрагент, тип, замовлення),
--    згенеровані без запису в реєстрі, записи реєстру з посиланням на неіснуючий згенерований, кілька записів на один.
--  doc_gen_resolve(doc, field, take) — рішення власника по ОДНОМУ полю: take = 'doc' (правильно в картці → у PDF)
--    або 'gen' (правильно в PDF → у картку). Лише адміністратор / бухгалтер, закриті місяці — відмова, журнал.
-- UPDATE лише з конкретним WHERE; DELETE і TRUNCATE немає.
begin;

create or replace function doc_gen_mismatches_json()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with pairs as (
    select d.id as document_id, g.id as generated_id, coalesce(d.doc_number, g.doc_number) as number, coalesce(d.type, g.doc_type) as type,
           coalesce(c1.name, c2.name, g.contractor_name) as contractor, d.company_id,
           d.doc_date as d_date, g.doc_date as g_date, d.doc_number as d_number, g.doc_number as g_number,
           d.amount as d_amount, g.total as g_amount, d.vat_amount as d_vat, g.vat_amount as g_vat,
           d.contractor_id as d_contractor, g.contractor_id as g_contractor, c1.name as d_contractor_name, coalesce(c2.name, g.contractor_name) as g_contractor_name,
           d.type as d_type, g.doc_type as g_type, d.order_id as d_order, g.order_id as g_order,
           o1.order_number as d_order_no, o2.order_number as g_order_no,
           period_is_closed(d.company_id, coalesce(d.doc_date, g.doc_date)) as closed
      from documents d
      join generated_docs g on g.id = d.generated_doc_id
      left join contractors c1 on c1.id = d.contractor_id
      left join contractors c2 on c2.id = g.contractor_id
      left join orders o1 on o1.id = d.order_id
      left join orders o2 on o2.id = g.order_id
  ), diffs as (
    select p.*, f.field, f.doc_value, f.gen_value
      from pairs p
      cross join lateral (values
        ('doc_date',    p.d_date::text,                 p.g_date::text,                 p.d_date is distinct from p.g_date),
        ('doc_number',  p.d_number,                     p.g_number,                     coalesce(p.d_number, '') is distinct from coalesce(p.g_number, '')),
        ('amount',      round(p.d_amount, 2)::text,      round(p.g_amount, 2)::text,      abs(coalesce(p.d_amount, 0) - coalesce(p.g_amount, 0)) > 0.009),
        ('vat_amount',  round(p.d_vat, 2)::text,         round(p.g_vat, 2)::text,         abs(coalesce(p.d_vat, 0) - coalesce(p.g_vat, 0)) > 0.009),
        ('contractor',  p.d_contractor_name,            p.g_contractor_name,            p.d_contractor is distinct from p.g_contractor),
        ('type',        p.d_type,                       p.g_type,                       p.d_type is distinct from p.g_type),
        ('order',       p.d_order_no,                   p.g_order_no,                   p.d_order is distinct from p.g_order)
      ) as f(field, doc_value, gen_value, differs)
     where f.differs
  )
  select jsonb_build_object(
    'pairs', (select count(*) from pairs),
    'diffs', coalesce((select jsonb_agg(jsonb_build_object(
               'document_id', x.document_id, 'generated_id', x.generated_id, 'number', x.number, 'type', x.type, 'contractor', x.contractor,
               'field', x.field, 'doc_value', x.doc_value, 'gen_value', x.gen_value, 'closed', x.closed) order by x.number, x.field) from diffs x), '[]'::jsonb),
    -- згенеровані без запису в реєстрі (не потрапляють у борги, склад, звіти)
    'orphans', coalesce((select jsonb_agg(jsonb_build_object('generated_id', g.id, 'number', g.doc_number, 'type', g.doc_type, 'date', g.doc_date,
               'amount', g.total, 'contractor', coalesce(c.name, g.contractor_name)) order by g.doc_date)
               from generated_docs g left join contractors c on c.id = g.contractor_id
              where not exists (select 1 from documents d where d.generated_doc_id = g.id)), '[]'::jsonb),
    -- посилання реєстру на неіснуючий згенерований документ
    'broken', coalesce((select jsonb_agg(jsonb_build_object('document_id', d.id, 'number', d.doc_number, 'type', d.type, 'date', d.doc_date, 'amount', d.amount))
               from documents d where d.generated_doc_id is not null and not exists (select 1 from generated_docs g where g.id = d.generated_doc_id)), '[]'::jsonb),
    -- кілька записів реєстру на один згенерований (подвійний борг / списання)
    'duplicates', coalesce((select jsonb_agg(jsonb_build_object('generated_id', t.gid, 'number', t.num, 'documents', t.ids))
               from (select d.generated_doc_id as gid, max(d.doc_number) as num, jsonb_agg(d.id) as ids
                       from documents d where d.generated_doc_id is not null group by d.generated_doc_id having count(*) > 1) t), '[]'::jsonb)
  )
$$;

-- рішення по одному полю: take = 'doc' → значення картки записується в згенерований; 'gen' → навпаки
create or replace function doc_gen_resolve(p_doc uuid, p_field text, p_take text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare d record; g record; v_before jsonb; v_after jsonb;
begin
  perform require_cost_editor();
  if p_take not in ('doc', 'gen') then raise exception 'take: doc або gen'; end if;
  select * into d from documents where id = p_doc;
  if not found or d.generated_doc_id is null then raise exception 'Документ не знайдено або він не згенерований'; end if;
  select * into g from generated_docs where id = d.generated_doc_id;
  if not found then raise exception 'Згенерований документ не знайдено'; end if;
  if period_is_closed(d.company_id, d.doc_date) or period_is_closed(d.company_id, g.doc_date) then
    raise exception 'PERIOD_CLOSED: документ у закритому місяці';
  end if;
  v_before := jsonb_build_object('doc', to_jsonb(d) - 'ocr_data', 'gen', to_jsonb(g) - 'items');

  if p_field = 'doc_date' then
    if p_take = 'doc' then update generated_docs set doc_date = d.doc_date where id = g.id;
    else update documents set doc_date = g.doc_date where id = d.id; end if;
  elsif p_field = 'doc_number' then
    if p_take = 'doc' then update generated_docs set doc_number = d.doc_number where id = g.id;
    else update documents set doc_number = g.doc_number where id = d.id; end if;
  elsif p_field = 'amount' then
    if p_take = 'doc' then update generated_docs set total = d.amount where id = g.id;
    else update documents set amount = g.total where id = d.id; end if;
  elsif p_field = 'vat_amount' then
    if p_take = 'doc' then update generated_docs set vat_amount = d.vat_amount where id = g.id;
    else update documents set vat_amount = g.vat_amount where id = d.id; end if;
  elsif p_field = 'contractor' then
    if p_take = 'doc' then update generated_docs set contractor_id = d.contractor_id where id = g.id;
    else update documents set contractor_id = g.contractor_id where id = d.id; end if;
  elsif p_field = 'type' then
    if p_take = 'doc' then update generated_docs set doc_type = d.type where id = g.id;
    else update documents set type = g.doc_type where id = d.id; end if;
  elsif p_field = 'order' then
    if p_take = 'doc' then update generated_docs set order_id = d.order_id where id = g.id;
    else update documents set order_id = g.order_id where id = d.id; end if;
  else
    raise exception 'Невідоме поле %', p_field;
  end if;

  select jsonb_build_object('doc', to_jsonb(x) - 'ocr_data') into v_after from documents x where x.id = d.id;
  insert into cost_action_log (action, document_id, line, before, after)
  values ('doc_gen_resolve', d.id, p_field || ' ← ' || case when p_take = 'doc' then 'картка' else 'PDF' end, v_before, v_after);
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['doc_gen_mismatches_json()', 'doc_gen_resolve(uuid, text, text)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

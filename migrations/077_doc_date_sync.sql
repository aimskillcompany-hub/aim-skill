-- 077: дата видаткової — та, що надрукована в документі (2026-10-20).
-- Проблема: рух складу (OUT) отримує дату в момент створення документа; якщо дату видаткової потім змінили
-- (напр. ВН-0030: створено 10.09 разом із рахунком, дата документа 25.09), рух лишався з 10.09 — звірка і FIFO
-- вважали відвантаження 10.09. Так само дзеркало в documents могло розійтися з generated_docs.
-- Тепер:
--   doc_print_date(doc)        — generated_docs.doc_date → documents.doc_date → дата створення (Київ);
--   тригер generated_docs      — зміна дати → documents.doc_date (дзеркало);
--   тригер documents           — зміна doc_date → дата його рухів ВИДАЧІ (і приходу, якщо немає warehouse_date);
--                                розподіл по партіях при цьому не перезапускається (собівартість не змінюється);
--   doc_date_mismatches_json() — перегляд розбіжностей (лише читання);
--   sync_doc_dates()           — вирівняти (адміністратор / бухгалтер; закриті місяці — пропускаються; журнал).
-- Усі UPDATE — з конкретним WHERE; DELETE і TRUNCATE немає.
begin;

create or replace function doc_print_date(p_doc uuid)
returns date
language sql stable security invoker set search_path = public as $$
  select coalesce(g.doc_date, d.doc_date, (d.created_at at time zone 'Europe/Kyiv')::date)
    from documents d left join generated_docs g on g.id = d.generated_doc_id
   where d.id = p_doc
$$;

-- дзеркало: дата генерованого документа → documents.doc_date
create or replace function trg_gendoc_date_sync() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.doc_date is not null and new.doc_date is distinct from old.doc_date then
    update documents set doc_date = new.doc_date where generated_doc_id = new.id and doc_date is distinct from new.doc_date;
  end if;
  return null;
end $$;
drop trigger if exists trg_gendoc_date_sync on generated_docs;
create trigger trg_gendoc_date_sync after update of doc_date on generated_docs
  for each row execute function trg_gendoc_date_sync();

-- дата документа → дата його складських рухів (видача; прихід — лише якщо дату оприбуткування не задано)
create or replace function trg_doc_date_moves() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_prev text;
begin
  if new.doc_date is null or new.doc_date is not distinct from old.doc_date then return null; end if;
  v_prev := coalesce(current_setting('aim.skip_alloc', true), '');
  perform set_config('aim.skip_alloc', 'on', true);   -- собівартість не перераховуємо (лише «Застосувати FIFO» / перерахунок)
  update stock_movements set date = new.doc_date
   where document_id = new.id and type = 'out' and source is distinct from 'assembly' and date is distinct from new.doc_date;
  if new.warehouse_date is null then
    update stock_movements set date = new.doc_date
     where document_id = new.id and type = 'in' and source is distinct from 'assembly' and date = old.doc_date;
  end if;
  perform set_config('aim.skip_alloc', v_prev, true);
  return null;
end $$;
drop trigger if exists trg_doc_date_moves on documents;
create trigger trg_doc_date_moves after update of doc_date on documents
  for each row execute function trg_doc_date_moves();

-- розбіжності (лише читання): дзеркало ≠ генерований документ; дата руху видачі ≠ дата видаткової
create or replace function doc_date_mismatches_json()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with mirror as (
    select d.id as document_id, d.doc_number, d.type, d.doc_date as old_date, g.doc_date as new_date,
           period_is_closed(d.company_id, d.doc_date) or period_is_closed(d.company_id, g.doc_date) as closed
      from documents d join generated_docs g on g.id = d.generated_doc_id
     where g.doc_date is not null and d.doc_date is distinct from g.doc_date
  ), outs as (
    select m.document_id, d.doc_number, d.type, min(m.date) as old_date, doc_print_date(d.id) as new_date, count(*) as movements,
           bool_or(period_is_closed(m.company_id, m.date) or period_is_closed(m.company_id, doc_print_date(d.id))) as closed
      from stock_movements m join documents d on d.id = m.document_id
     where m.type = 'out' and m.source is distinct from 'assembly' and m.date is distinct from doc_print_date(d.id)
     group by m.document_id, d.id, d.doc_number, d.type
  )
  select jsonb_build_object(
    'mirror', coalesce((select jsonb_agg(to_jsonb(x) order by x.new_date) from mirror x), '[]'::jsonb),
    'outs', coalesce((select jsonb_agg(to_jsonb(x) order by x.new_date) from outs x), '[]'::jsonb))
$$;

-- вирівняти: 1) дзеркало = дата генерованого документа (тригер переносить і рухи), 2) рухи видачі = дата видаткової
create or replace function sync_doc_dates()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_before jsonb; v_mirror integer := 0; v_outs integer := 0; v_skipped integer := 0; v_prev text;
begin
  perform require_cost_editor();
  v_before := doc_date_mismatches_json();
  update documents d set doc_date = g.doc_date
    from generated_docs g
   where g.id = d.generated_doc_id and g.doc_date is not null and d.doc_date is distinct from g.doc_date
     and not period_is_closed(d.company_id, d.doc_date) and not period_is_closed(d.company_id, g.doc_date)
     and not exists (select 1 from stock_movements x where x.document_id = d.id and period_is_closed(x.company_id, x.date));
  get diagnostics v_mirror = row_count;

  v_prev := coalesce(current_setting('aim.skip_alloc', true), '');
  perform set_config('aim.skip_alloc', 'on', true);
  update stock_movements m set date = doc_print_date(m.document_id)
   where m.type = 'out' and m.document_id is not null and m.source is distinct from 'assembly'
     and m.date is distinct from doc_print_date(m.document_id)
     and not period_is_closed(m.company_id, m.date) and not period_is_closed(m.company_id, doc_print_date(m.document_id));
  get diagnostics v_outs = row_count;
  perform set_config('aim.skip_alloc', v_prev, true);

  select coalesce(jsonb_array_length(x -> 'mirror'), 0) + coalesce(jsonb_array_length(x -> 'outs'), 0) into v_skipped
    from (select doc_date_mismatches_json() as x) t;
  insert into cost_action_log (action, document_id, line, before, after)
  values ('doc_dates_sync', null, null, v_before,
          jsonb_build_object('mirror_fixed', v_mirror, 'out_movements_fixed', v_outs, 'left_closed', v_skipped));
  return jsonb_build_object('mirror_fixed', v_mirror, 'out_movements_fixed', v_outs, 'left_closed', v_skipped);
end $$;

do $$
declare f text;
begin
  foreach f in array array['doc_print_date(uuid)', 'doc_date_mismatches_json()', 'sync_doc_dates()'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

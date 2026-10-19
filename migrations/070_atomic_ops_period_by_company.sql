-- 070: захист від втрати даних (аудит 2026-10-19, група «втрата даних»).
-- 1) Закриття періоду — окремо по кожній юрособі (раніше закриття березня для ФОП перезаписувало
--    знімок ЕЙМ СКІЛ і блокувало березень в усіх юрособах).
-- 2) Атомарні операції (одна транзакція — або все, або нічого):
--    replace_order_items — збереження позицій замовлення (раніше: видалили всі → вставка впала → позиції зникли);
--    delete_generated_doc — видалення згенерованого документа разом із дзеркалом і рухами складу.
-- Безпечно запускати повторно.
begin;

-- ── 1. period_closings: унікальність по юрособі ──
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.period_closings'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(period_year, period_month)%'
  loop
    execute format('alter table public.period_closings drop constraint %I', c);
  end loop;
end $$;
create unique index if not exists period_closings_company_period_key
  on period_closings (company_id, period_year, period_month);

-- Блокування закритого місяця — лише для тієї ж юрособи. UPDATE перевіряє і стару, і нову дату
-- (раніше можна було «витягнути» запис із закритого місяця, змінивши дату).
create or replace function period_is_closed(p_company uuid, d date) returns boolean
language sql stable set search_path = public as $$
  select d is not null and exists (
    select 1 from period_closings pc
    where pc.status = 'closed'
      and pc.company_id = coalesce(p_company, '00000000-0000-0000-0000-000000000001'::uuid)
      and pc.period_year = extract(year from d)::int
      and pc.period_month = extract(month from d)::int
  )
$$;

create or replace function guard_period_by_date() returns trigger as $$
declare d date;
begin
  if tg_op in ('UPDATE', 'DELETE') and period_is_closed(old.company_id, old.date) then d := old.date;
  elsif tg_op in ('INSERT', 'UPDATE') and period_is_closed(new.company_id, new.date) then d := new.date;
  end if;
  if d is not null then
    raise exception 'PERIOD_CLOSED: період %/% закрито. Переоткрийте його в розділі «Закриття періоду», щоб змінювати дані.',
      lpad(extract(month from d)::text, 2, '0'), extract(year from d)::int;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$ language plpgsql set search_path = public;

create or replace function guard_period_by_docdate() returns trigger as $$
declare d date;
begin
  if tg_op in ('UPDATE', 'DELETE') and period_is_closed(old.company_id, old.doc_date) then d := old.doc_date;
  elsif tg_op in ('INSERT', 'UPDATE') and period_is_closed(new.company_id, new.doc_date) then d := new.doc_date;
  end if;
  if d is not null then
    raise exception 'PERIOD_CLOSED: період %/% закрито. Переоткрийте його в розділі «Закриття періоду», щоб змінювати дані.',
      lpad(extract(month from d)::text, 2, '0'), extract(year from d)::int;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$ language plpgsql set search_path = public;

-- ── 2. Атомарна заміна позицій замовлення ──
-- p_items — масив об'єктів з полями order_items; вставляються лише колонки, що реально існують
-- (невідомі ключі ігноруються → працює незалежно від того, які міграції застосовані).
-- Порядок позицій зберігається через created_at (+1 мс на рядок).
create or replace function replace_order_items(p_order_id uuid, p_items jsonb, p_total numeric default null)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  cols text;
  rows jsonb;
  n integer := 0;
begin
  if p_order_id is null then raise exception 'order_id is null'; end if;
  select coalesce(jsonb_agg(
           (e - 'id' - 'order_id' - 'created_at')
           || jsonb_build_object('order_id', p_order_id,
                                 'created_at', clock_timestamp() + (o * interval '1 millisecond'))
           order by o), '[]'::jsonb)
    into rows
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, o);

  delete from order_items where order_id = p_order_id;

  if jsonb_array_length(rows) > 0 then
    select string_agg(quote_ident(k), ', ')
      into cols
      from (select distinct jsonb_object_keys(r) as k from jsonb_array_elements(rows) r) keys
     where k in (select column_name from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_items');
    execute format('insert into order_items (%s) select %s from jsonb_populate_recordset(null::order_items, $1)', cols, cols)
      using rows;
    get diagnostics n = row_count;
  end if;

  if p_total is not null then
    update orders set total = round(p_total, 2) where id = p_order_id;
  end if;
  return n;
end $$;
grant execute on function replace_order_items(uuid, jsonb, numeric) to authenticated;

-- ── 3. Атомарне видалення згенерованого документа ──
-- Рухи складу дзеркального документа (крім збірок) → дзеркало в documents (з прив'язками оплат — каскад)
-- → сам generated_docs. Якщо будь-що заборонено (закритий період, RLS) — не видаляється нічого.
create or replace function delete_generated_doc(p_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare mirror_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into mirror_ids from documents where generated_doc_id = p_id;
  if array_length(mirror_ids, 1) > 0 then
    delete from stock_movements where document_id = any(mirror_ids) and coalesce(source, '') <> 'assembly';
    delete from documents where id = any(mirror_ids);
  end if;
  delete from generated_docs where id = p_id;
  if not found then raise exception 'Документ не знайдено або немає прав на видалення'; end if;
end $$;
grant execute on function delete_generated_doc(uuid) to authenticated;

-- ── 4. Атомарне видалення збірки (реверс складу + записи збірки) ──
-- Рухи з assembly_id видаляються; для старих збірок без прив'язаних рухів — компенсуючі рухи
-- (компоненти повертаються, виріб знімається). Усе однією транзакцією: при помилці (закритий період)
-- не змінюється нічого, тож повторне видалення не «повертає» компоненти двічі.
create or replace function delete_assembly(p_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  a record;
  n integer;
  today date := (now() at time zone 'Europe/Kyiv')::date;
begin
  select * into a from assemblies where id = p_id;
  if not found then raise exception 'Збірку не знайдено або немає прав'; end if;

  delete from stock_movements where assembly_id = p_id;
  get diagnostics n = row_count;
  if n = 0 then
    insert into stock_movements (company_id, product_id, type, quantity, price, cost_price, total, date, source, description)
    select a.company_id, it.product_id, 'in', it.quantity, it.cost_price, it.cost_price, it.total, today, 'assembly',
           left('Скасування збірки: ' || coalesce(a.name, '') || ' — повернення компонента', 200)
      from assembly_items it where it.assembly_id = p_id;
    if a.result_product_id is not null then
      insert into stock_movements (company_id, product_id, type, quantity, price, cost_price, total, date, source, description)
      values (a.company_id, a.result_product_id, 'out', a.quantity,
              case when coalesce(a.quantity, 0) <> 0 then a.total_cost / a.quantity else a.total_cost end,
              case when coalesce(a.quantity, 0) <> 0 then a.total_cost / a.quantity else a.total_cost end,
              a.total_cost, today, 'assembly', left('Скасування збірки: ' || coalesce(a.name, '') || ' — зняття виробу', 200));
    end if;
  end if;

  delete from assembly_items where assembly_id = p_id;
  delete from assemblies where id = p_id;
end $$;
grant execute on function delete_assembly(uuid) to authenticated;

commit;

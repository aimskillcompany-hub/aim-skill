-- 073: безпечний FIFO (заміна fifo_rebuild з 071/072).
-- Проблема: fifo_rebuild робив `delete from stock_allocations;` (без WHERE — Supabase блокує через pg_safeupdate)
-- і в «сухому прогоні» ПИСАВ у постійні таблиці (списання, cost_price), відкочуючи все навмисною помилкою.
-- Тепер:
--   fifo_compute(from)      — розрахунок лише в TEMP-таблицях (ON COMMIT DROP); постійні таблиці не змінює;
--   fifo_dry_run_json(from) — сухий прогін через fifo_compute;
--   fifo_apply(from, label) — 1) резервна копія (собівартість рухів, списання, ціни довідника), 2) розрахунок,
--                             3) заміна списань і собівартості — кожен DELETE/UPDATE з явним WHERE;
--   cost_backup_restore(id) — відновлення з копії.
-- Логіка розподілу та сама: прихідна того ж замовлення → FIFO на дату → «без собівартості»; ціна партії — batch_unit_cost.
begin;

drop function if exists fifo_dry_run_json(date);
drop function if exists fifo_rebuild(date, boolean);

-- ── Резервні копії ──
create table if not exists cost_backups (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  created_by uuid default auth.uid(),
  label text,
  cost_from date,
  movements integer, allocations integer, prices integer
);
create table if not exists cost_backup_movements (
  backup_id uuid not null references cost_backups(id) on delete cascade,
  movement_id uuid not null, cost_price numeric, cost_missing_qty numeric, cost_stale boolean
);
create table if not exists cost_backup_allocations (
  backup_id uuid not null references cost_backups(id) on delete cascade,
  out_movement_id uuid, in_movement_id uuid, qty numeric, unit_cost numeric, out_date date, company_id uuid, basis text
);
create table if not exists cost_backup_prices (
  backup_id uuid not null references cost_backups(id) on delete cascade,
  product_id uuid not null, buy_price numeric
);
create index if not exists idx_cost_backup_mov on cost_backup_movements (backup_id);
create index if not exists idx_cost_backup_alloc on cost_backup_allocations (backup_id);
create index if not exists idx_cost_backup_price on cost_backup_prices (backup_id);
do $$
declare t text;
begin
  foreach t in array array['cost_backups', 'cost_backup_movements', 'cost_backup_allocations', 'cost_backup_prices'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_auth_all', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_auth_all', t);
  end loop;
end $$;

-- ── Розрахунок FIFO лише в тимчасових таблицях ──
create or replace function fifo_compute(p_cost_from date)
returns table (out_id uuid, out_date date, company_id uuid, order_id uuid, document_id uuid, product_id uuid,
               qty numeric, old_unit numeric, new_unit numeric, missing_qty numeric, skipped_closed boolean, bases text)
language plpgsql volatile security invoker set search_path = public as $$
#variable_conflict use_column
declare
  o record;
  b record;
  v_need numeric;
  v_take numeric;
  v_cost numeric;
  v_nocost numeric;
  v_bases text[];
begin
  -- тимчасові таблиці живуть до кінця транзакції (ON COMMIT DROP); при повторному виклику в тій самій транзакції
  -- лише очищаються (DELETE з WHERE). Постійні таблиці лише читаються.
  if to_regclass('pg_temp._fifo_batches') is null then
    create temp table _fifo_batches (in_id uuid, p_id uuid, c_id uuid, order_key uuid, b_date date, b_created timestamptz,
                                     remaining numeric, unit numeric, basis text) on commit drop;
    create index on _fifo_batches (p_id, c_id);
  else
    delete from _fifo_batches where true;   -- тимчасова таблиця цієї транзакції
  end if;
  if to_regclass('pg_temp._fifo_alloc') is null then
    create temp table _fifo_alloc (a_out uuid, a_in uuid, a_qty numeric, a_unit numeric, a_basis text, a_date date, a_company uuid) on commit drop;
  else
    delete from _fifo_alloc where true;
  end if;
  insert into _fifo_batches (in_id, p_id, c_id, order_key, b_date, b_created, remaining, unit, basis)
    select m.id, m.product_id, m.company_id, coalesce(m.order_id, d.order_id),
           m.date, m.created_at, coalesce(m.quantity, 0)::numeric, bu.unit, bu.basis
      from stock_movements m
      left join documents d on d.id = m.document_id
      cross join lateral batch_unit_cost(m.id) bu
     where m.type = 'in';

  for o in
    select m.id as m_id, m.date as m_date, m.company_id as m_company, m.cost_price as m_cost, coalesce(m.quantity, 0) as m_qty,
           m.product_id as m_product, m.document_id as m_doc, coalesce(m.order_id, d.order_id) as m_order,
           coalesce(p.product_type, 'goods') as m_ptype
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join products p on p.id = m.product_id
     where m.type = 'out'
     order by m.date, m.created_at, m.id
  loop
    v_need := o.m_qty; v_cost := 0; v_nocost := 0; v_bases := '{}';
    if o.m_ptype = 'service' then
      v_need := 0;
    else
      for b in
        select fb.in_id, fb.unit, fb.basis, fb.remaining
          from _fifo_batches fb
         where fb.p_id = o.m_product and fb.c_id = o.m_company and fb.remaining > 0.00001
           and ((o.m_order is not null and fb.order_key = o.m_order) or fb.b_date <= o.m_date)
         order by case when o.m_order is not null and fb.order_key = o.m_order then 0 else 1 end,
                  fb.b_date, fb.b_created, fb.in_id
      loop
        exit when v_need <= 0.00001;
        v_take := least(b.remaining, v_need);
        update _fifo_batches set remaining = remaining - v_take where in_id = b.in_id;
        insert into _fifo_alloc values (o.m_id, b.in_id, v_take, b.unit, b.basis, o.m_date, o.m_company);
        if b.unit > 0 then v_cost := v_cost + v_take * b.unit; else v_nocost := v_nocost + v_take; end if;
        v_need := v_need - v_take;
        if b.basis is not null and not (b.basis = any (v_bases)) then v_bases := v_bases || b.basis; end if;
      end loop;
    end if;

    if o.m_date >= p_cost_from then
      out_id := o.m_id; out_date := o.m_date; company_id := o.m_company; order_id := o.m_order;
      document_id := o.m_doc; product_id := o.m_product; qty := o.m_qty; old_unit := o.m_cost;
      new_unit := case when o.m_qty > 0 then round(v_cost / o.m_qty, 4) else 0 end;
      missing_qty := round(greatest(v_need, 0) + v_nocost, 4);
      skipped_closed := period_is_closed(o.m_company, o.m_date);
      bases := array_to_string(v_bases, '; ');
      return next;
    end if;
  end loop;
end $$;
grant execute on function fifo_compute(date) to authenticated;

-- ── Сухий прогін (одним jsonb, без обмеження API у 1000 рядків) — нічого не пише в постійні таблиці ──
create or replace function fifo_dry_run_json(p_cost_from date)
returns jsonb
language sql volatile security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from fifo_compute(p_cost_from) r
$$;
grant execute on function fifo_dry_run_json(date) to authenticated;

-- ── Резервна копія: собівартість усіх відвантажень, усі списання з партій, ціни довідника ──
create or replace function cost_backup_create(p_label text default null, p_cost_from date default null)
returns uuid
language plpgsql volatile security invoker set search_path = public as $$
declare v_id uuid; v_m integer; v_a integer; v_p integer;
begin
  insert into cost_backups (label, cost_from) values (coalesce(p_label, 'резервна копія собівартості'), p_cost_from) returning id into v_id;
  insert into cost_backup_movements (backup_id, movement_id, cost_price, cost_missing_qty, cost_stale)
    select v_id, m.id, m.cost_price, m.cost_missing_qty, m.cost_stale from stock_movements m where m.type = 'out';
  get diagnostics v_m = row_count;
  insert into cost_backup_allocations (backup_id, out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis)
    select v_id, a.out_movement_id, a.in_movement_id, a.qty, a.unit_cost, a.out_date, a.company_id, a.basis from stock_allocations a where a.qty is not null;
  get diagnostics v_a = row_count;
  insert into cost_backup_prices (backup_id, product_id, buy_price)
    select v_id, p.id, p.buy_price from products p where p.buy_price is not null;
  get diagnostics v_p = row_count;
  update cost_backups set movements = v_m, allocations = v_a, prices = v_p where id = v_id;
  return v_id;
end $$;
grant execute on function cost_backup_create(text, date) to authenticated;

-- ── Застосування FIFO: копія → розрахунок → заміна (усі DELETE/UPDATE з WHERE) ──
create or replace function fifo_apply(p_cost_from date, p_label text default null)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_backup uuid; v_del integer; v_ins integer; v_upd integer; v_prices integer;
begin
  v_backup := cost_backup_create(coalesce(p_label, 'перед FIFO з ' || p_cost_from), p_cost_from);

  -- розрахунок (заповнює також _fifo_alloc); результат — у тимчасовій таблиці транзакції
  create temp table _fifo_res on commit drop as select * from fifo_compute(p_cost_from);

  -- списання з партій: прибираємо лише ті, що належать відвантаженням, і записуємо розраховані
  delete from stock_allocations a
   where a.out_movement_id in (select m.id from stock_movements m where m.type = 'out');
  get diagnostics v_del = row_count;
  insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis)
    select a_out, a_in, a_qty, a_unit, a_date, a_company, a_basis from _fifo_alloc where a_qty > 0;
  get diagnostics v_ins = row_count;

  -- собівартість — лише відвантаження з дати p_cost_from у відкритих місяцях
  update stock_movements m
     set cost_price = r.new_unit, cost_missing_qty = r.missing_qty, cost_stale = false
    from _fifo_res r
   where m.id = r.out_id and r.skipped_closed = false;
  get diagnostics v_upd = row_count;

  -- ціна в довіднику = остання закупівельна (з урахуванням бази ПДВ)
  update products p set buy_price = x.unit
    from (
      select distinct on (m.product_id) m.product_id, bu.unit
        from stock_movements m cross join lateral batch_unit_cost(m.id) bu
       where m.type = 'in' and bu.unit > 0
       order by m.product_id, m.date desc, m.created_at desc
    ) x
   where p.id = x.product_id and p.buy_price is distinct from x.unit;
  get diagnostics v_prices = row_count;

  return jsonb_build_object('backup_id', v_backup, 'allocations_removed', v_del, 'allocations_written', v_ins,
                            'costs_updated', v_upd, 'prices_updated', v_prices);
end $$;
grant execute on function fifo_apply(date, text) to authenticated;

-- ── Відновлення з резервної копії ──
create or replace function cost_backup_restore(p_backup uuid)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_upd integer; v_del integer; v_ins integer; v_prices integer;
begin
  if not exists (select 1 from cost_backups where id = p_backup) then
    raise exception 'Резервну копію % не знайдено', p_backup;
  end if;
  update stock_movements m
     set cost_price = r.cost_price, cost_missing_qty = r.cost_missing_qty, cost_stale = r.cost_stale
    from cost_backup_movements r
   where r.backup_id = p_backup and m.id = r.movement_id and not period_is_closed(m.company_id, m.date);
  get diagnostics v_upd = row_count;
  delete from stock_allocations a
   where a.out_movement_id in (select m.id from stock_movements m where m.type = 'out');
  get diagnostics v_del = row_count;
  insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis)
    select b.out_movement_id, b.in_movement_id, b.qty, b.unit_cost, b.out_date, b.company_id, b.basis
      from cost_backup_allocations b
     where b.backup_id = p_backup
       and exists (select 1 from stock_movements x where x.id = b.out_movement_id)
       and exists (select 1 from stock_movements y where y.id = b.in_movement_id);
  get diagnostics v_ins = row_count;
  update products p set buy_price = x.buy_price
    from cost_backup_prices x
   where x.backup_id = p_backup and p.id = x.product_id;
  get diagnostics v_prices = row_count;
  return jsonb_build_object('costs_restored', v_upd, 'allocations_removed', v_del, 'allocations_restored', v_ins, 'prices_restored', v_prices);
end $$;
grant execute on function cost_backup_restore(uuid) to authenticated;

commit;

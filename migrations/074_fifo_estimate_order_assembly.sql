-- 074: уточнення FIFO перед застосуванням (рішення власника 2026-10-19).
--  1) Відвантаження, якому не вистачило партій, НЕ отримує 0: на нестачу береться поточна собівартість (оцінка,
--     передається з діагностики — та сама, що зараз у звіті) і позначається ⚠ (cost_estimated_qty / cost_estimate_unit).
--     «Без собівартості» (cost_missing_qty) — лише якщо й оцінки немає.
--  2) Ідентифікована собівартість: прихідна ТОГО Ж замовлення береться навіть якщо датована пізніше відвантаження;
--     зв'язок із замовленням — рух.order_id, документ.order_id або субзамовлення (supplier_orders.order_id).
--     Інші відвантаження беруть спершу партії без замовлення, партії чужих замовлень — лише в останню чергу.
--  3) Збірки нейтральні: виріб оприбутковується за перерахованою собівартістю списаних компонентів.
-- Сухий прогін, як і в 073, пише лише в TEMP-таблиці. Усі DELETE/UPDATE — з конкретним WHERE, без TRUNCATE.
begin;

alter table stock_movements add column if not exists cost_estimated_qty numeric default 0;  -- к-сть, оцінена без партії (⚠)
alter table stock_movements add column if not exists cost_estimate_unit numeric;            -- ціна оцінки (поточна собівартість)
alter table cost_backup_movements add column if not exists cost_estimated_qty numeric;
alter table cost_backup_movements add column if not exists cost_estimate_unit numeric;
alter table cost_backup_movements add column if not exists type text;

-- замовлення руху: рух → документ → субзамовлення
create or replace function stock_order_of(p_mov uuid)
returns uuid
language sql stable security invoker set search_path = public as $$
  select coalesce(m.order_id, d.order_id, so.order_id)
    from stock_movements m
    left join documents d on d.id = m.document_id
    left join supplier_orders so on so.id = m.supplier_order_id
   where m.id = p_mov
$$;
grant execute on function stock_order_of(uuid) to authenticated;

-- розподіл одного відвантаження (тригер і «Перерахувати за період»)
create or replace function allocate_out(p_out uuid, p_update_cost boolean default true)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  o record;
  b record;
  v_order uuid;
  v_need numeric;
  v_take numeric;
  v_cost numeric := 0;
  v_nocost numeric := 0;
  v_est numeric := 0;
  v_ptype text;
begin
  select m.* into o from stock_movements m where m.id = p_out;
  if not found then return; end if;
  delete from stock_allocations where out_movement_id = p_out;
  if o.type <> 'out' then return; end if;

  select product_type into v_ptype from products where id = o.product_id;
  if coalesce(v_ptype, 'goods') = 'service' then
    if p_update_cost then update stock_movements set cost_price = 0, cost_missing_qty = 0, cost_estimated_qty = 0, cost_stale = false where id = p_out; end if;
    return;
  end if;

  v_order := stock_order_of(p_out);
  v_need := coalesce(o.quantity, 0);
  for b in
    select m.id, bu.unit, bu.basis, x.ord,
           m.quantity - coalesce((select sum(a.qty) from stock_allocations a where a.in_movement_id = m.id), 0) as remaining
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join supplier_orders so on so.id = m.supplier_order_id
      cross join lateral (select coalesce(m.order_id, d.order_id, so.order_id) as ord) x
      cross join lateral batch_unit_cost(m.id) bu
     where m.type = 'in' and m.product_id = o.product_id and m.company_id = o.company_id
       and ((v_order is not null and x.ord = v_order) or m.date <= o.date)
     order by case when v_order is not null and x.ord = v_order then 0 when x.ord is null then 1 else 2 end,
              m.date, m.created_at, m.id
     for update of m
  loop
    exit when v_need <= 0.00001;
    continue when b.remaining <= 0.00001;
    v_take := least(b.remaining, v_need);
    insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis)
    values (p_out, b.id, v_take, b.unit, o.date, o.company_id, b.basis);
    if b.unit > 0 then v_cost := v_cost + v_take * b.unit; else v_nocost := v_nocost + v_take; end if;
    v_need := v_need - v_take;
  end loop;

  -- нестача: якщо в русі є оцінка (поточна собівартість з перебудови) — нею, з позначкою ⚠; інакше «без собівартості»
  v_need := greatest(v_need, 0) + v_nocost;
  if v_need > 0.00001 and coalesce(o.cost_estimate_unit, 0) > 0 then
    v_est := v_need; v_cost := v_cost + v_need * o.cost_estimate_unit; v_need := 0;
  end if;

  if p_update_cost then
    update stock_movements
       set cost_price = case when o.quantity > 0 then round(v_cost / o.quantity, 4) else 0 end,
           cost_missing_qty = round(v_need, 4),
           cost_estimated_qty = round(v_est, 4),
           cost_stale = false
     where id = p_out;
  end if;
end $$;
grant execute on function allocate_out(uuid, boolean) to authenticated;

-- ── Розрахунок FIFO лише в тимчасових таблицях ──
-- p_estimates: {"<out_id>": поточна собівартість одиниці} — оцінка для нестачі (з діагностики, як у звіті);
-- якщо для руху її немає — збережена оцінка руху або його попередня собівартість (якщо партій не було).
drop function if exists fifo_dry_run_json(date);
drop function if exists fifo_apply(date, text);
drop function if exists fifo_compute(date);
create or replace function fifo_compute(p_cost_from date, p_estimates jsonb default '{}'::jsonb)
returns table (out_id uuid, out_date date, company_id uuid, order_id uuid, document_id uuid, product_id uuid,
               qty numeric, old_unit numeric, new_unit numeric, missing_qty numeric, est_qty numeric, est_unit numeric,
               skipped_closed boolean, bases text, source text, assembly_id uuid)
language plpgsql volatile security invoker set search_path = public as $$
#variable_conflict use_column
declare
  o record;
  b record;
  v_need numeric;
  v_take numeric;
  v_cost numeric;
  v_nocost numeric;
  v_est numeric;
  v_eunit numeric;
  v_bases text[];
begin
  -- тимчасові таблиці живуть до кінця транзакції (ON COMMIT DROP); при повторному виклику в тій самій транзакції
  -- лише очищаються. Постійні таблиці лише читаються.
  if to_regclass('pg_temp._fifo_batches') is null then
    create temp table _fifo_batches (in_id uuid, p_id uuid, c_id uuid, order_key uuid, b_date date, b_created timestamptz,
                                     b_qty numeric, remaining numeric, unit numeric, basis text, asm_id uuid) on commit drop;
    create index on _fifo_batches (p_id, c_id);
  else
    delete from _fifo_batches where true;   -- тимчасова таблиця цієї транзакції
  end if;
  if to_regclass('pg_temp._fifo_alloc') is null then
    create temp table _fifo_alloc (a_out uuid, a_in uuid, a_qty numeric, a_unit numeric, a_basis text, a_date date, a_company uuid) on commit drop;
  else
    delete from _fifo_alloc where true;
  end if;
  if to_regclass('pg_temp._fifo_asm') is null then
    create temp table _fifo_asm (asm_id uuid primary key, cost numeric) on commit drop;   -- собівартість компонентів збірки
  else
    delete from _fifo_asm where true;
  end if;

  insert into _fifo_batches (in_id, p_id, c_id, order_key, b_date, b_created, b_qty, remaining, unit, basis, asm_id)
    select m.id, m.product_id, m.company_id, coalesce(m.order_id, d.order_id, so.order_id),
           m.date, m.created_at, coalesce(m.quantity, 0)::numeric, coalesce(m.quantity, 0)::numeric, bu.unit, bu.basis,
           case when m.source = 'assembly' and m.assembly_id is not null
                 and exists (select 1 from stock_movements c where c.assembly_id = m.assembly_id and c.type = 'out')
                then m.assembly_id end
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join supplier_orders so on so.id = m.supplier_order_id
      cross join lateral batch_unit_cost(m.id) bu
     where m.type = 'in';
  -- виріб збірки: ціна = Σ собівартості компонентів (рахується нижче, коли компоненти списуються)
  insert into _fifo_asm (asm_id, cost) select distinct fb.asm_id, 0 from _fifo_batches fb where fb.asm_id is not null;

  for o in
    select m.id as m_id, m.date as m_date, m.company_id as m_company, m.cost_price as m_cost, coalesce(m.quantity, 0) as m_qty,
           m.product_id as m_product, m.document_id as m_doc, coalesce(m.order_id, d.order_id, so.order_id) as m_order,
           coalesce(p.product_type, 'goods') as m_ptype, m.source as m_source, m.assembly_id as m_asm,
           m.cost_estimate_unit as m_eunit,
           exists (select 1 from stock_allocations a where a.out_movement_id = m.id) as m_had_alloc
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join supplier_orders so on so.id = m.supplier_order_id
      left join products p on p.id = m.product_id
     where m.type = 'out'
     order by m.date, m.created_at, m.id
  loop
    v_need := o.m_qty; v_cost := 0; v_nocost := 0; v_est := 0; v_bases := '{}';
    if o.m_ptype = 'service' then
      v_need := 0;
    else
      for b in
        select fb.in_id, fb.unit, fb.basis, fb.remaining
          from _fifo_batches fb
         where fb.p_id = o.m_product and fb.c_id = o.m_company and fb.remaining > 0.00001
           and ((o.m_order is not null and fb.order_key = o.m_order) or fb.b_date <= o.m_date)
         order by case when o.m_order is not null and fb.order_key = o.m_order then 0 when fb.order_key is null then 1 else 2 end,
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

    -- нестача → оцінка поточною собівартістю (⚠), якщо вона є
    v_need := greatest(v_need, 0) + v_nocost;
    v_eunit := coalesce(
      nullif((p_estimates ->> o.m_id::text)::numeric, 0),
      nullif(o.m_eunit, 0),
      case when not o.m_had_alloc then nullif(o.m_cost, 0) end);
    if v_need > 0.00001 and coalesce(v_eunit, 0) > 0 then
      v_est := v_need; v_cost := v_cost + v_need * v_eunit; v_need := 0;
      if not ('⚠ оцінка — поточна собівартість' = any (v_bases)) then v_bases := v_bases || '⚠ оцінка — поточна собівартість'::text; end if;
    end if;

    -- компонент збірки → собівартість виробу
    if o.m_asm is not null and o.m_source = 'assembly' and exists (select 1 from _fifo_asm x where x.asm_id = o.m_asm) then
      update _fifo_asm set cost = cost + v_cost where asm_id = o.m_asm;
      update _fifo_batches fb
         set unit = round((select x.cost from _fifo_asm x where x.asm_id = o.m_asm) / nullif(fb.b_qty, 0), 4),
             basis = 'збірка — собівартість компонентів'
       where fb.asm_id = o.m_asm;
    end if;

    if o.m_date >= p_cost_from then
      out_id := o.m_id; out_date := o.m_date; company_id := o.m_company; order_id := o.m_order;
      document_id := o.m_doc; product_id := o.m_product; qty := o.m_qty; old_unit := o.m_cost;
      new_unit := case when o.m_qty > 0 then round(v_cost / o.m_qty, 4) else 0 end;
      missing_qty := round(v_need, 4);
      est_qty := round(v_est, 4);
      est_unit := case when v_est > 0 then v_eunit end;
      skipped_closed := period_is_closed(o.m_company, o.m_date);
      bases := array_to_string(v_bases, '; ');
      source := o.m_source; assembly_id := o.m_asm;
      return next;
    end if;
  end loop;
end $$;
grant execute on function fifo_compute(date, jsonb) to authenticated;

-- ── Сухий прогін (одним jsonb) — нічого не пише в постійні таблиці ──
create or replace function fifo_dry_run_json(p_cost_from date, p_estimates jsonb default '{}'::jsonb)
returns jsonb
language sql volatile security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from fifo_compute(p_cost_from, p_estimates) r
$$;
grant execute on function fifo_dry_run_json(date, jsonb) to authenticated;

-- ── Резервна копія: собівартість усіх рухів (відвантаження і приходи), усі списання з партій, ціни довідника ──
create or replace function cost_backup_create(p_label text default null, p_cost_from date default null)
returns uuid
language plpgsql volatile security invoker set search_path = public as $$
declare v_id uuid; v_m integer; v_a integer; v_p integer;
begin
  insert into cost_backups (label, cost_from) values (coalesce(p_label, 'резервна копія собівартості'), p_cost_from) returning id into v_id;
  insert into cost_backup_movements (backup_id, movement_id, type, cost_price, cost_missing_qty, cost_stale, cost_estimated_qty, cost_estimate_unit)
    select v_id, m.id, m.type, m.cost_price, m.cost_missing_qty, m.cost_stale, m.cost_estimated_qty, m.cost_estimate_unit
      from stock_movements m where m.type in ('out', 'in');
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

-- ── Застосування: копія → розрахунок → заміна (усі DELETE/UPDATE з WHERE) ──
create or replace function fifo_apply(p_cost_from date, p_label text default null, p_estimates jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_backup uuid; v_del integer; v_ins integer; v_upd integer; v_asm integer; v_prices integer;
begin
  v_backup := cost_backup_create(coalesce(p_label, 'перед FIFO з ' || p_cost_from), p_cost_from);

  create temp table _fifo_res on commit drop as select * from fifo_compute(p_cost_from, p_estimates);   -- заповнює й _fifo_alloc/_fifo_batches

  delete from stock_allocations a
   where a.out_movement_id in (select m.id from stock_movements m where m.type = 'out');
  get diagnostics v_del = row_count;
  insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis)
    select a_out, a_in, a_qty, a_unit, a_date, a_company, a_basis from _fifo_alloc where a_qty > 0;
  get diagnostics v_ins = row_count;

  -- відвантаження з p_cost_from у відкритих місяцях; нестача — оцінкою (⚠), а не нулем
  update stock_movements m
     set cost_price = r.new_unit, cost_missing_qty = r.missing_qty, cost_estimated_qty = r.est_qty,
         cost_estimate_unit = coalesce(r.est_unit, m.cost_estimate_unit), cost_stale = false
    from _fifo_res r
   where m.id = r.out_id and r.skipped_closed = false;
  get diagnostics v_upd = row_count;

  -- виріб збірки — за перерахованою собівартістю компонентів (збірка нейтральна)
  update stock_movements m
     set cost_price = fb.unit
    from _fifo_batches fb
   where fb.asm_id is not null and m.id = fb.in_id and m.type = 'in'
     and m.date >= p_cost_from and not period_is_closed(m.company_id, m.date)
     and fb.unit > 0 and m.cost_price is distinct from fb.unit;
  get diagnostics v_asm = row_count;

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
                            'costs_updated', v_upd, 'assemblies_updated', v_asm, 'prices_updated', v_prices);
end $$;
grant execute on function fifo_apply(date, text, jsonb) to authenticated;

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
     set cost_price = r.cost_price, cost_missing_qty = coalesce(r.cost_missing_qty, m.cost_missing_qty), cost_stale = coalesce(r.cost_stale, m.cost_stale),
         cost_estimated_qty = coalesce(r.cost_estimated_qty, 0), cost_estimate_unit = r.cost_estimate_unit
    from cost_backup_movements r
   where r.backup_id = p_backup and m.id = r.movement_id and not period_is_closed(m.company_id, m.date)
     and (m.cost_price, m.cost_missing_qty, m.cost_stale, m.cost_estimated_qty, m.cost_estimate_unit)
         is distinct from (r.cost_price, coalesce(r.cost_missing_qty, m.cost_missing_qty), coalesce(r.cost_stale, m.cost_stale), coalesce(r.cost_estimated_qty, 0), r.cost_estimate_unit);
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
   where x.backup_id = p_backup and p.id = x.product_id and p.buy_price is distinct from x.buy_price;
  get diagnostics v_prices = row_count;
  return jsonb_build_object('costs_restored', v_upd, 'allocations_removed', v_del, 'allocations_restored', v_ins, 'prices_restored', v_prices);
end $$;
grant execute on function cost_backup_restore(uuid) to authenticated;

commit;

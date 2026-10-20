-- 076: «Звірка видаткової» (ТЗ 2026-10-20).
--  5.1 shipment_links — ручна прив'язка рядка видаткової (документ + товар) до рядка прихідної (документ + товар)
--      на кількість; м'яке скасування (removed_by/removed_at). Рядок = документ + товар, а не id руху складу:
--      перезбереження документа з «Рух на складі» перестворює рухи, а прив'язка лишається.
--  5.2 documents.warehouse_date — дата оприбуткування на складі (null = дата документа); змінюється лише RPC.
--  5.3 cost_action_log — журнал дій: хто, коли, що, було → стало.
--  6.  Розподіл партій: 1) ручна прив'язка (резервує партію), 2) прихідна того ж замовлення, 3) FIFO на
--      coalesce(warehouse_date, дата руху), 4) оцінка ⚠ (не 0). Так само в сухому прогоні, «Застосувати FIFO»,
--      «Перерахувати собівартість за період» і тригері нових відвантажень.
--  7.  Усі зміни — RPC з перевіркою ролі (адміністратор / бухгалтер) у базі; виконання від anon заборонено;
--      закриті місяці — відмова; DELETE/UPDATE лише з конкретним WHERE, без TRUNCATE.
begin;

-- ── Ролі ──
create or replace function can_edit_costs() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'accountant'))
$$;
create or replace function require_cost_editor() returns void
language plpgsql security definer stable set search_path = public as $$
begin
  if not can_edit_costs() then
    raise exception 'NO_RIGHTS: змінювати собівартість, прив''язки й дати оприбуткування можуть лише адміністратор або бухгалтер';
  end if;
end $$;

-- ── 5.2 Дата оприбуткування ──
alter table documents add column if not exists warehouse_date date;
create or replace function trg_doc_warehouse_date_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.warehouse_date is distinct from old.warehouse_date and coalesce(current_setting('aim.cost_rpc', true), '') <> 'on' then
    raise exception 'Дату оприбуткування змінює лише дія «Виправити дату оприбуткування» (Склад → Звірка видаткових)';
  end if;
  return new;
end $$;
drop trigger if exists trg_doc_warehouse_date_guard on documents;
create trigger trg_doc_warehouse_date_guard before update of warehouse_date on documents
  for each row execute function trg_doc_warehouse_date_guard();

-- ── 5.1 Ручні прив'язки ──
create table if not exists shipment_links (
  id uuid default gen_random_uuid() primary key,
  company_id uuid,
  out_document_id uuid not null references documents(id) on delete cascade,
  out_product_id uuid not null references products(id),
  in_document_id uuid not null references documents(id) on delete cascade,
  in_product_id uuid not null references products(id),
  qty numeric not null check (qty > 0),
  prev_state jsonb,                    -- собівартість і списання рядка до прив'язки (для точного скасування)
  created_by uuid default auth.uid(),
  created_at timestamptz default now(),
  removed_by uuid,
  removed_at timestamptz
);
create index if not exists idx_shipment_links_out on shipment_links (out_document_id, out_product_id) where removed_at is null;
create index if not exists idx_shipment_links_in on shipment_links (in_document_id, in_product_id) where removed_at is null;
alter table shipment_links enable row level security;
drop policy if exists shipment_links_read on shipment_links;
create policy shipment_links_read on shipment_links for select to authenticated using (true);   -- запис лише через RPC

-- ── 5.3 Журнал ──
create table if not exists cost_action_log (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  user_id uuid default auth.uid(),
  action text not null,          -- link_add | link_remove | warehouse_date | merge | unmerge
  document_id uuid,
  line text,
  before jsonb,
  after jsonb
);
create index if not exists idx_cost_action_log_doc on cost_action_log (document_id, created_at desc);
alter table cost_action_log enable row level security;
drop policy if exists cost_action_log_read on cost_action_log;
create policy cost_action_log_read on cost_action_log for select to authenticated using (true);

-- як списано з партії: manual | order | fifo
alter table stock_allocations add column if not exists how text;

-- ── Активні ручні прив'язки → пари рухів (відвантаження, прихід, к-сть) ──
create or replace function shipment_link_pairs()
returns table (link_id uuid, out_id uuid, in_id uuid, qty numeric)
language plpgsql stable security invoker set search_path = public as $$
declare
  l record; o record; i record;
  v_left numeric; v_out_left numeric; v_take numeric;
  v_in_used jsonb;
begin
  for l in select * from shipment_links where removed_at is null order by created_at, id loop
    v_left := l.qty;
    v_in_used := '{}'::jsonb;
    for o in select m.id, coalesce(m.quantity, 0) as q from stock_movements m
              where m.document_id = l.out_document_id and m.product_id = l.out_product_id and m.type = 'out'
              order by m.created_at, m.id loop
      exit when v_left <= 0.00001;
      v_out_left := least(o.q, v_left);
      for i in select m.id, coalesce(m.quantity, 0) as q from stock_movements m
                where m.document_id = l.in_document_id and m.product_id = l.in_product_id and m.type = 'in'
                order by m.created_at, m.id loop
        exit when v_out_left <= 0.00001;
        v_take := least(v_out_left, i.q - coalesce((v_in_used ->> i.id::text)::numeric, 0));
        continue when v_take <= 0.00001;
        v_in_used := v_in_used || jsonb_build_object(i.id::text, coalesce((v_in_used ->> i.id::text)::numeric, 0) + v_take);
        link_id := l.id; out_id := o.id; in_id := i.id; qty := v_take;
        return next;
        v_out_left := v_out_left - v_take;
        v_left := v_left - v_take;
      end loop;
    end loop;
  end loop;
end $$;

-- ── Розподіл одного відвантаження ──
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

  -- 1) ручна прив'язка — незалежно від дат
  for b in
    select p.in_id, p.qty as want, bu.unit, bu.basis,
           m.quantity - coalesce((select sum(a.qty) from stock_allocations a where a.in_movement_id = m.id), 0) as remaining
      from shipment_link_pairs() p
      join stock_movements m on m.id = p.in_id
      cross join lateral batch_unit_cost(m.id) bu
     where p.out_id = p_out
  loop
    exit when v_need <= 0.00001;
    v_take := least(b.want, b.remaining, v_need);
    continue when v_take <= 0.00001;
    insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis, how)
    values (p_out, b.in_id, v_take, b.unit, o.date, o.company_id, b.basis, 'manual');
    if b.unit > 0 then v_cost := v_cost + v_take * b.unit; else v_nocost := v_nocost + v_take; end if;
    v_need := v_need - v_take;
  end loop;

  -- 2) прихідна того ж замовлення, 3) FIFO на дату оприбуткування; партії, зарезервовані ручною прив'язкою
  --    іншого відвантаження, не беремо
  for b in
    select m.id, bu.unit, bu.basis, x.ord,
           m.quantity - coalesce((select sum(a.qty) from stock_allocations a where a.in_movement_id = m.id), 0)
             - coalesce((select sum(greatest(p.qty - coalesce((select sum(a2.qty) from stock_allocations a2
                                                               where a2.in_movement_id = p.in_id and a2.out_movement_id = p.out_id), 0), 0))
                           from shipment_link_pairs() p where p.in_id = m.id and p.out_id <> p_out), 0) as remaining
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join supplier_orders so on so.id = m.supplier_order_id
      cross join lateral (select coalesce(m.order_id, d.order_id, so.order_id) as ord, coalesce(d.warehouse_date, m.date) as bdate) x
      cross join lateral batch_unit_cost(m.id) bu
     where m.type = 'in' and m.product_id = o.product_id and m.company_id = o.company_id
       and ((v_order is not null and x.ord = v_order) or x.bdate <= o.date)
     order by case when v_order is not null and x.ord = v_order then 0 when x.ord is null then 1 else 2 end,
              x.bdate, m.created_at, m.id
  loop
    exit when v_need <= 0.00001;
    continue when b.remaining <= 0.00001;
    v_take := least(b.remaining, v_need);
    insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis, how)
    values (p_out, b.id, v_take, b.unit, o.date, o.company_id, b.basis,
            case when v_order is not null and b.ord = v_order then 'order' else 'fifo' end);
    if b.unit > 0 then v_cost := v_cost + v_take * b.unit; else v_nocost := v_nocost + v_take; end if;
    v_need := v_need - v_take;
  end loop;

  -- 4) нестача: оцінка (поточна собівартість) з позначкою ⚠; інакше «без собівартості»
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

-- зберегти поточну собівартість як оцінку (щоб перерахунок не дав 0 там, де партій немає)
create or replace function keep_cost_as_estimate(p_outs uuid[])
returns void
language sql volatile security invoker set search_path = public as $$
  update stock_movements m set cost_estimate_unit = m.cost_price
   where m.id = any (p_outs) and m.type = 'out' and m.cost_estimate_unit is null and coalesce(m.cost_price, 0) > 0
     and not exists (select 1 from stock_allocations a where a.out_movement_id = m.id)
$$;

-- ── Розрахунок FIFO лише в тимчасових таблицях (сухий прогін / застосування) ──
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
  if to_regclass('pg_temp._fifo_batches') is null then
    create temp table _fifo_batches (in_id uuid, p_id uuid, c_id uuid, order_key uuid, b_date date, b_created timestamptz,
                                     b_qty numeric, remaining numeric, reserved numeric, unit numeric, basis text, asm_id uuid) on commit drop;
    create index on _fifo_batches (p_id, c_id);
  else
    delete from _fifo_batches where true;   -- тимчасова таблиця цієї транзакції
  end if;
  if to_regclass('pg_temp._fifo_alloc') is null then
    create temp table _fifo_alloc (a_out uuid, a_in uuid, a_qty numeric, a_unit numeric, a_basis text, a_date date, a_company uuid, a_how text) on commit drop;
  else
    delete from _fifo_alloc where true;
  end if;
  if to_regclass('pg_temp._fifo_asm') is null then
    create temp table _fifo_asm (asm_id uuid primary key, cost numeric) on commit drop;
  else
    delete from _fifo_asm where true;
  end if;
  if to_regclass('pg_temp._fifo_manual') is null then
    create temp table _fifo_manual (m_out uuid, m_in uuid, m_qty numeric) on commit drop;
  else
    delete from _fifo_manual where true;
  end if;

  insert into _fifo_manual select p.out_id, p.in_id, p.qty from shipment_link_pairs() p;

  insert into _fifo_batches (in_id, p_id, c_id, order_key, b_date, b_created, b_qty, remaining, reserved, unit, basis, asm_id)
    select m.id, m.product_id, m.company_id, coalesce(m.order_id, d.order_id, so.order_id),
           coalesce(d.warehouse_date, m.date), m.created_at, coalesce(m.quantity, 0)::numeric, coalesce(m.quantity, 0)::numeric,
           coalesce((select sum(fm.m_qty) from _fifo_manual fm where fm.m_in = m.id), 0),
           bu.unit, bu.basis,
           case when m.source = 'assembly' and m.assembly_id is not null
                 and exists (select 1 from stock_movements c where c.assembly_id = m.assembly_id and c.type = 'out')
                then m.assembly_id end
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join supplier_orders so on so.id = m.supplier_order_id
      cross join lateral batch_unit_cost(m.id) bu
     where m.type = 'in';
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
      -- 1) ручна прив'язка (з резерву партії)
      for b in
        select fm.m_in, fm.m_qty, fb.unit, fb.basis, fb.remaining
          from _fifo_manual fm join _fifo_batches fb on fb.in_id = fm.m_in
         where fm.m_out = o.m_id
      loop
        exit when v_need <= 0.00001;
        v_take := least(b.m_qty, b.remaining, v_need);
        continue when v_take <= 0.00001;
        update _fifo_batches set remaining = remaining - v_take, reserved = greatest(reserved - b.m_qty, 0) where in_id = b.m_in;
        insert into _fifo_alloc values (o.m_id, b.m_in, v_take, b.unit, b.basis, o.m_date, o.m_company, 'manual');
        if b.unit > 0 then v_cost := v_cost + v_take * b.unit; else v_nocost := v_nocost + v_take; end if;
        v_need := v_need - v_take;
        if b.basis is not null and not (b.basis = any (v_bases)) then v_bases := v_bases || b.basis; end if;
      end loop;
      -- 2) те саме замовлення, 3) FIFO на дату оприбуткування — з вільного (незарезервованого) залишку
      for b in
        select fb.in_id, fb.unit, fb.basis, fb.remaining - fb.reserved as free, fb.order_key
          from _fifo_batches fb
         where fb.p_id = o.m_product and fb.c_id = o.m_company and fb.remaining - fb.reserved > 0.00001
           and ((o.m_order is not null and fb.order_key = o.m_order) or fb.b_date <= o.m_date)
         order by case when o.m_order is not null and fb.order_key = o.m_order then 0 when fb.order_key is null then 1 else 2 end,
                  fb.b_date, fb.b_created, fb.in_id
      loop
        exit when v_need <= 0.00001;
        v_take := least(b.free, v_need);
        update _fifo_batches set remaining = remaining - v_take where in_id = b.in_id;
        insert into _fifo_alloc values (o.m_id, b.in_id, v_take, b.unit, b.basis, o.m_date, o.m_company,
                                        case when o.m_order is not null and b.order_key = o.m_order then 'order' else 'fifo' end);
        if b.unit > 0 then v_cost := v_cost + v_take * b.unit; else v_nocost := v_nocost + v_take; end if;
        v_need := v_need - v_take;
        if b.basis is not null and not (b.basis = any (v_bases)) then v_bases := v_bases || b.basis; end if;
      end loop;
    end if;

    -- 4) нестача → оцінка поточною собівартістю (⚠), якщо вона є
    v_need := greatest(v_need, 0) + v_nocost;
    v_eunit := coalesce(
      nullif((p_estimates ->> o.m_id::text)::numeric, 0),
      nullif(o.m_eunit, 0),
      case when not o.m_had_alloc then nullif(o.m_cost, 0) end);
    if v_need > 0.00001 and coalesce(v_eunit, 0) > 0 then
      v_est := v_need; v_cost := v_cost + v_need * v_eunit; v_need := 0;
      if not ('⚠ оцінка — поточна собівартість' = any (v_bases)) then v_bases := v_bases || '⚠ оцінка — поточна собівартість'::text; end if;
    end if;

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

-- сухий прогін з деталями партій (для екрана «Звірка видаткових») — лише читання постійних таблиць
create or replace function fifo_dry_run_detail_json(p_cost_from date, p_estimates jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_rows jsonb; v_allocs jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from fifo_compute(p_cost_from, p_estimates) r;
  select coalesce(jsonb_agg(jsonb_build_object('out_id', a.a_out, 'in_id', a.a_in, 'qty', a.a_qty, 'unit', a.a_unit, 'basis', a.a_basis, 'how', a.a_how)), '[]'::jsonb)
    into v_allocs from _fifo_alloc a where a.a_date >= p_cost_from;
  return jsonb_build_object('rows', v_rows, 'allocs', v_allocs);
end $$;
grant execute on function fifo_dry_run_detail_json(date, jsonb) to authenticated;

-- застосування: як у 074 + спосіб списання (how); лише адміністратор / бухгалтер
create or replace function fifo_apply(p_cost_from date, p_label text default null, p_estimates jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_backup uuid; v_del integer; v_ins integer; v_upd integer; v_asm integer; v_prices integer;
begin
  perform require_cost_editor();
  v_backup := cost_backup_create(coalesce(p_label, 'перед FIFO з ' || p_cost_from), p_cost_from);

  create temp table _fifo_res on commit drop as select * from fifo_compute(p_cost_from, p_estimates);

  delete from stock_allocations a
   where a.out_movement_id in (select m.id from stock_movements m where m.type = 'out');
  get diagnostics v_del = row_count;
  insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis, how)
    select a_out, a_in, a_qty, a_unit, a_date, a_company, a_basis, a_how from _fifo_alloc where a_qty > 0;
  get diagnostics v_ins = row_count;

  update stock_movements m
     set cost_price = r.new_unit, cost_missing_qty = r.missing_qty, cost_estimated_qty = r.est_qty,
         cost_estimate_unit = coalesce(r.est_unit, m.cost_estimate_unit), cost_stale = false
    from _fifo_res r
   where m.id = r.out_id and r.skipped_closed = false;
  get diagnostics v_upd = row_count;

  update stock_movements m
     set cost_price = fb.unit
    from _fifo_batches fb
   where fb.asm_id is not null and m.id = fb.in_id and m.type = 'in'
     and m.date >= p_cost_from and not period_is_closed(m.company_id, m.date)
     and fb.unit > 0 and m.cost_price is distinct from fb.unit;
  get diagnostics v_asm = row_count;

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

create or replace function fifo_apply_set(p_set uuid, p_label text default null)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare s record; v_res jsonb;
begin
  perform require_cost_editor();
  select * into s from fifo_estimate_sets where id = p_set;
  if not found then raise exception 'Набір оцінок % не знайдено', p_set; end if;
  if s.backup_id is not null then raise exception 'Цей набір уже застосовано (резервна копія %)', s.backup_id; end if;
  v_res := fifo_apply(s.cost_from, coalesce(p_label, 'FIFO з ' || s.cost_from || ' (сайт)'), s.estimates);
  update fifo_estimate_sets set backup_id = (v_res ->> 'backup_id')::uuid, result = v_res where id = p_set;
  return v_res;
end $$;

create or replace function cost_backup_restore(p_backup uuid)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_upd integer; v_del integer; v_ins integer; v_prices integer;
begin
  perform require_cost_editor();
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

-- перерахунок за період: лише адміністратор / бухгалтер; поточна собівартість лишається оцінкою, а не 0
create or replace function recalc_cost_period(p_company uuid, p_from date, p_to date)
returns integer
language plpgsql security invoker set search_path = public as $$
declare r record; n integer := 0;
begin
  perform require_cost_editor();
  if exists (
    select 1 from period_closings pc
     where pc.company_id = p_company and pc.status = 'closed'
       and make_date(pc.period_year, pc.period_month, 1) between date_trunc('month', p_from)::date and p_to
  ) then
    raise exception 'PERIOD_CLOSED: у вибраному періоді є закриті місяці. Переоткрийте їх у «Закритті періоду», щоб перерахувати собівартість.';
  end if;
  perform keep_cost_as_estimate(array(select id from stock_movements where type = 'out' and company_id = p_company and date between p_from and p_to));
  delete from stock_allocations a using stock_movements m
   where a.out_movement_id = m.id and m.company_id = p_company and m.date between p_from and p_to;
  for r in
    select id from stock_movements
     where type = 'out' and company_id = p_company and date between p_from and p_to
     order by date, created_at, id
  loop
    perform allocate_out(r.id, true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── Перерахунок однієї видаткової (після дії на екрані) ──
create or replace function recalc_shipment(p_out_doc uuid, p_product uuid default null)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare r record; v_outs uuid[];
begin
  select array_agg(m.id order by m.date, m.created_at, m.id) into v_outs from stock_movements m
   where m.document_id = p_out_doc and m.type = 'out' and (p_product is null or m.product_id = p_product)
     and not period_is_closed(m.company_id, m.date);
  if v_outs is null then return '[]'::jsonb; end if;
  perform keep_cost_as_estimate(v_outs);
  for r in select unnest(v_outs) as id loop perform allocate_out(r.id, true); end loop;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'product_id', m.product_id, 'qty', m.quantity, 'cost_price', m.cost_price,
                                                         'missing', m.cost_missing_qty, 'estimated', m.cost_estimated_qty)), '[]'::jsonb)
            from stock_movements m where m.id = any (v_outs));
end $$;

-- рядок у закритому місяці?
create or replace function doc_line_closed(p_doc uuid, p_product uuid, p_type text)
returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from stock_movements m where m.document_id = p_doc and m.product_id = p_product and m.type = p_type
                   and period_is_closed(m.company_id, m.date))
      or exists (select 1 from documents d where d.id = p_doc and period_is_closed(d.company_id, coalesce(d.doc_date, d.created_at::date)))
$$;

-- ── 4.1 «Взяти з цієї прихідної» ──
create or replace function shipment_link_add(p_out_doc uuid, p_out_product uuid, p_in_doc uuid, p_in_product uuid, p_qty numeric)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_out_qty numeric; v_in_qty numeric; v_out_linked numeric; v_in_linked numeric;
  v_others text; v_prev jsonb; v_id uuid; v_res jsonb; v_company uuid;
begin
  perform require_cost_editor();
  if coalesce(p_qty, 0) <= 0 then raise exception 'Кількість має бути більшою за 0'; end if;
  if doc_line_closed(p_out_doc, p_out_product, 'out') then raise exception 'PERIOD_CLOSED: видаткова в закритому місяці'; end if;
  if doc_line_closed(p_in_doc, p_in_product, 'in') then raise exception 'PERIOD_CLOSED: прихідна в закритому місяці'; end if;

  select coalesce(sum(quantity), 0), max(company_id::text)::uuid into v_out_qty, v_company from stock_movements
   where document_id = p_out_doc and product_id = p_out_product and type = 'out';
  select coalesce(sum(quantity), 0) into v_in_qty from stock_movements
   where document_id = p_in_doc and product_id = p_in_product and type = 'in';
  if v_out_qty <= 0 then raise exception 'У видатковій немає складського руху цього товару'; end if;
  if v_in_qty <= 0 then raise exception 'У прихідній немає складського руху цього товару (проведіть її на склад)'; end if;

  select coalesce(sum(qty), 0) into v_out_linked from shipment_links
   where out_document_id = p_out_doc and out_product_id = p_out_product and removed_at is null;
  if p_qty > v_out_qty - v_out_linked + 0.00001 then
    raise exception 'Рядок видаткової: % з % уже прив''язано, вільно %', v_out_linked, v_out_qty, v_out_qty - v_out_linked;
  end if;
  select coalesce(sum(qty), 0) into v_in_linked from shipment_links
   where in_document_id = p_in_doc and in_product_id = p_in_product and removed_at is null;
  if p_qty > v_in_qty - v_in_linked + 0.00001 then
    select string_agg(coalesce(d.doc_number, '—') || ' від ' || to_char(coalesce(d.doc_date, d.created_at::date), 'DD.MM.YYYY') || ' (' || l.qty || ')', ', ')
      into v_others
      from shipment_links l join documents d on d.id = l.out_document_id
     where l.in_document_id = p_in_doc and l.in_product_id = p_in_product and l.removed_at is null;
    raise exception 'TAKEN: партію вже взято іншою видатковою: % — спершу зніміть ту прив''язку (вільно %)', v_others, v_in_qty - v_in_linked;
  end if;

  -- стан рядка до прив'язки — для точного скасування
  select jsonb_build_object(
           'movements', coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'cost_price', m.cost_price, 'cost_missing_qty', m.cost_missing_qty,
                                                              'cost_estimated_qty', m.cost_estimated_qty, 'cost_estimate_unit', m.cost_estimate_unit,
                                                              'cost_stale', m.cost_stale)), '[]'::jsonb),
           'allocations', coalesce((select jsonb_agg(jsonb_build_object('out', a.out_movement_id, 'in', a.in_movement_id, 'qty', a.qty, 'unit', a.unit_cost,
                                                                       'date', a.out_date, 'company', a.company_id, 'basis', a.basis, 'how', a.how))
                                      from stock_allocations a join stock_movements mm on mm.id = a.out_movement_id
                                     where mm.document_id = p_out_doc and mm.product_id = p_out_product and mm.type = 'out'), '[]'::jsonb))
    into v_prev
    from stock_movements m where m.document_id = p_out_doc and m.product_id = p_out_product and m.type = 'out';

  insert into shipment_links (company_id, out_document_id, out_product_id, in_document_id, in_product_id, qty, prev_state)
  values (v_company, p_out_doc, p_out_product, p_in_doc, p_in_product, p_qty, v_prev)
  returning id into v_id;

  v_res := recalc_shipment(p_out_doc, p_out_product);
  insert into cost_action_log (action, document_id, line, before, after)
  values ('link_add', p_out_doc, p_out_product::text, v_prev,
          jsonb_build_object('link_id', v_id, 'in_document_id', p_in_doc, 'in_product_id', p_in_product, 'qty', p_qty, 'movements', v_res));
  return jsonb_build_object('link_id', v_id, 'movements', v_res);
end $$;

-- «Зняти прив'язку» (м'яке скасування); якщо інших прив'язок рядка немає — точне повернення попереднього стану
create or replace function shipment_link_remove(p_link uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare l record; v_res jsonb; v_restored boolean := false; x jsonb;
begin
  perform require_cost_editor();
  select * into l from shipment_links where id = p_link and removed_at is null;
  if not found then raise exception 'Прив''язку не знайдено або вже знято'; end if;
  if doc_line_closed(l.out_document_id, l.out_product_id, 'out') then raise exception 'PERIOD_CLOSED: видаткова в закритому місяці'; end if;

  update shipment_links set removed_by = auth.uid(), removed_at = now() where id = p_link;

  if l.prev_state is not null
     and not exists (select 1 from shipment_links o where o.out_document_id = l.out_document_id and o.out_product_id = l.out_product_id
          and o.removed_at is null)
     and (select count(*) from jsonb_array_elements(l.prev_state -> 'movements') e
           where exists (select 1 from stock_movements m where m.id = (e ->> 'id')::uuid))
         = jsonb_array_length(l.prev_state -> 'movements')
  then
    delete from stock_allocations a
     where a.out_movement_id in (select m.id from stock_movements m
                                  where m.document_id = l.out_document_id and m.product_id = l.out_product_id and m.type = 'out');
    for x in select * from jsonb_array_elements(l.prev_state -> 'allocations') loop
      if exists (select 1 from stock_movements m where m.id = (x ->> 'in')::uuid) then
        insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis, how)
        values ((x ->> 'out')::uuid, (x ->> 'in')::uuid, (x ->> 'qty')::numeric, (x ->> 'unit')::numeric, (x ->> 'date')::date,
                (x ->> 'company')::uuid, x ->> 'basis', x ->> 'how');
      end if;
    end loop;
    update stock_movements m
       set cost_price = (e ->> 'cost_price')::numeric, cost_missing_qty = coalesce((e ->> 'cost_missing_qty')::numeric, 0),
           cost_estimated_qty = coalesce((e ->> 'cost_estimated_qty')::numeric, 0), cost_estimate_unit = (e ->> 'cost_estimate_unit')::numeric,
           cost_stale = coalesce((e ->> 'cost_stale')::boolean, false)
      from jsonb_array_elements(l.prev_state -> 'movements') e
     where m.id = (e ->> 'id')::uuid;
    v_restored := true;
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'product_id', m.product_id, 'qty', m.quantity, 'cost_price', m.cost_price,
                                                 'missing', m.cost_missing_qty, 'estimated', m.cost_estimated_qty)), '[]'::jsonb)
      into v_res from stock_movements m where m.document_id = l.out_document_id and m.product_id = l.out_product_id and m.type = 'out';
  else
    v_res := recalc_shipment(l.out_document_id, l.out_product_id);
  end if;

  insert into cost_action_log (action, document_id, line, before, after)
  values ('link_remove', l.out_document_id, l.out_product_id::text, to_jsonb(l) - 'prev_state',
          jsonb_build_object('restored_previous', v_restored, 'movements', v_res));
  return jsonb_build_object('restored_previous', v_restored, 'movements', v_res);
end $$;

-- ── 4.2 «Виправити дату оприбуткування» (p_date null — повернути дату документа) ──
create or replace function set_warehouse_date(p_in_doc uuid, p_date date, p_recalc_out_doc uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare d record; v_target date; v_moved integer; v_res jsonb := '[]'::jsonb;
begin
  perform require_cost_editor();
  select * into d from documents where id = p_in_doc;
  if not found then raise exception 'Прихідну не знайдено'; end if;
  v_target := coalesce(p_date, d.doc_date, d.created_at::date);
  if period_is_closed(d.company_id, coalesce(d.warehouse_date, d.doc_date, d.created_at::date))
     or period_is_closed(d.company_id, v_target)
     or exists (select 1 from stock_movements m where m.document_id = p_in_doc and m.type = 'in' and period_is_closed(m.company_id, m.date)) then
    raise exception 'PERIOD_CLOSED: дата оприбуткування або нова дата — у закритому місяці';
  end if;

  perform set_config('aim.cost_rpc', 'on', true);
  update documents set warehouse_date = p_date where id = p_in_doc;
  perform set_config('aim.cost_rpc', 'off', true);
  update stock_movements set date = v_target
   where document_id = p_in_doc and type = 'in' and source is distinct from 'assembly' and date is distinct from v_target;
  get diagnostics v_moved = row_count;

  if p_recalc_out_doc is not null then v_res := recalc_shipment(p_recalc_out_doc, null); end if;
  insert into cost_action_log (action, document_id, line, before, after)
  values ('warehouse_date', p_in_doc, null, jsonb_build_object('warehouse_date', d.warehouse_date, 'doc_date', d.doc_date),
          jsonb_build_object('warehouse_date', p_date, 'movements_moved', v_moved, 'recalc', v_res));
  return jsonb_build_object('movements_moved', v_moved, 'movements', v_res);
end $$;

-- ── 4.3 Об'єднання карток: роль, заборона при різних артикулах, журнал із переліком перенесеного (для скасування) ──
create or replace function merge_products(p_keep uuid, p_dup uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  k record; d record; v_norm_k text; v_norm_d text;
  v_mov text[]; v_oi text[]; v_ti text[]; v_ai text[]; v_as text[]; v_al text[]; v_lo text[]; v_li text[];
  v_log uuid;
begin
  perform require_cost_editor();
  if p_keep is null or p_dup is null or p_keep = p_dup then raise exception 'Оберіть два різні товари'; end if;
  select * into k from products where id = p_keep;
  if not found then raise exception 'Товар, який лишається, не знайдено'; end if;
  select * into d from products where id = p_dup;
  if not found then raise exception 'Товар-дубль не знайдено'; end if;
  v_norm_k := upper(regexp_replace(coalesce(k.sku, ''), '[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ]', '', 'g'));
  v_norm_d := upper(regexp_replace(coalesce(d.sku, ''), '[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ]', '', 'g'));
  if v_norm_k <> '' and v_norm_d <> '' and v_norm_k <> v_norm_d then
    raise exception 'SKU_CONFLICT: артикули різні (% і %) — це різні товари, об''єднання заборонено', k.sku, d.sku;
  end if;

  perform set_config('aim.skip_alloc', 'on', true);   -- розподіл по партіях не перезапускаємо
  with u as (update stock_movements set product_id = p_keep where product_id = p_dup returning id) select array_agg(id::text) into v_mov from u;
  perform set_config('aim.skip_alloc', 'off', true);
  with u as (update order_items set product_id = p_keep where product_id = p_dup returning id) select array_agg(id::text) into v_oi from u;
  if to_regclass('public.transaction_items') is not null then
    execute 'with u as (update transaction_items set product_id = $1 where product_id = $2 returning id) select array_agg(id::text) from u' into v_ti using p_keep, p_dup;
  end if;
  if to_regclass('public.assembly_items') is not null then
    execute 'with u as (update assembly_items set product_id = $1 where product_id = $2 returning id) select array_agg(id::text) from u' into v_ai using p_keep, p_dup;
  end if;
  if to_regclass('public.assemblies') is not null then
    execute 'with u as (update assemblies set result_product_id = $1 where result_product_id = $2 returning id) select array_agg(id::text) from u' into v_as using p_keep, p_dup;
  end if;
  if to_regclass('public.product_aliases') is not null then
    execute 'with u as (update product_aliases set product_id = $1 where product_id = $2 returning id) select array_agg(id::text) from u' into v_al using p_keep, p_dup;
  end if;
  with u as (update shipment_links set out_product_id = p_keep where out_product_id = p_dup returning id) select array_agg(id::text) into v_lo from u;
  with u as (update shipment_links set in_product_id = p_keep where in_product_id = p_dup returning id) select array_agg(id::text) into v_li from u;
  update products set status = 'archived' where id = p_dup;

  insert into cost_action_log (action, document_id, line, before, after)
  values ('merge', null, p_keep::text,
          jsonb_build_object('keep', jsonb_build_object('id', k.id, 'name', k.name, 'sku', k.sku), 'dup', jsonb_build_object('id', d.id, 'name', d.name, 'sku', d.sku, 'status', d.status)),
          jsonb_build_object('stock_movements', v_mov, 'order_items', v_oi, 'transaction_items', v_ti, 'assembly_items', v_ai,
                             'assemblies', v_as, 'product_aliases', v_al, 'links_out', v_lo, 'links_in', v_li))
  returning id into v_log;
  return jsonb_build_object('log_id', v_log, 'movements', coalesce(array_length(v_mov, 1), 0), 'order_items', coalesce(array_length(v_oi, 1), 0));
end $$;

-- елементи масиву jsonb як текст (порожньо, якщо не масив)
create or replace function jsonb_text_list(j jsonb) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end)), '{}')
$$;

-- скасування об'єднання — повертає на дубль саме те, що було перенесено
create or replace function unmerge_products(p_log uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare g record; v_keep uuid; v_dup uuid; a jsonb;
begin
  perform require_cost_editor();
  select * into g from cost_action_log where id = p_log and action = 'merge';
  if not found then raise exception 'Запис об''єднання не знайдено'; end if;
  if exists (select 1 from cost_action_log where action = 'unmerge' and (before ->> 'merge_log') = p_log::text) then
    raise exception 'Це об''єднання вже скасовано';
  end if;
  v_keep := (g.before -> 'keep' ->> 'id')::uuid; v_dup := (g.before -> 'dup' ->> 'id')::uuid;
  a := g.after;
  perform set_config('aim.skip_alloc', 'on', true);
  update stock_movements set product_id = v_dup
   where product_id = v_keep and id::text = any (jsonb_text_list(a -> 'stock_movements'));
  perform set_config('aim.skip_alloc', 'off', true);
  update order_items set product_id = v_dup
   where product_id = v_keep and id::text = any (jsonb_text_list(a -> 'order_items'));
  if to_regclass('public.transaction_items') is not null then
    execute 'update transaction_items set product_id = $1 where product_id = $2 and id::text = any (jsonb_text_list($3))'
      using v_dup, v_keep, a -> 'transaction_items';
  end if;
  if to_regclass('public.assembly_items') is not null then
    execute 'update assembly_items set product_id = $1 where product_id = $2 and id::text = any (jsonb_text_list($3))'
      using v_dup, v_keep, a -> 'assembly_items';
  end if;
  if to_regclass('public.assemblies') is not null then
    execute 'update assemblies set result_product_id = $1 where result_product_id = $2 and id::text = any (jsonb_text_list($3))'
      using v_dup, v_keep, a -> 'assemblies';
  end if;
  if to_regclass('public.product_aliases') is not null then
    execute 'update product_aliases set product_id = $1 where product_id = $2 and id::text = any (jsonb_text_list($3))'
      using v_dup, v_keep, a -> 'product_aliases';
  end if;
  update shipment_links set out_product_id = v_dup
   where out_product_id = v_keep and id::text = any (jsonb_text_list(a -> 'links_out'));
  update shipment_links set in_product_id = v_dup
   where in_product_id = v_keep and id::text = any (jsonb_text_list(a -> 'links_in'));
  update products set status = coalesce(g.before -> 'dup' ->> 'status', 'active') where id = v_dup;
  insert into cost_action_log (action, document_id, line, before, after)
  values ('unmerge', null, v_dup::text, jsonb_build_object('merge_log', p_log), g.after);
  return jsonb_build_object('ok', true);
end $$;

-- ── Права: лише authenticated, від anon/public — заборонено ──
do $$
declare f text;
begin
  foreach f in array array[
    'can_edit_costs()', 'require_cost_editor()', 'shipment_link_pairs()', 'allocate_out(uuid, boolean)', 'keep_cost_as_estimate(uuid[])',
    'fifo_compute(date, jsonb)', 'fifo_dry_run_detail_json(date, jsonb)', 'fifo_apply(date, text, jsonb)', 'fifo_apply_set(uuid, text)',
    'cost_backup_restore(uuid)', 'recalc_cost_period(uuid, date, date)', 'recalc_shipment(uuid, uuid)', 'doc_line_closed(uuid, uuid, text)',
    'shipment_link_add(uuid, uuid, uuid, uuid, numeric)', 'shipment_link_remove(uuid)', 'set_warehouse_date(uuid, date, uuid)',
    'merge_products(uuid, uuid)', 'unmerge_products(uuid)', 'jsonb_text_list(jsonb)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

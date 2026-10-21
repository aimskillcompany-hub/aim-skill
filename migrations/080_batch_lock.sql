-- 080: «Закрити партію» (2026-10-21). Партію, з якою все гаразд, можна закрити: її поточний розподіл фіксується
-- (кожне відвантаження з неї стає ручною прив'язкою з lock_id), FIFO більше нічого з неї не бере і не перерозподіляє,
-- «Взяти з цієї прихідної» / «Зняти прив'язку» для неї заборонені, поки партію не відкрито. Партія ідентифікується як
-- рядок прихідної: рух → номер рядка + к-сть → відбиток (к-сть + ціна). Відкрити — batch_unlock (прив'язки знімаються,
-- розподіл повертається до FIFO). Лише адміністратор / бухгалтер; журнал cost_action_log.
-- DELETE/UPDATE лише з конкретним WHERE; TRUNCATE немає.
begin;

create table if not exists batch_locks (
  id uuid default gen_random_uuid() primary key,
  company_id uuid,
  in_document_id uuid references documents(id) on delete cascade,
  in_product_id uuid references products(id),
  in_movement_id uuid references stock_movements(id) on delete set null,
  in_line integer, in_qty numeric, in_price numeric,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz default now(),
  removed_by uuid,
  removed_at timestamptz
);
create index if not exists idx_batch_locks_doc on batch_locks (in_document_id) where removed_at is null;
alter table batch_locks enable row level security;
drop policy if exists batch_locks_read on batch_locks;
create policy batch_locks_read on batch_locks for select to authenticated using (true);   -- запис лише через RPC
alter table shipment_links add column if not exists lock_id uuid references batch_locks(id) on delete set null;

-- рядок прихідної за збереженими ознаками (як out_line_resolve у 078; товар не обов'язковий для самого руху — після об'єднання карток)
create or replace function in_line_resolve(p_mov uuid, p_doc uuid, p_product uuid, p_line integer, p_qty numeric, p_price numeric)
returns uuid
language plpgsql stable security invoker set search_path = public as $$
declare v uuid;
begin
  select m.id into v from stock_movements m where m.id = p_mov and m.type = 'in' and (p_doc is null or m.document_id = p_doc);
  if v is not null then return v; end if;
  if p_doc is null then return null; end if;
  select m.id into v from stock_movements m
   where m.document_id = p_doc and m.type = 'in' and m.product_id = p_product and m.source is distinct from 'assembly'
     and p_line is not null and stock_line_of(m.id) = p_line and (p_qty is null or abs(coalesce(m.quantity, 0) - p_qty) < 0.00001)
   order by m.created_at, m.id limit 1;
  if v is not null then return v; end if;
  select m.id into v from stock_movements m
   where m.document_id = p_doc and m.type = 'in' and m.product_id = p_product and m.source is distinct from 'assembly'
     and abs(coalesce(m.quantity, 0) - coalesce(p_qty, -1)) < 0.00001 and abs(coalesce(m.price, 0) - coalesce(p_price, 0)) < 0.005
   order by m.created_at, m.id limit 1;
  return v;
end $$;

create or replace function batch_lock_pairs()
returns table (id uuid, in_id uuid)
language sql stable security invoker set search_path = public as $$
  select k.id, in_line_resolve(k.in_movement_id, k.in_document_id, k.in_product_id, k.in_line, k.in_qty, k.in_price)
    from batch_locks k where k.removed_at is null
$$;
create or replace function batch_locked(p_in uuid)
returns boolean
language sql stable security invoker set search_path = public as $$
  select p_in is not null and exists (select 1 from batch_lock_pairs() x where x.in_id = p_in)
$$;
create or replace function batch_locks_resolved_json()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'in_id', x.in_id, 'note', k.note, 'created_at', k.created_at, 'created_by', k.created_by)), '[]'::jsonb)
    from batch_lock_pairs() x join batch_locks k on k.id = x.id
$$;

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
  v_pairs jsonb;
  v_manual numeric;
  v_odate date;
begin
  select m.* into o from stock_movements m where m.id = p_out;
  if not found then return; end if;
  -- дата відвантаження = дата видаткової (надрукована), а не дата руху складу
  v_odate := coalesce(case when o.document_id is not null then doc_print_date(o.document_id) end, o.date);
  delete from stock_allocations where out_movement_id = p_out;
  if o.type <> 'out' then return; end if;

  select product_type into v_ptype from products where id = o.product_id;
  if coalesce(v_ptype, 'goods') = 'service' then
    if p_update_cost then update stock_movements set cost_price = 0, cost_missing_qty = 0, cost_estimated_qty = 0, cost_stale = false where id = p_out; end if;
    return;
  end if;

  v_order := stock_order_of(p_out);
  v_need := coalesce(o.quantity, 0);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_pairs from shipment_link_pairs() x;   -- один раз

  -- 1) ручна прив'язка — незалежно від дат
  for b in
    select p.in_id, p.qty as want, bu.unit, bu.basis,
           m.quantity - coalesce((select sum(a.qty) from stock_allocations a where a.in_movement_id = m.id), 0) as remaining
      from jsonb_to_recordset(v_pairs) as p(link_id uuid, out_id uuid, in_id uuid, qty numeric)
      join stock_movements m on m.id = p.in_id
      cross join lateral batch_unit_cost(m.id) bu
     where p.out_id = p_out
  loop
    exit when v_need <= 0.00001;
    v_take := least(b.want, b.remaining, v_need);
    continue when v_take <= 0.00001;
    insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis, how)
    values (p_out, b.in_id, v_take, b.unit, v_odate, o.company_id, b.basis, 'manual');
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
                           from jsonb_to_recordset(v_pairs) as p(link_id uuid, out_id uuid, in_id uuid, qty numeric)
                          where p.in_id = m.id and p.out_id <> p_out), 0) as remaining
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join supplier_orders so on so.id = m.supplier_order_id
      cross join lateral (select coalesce(m.order_id, d.order_id, so.order_id) as ord, coalesce(d.warehouse_date, m.date) as bdate) x
      cross join lateral batch_unit_cost(m.id) bu
     where m.type = 'in' and m.product_id = o.product_id and m.company_id = o.company_id
       and not batch_locked(m.id)   -- закрита партія: лише її зафіксовані (ручні) відвантаження
       and ((v_order is not null and x.ord = v_order) or x.bdate <= v_odate)
     order by case when v_order is not null and x.ord = v_order then 0 when x.ord is null then 1 else 2 end,
              x.bdate, m.created_at, m.id
  loop
    exit when v_need <= 0.00001;
    continue when b.remaining <= 0.00001;
    v_take := least(b.remaining, v_need);
    insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis, how)
    values (p_out, b.id, v_take, b.unit, v_odate, o.company_id, b.basis,
            case when v_order is not null and b.ord = v_order then 'order' else 'fifo' end);
    if b.unit > 0 then v_cost := v_cost + v_take * b.unit; else v_nocost := v_nocost + v_take; end if;
    v_need := v_need - v_take;
  end loop;

  -- 4) нестача: оцінка (поточна собівартість) з позначкою ⚠; інакше «без собівартості»
  v_need := greatest(v_need, 0) + v_nocost;
  if v_need > 0.00001 and coalesce(o.cost_estimate_unit, 0) > 0 then
    v_est := v_need; v_cost := v_cost + v_need * o.cost_estimate_unit; v_need := 0;
  end if;

  -- 0) ручна собівартість рядка (manual_costs) — має пріоритет; партії все одно списуються (товар вибув)
  v_manual := manual_cost_of(p_out);
  if coalesce(v_manual, 0) > 0 then
    v_cost := coalesce(o.quantity, 0) * v_manual; v_need := 0; v_est := 0;
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
  v_manual numeric;
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
  if to_regclass('pg_temp._fifo_mcost') is null then
    create temp table _fifo_mcost (mc_out uuid primary key, mc_unit numeric) on commit drop;
  else
    delete from _fifo_mcost where true;
  end if;
  insert into _fifo_mcost select x.out_id, x.unit from manual_cost_pairs() x on conflict (mc_out) do nothing;
  if to_regclass('pg_temp._fifo_locked') is null then
    create temp table _fifo_locked (l_in uuid primary key) on commit drop;
  else
    delete from _fifo_locked where true;
  end if;
  insert into _fifo_locked select x.in_id from batch_lock_pairs() x where x.in_id is not null on conflict (l_in) do nothing;

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
    select m.id as m_id,
           -- дата відвантаження = дата видаткової (надрукована: generated_docs → documents → створення), інакше — дата руху
           case when d.id is not null then coalesce(g.doc_date, d.doc_date, (d.created_at at time zone 'Europe/Kyiv')::date, m.date) else m.date end as m_date,
           m.date as m_mdate, m.company_id as m_company, m.cost_price as m_cost, coalesce(m.quantity, 0) as m_qty,
           m.product_id as m_product, m.document_id as m_doc, coalesce(m.order_id, d.order_id, so.order_id) as m_order,
           coalesce(p.product_type, 'goods') as m_ptype, m.source as m_source, m.assembly_id as m_asm,
           m.cost_estimate_unit as m_eunit,
           exists (select 1 from stock_allocations a where a.out_movement_id = m.id) as m_had_alloc
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join supplier_orders so on so.id = m.supplier_order_id
      left join products p on p.id = m.product_id
      left join generated_docs g on g.id = d.generated_doc_id
     where m.type = 'out'
     order by case when d.id is not null then coalesce(g.doc_date, d.doc_date, (d.created_at at time zone 'Europe/Kyiv')::date, m.date) else m.date end,
              m.created_at, m.id
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
           and not exists (select 1 from _fifo_locked lk where lk.l_in = fb.in_id)   -- закрита партія
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

    -- ручна собівартість рядка — пріоритет (партії списано вище, бо товар фізично вибув)
    v_manual := (select mc_unit from _fifo_mcost where mc_out = o.m_id);
    if coalesce(v_manual, 0) > 0 then
      v_cost := o.m_qty * v_manual; v_need := 0; v_est := 0;
      v_bases := array['вручну']::text[];
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
      skipped_closed := period_is_closed(o.m_company, o.m_date) or period_is_closed(o.m_company, o.m_mdate);
      bases := array_to_string(v_bases, '; ');
      source := o.m_source; assembly_id := o.m_asm;
      return next;
    end if;
  end loop;
end $$;
grant execute on function fifo_compute(date, jsonb) to authenticated;

create or replace function shipment_link_add(p_out_mov uuid, p_in_mov uuid, p_qty numeric)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  o record; i record; v_out_used numeric; v_in_used numeric; v_others text; v_prev jsonb; v_id uuid; v_res jsonb;
begin
  perform require_cost_editor();
  if coalesce(p_qty, 0) <= 0 then raise exception 'Кількість має бути більшою за 0'; end if;
  select * into o from stock_movements where id = p_out_mov and type = 'out';
  if not found or o.document_id is null then raise exception 'Рядок видаткової не знайдено'; end if;
  select * into i from stock_movements where id = p_in_mov and type = 'in';
  if not found or i.document_id is null then raise exception 'Рядок прихідної не знайдено (проведіть прихідну на склад)'; end if;
  if movement_closed(p_out_mov) then raise exception 'PERIOD_CLOSED: видаткова в закритому місяці'; end if;
  if movement_closed(p_in_mov) then raise exception 'PERIOD_CLOSED: прихідна в закритому місяці'; end if;
  if batch_locked(p_in_mov) then raise exception 'LOCKED: партію закрито — спершу відкрийте її (картка товару → Партії → «Відкрити»)'; end if;
  if exists (select 1 from stock_allocations a where a.out_movement_id = p_out_mov and batch_locked(a.in_movement_id))
     or exists (select 1 from shipment_link_pairs() p where p.out_id = p_out_mov and batch_locked(p.in_id)) then
    raise exception 'LOCKED: цей рядок видаткової списано із закритої партії — спершу відкрийте її';
  end if;

  select coalesce(sum(p.qty), 0) into v_out_used from shipment_link_pairs() p where p.out_id = p_out_mov;
  if p_qty > coalesce(o.quantity, 0) - v_out_used + 0.00001 then
    raise exception 'Рядок видаткової: уже прив''язано % з %, вільно %', v_out_used, o.quantity, coalesce(o.quantity, 0) - v_out_used;
  end if;
  select coalesce(sum(p.qty), 0) into v_in_used from shipment_link_pairs() p where p.in_id = p_in_mov;
  if p_qty > coalesce(i.quantity, 0) - v_in_used + 0.00001 then
    select string_agg(coalesce(d.doc_number, '—') || ' від ' || to_char(coalesce(d.doc_date, d.created_at::date), 'DD.MM.YYYY')
                      || ', рядок ' || stock_line_of(p.out_id) || ' (' || p.qty || ')', '; ')
      into v_others
      from shipment_link_pairs() p join stock_movements m on m.id = p.out_id join documents d on d.id = m.document_id
     where p.in_id = p_in_mov;
    raise exception 'TAKEN: рядок прихідної вже взято: % — спершу зніміть ту прив''язку (вільно %)', v_others, coalesce(i.quantity, 0) - v_in_used;
  end if;

  v_prev := out_line_state(p_out_mov);
  insert into shipment_links (company_id, out_document_id, out_product_id, out_movement_id, out_line, out_qty, out_price,
                              in_document_id, in_product_id, in_movement_id, in_line, in_qty, in_price, qty, prev_state)
  values (o.company_id, o.document_id, o.product_id, o.id, stock_line_of(o.id), o.quantity, o.price,
          i.document_id, i.product_id, i.id, stock_line_of(i.id), i.quantity, i.price, p_qty, v_prev)
  returning id into v_id;

  v_res := recalc_shipment(o.document_id, p_out_mov);
  insert into cost_action_log (action, document_id, line, before, after)
  values ('link_add', o.document_id, 'рядок ' || stock_line_of(o.id), v_prev,
          jsonb_build_object('link_id', v_id, 'in_document_id', i.document_id, 'in_line', stock_line_of(i.id), 'in_movement_id', i.id,
                             'qty', p_qty, 'movements', v_res));
  return jsonb_build_object('link_id', v_id, 'movements', v_res);
end $$;

create or replace function shipment_link_remove(p_link uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare l record; v_out uuid; v_res jsonb; v_restored boolean := false; x jsonb; e jsonb;
begin
  perform require_cost_editor();
  select * into l from shipment_links where id = p_link and removed_at is null;
  if not found then raise exception 'Прив''язку не знайдено або вже знято'; end if;
  select p.out_id into v_out from shipment_link_pairs(true) p where p.link_id = p_link;
  if l.lock_id is not null and exists (select 1 from batch_locks k where k.id = l.lock_id and k.removed_at is null) then
    raise exception 'LOCKED: прив''язка закритої партії — спершу відкрийте партію';
  end if;
  if v_out is not null and movement_closed(v_out) then raise exception 'PERIOD_CLOSED: видаткова в закритому місяці'; end if;

  update shipment_links set removed_by = auth.uid(), removed_at = now() where id = p_link;

  e := l.prev_state -> 'movement';
  if v_out is not null and e is not null and (e ->> 'id')::uuid = v_out
     and not exists (select 1 from shipment_link_pairs() p where p.out_id = v_out) then
    delete from stock_allocations a where a.out_movement_id = v_out;
    for x in select * from jsonb_array_elements(l.prev_state -> 'allocations') loop
      if exists (select 1 from stock_movements m where m.id = (x ->> 'in')::uuid) then
        insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id, basis, how)
        values (v_out, (x ->> 'in')::uuid, (x ->> 'qty')::numeric, (x ->> 'unit')::numeric, (x ->> 'date')::date,
                (x ->> 'company')::uuid, x ->> 'basis', x ->> 'how');
      end if;
    end loop;
    update stock_movements m
       set cost_price = (e ->> 'cost_price')::numeric, cost_missing_qty = coalesce((e ->> 'cost_missing_qty')::numeric, 0),
           cost_estimated_qty = coalesce((e ->> 'cost_estimated_qty')::numeric, 0), cost_estimate_unit = (e ->> 'cost_estimate_unit')::numeric,
           cost_stale = coalesce((e ->> 'cost_stale')::boolean, false)
     where m.id = v_out;
    v_restored := true;
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'product_id', m.product_id, 'line', stock_line_of(m.id), 'qty', m.quantity,
                                                 'cost_price', m.cost_price, 'missing', m.cost_missing_qty, 'estimated', m.cost_estimated_qty)), '[]'::jsonb)
      into v_res from stock_movements m where m.id = v_out;
  elsif v_out is not null then
    v_res := recalc_shipment(l.out_document_id, v_out);
  else
    v_res := '[]'::jsonb;   -- рядок уже не існує — лише знімаємо прив'язку
  end if;

  insert into cost_action_log (action, document_id, line, before, after)
  values ('link_remove', l.out_document_id, 'рядок ' || coalesce(l.out_line::text, '?'), to_jsonb(l) - 'prev_state',
          jsonb_build_object('restored_previous', v_restored, 'movements', v_res));
  return jsonb_build_object('restored_previous', v_restored, 'movements', v_res);
end $$;

-- ── Закрити партію: зафіксувати її поточний розподіл (за сухим прогоном FIFO) ручними прив'язками ──
create or replace function batch_lock(p_in_mov uuid, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare i record; v_id uuid; a record; o record; v_n integer := 0;
begin
  perform require_cost_editor();
  select * into i from stock_movements where id = p_in_mov and type = 'in';
  if not found or i.document_id is null then raise exception 'Партію (рядок прихідної) не знайдено'; end if;
  if batch_locked(p_in_mov) then raise exception 'Партію вже закрито'; end if;

  -- поточний розподіл партії (сухий прогін лише в тимчасових таблицях) — ДО замка, інакше FIFO її вже не бере
  perform count(*) from fifo_compute('2000-01-01'::date, '{}'::jsonb);

  insert into batch_locks (company_id, in_document_id, in_product_id, in_movement_id, in_line, in_qty, in_price, note)
  values (i.company_id, i.document_id, i.product_id, i.id, stock_line_of(i.id), i.quantity, i.price, p_note)
  returning id into v_id;
  for a in select a_out, sum(a_qty) as q from _fifo_alloc where a_in = p_in_mov group by a_out loop
    select * into o from stock_movements where id = a.a_out;
    continue when not found or o.document_id is null;
    -- уже є ручна прив'язка цього рядка до цієї партії — лише позначаємо її замком
    if exists (select 1 from shipment_link_pairs() p where p.out_id = a.a_out and p.in_id = p_in_mov) then
      update shipment_links l set lock_id = v_id
       where l.removed_at is null and l.lock_id is null
         and l.id in (select p.link_id from shipment_link_pairs() p where p.out_id = a.a_out and p.in_id = p_in_mov);
    else
      insert into shipment_links (company_id, out_document_id, out_product_id, out_movement_id, out_line, out_qty, out_price,
                                  in_document_id, in_product_id, in_movement_id, in_line, in_qty, in_price, qty, prev_state, lock_id)
      values (o.company_id, o.document_id, o.product_id, o.id, stock_line_of(o.id), o.quantity, o.price,
              i.document_id, i.product_id, i.id, stock_line_of(i.id), i.quantity, i.price, a.q, out_line_state(o.id), v_id);
    end if;
    v_n := v_n + 1;
  end loop;

  insert into cost_action_log (action, document_id, line, before, after)
  values ('batch_lock', i.document_id, 'рядок ' || stock_line_of(i.id), null, jsonb_build_object('lock_id', v_id, 'shipments', v_n, 'note', p_note));
  return jsonb_build_object('id', v_id, 'shipments', v_n);
end $$;

-- ── Відкрити партію: зняти замок і зафіксовані ним прив'язки (розподіл повертається до FIFO) ──
create or replace function batch_unlock(p_lock uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare k record; v_n integer;
begin
  perform require_cost_editor();
  select * into k from batch_locks where id = p_lock and removed_at is null;
  if not found then raise exception 'Закриту партію не знайдено або її вже відкрито'; end if;
  update batch_locks set removed_by = auth.uid(), removed_at = now() where id = p_lock;
  update shipment_links set removed_by = auth.uid(), removed_at = now() where lock_id = p_lock and removed_at is null;
  get diagnostics v_n = row_count;
  insert into cost_action_log (action, document_id, line, before, after)
  values ('batch_unlock', k.in_document_id, 'рядок ' || coalesce(k.in_line::text, '?'), to_jsonb(k), jsonb_build_object('links_removed', v_n));
  return jsonb_build_object('links_removed', v_n);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'in_line_resolve(uuid, uuid, uuid, integer, numeric, numeric)', 'batch_lock_pairs()', 'batch_locked(uuid)', 'batch_locks_resolved_json()',
    'allocate_out(uuid, boolean)', 'fifo_compute(date, jsonb)', 'shipment_link_add(uuid, uuid, numeric)', 'shipment_link_remove(uuid)',
    'batch_lock(uuid, text)', 'batch_unlock(uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

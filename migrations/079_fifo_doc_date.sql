-- 079: FIFO рахує відвантаження за ДАТОЮ ВИДАТКОВОЇ (надрукованою), а не за датою руху складу (2026-10-21).
-- Проблема: рух видачі отримує дату при створенні документа; якщо дату видаткової потім змінили, а «Вирівняти
-- дати» (077) ще не запускали, FIFO обробляв видаткові не в хронологічному порядку — пізня видаткова забирала
-- ранню партію, а раннім бракувало товару. Тепер у allocate_out і fifo_compute дата відвантаження =
-- generated_docs.doc_date → documents.doc_date → дата створення (Київ); без документа — дата руху.
-- Закритий місяць перевіряється і за датою видаткової, і за датою руху. Логіка розподілу та сама (078).
-- DELETE/UPDATE лише з конкретним WHERE; TRUNCATE немає.
begin;

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

revoke execute on function allocate_out(uuid, boolean) from public, anon;
revoke execute on function fifo_compute(date, jsonb) from public, anon;

commit;

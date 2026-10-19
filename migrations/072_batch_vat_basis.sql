-- 072: ціна партії з урахуванням ПДВ (уточнення до 071).
-- Ціна в прихідному русі мала б бути без ПДВ (рішення №17), але OCR інколи писав з ПДВ (№0043: 390 725 з ПДВ
-- замість 325 604). Тепер ціна партії обчислюється так:
--   база збереженої ціни — звіряємо Σ(к-сть × ціна) прихідних рухів документа з сумою документа з ПДВ і без ПДВ;
--   постачальник з ПДВ (vat_amount > 0) і ми платник ПДВ → собівартість БЕЗ ПДВ;
--   постачальник без ПДВ (vat_amount = 0) → повна ціна;
--   наша юрософа не платник ПДВ → ціна З ПДВ (ПДВ не відшкодовується).
-- Безпечно запускати повторно; існуючу собівартість не змінює (лише нові розподіли / перебудова).
begin;

alter table stock_allocations add column if not exists basis text; -- як отримано ціну партії (для перевірки)

create or replace function batch_unit_cost(p_in uuid)
returns table (unit numeric, basis text)
language plpgsql stable security invoker set search_path = public as $$
declare
  m record;
  d record;
  v_raw numeric;
  v_tot numeric;
  v_vat numeric;
  v_net numeric;
  v_gross_stored boolean;
  v_we_payer boolean;
begin
  select sm.id, sm.document_id, sm.company_id, coalesce(nullif(sm.cost_price, 0), sm.price, 0) as raw
    into m from stock_movements sm where sm.id = p_in;
  if not found then unit := 0; basis := 'немає партії'; return next; return; end if;
  v_raw := m.raw;
  select coalesce(c.is_vat_payer, true) into v_we_payer from companies c where c.id = m.company_id;
  v_we_payer := coalesce(v_we_payer, true);

  select doc.amount, doc.vat_amount into d from documents doc where doc.id = m.document_id;
  if m.document_id is null or d.amount is null or d.amount = 0 then
    unit := v_raw; basis := 'без документа — як у русі'; return next; return;
  end if;

  v_vat := abs(coalesce(d.vat_amount, 0));
  if v_vat <= 0.005 then
    unit := v_raw; basis := 'постачальник без ПДВ — повна ціна'; return next; return;
  end if;

  v_net := abs(d.amount) - v_vat;
  select coalesce(sum(x.quantity * coalesce(nullif(x.cost_price, 0), x.price, 0)), 0) into v_tot
    from stock_movements x where x.document_id = m.document_id and x.type = 'in';
  v_gross_stored := abs(v_tot - abs(d.amount)) < abs(v_tot - v_net);

  if v_we_payer then
    if v_gross_stored then unit := round(v_raw * v_net / abs(d.amount), 4); basis := 'у русі з ПДВ → без ПДВ';
    else unit := v_raw; basis := 'без ПДВ'; end if;
  else
    if v_gross_stored then unit := v_raw; basis := 'з ПДВ (ми неплатник)';
    else unit := round(v_raw * abs(d.amount) / nullif(v_net, 0), 4); basis := 'без ПДВ → з ПДВ (ми неплатник)'; end if;
  end if;
  return next;
end $$;
grant execute on function batch_unit_cost(uuid) to authenticated;

-- розподіл: ціна партії — через batch_unit_cost (решта логіки 071 без змін)
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
  v_ptype text;
begin
  select m.*, d.order_id as doc_order into o
    from stock_movements m left join documents d on d.id = m.document_id
   where m.id = p_out;
  if not found then return; end if;
  delete from stock_allocations where out_movement_id = p_out;
  if o.type <> 'out' then return; end if;

  select product_type into v_ptype from products where id = o.product_id;
  if coalesce(v_ptype, 'goods') = 'service' then
    if p_update_cost then update stock_movements set cost_price = 0, cost_missing_qty = 0, cost_stale = false where id = p_out; end if;
    return;
  end if;

  v_order := coalesce(o.order_id, o.doc_order);
  v_need := coalesce(o.quantity, 0);
  for b in
    select m.id, bu.unit, bu.basis,
           m.quantity - coalesce((select sum(a.qty) from stock_allocations a where a.in_movement_id = m.id), 0) as remaining
      from stock_movements m
      left join documents d on d.id = m.document_id
      cross join lateral batch_unit_cost(m.id) bu
     where m.type = 'in' and m.product_id = o.product_id and m.company_id = o.company_id
       and ((v_order is not null and coalesce(m.order_id, d.order_id) = v_order) or m.date <= o.date)
     order by case when v_order is not null and coalesce(m.order_id, d.order_id) = v_order then 0 else 1 end,
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

  if p_update_cost then
    update stock_movements
       set cost_price = case when o.quantity > 0 then round(v_cost / o.quantity, 4) else 0 end,
           cost_missing_qty = round(greatest(v_need, 0) + v_nocost, 4),
           cost_stale = false
     where id = p_out;
  end if;
end $$;
grant execute on function allocate_out(uuid, boolean) to authenticated;

-- перебудова: додано колонку bases (як отримано ціни партій для цього відвантаження)
drop function if exists fifo_rebuild(date, boolean);
create or replace function fifo_rebuild(p_cost_from date, p_apply boolean default false)
returns table (out_id uuid, out_date date, company_id uuid, order_id uuid, document_id uuid, product_id uuid,
               qty numeric, old_unit numeric, new_unit numeric, missing_qty numeric, skipped_closed boolean, bases text)
language plpgsql security invoker set search_path = public as $$
declare
  r record;
  v_res jsonb := '[]'::jsonb;
  v_upd boolean;
  v_new numeric;
  v_alloc numeric;
  v_nocost numeric;
  v_bases text;
begin
  begin
    delete from stock_allocations;
    for r in
      select m.id, m.date, m.company_id, m.cost_price, m.quantity, m.product_id, m.document_id,
             coalesce(m.order_id, d.order_id) as order_id
        from stock_movements m left join documents d on d.id = m.document_id
       where m.type = 'out'
       order by m.date, m.created_at, m.id
    loop
      v_upd := r.date >= p_cost_from and not period_is_closed(r.company_id, r.date);
      perform allocate_out(r.id, v_upd);
      if r.date >= p_cost_from then
        select coalesce(sum(a.qty * a.unit_cost), 0), coalesce(sum(a.qty), 0),
               coalesce(sum(case when a.unit_cost > 0 then 0 else a.qty end), 0),
               string_agg(distinct a.basis, '; ')
          into v_new, v_alloc, v_nocost, v_bases
          from stock_allocations a where a.out_movement_id = r.id;
        v_res := v_res || jsonb_build_object(
          'out_id', r.id, 'out_date', r.date, 'company_id', r.company_id, 'order_id', r.order_id,
          'document_id', r.document_id, 'product_id', r.product_id, 'qty', r.quantity,
          'old_unit', r.cost_price,
          'new_unit', case when r.quantity > 0 then round(v_new / r.quantity, 4) else 0 end,
          'missing_qty', round(greatest(r.quantity - v_alloc, 0) + v_nocost, 4),
          'skipped_closed', not v_upd, 'bases', v_bases);
      end if;
    end loop;

    if p_apply then
      -- ціна в довіднику = остання закупівельна (з урахуванням бази ПДВ)
      update products p set buy_price = x.unit
        from (
          select distinct on (m.product_id) m.product_id, bu.unit
            from stock_movements m cross join lateral batch_unit_cost(m.id) bu
           where m.type = 'in' and bu.unit > 0
           order by m.product_id, m.date desc, m.created_at desc
        ) x
       where p.id = x.product_id and p.buy_price is distinct from x.unit;
    else
      raise exception using errcode = 'P0001', message = 'FIFO_DRY_RUN';
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'FIFO_DRY_RUN' then raise; end if;
  end;

  return query
    select x.out_id, x.out_date, x.company_id, x.order_id, x.document_id, x.product_id,
           x.qty, x.old_unit, x.new_unit, x.missing_qty, x.skipped_closed, x.bases
      from jsonb_to_recordset(v_res) as x(out_id uuid, out_date date, company_id uuid, order_id uuid, document_id uuid,
                                          product_id uuid, qty numeric, old_unit numeric, new_unit numeric,
                                          missing_qty numeric, skipped_closed boolean, bases text);
end $$;
grant execute on function fifo_rebuild(date, boolean) to authenticated;

-- сухий прогін одним значенням (jsonb) — без обмеження API у 1000 рядків
create or replace function fifo_dry_run_json(p_cost_from date)
returns jsonb
language sql security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from fifo_rebuild(p_cost_from, false) r
$$;
grant execute on function fifo_dry_run_json(date) to authenticated;

commit;

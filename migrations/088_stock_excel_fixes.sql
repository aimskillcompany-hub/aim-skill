-- 088: розширення Excel-виправлення складу (ТЗ від 21.10.2026).
--  1) Картка: артикул, назва (стара назва → синонім).                     product_fix
--  2) Частина кількості руху → на іншу / нову картку (рух ділиться на два).  split_movement
--  3) Документ: дата (документ + усі його рухи), номер, «порядок у дні».    doc_fix
--     FIFO (allocate_out, fifo_compute) враховує порядок у дні: без порядку — приходи перед видатками;
--     якщо порядок задано в обох документах — менший іде першим.
--  4) Збірка: дата, кількість, компоненти (додати / прибрати / змінити), ручна собівартість виробу. assembly_fix
--     Собівартість виробу = сума компонентів за FIFO (allocate_out), якщо не задано вручну.
--  5) Синоніми: видалення (зокрема дублів).                                 alias_delete
--  Кожна дія — окремий запис cost_action_log із «було / стало»; скасування — stock_fix_undo(log).
--  Лише «Адміністратор» / «Бухгалтер» (require_cost_editor). Закритий місяць (стара або нова дата) — відмова.
--  Собівартість відвантажень не перераховується (крім збірки, як у ТЗ) — далі «Діагностика» і «Застосувати FIFO».
--  UPDATE / DELETE лише з конкретним WHERE; TRUNCATE немає.
begin;

alter table documents add column if not exists day_order integer;
alter table assemblies add column if not exists manual_unit_cost numeric;

-- ── FIFO: порядок у дні + ручна собівартість збірки (основа — 080) ──
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
  v_oorder integer;
begin
  select m.* into o from stock_movements m where m.id = p_out;
  if not found then return; end if;
  -- дата відвантаження = дата видаткової (надрукована), а не дата руху складу
  v_odate := coalesce(case when o.document_id is not null then doc_print_date(o.document_id) end, o.date);
  v_oorder := (select d0.day_order from documents d0 where d0.id = o.document_id);   -- 088: порядок у дні
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
       and ((v_order is not null and x.ord = v_order)
            or x.bdate < v_odate
            or (x.bdate = v_odate and not (d.day_order is not null and v_oorder is not null and d.day_order > v_oorder)))
     order by case when v_order is not null and x.ord = v_order then 0 when x.ord is null then 1 else 2 end,
              x.bdate, d.day_order nulls first, m.created_at, m.id
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
                                     b_qty numeric, remaining numeric, reserved numeric, unit numeric, basis text, asm_id uuid, b_order integer) on commit drop;
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

  -- 088: тимчасова таблиця могла бути створена старою версією в цій самій транзакції
  alter table _fifo_batches add column if not exists b_order integer;
  insert into _fifo_batches (in_id, p_id, c_id, order_key, b_date, b_created, b_qty, remaining, reserved, unit, basis, asm_id, b_order)
    select m.id, m.product_id, m.company_id, coalesce(m.order_id, d.order_id, so.order_id),
           coalesce(d.warehouse_date, m.date), m.created_at, coalesce(m.quantity, 0)::numeric, coalesce(m.quantity, 0)::numeric,
           coalesce((select sum(fm.m_qty) from _fifo_manual fm where fm.m_in = m.id), 0),
           bu.unit, bu.basis,
           case when m.source = 'assembly' and m.assembly_id is not null
                 and exists (select 1 from stock_movements c where c.assembly_id = m.assembly_id and c.type = 'out')
                 and not exists (select 1 from assemblies am where am.id = m.assembly_id and am.manual_unit_cost is not null)   -- 088: ручна собівартість виробу
                then m.assembly_id end,
           d.day_order
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
           m.cost_estimate_unit as m_eunit, d.day_order as m_dorder,
           exists (select 1 from stock_allocations a where a.out_movement_id = m.id) as m_had_alloc
      from stock_movements m
      left join documents d on d.id = m.document_id
      left join supplier_orders so on so.id = m.supplier_order_id
      left join products p on p.id = m.product_id
      left join generated_docs g on g.id = d.generated_doc_id
     where m.type = 'out'
     order by case when d.id is not null then coalesce(g.doc_date, d.doc_date, (d.created_at at time zone 'Europe/Kyiv')::date, m.date) else m.date end,
              d.day_order nulls last, m.created_at, m.id
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
           and ((o.m_order is not null and fb.order_key = o.m_order)
                or fb.b_date < o.m_date
                or (fb.b_date = o.m_date and not (fb.b_order is not null and o.m_dorder is not null and fb.b_order > o.m_dorder)))
         order by case when o.m_order is not null and fb.order_key = o.m_order then 0 when fb.order_key is null then 1 else 2 end,
                  fb.b_date, fb.b_order nulls first, fb.b_created, fb.in_id
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

-- ── спільні перевірки ──
create or replace function fix_check_movs(p_movs uuid[])
returns void
language plpgsql stable security invoker set search_path = public as $$
begin
  if exists (select 1 from unnest(p_movs) u(id) where movement_closed(u.id)) then
    raise exception 'PERIOD_CLOSED: рух у закритому місяці — відкрийте період у «Закритті періоду»';
  end if;
  if exists (select 1 from shipment_links l where l.removed_at is null
               and (l.out_movement_id = any (p_movs) or l.in_movement_id = any (p_movs))) then
    raise exception 'LINKED: для руху є ручна прив''язка партії — спершу зніміть її у звірці';
  end if;
  if exists (select 1 from manual_costs c where c.removed_at is null and c.out_movement_id = any (p_movs)) then
    raise exception 'LINKED: для руху задано ручну собівартість — спершу зніміть її у звірці';
  end if;
  if exists (select 1 from batch_locks b where b.removed_at is null and b.in_movement_id = any (p_movs)) then
    raise exception 'LOCKED: закрита партія — спершу відкрийте її';
  end if;
end $$;

-- ── 1. Картка: артикул / назва ──
-- p_sku: null — без змін, '' — очистити. p_name: null — без змін. p_alias_norm — нормалізована стара назва (як у програмі).
create or replace function product_fix(p_id uuid, p_sku text default null, p_name text default null, p_alias_norm text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare p record; v_alias uuid; v_log uuid; v_action text;
begin
  perform require_cost_editor();
  select * into p from products where id = p_id;
  if not found then raise exception 'Картку не знайдено'; end if;
  if p_name is not null then
    if trim(p_name) = '' then raise exception 'Назва не може бути порожньою'; end if;
    if exists (select 1 from products x where x.id <> p_id and lower(trim(x.name)) = lower(trim(p_name))) then
      raise exception 'NAME_TAKEN: картка з назвою «%» уже є — щоб об''єднати, використайте «Перенести на картку»', trim(p_name);
    end if;
    update products set name = trim(p_name) where id = p_id;
    -- стара назва → синонім (імпорт документів і далі знаходить картку)
    if coalesce(p_alias_norm, '') <> '' and to_regclass('public.product_aliases') is not null then
      execute 'insert into product_aliases (product_id, alias, normalized) values ($1, $2, $3)
               on conflict (normalized) do nothing returning id' into v_alias using p_id, p.name, p_alias_norm;
    end if;
    v_action := 'product_rename';
    insert into cost_action_log (action, document_id, line, before, after)
    values (v_action, null, p_id::text, jsonb_build_object('name', p.name), jsonb_build_object('name', trim(p_name), 'alias_id', v_alias))
    returning id into v_log;
  elsif p_sku is not null then
    update products set sku = nullif(trim(p_sku), '') where id = p_id;
    v_action := 'product_sku';
    insert into cost_action_log (action, document_id, line, before, after)
    values (v_action, null, p_id::text, jsonb_build_object('sku', p.sku), jsonb_build_object('sku', nullif(trim(p_sku), '')))
    returning id into v_log;
  else
    raise exception 'Немає змін';
  end if;
  return jsonb_build_object('log_id', v_log, 'action', v_action, 'alias_id', v_alias);
end $$;

-- ── 2. Частина кількості руху → інша / нова картка ──
create or replace function split_movement(p_mov uuid, p_qty numeric, p_target uuid default null,
                                          p_new_name text default null, p_new_sku text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare m record; v_unit text; v_new uuid := gen_random_uuid(); v_alloc jsonb; v_inner jsonb; v_log uuid; v_row jsonb;
begin
  perform require_cost_editor();
  select * into m from stock_movements where id = p_mov;
  if not found then raise exception 'Рух не знайдено'; end if;
  if m.source = 'assembly' then raise exception 'Рух збірки змінюється на аркуші «Збірки»'; end if;
  if coalesce(p_qty, 0) <= 0 or p_qty >= coalesce(m.quantity, 0) then
    raise exception 'Кількість до перенесення має бути більшою за 0 і меншою за % (для всього руху залиште її порожньою)', m.quantity;
  end if;
  select unit into v_unit from products where id = m.product_id;
  if coalesce(lower(v_unit), 'шт') ~ '^(шт|од|компл|комплект|пар)' and p_qty <> trunc(p_qty) then
    raise exception 'Для одиниці «%» кількість має бути цілою', coalesce(v_unit, 'шт');
  end if;
  perform fix_check_movs(array[p_mov]);

  -- розподіл по партіях цього руху: після поділу він уже не відповідає кількостям
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_alloc from stock_allocations a
   where a.out_movement_id = p_mov or a.in_movement_id = p_mov;
  delete from stock_allocations a where a.out_movement_id = p_mov or a.in_movement_id = p_mov;

  perform set_config('aim.skip_alloc', 'on', true);
  -- копія з тим самим документом, датою, рядком документа й ціною; позиція документа лишається за оригіналом
  v_row := to_jsonb(m) || jsonb_build_object('id', v_new, 'quantity', p_qty, 'transaction_item_id', null);
  if (v_row ->> 'total') is not null and coalesce(m.quantity, 0) <> 0 then
    v_row := v_row || jsonb_build_object('total', round((v_row ->> 'total')::numeric * p_qty / m.quantity, 2));
  end if;
  insert into stock_movements select (jsonb_populate_record(null::stock_movements, v_row)).*;
  update stock_movements set quantity = m.quantity - p_qty where id = p_mov;
  if (to_jsonb(m) ->> 'total') is not null and coalesce(m.quantity, 0) <> 0 then
    execute 'update stock_movements set total = round($1 * $2 / $3, 2) where id = $4'
      using (to_jsonb(m) ->> 'total')::numeric, m.quantity - p_qty, m.quantity, p_mov;
  end if;
  perform set_config('aim.skip_alloc', 'off', true);

  v_inner := split_product(m.product_id, array[v_new], p_target, p_new_name, p_new_sku, null);

  insert into cost_action_log (action, document_id, line, before, after)
  values ('split_qty', m.document_id, m.product_id::text,
          jsonb_build_object('mov', p_mov, 'qty', m.quantity, 'total', to_jsonb(m) -> 'total', 'allocations', v_alloc),
          jsonb_build_object('new_mov', v_new, 'moved_qty', p_qty, 'split_log', v_inner ->> 'log_id', 'target', v_inner ->> 'target'))
  returning id into v_log;
  return v_inner || jsonb_build_object('log_id', v_log, 'new_mov', v_new);
end $$;

-- ── 3. Документ: дата / номер / порядок у дні ──
-- p_date: null — без змін (якщо p_align — рухи вирівнюються до дати документа); p_number: null — без змін;
-- p_order: null — без змін, p_clear_order — прибрати порядок.
create or replace function doc_fix(p_doc uuid, p_date date default null, p_number text default null,
                                   p_order integer default null, p_clear_order boolean default false, p_align boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare d record; v_new_date date; v_movs jsonb; v_log uuid; v_moved integer := 0;
begin
  perform require_cost_editor();
  select * into d from documents where id = p_doc;
  if not found then raise exception 'Документ не знайдено'; end if;
  v_new_date := coalesce(p_date, d.doc_date);
  if period_is_closed(d.company_id, d.doc_date) or period_is_closed(d.company_id, v_new_date)
     or exists (select 1 from stock_movements m where m.document_id = p_doc and period_is_closed(m.company_id, m.date)) then
    raise exception 'PERIOD_CLOSED: закритий період';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'date', m.date)), '[]'::jsonb) into v_movs
    from stock_movements m where m.document_id = p_doc and m.source is distinct from 'assembly';

  update documents
     set doc_date = v_new_date,
         doc_number = case when coalesce(trim(p_number), '') <> '' then trim(p_number) else doc_number end,
         day_order = case when p_clear_order then null else coalesce(p_order, day_order) end
   where id = p_doc;
  -- дата документа → усі його рухи (видаток і прихід), без перезапуску розподілу
  if v_new_date is not null and (p_date is not null or p_align) then
    perform set_config('aim.skip_alloc', 'on', true);
    update stock_movements set date = v_new_date
     where document_id = p_doc and source is distinct from 'assembly' and date is distinct from v_new_date;
    get diagnostics v_moved = row_count;
    perform set_config('aim.skip_alloc', 'off', true);
  end if;

  insert into cost_action_log (action, document_id, line, before, after)
  values ('doc_fix', p_doc, d.doc_number,
          jsonb_build_object('doc_date', d.doc_date, 'doc_number', d.doc_number, 'day_order', d.day_order, 'movements', v_movs),
          jsonb_build_object('doc_date', v_new_date,
                             'doc_number', case when coalesce(trim(p_number), '') <> '' then trim(p_number) else d.doc_number end,
                             'day_order', case when p_clear_order then null else coalesce(p_order, d.day_order) end,
                             'movements_redated', v_moved))
  returning id into v_log;
  return jsonb_build_object('log_id', v_log, 'movements_redated', v_moved);
end $$;

-- ── 4. Збірка ──
-- p_items: повний новий склад компонентів [{ "item_id": uuid|null, "product_id": uuid, "qty": число }] (к-сть — на всю збірку).
-- p_manual_mode: 'keep' — не змінювати, 'auto' — сума компонентів, 'set' — p_manual (на одиницю виробу).
create or replace function assembly_fix(p_asm uuid, p_date date default null, p_qty numeric default null,
                                        p_items jsonb default null, p_manual_mode text default 'keep', p_manual numeric default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  a record; v_in record; v_date date; v_qty numeric; v_before jsonb; v_log uuid; it record; v_out uuid;
  v_total numeric; v_unit numeric; v_manual numeric; v_old_unit numeric;
begin
  perform require_cost_editor();
  select * into a from assemblies where id = p_asm;
  if not found then raise exception 'Збірку не знайдено'; end if;
  select * into v_in from stock_movements where assembly_id = p_asm and type = 'in' and source = 'assembly' order by created_at limit 1;
  if not found then raise exception 'Стара збірка без складських рухів — змініть її в програмі (Склад → Збірки)'; end if;
  v_date := coalesce(p_date, a.assembled_at, v_in.date);
  v_qty := coalesce(p_qty, a.quantity);
  if coalesce(v_qty, 0) <= 0 then raise exception 'Кількість виробу має бути більшою за 0'; end if;
  if period_is_closed(a.company_id, coalesce(a.assembled_at, v_in.date)) or period_is_closed(a.company_id, v_date)
     or exists (select 1 from stock_movements m where m.assembly_id = p_asm and period_is_closed(m.company_id, m.date)) then
    raise exception 'PERIOD_CLOSED: закритий період';
  end if;
  if p_items is not null and exists (select 1 from jsonb_to_recordset(p_items) x(item_id uuid, product_id uuid, qty numeric)
                                      where x.qty is null or x.qty < 0 or x.product_id is null
                                         or not exists (select 1 from products p where p.id = x.product_id)) then
    raise exception 'Компонент: невідома картка або від''ємна кількість';
  end if;
  if p_manual_mode = 'set' and coalesce(p_manual, 0) <= 0 then raise exception 'Ручна собівартість має бути більшою за 0'; end if;

  v_old_unit := case when coalesce(v_in.quantity, 0) <> 0 then coalesce(nullif(v_in.cost_price, 0), v_in.price) end;
  v_before := jsonb_build_object(
    'assembly', to_jsonb(a),
    'items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from assembly_items i where i.assembly_id = p_asm),
    'movements', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from stock_movements m where m.assembly_id = p_asm),
    'allocations', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from stock_allocations s
                     where s.out_movement_id in (select m.id from stock_movements m where m.assembly_id = p_asm)
                        or s.in_movement_id in (select m.id from stock_movements m where m.assembly_id = p_asm)));

  perform set_config('aim.skip_alloc', 'on', true);
  if p_items is not null then
    delete from stock_movements where assembly_id = p_asm and type = 'out' and source = 'assembly';
    delete from assembly_items i where i.assembly_id = p_asm
       and not exists (select 1 from jsonb_to_recordset(p_items) x(item_id uuid, product_id uuid, qty numeric)
                        where x.item_id = i.id and x.qty > 0);
    update assembly_items i set quantity = x.qty, product_id = x.product_id
      from jsonb_to_recordset(p_items) x(item_id uuid, product_id uuid, qty numeric)
     where i.assembly_id = p_asm and i.id = x.item_id and x.qty > 0;
    insert into assembly_items (assembly_id, product_id, quantity, cost_price, total)
    select p_asm, x.product_id, x.qty, 0, 0
      from jsonb_to_recordset(p_items) x(item_id uuid, product_id uuid, qty numeric)
     where x.item_id is null and x.qty > 0;
    -- списання компонентів заново (дата збірки)
    for it in select i.id, i.product_id, i.quantity from assembly_items i where i.assembly_id = p_asm loop
      insert into stock_movements (company_id, product_id, type, quantity, price, cost_price, date, source, assembly_id, description)
      values (a.company_id, it.product_id, 'out', it.quantity, 0, 0, v_date, 'assembly', p_asm, left('Збірка: ' || coalesce(a.name, ''), 200));
    end loop;
  else
    update stock_movements set date = v_date where assembly_id = p_asm and type = 'out' and source = 'assembly' and date is distinct from v_date;
  end if;
  update stock_movements set date = v_date, quantity = v_qty where id = v_in.id;
  update stock_movements set date = v_date where assembly_id = p_asm and type = 'in' and id <> v_in.id and date is distinct from v_date;
  perform set_config('aim.skip_alloc', 'off', true);

  -- собівартість компонентів за FIFO (на дату збірки), потім виробу
  for v_out in select m.id from stock_movements m where m.assembly_id = p_asm and m.type = 'out' order by m.created_at, m.id loop
    perform allocate_out(v_out, true);
  end loop;
  select coalesce(sum(m.quantity * coalesce(m.cost_price, 0)), 0) into v_total
    from stock_movements m where m.assembly_id = p_asm and m.type = 'out';
  v_manual := case p_manual_mode when 'set' then p_manual when 'auto' then null else a.manual_unit_cost end;
  v_unit := coalesce(v_manual, round(v_total / v_qty, 4));
  update stock_movements set price = v_unit, cost_price = v_unit where id = v_in.id;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'total') then
    execute 'update stock_movements set total = round($1 * $2, 2) where id = $3' using v_unit, v_qty, v_in.id;
  end if;
  update assemblies set assembled_at = v_date, quantity = v_qty, total_cost = round(v_unit * v_qty, 2), manual_unit_cost = v_manual
   where id = p_asm;
  update assembly_items i
     set cost_price = coalesce((select m.cost_price from stock_movements m
                                 where m.assembly_id = p_asm and m.type = 'out' and m.product_id = i.product_id order by m.created_at limit 1), 0),
         total = round(i.quantity * coalesce((select m.cost_price from stock_movements m
                                 where m.assembly_id = p_asm and m.type = 'out' and m.product_id = i.product_id order by m.created_at limit 1), 0), 2)
   where i.assembly_id = p_asm;

  insert into cost_action_log (action, document_id, line, before, after)
  values ('assembly_fix', null, a.result_product_id::text, v_before,
          jsonb_build_object('date', v_date, 'qty', v_qty, 'unit_cost', v_unit, 'components_cost', v_total, 'manual_unit_cost', v_manual,
                             'old_unit', v_old_unit))
  returning id into v_log;
  return jsonb_build_object('log_id', v_log, 'old_unit', v_old_unit, 'unit_cost', v_unit, 'components_cost', v_total,
                            'missing', (select coalesce(sum(m.cost_missing_qty), 0) from stock_movements m where m.assembly_id = p_asm and m.type = 'out'));
end $$;

-- ── 5. Синоніми: видалення ──
create or replace function alias_delete(p_ids uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_rows jsonb; v_log uuid; v_bad text;
begin
  perform require_cost_editor();
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Немає синонімів для видалення'; end if;
  -- не прибирати останній синонім, що збігається з назвою картки
  select p.name into v_bad from products p
   where exists (select 1 from product_aliases a where a.product_id = p.id and a.id = any (p_ids) and lower(trim(a.alias)) = lower(trim(p.name)))
     and not exists (select 1 from product_aliases a where a.product_id = p.id and not (a.id = any (p_ids)) and lower(trim(a.alias)) = lower(trim(p.name)))
   limit 1;
  if v_bad is not null then raise exception 'Не можна видалити останній синонім, що збігається з назвою картки «%»', v_bad; end if;
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_rows from product_aliases a where a.id = any (p_ids);
  delete from product_aliases a where a.id = any (p_ids);
  insert into cost_action_log (action, document_id, line, before, after)
  values ('alias_delete', null, (select string_agg(distinct x ->> 'product_id', ',') from jsonb_array_elements(v_rows) x), jsonb_build_object('aliases', v_rows), '{}'::jsonb)
  returning id into v_log;
  return jsonb_build_object('log_id', v_log, 'deleted', jsonb_array_length(v_rows));
end $$;

-- ── Скасування будь-якого виправлення (крім 'split' — для нього split_undo) ──
create or replace function stock_fix_undo(p_log uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare g record; b jsonb; f jsonb; v_asm uuid;
begin
  perform require_cost_editor();
  select * into g from cost_action_log where id = p_log;
  if not found then raise exception 'Запис журналу не знайдено'; end if;
  if g.action = 'split' then return split_undo(p_log); end if;
  if exists (select 1 from cost_action_log where action = 'fix_undo' and (before ->> 'log') = p_log::text) then
    raise exception 'Цю зміну вже скасовано';
  end if;
  b := g.before; f := g.after;

  if g.action = 'product_sku' then
    update products set sku = b ->> 'sku' where id = g.line::uuid;
  elsif g.action = 'product_rename' then
    if exists (select 1 from products x where x.id <> g.line::uuid and lower(trim(x.name)) = lower(trim(b ->> 'name'))) then
      raise exception 'Стара назва вже зайнята іншою карткою';
    end if;
    update products set name = b ->> 'name' where id = g.line::uuid;
    if (f ->> 'alias_id') is not null then delete from product_aliases where id = (f ->> 'alias_id')::uuid; end if;
  elsif g.action = 'doc_fix' then
    if exists (select 1 from documents d where d.id = g.document_id
                and (period_is_closed(d.company_id, d.doc_date) or period_is_closed(d.company_id, (b ->> 'doc_date')::date))) then
      raise exception 'PERIOD_CLOSED: закритий період';
    end if;
    update documents set doc_date = (b ->> 'doc_date')::date, doc_number = b ->> 'doc_number', day_order = (b ->> 'day_order')::integer
     where id = g.document_id;
    perform set_config('aim.skip_alloc', 'on', true);
    update stock_movements m set date = (x ->> 'date')::date
      from jsonb_array_elements(b -> 'movements') x
     where m.id = (x ->> 'id')::uuid and m.date is distinct from (x ->> 'date')::date;
    perform set_config('aim.skip_alloc', 'off', true);
  elsif g.action = 'split_qty' then
    perform split_undo((f ->> 'split_log')::uuid);
    perform fix_check_movs(array[(b ->> 'mov')::uuid]);
    perform set_config('aim.skip_alloc', 'on', true);
    delete from stock_movements where id = (f ->> 'new_mov')::uuid;
    update stock_movements set quantity = (b ->> 'qty')::numeric where id = (b ->> 'mov')::uuid;
    if (b ->> 'total') is not null then
      execute 'update stock_movements set total = $1 where id = $2' using (b ->> 'total')::numeric, (b ->> 'mov')::uuid;
    end if;
    perform set_config('aim.skip_alloc', 'off', true);
    insert into stock_allocations
    select r.* from jsonb_populate_recordset(null::stock_allocations, b -> 'allocations') r
     where exists (select 1 from stock_movements m where m.id = r.out_movement_id)
       and exists (select 1 from stock_movements m where m.id = r.in_movement_id)
       and not exists (select 1 from stock_allocations x where x.id = r.id);
  elsif g.action = 'assembly_fix' then
    v_asm := (b -> 'assembly' ->> 'id')::uuid;
    if exists (select 1 from stock_movements m where m.assembly_id = v_asm and period_is_closed(m.company_id, m.date))
       or exists (select 1 from jsonb_array_elements(b -> 'movements') x where period_is_closed((x ->> 'company_id')::uuid, (x ->> 'date')::date)) then
      raise exception 'PERIOD_CLOSED: закритий період';
    end if;
    perform set_config('aim.skip_alloc', 'on', true);
    delete from stock_movements where assembly_id = v_asm and type = 'out' and source = 'assembly';
    delete from assembly_items where assembly_id = v_asm;
    insert into assembly_items select r.* from jsonb_populate_recordset(null::assembly_items, b -> 'items') r;
    insert into stock_movements select r.* from jsonb_populate_recordset(null::stock_movements, b -> 'movements') r
     where not exists (select 1 from stock_movements x where x.id = r.id);
    update stock_movements m set date = r.date, quantity = r.quantity, price = r.price, cost_price = r.cost_price,
                                 cost_missing_qty = r.cost_missing_qty
      from jsonb_populate_recordset(null::stock_movements, b -> 'movements') r
     where m.id = r.id;
    perform set_config('aim.skip_alloc', 'off', true);
    update assemblies a set assembled_at = r.assembled_at, quantity = r.quantity, total_cost = r.total_cost, manual_unit_cost = r.manual_unit_cost
      from jsonb_populate_record(null::assemblies, b -> 'assembly') r
     where a.id = v_asm;
    delete from stock_allocations s
     where s.out_movement_id in (select m.id from stock_movements m where m.assembly_id = v_asm and m.type = 'out');
    insert into stock_allocations
    select r.* from jsonb_populate_recordset(null::stock_allocations, b -> 'allocations') r
     where exists (select 1 from stock_movements m where m.id = r.out_movement_id)
       and exists (select 1 from stock_movements m where m.id = r.in_movement_id)
       and not exists (select 1 from stock_allocations x where x.id = r.id);
  elsif g.action = 'alias_delete' then
    insert into product_aliases select r.* from jsonb_populate_recordset(null::product_aliases, b -> 'aliases') r
      on conflict do nothing;
  else
    raise exception 'Цей запис журналу не скасовується тут (%)', g.action;
  end if;

  insert into cost_action_log (action, document_id, line, before, after)
  values ('fix_undo', g.document_id, g.line, jsonb_build_object('log', p_log, 'action', g.action), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['fix_check_movs(uuid[])', 'product_fix(uuid, text, text, text)', 'split_movement(uuid, numeric, uuid, text, text)',
                           'doc_fix(uuid, date, text, integer, boolean, boolean)', 'assembly_fix(uuid, date, numeric, jsonb, text, numeric)',
                           'alias_delete(uuid[])', 'stock_fix_undo(uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function allocate_out(uuid, boolean) from public, anon;
revoke execute on function fifo_compute(date, jsonb) from public, anon;

commit;

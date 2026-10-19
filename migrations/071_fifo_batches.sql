-- 071: собівартість відвантажень за ПАРТІЯМИ (FIFO), зафіксована в момент відвантаження.
--   Партія = прихідний рух складу (товар, дата, к-сть, ціна без ПДВ). Залишок партії = к-сть − списане з неї.
--   stock_allocations — яке відвантаження скільки взяло з якої партії й за якою ціною.
--   Порядок для відвантаження: (а) партії прихідних ТОГО Ж замовлення → (б) FIFO: найстаріші партії з залишком,
--   датовані не пізніше відвантаження → (в) чого не вистачило — cost_missing_qty (у «Немає собівартості»),
--   ціну з довідника НЕ підставляємо. Партія без ціни теж рахується як «без собівартості».
--   Собівартість (cost_price) зберігається в русі й НЕ перераховується при нових приходах — лише
--   recalc_cost_period() (кнопка «Перерахувати собівартість за період») або одноразова fifo_rebuild().
--   Ціна в довіднику (products.buy_price) = остання закупівельна — лише для довідки й підказок.
begin;

create table if not exists stock_allocations (
  id uuid default gen_random_uuid() primary key,
  out_movement_id uuid not null references stock_movements(id) on delete cascade,
  in_movement_id  uuid not null references stock_movements(id) on delete cascade,
  qty numeric not null,
  unit_cost numeric not null default 0,   -- ціна партії без ПДВ
  out_date date,                          -- дата відвантаження (для залишків партій на дату)
  company_id uuid,
  created_at timestamptz default now()
);
create index if not exists idx_stock_alloc_out on stock_allocations (out_movement_id);
create index if not exists idx_stock_alloc_in  on stock_allocations (in_movement_id);
alter table stock_allocations enable row level security;
drop policy if exists stock_allocations_all on stock_allocations;
create policy stock_allocations_all on stock_allocations for all to authenticated using (true) with check (true);

alter table stock_movements add column if not exists cost_missing_qty numeric default 0; -- к-сть без собівартості
alter table stock_movements add column if not exists cost_stale boolean default false;   -- партію видалено → перерахувати

-- ── Розподіл одного відвантаження по партіях ──
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
    select m.id,
           coalesce(nullif(m.cost_price, 0), m.price, 0) as unit,
           m.quantity - coalesce((select sum(a.qty) from stock_allocations a where a.in_movement_id = m.id), 0) as remaining
      from stock_movements m left join documents d on d.id = m.document_id
     where m.type = 'in' and m.product_id = o.product_id and m.company_id = o.company_id
       and ((v_order is not null and coalesce(m.order_id, d.order_id) = v_order) or m.date <= o.date)
     order by case when v_order is not null and coalesce(m.order_id, d.order_id) = v_order then 0 else 1 end,
              m.date, m.created_at, m.id
     for update of m
  loop
    exit when v_need <= 0.00001;
    continue when b.remaining <= 0.00001;
    v_take := least(b.remaining, v_need);
    insert into stock_allocations (out_movement_id, in_movement_id, qty, unit_cost, out_date, company_id)
    values (p_out, b.id, v_take, b.unit, o.date, o.company_id);
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

-- ── Тригери ──
-- нове відвантаження (або зміна к-сті/товару/дати) → розподіл по партіях і фіксація собівартості
create or replace function trg_stock_alloc() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  perform allocate_out(new.id, new.type = 'out');
  return null;
end $$;
drop trigger if exists trg_stock_alloc_ins on stock_movements;
create trigger trg_stock_alloc_ins after insert on stock_movements for each row execute function trg_stock_alloc();
drop trigger if exists trg_stock_alloc_upd on stock_movements;
create trigger trg_stock_alloc_upd after update of quantity, product_id, date, type on stock_movements for each row execute function trg_stock_alloc();

-- видалення партії → відвантаження, що з неї списували, позначаються «перерахувати» (собівартість лишається)
create or replace function trg_stock_in_delete() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if old.type = 'in' then
    update stock_movements s set cost_stale = true
     where s.id in (select out_movement_id from stock_allocations where in_movement_id = old.id)
       and not period_is_closed(s.company_id, s.date);
  end if;
  return old;
end $$;
drop trigger if exists trg_stock_in_delete on stock_movements;
create trigger trg_stock_in_delete before delete on stock_movements for each row execute function trg_stock_in_delete();

-- ціна в довіднику = остання закупівельна (найсвіжіший прихід з ціною)
create or replace function trg_stock_last_price() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v numeric;
begin
  if new.type = 'in' then
    v := coalesce(nullif(new.cost_price, 0), new.price, 0);
    if v > 0 and not exists (
      select 1 from stock_movements m
       where m.product_id = new.product_id and m.type = 'in' and m.id <> new.id
         and coalesce(nullif(m.cost_price, 0), m.price, 0) > 0
         and (m.date > new.date or (m.date = new.date and m.created_at > new.created_at))
    ) then
      update products set buy_price = v where id = new.product_id and buy_price is distinct from v;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_stock_last_price on stock_movements;
create trigger trg_stock_last_price after insert or update of price, cost_price, date on stock_movements for each row execute function trg_stock_last_price();

-- ── Перерахунок собівартості за період (кнопка) ──
-- Перерозподіляє відвантаження періоду; списання поза періодом не чіпає (партії, вже взяті ними, недоступні).
create or replace function recalc_cost_period(p_company uuid, p_from date, p_to date)
returns integer
language plpgsql security invoker set search_path = public as $$
declare r record; n integer := 0;
begin
  if exists (
    select 1 from period_closings pc
     where pc.company_id = p_company and pc.status = 'closed'
       and make_date(pc.period_year, pc.period_month, 1) between date_trunc('month', p_from)::date and p_to
  ) then
    raise exception 'PERIOD_CLOSED: у вибраному періоді є закриті місяці. Переоткрийте їх у «Закритті періоду», щоб перерахувати собівартість.';
  end if;
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
grant execute on function recalc_cost_period(uuid, date, date) to authenticated;

-- ── Одноразова перебудова: партії з усіх приходів, FIFO для ВСІХ відвантажень (у хронології) ──
-- Собівартість переписується лише для відвантажень з датою >= p_cost_from і не в закритих місяцях
-- (раніші лише «споживають» партії). p_apply = false — СУХИЙ ПРОГІН: усе рахується, повертається
-- порівняння «зараз → за FIFO», а потім усі зміни відкочуються.
create or replace function fifo_rebuild(p_cost_from date, p_apply boolean default false)
returns table (out_id uuid, out_date date, company_id uuid, order_id uuid, document_id uuid, product_id uuid,
               qty numeric, old_unit numeric, new_unit numeric, missing_qty numeric, skipped_closed boolean)
language plpgsql security invoker set search_path = public as $$
declare
  r record;
  v_res jsonb := '[]'::jsonb;
  v_upd boolean;
  v_new numeric;
  v_alloc numeric;
  v_nocost numeric;
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
        select coalesce(sum(a.qty * a.unit_cost), 0), coalesce(sum(a.qty), 0), coalesce(sum(case when a.unit_cost > 0 then 0 else a.qty end), 0)
          into v_new, v_alloc, v_nocost
          from stock_allocations a where a.out_movement_id = r.id;
        v_res := v_res || jsonb_build_object(
          'out_id', r.id, 'out_date', r.date, 'company_id', r.company_id, 'order_id', r.order_id,
          'document_id', r.document_id, 'product_id', r.product_id, 'qty', r.quantity,
          'old_unit', r.cost_price,
          'new_unit', case when r.quantity > 0 then round(v_new / r.quantity, 4) else 0 end,
          'missing_qty', round(greatest(r.quantity - v_alloc, 0) + v_nocost, 4),
          'skipped_closed', not v_upd);
      end if;
    end loop;

    if p_apply then
      -- ціна в довіднику = остання закупівельна
      update products p set buy_price = x.unit
        from (
          select distinct on (m.product_id) m.product_id, coalesce(nullif(m.cost_price, 0), m.price) as unit
            from stock_movements m
           where m.type = 'in' and coalesce(nullif(m.cost_price, 0), m.price, 0) > 0
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
           x.qty, x.old_unit, x.new_unit, x.missing_qty, x.skipped_closed
      from jsonb_to_recordset(v_res) as x(out_id uuid, out_date date, company_id uuid, order_id uuid, document_id uuid,
                                          product_id uuid, qty numeric, old_unit numeric, new_unit numeric,
                                          missing_qty numeric, skipped_closed boolean);
end $$;
grant execute on function fifo_rebuild(date, boolean) to authenticated;

commit;

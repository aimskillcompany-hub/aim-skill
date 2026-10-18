-- 067: «Прогноз» будується із замовлень (план − факт), без ручного дублювання.
-- 1) order_items.cost_vat_rate — окрема ставка ПДВ ЗАКУПІВЛІ позиції (напр. 0 для постачальника-ФОП).
--    null → як ставка продажу (vat_rate), тобто для наявних позицій нічого не змінюється.
-- 2) order_payment_plan — «Графік платежів» замовлення: планові дати
--    kind: 'ship' (відвантаження) | 'client' (оплата від клієнта) | 'supplier' (оплата постачальнику, supplier_id)
--    days — для 'client': оплата через N днів після відвантаження (якщо дата не задана).
-- 3) Старі ручні рядки прогнозу по замовленнях видаляються (рішення власника 2026-10-18):
--    тепер їх генерує саме замовлення. Ручними лишаються лише витрати БЕЗ замовлення (order_id is null).
begin;

alter table order_items add column if not exists cost_vat_rate numeric(5,2);

create table if not exists order_payment_plan (
  id uuid default gen_random_uuid() primary key,
  order_id uuid not null references orders(id) on delete cascade,
  kind text not null,
  supplier_id uuid references contractors(id) on delete cascade,
  plan_date date,
  days integer,
  created_at timestamptz default now()
);
create index if not exists idx_order_payment_plan_order on order_payment_plan (order_id);

alter table order_payment_plan enable row level security;
drop policy if exists order_payment_plan_all on order_payment_plan;
create policy order_payment_plan_all on order_payment_plan for all to authenticated using (true) with check (true);

delete from forecast_items where order_id is not null;

commit;

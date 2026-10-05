-- 061: ручний прогноз грошових потоків по замовленнях (для інвестора).
-- orders.in_forecast — відмітка «додати в прогноз» (як in_investor).
-- forecast_items — прогнозні надходження/витрати по замовленню: сума + очікувана дата.

alter table orders add column if not exists in_forecast boolean default false;

create table if not exists forecast_items (
  id uuid default gen_random_uuid() primary key,
  company_id uuid not null default '00000000-0000-0000-0000-000000000001' references companies(id),
  order_id uuid references orders(id) on delete cascade,
  kind text not null,                 -- 'income' (надходження) | 'expense' (витрата)
  amount numeric not null default 0,
  expected_date date,                 -- прогнозована дата
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_forecast_items_company on forecast_items (company_id);
create index if not exists idx_forecast_items_order on forecast_items (order_id);

alter table forecast_items enable row level security;
drop policy if exists forecast_items_all on forecast_items;
create policy forecast_items_all on forecast_items for all to authenticated using (true) with check (true);

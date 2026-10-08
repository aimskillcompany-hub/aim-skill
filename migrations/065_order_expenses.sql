-- 065: інші витрати замовлення (планові/відомі витрати понад собівартість товарів:
-- доставка, монтаж, комісії, пакування тощо). Для розрахунку чистого прибутку замовлення.
create table if not exists order_expenses (
  id uuid default gen_random_uuid() primary key,
  order_id uuid not null references orders(id) on delete cascade,
  name text,
  amount numeric not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_order_expenses_order on order_expenses (order_id);
alter table order_expenses enable row level security;
drop policy if exists order_expenses_all on order_expenses;
create policy order_expenses_all on order_expenses for all to authenticated using (true) with check (true);

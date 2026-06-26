-- 010: прайс-листи постачальників (довідковий шар, ОКРЕМО від складу).
-- Товари на склад потрапляють лише по прихідних накладних; ці таблиці
-- нічого не змінюють у stock_movements/products — лише джерело цін для пошуку.
begin;

-- Імпорт прайсу (один актуальний на постачальника; column_map — збережений мапінг колонок)
create table if not exists supplier_price_lists (
  id uuid default gen_random_uuid() primary key,
  supplier_id uuid references contractors(id) on delete cascade not null,
  file_name text,
  rows_count integer default 0,
  column_map jsonb,
  imported_by uuid references profiles(id) on delete set null,
  imported_at timestamptz default now()
);

-- Рядки прайсу. price = закупівля (для порівняння), retail_price = роздріб/продаж
-- (підставляється в замовлення, але редагується). Обидві опційні.
create table if not exists supplier_prices (
  id uuid default gen_random_uuid() primary key,
  price_list_id uuid references supplier_price_lists(id) on delete cascade not null,
  supplier_id uuid references contractors(id) on delete cascade not null,
  sku text,
  name text not null,
  brand text,
  category text,
  unit text,
  price numeric(15,2),
  retail_price numeric(15,2),
  in_stock text,
  created_at timestamptz default now()
);

create index if not exists idx_splists_supplier on supplier_price_lists(supplier_id);
create index if not exists idx_sprices_supplier on supplier_prices(supplier_id);
create index if not exists idx_sprices_sku on supplier_prices(sku);
create index if not exists idx_sprices_name on supplier_prices(name);

-- RLS: authenticated повний доступ (як решта таблиць)
alter table supplier_price_lists enable row level security;
alter table supplier_prices enable row level security;
drop policy if exists "auth_all_select" on supplier_price_lists;
drop policy if exists "auth_all_insert" on supplier_price_lists;
drop policy if exists "auth_all_update" on supplier_price_lists;
drop policy if exists "auth_all_delete" on supplier_price_lists;
create policy "auth_all_select" on supplier_price_lists for select to authenticated using (true);
create policy "auth_all_insert" on supplier_price_lists for insert to authenticated with check (true);
create policy "auth_all_update" on supplier_price_lists for update to authenticated using (true) with check (true);
create policy "auth_all_delete" on supplier_price_lists for delete to authenticated using (true);
drop policy if exists "auth_all_select" on supplier_prices;
drop policy if exists "auth_all_insert" on supplier_prices;
drop policy if exists "auth_all_update" on supplier_prices;
drop policy if exists "auth_all_delete" on supplier_prices;
create policy "auth_all_select" on supplier_prices for select to authenticated using (true);
create policy "auth_all_insert" on supplier_prices for insert to authenticated with check (true);
create policy "auth_all_update" on supplier_prices for update to authenticated using (true) with check (true);
create policy "auth_all_delete" on supplier_prices for delete to authenticated using (true);

commit;

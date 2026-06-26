-- 009: позиції товарів замовлення (order_items)
-- Необов'язкові: менеджер додає товари до замовлення лише коли вони відомі.
-- product_id прив'язує до довідника (переюз у КП/документах/складі); name —
-- знімок назви, стійкий навіть якщо товар згодом видалили.
begin;

create table if not exists order_items (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade not null,
  product_id uuid references products(id) on delete set null,
  name text not null,
  unit text default 'шт',
  qty numeric(15,4) not null default 1,
  unit_price numeric(15,2) default 0,
  total numeric(15,2) default 0,
  created_at timestamptz default now()
);

create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_order_items_product on order_items(product_id);

-- RLS: authenticated повний доступ (як решта таблиць замовлень)
alter table order_items enable row level security;
drop policy if exists "auth_all_select" on order_items;
drop policy if exists "auth_all_insert" on order_items;
drop policy if exists "auth_all_update" on order_items;
drop policy if exists "auth_all_delete" on order_items;
create policy "auth_all_select" on order_items for select to authenticated using (true);
create policy "auth_all_insert" on order_items for insert to authenticated with check (true);
create policy "auth_all_update" on order_items for update to authenticated using (true) with check (true);
create policy "auth_all_delete" on order_items for delete to authenticated using (true);

commit;

-- 037_orders_manager.sql
-- Відповідальний менеджер у замовленні.

alter table orders add column if not exists manager_id uuid references profiles(id) on delete set null;
create index if not exists idx_orders_manager on orders (manager_id);

-- Щоб випадайки «Відповідальний менеджер» працювали для всіх ролей,
-- дозволяємо будь-якому авторизованому бачити список користувачів (id/ім'я/email/роль).
drop policy if exists profiles_select_all on profiles;
create policy profiles_select_all on profiles for select to authenticated using (true);

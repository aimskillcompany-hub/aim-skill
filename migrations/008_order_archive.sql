-- 008: архівування замовлень (м'яке приховування з реєстру, відновлюване)
-- archived_at = коли заархівовано; null = активне.
alter table orders add column if not exists archived_at timestamptz;
create index if not exists idx_orders_archived on orders(archived_at);

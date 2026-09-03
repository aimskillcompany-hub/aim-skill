-- 047: відмітка «врахувати в розрахунку інвестора» на замовленні.
-- Default false — у звіт «Інвестору» потрапляють лише позначені вручну (реальні/підтверджені).
alter table orders add column if not exists in_investor boolean not null default false;
create index if not exists idx_orders_in_investor on orders (in_investor) where in_investor;

-- 056: статус оплати замовлення клієнтом.
-- Пряма прив'язка замовлення до банківської оплати (одна оплата = повна сума замовлення).
-- Автопривязка: контрагент оплати (bank_transactions.contractor_id) = клієнт замовлення (orders.client_id)
-- і сума оплати ≈ orders.total (з ПДВ). Незалежна від orders.status (окремий «статус оплати»).

alter table orders
  add column if not exists paid_transaction_id uuid references bank_transactions(id) on delete set null;

create index if not exists orders_paid_transaction_idx on orders (paid_transaction_id);

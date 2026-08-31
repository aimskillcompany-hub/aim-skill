-- 040: договір замовлення — прив'язка конкретного замовлення до договору контрагента.
-- Раніше зв'язку не було: звіт по замовленнях підставляв «останній» договір клієнта всім.
alter table orders add column if not exists contract_id uuid references contractor_contracts(id) on delete set null;
create index if not exists idx_orders_contract on orders (contract_id);

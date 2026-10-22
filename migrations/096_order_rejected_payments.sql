-- 096: «Ця оплата не наша» — відкинуті оплати замовлення (2026-10-22).
-- Відв'язана вручну оплата записується в orders.rejected_payment_ids, і «Підтягнути оплати» її більше
-- не пропонує цьому замовленню. Лише додає колонку; права й наявні дані не змінюються.
alter table orders add column if not exists rejected_payment_ids uuid[] not null default '{}';

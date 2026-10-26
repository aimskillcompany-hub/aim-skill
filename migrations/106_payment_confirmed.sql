-- 106: «Прибутковість» v2 (ТЗ 05, 6.3): підтвердження «підозрілої» оплати клієнта.
-- Пункт «Перевірити оплату» показується, коли прив'язане надходження прийшло не від клієнта замовлення або з
-- призначенням «ПФД / позика / фін. допомога / повернення». Кнопка «Це оплата клієнта» ставить позначку —
-- і пункт більше не з'являється для цієї транзакції. Наявні дані не змінюються.
begin;
alter table order_transactions add column if not exists confirmed_at timestamptz;
alter table order_transactions add column if not exists confirmed_by uuid references profiles(id) on delete set null;
-- оплата, прив'язана як «оплачено клієнтом» (orders.paid_transaction_id), не має рядка order_transactions
alter table orders add column if not exists paid_confirmed_at timestamptz;
commit;

-- 052: помітки «передано клієнту на підпис» (рахунок / видаткова) на замовленні.
alter table orders add column if not exists invoice_to_sign boolean not null default false;
alter table orders add column if not exists waybill_to_sign boolean not null default false;

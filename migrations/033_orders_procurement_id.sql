-- 033_orders_procurement_id.sql
-- Замовлення: ідентифікатор закупівлі для тендерних заявок.
-- З'являється у вкладці «Деталі», коли Тип закупівлі = «Тендер»
-- (напр. номер оголошення Prozorro UA-2026-...).

alter table orders add column if not exists procurement_id text;

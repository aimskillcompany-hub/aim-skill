-- 058_orders_procurement_url.sql
-- Замовлення: посилання на закупівлю (URL оголошення, напр. Prozorro).
-- З'являється у вкладці «Деталі», коли Тип закупівлі = «Тендер».
-- Використовується у формі реєстрації вендора «Комел» (осередок B10).

alter table orders add column if not exists procurement_url text;

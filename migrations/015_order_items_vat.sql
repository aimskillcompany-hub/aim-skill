-- 015: ставка ПДВ на позиції замовлення. Конвенція: unit_price — ціна з ПДВ
-- (що платить клієнт), vat_rate — ставка %. Без ПДВ = gross / (1 + rate/100).
alter table order_items add column if not exists vat_rate numeric(5,2) default 0;

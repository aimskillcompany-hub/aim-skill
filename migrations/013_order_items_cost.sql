-- 013: ціна закупівлі в позиції замовлення (для розрахунку маржі).
alter table order_items add column if not exists cost_price numeric(15,2);

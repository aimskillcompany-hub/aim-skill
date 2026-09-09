-- 050: характеристики позиції замовлення (окремо від назви) — для КП/документів.
alter table order_items add column if not exists characteristics text;

-- 019: код товару (артикул) у позиціях замовлення та субзамовлення.
alter table order_items add column if not exists sku text;
alter table supplier_order_items add column if not exists sku text;

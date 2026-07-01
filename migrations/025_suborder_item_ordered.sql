-- 025: помітка «замовлено» на позиціях субзамовлення дистриб'ютору.
begin;

alter table supplier_order_items add column if not exists ordered boolean default false;

commit;

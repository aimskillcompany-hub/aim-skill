-- 066: виключення позиції із субзамовлення (галочка «У замовленні»).
-- excluded=true → позиція не йде в PDF «Замовлення постачальнику» і не рахується в сумі субзамовлення.
begin;

alter table supplier_order_items add column if not exists excluded boolean default false;

commit;

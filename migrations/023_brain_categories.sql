-- 023: обрані категорії Brain для синхронізації (тягнемо лише їх через /products).
-- categories = jsonb-масив categoryID (рядки), які користувач відмітив у UI.
begin;

alter table supplier_price_lists add column if not exists categories jsonb;

commit;

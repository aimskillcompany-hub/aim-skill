-- 014: автоматизація субзамовлень.
-- order_items.supplier_id — постачальник, з чийого прайсу обрано позицію
-- (для групування у субзамовлення). supplier_orders.source — 'manual'|'auto'
-- (авто-сформовані заміщуються при повторному формуванні). Рядки субзамовлення
-- отримують name/unit (знімок для відображення).
alter table order_items add column if not exists supplier_id uuid references contractors(id) on delete set null;
alter table supplier_orders add column if not exists source text default 'manual';
alter table supplier_order_items add column if not exists name text;
alter table supplier_order_items add column if not exists unit text;

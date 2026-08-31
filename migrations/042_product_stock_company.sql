-- 042: product_stock per-company (Фаза 1 інкремент 4).
-- Залишок рахується з stock_movements, які тепер скоуплені за company_id (041).
-- Групуємо залишок за (товар, компанія) і виводимо company_id у в'юху —
-- застосунок фільтрує .eq('company_id', активна).
--
-- DROP+CREATE (не CREATE OR REPLACE), бо products міг набути нових колонок після
-- створення в'юхи — тоді `select p.*` змінює набір/порядок колонок і REPLACE падає.
-- product_stock — leaf-в'юха (нічого від неї не залежить), тож drop безпечний.
drop view if exists product_stock;
create view product_stock as
select p.*,
  coalesce(s.stock, 0)    as computed_stock,
  coalesce(s.total_in, 0) as total_in,
  coalesce(s.total_out,0) as total_out,
  s.company_id
from products p
left join (
  select product_id, company_id,
    sum(case when type='in' then quantity when type='out' then -quantity
             when type='adjustment' then quantity else 0 end) as stock,
    sum(case when type='in' then quantity else 0 end) as total_in,
    sum(case when type='out' then quantity else 0 end) as total_out
  from stock_movements group by product_id, company_id
) s on s.product_id = p.id;

-- Доступ для PostgREST-ролей (drop зняв попередні грант(и)).
grant select on product_stock to anon, authenticated;

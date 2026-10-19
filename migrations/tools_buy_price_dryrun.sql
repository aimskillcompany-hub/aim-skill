-- DRY-RUN (лише читання): закупівельна ціна товару в довіднику (products.buy_price) vs середня зважена
-- ціна ПРИХОДІВ на склад (без ПДВ). Нічого не змінює.
-- Причина: resolveProduct() записував у buy_price ціну продажу (виправлено в коді 2026-10-19).
-- Секції: «зміна» — товари з приходами (стара → нова), «без приходів» — товари, яким нової ціни немає.
with ins as (
  select product_id,
         count(*)                                                        as receipts,
         sum(quantity)                                                   as qty,
         sum(quantity * coalesce(nullif(cost_price, 0), price))          as value
  from stock_movements
  where type = 'in' and quantity > 0 and coalesce(nullif(cost_price, 0), price) > 0
  group by product_id
)
select *
from (
  select 'зміна'::text                                 as section,
         p.name,
         p.sku,
         p.buy_price                                   as old_price,
         round(ins.value / ins.qty, 2)                 as new_price,
         ins.receipts,
         round(ins.value / ins.qty, 2) - coalesce(p.buy_price, 0) as diff
  from products p
  join ins on ins.product_id = p.id
  where coalesce(p.product_type, 'goods') = 'goods'
    and coalesce(p.buy_price, -1) <> round(ins.value / ins.qty, 2)
  union all
  select 'без приходів', p.name, p.sku, p.buy_price, null, 0, null
  from products p
  where coalesce(p.product_type, 'goods') = 'goods'
    and coalesce(p.status, 'active') <> 'archived'
    and not exists (select 1 from ins where ins.product_id = p.id)
) t
order by section desc, abs(coalesce(diff, 0)) desc, name;

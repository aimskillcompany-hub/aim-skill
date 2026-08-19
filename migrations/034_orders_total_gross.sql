-- 034_orders_total_gross.sql
-- Реєстр замовлень показує orders.total. Нова вкладка «Товари» пише total = сума
-- З ПДВ (gross), але стара «Деталі» раніше писала суму БЕЗ ПДВ для позицій із
-- price_includes_vat=false → частина замовлень мала net у сумі.
--
-- Цей backfill перераховує orders.total = сума з ПДВ з order_items (та сама формула,
-- що й у вкладці «Товари»: якщо ціна вже з ПДВ — беремо як є; інакше донараховуємо ПДВ).
-- Замовлення без позицій (послуги/агент з ручною сумою) не чіпаються.

update orders o set total = sub.gross
from (
  select order_id,
    round(sum(
      (case when price_includes_vat then coalesce(unit_price, 0)
            else coalesce(unit_price, 0) * (1 + coalesce(vat_rate, 0) / 100.0) end)
      * coalesce(qty, 0)
    )::numeric, 2) as gross
  from order_items
  group by order_id
) sub
where sub.order_id = o.id;

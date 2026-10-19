-- DRY-RUN FIFO (після міграції 071; нічого не змінює): собівартість відвантажень 2026 року
-- «зараз → за FIFO-партіями» по замовленнях. fifo_rebuild(..., false) рахує все і відкочує зміни.
select coalesce(o.order_number, '— без замовлення')                          as order_number,
       c.name                                                                as client,
       count(*)                                                              as shipments,
       round(sum(r.qty * coalesce(r.old_unit, 0)), 2)                        as cost_now,
       round(sum(r.qty * r.new_unit), 2)                                     as cost_fifo,
       round(sum(r.qty * r.new_unit) - sum(r.qty * coalesce(r.old_unit, 0)), 2) as diff,
       round(sum(r.missing_qty), 2)                                          as qty_without_cost,
       bool_or(r.skipped_closed)                                             as in_closed_month
from fifo_rebuild('2026-01-01', false) r
left join orders o on o.id = r.order_id
left join contractors c on c.id = o.client_id
group by o.order_number, c.name
order by abs(sum(r.qty * r.new_unit) - sum(r.qty * coalesce(r.old_unit, 0))) desc, o.order_number;

-- 032_orders_status_simplify.sql
-- Перехід на спрощений набір статусів замовлень (єдиний для всіх типів):
--   new · processing · ordering_supplier · shipped · paid · closed
--
-- Переназначає наявні замовлення зі старого набору на новий. Таблиця orders
-- НЕ під тригером закриття періоду, тож UPDATE проходить.
-- Код (lib/orders.js, api/bot.js, api/telegram.js) уже вміє показувати старі
-- статуси через легасі-мапу, але цей UPDATE прибирає легасі остаточно.

update orders set status = case status
  when 'proposal_sent'      then 'processing'
  when 'confirmed'          then 'processing'
  when 'contract_signed'    then 'processing'
  when 'invoiced'           then 'processing'
  when 'paid_partial'       then 'processing'
  when 'client_transferred' then 'processing'
  when 'deal_done'          then 'processing'
  when 'in_transit'         then 'ordering_supplier'
  when 'ready_to_ship'      then 'ordering_supplier'
  when 'docs_received'      then 'shipped'
  else status  -- new / ordering_supplier / shipped / paid / closed лишаються
end
where status in (
  'proposal_sent','confirmed','contract_signed','invoiced','paid_partial',
  'client_transferred','deal_done','in_transit','ready_to_ship','docs_received'
);

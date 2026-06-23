-- ═══════════════════════════════════════════════════════════════════
-- AiM Skill — REWRITE v2 · CUTOVER · переміщення/трансформація рядків
-- ⚠ НЕ ЗАПУСКАТИ ПОКИ СТАРА АПКА В ПРОДІ.
-- Запускати ОДИН РАЗ при злитті rewrite→main (коли нова апка стає продом),
-- бо ці зміни можуть призвести до подвійного обліку у старій апці.
-- Залежить від 001_phase1_schema.sql.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────
-- A. КАСА → BANK_TRANSACTIONS (каса = рахунок «Готівка»)
--    Переносимо cash_transactions у bank_transactions і ретируємо стару таблицю.
-- ───────────────────────────────────────────────────────────────────
insert into bank_transactions
  (date, amount, direction, article, description, counterparty, contractor_id,
   project_id, account_id, article_id, is_validated, created_by, created_at)
select
  c.date,
  abs(c.amount),
  case when c.type='income' then 'Доходи' else 'Витрати' end,
  c.article,
  c.description,
  c.counterparty,
  c.contractor_id,
  c.project_id,
  (select id from accounts where name='Готівка'),
  (select id from articles a where lower(btrim(a.name))=lower(btrim(c.article)) limit 1),
  true,
  c.created_by,
  c.created_at
from cash_transactions c
where not exists (
  -- захист від повторного запуску: не дублювати вже перенесене
  select 1 from bank_transactions b
  where b.account_id = (select id from accounts where name='Готівка')
    and b.date = c.date and b.amount = abs(c.amount)
    and coalesce(b.description,'') = coalesce(c.description,'')
);
-- Після перевірки можна:  drop table cash_transactions;

-- ───────────────────────────────────────────────────────────────────
-- B. BACKFILL СУМ ДОКУМЕНТІВ (щоб запрацювали борги/Aging)
--    Стара БД тримала суми на bank_transactions/transaction_items, не на documents.
--    1) Суму документа беремо з прив'язаної транзакції (груба оцінка).
--    2) Напрямок боргу: outgoing→receivable (клієнт винен), incoming→payable (ми винні).
--    3) contractor_id документа — з транзакції.
--    Уточнюється в Фазі 5 (OCR заповнює amount/vat) і Фазі 7 (Aging).
-- ───────────────────────────────────────────────────────────────────
update documents d set
  amount = b.amount,
  contractor_id = coalesce(d.contractor_id, b.contractor_id),
  direction = case when d.doc_role='outgoing' then 'receivable'
                   when d.doc_role='incoming' then 'payable' else d.direction end
from bank_transactions b
where d.bank_transaction_id = b.id
  and d.amount is null;

-- Перенести згенеровані документи (generated_docs) у documents як носії сум.
-- (5 рядків; type з doc_type, сума з total). Лишаємо generated_docs як є для генерації PDF.
insert into documents (type, contractor_id, amount, vat_amount, is_signed, created_at, direction)
select
  g.doc_type, g.contractor_id, g.total, g.vat_amount,
  (g.status in ('signed','shipped')),
  g.created_at,
  case when g.doc_type in ('invoice','salesOrder','waybill') then 'receivable'
       when g.doc_type in ('incomingWaybill') then 'payable' else null end
from generated_docs g
where not exists (
  select 1 from documents d where d.type=g.doc_type and d.amount=g.total and d.created_at=g.created_at
);

-- ───────────────────────────────────────────────────────────────────
-- C. PROJECTS → ORDERS  (ОПЦІЙНО — рішення Фази 4)
--    Старий projects (22) — це вільний попередник orders без жорсткого циклу.
--    Розкоментуй лише якщо вирішили конвертувати. За замовчуванням projects лишається.
-- ───────────────────────────────────────────────────────────────────
-- insert into orders (order_number, type, status, client_id, total, created_at, closed_at)
-- select p.project_id_display, 'trade',
--   case p.status when 'completed' then 'closed' when 'archived' then 'closed' else 'new' end,
--   (select id from contractors c where lower(btrim(c.name))=lower(btrim(p.contractor)) limit 1),
--   coalesce(p.budget,0), p.created_at,
--   case when p.status in ('completed','archived') then p.created_at end
-- from projects p;
-- -- і перепривʼязати bank_transactions.project_id → orders через documents/order_documents.

commit;

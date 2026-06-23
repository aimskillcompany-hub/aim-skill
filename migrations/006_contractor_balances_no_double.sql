-- ═══════════════════════════════════════════════════════════════════
-- ОПЦІЙНО (в'юха зараз не показується в UI, але для консистентності).
-- Захист від подвоєння боргу: рахунок/замовлення/договір — це ЗАПИТИ,
-- вони не створюють борг. Виключаємо їх із documents_total.
-- (Код debts.js/pl.js уже застосовує це правило незалежно від в'юхи.)
-- ═══════════════════════════════════════════════════════════════════

create or replace view contractor_balances as
select
  c.id   as contractor_id,
  c.name,
  c.edrpou,
  coalesce(d.doc_total, 0)            as documents_total,
  coalesce(t.tx_total,  0)            as transactions_total,
  coalesce(d.doc_total,0) - coalesce(t.tx_total,0) as balance
from contractors c
left join (
  select contractor_id, sum(coalesce(amount,0)) as doc_total
  from documents
  where contractor_id is not null
    and (type is null or type not in ('invoice','salesOrder','purchaseOrder','loanAgreement','supplyAgreement'))
  group by contractor_id
) d on d.contractor_id = c.id
left join (
  select contractor_id, sum(coalesce(amount,0)) as tx_total
  from bank_transactions where contractor_id is not null group by contractor_id
) t on t.contractor_id = c.id;

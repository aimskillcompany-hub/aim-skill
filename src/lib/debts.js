// Автоматичний розрахунок боргів. Принцип ТЗ:
//   борг = сума документів − сума прив'язаних транзакцій по контрагенту.
// Дебіторка (receivable) — клієнт винен нам; кредиторка (payable) — ми винні постачальнику.
// Борги НІКОЛИ не вводяться вручну.
import { qc } from './companyScope'

const sum = (arr, f) => (arr || []).reduce((s, x) => s + (Number(f(x)) || 0), 0)

// Захист від подвоєння боргу: рахунок/замовлення/договір — це ЗАПИТИ на оплату,
// вони НЕ створюють борг. Борг створюють лише РЕАЛІЗОВАНІ документи
// (видаткова/прихідна накладна, акт). Тому рахунок + накладна на одну угоду
// рахуються як один борг, а не два.
export const NON_DEBT_TYPES = new Set(['invoice', 'salesOrder', 'purchaseOrder', 'loanAgreement', 'supplyAgreement', 'commercialProposal', 'other'])
export const countsAsDebt = (type) => !NON_DEBT_TYPES.has(type)

// Детальний баланс одного контрагента (для картки)
export async function getContractorBalance(contractorId) {
  const since = new Date(); since.setFullYear(since.getFullYear() - 1)
  const sinceStr = since.toISOString().split('T')[0]

  const [{ data: docs }, { data: txs }] = await Promise.all([
    qc('documents').select('amount, direction, type, is_signed').eq('contractor_id', contractorId),
    qc('bank_transactions').select('amount, direction, date')
      .eq('contractor_id', contractorId).eq('is_ignored', false),
  ])

  const debtDocs = (docs || []).filter(d => countsAsDebt(d.type))
  const recvDocs = sum(debtDocs.filter(d => d.direction === 'receivable'), d => d.amount)
  const payDocs  = sum(debtDocs.filter(d => d.direction === 'payable'), d => d.amount)
  const paidIn   = sum((txs || []).filter(t => t.direction === 'Доходи'),  t => Math.abs(t.amount))
  const paidOut  = sum((txs || []).filter(t => t.direction === 'Витрати'), t => Math.abs(t.amount))
  const turnoverYear = sum((txs || []).filter(t => (t.date || '') >= sinceStr), t => Math.abs(t.amount))

  return {
    receivable: recvDocs - paidIn,   // > 0 → клієнт винен нам
    payable: payDocs - paidOut,      // > 0 → ми винні постачальнику
    turnoverYear,
    income: paidIn,
    expense: paidOut,
  }
}

// Баланси всіх контрагентів (для списку) — рахуються з документів і транзакцій
// АКТИВНОЇ компанії (scoped через qc). Раніше бралися з в'юхи contractor_balances,
// яка не знала про company_id → показувала суму по всіх юрособах.
export async function getAllBalances() {
  const [{ data: docs }, { data: txs }] = await Promise.all([
    qc('documents').select('contractor_id, amount, type').not('contractor_id', 'is', null),
    qc('bank_transactions').select('contractor_id, amount').eq('is_ignored', false).not('contractor_id', 'is', null),
  ])
  const map = {}
  const ensure = (id) => (map[id] ||= { contractor_id: id, documents_total: 0, transactions_total: 0, balance: 0 })
  ;(docs || []).forEach(d => { if (countsAsDebt(d.type)) ensure(d.contractor_id).documents_total += Number(d.amount) || 0 })
  ;(txs || []).forEach(t => { ensure(t.contractor_id).transactions_total += Number(t.amount) || 0 })
  Object.values(map).forEach(m => { m.balance = m.documents_total - m.transactions_total })
  return map
}

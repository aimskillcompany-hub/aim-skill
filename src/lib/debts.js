// Автоматичний розрахунок боргів. Принцип ТЗ:
//   борг = сума документів − сума прив'язаних транзакцій по контрагенту.
// Дебіторка (receivable) — клієнт винен нам; кредиторка (payable) — ми винні постачальнику.
// Борги НІКОЛИ не вводяться вручну.
import { supabase } from './supabase'

const sum = (arr, f) => (arr || []).reduce((s, x) => s + (Number(f(x)) || 0), 0)

// Захист від подвоєння боргу: рахунок/замовлення/договір — це ЗАПИТИ на оплату,
// вони НЕ створюють борг. Борг створюють лише РЕАЛІЗОВАНІ документи
// (видаткова/прихідна накладна, акт). Тому рахунок + накладна на одну угоду
// рахуються як один борг, а не два.
export const NON_DEBT_TYPES = new Set(['invoice', 'salesOrder', 'purchaseOrder', 'loanAgreement', 'supplyAgreement'])
export const countsAsDebt = (type) => !NON_DEBT_TYPES.has(type)

// Детальний баланс одного контрагента (для картки)
export async function getContractorBalance(contractorId) {
  const since = new Date(); since.setFullYear(since.getFullYear() - 1)
  const sinceStr = since.toISOString().split('T')[0]

  const [{ data: docs }, { data: txs }] = await Promise.all([
    supabase.from('documents').select('amount, direction, type, is_signed').eq('contractor_id', contractorId),
    supabase.from('bank_transactions').select('amount, direction, date')
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

// Баланси всіх контрагентів одним запитом (для списку) — з in'юхи contractor_balances
export async function getAllBalances() {
  const { data } = await supabase
    .from('contractor_balances')
    .select('contractor_id, balance, documents_total, transactions_total')
  const map = {}
  ;(data || []).forEach(b => { map[b.contractor_id] = b })
  return map
}

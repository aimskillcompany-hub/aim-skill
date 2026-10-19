// Автоматичний розрахунок боргів. Принцип ТЗ:
//   борг = сума документів − сума прив'язаних транзакцій по контрагенту.
// Дебіторка (receivable) — клієнт винен нам; кредиторка (payable) — ми винні постачальнику.
// Борги НІКОЛИ не вводяться вручну.
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { supabase } from './supabase'
import { kyivDateOfTs } from './dates'

const sum = (arr, f) => (arr || []).reduce((s, x) => s + (Number(f(x)) || 0), 0)

// Захист від подвоєння боргу: рахунок/замовлення/договір — це ЗАПИТИ на оплату,
// вони НЕ створюють борг. Борг створюють лише РЕАЛІЗОВАНІ документи
// (видаткова/прихідна накладна, акт). Тому рахунок + накладна на одну угоду
// рахуються як один борг, а не два.
export const NON_DEBT_TYPES = new Set(['invoice', 'salesOrder', 'purchaseOrder', 'loanAgreement', 'supplyAgreement', 'commercialProposal', 'other'])
export const countsAsDebt = (type) => !NON_DEBT_TYPES.has(type)

// Дата виникнення боргу. Згенерований документ можна зберегти «без дати» (дата вписується від руки) →
// doc_date = null; тоді беремо дату створення. ЄДИНЕ правило для Балансу, динаміки й звіту «Дебіторка»
// (раніше Баланс фільтрував .lte('doc_date') і такі видаткові «ВН-…» випадали з дебіторки).
// Дата створення — київська (документ, збережений о 01:00 1-го числа, не «переїжджає» в попередній місяць).
export const debtDate = (d) => (d.doc_date ? String(d.doc_date).slice(0, 10) : kyivDateOfTs(d.created_at))

// Оплати документів: [{ document_id, transaction_id, amount (≥0), date }] — ЄДИНЕ джерело для
// Дебіторки, Балансу, динаміки, старіння й прогнозу. Без обрізання на 1000 рядках; помилка кидається;
// оплати від ПРОІГНОРОВАНИХ транзакцій (дублі імпорту) не рахуються — вони не «гасять» борг.
export async function loadDocPayments(docIds) {
  if (!docIds?.length) return []
  const tds = await fetchAllIn(() => supabase.from('transaction_documents').select('id, document_id, amount, transaction_id'), 'document_id', docIds)
  const txIds = [...new Set(tds.map(t => t.transaction_id).filter(Boolean))]
  const txs = txIds.length ? await fetchAllIn(() => supabase.from('bank_transactions').select('id, date, is_ignored'), 'id', txIds) : []
  const txById = {}; txs.forEach(t => { txById[t.id] = t })
  return tds
    .filter(t => !txById[t.transaction_id]?.is_ignored)
    .map(t => ({ document_id: t.document_id, transaction_id: t.transaction_id, amount: Math.abs(Number(t.amount) || 0), date: txById[t.transaction_id]?.date || null }))
}

// Детальний баланс одного контрагента (для картки)
export async function getContractorBalance(contractorId) {
  const since = new Date(); since.setFullYear(since.getFullYear() - 1)
  const sinceStr = since.toISOString().split('T')[0]

  const [docs, txs] = await Promise.all([
    fetchAll(() => qc('documents').select('amount, direction, type, is_signed').eq('contractor_id', contractorId)),
    fetchAll(() => qc('bank_transactions').select('amount, direction, date')
      .eq('contractor_id', contractorId).eq('is_ignored', false)),
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

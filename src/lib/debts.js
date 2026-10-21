// Автоматичний розрахунок боргів. Принцип ТЗ:
//   борг = сума документів − сума прив'язаних транзакцій по контрагенту.
// Дебіторка (receivable) — клієнт винен нам; кредиторка (payable) — ми винні постачальнику.
// Борги НІКОЛИ не вводяться вручну.
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { supabase } from './supabase'
import { kyivDateOfTs, todayKyiv } from './dates'

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

// Борг одного контрагента для картки — ЗА ТИМ САМИМ ПРАВИЛОМ, що й звіт «Дебіторка» (2026-10-22):
// кожен борговий документ (видаткова / прихідна / акт; не рахунок, не договір) мінус ПРИВ'ЯЗАНІ до нього оплати
// (transaction_documents), по всіх юрособах користувача, документи з датою ≤ сьогодні, залишок > 0,5 грн.
// Раніше картка рахувала «усі документи − усі платежі контрагента» лише по активній юрособі — і показувала
// інший борг, ніж «Дебіторка». Платежі без прив'язки до документа тепер видно окремо (unlinkedIn / unlinkedOut).
//   companyIds — юрособи користувача (useCompany().companies); без них — лише активна юрособа.
export async function getContractorBalance(contractorId, companyIds = null) {
  const since = new Date(); since.setFullYear(since.getFullYear() - 1)
  const sinceStr = since.toISOString().split('T')[0]
  const today = todayKyiv()
  const q = (table, cols) => companyIds?.length ? supabase.from(table).select(cols).in('company_id', companyIds) : qc(table).select(cols)

  const [docs, txs] = await Promise.all([
    fetchAll(() => q('documents', 'id, amount, direction, type, doc_date, created_at').eq('contractor_id', contractorId).not('amount', 'is', null)),
    fetchAll(() => q('bank_transactions', 'id, amount, direction, date').eq('contractor_id', contractorId).eq('is_ignored', false)),
  ])

  const debtDocs = (docs || []).filter(d => countsAsDebt(d.type) && (d.direction === 'receivable' || d.direction === 'payable') && debtDate(d) <= today)
  const paid = {}
  ;(await loadDocPayments(debtDocs.map(d => d.id))).forEach(x => { paid[x.document_id] = (paid[x.document_id] || 0) + x.amount })
  let receivable = 0, payable = 0, overpaidIn = 0, overpaidOut = 0
  for (const d of debtDocs) {
    const rest = Math.abs(Number(d.amount) || 0) - (paid[d.id] || 0)
    if (d.direction === 'receivable') { if (rest > 0.5) receivable += rest; else if (rest < -0.5) overpaidIn += -rest }
    else { if (rest > 0.5) payable += rest; else if (rest < -0.5) overpaidOut += -rest }
  }

  // оплати контрагента, не прив'язані (повністю) до жодного документа
  const linked = {}
  const txIds = (txs || []).map(t => t.id)
  if (txIds.length) {
    const tds = await fetchAllIn(() => supabase.from('transaction_documents').select('id, transaction_id, amount'), 'transaction_id', txIds)
    tds.forEach(t => { linked[t.transaction_id] = (linked[t.transaction_id] || 0) + Math.abs(Number(t.amount) || 0) })
  }
  const free = (t) => Math.max(0, Math.abs(Number(t.amount) || 0) - (linked[t.id] || 0))
  const unlinkedIn = sum((txs || []).filter(t => t.direction === 'Доходи'), free)
  const unlinkedOut = sum((txs || []).filter(t => t.direction === 'Витрати'), free)

  return {
    receivable,                       // = сума цього контрагента у звіті «Дебіторка»
    payable,                          // кредиторка за тим самим правилом
    unlinkedIn: unlinkedIn + overpaidIn,     // оплати від клієнта без документа / понад документ (аванс або не прив'язано)
    unlinkedOut: unlinkedOut + overpaidOut,  // наші оплати без документа / понад документ
    turnoverYear: sum((txs || []).filter(t => (t.date || '') >= sinceStr), t => Math.abs(t.amount)),
    income: sum((txs || []).filter(t => t.direction === 'Доходи'), t => Math.abs(t.amount)),
    expense: sum((txs || []).filter(t => t.direction === 'Витрати'), t => Math.abs(t.amount)),
  }
}

// Обороти контрагентів для списку — рахуються з банківських операцій щоразу (2026-10-22).
// Раніше список показував збережені contractors.total_income / total_expense / operations_count /
// last_operation_date, які ніхто не оновлював (у 82 контрагентів — застарілі). Ті самі правила, що й у картці:
// не враховуються проігноровані операції (дублі імпорту); юрособи — ті, що доступні користувачу.
export async function loadContractorTurnover(companyIds = null) {
  const rows = await fetchAll(() => {
    let q = companyIds?.length ? supabase.from('bank_transactions').select('id, contractor_id, amount, direction, date').in('company_id', companyIds)
                               : qc('bank_transactions').select('id, contractor_id, amount, direction, date')
    return q.eq('is_ignored', false).not('contractor_id', 'is', null)
  })
  const by = {}
  for (const t of rows) {
    const s = (by[t.contractor_id] ||= { total_income: 0, total_expense: 0, operations_count: 0, last_operation_date: '' })
    const a = Math.abs(Number(t.amount) || 0)
    if (t.direction === 'Доходи') s.total_income += a
    else if (t.direction === 'Витрати') s.total_expense += a
    s.operations_count++
    if ((t.date || '') > s.last_operation_date) s.last_operation_date = t.date
  }
  return by
}

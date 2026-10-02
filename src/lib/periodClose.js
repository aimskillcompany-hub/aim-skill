// ── Закриття періоду: чек-лист якості, знімок, закрити/переоткрити ──
import { supabase } from './supabase'
import { qc } from './companyScope'
import { computePL, salesProfitReport, periodRange } from './pl'
import { countsAsDebt } from './debts'

// Список закриттів
export async function listClosings() {
  const { data } = await supabase.from('period_closings').select('*')
    .order('period_year', { ascending: false }).order('period_month', { ascending: false })
  return data || []
}

export function periodStatus(closings, year, month) {
  const row = (closings || []).find(c => c.period_year === year && c.period_month === month)
  return row ? row.status : 'open' // 'open' | 'closed' | 'reopened'
}

// ── Чек-лист готовності періоду (ворота якості даних) ──
export async function runChecklist(year, month) {
  const { from, to } = periodRange(year, month)

  // 1. Мінусові залишки складу станом на кінець періоду
  const sm = await fetchAll('stock_movements', 'product_id, type, quantity', q => q.lte('date', to))
  const bal = {}
  sm.forEach(m => { const q = Number(m.quantity) || 0; bal[m.product_id] = (bal[m.product_id] || 0) + (m.type === 'in' ? q : -q) })
  const negIds = Object.entries(bal).filter(([, q]) => q < -0.0001).map(([id]) => id)
  let negativeStock = []
  if (negIds.length) {
    const { data: prods } = await supabase.from('products').select('id, name, product_type').in('id', negIds)
    const pm = {}; (prods || []).forEach(p => pm[p.id] = p)
    negativeStock = negIds.filter(id => (pm[id]?.product_type || 'goods') === 'goods').map(id => ({ id, name: pm[id]?.name || id, qty: bal[id] }))
  }

  // 2. Документи періоду без суми
  const { data: docsNoAmount } = await qc('documents')
    .select('id, doc_number, type').gte('doc_date', from).lte('doc_date', to).is('amount', null)

  // 3. Невалідовані (некласифіковані) транзакції періоду — з даними для класифікації
  const { data: unclassifiedList } = await qc('bank_transactions')
    .select('id, date, amount, counterparty, description, direction, article, account_id')
    .gte('date', from).lte('date', to).eq('is_ignored', false).eq('is_validated', false).order('date')

  // 4. Неперевірені документи періоду (звірка скан↔поля/ПДВ/рухи). Колонка is_verified — міграція 029;
  //    якщо її ще нема, вважаємо 0 неперевірених, щоб не ламати чек-лист до застосування міграції.
  let unverifiedList = []
  {
    const r = await qc('documents')
      .select('id, doc_number, type, doc_date, amount, vat_amount, contractor_id, storage_path, file_path, file_type, file_name, ocr_data, is_signed, is_verified, doc_role, direction, source, contractors(name)')
      .gte('doc_date', from).lte('doc_date', to).eq('is_verified', false).order('doc_date')
    if (!r.error) unverifiedList = r.data || []
  }

  // 5. Накладні з розпізнаними позиціями, але БЕЗ руху складу (куплено/продано, не проведено на склад).
  //    stockEffect: incomingWaybill=прихід, waybill=видаток (див. docgen/registry).
  let unpostedStock = []
  {
    const r = await qc('documents')
      .select('id, doc_number, type, doc_date, amount, vat_amount, contractor_id, storage_path, file_path, file_type, file_name, ocr_data, is_signed, is_verified, doc_role, direction, source, contractors(name)')
      .in('type', ['incomingWaybill', 'waybill']).gte('doc_date', from).lte('doc_date', to)
    const withItems = (r.data || []).filter(d => Array.isArray(d.ocr_data?.items) && d.ocr_data.items.length > 0)
    if (withItems.length) {
      const ids = withItems.map(d => d.id)
      const moved = new Set()
      for (let i = 0; i < ids.length; i += 200) {
        const { data: mv } = await qc('stock_movements').select('document_id').in('document_id', ids.slice(i, i + 200)).neq('source', 'assembly')
        ;(mv || []).forEach(m => moved.add(m.document_id))
      }
      unpostedStock = withItems.filter(d => !moved.has(d.id))
    }
  }

  // Ворота: закриття лише коли перевірені ВСІ документи і валідовані ВСІ транзакції періоду.
  // Непроведені на склад накладні — попередження (не блокер): видно й клікабельно, але рішення за користувачем.
  const unclassifiedTx = (unclassifiedList || []).length
  const blockers = negativeStock.length + (docsNoAmount?.length || 0) + unverifiedList.length + unclassifiedTx
  return {
    negativeStock, docsNoAmount: docsNoAmount || [],
    unclassifiedTx, unclassifiedList: unclassifiedList || [],
    unverifiedDocs: unverifiedList.length, unverifiedList,
    unpostedStock,
    blockers,
  }
}

// ── Повнота даних: що з транзакцій періоду НЕ потрапляє у звіти і чому ──
// Звіряльний місток: усі рухи грошей = (увійшло в P&L) + (виключене за умовами).
// Кожна виключена група повертається з транзакціями для перегляду/дії.
export async function computeCompleteness(year, month) {
  const { from, to } = periodRange(year, month)
  const txs = await fetchAll('bank_transactions',
    'id, date, amount, direction, article, counterparty, description, is_validated, is_ignored, account_id',
    q => q.gte('date', from).lte('date', to))
  const num = x => Math.abs(Number(x) || 0)
  const mk = () => ({ n: 0, sum: 0, items: [] })
  const b = { inPL: { n: 0, sum: 0 }, ignored: mk(), unvalidated: mk(), noArticle: mk(), otherFin: mk() }
  const active = { n: 0, sum: 0 } // неігноровані

  txs.forEach(t => {
    const a = num(t.amount)
    if (t.is_ignored) { b.ignored.n++; b.ignored.sum += a; b.ignored.items.push(t); return }
    active.n++; active.sum += a
    if (!t.is_validated) { b.unvalidated.n++; b.unvalidated.sum += a; b.unvalidated.items.push(t); return }
    if (!String(t.article || '').trim()) { b.noArticle.n++; b.noArticle.sum += a; b.noArticle.items.push(t); return }
    if (t.direction === 'Інше' || t.direction === 'ПФД') { b.otherFin.n++; b.otherFin.sum += a; b.otherFin.items.push(t); return }
    b.inPL.n++; b.inPL.sum += a
  })
  // «Увага» — суми, що тихо випадають із P&L і які варто переглянути (без Інше/ПФД — вони поза P&L свідомо)
  b.needsReview = b.ignored.n + b.noArticle.n + b.unvalidated.n
  b.active = active
  return b
}

// ── Знімок цифр станом на кінець періоду ──
export async function computeSnapshot(year, month) {
  const { to } = periodRange(year, month)

  const [pl, profit] = await Promise.all([computePL(year, month), salesProfitReport(year, month)])

  // Склад станом на кінець періоду
  const sm = await fetchAll('stock_movements', 'product_id, type, quantity', q => q.lte('date', to))
  const bal = {}
  sm.forEach(m => { const q = Number(m.quantity) || 0; (bal[m.product_id] ||= 0); bal[m.product_id] += (m.type === 'in' ? q : -q) })
  const pids = Object.keys(bal)
  const prodMap = {}
  for (let i = 0; i < pids.length; i += 200) {
    const { data } = await supabase.from('products').select('id, name, buy_price, product_type').in('id', pids.slice(i, i + 200))
    ;(data || []).forEach(p => prodMap[p.id] = p)
  }
  // Оцінка складу — лише товари (goods). Послуги/роботи/розхідники не є залишком.
  const stockItems = pids.map(id => {
    const p = prodMap[id] || {}, qty = bal[id], unit = Number(p.buy_price) || 0
    return { product_id: id, name: p.name || id, product_type: p.product_type, qty, unit_cost: unit, value: qty * unit }
  }).filter(x => Math.abs(x.qty) > 0.0001 && (x.product_type || 'goods') === 'goods').sort((a, b) => b.value - a.value)
  const stockValue = stockItems.reduce((s, x) => s + x.value, 0)

  // Баланси рахунків станом на кінець періоду
  const [{ data: accs }, txs] = await Promise.all([
    qc('accounts').select('id, name, type, opening_balance, opening_balance_date'),
    fetchAll('bank_transactions', 'account_id, amount, date', q => q.eq('is_ignored', false).lte('date', to)),
  ])
  const accAgg = {}
  txs.forEach(t => {
    const acc = (accs || []).find(x => x.id === t.account_id)
    if (acc?.opening_balance_date && t.date && t.date < acc.opening_balance_date) return
    accAgg[t.account_id] = (accAgg[t.account_id] || 0) + (Number(t.amount) || 0)
  })
  const balances = (accs || []).map(a => ({ id: a.id, name: a.name, type: a.type, balance: (Number(a.opening_balance) || 0) + (accAgg[a.id] || 0) }))
  const cashBankTotal = balances.reduce((s, b) => s + b.balance, 0)

  // Поворотна фінансова допомога (ПФД) — позики: сальдо до кінця періоду.
  // Гроші від/до ПФД сидять у cashBankTotal, але це НЕ капітал (треба повернути). Дзеркалимо як зобов'язання,
  // щоб отримання позики не роздувало власний капітал, а повернення — не занижувало.
  // Сальдо > 0 — ми винні повернути; < 0 — нам мають повернути.
  const accById2 = {}; (accs || []).forEach(a => accById2[a.id] = a)
  const { data: loanTxs } = await qc('bank_transactions')
    .select('id, date, amount, counterparty, description, article, account_id')
    .eq('is_ignored', false).eq('direction', 'ПФД').lte('date', to).order('date')
  let loansNet = 0
  ;(loanTxs || []).forEach(t => {
    const acc = accById2[t.account_id]
    if (acc?.opening_balance_date && t.date && t.date < acc.opening_balance_date) return
    loansNet += Number(t.amount) || 0
  })

  // Дебіторка/кредиторка станом на кінець періоду.
  // Оплата рахується через transaction_documents (повні/часткові оплати) — як у computeAging і картці
  // контрагента, а НЕ по documents.bank_transaction_id (старий прямий лінк, не бачив transaction_documents).
  const debtDocs = await fetchAll('documents', 'id, type, direction, amount, doc_date, doc_number, contractor_id', q =>
    q.lte('doc_date', to).not('amount', 'is', null).not('direction', 'is', null))
  const relevant = debtDocs.filter(d => countsAsDebt(d.type) && (d.direction === 'payable' || d.direction === 'receivable'))
  const debtIds = relevant.map(d => d.id)
  // Оплати з датами (transaction_documents → bank_transactions.date): враховуємо лише ті, що <= кінця періоду,
  // щоб борг був коректний станом на цю дату (а не «як зараз») — узгоджено з computeBalanceTrend.
  const paidByDoc = {}
  if (debtIds.length) {
    const tds = []
    for (let i = 0; i < debtIds.length; i += 200) {
      const { data } = await supabase.from('transaction_documents').select('document_id, amount, transaction_id').in('document_id', debtIds.slice(i, i + 200))
      ;(data || []).forEach(t => tds.push(t))
    }
    const ptxIds = [...new Set(tds.map(t => t.transaction_id).filter(Boolean))]
    const ptxDate = {}
    for (let i = 0; i < ptxIds.length; i += 200) {
      const { data } = await supabase.from('bank_transactions').select('id, date').in('id', ptxIds.slice(i, i + 200))
      ;(data || []).forEach(t => ptxDate[t.id] = t.date)
    }
    tds.forEach(t => {
      const pd = ptxDate[t.transaction_id]
      if (pd && pd > to) return // оплата сталась після кінця періоду — ще не оплачено на цю дату
      paidByDoc[t.document_id] = (paidByDoc[t.document_id] || 0) + Math.abs(Number(t.amount) || 0)
    })
  }
  let receivable = 0, payable = 0
  const receivableDocs = [], payableDocs = []
  relevant.forEach(d => {
    const amt = Math.abs(Number(d.amount) || 0)
    const outstanding = amt - (paidByDoc[d.id] || 0)
    if (outstanding <= 0.5) return // повністю оплачено — не борг
    const row = { id: d.id, type: d.type, doc_number: d.doc_number, doc_date: d.doc_date, amount: outstanding, contractor_id: d.contractor_id }
    if (d.direction === 'payable') { payable += outstanding; payableDocs.push(row) } else { receivable += outstanding; receivableDocs.push(row) }
  })
  // імена контрагентів для розшифровки боргу
  const dcids = [...new Set([...receivableDocs, ...payableDocs].map(r => r.contractor_id).filter(Boolean))]
  const dcn = {}
  for (let i = 0; i < dcids.length; i += 100) {
    const { data } = await supabase.from('contractors').select('id, name').in('id', dcids.slice(i, i + 100))
    ;(data || []).forEach(c => dcn[c.id] = c.name)
  }
  receivableDocs.forEach(r => r.contractorName = dcn[r.contractor_id] || 'Без контрагента')
  payableDocs.forEach(r => r.contractorName = dcn[r.contractor_id] || 'Без контрагента')

  return {
    pl: { totals: pl.totals?.fact || null, sections: pl.sections || [] },
    margin: profit.grand || null,
    stock: { totalValue: stockValue, count: stockItems.length, items: stockItems },
    balances, cashBankTotal,
    receivable, payable, receivableDocs, payableDocs,
    loansNet, loanTxs: loanTxs || [],
  }
}

// ── Динаміка балансу по місяцях: від (fromY,fromM) до (toY,toM) ──
// Одна вибірка даних, розкочування станом на кінець кожного місяця. Пояснює, яка складова тягне капітал.
export async function computeBalanceTrend(toY, toM, opts = {}) {
  const fromY = opts.fromY || 2025, fromM = opts.fromM || 1
  const months = []
  let y = fromY, m = fromM
  while ((y < toY || (y === toY && m <= toM)) && months.length < 60) {
    months.push({ y, m, end: periodRange(y, m).to, label: `${String(m).padStart(2, '0')}.${y}` })
    m++; if (m > 12) { m = 1; y++ }
  }
  if (!months.length) return { months: [], rows: [] }
  const lastEnd = months[months.length - 1].end

  // 1. Рахунки + транзакції (гроші + ПФД)
  const { data: accs } = await qc('accounts').select('id, opening_balance, opening_balance_date')
  const accById = {}; (accs || []).forEach(a => accById[a.id] = a)
  const openingTotal = (accs || []).reduce((s, a) => s + (Number(a.opening_balance) || 0), 0)
  const txs = await fetchAll('bank_transactions', 'account_id, amount, date, direction', q => q.eq('is_ignored', false).lte('date', lastEnd))

  // 2. Склад (лише goods)
  const sm = await fetchAll('stock_movements', 'product_id, type, quantity, date', q => q.lte('date', lastEnd))
  const spids = [...new Set(sm.map(s => s.product_id).filter(Boolean))]
  const prodMap = {}
  for (let i = 0; i < spids.length; i += 200) {
    const { data } = await supabase.from('products').select('id, buy_price, product_type').in('id', spids.slice(i, i + 200))
    ;(data || []).forEach(p => prodMap[p.id] = p)
  }

  // 3. Борги (дебіторка/кредиторка) з оплатами по датах — щоб борг був коректний станом на кожен місяць
  const debtDocs = await fetchAll('documents', 'id, type, direction, amount, doc_date', q => q.lte('doc_date', lastEnd).not('amount', 'is', null).not('direction', 'is', null))
  const relevant = debtDocs.filter(d => countsAsDebt(d.type) && (d.direction === 'payable' || d.direction === 'receivable'))
  const debtIds = relevant.map(d => d.id)
  const paysByDoc = {}
  if (debtIds.length) {
    const tds = []
    for (let i = 0; i < debtIds.length; i += 200) {
      const { data } = await supabase.from('transaction_documents').select('document_id, amount, transaction_id').in('document_id', debtIds.slice(i, i + 200))
      ;(data || []).forEach(t => tds.push(t))
    }
    const txIds = [...new Set(tds.map(t => t.transaction_id).filter(Boolean))]
    const txDate = {}
    for (let i = 0; i < txIds.length; i += 200) {
      const { data } = await supabase.from('bank_transactions').select('id, date').in('id', txIds.slice(i, i + 200))
      ;(data || []).forEach(t => txDate[t.id] = t.date)
    }
    tds.forEach(t => {
      (paysByDoc[t.document_id] ||= []).push({ amount: Math.abs(Number(t.amount) || 0), date: txDate[t.transaction_id] || '0000-00-00' })
    })
  }

  const rows = months.map(mo => {
    const end = mo.end
    // Гроші + ПФД
    let cash = openingTotal, loans = 0
    txs.forEach(t => {
      if (t.date > end) return
      const acc = accById[t.account_id]
      if (acc?.opening_balance_date && t.date && t.date < acc.opening_balance_date) return
      cash += Number(t.amount) || 0
      if (t.direction === 'ПФД') loans += Number(t.amount) || 0
    })
    // Склад (goods) станом на кінець місяця
    const bal = {}
    sm.forEach(s => {
      if (s.date > end) return
      if ((prodMap[s.product_id]?.product_type || 'goods') !== 'goods') return
      const q = Number(s.quantity) || 0
      bal[s.product_id] = (bal[s.product_id] || 0) + (s.type === 'in' ? q : s.type === 'out' ? -q : q)
    })
    let stock = 0
    Object.entries(bal).forEach(([pid, q]) => { if (Math.abs(q) > 0.0001) stock += q * (Number(prodMap[pid]?.buy_price) || 0) })
    // Борги станом на кінець місяця
    let receivable = 0, payable = 0
    relevant.forEach(d => {
      if ((d.doc_date || '') > end) return
      const paid = (paysByDoc[d.id] || []).reduce((s, p) => s + (p.date <= end ? p.amount : 0), 0)
      const outstanding = Math.abs(Number(d.amount) || 0) - paid
      if (outstanding <= 0.5) return
      if (d.direction === 'payable') payable += outstanding; else receivable += outstanding
    })
    const assets = cash + stock + receivable
    const equity = assets - payable - loans
    return { label: mo.label, y: mo.y, m: mo.m, cash, stock, receivable, payable, loans, assets, equity }
  })
  // Δ капіталу місяць-до-місяця
  rows.forEach((r, i) => { r.dEquity = i === 0 ? 0 : r.equity - rows[i - 1].equity })
  return { months, rows }
}

// Компактний підсумок знімка (для збереження як _prev при повторному закритті)
function snapshotSummary(s, closedAt) {
  const t = s?.pl?.totals || {}
  return {
    closed_at: closedAt || null,
    plNet: t.net || 0, revenue: t.revenue || 0, expense: (t.cogs || 0) + (t.opex || 0),
    marginSum: s?.margin?.marginSum || 0, stockValue: s?.stock?.totalValue || 0,
    cashBank: s?.cashBankTotal || 0, receivable: s?.receivable || 0, payable: s?.payable || 0,
    stock: (s?.stock?.items || []).map(i => ({ product_id: i.product_id, name: i.name, qty: i.qty, value: i.value })),
  }
}

// Діф поточного знімка з попереднім закриттям (_prev). null, якщо періоду не переоткривали.
export function snapshotDiff(snap) {
  const prev = snap?._prev
  if (!prev) return null
  const cur = snapshotSummary(snap)
  const d = (a, b) => (a || 0) - (b || 0)
  const totals = {
    plNet: d(cur.plNet, prev.plNet), revenue: d(cur.revenue, prev.revenue), expense: d(cur.expense, prev.expense),
    marginSum: d(cur.marginSum, prev.marginSum), stockValue: d(cur.stockValue, prev.stockValue),
    cashBank: d(cur.cashBank, prev.cashBank), receivable: d(cur.receivable, prev.receivable), payable: d(cur.payable, prev.payable),
  }
  const pm = {}; (prev.stock || []).forEach(i => pm[i.product_id] = i)
  const cm = {}; (cur.stock || []).forEach(i => cm[i.product_id] = i)
  const ids = new Set([...Object.keys(pm), ...Object.keys(cm)])
  const products = []
  ids.forEach(id => {
    const p = pm[id], c = cm[id]
    const qtyD = (c?.qty || 0) - (p?.qty || 0), valD = (c?.value || 0) - (p?.value || 0)
    if (Math.abs(qtyD) > 0.001 || Math.abs(valD) > 0.5)
      products.push({ product_id: id, name: c?.name || p?.name || id, prevQty: p?.qty || 0, curQty: c?.qty || 0, qtyD, valD })
  })
  products.sort((a, b) => Math.abs(b.valD) - Math.abs(a.valD))
  const changed = Object.values(totals).some(v => Math.abs(v) > 0.5) || products.length > 0
  return { prevClosedAt: prev.closed_at, totals, products, changed }
}

// ── Закрити період ──
export async function closePeriod(year, month, userId, { notes, reportsConfirmed } = {}) {
  const { data: existing } = await supabase.from('period_closings')
    .select('snapshot, closed_at').eq('period_year', year).eq('period_month', month).maybeSingle()
  const snapshot = await computeSnapshot(year, month)
  // Підтверджені звіти (Cash Flow / P&L / Баланс), на основі яких закрито період
  if (reportsConfirmed) snapshot.reportsConfirmed = reportsConfirmed
  // Якщо період уже закривався — зберегти компактний попередній знімок для діфу
  if (existing?.snapshot) snapshot._prev = snapshotSummary(existing.snapshot, existing.closed_at)
  const payload = {
    period_year: year, period_month: month, status: 'closed',
    snapshot, notes: notes || null, closed_by: userId || null,
    closed_at: new Date().toISOString(), reopened_at: null, reopened_by: null,
  }
  const { error } = await supabase.from('period_closings').upsert(payload, { onConflict: 'period_year,period_month' })
  if (error) throw new Error(error.message)
  return snapshot
}

// ── Переоткрити період ──
export async function reopenPeriod(year, month, userId) {
  const { error } = await supabase.from('period_closings')
    .update({ status: 'reopened', reopened_at: new Date().toISOString(), reopened_by: userId || null })
    .eq('period_year', year).eq('period_month', month)
  if (error) throw new Error(error.message)
}

// ── Чи закрито період для дати (для м'якого блокування в UI) ──
export async function isDateInClosedPeriod(dateStr) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const { data } = await supabase.from('period_closings').select('id')
    .eq('status', 'closed').eq('period_year', d.getFullYear()).eq('period_month', d.getMonth() + 1).maybeSingle()
  return !!data
}

// ── Деталізація: документи й операції періоду (джерела цифр знімка) ──
export async function computePeriodDetail(year, month) {
  const { from, to } = periodRange(year, month)

  const docs = await fetchAll('documents', 'id, type, doc_number, doc_date, amount, vat_amount, direction, doc_role, contractor_id, generated_doc_id, source', q => q.gte('doc_date', from).lte('doc_date', to))
  const cids = [...new Set(docs.map(d => d.contractor_id).filter(Boolean))]
  const cons = {}
  for (let i = 0; i < cids.length; i += 100) {
    const { data } = await supabase.from('contractors').select('id, name').in('id', cids.slice(i, i + 100))
    ;(data || []).forEach(c => cons[c.id] = c.name)
  }

  // Позиції по документах (зі stock_movements, прив'язаних до цих документів)
  const docIds = docs.map(d => d.id)
  const itemsByDoc = {}
  for (let i = 0; i < docIds.length; i += 100) {
    const { data: mv } = await qc('stock_movements')
      .select('document_id, product_id, type, quantity, price, description').in('document_id', docIds.slice(i, i + 100))
    ;(mv || []).forEach(m => { (itemsByDoc[m.document_id] ||= []).push(m) })
  }
  const allPids = [...new Set(Object.values(itemsByDoc).flat().map(m => m.product_id).filter(Boolean))]
  const pn = {}
  for (let i = 0; i < allPids.length; i += 200) {
    const { data } = await supabase.from('products').select('id, name').in('id', allPids.slice(i, i + 200))
    ;(data || []).forEach(p => pn[p.id] = p.name)
  }

  const enrich = d => ({
    id: d.id, type: d.type, doc_number: d.doc_number, doc_date: d.doc_date,
    amount: Number(d.amount) || 0, vat: Number(d.vat_amount) || 0, hasVat: Number(d.vat_amount) > 0,
    contractor: cons[d.contractor_id] || '', generated_doc_id: d.generated_doc_id, source: d.source,
    items: (itemsByDoc[d.id] || []).map(m => ({
      name: pn[m.product_id] || (m.description || '').replace(/^.*?:\s*/, '') || '—',
      qty: Number(m.quantity) || 0, price: Number(m.price) || 0,
    })),
  })
  // Класифікація як у vatReport: вхідні (послуги/товари, які ОТРИМАЛИ) = закупівля.
  // doc_role='incoming' — головний індикатор (напр. «Акт наданих послуг» від постачальника).
  const isPurchase = d => d.doc_role === 'incoming' || d.direction === 'payable' || d.type === 'incomingWaybill'
  const purchases = docs.filter(isPurchase).map(enrich).sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || ''))
  const sales = docs.filter(d => !isPurchase(d)).map(enrich).sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || ''))

  // Транзакції (джерело P&L)
  const tx = await fetchAll('bank_transactions', 'date, amount, direction, is_validated, article, counterparty, description', q => q.gte('date', from).lte('date', to).eq('is_ignored', false))
  let income = 0, expense = 0, unvalidated = 0, noArticle = 0
  const grp = {}
  tx.forEach(t => {
    const a = Math.abs(Number(t.amount) || 0)
    if (!t.is_validated) unvalidated++
    if (!t.article) noArticle++
    if (t.is_validated && t.direction !== 'Інше' && t.direction !== 'ПФД') {
      if (t.direction === 'Доходи') income += a; else if (t.direction === 'Витрати') expense += a
    }
    // розбивка за напрямом+статтею (усі валідовані, включно з ПФД/Інше — для повноти)
    if (t.is_validated) {
      const key = `${t.direction || '—'} · ${t.article || 'без статті'}`
      const b = (grp[key] ||= { key, dir: t.direction, n: 0, sum: 0, items: [] })
      b.n++; b.sum += Number(t.amount) || 0
      b.items.push({ date: t.date, name: t.counterparty || t.description || '', amount: Number(t.amount) || 0 })
    }
  })
  const txBreakdown = Object.values(grp).sort((a, b) => a.sum - b.sum)
  txBreakdown.forEach(b => b.items.sort((x, y) => x.amount - y.amount))

  const sum = (arr, k) => arr.reduce((s, d) => s + (d[k] || 0), 0)
  // ПДВ — лише з реалізованих документів (накладні/акти); рахунки/замовлення не рахуємо (не задвоювати)
  const realSales = sales.filter(d => countsAsDebt(d.type))
  const realPurch = purchases.filter(d => countsAsDebt(d.type))
  const salesVat = sum(realSales, 'vat'), purchVat = sum(realPurch, 'vat')
  return {
    purchases, sales,
    totals: {
      salesAmount: sum(sales, 'amount'), salesVat,
      purchAmount: sum(purchases, 'amount'), purchVat,
      vatToPay: salesVat - purchVat, // зобов'язання − кредит
    },
    tx: { count: tx.length, income, expense, unvalidated, noArticle, breakdown: txBreakdown },
  }
}

// ── Рух товарів за період: куплено / продано / залишок (з цінами) ──
// Ціни рухів складу — NET (без ПДВ), єдина база (див. архітектурне рішення №17).
// price на IN = ціна закупівлі/од; price на OUT = ціна продажу/од; cost_price на OUT = собівартість/од.
// Залишкова вартість = к-сть на кінець × buy_price (остання закупівля) — як у знімку/балансі.
export async function computeGoodsReport(year, month) {
  const { from, to } = periodRange(year, month)
  const sm = await fetchAll('stock_movements', 'product_id, type, quantity, price, cost_price, date, document_id', q => q.lte('date', to))
  const agg = {}
  sm.forEach(m => {
    const q = Number(m.quantity) || 0, price = Number(m.price) || 0, cost = Number(m.cost_price) || 0
    const a = (agg[m.product_id] ||= { openQ: 0, inQ: 0, inSum: 0, outQ: 0, outSum: 0, outCost: 0, lastIn: null, lastOut: null })
    const inPeriod = m.date >= from && m.date <= to
    if (m.type === 'in') {
      if (m.date < from) a.openQ += q
      else if (inPeriod) { a.inQ += q; a.inSum += q * price }
      // документ приходу — найсвіжіша прихідна з документом (джерело ціни закупівлі)
      if (m.document_id && (!a.lastIn || m.date >= a.lastIn.date)) a.lastIn = { id: m.document_id, date: m.date }
    } else {
      if (m.date < from) a.openQ -= q
      else if (inPeriod) {
        a.outQ += q; a.outSum += q * price; a.outCost += q * cost
        // документ продажу — найсвіжіша видаткова з документом у цьому періоді
        if (m.document_id && (!a.lastOut || m.date >= a.lastOut.date)) a.lastOut = { id: m.document_id, date: m.date }
      }
    }
  })

  const pids = Object.keys(agg)
  const prodMap = {}
  for (let i = 0; i < pids.length; i += 200) {
    const { data } = await supabase.from('products').select('id, name, buy_price, product_type').in('id', pids.slice(i, i + 200))
    ;(data || []).forEach(p => prodMap[p.id] = p)
  }
  const goods = pids.filter(id => (prodMap[id]?.product_type || 'goods') === 'goods')
  const rows = goods.map(id => {
    const a = agg[id], p = prodMap[id] || {}
    const closeQ = a.openQ + a.inQ - a.outQ, unitCost = Number(p.buy_price) || 0
    return { product_id: id, name: p.name || id, ...a, closeQ, unitCost, closeVal: closeQ * unitCost, docId: a.lastIn?.id || null, saleDocId: a.lastOut?.id || null }
  })

  const purchased = rows.filter(r => r.inQ > 0.0001)
    .map(r => ({ product_id: r.product_id, name: r.name, qty: r.inQ, price: r.inQ ? r.inSum / r.inQ : 0, sum: r.inSum, docId: r.docId }))
    .sort((a, b) => b.sum - a.sum)
  const sold = rows.filter(r => r.outQ > 0.0001)
    .map(r => ({ product_id: r.product_id, name: r.name, qty: r.outQ, price: r.outQ ? r.outSum / r.outQ : 0, cost: r.outQ ? r.outCost / r.outQ : 0, revenue: r.outSum, costSum: r.outCost, margin: r.outSum - r.outCost, docId: r.saleDocId }))
    .sort((a, b) => b.revenue - a.revenue)
  const remaining = rows.filter(r => Math.abs(r.closeQ) > 0.0001)
    .map(r => ({ product_id: r.product_id, name: r.name, qty: r.closeQ, unitCost: r.unitCost, value: r.closeVal, docId: r.docId }))
    .sort((a, b) => b.value - a.value)

  const totals = {
    purchasedSum: purchased.reduce((s, r) => s + r.sum, 0),
    soldRevenue: sold.reduce((s, r) => s + r.revenue, 0),
    soldCost: sold.reduce((s, r) => s + r.costSum, 0),
    soldMargin: sold.reduce((s, r) => s + r.margin, 0),
    remainingValue: remaining.reduce((s, r) => s + r.value, 0),
  }
  return { purchased, sold, remaining, totals }
}

// ── Безперервність залишків: на початок + рух = на кінець (склад + гроші) ──
export async function computeContinuity(year, month) {
  const { from, to } = periodRange(year, month)

  // Склад
  const sm = await fetchAll('stock_movements', 'product_id, type, quantity, date', q => q.lte('date', to))
  const acc = {}
  sm.forEach(m => {
    const q = Number(m.quantity) || 0
    const a = (acc[m.product_id] ||= { open: 0, inQ: 0, outQ: 0 })
    if (m.date < from) a.open += (m.type === 'in' ? q : -q)
    else if (m.type === 'in') a.inQ += q; else a.outQ += q
  })
  const pids = Object.keys(acc)
  const prodMap = {}
  for (let i = 0; i < pids.length; i += 200) {
    const { data } = await supabase.from('products').select('id, name, buy_price, product_type').in('id', pids.slice(i, i + 200))
    ;(data || []).forEach(p => prodMap[p.id] = p)
  }
  const stockItems = pids.map(id => {
    const a = acc[id], p = prodMap[id] || {}, cost = Number(p.buy_price) || 0, close = a.open + a.inQ - a.outQ
    return { product_id: id, name: p.name || id, product_type: p.product_type, open: a.open, inQ: a.inQ, outQ: a.outQ, close, cost, openVal: a.open * cost, closeVal: close * cost }
  }).filter(x => (x.open || x.inQ || x.outQ || x.close) && (x.product_type || 'goods') === 'goods').sort((a, b) => Math.abs(b.closeVal) - Math.abs(a.closeVal))
  const stockTot = stockItems.reduce((s, x) => ({ openVal: s.openVal + x.openVal, closeVal: s.closeVal + x.closeVal }), { openVal: 0, closeVal: 0 })

  // Гроші (Банк/Каса)
  const { data: accs } = await qc('accounts').select('id, name, type, opening_balance, opening_balance_date, sort_order').order('sort_order')
  const txs = await fetchAll('bank_transactions', 'account_id, amount, date', q => q.eq('is_ignored', false).lte('date', to))
  const cash = (accs || []).map(a => {
    let openMove = 0, inflow = 0, outflow = 0
    txs.forEach(t => {
      if (t.account_id !== a.id) return
      if (a.opening_balance_date && t.date && t.date < a.opening_balance_date) return
      const amt = Number(t.amount) || 0
      if (t.date < from) openMove += amt
      else if (amt >= 0) inflow += amt; else outflow += -amt
    })
    const opening = (Number(a.opening_balance) || 0) + openMove
    return { id: a.id, name: a.name, type: a.type, opening, inflow, outflow, closing: opening + inflow - outflow }
  })
  const cashTot = cash.reduce((s, c) => ({ opening: s.opening + c.opening, inflow: s.inflow + c.inflow, outflow: s.outflow + c.outflow, closing: s.closing + c.closing }), { opening: 0, inflow: 0, outflow: 0, closing: 0 })

  return { stock: { items: stockItems, ...stockTot }, cash, cashTot }
}

// helper: посторінкова вибірка
async function fetchAll(table, cols, mod) {
  let from = 0, all = []
  while (true) {
    let q = supabase.from(table).select(cols).range(from, from + 999)
    if (mod) q = mod(q)
    const { data } = await q
    if (!data?.length) break
    all.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return all
}

// ── Звіт ПДВ за рік: зобов'язання / кредит / до сплати з ПЕРЕНОСОМ від'ємного значення ──
// Від'ємне значення (кредит > зобов'язання) переноситься й зменшує ПДВ до сплати наступних місяців —
// накопичення рахується по всій історії (в т.ч. з попередніх років), повертаються 12 місяців обраного року.
export async function vatReport(year) {
  const docs = await fetchAll('documents',
    'id, doc_number, doc_date, doc_role, direction, type, amount, vat_amount, contractor_id',
    q => q.not('doc_date', 'is', null))
  const num = x => Number(x) || 0
  const isPurch = d => d.direction === 'payable' || d.doc_role === 'incoming' || d.type === 'incomingWaybill'

  // імена контрагентів — лише для документів обраного року (для розшифровки)
  const cidsYear = [...new Set(docs.filter(d => (d.doc_date || '').slice(0, 4) === String(year)).map(d => d.contractor_id).filter(Boolean))]
  const cn = {}
  for (let i = 0; i < cidsYear.length; i += 100) {
    const { data } = await supabase.from('contractors').select('id, name').in('id', cidsYear.slice(i, i + 100))
    ;(data || []).forEach(c => cn[c.id] = c.name)
  }

  // бакети по YYYY-MM (лише реалізовані документи — не задвоювати рахунок+накладну)
  const bucket = {}
  const mk = () => ({ outVat: 0, inVat: 0, salesGross: 0, purchGross: 0, sales: [], purchases: [], noVat: 0 })
  for (const d of docs) {
    if (!d.doc_date || !countsAsDebt(d.type)) continue
    const key = d.doc_date.slice(0, 7)
    const b = (bucket[key] ||= mk())
    const row = { id: d.id, doc_number: d.doc_number, doc_date: d.doc_date, contractor: cn[d.contractor_id] || '—', amount: num(d.amount), vat: num(d.vat_amount), type: d.type }
    if (!row.vat) b.noVat++
    if (isPurch(d)) { b.inVat += row.vat; b.purchGross += row.amount; b.purchases.push(row) }
    else { b.outVat += row.vat; b.salesGross += row.amount; b.sales.push(row) }
  }

  // всі місяці від найранішого до грудня обраного року (щоб перенос протікав і через порожні місяці)
  const keys = Object.keys(bucket)
  const first = keys.length ? keys.sort()[0] : `${year}-01`
  const startY = Number(first.slice(0, 4)), startM = Number(first.slice(5, 7))
  let carry = 0 // накопичений невикористаний кредит (>=0)
  const perKey = {}
  for (let y = startY; y <= year; y++) {
    for (let mo = (y === startY ? startM : 1); mo <= 12; mo++) {
      const key = `${y}-${String(mo).padStart(2, '0')}`
      const b = bucket[key] || mk()
      const net = b.outVat - b.inVat            // місяць окремо
      const carryIn = carry
      const avail = b.inVat + carryIn           // доступний кредит з переносом
      const toPay = Math.max(0, b.outVat - avail)          // фактично до сплати
      const carryOut = Math.max(0, avail - b.outVat)        // переноситься далі
      perKey[key] = { ...b, net, carryIn, toPay, carryOut }
      carry = carryOut
      if (y > year) break
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`
    return { month: i + 1, ...(perKey[key] || { ...mk(), net: 0, carryIn: 0, toPay: 0, carryOut: 0 }) }
  })
  const totals = months.reduce((t, m) => ({
    outVat: t.outVat + m.outVat, inVat: t.inVat + m.inVat, net: t.net + m.net,
    toPay: t.toPay + m.toPay, salesGross: t.salesGross + m.salesGross, purchGross: t.purchGross + m.purchGross, noVat: t.noVat + m.noVat,
  }), { outVat: 0, inVat: 0, net: 0, toPay: 0, salesGross: 0, purchGross: 0, noVat: 0 })
  totals.carryOut = months[11]?.carryOut || 0 // невикористаний кредит на кінець року
  totals.carryIn = months[0]?.carryIn || 0    // перенесено з попередніх періодів на початок року
  return { year, months, totals }
}

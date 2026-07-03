// ── Закриття періоду: чек-лист якості, знімок, закрити/переоткрити ──
import { supabase } from './supabase'
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
  const { data: docsNoAmount } = await supabase.from('documents')
    .select('id, doc_number, type').gte('doc_date', from).lte('doc_date', to).is('amount', null)

  // 3. Невалідовані (некласифіковані) транзакції періоду — з даними для класифікації
  const { data: unclassifiedList } = await supabase.from('bank_transactions')
    .select('id, date, amount, counterparty, description, direction, article, account_id')
    .gte('date', from).lte('date', to).eq('is_ignored', false).eq('is_validated', false).order('date')

  const blockers = negativeStock.length + (docsNoAmount?.length || 0)
  return { negativeStock, docsNoAmount: docsNoAmount || [], unclassifiedTx: (unclassifiedList || []).length, unclassifiedList: unclassifiedList || [], blockers }
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
    supabase.from('accounts').select('id, name, type, opening_balance, opening_balance_date'),
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

  // Дебіторка/кредиторка станом на кінець періоду (неоплачені документи-борги без bank_transaction_id)
  const debtDocs = await fetchAll('documents', 'type, direction, amount, doc_date', q =>
    q.lte('doc_date', to).is('bank_transaction_id', null).not('amount', 'is', null))
  let receivable = 0, payable = 0
  debtDocs.forEach(d => {
    if (!countsAsDebt(d.type)) return
    const amt = Number(d.amount) || 0
    if (d.direction === 'payable') payable += amt; else receivable += amt
  })

  return {
    pl: { totals: pl.totals?.fact || null, sections: pl.sections || [] },
    margin: profit.grand || null,
    stock: { totalValue: stockValue, count: stockItems.length, items: stockItems },
    balances, cashBankTotal,
    receivable, payable,
  }
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
export async function closePeriod(year, month, userId, { notes } = {}) {
  const { data: existing } = await supabase.from('period_closings')
    .select('snapshot, closed_at').eq('period_year', year).eq('period_month', month).maybeSingle()
  const snapshot = await computeSnapshot(year, month)
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

  const docs = await fetchAll('documents', 'id, type, doc_number, doc_date, amount, vat_amount, direction, contractor_id, generated_doc_id, source', q => q.gte('doc_date', from).lte('doc_date', to))
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
    const { data: mv } = await supabase.from('stock_movements')
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
  const isPurchase = d => d.direction === 'payable' || d.type === 'incomingWaybill'
  const purchases = docs.filter(isPurchase).map(enrich).sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || ''))
  const sales = docs.filter(d => !isPurchase(d)).map(enrich).sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || ''))

  // Транзакції (джерело P&L)
  const tx = await fetchAll('bank_transactions', 'amount, direction, is_validated, article', q => q.gte('date', from).lte('date', to).eq('is_ignored', false))
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
      const b = (grp[key] ||= { key, dir: t.direction, n: 0, sum: 0 })
      b.n++; b.sum += Number(t.amount) || 0
    }
  })
  const txBreakdown = Object.values(grp).sort((a, b) => a.sum - b.sum)

  const sum = (arr, k) => arr.reduce((s, d) => s + (d[k] || 0), 0)
  return {
    purchases, sales,
    totals: {
      salesAmount: sum(sales, 'amount'), salesVat: sum(sales, 'vat'),
      purchAmount: sum(purchases, 'amount'), purchVat: sum(purchases, 'vat'),
    },
    tx: { count: tx.length, income, expense, unvalidated, noArticle, breakdown: txBreakdown },
  }
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
  const { data: accs } = await supabase.from('accounts').select('id, name, type, opening_balance, opening_balance_date, sort_order').order('sort_order')
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

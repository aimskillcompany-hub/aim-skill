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
    const { data: prods } = await supabase.from('products').select('id, name').in('id', negIds)
    const pn = {}; (prods || []).forEach(p => pn[p.id] = p.name)
    negativeStock = negIds.map(id => ({ id, name: pn[id] || id, qty: bal[id] }))
  }

  // 2. Документи періоду без суми
  const { data: docsNoAmount } = await supabase.from('documents')
    .select('id, doc_number, type').gte('doc_date', from).lte('doc_date', to).is('amount', null)

  // 3. Невалідовані (некласифіковані) транзакції періоду
  const { count: unclassifiedTx } = await supabase.from('bank_transactions')
    .select('id', { count: 'exact', head: true })
    .gte('date', from).lte('date', to).eq('is_ignored', false).eq('is_validated', false)

  const blockers = negativeStock.length + (docsNoAmount?.length || 0)
  return { negativeStock, docsNoAmount: docsNoAmount || [], unclassifiedTx: unclassifiedTx || 0, blockers }
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
    const { data } = await supabase.from('products').select('id, name, buy_price').in('id', pids.slice(i, i + 200))
    ;(data || []).forEach(p => prodMap[p.id] = p)
  }
  let stockValue = 0
  const stockItems = pids.map(id => {
    const qty = bal[id], unit = Number(prodMap[id]?.buy_price) || 0, value = qty * unit
    stockValue += value
    return { product_id: id, name: prodMap[id]?.name || id, qty, unit_cost: unit, value }
  }).filter(x => Math.abs(x.qty) > 0.0001).sort((a, b) => b.value - a.value)

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

// ── Закрити період ──
export async function closePeriod(year, month, userId, { notes } = {}) {
  const snapshot = await computeSnapshot(year, month)
  const payload = {
    period_year: year, period_month: month, status: 'closed',
    snapshot, notes: notes || null, closed_by: userId || null,
    closed_at: new Date().toISOString(), reopened_at: null, reopened_by: null,
  }
  // upsert по унікальному (рік,місяць) — повторне закриття перезаписує знімок
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
    const { data } = await supabase.from('products').select('id, name, buy_price').in('id', pids.slice(i, i + 200))
    ;(data || []).forEach(p => prodMap[p.id] = p)
  }
  const stockItems = pids.map(id => {
    const a = acc[id], cost = Number(prodMap[id]?.buy_price) || 0, close = a.open + a.inQ - a.outQ
    return { product_id: id, name: prodMap[id]?.name || id, open: a.open, inQ: a.inQ, outQ: a.outQ, close, cost, openVal: a.open * cost, closeVal: close * cost }
  }).filter(x => x.open || x.inQ || x.outQ || x.close).sort((a, b) => Math.abs(b.closeVal) - Math.abs(a.closeVal))
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

// Аналітика: P&L (Факт/План), Борги (Aging), Dashboard.
// Принципи ТЗ: у P&L лише is_validated транзакції; борги = документи − прив'язані транзакції.
import { supabase } from './supabase'
import { PL_ORDER, PL_LABELS, PL_SIGN } from './articles'
import { getAccountBalances } from './accounts'
import { countsAsDebt } from './debts'

const pad = n => String(n).padStart(2, '0')
const monthEnd = (y, m) => new Date(y, m, 0).getDate()

export function periodRange(year, month) {
  if (month) return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(monthEnd(year, month))}`, ym: `${year}-${pad(month)}` }
  return { from: `${year}-01-01`, to: `${year}-12-31`, ym: null }
}

// ── P&L Факт + План по статтях, структуровано за pl_level ──
export async function computePL(year, month) {
  const { from, to, ym } = periodRange(year, month)
  const [{ data: txs }, { data: arts }, { data: plans }] = await Promise.all([
    supabase.from('bank_transactions').select('amount, article, direction').eq('is_validated', true).eq('is_ignored', false).gte('date', from).lte('date', to),
    supabase.from('articles').select('name, type, pl_level, sort_order'),
    supabase.from('plans').select('article, amount, year_month'),
  ])
  const meta = {}; (arts || []).forEach(a => { meta[a.name] = a })

  const fact = {}; (txs || []).forEach(t => {
    if (!t.article || t.direction === 'Інше' || t.direction === 'ПФД') return
    fact[t.article] = (fact[t.article] || 0) + Math.abs(Number(t.amount) || 0)
  })
  const plan = {}; (plans || []).forEach(p => {
    if (!p.article) return
    if (month && p.year_month !== ym) return
    if (!month && !(p.year_month || '').startsWith(String(year))) return
    plan[p.article] = (plan[p.article] || 0) + Math.abs(Number(p.amount) || 0)
  })

  // зібрати рядки по pl_level
  const levels = PL_ORDER.filter(k => !k.startsWith('_'))
  const names = new Set([...Object.keys(fact), ...Object.keys(plan)])
  const sections = levels.map(level => {
    const rows = [...names]
      .filter(n => (meta[n]?.pl_level || (meta[n]?.type === 'income' ? 'revenue' : 'opex')) === level)
      .map(n => ({ name: n, fact: fact[n] || 0, plan: plan[n] || 0, sort: meta[n]?.sort_order || 999 }))
      .filter(r => r.fact || r.plan)
      .sort((a, b) => a.sort - b.sort)
    const factSum = rows.reduce((s, r) => s + r.fact, 0)
    const planSum = rows.reduce((s, r) => s + r.plan, 0)
    return { level, label: PL_LABELS[level], sign: PL_SIGN[level] || 1, rows, factSum, planSum }
  }).filter(s => s.rows.length)

  // підсумки (waterfall)
  const get = (lvl, key) => sections.find(s => s.level === lvl)?.[key] || 0
  const wf = (key) => {
    const rev = get('revenue', key), cogs = get('cogs', key), opex = get('opex', key)
    const oth = get('other_income', key), below = get('below_line', key)
    const gp = rev - cogs, ebit = gp - opex, np = ebit + oth, net = np - below
    return { revenue: rev, cogs, gp, opex, ebit, other_income: oth, np, below_line: below, net }
  }
  return { sections, totals: { fact: wf('factSum'), plan: wf('planSum') }, hasPlan: Object.keys(plan).length > 0 }
}

// ── P&L Факт по періодах (матриця): рік → місяці, місяць → дні ──
const MONTHS_UA = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']

export async function computePLBreakdown(year, month, opts = {}) {
  const includePending = !!opts.includePending
  const { from, to } = periodRange(year, month)
  const [{ data: txs }, { data: arts }] = await Promise.all([
    supabase.from('bank_transactions').select('amount, article, direction, date, is_validated').eq('is_ignored', false).gte('date', from).lte('date', to),
    supabase.from('articles').select('name, type, pl_level, sort_order'),
  ])
  const meta = {}; (arts || []).forEach(a => { meta[a.name] = a })

  const cols = month
    ? Array.from({ length: monthEnd(year, month) }, (_, i) => ({ key: String(i + 1), label: String(i + 1) }))
    : MONTHS_UA.map((m, i) => ({ key: String(i + 1), label: m }))
  const bucketOf = (d) => month ? String(Number(d.slice(8, 10))) : String(Number(d.slice(5, 7)))

  const factV = {}, factP = {} // article -> { bucketKey: sum }: V=підтверджені, P=непідтверджені (превʼю)
  ;(txs || []).forEach(t => {
    if (!t.article || t.direction === 'Інше' || t.direction === 'ПФД') return
    if (!t.is_validated && !includePending) return
    const tgt = t.is_validated ? factV : factP
    const b = bucketOf(t.date)
    ;(tgt[t.article] ||= {})[b] = (tgt[t.article][b] || 0) + Math.abs(Number(t.amount) || 0)
  })
  const sumCells = (m) => Object.values(m || {}).reduce((s, v) => s + v, 0)

  const levels = PL_ORDER.filter(k => !k.startsWith('_'))
  const names = includePending ? [...new Set([...Object.keys(factV), ...Object.keys(factP)])] : Object.keys(factV)
  const secByLevel = {}
  levels.forEach(level => {
    const rows = names
      .filter(n => (meta[n]?.pl_level || (meta[n]?.type === 'income' ? 'revenue' : 'opex')) === level)
      .map(n => ({ name: n, cells: factV[n] || {}, total: sumCells(factV[n]), pending: factP[n] || {}, pendingTotal: sumCells(factP[n]), sort: meta[n]?.sort_order || 999 }))
      .filter(r => r.total || r.pendingTotal).sort((a, b) => a.sort - b.sort)
    const totals = {}, pendingTotals = {}
    cols.forEach(c => {
      totals[c.key] = rows.reduce((s, r) => s + (r.cells[c.key] || 0), 0)
      pendingTotals[c.key] = rows.reduce((s, r) => s + (r.pending[c.key] || 0), 0)
    })
    secByLevel[level] = { rows, totals, pendingTotals, total: rows.reduce((s, r) => s + r.total, 0), pendingTotal: rows.reduce((s, r) => s + r.pendingTotal, 0) }
  })

  const st = (src, lvl, key) => {
    const s = secByLevel[lvl]; if (!s) return 0
    if (key === 'total') return src === 'p' ? s.pendingTotal : s.total
    return (src === 'p' ? s.pendingTotals : s.totals)[key] || 0
  }
  const wf = (src, kind, key) => {
    const rev = st(src, 'revenue', key), cogs = st(src, 'cogs', key), opex = st(src, 'opex', key), oth = st(src, 'other_income', key), below = st(src, 'below_line', key)
    if (kind === 'gp') return rev - cogs
    if (kind === 'ebit') return rev - cogs - opex
    if (kind === 'np') return rev - cogs - opex + oth
    if (kind === 'net') return rev - cogs - opex + oth - below
    return 0
  }
  const cellsFor = (src, kind) => { const c = {}; cols.forEach(col => { c[col.key] = wf(src, kind, col.key) }); return c }

  const out = []
  PL_ORDER.forEach(key => {
    if (key.startsWith('_')) {
      const kind = { _gp: 'gp', _ebit: 'ebit', _np: 'np', _net: 'net' }[key]
      out.push({ type: 'subtotal', label: PL_LABELS[key], cells: cellsFor('v', kind), total: wf('v', kind, 'total'), pending: cellsFor('p', kind), pendingTotal: wf('p', kind, 'total') })
    } else {
      const sec = secByLevel[key]
      if (!sec || !sec.rows.length) return
      out.push({ type: 'header', label: PL_LABELS[key], level: key, articles: sec.rows.map(r => r.name), cells: sec.totals, total: sec.total, pending: sec.pendingTotals, pendingTotal: sec.pendingTotal })
      sec.rows.forEach(r => out.push({ type: 'row', label: r.name, level: key, articles: [r.name], cells: r.cells, total: r.total, pending: r.pending, pendingTotal: r.pendingTotal }))
    }
  })
  return { cols, rows: out, hasPending: Object.keys(factP).length > 0 }
}

// ── Drill-down: транзакції, що формують клітинку P&L ──
export async function plDrill(year, month, bucketKey, articleNames, opts = {}) {
  let from, to
  if (month) {
    if (bucketKey === 'total') ({ from, to } = periodRange(year, month))
    else { const d = `${year}-${pad(month)}-${pad(Number(bucketKey))}`; from = d; to = d }
  } else {
    if (bucketKey === 'total') ({ from, to } = periodRange(year, null))
    else { const m = Number(bucketKey); from = `${year}-${pad(m)}-01`; to = `${year}-${pad(m)}-${pad(monthEnd(year, m))}` }
  }
  const { data } = await supabase.from('bank_transactions')
    .select('id, date, amount, article, direction, counterparty, contractor_id, description')
    .eq('is_validated', opts.validated === false ? false : true).eq('is_ignored', false)
    .gte('date', from).lte('date', to)
    .in('article', articleNames)
    .order('date', { ascending: true })
  return (data || []).filter(t => t.direction !== 'Інше' && t.direction !== 'ПФД')
}

// ── Звіт рентабельності по видаткових накладних (реалізація) ──
// Джерело: складські OUT-рухи, прив'язані до документа. price = ціна продажу/од (net),
// cost_price = FIFO собівартість/од (net). ПДВ 20% для колонок «з ПДВ». Податок на дохід 18%.
export async function salesProfitReport(year, month) {
  const { from, to } = periodRange(year, month)
  const { data: movs } = await supabase.from('stock_movements')
    .select('product_id, document_id, quantity, price, cost_price, date, description')
    .eq('type', 'out').not('document_id', 'is', null).gte('date', from).lte('date', to)
  if (!movs?.length) return { groups: [], grand: null }

  const docIds = [...new Set(movs.map(m => m.document_id))]
  const prodIds = [...new Set(movs.map(m => m.product_id).filter(Boolean))]
  const [{ data: docs }, { data: prods }] = await Promise.all([
    supabase.from('documents').select('id, type, doc_number, doc_date, contractors(name)').in('id', docIds),
    prodIds.length ? supabase.from('products').select('id, name').in('id', prodIds) : Promise.resolve({ data: [] }),
  ])
  const docMap = {}; (docs || []).forEach(d => { docMap[d.id] = d })
  const prodMap = {}; (prods || []).forEach(p => { prodMap[p.id] = p })

  const calcRow = (name, qty, sellUnitNet, costUnitNet) => {
    const sellNet = qty * sellUnitNet, costNet = qty * costUnitNet
    const gross = sellNet - costNet            // Валовий прибуток
    const marginGross = gross * 1.2            // Маржа з ПДВ
    const vat = gross * 0.2                     // ПДВ (з маржі)
    const net = gross / 1.18                    // Чистий
    const tax = gross - net                     // Податок на дохід (18%)
    return {
      name, qty,
      sellUnit: sellUnitNet * 1.2, sellSum: sellNet * 1.2,
      costUnit: costUnitNet * 1.2, costSum: costNet * 1.2,
      marginUnit: qty ? marginGross / qty : 0, marginSum: marginGross,
      marginPct: sellNet ? gross / sellNet : 0,
      vat, gross, tax, net,
    }
  }

  const byDoc = {}
  for (const m of movs) {
    const d = docMap[m.document_id]; if (!d) continue
    ;(byDoc[m.document_id] ||= { doc: d, rows: [] })
    byDoc[m.document_id].rows.push(calcRow(
      prodMap[m.product_id]?.name || (m.description || '').replace(/^.*?:\s*/, '') || '—',
      Number(m.quantity) || 0, Number(m.price) || 0, Number(m.cost_price) || 0,
    ))
  }

  const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0)
  const groups = Object.values(byDoc).map(g => ({
    doc: g.doc, rows: g.rows,
    totals: { sellSum: sum(g.rows, 'sellSum'), costSum: sum(g.rows, 'costSum'), marginSum: sum(g.rows, 'marginSum'), vat: sum(g.rows, 'vat'), gross: sum(g.rows, 'gross'), tax: sum(g.rows, 'tax'), net: sum(g.rows, 'net') },
  })).sort((a, b) => (a.doc.doc_date || '').localeCompare(b.doc.doc_date || ''))

  const allRows = groups.flatMap(g => g.rows)
  const grand = { sellSum: sum(allRows, 'sellSum'), costSum: sum(allRows, 'costSum'), marginSum: sum(allRows, 'marginSum'), vat: sum(allRows, 'vat'), gross: sum(allRows, 'gross'), tax: sum(allRows, 'tax'), net: sum(allRows, 'net') }
  return { groups, grand }
}

// ── Борги (Aging): по документах мінус прив'язані транзакції ──
const BUCKETS = [['0-7', 0, 7], ['8-14', 8, 14], ['15-30', 15, 30], ['30+', 31, Infinity]]

export async function computeAging() {
  const today = new Date()
  const [{ data: docs }, { data: tdocs }, { data: contractors }] = await Promise.all([
    supabase.from('documents').select('id, contractor_id, amount, direction, type, doc_date, created_at').not('amount', 'is', null).not('direction', 'is', null),
    supabase.from('transaction_documents').select('document_id, amount'),
    supabase.from('contractors').select('id, name'),
  ])
  const paidByDoc = {}; (tdocs || []).forEach(t => { paidByDoc[t.document_id] = (paidByDoc[t.document_id] || 0) + Math.abs(Number(t.amount) || 0) })
  const cname = {}; (contractors || []).forEach(c => { cname[c.id] = c.name })

  const make = () => ({ total: 0, buckets: Object.fromEntries(BUCKETS.map(b => [b[0], 0])), byContractor: {} })
  const recv = make(), pay = make()

  ;(docs || []).forEach(d => {
    if (!countsAsDebt(d.type)) return // рахунок/замовлення не створюють борг (захист від подвоєння)
    const outstanding = (Math.abs(Number(d.amount) || 0)) - (paidByDoc[d.id] || 0)
    if (outstanding <= 0.5) return
    const ageDays = Math.floor((today - new Date(d.doc_date || d.created_at)) / 864e5)
    const bucket = BUCKETS.find(b => ageDays >= b[1] && ageDays <= b[2])?.[0] || '30+'
    const tgt = d.direction === 'receivable' ? recv : d.direction === 'payable' ? pay : null
    if (!tgt) return
    tgt.total += outstanding
    tgt.buckets[bucket] += outstanding
    const key = d.contractor_id || 'unknown'
    tgt.byContractor[key] = (tgt.byContractor[key] || 0) + outstanding
  })

  const topList = (obj) => Object.entries(obj.byContractor)
    .map(([id, amt]) => ({ name: cname[id] || 'Без контрагента', amount: amt }))
    .sort((a, b) => b.amount - a.amount)

  return {
    receivable: { ...recv, top: topList(recv) },
    payable: { ...pay, top: topList(pay) },
    bucketKeys: BUCKETS.map(b => b[0]),
  }
}

// ── Dashboard: KPI + помісячний ряд + топ клієнтів ──
export async function dashboardStats(year) {
  const monthStart = new Date(); monthStart.setDate(1)
  const mFrom = monthStart.toISOString().split('T')[0]
  const yFrom = `${year}-01-01`

  const [{ data: monthTxs }, { data: yearTxs }, balances, aging] = await Promise.all([
    supabase.from('bank_transactions').select('amount, direction').eq('is_validated', true).eq('is_ignored', false).gte('date', mFrom),
    supabase.from('bank_transactions').select('amount, direction, date, counterparty, contractor_id').eq('is_validated', true).eq('is_ignored', false).gte('date', yFrom),
    getAccountBalances(),
    computeAging(),
  ])

  const sum = (arr, dir) => (arr || []).filter(t => t.direction === dir).reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)
  const revenue = sum(monthTxs, 'Доходи'), expenses = sum(monthTxs, 'Витрати')

  // помісячний ряд
  const series = Array.from({ length: 12 }, (_, i) => ({ month: `${pad(i + 1)}`, Доходи: 0, Витрати: 0 }))
  ;(yearTxs || []).forEach(t => {
    const m = Number((t.date || '').slice(5, 7)) - 1
    if (m < 0 || m > 11) return
    if (t.direction === 'Доходи') series[m].Доходи += Math.abs(Number(t.amount) || 0)
    else if (t.direction === 'Витрати') series[m].Витрати += Math.abs(Number(t.amount) || 0)
  })

  // баланси рахунків (спільний хелпер: усі неігноровані + початковий залишок)
  const accounts = balances.map(b => ({ name: b.name, balance: b.balance }))
  const totalBalance = balances.reduce((s, b) => s + b.balance, 0)

  // топ клієнтів по доходах за рік
  const byClient = {}
  ;(yearTxs || []).filter(t => t.direction === 'Доходи').forEach(t => {
    const key = t.counterparty || 'Інші'
    byClient[key] = (byClient[key] || 0) + Math.abs(Number(t.amount) || 0)
  })
  const topClients = Object.entries(byClient).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8)

  return {
    revenue, expenses, profit: revenue - expenses,
    receivable: aging.receivable.total, payable: aging.payable.total,
    accounts, totalBalance, series, topClients,
  }
}

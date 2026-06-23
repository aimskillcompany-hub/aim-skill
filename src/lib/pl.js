// Аналітика: P&L (Факт/План), Борги (Aging), Dashboard.
// Принципи ТЗ: у P&L лише is_validated транзакції; борги = документи − прив'язані транзакції.
import { supabase } from './supabase'
import { PL_ORDER, PL_LABELS, PL_SIGN } from './articles'
import { getAccountBalances } from './accounts'

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

// ── Борги (Aging): по документах мінус прив'язані транзакції ──
const BUCKETS = [['0-7', 0, 7], ['8-14', 8, 14], ['15-30', 15, 30], ['30+', 31, Infinity]]

export async function computeAging() {
  const today = new Date()
  const [{ data: docs }, { data: tdocs }, { data: contractors }] = await Promise.all([
    supabase.from('documents').select('id, contractor_id, amount, direction, created_at').not('amount', 'is', null).not('direction', 'is', null),
    supabase.from('transaction_documents').select('document_id, amount'),
    supabase.from('contractors').select('id, name'),
  ])
  const paidByDoc = {}; (tdocs || []).forEach(t => { paidByDoc[t.document_id] = (paidByDoc[t.document_id] || 0) + Math.abs(Number(t.amount) || 0) })
  const cname = {}; (contractors || []).forEach(c => { cname[c.id] = c.name })

  const make = () => ({ total: 0, buckets: Object.fromEntries(BUCKETS.map(b => [b[0], 0])), byContractor: {} })
  const recv = make(), pay = make()

  ;(docs || []).forEach(d => {
    const outstanding = (Math.abs(Number(d.amount) || 0)) - (paidByDoc[d.id] || 0)
    if (outstanding <= 0.5) return
    const ageDays = Math.floor((today - new Date(d.created_at)) / 864e5)
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

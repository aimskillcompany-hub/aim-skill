// Платіжний календар (ТЗ 04, розділ «Прогноз» → вкладка «Платіжний календар»).
// Рядки — ті самі, що в «Графіку платежів» замовлень «в прогнозі» (buildOrderForecasts → lines, залишок до оплати),
// плюс ручні рядки прогнозу. Тут лише розрахунки (чисті функції) і пошук уже сплачених платежів у виписці.
import { supabase } from './supabase'

const EPS = 0.005
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const dayMs = 86400000
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / dayMs)
export const addDaysIso = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * dayMs).toISOString().slice(0, 10)

export const GROUPS = [
  { id: 'client', label: 'Надходження від клієнтів' },
  { id: 'supplier', label: 'Оплати постачальникам' },
  { id: 'vat', label: 'ПДВ до сплати' },
  { id: 'agent', label: 'Агентські' },
  { id: 'manual', label: 'Інші надходження й витрати' },
]

// Тип рядка (ТЗ 2.1): надходження > 0 → клієнт; «ПДВ» у назві; агентські; решта — оплата постачальнику
export function lineType(l) {
  if (l.kind === 'income') return 'client'
  if (/ПДВ/.test(l.label || '')) return 'vat'
  if (l.key === 'agent') return 'agent'
  return 'supplier'
}

// Плаский список рухів: прострочені й без дати — на сьогодні (overdue / estimated)
export function calendarRows({ orders = [], manual = [], today, co = 'all' }) {
  const out = []
  orders.filter(o => co === 'all' || o.companyId === co).forEach(o => (o.lines || []).forEach(l => {
    if (!(l.remaining > EPS)) return
    const type = lineType(l)
    const orig = l.date ? String(l.date).slice(0, 10) : null
    const overdue = !!orig && orig < today
    const counterparty = type === 'client' ? o.client
      : type === 'supplier' ? (l.supplierId ? l.label : (l.key === 'other' ? 'Інші витрати' : 'Постачальник не вказаний'))
      : type === 'vat' ? 'ПДВ' : 'Агентські'
    out.push({
      orderId: o.id, number: o.number, client: o.client, managerId: o.managerId || null, companyId: o.companyId,
      type, key: l.key, supplierId: l.supplierId || null, counterparty,
      amount: r2(l.kind === 'income' ? l.remaining : -l.remaining),
      origDate: orig, date: !orig || orig < today ? today : orig, overdue, estimated: !!l.estimated,
    })
  }))
  manual.filter(m => co === 'all' || m.company_id === co).forEach(m => {
    const amt = Number(m.amount) || 0
    if (!(amt > EPS)) return
    const orig = m.expected_date ? String(m.expected_date).slice(0, 10) : null
    out.push({
      orderId: null, number: null, client: null, companyId: m.company_id, type: 'manual', key: 'manual-' + m.id,
      counterparty: m.note || (m.kind === 'income' ? 'Надходження' : 'Витрата'),
      amount: r2(m.kind === 'income' ? amt : -amt),
      origDate: orig, date: !orig || orig < today ? today : orig, overdue: !!orig && orig < today, estimated: false,
    })
  })
  return out
}

// Залишок по днях (ТЗ 2.2): на початок = кінець попереднього; чистий потік = сума рядків дня
export function dailyBalance(rows, startCash, today) {
  const by = {}
  rows.forEach(r => { const d = (by[r.date] ||= { inc: 0, out: 0 }); if (r.amount >= 0) d.inc += r.amount; else d.out += r.amount })
  const dates = [...new Set([today, ...Object.keys(by)])].filter(d => d >= today).sort()
  let bal = r2(startCash)
  return dates.map(date => {
    const d = by[date] || { inc: 0, out: 0 }
    const start = bal, net = r2(d.inc + d.out)
    bal = r2(start + net)
    return { date, start, inc: r2(d.inc), out: r2(d.out), net, end: bal }
  })
}

// Найглибший розрив: день із найменшим залишком на кінець (< 0); межі мінусу — суцільний проміжок навколо нього
export function deepestGap(days) {
  if (!days.length) return null
  let idx = 0
  days.forEach((d, i) => { if (d.end < days[idx].end) idx = i })
  const deep = days[idx]
  if (!(deep.end < -EPS)) return null
  let s = idx; while (s > 0 && days[s - 1].end < -EPS) s--
  let e = idx + 1; while (e < days.length && days[e].end < -EPS) e++
  const endDate = e < days.length ? days[e].date : null
  return { date: deep.date, value: deep.end, idx, from: days[s].date, to: endDate, duration: endDate ? daysBetween(days[s].date, endDate) : null }
}

// Головна причина (ТЗ 2.3): найбільші виплати в день розриву за замовленням; частка від модуля розриву
export function mainCause(rows, gap, startCash, today) {
  if (!gap) return null
  const by = {}
  rows.filter(r => r.date === gap.date && r.amount < 0 && r.orderId).forEach(r => { by[r.orderId] = (by[r.orderId] || 0) - r.amount })
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0]
  if (!top) return null
  const [orderId, paid] = top
  const oRows = rows.filter(r => r.orderId === orderId)
  const first = oRows[0]
  const clientRows = oRows.filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount)
  const without = dailyBalance(rows.filter(r => r.orderId !== orderId), startCash, today)
  const low = without.reduce((a, d) => (!a || d.end < a.end ? d : a), null)
  return {
    orderId, number: first.number, client: first.client, paid: r2(paid), share: paid / Math.abs(gap.value),
    clientDate: clientRows[0]?.date || null,
    withoutMin: low ? low.end : null, withoutDate: low ? low.date : null,
  }
}

// «Які замовлення тримають гроші» (ТЗ 2.5): мінімум наростаючого підсумку рядків замовлення
export function holdingOrders(rows, limit = 8) {
  const by = {}
  rows.filter(r => r.orderId).forEach(r => (by[r.orderId] ||= []).push(r))
  const out = []
  Object.values(by).forEach(list => {
    const s = [...list].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
    const byDay = []
    s.forEach(r => { const last = byDay[byDay.length - 1]; if (last && last.date === r.date) last.amount += r.amount; else byDay.push({ date: r.date, amount: r.amount }) })
    let cum = 0, min = 0, minI = -1, from = null
    byDay.forEach((d, i) => { cum += d.amount; if (cum < -EPS && from == null) from = d.date; if (cum < min) { min = cum; minI = i } })
    if (!(min < -EPS)) return
    // початок — коли підсумок востаннє став < 0 перед мінімумом
    cum = 0; let start = null
    byDay.forEach((d, i) => { const prev = cum; cum += d.amount; if (i <= minI && cum < -EPS && !(prev < -EPS)) start = d.date })
    cum = 0; let back = null
    byDay.forEach((d, i) => { cum += d.amount; if (i > minI && back == null && cum >= -EPS) back = d.date })
    const f = s[0]
    out.push({ orderId: f.orderId, number: f.number, client: f.client, hold: r2(min), from: start || from, to: back, days: back ? daysBetween(start || from, back) : null, net: r2(s.reduce((a, r) => a + r.amount, 0)) })
  })
  return out.sort((a, b) => a.hold - b.hold).slice(0, limit)
}

// Усе для сторінки: рядки, дні, розрив, причина, підсумки, «тримають гроші»
export function buildCalendar({ orders, manual, startCash, today, co = 'all', exclude = null }) {
  const allRows = calendarRows({ orders, manual, today, co })
  const days0 = dailyBalance(allRows, startCash, today)
  const gap0 = deepestGap(days0)
  const cause = mainCause(allRows, gap0, startCash, today)
  const strong = cause && cause.share >= 0.5 ? cause : null
  const exNum = exclude && allRows.some(r => r.number === exclude) ? exclude : null
  const rows = exNum ? allRows.filter(r => r.number !== exNum) : allRows
  const days = exNum ? dailyBalance(rows, startCash, today) : days0
  const gap = exNum ? deepestGap(days) : gap0
  const inc = r2(rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0))
  const out = r2(rows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0))
  const last = days[days.length - 1]
  return {
    rows, days, gap, cause: strong, excluded: exNum,
    totals: { start: r2(startCash), inc, out, end: last ? last.end : r2(startCash), lastDate: last ? last.date : today },
    holding: holdingOrders(rows),
    orderCount: new Set(rows.filter(r => r.orderId).map(r => r.orderId)).size,
  }
}

// ── «Можливо, вже оплачено» (ТЗ 2.6) ──
const normName = (s) => String(s || '').toLowerCase()
  .replace(/товариство\s+з\s+обмеженою\s+відповідальністю/g, 'тов').replace(/[«»"'`ʼ’.,]/g, '').replace(/\s+/g, ' ').trim()
export const amountMatches = (tx, plan) => Math.abs(Math.abs(tx) - plan) <= Math.max(plan * 0.01, 50)

// Чиста частина: пари «прострочений рядок постачальнику ↔ неприв'язана (або не до кінця розподілена) витрата у виписці».
// 1) повний збіг: сума ±1% або ±50 ₴, виписка за 30 днів; 2) часткові: решта вільних витрат того самого постачальника
// (за 90 днів) розподіляється на його прострочені рядки — від найстаріших; одна витрата може закрити кілька замовлень.
// tx.free — ще не розподілена сума транзакції (за замовчуванням уся).
export const PARTIAL_DAYS = 90
export function matchPaid(lines, txs, sups, today) {
  const pairs = []
  const free = {}; txs.forEach(t => { free[t.id] = r2(t.free != null ? t.free : Math.abs(Number(t.amount) || 0)) })
  const left = {}; lines.forEach(l => { left[l.key + '|' + l.orderId] = Math.abs(l.amount) })
  const lk = (l) => l.key + '|' + l.orderId
  const sameSup = (t, l, sup) => t.contractor_id === l.supplierId || (sup.edrpou ? t.edrpou === sup.edrpou : (normName(t.counterparty) && normName(t.counterparty) === normName(sup.name)))
  const since30 = addDaysIso(today, -30), since90 = addDaysIso(today, -PARTIAL_DAYS)
  const okDate = (t, l, since) => t.date >= since && t.date >= addDaysIso(l.origDate || today, -30)
  // 1) повний збіг
  ;[...lines].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).forEach(l => {
    const sup = sups[l.supplierId]; if (!sup) return
    const plan = Math.abs(l.amount)
    const cands = txs.filter(t => free[t.id] > 0.5 && okDate(t, l, since30) && amountMatches(free[t.id], plan) && sameSup(t, l, sup))
    const best = cands.sort((a, b) => Math.abs(free[a.id] - plan) - Math.abs(free[b.id] - plan))[0]
    if (best) { pairs.push({ line: l, tx: best, amount: r2(free[best.id]), partial: false }); free[best.id] = 0; left[lk(l)] = 0 }
  })
  // 2) часткові
  const bySup = {}
  lines.filter(l => left[lk(l)] > 0.5 && sups[l.supplierId]).forEach(l => (bySup[l.supplierId] ||= []).push(l))
  Object.values(bySup).forEach(ls => {
    ls.sort((a, b) => String(a.origDate).localeCompare(String(b.origDate)) || String(a.number).localeCompare(String(b.number)))
    const sup = sups[ls[0].supplierId]
    txs.filter(t => free[t.id] > 0.5 && sameSup(t, ls[0], sup)).sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
      ls.forEach(l => {
        if (free[t.id] <= 0.5 || left[lk(l)] <= 0.5 || !okDate(t, l, since90)) return
        const amt = r2(Math.min(free[t.id], left[lk(l)]))
        pairs.push({ line: l, tx: t, amount: amt, partial: true })
        free[t.id] = r2(free[t.id] - amt); left[lk(l)] = r2(left[lk(l)] - amt)
      })
    })
  })
  return pairs
}

export async function findPossiblyPaid(rows, today) {
  const lines = rows.filter(r => r.type === 'supplier' && r.overdue && r.supplierId && r.orderId)
  if (!lines.length) return []
  const supIds = [...new Set(lines.map(l => l.supplierId))]
  const { data: cs } = await supabase.from('contractors').select('id, name, edrpou').in('id', supIds)
  const sups = {}; (cs || []).forEach(c => { sups[c.id] = c })
  const { data: txs, error } = await supabase.from('bank_transactions').select('id, date, amount, counterparty, edrpou, contractor_id, direction')
    .eq('is_ignored', false).lt('amount', 0).gte('date', addDaysIso(today, -PARTIAL_DAYS)).limit(5000)
  if (error) throw error
  const ids = (txs || []).map(t => t.id)
  if (!ids.length) return []
  const used = {}, direct = new Set()
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const [{ data: ot }, { data: po }] = await Promise.all([
      supabase.from('order_transactions').select('transaction_id, amount').in('transaction_id', part),
      supabase.from('orders').select('paid_transaction_id').in('paid_transaction_id', part),
    ])
    ;(ot || []).forEach(x => { used[x.transaction_id] = (used[x.transaction_id] || 0) + Math.abs(Number(x.amount) || 0) })
    ;(po || []).forEach(x => direct.add(x.paid_transaction_id))
  }
  const avail = (txs || []).filter(t => !direct.has(t.id))
    .map(t => ({ ...t, free: r2(Math.abs(Number(t.amount) || 0) - (used[t.id] || 0)) }))
    .filter(t => t.free > 0.5)
  return matchPaid(lines, avail, sups, today)
}

export const pairKey = (p) => `${p.tx.id}|${p.line.orderId}|${p.line.key}`

// Прив'язати транзакцію (або її частину) до замовлення як оплату постачальнику (те саме, що «Прив'язати з виписки» в замовленні)
export async function linkPaidPair({ line, tx, amount, partial }, userId) {
  const { error } = await supabase.from('order_transactions').insert({
    order_id: line.orderId, transaction_id: tx.id, kind: 'expense', amount: r2(amount != null ? amount : Math.abs(Number(tx.amount) || 0)),
    note: partial ? 'Платіжний календар: часткова оплата' : 'Платіжний календар: можливо, вже оплачено', created_by: userId || null,
  })
  if (error) throw error
}

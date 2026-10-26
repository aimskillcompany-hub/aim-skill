// «Прогноз» грошових потоків — будується ІЗ ЗАМОВЛЕНЬ (orders.in_forecast=true), а не вводиться вручну.
// Кожне замовлення генерує рядки: план (з позицій, computeOrderPlan) − факт (прив'язані оплати) = залишок.
// Ручними лишаються лише витрати БЕЗ замовлення (forecast_items.order_id is null: оренда, зарплата…).
// Консолідовано по ВСІХ юрособах (читаємо напряму, без скоупу — у таблицях є company_id).
//
// Рядки замовлення:
//   ↓ Оплата дебіторки   — частина продажу, вже відвантажена (видаткові/акти), ще не оплачена
//   ↓ Оплата від клієнта — решта продажу (ще не відвантажено)
//   ↑ Постачальник X     — собівартість + ПДВ закупівлі, окремо на кожного постачальника
//                          (частина з уже отриманими прихідними — «кредиторка»)
//   ↑ ПДВ до сплати      — ПДВ продажу − ПДВ закупівлі; до 30-го числа місяця після відвантаження
//   ↑ Агентські          — після оплати клієнта; 0, якщо на замовленні відмічено «комісію сплачено»
//   ↑ Інші витрати       — блок «Інші витрати» в «Прибутковості»
// Податок на прибуток 18% у прогноз НЕ входить (рішення власника) → Σ плану = чистий прибуток + податок 18%.
//
// Для балансу: оплата дебіторки / кредиторки змінює лише гроші, не капітал (борг уже в балансі) —
// тому окремо повертаємо receivableCollect і payablePay.
import { supabase } from './supabase'
import { computeOrderPlan, expenseNet, itemCost } from './orderPlan'
import { countsAsDebt, debtDate, loadDocPayments } from './debts'
import { fetchAll } from './fetchAll'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
const todayIso = () => iso(new Date())
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + (Number(n) || 0)); return iso(x) }
// ПДВ за місяць відвантаження — до 30-го числа наступного місяця (у лютому — останній день)
const vatDueFor = (shipDate) => {
  const x = new Date(shipDate + 'T00:00:00')
  const lastOfNext = new Date(x.getFullYear(), x.getMonth() + 2, 0).getDate()
  return iso(new Date(x.getFullYear(), x.getMonth() + 1, Math.min(30, lastOfNext)))
}

export const DEFAULT_SHIP_DAYS = 14   // відвантаження за замовчуванням: сьогодні + 14 дн. (орієнтовно)
export const DEFAULT_CLIENT_DAYS = 30 // оплата клієнта: через 30 дн. після відвантаження
const EPS = 0.5

// Факт оплат з кількох джерел прив'язки без подвійного рахунку:
// perTx — сума по кожній транзакції в межах одного джерела; paidAcrossSources — по транзакції беремо максимум
// між джерелами (та сама оплата через замовлення і через документ), різні транзакції сумуємо.
const perTx = (entries) => {
  const m = {}; let k = 0
  entries.forEach(e => { const key = e.txId || ('__no_tx_' + (k++)); m[key] = (m[key] || 0) + (Number(e.amount) || 0) })
  return m
}
function paidAcrossSources(maps) {
  const best = {}
  maps.forEach(m => Object.entries(m).forEach(([tx, v]) => { best[tx] = Math.max(best[tx] || 0, v) }))
  return Object.values(best).reduce((t, v) => t + v, 0)
}

// Пакетне читання .in(...) по 200
async function inChunks(table, cols, col, ids, mod) {
  const out = []
  for (let i = 0; i < ids.length; i += 200) {
    let q = supabase.from(table).select(cols).in(col, ids.slice(i, i + 200))
    if (mod) q = mod(q)
    const { data, error } = await q
    if (error) return { data: out, error }
    ;(data || []).forEach(x => out.push(x))
  }
  return { data: out, error: null }
}

// Розрахунок рядків прогнозу для замовлень. orderIds — конкретні (картка замовлення) або всі in_forecast.
export async function buildOrderForecasts({ orderIds = null } = {}) {
  let oq = supabase.from('orders')
    .select('id, order_number, status, outcome, archived_at, company_id, client_id, manager_id, total, agent_commission_pct, commission_paid, paid_transaction_id, in_forecast, contractors(name), companies(short_name, name, is_vat_payer)')
  oq = orderIds ? oq.in('id', orderIds) : oq.eq('in_forecast', true)
  const { data: ordersRaw, error: oErr } = await oq.order('order_number')
  if (oErr) throw oErr
  const orders = (ordersRaw || []).filter(o => orderIds || (!o.archived_at && o.status !== 'closed' && o.outcome !== 'lost'))
  const ids = orders.map(o => o.id)
  if (!ids.length) return []
  const flags = {}

  // Позиції (ґрейсфул до 067 — без cost_vat_rate)
  let { data: items, error: iErr } = await inChunks('order_items', 'order_id, qty, unit_price, cost_price, vat_rate, cost_vat_rate, price_includes_vat, supplier_id, pay_days', 'order_id', ids)
  if (iErr) ({ data: items, error: iErr } = await inChunks('order_items', 'order_id, qty, unit_price, cost_price, vat_rate, cost_vat_rate, price_includes_vat, supplier_id', 'order_id', ids))   // до 103
  if (iErr) { ({ data: items } = await inChunks('order_items', 'order_id, qty, unit_price, cost_price, vat_rate, price_includes_vat, supplier_id', 'order_id', ids)); flags.no067 = true }
  // Інші витрати (065), факт (057), графік (067), субзамовлення (дати оплати постачальнику)
  let { data: exps, error: eErr } = await inChunks('order_expenses', 'order_id, amount, vat_included', 'order_id', ids)
  if (eErr) ({ data: exps, error: eErr } = await inChunks('order_expenses', 'order_id, amount', 'order_id', ids))   // до міграції 102
  if (eErr) flags.no065 = true
  const { data: ots, error: tErr } = await inChunks('order_transactions', 'order_id, kind, amount, transaction_id, bank_transactions(date, contractor_id)', 'order_id', ids)
  if (tErr) flags.no057 = true
  let { data: plans, error: pErr } = await inChunks('order_payment_plan', 'order_id, kind, supplier_id, plan_date, days, part_no, share_pct, base_date, is_manual', 'order_id', ids)
  if (pErr) ({ data: plans, error: pErr } = await inChunks('order_payment_plan', 'order_id, kind, supplier_id, plan_date, days', 'order_id', ids))   // до 103
  if (pErr) flags.no067 = true
  const { data: subs } = await inChunks('supplier_orders', 'order_id, supplier_id, payment_due_date', 'order_id', ids)
  // Прив'язані оплати клієнта (orders.paid_transaction_id)
  const paidTxIds = orders.map(o => o.paid_transaction_id).filter(Boolean)
  const { data: paidTxs } = paidTxIds.length ? await inChunks('bank_transactions', 'id, date, amount', 'id', paidTxIds) : { data: [] }
  // Документи замовлень (відвантаження = боргові документи клієнту; прихідні постачальників) + оплати по них
  const { data: docs } = await inChunks('documents', 'id, order_id, type, direction, amount, doc_date, created_at, contractor_id', 'order_id', ids)
  const debtDocs = (docs || []).filter(d => countsAsDebt(d.type) && d.amount != null && (d.direction === 'receivable' || d.direction === 'payable'))
  // оплати документів (без проігнорованих транзакцій); зберігаємо transaction_id — щоб не рахувати двічі
  const docPays = await loadDocPayments(debtDocs.map(d => d.id))
  const paysOfDoc = {}
  docPays.forEach(t => { (paysOfDoc[t.document_id] ||= []).push(t) })
  // Назви постачальників
  const supIds = [...new Set((items || []).map(i => i.supplier_id).filter(Boolean))]
  const supName = {}, supDelay = {}
  if (supIds.length) { const { data } = await inChunks('contractors', 'id, name, payment_delay_days', 'id', supIds); (data || []).forEach(c => { supName[c.id] = c.name; supDelay[c.id] = c.payment_delay_days == null ? null : Number(c.payment_delay_days) }) }

  const group = (arr) => { const m = {}; (arr || []).forEach(x => (m[x.order_id] ||= []).push(x)); return m }
  const itemsBy = group(items), expBy = group(exps), otBy = group(ots), planBy = group(plans), subBy = group(subs), docBy = group(debtDocs)
  const paidTxById = {}; (paidTxs || []).forEach(t => paidTxById[t.id] = t)
  const today = todayIso()

  return orders.map(o => {
    const vatOn = o.companies?.is_vat_payer !== false
    const oItems = itemsBy[o.id] || []
    const otherSum = (expBy[o.id] || []).reduce((s, e) => s + expenseNet(e), 0)   // «з ПДВ» → без ПДВ (102)
    const plan = computeOrderPlan(oItems, { vatOn, agentPct: o.agent_commission_pct, otherExpenses: otherSum })
    const pl = planBy[o.id] || []
    const pShip = pl.find(x => x.kind === 'ship'), pClient = pl.find(x => x.kind === 'client')
    const oDocs = docBy[o.id] || []
    const recvDocs = oDocs.filter(d => d.direction === 'receivable')
    const payDocs = oDocs.filter(d => d.direction === 'payable')

    // ── Відвантаження ──
    const shipped = recvDocs.reduce((s, d) => s + Math.abs(Number(d.amount) || 0), 0)
    const lastShipDoc = recvDocs.map(debtDate).filter(Boolean).sort().pop() || null
    const shipDate = pShip?.plan_date || lastShipDoc || addDays(today, DEFAULT_SHIP_DAYS)
    const shipEst = !pShip?.plan_date && !lastShipDoc
    const clientDays = pClient?.days != null ? pClient.days : DEFAULT_CLIENT_DAYS
    const clientDate = pClient?.plan_date || addDays(shipDate, clientDays)
    const clientEst = !pClient?.plan_date && (shipEst || pClient?.days == null)

    // ── Факт ──
    const oOts = otBy[o.id] || []
    const otTxIds = new Set(oOts.map(t => t.transaction_id).filter(Boolean))
    const paidTx = o.paid_transaction_id && !otTxIds.has(o.paid_transaction_id) ? paidTxById[o.paid_transaction_id] : null
    // Факт оплати клієнта: та сама транзакція може бути прив'язана і до замовлення, і до документа —
    // рахуємо її один раз (по транзакції — максимум між джерелами), а різні транзакції сумуємо.
    // (Раніше max(усі прив'язки замовлення, усі прив'язки документів) недораховував змішані випадки.)
    const clientPaid = paidAcrossSources([
      perTx(oOts.filter(t => t.kind === 'income').map(t => ({ txId: t.transaction_id, amount: Number(t.amount) || 0 }))),
      perTx(paidTx ? [{ txId: paidTx.id, amount: Math.abs(Number(paidTx.amount) || 0) }] : []),
      perTx(recvDocs.flatMap(d => (paysOfDoc[d.id] || []).map(t => ({ txId: t.transaction_id, amount: t.amount })))),
    ])

    const lines = []
    const push = (l) => { l.plan = r2(l.plan); l.fact = r2(Math.min(l.fact || 0, Math.max(l.plan, 0))); l.remaining = r2(Math.max(0, l.plan - l.fact)); lines.push(l) }

    // ── Клієнт: дебіторка (відвантажено) + майбутній продаж ──
    const clientRemaining = Math.max(0, plan.revenueGross - clientPaid)
    const recvPart = Math.min(clientRemaining, Math.max(0, shipped - clientPaid))
    const recvPlan = Math.min(plan.revenueGross, shipped)
    push({ key: 'client-recv', kind: 'income', label: 'Оплата дебіторки (відвантажено)', plan: recvPlan, fact: recvPlan - recvPart, date: pClient?.plan_date || addDays(lastShipDoc || shipDate, clientDays), estimated: !pClient?.plan_date && pClient?.days == null, flag: 'receivable' })
    push({ key: 'client', kind: 'income', label: 'Оплата від клієнта', plan: plan.revenueGross - recvPlan, fact: Math.max(0, clientPaid - recvPlan), date: clientDate, estimated: clientEst })

    // ── Постачальники ──
    const expOts = oOts.filter(t => t.kind === 'expense')
    const supKeys = Object.keys(plan.bySupplier)
    let pool = 0 // факт витрат, не віднесений до жодного постачальника замовлення
    expOts.forEach(t => { const cid = t.bank_transactions?.contractor_id; if (!cid || !plan.bySupplier[cid]) pool += Number(t.amount) || 0 })
    // Умови оплати постачальнику (103): окремо для замовлення × постачальника; кілька частин (% і дні від відвантаження /
    // отримання товару); ручна дата частини не перераховується. Дні: позиція (pay_days) → постачальник у замовленні →
    // картка постачальника (payment_delay_days) → 0. Факт оплати постачальнику гасить його частини по черзі за датою.
    supKeys.forEach(key => {
      const b = plan.bySupplier[key]
      const sid = b.supplierId
      const sDocs = sid ? payDocs.filter(d => d.contractor_id === sid) : []
      let fact = sid ? paidAcrossSources([
        perTx(expOts.filter(t => t.bank_transactions?.contractor_id === sid).map(t => ({ txId: t.transaction_id, amount: Number(t.amount) || 0 }))),
        perTx(sDocs.flatMap(d => (paysOfDoc[d.id] || []).map(t => ({ txId: t.transaction_id, amount: t.amount })))),
      ]) : 0
      let received = sDocs.reduce((s, d) => s + Math.abs(Number(d.amount) || 0), 0)
      const rows = pl.filter(x => x.kind === 'supplier' && (x.supplier_id || null) === sid).sort((x, y) => (x.part_no || 1) - (y.part_no || 1))
      const subDue = (subBy[o.id] || []).find(s => (s.supplier_id || null) === sid && s.payment_due_date)?.payment_due_date
      const baseDate = rows.find(x => x.base_date)?.base_date || null
      const base = baseDate || shipDate
      const defDays = sid && supDelay[sid] != null ? supDelay[sid] : 0
      const label = sid ? (supName[sid] || 'Постачальник') : 'Закупівля (постачальника не вказано)'
      // позиції з власною відстрочкою — окремі картки
      const own = {}
      oItems.filter(it => (it.supplier_id || '__none__') === key && it.pay_days != null && it.pay_days !== '').forEach(it => {
        const d = Number(it.pay_days); own[d] = (own[d] || 0) + itemCost(it, vatOn).gross
      })
      const ownSum = Object.values(own).reduce((s, v) => s + v, 0)
      const rest = Math.max(0, b.gross - ownSum)
      const parts = rows.length ? rows : [{ part_no: 1, share_pct: null, days: null, plan_date: null, is_manual: false }]
      const shared = parts.reduce((s, x) => s + (x.share_pct == null ? 0 : Number(x.share_pct)), 0)
      const blanks = parts.filter(x => x.share_pct == null).length
      const sLines = []
      parts.forEach(x => {
        const share = x.share_pct != null ? Number(x.share_pct) : blanks ? Math.max(0, 100 - shared) / blanks : 0
        // дата частини зберігається лише коли її вписано вручну (до 103 — єдина можлива дата постачальника, теж ручна)
        const manual = !!x.plan_date
        const days = x.days != null ? Number(x.days) : defDays
        const date = manual ? x.plan_date : (!rows.length && subDue) ? subDue : addDays(base, days)
        sLines.push({ key: `sup-${key}-p${x.part_no || 1}`, partNo: x.part_no || 1, sharePct: r2(share), days, manual, ownDays: false,
          plan: rest * share / 100, date, estimated: !manual && !baseDate && !(!rows.length && subDue) && shipEst })
      })
      Object.entries(own).forEach(([d, v]) => sLines.push({ key: `sup-${key}-i${d}`, partNo: null, sharePct: null, days: Number(d), manual: false, ownDays: true,
        plan: v, date: addDays(base, Number(d)), estimated: !baseDate && shipEst }))
      sLines.sort((x, y) => (x.date || '').localeCompare(y.date || ''))
      sLines.forEach(l => {
        const f = Math.min(Math.max(0, fact), l.plan); fact -= f
        const rcv = Math.min(Math.max(0, received), l.plan); received -= rcv
        push({ ...l, kind: 'expense', label, supplierId: sid, baseDate, defDays, partsCount: parts.length, fact: f, payableShare: rcv })
      })
    })
    // кредиторка: частина залишку, на яку вже є прихідні (отримано, не оплачено)
    lines.filter(l => l.key.startsWith('sup-')).forEach(l => { l.payablePart = r2(Math.min(l.remaining, Math.max(0, (l.payableShare || 0) - l.fact))); delete l.payableShare })

    // ── ПДВ до сплати: відвантажена частина — до 30-го наступного місяця; якщо строк минув — вважаємо сплаченим у декларації ──
    if (vatOn && Math.abs(plan.vatPayable) > EPS) {
      const shippedShare = plan.revenueGross > 0 ? Math.min(1, shipped / plan.revenueGross) : 0
      const vatShipped = plan.vatPayable * shippedShare
      const vatRest = plan.vatPayable - vatShipped
      if (Math.abs(vatShipped) > EPS) {
        const due = vatDueFor(lastShipDoc || shipDate)
        const done = due < today
        lines.push({ key: 'vat-shipped', kind: 'expense', label: 'ПДВ до сплати (відвантажено)', plan: r2(vatShipped), fact: done ? r2(vatShipped) : 0, remaining: done ? 0 : r2(vatShipped), date: due, estimated: false, note: done ? 'сплачено в декларації' : null })
      }
      if (Math.abs(vatRest) > EPS) lines.push({ key: 'vat', kind: 'expense', label: 'ПДВ до сплати', plan: r2(vatRest), fact: 0, remaining: r2(vatRest), date: vatDueFor(shipDate), estimated: shipEst })
    }

    // ── Інші витрати та агентські (непов'язаний факт витрат гасить спершу їх) ──
    const otherFact = Math.min(plan.other, pool); pool -= otherFact
    if (plan.other > EPS) push({ key: 'other', kind: 'expense', label: 'Інші витрати', plan: plan.other, fact: otherFact, date: shipDate, estimated: shipEst })
    const agentFact = o.commission_paid ? plan.agent : Math.min(plan.agent, pool); pool -= o.commission_paid ? 0 : agentFact
    if (plan.agent > EPS) push({ key: 'agent', kind: 'expense', label: 'Агентські', plan: plan.agent, fact: agentFact, date: clientDate, estimated: clientEst })
    // залишок непов'язаного факту — зменшує закупівлю (спершу без постачальника, далі решту)
    lines.filter(l => l.key.startsWith('sup-')).sort((a, b) => (a.supplierId ? 1 : 0) - (b.supplierId ? 1 : 0)).forEach(l => {
      if (pool <= EPS) return
      const take = Math.min(pool, l.remaining); l.fact = r2(l.fact + take); l.remaining = r2(l.remaining - take); l.payablePart = r2(Math.min(l.payablePart || 0, l.remaining)); pool -= take
    })

    const visible = lines.filter(l => Math.abs(l.plan) > EPS)
    visible.forEach(l => { l.overdue = l.remaining > EPS && l.date && l.date < today })
    const sum = (kind, f) => r2(visible.filter(l => l.kind === kind).reduce((s, l) => s + (l[f] || 0), 0))
    const income = sum('income', 'remaining'), expense = sum('expense', 'remaining')
    const planNet = r2(sum('income', 'plan') - sum('expense', 'plan'))
    return {
      id: o.id, number: o.order_number || o.id.slice(0, 6), status: o.status, inForecast: !!o.in_forecast,
      companyId: o.company_id, company: o.companies?.short_name || o.companies?.name || '—',
      client: o.contractors?.name || '—', clientId: o.client_id, managerId: o.manager_id || null, vatOn, plan,
      lines: visible, income, expense, net: r2(income - expense),
      planNet, checkNet: r2(plan.net + plan.tax), // Σ плану має = чистий прибуток + податок 18%
      shipDate, shipEst, clientDate, flags,
    }
  })
}

// Ручні рядки прогнозу (витрати/надходження без замовлення)
export async function loadManualItems() {
  const { data, error } = await supabase.from('forecast_items').select('*, companies(short_name, name)').is('order_id', null).order('expected_date', { nullsFirst: false })
  if (error) throw error
  return (data || []).map(x => ({ ...x, company: x.companies?.short_name || x.companies?.name || '—' }))
}

// Усе для сторінки «Прогноз»
export async function loadForecast() {
  const [orders, manual] = await Promise.all([buildOrderForecasts(), loadManualItems().catch(() => [])])
  const totals = { income: 0, expense: 0, net: 0 }
  orders.forEach(o => { totals.income += o.income; totals.expense += o.expense })
  manual.forEach(m => { if (m.kind === 'income') totals.income += Number(m.amount) || 0; else totals.expense += Number(m.amount) || 0 })
  totals.income = r2(totals.income); totals.expense = r2(totals.expense); totals.net = r2(totals.income - totals.expense)
  return { orders, manual, totals, flags: orders[0]?.flags || {} }
}

// Плаский список рухів прогнозу (для таблиці по місяцях і балансу)
export function flattenForecast({ orders, manual }) {
  const out = []
  orders.forEach(o => o.lines.forEach(l => { if (l.remaining > EPS) out.push({ companyId: o.companyId, company: o.company, orderId: o.id, number: o.number, kind: l.kind, amount: l.remaining, date: l.date, flag: l.flag || (l.payablePart > EPS ? 'payable' : null), payablePart: l.payablePart || 0, label: l.label }) }))
  manual.forEach(m => out.push({ companyId: m.company_id, company: m.company, orderId: null, kind: m.kind, amount: Number(m.amount) || 0, date: m.expected_date, flag: null, payablePart: 0, label: m.note || 'Інше' }))
  return out
}

// Прогнозний рух станом на дату (для Зведеного балансу). Прострочені/без дати — враховуємо завжди.
export async function forecastNetByDate(toDate) {
  const data = await loadForecast()
  const within = flattenForecast(data).filter(x => !toDate || !x.date || x.date <= toDate)
  let income = 0, expense = 0, receivableCollect = 0, payablePay = 0
  within.forEach(x => {
    if (x.kind === 'income') { income += x.amount; if (x.flag === 'receivable') receivableCollect += x.amount }
    else { expense += x.amount; payablePay += x.payablePart || 0 }
  })
  return { income: r2(income), expense: r2(expense), net: r2(income - expense), receivableCollect: r2(receivableCollect), payablePay: r2(payablePay), items: within }
}

export async function addForecastItem({ orderId = null, companyId, kind, amount, expectedDate, note, userId }) {
  const { error } = await supabase.from('forecast_items').insert({
    order_id: orderId, company_id: companyId, kind, amount: r2(amount),
    expected_date: expectedDate || null, note: note || null, created_by: userId || null,
  })
  if (error) throw error
}

export async function removeForecastItem(id) {
  const { error } = await supabase.from('forecast_items').delete().eq('id', id)
  if (error) throw error
}

// ── Графік платежів замовлення (order_payment_plan, міграція 067) ──
export async function loadPaymentPlan(orderId) {
  const { data, error } = await supabase.from('order_payment_plan').select('*').eq('order_id', orderId)
  if (error) throw error
  return data || []
}
// Зберегти один пункт графіка: kind + (supplierId) → дата/дні. Порожнє — видаляє пункт (повертається правило за замовчуванням).
export async function savePaymentPlanEntry(orderId, { kind, supplierId = null, planDate = null, days = null }) {
  let del = supabase.from('order_payment_plan').delete().eq('order_id', orderId).eq('kind', kind)
  del = supplierId ? del.eq('supplier_id', supplierId) : del.is('supplier_id', null)
  const { error: dErr } = await del
  if (dErr) throw dErr
  if (!planDate && (days === null || days === '' || days === undefined)) return
  const { error } = await supabase.from('order_payment_plan').insert({ order_id: orderId, kind, supplier_id: supplierId, plan_date: planDate || null, days: days === '' || days == null ? null : Number(days) })
  if (error) throw error
}

// Умови оплати постачальника в замовленні (103): parts = [{ sharePct, days, planDate }] (planDate — ручна дата частини),
// baseDate — дата отримання товару від постачальника. Порожні умови — видалити (повертається відстрочка з картки постачальника).
export async function saveSupplierTerms(orderId, supplierId, { parts = [], baseDate = null } = {}) {
  let del = supabase.from('order_payment_plan').delete().eq('order_id', orderId).eq('kind', 'supplier')
  del = supplierId ? del.eq('supplier_id', supplierId) : del.is('supplier_id', null)
  const { error: dErr } = await del
  if (dErr) throw dErr
  const clean = parts.filter(x => x && (x.planDate || (x.days !== '' && x.days != null) || (x.sharePct !== '' && x.sharePct != null && Number(x.sharePct) !== 100)))
  if (!clean.length && !baseDate) return
  const rows = (clean.length ? clean : [{}]).map((x, i) => ({
    order_id: orderId, kind: 'supplier', supplier_id: supplierId, part_no: i + 1,
    share_pct: x.sharePct === '' || x.sharePct == null ? null : Number(x.sharePct),
    days: x.days === '' || x.days == null ? null : Number(x.days),
    plan_date: x.planDate || null, is_manual: !!x.planDate, base_date: baseDate || null,
  }))
  const { error } = await supabase.from('order_payment_plan').insert(rows)
  if (error) throw error
}

// Поточний залишок грошей по юрособах (рахунки: початковий залишок + неігноровані рухи) — старт прогнозу
export async function currentCashByCompany() {
  const { data: accs } = await supabase.from('accounts').select('id, company_id, opening_balance, opening_balance_date')
  const accById = {}; (accs || []).forEach(a => accById[a.id] = a)
  const byCo = {}
  ;(accs || []).forEach(a => { byCo[a.company_id] = (byCo[a.company_id] || 0) + (Number(a.opening_balance) || 0) })
  const txs = await fetchAll(() => supabase.from('bank_transactions').select('id, account_id, amount, date').eq('is_ignored', false))
  txs.forEach(t => {
    const a = accById[t.account_id]; if (!a) return
    if (a.opening_balance_date && t.date && t.date < a.opening_balance_date) return
    byCo[a.company_id] = (byCo[a.company_id] || 0) + (Number(t.amount) || 0)
  })
  Object.keys(byCo).forEach(k => byCo[k] = r2(byCo[k]))
  return byCo
}

// Скільки клієнт уже сплатив по кожному замовленню — те саме правило, що й «Прогноз» (buildOrderForecasts):
// оплати, прив'язані до замовлення (order_transactions, income), «оплачено клієнтом» (orders.paid_transaction_id)
// і оплати видаткових / актів замовлення; одна транзакція рахується один раз. → { [orderId]: сума }
export async function loadClientPaid(orders) {
  const ids = (orders || []).map(o => o.id)
  if (!ids.length) return {}
  const [{ data: ots }, { data: docs }] = await Promise.all([
    inChunks('order_transactions', 'order_id, kind, amount, transaction_id', 'order_id', ids),
    inChunks('documents', 'id, order_id, type, direction, amount', 'order_id', ids),
  ])
  const paidTxIds = orders.map(o => o.paid_transaction_id).filter(Boolean)
  const { data: paidTxs } = paidTxIds.length ? await inChunks('bank_transactions', 'id, amount', 'id', paidTxIds) : { data: [] }
  const recv = (docs || []).filter(d => countsAsDebt(d.type) && d.amount != null && d.direction === 'receivable')
  const docPays = await loadDocPayments(recv.map(d => d.id))
  const paysOfDoc = {}; docPays.forEach(t => { (paysOfDoc[t.document_id] ||= []).push(t) })
  const txById = {}; (paidTxs || []).forEach(t => txById[t.id] = t)
  const out = {}
  orders.forEach(o => {
    const oOts = (ots || []).filter(t => t.order_id === o.id)
    const otTx = new Set(oOts.map(t => t.transaction_id).filter(Boolean))
    const ptx = o.paid_transaction_id && !otTx.has(o.paid_transaction_id) ? txById[o.paid_transaction_id] : null
    out[o.id] = r2(paidAcrossSources([
      perTx(oOts.filter(t => t.kind === 'income').map(t => ({ txId: t.transaction_id, amount: Number(t.amount) || 0 }))),
      perTx(ptx ? [{ txId: ptx.id, amount: Math.abs(Number(ptx.amount) || 0) }] : []),
      perTx(recv.filter(d => d.order_id === o.id).flatMap(d => (paysOfDoc[d.id] || []).map(t => ({ txId: t.transaction_id, amount: t.amount })))),
    ]))
  })
  return out
}

// Плановий прибуток замовлень (плитки етапів у реєстрі): той самий computeOrderPlan, що в картці замовлення.
// orders — [{ id, agent_commission_pct, vatOn }]; повертає { [id]: { net, gross, revenueNet, hasItems } }. Лише читання.
export async function loadOrderPlans(orders) {
  const ids = orders.map(o => o.id)
  if (!ids.length) return {}
  let { data: items, error: iErr } = await inChunks('order_items', 'order_id, qty, unit_price, cost_price, vat_rate, cost_vat_rate, price_includes_vat, supplier_id', 'order_id', ids)
  if (iErr) ({ data: items } = await inChunks('order_items', 'order_id, qty, unit_price, cost_price, vat_rate, price_includes_vat, supplier_id', 'order_id', ids))
  let { data: exps, error: eErr } = await inChunks('order_expenses', 'order_id, amount, vat_included', 'order_id', ids)
  if (eErr) ({ data: exps } = await inChunks('order_expenses', 'order_id, amount', 'order_id', ids))
  const by = (arr) => { const m = {}; (arr || []).forEach(x => (m[x.order_id] ||= []).push(x)); return m }
  const itemsBy = by(items), expBy = by(exps)
  const out = {}
  orders.forEach(o => {
    const oi = itemsBy[o.id] || []
    const other = (expBy[o.id] || []).reduce((s, e) => s + expenseNet(e), 0)
    const p = computeOrderPlan(oi, { vatOn: o.vatOn !== false, agentPct: o.agent_commission_pct, otherExpenses: other })
    out[o.id] = { net: p.net, gross: p.gross, revenueNet: p.revenueNet, hasItems: oi.length > 0 }
  })
  return out
}

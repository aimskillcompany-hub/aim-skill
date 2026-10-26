// Вкладка «Прибутковість» у замовленні (ТЗ «Прибутковість у замовленні», 23.10.2026).
// План — той самий computeOrderPlan (позиції + інші витрати); графік платежів — той самий buildOrderForecasts.
// Факт — за рухом грошей (рішення власника, ТЗ 3.2): оплати, прив'язані до замовлення (order_transactions,
// «оплачено клієнтом», оплати документів замовлення, інші витрати з прив'язаною транзакцією), кожна транзакція — один раз;
// суми переводяться в «без ПДВ»: виручка ÷ 1,2, якщо юрособа платник ПДВ; витрати ÷ 1,2, якщо контрагент платник ПДВ.
// Агентські з рішень протоколу (098) з кількома замовленнями діляться пропорційно плановим агентським замовлень,
// а якщо їх ніде немає — валовому прибутку (рішення власника 23.10.2026). Лише читання.
import { supabase } from './supabase'
import { computeOrderPlan, expenseNet } from './orderPlan'
import { buildOrderForecasts } from './forecast'
import { loadDocPayments, countsAsDebt } from './debts'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const VAT = 1.2
export const EXPENSE_KINDS = { delivery: 'Доставка', install: 'Монтаж', bank_fee: 'Комісія банку', agent: 'Агентські', other: 'Інша витрата' }
export { expenseNet }
const days = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null
const vatPayer = (c) => c?.is_vat_payer !== false

async function loadItems(orderId) {
  let { data, error } = await supabase.from('order_items').select('qty, unit_price, cost_price, vat_rate, cost_vat_rate, price_includes_vat, supplier_id').eq('order_id', orderId)
  if (error) ({ data } = await supabase.from('order_items').select('qty, unit_price, cost_price, vat_rate, price_includes_vat, supplier_id').eq('order_id', orderId))
  return data || []
}

// План одного замовлення (для розподілу агентських з рішень протоколу)
async function planFor(orderId, agentPct, vatOn) {
  const [items, { data: exps }] = await Promise.all([loadItems(orderId), supabase.from('order_expenses').select('*').eq('order_id', orderId)])
  return computeOrderPlan(items, { vatOn, agentPct, otherExpenses: (exps || []).reduce((s, e) => s + expenseNet(e), 0) })
}

export async function loadOrderProfit(o, { vatOn = true } = {}) {
  const [items, expRes, fcRows, snapRes, otsRes, docsRes] = await Promise.all([
    loadItems(o.id),
    supabase.from('order_expenses').select('*').eq('order_id', o.id).order('created_at'),
    buildOrderForecasts({ orderIds: [o.id] }).catch(() => []),
    supabase.from('forecast_snapshots').select('*').eq('order_id', o.id).order('taken_at', { ascending: false }),
    supabase.from('order_transactions').select('id, kind, amount, note, transaction_id, created_at, confirmed_at').eq('order_id', o.id)
      .then(r => r.error ? supabase.from('order_transactions').select('id, kind, amount, note, transaction_id, created_at').eq('order_id', o.id) : r),   // до 106
    supabase.from('documents').select('id, type, direction, amount, doc_number, contractor_id').eq('order_id', o.id),
  ])
  const exps = expRes.data || []
  const agentExp = exps.filter(e => e.kind === 'agent').reduce((s, e) => s + expenseNet(e), 0)
  const otherExp = exps.filter(e => e.kind !== 'agent').reduce((s, e) => s + expenseNet(e), 0)
  const plan = computeOrderPlan(items, { vatOn, agentPct: o.agent_commission_pct, otherExpenses: agentExp + otherExp })
  const fc = fcRows?.[0] || null
  const snaps = snapRes.error ? [] : (snapRes.data || [])
  const snap = snaps.find(s => s.is_current) || snaps[0] || null
  const supplierIds = new Set(Object.values(plan.bySupplier || {}).map(b => b.supplierId).filter(Boolean))

  // ── Усі прив'язані оплати: транзакція → { сума частки, джерела } (одна транзакція — один раз, максимум між джерелами)
  const links = {}   // txId → { amount, kind: 'income'|'expense', sources:Set, doc }
  const put = (txId, amount, kind, source, extra = {}) => {
    if (!txId) return
    const l = (links[txId] ||= { txId, amount: 0, kind, sources: new Set(), ...extra })
    l.amount = Math.max(l.amount, Math.abs(Number(amount) || 0)); l.sources.add(source); Object.assign(l, extra)
  }
  ;(otsRes.data || []).forEach(t => put(t.transaction_id, t.amount, t.kind === 'income' ? 'income' : 'expense', 'order', { note: t.note }))
  if (o.paid_transaction_id) put(o.paid_transaction_id, null, 'income', 'paid')
  const debtDocs = (docsRes.data || []).filter(d => countsAsDebt(d.type) && d.amount != null && (d.direction === 'receivable' || d.direction === 'payable'))
  const docPays = await loadDocPayments(debtDocs.map(d => d.id)).catch(() => [])
  const docById = Object.fromEntries(debtDocs.map(d => [d.id, d]))
  docPays.forEach(p => { const d = docById[p.document_id]; put(p.transaction_id, p.amount, d.direction === 'receivable' ? 'income' : 'expense', d.direction === 'receivable' ? 'doc-out' : 'doc-in', { doc: d }) })
  exps.filter(e => e.transaction_id).forEach(e => put(e.transaction_id, (Number(e.amount) || 0), 'expense', 'expense', { expense: e }))

  const txIds = Object.keys(links)
  const txById = {}
  for (let i = 0; i < txIds.length; i += 200) {
    const { data } = await supabase.from('bank_transactions').select('id, date, amount, counterparty, description, article, contractor_id, contractors(name, is_vat_payer)').in('id', txIds.slice(i, i + 200))
    ;(data || []).forEach(t => { txById[t.id] = t })
  }
  // «оплачено клієнтом» без частки — уся сума транзакції
  if (o.paid_transaction_id && links[o.paid_transaction_id] && !links[o.paid_transaction_id].amount) links[o.paid_transaction_id].amount = Math.abs(Number(txById[o.paid_transaction_id]?.amount) || 0)

  const payments = txIds.map(id => {
    const l = links[id], t = txById[id] || {}
    const total = Math.abs(Number(t.amount) || 0)
    let cat = 'client'
    if (l.kind === 'expense') {
      const art = (t.article || '') + ' ' + (l.expense?.name || '')
      if (l.sources.has('doc-in') || (t.contractor_id && supplierIds.has(t.contractor_id)) || /закуп|товар/i.test(t.article || '')) cat = 'supplier'
      else if (l.expense?.kind === 'agent' || /агент/i.test(art)) cat = 'agent'
      else cat = 'other'
    }
    const src = l.sources.has('paid') ? 'знайдено за клієнтом і сумою' : l.sources.has('doc-in') ? `прихідна${l.doc?.doc_number ? ` № ${l.doc.doc_number}` : ''}` : l.sources.has('doc-out') ? `оплата видаткової${l.doc?.doc_number ? ` № ${l.doc.doc_number}` : ''}`
      : l.sources.has('expense') ? 'витрата замовлення' : (l.amount < total - 0.5 ? 'частка платежу' : 'додано вручну')
    return {
      txId: id, date: t.date || null, amount: r2(l.amount), sign: l.kind === 'income' ? 1 : -1, cat, src,
      counterparty: t.contractors?.name || t.counterparty || '—', purpose: l.note || l.expense?.name || t.article || t.description || '',
      vatPayer: vatPayer(t.contractors), isShare: l.amount < total - 0.5, orderLinkId: (otsRes.data || []).find(x => x.transaction_id === id)?.id || null,
      contractorId: t.contractor_id || null, description: t.description || '', txTotal: r2(total), direct: l.sources.has('paid'),
      confirmed: l.sources.has('paid') ? !!o.paid_confirmed_at : !!(otsRes.data || []).find(x => x.transaction_id === id)?.confirmed_at,
    }
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  // ── Агентські з рішень протоколу (лише адміністратор бачить — RLS; іншим порожньо)
  let decisionAgent = 0, decisionNotes = []
  const { data: decs } = await supabase.from('meeting_decisions').select('id, amount, order_ids, status, recipient').eq('category', 'agent_fee').eq('status', 'paid')
  const mine = (decs || []).filter(dd => (dd.order_ids || []).includes(o.id))
  if (mine.length) {
    const others = [...new Set(mine.flatMap(dd => dd.order_ids || []))]
    const { data: ords } = await supabase.from('orders').select('id, agent_commission_pct').in('id', others)
    const plans = {}
    for (const x of ords || []) plans[x.id] = x.id === o.id ? plan : await planFor(x.id, x.agent_commission_pct, vatOn)
    mine.forEach(dd => {
      const ids = dd.order_ids || []
      let w = ids.map(id => plans[id]?.agent || 0)
      if (!w.some(v => v > 0)) w = ids.map(id => Math.max(0, plans[id]?.gross || 0))
      const sum = w.reduce((s, v) => s + v, 0)
      const share = sum > 0 ? w[ids.indexOf(o.id)] / sum : 1 / ids.length
      decisionAgent += (Number(dd.amount) || 0) * share
      decisionNotes.push(`${dd.recipient || 'агент'} ${Math.round(share * 100)}%`)
    })
  }

  // ── Факт без ПДВ
  const sumCat = (c, net) => payments.filter(p => p.cat === c).reduce((s, p) => s + (net ? p.amount / (p.vatPayer ? VAT : 1) : p.amount), 0)
  const clientGross = sumCat('client'), supplierGross = sumCat('supplier')
  const fact = {
    revenue: r2(clientGross / (vatOn ? VAT : 1)),
    cost: r2(sumCat('supplier', true)),
    other: r2(sumCat('other', true)),
    agent: r2(sumCat('agent') + decisionAgent),
  }
  fact.gross = r2(fact.revenue - fact.cost)
  fact.tax = plan.tax > 0 ? r2(Math.max(0, fact.gross) * 0.18) : 0
  fact.net = r2(fact.gross - fact.tax - fact.agent - fact.other)
  const hasFact = payments.length > 0 || decisionAgent > 0
  const clientPct = plan.revenueGross > 0 ? Math.min(1, clientGross / plan.revenueGross) : null
  const supplierPct = plan.costGross > 0 ? Math.min(1, supplierGross / plan.costGross) : null
  const fullyPaid = (plan.revenueGross <= 0 || clientGross >= plan.revenueGross - 1) && (plan.costGross <= 0 || supplierGross >= plan.costGross - 1)

  // ── План для таблиці: живий; після закриття — зі знімка (якщо є)
  const closed = o.status === 'closed'
  const live = { revenue: r2(plan.revenueNet), cost: r2(plan.costNet), gross: r2(plan.gross), other: r2(otherExp), tax: r2(plan.tax), agent: r2(plan.agent + agentExp), net: r2(plan.net) }
  let pl = live, planFrom = 'live'
  if (closed && snap) {
    const c = snap.costs || {}
    pl = { revenue: r2(snap.revenue_net), cost: r2(c.purchase), other: r2((c.logistics || 0) + (c.commission || 0) + (c.other || 0)), tax: r2(c.tax), agent: r2(c.agent), net: r2(snap.profit) }
    pl.gross = r2(pl.revenue - pl.cost)
    planFrom = 'snapshot'
  }

  // ── Рух грошей: картки з графіка платежів (план з ПДВ), наростаючий залишок
  const lastPay = (cat, supplierId) => payments.filter(p => p.cat === cat && (!supplierId || txById[p.txId]?.contractor_id === supplierId)).map(p => p.date).filter(Boolean).sort().pop() || null
  const lines = (fc?.lines || []).filter(l => Math.abs(l.plan) > 0.5).slice().sort((a, b) => (a.date || '9').localeCompare(b.date || '9'))
  let run = 0
  const cards = lines.map(l => {
    const sign = l.kind === 'income' ? 1 : -1
    run = r2(run + sign * l.plan)
    const paid = l.fact >= l.plan - 0.5, part = !paid && l.fact > 0.5
    const isClient = l.key === 'client' || l.key === 'client-recv' || l.key.startsWith('client-s')
    const when = paid ? (isClient ? lastPay('client') : l.key.startsWith('sup-') ? lastPay('supplier', l.supplierId) : null) : null
    const late = paid && when && l.date ? days(l.date, when) : null
    return {
      key: l.key, date: l.date, label: isClient ? `Оплата від ${o.contractors?.name || 'клієнта'}` : l.key.startsWith('sup-') ? (l.supplierId ? `Платимо ${l.label}` : 'Постачальника не вказано') : l.label,
      // постачальник (103): частина оплати, дні, ручна дата
      supplierId: l.supplierId ?? null, isSupplier: l.key.startsWith('sup-'), partNo: l.partNo ?? null, partsCount: l.partsCount ?? 1, sharePct: l.sharePct ?? null,
      days: l.days ?? null, manual: !!l.manual, ownDays: !!l.ownDays, itemShip: l.itemShip ?? null, settled: !!l.settled, saving: l.saving || 0, factReal: l.factReal ?? l.fact, baseDate: l.baseDate ?? null, defDays: l.defDays ?? null,
      kind: l.kind, amount: r2(sign * l.plan), fact: r2(l.fact), plan: r2(l.plan), paid, part, when, late,
      estimated: l.estimated && !paid, overdue: l.overdue, after: run,
      warn: l.key.startsWith('sup-') && !l.supplierId ? 'supplier' : (isClient && !paid && !l.fact && (l.overdue || !o.paid_transaction_id)) ? 'client' : null,
    }
  })
  const minCard = cards.reduce((m, c) => (c.after < 0 && (!m || c.after < m.after) ? c : m), null)
  let frozen = null
  if (minCard) {
    const start = cards.find(c => c.after < 0)
    const end = cards.slice(cards.indexOf(minCard)).find(c => c.after >= 0)
    frozen = { amount: Math.abs(minCard.after), from: start?.date, to: end?.date || null, days: days(start?.date, end?.date) }
  }
  const flow = fc ? { planNet: r2(fc.planNet), check: r2(fc.checkNet), ok: Math.abs(fc.planNet - fc.checkNet) < 1 } : null

  // ── Висновок (лише закрите й оплачене повністю)
  let verdict = null
  if (closed && fullyPaid && pl.net) {
    const acc = Math.round((fact.net / pl.net) * 100)
    const rows = [['revenue', 'Виручка', 1], ['cost', 'Собівартість', -1], ['other', 'Інші витрати', -1], ['tax', 'Податок', -1], ['agent', 'Агентські', -1]]
      .map(([k, l, s]) => ({ k, l, d: s * (fact[k] - pl[k]) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    const clientCard = cards.find(c => c.key === 'client' || c.key === 'client-recv')
    verdict = { acc, worst: Math.abs(rows[0].d) >= 1 ? rows[0] : null, delay: clientCard?.late > 0 ? clientCard.late : 0, loss: fact.net < 0 }
  }

  return {
    plan, live, pl, planFrom, snap, fact, hasFact, clientPct, supplierPct, fullyPaid, closed, verdict,
    exps, payments, cards, minCard, frozen, flow, decisionNotes,
    shipDate: fc?.shipDate || null, shipEst: !!fc?.shipEst, clientDate: fc?.clientDate || null, itemsCount: items.length,
    clientGross: r2(clientGross), supplierGross: r2(supplierGross),
  }
}

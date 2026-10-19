// P&L за НАРАХУВАННЯМ (accrual) + звірка з грошовим потоком + маржа по замовленнях.
// Касовий P&L (computePL / computePLBreakdown у pl.js) лишається без змін — це другий режим.
//
// Нарахування:
//   Виручка       — видаткові накладні / акти (наші, direction=receivable) за ДАТОЮ ДОКУМЕНТА, без ПДВ.
//   Собівартість  — собівартість саме відвантажених цими документами позицій (OUT-рухи складу документа:
//                   к-сть × cost_price; якщо руху немає — частка собівартості з позицій замовлення).
//                   Закупівлі товару (стаття рівня «Собівартість» у банку) у витрати НЕ йдуть — до відвантаження
//                   це запас / аванс постачальнику.
//   Операційні та інші витрати, податки — як у касовому P&L (підтверджені транзакції за датою оплати),
//                   КРІМ статей ПДВ: виручка вже без ПДВ, тож сплачений ПДВ не є витратою.
import { supabase } from './supabase'
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { computePLBreakdown, periodRange } from './pl'
import { countsAsDebt, debtDate, loadDocPayments } from './debts'
import { computeOrderPlan, itemCost, itemSale } from './orderPlan'
import { getCompany } from './companyConfig'
import { addDaysIso, daysBetween } from './dates'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const isVatArticle = (name) => /ПДВ/i.test(name || '')
const DOC_LABEL = { waybill: 'Видаткові накладні (товари)', serviceAct: 'Акти (послуги)' }

// ── Документи реалізації періоду з собівартістю ──
// → [{ doc, net, vat, gross, date, cost, costSource: 'stock'|'order'|'none'|'service', missing: [{ name, qty, reason }] }]
export async function accrualSalesDocs(from, to) {
  const docsAll = await fetchAll(() => qc('documents')
    .select('id, type, doc_number, doc_date, created_at, amount, vat_amount, contractor_id, order_id, direction, contractors(name)')
    .eq('direction', 'receivable').not('amount', 'is', null))
  const docs = docsAll.filter(d => countsAsDebt(d.type) && debtDate(d) >= from && debtDate(d) <= to)
  if (!docs.length) return []
  const ids = docs.map(d => d.id)

  const movs = await fetchAllIn(() => qc('stock_movements').select('id, document_id, product_id, quantity, cost_price, price, description').eq('type', 'out'), 'document_id', ids)
  const movsByDoc = {}; movs.forEach(m => { (movsByDoc[m.document_id] ||= []).push(m) })

  // позиції замовлень цих документів — джерело закупівельної ціни (2-й пріоритет) і частки для документів без руху
  const orderIds = [...new Set(docs.map(d => d.order_id).filter(Boolean))]
  const oItems = orderIds.length ? await fetchAllIn(() => supabase.from('order_items').select('id, order_id, product_id, qty, unit_price, cost_price, vat_rate, cost_vat_rate, price_includes_vat, name'), 'order_id', orderIds) : []
  const itemsByOrder = {}; oItems.forEach(i => { (itemsByOrder[i.order_id] ||= []).push(i) })
  const vatOn = (await getCompany().catch(() => null))?.isVatPayer !== false

  const prodIds = [...new Set([...movs.map(m => m.product_id), ...oItems.map(i => i.product_id)].filter(Boolean))]
  const prods = prodIds.length ? await fetchAllIn(() => supabase.from('products').select('id, name, product_type'), 'id', prodIds) : []
  const prodById = {}; prods.forEach(p => { prodById[p.id] = p })
  // 3-й пріоритет: середня закупівельна (зважена) з ПРИХОДІВ на склад, без ПДВ. Поле довідника buy_price
  // НЕ використовуємо — туди раніше записувалась ціна продажу.
  const ins = prodIds.length ? await fetchAllIn(() => qc('stock_movements').select('id, product_id, quantity, price, cost_price').eq('type', 'in'), 'product_id', prodIds) : []
  const avgIn = {}
  ;(() => { const agg = {}; ins.forEach(m => { const u = Number(m.cost_price) || Number(m.price) || 0, q = Number(m.quantity) || 0; if (u > 0 && q > 0) { const x = (agg[m.product_id] ||= { q: 0, v: 0 }); x.q += q; x.v += q * u } }); Object.entries(agg).forEach(([k, x]) => { avgIn[k] = x.q ? x.v / x.q : 0 }) })()

  const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim()
  // ціна продажу ніколи не є собівартістю: відкидаємо значення, що збігаються з ціною продажу без ПДВ або з ПДВ
  const isSalePrice = (cost, saleNet) => saleNet > 0 && cost > 0 && [1, 1.2, 1.07].some(k => Math.abs(cost - saleNet * k) <= Math.max(0.01, saleNet * k * 0.002))
  const orderItemCost = (orderId, productId, name) => {
    const it = (itemsByOrder[orderId] || []).find(i => (productId && i.product_id === productId)) || (itemsByOrder[orderId] || []).find(i => norm(i.name) === norm(name))
    if (!it) return 0
    const q = Number(it.qty) || 0
    if (!q) return 0
    const unitCost = itemCost(it, vatOn).net / q, unitSale = itemSale(it, vatOn).net / q
    return unitCost > 0 && !isSalePrice(unitCost, unitSale) ? unitCost : 0
  }

  return docs.map(d => {
    const gross = Math.abs(Number(d.amount) || 0)
    const vat = Math.abs(Number(d.vat_amount) || 0)
    const net = r2(gross - vat)
    const out = { doc: d, date: debtDate(d), net, vat, gross, cost: 0, costSource: 'none', missing: [] }
    const ms = movsByDoc[d.id] || []
    if (ms.length) {
      out.costSource = 'stock'
      ms.forEach(m => {
        const p = prodById[m.product_id] || {}
        const qty = Number(m.quantity) || 0
        if ((p.product_type || 'goods') !== 'goods') return // послуги/витратні — без собівартості
        const name = p.name || (m.description || '').replace(/^.*?:\s*/, '') || '—'
        const saleNet = Number(m.price) || 0
        // 1) рух складу → 2) закупівельна позиції замовлення → 3) середня закупівельна з приходів → 4) 0 + у блок
        let unit = Number(m.cost_price) || 0
        let polluted = false
        if (unit > 0 && isSalePrice(unit, saleNet)) { unit = 0; polluted = true }
        if (!unit && d.order_id) unit = orderItemCost(d.order_id, m.product_id, name)
        if (!unit) unit = avgIn[m.product_id] && !isSalePrice(avgIn[m.product_id], saleNet) ? avgIn[m.product_id] : 0
        if (!(unit > 0)) out.missing.push({ name, qty, reason: polluted ? 'у русі складу стояла ціна продажу — закупівельної ціни немає' : 'немає собівартості' })
        out.cost += qty * unit
      })
    } else if (d.type === 'serviceAct') {
      out.costSource = 'service' // акт без складу — послуга, собівартості товарів немає
    } else if (d.order_id && itemsByOrder[d.order_id]?.length) {
      // документ без руху складу: частка (виручка документа / виручка замовлення) від собівартості позицій замовлення
      const items = itemsByOrder[d.order_id]
      const plan = computeOrderPlan(items, { vatOn })
      const share = plan.revenueNet > 0 ? Math.min(1, net / plan.revenueNet) : 0
      out.costSource = 'order'
      let cost = 0
      items.forEach(i => {
        const q = Number(i.qty) || 0
        let unit = orderItemCost(d.order_id, i.product_id, i.name)
        if (!unit && i.product_id) { const saleNet = q ? itemSale(i, vatOn).net / q : 0; unit = avgIn[i.product_id] && !isSalePrice(avgIn[i.product_id], saleNet) ? avgIn[i.product_id] : 0 }
        if (!(unit > 0)) out.missing.push({ name: i.name, qty: q, reason: 'немає собівартості (ні в замовленні, ні в приходах складу)' })
        cost += q * unit
      })
      out.cost = cost * share
    } else {
      out.missing.push({ name: 'усі позиції документа', qty: null, reason: 'немає руху складу і замовлення — собівартість невідома' })
    }
    out.cost = r2(out.cost)
    return out
  })
}

// ── P&L за нарахуванням у форматі computePLBreakdown (той самий рендер таблиці) ──
export async function computeAccrualPL(year, month) {
  const { from, to } = periodRange(year, month)
  const [cash, sales] = await Promise.all([computePLBreakdown(year, month), accrualSalesDocs(from, to)])
  const cols = cash.cols
  const bucketOf = (d) => month ? String(Number(d.slice(8, 10))) : String(Number(d.slice(5, 7)))
  const zero = () => Object.fromEntries(cols.map(c => [c.key, 0]))
  const sumCells = (c) => Object.values(c).reduce((s, v) => s + v, 0)

  // Виручка і собівартість — з документів
  const revRows = {}, cogsCells = zero()
  sales.forEach(s => {
    const b = bucketOf(s.date)
    const label = DOC_LABEL[s.doc.type] || 'Інші документи реалізації'
    ;(revRows[label] ||= zero())[b] += s.net
    cogsCells[b] += s.cost
  })
  const revenue = Object.entries(revRows).map(([label, cells]) => ({ type: 'row', label, level: 'revenue', cells, total: sumCells(cells) }))
  const revCells = zero(); revenue.forEach(r => cols.forEach(c => { revCells[c.key] += r.cells[c.key] }))

  // Решта рівнів — з касового P&L, без виручки, собівартості (закупівлі → запас) і статей ПДВ
  const keep = { opex: [], other_income: [], below_line: [] }
  cash.rows.filter(r => r.type === 'row' && keep[r.level] && !isVatArticle(r.label)).forEach(r => keep[r.level].push(r))
  const levelCells = (lvl) => { const c = zero(); keep[lvl].forEach(r => cols.forEach(col => { c[col.key] += r.cells[col.key] || 0 })); return c }
  const opex = levelCells('opex'), oth = levelCells('other_income'), below = levelCells('below_line')
  const sub = (fn) => { const c = zero(); cols.forEach(col => { c[col.key] = fn(col.key) }); return c }
  const gp = sub(k => revCells[k] - cogsCells[k])
  const ebit = sub(k => gp[k] - opex[k])
  const np = sub(k => ebit[k] + oth[k])
  const net = sub(k => np[k] - below[k])

  const rows = []
  const header = (label, level, cells, articles) => rows.push({ type: 'header', label, level, cells, total: sumCells(cells), articles })
  const subtotal = (label, cells) => rows.push({ type: 'subtotal', label, cells, total: sumCells(cells) })
  if (revenue.length) { header('Виручка (за документами, без ПДВ)', 'revenue', revCells); revenue.forEach(r => rows.push(r)) }
  header('Собівартість відвантаженого', 'cogs', cogsCells)
  subtotal('Валовий прибуток (GP)', gp)
  if (keep.opex.length) { header('Операційні витрати (OpEx)', 'opex', opex, keep.opex.flatMap(r => r.articles || [])); keep.opex.forEach(r => rows.push(r)) }
  subtotal('Операційний прибуток (EBIT)', ebit)
  if (keep.other_income.length) { header('Інші доходи / витрати', 'other_income', oth, keep.other_income.flatMap(r => r.articles || [])); keep.other_income.forEach(r => rows.push(r)) }
  subtotal('Чистий прибуток (до податків)', np)
  if (keep.below_line.length) { header('Податки та обовʼязкові платежі (без ПДВ)', 'below_line', below, keep.below_line.flatMap(r => r.articles || [])); keep.below_line.forEach(r => rows.push(r)) }
  subtotal('Чистий прибуток (Net)', net)

  const missing = sales.filter(s => s.missing.length).map(s => ({ doc: s.doc, date: s.date, items: s.missing, costSource: s.costSource }))
  const excludedVat = cash.rows.filter(r => r.type === 'row' && isVatArticle(r.label)).map(r => ({ label: r.label, total: r.total }))
  return { cols, rows, netTotal: sumCells(net), sales, missing, excludedVat, from, to }
}

// ── Борги і запаси станом на дату (для звірки) ──
async function debtsAsOf(date) {
  const docs = (await fetchAll(() => qc('documents').select('id, type, direction, amount, doc_date, created_at').not('amount', 'is', null).not('direction', 'is', null)))
    .filter(d => countsAsDebt(d.type) && (d.direction === 'receivable' || d.direction === 'payable') && debtDate(d) && debtDate(d) <= date)
  const paid = {}
  ;(await loadDocPayments(docs.map(d => d.id))).forEach(p => { if (!p.date || p.date <= date) paid[p.document_id] = (paid[p.document_id] || 0) + p.amount })
  let receivable = 0, payable = 0
  docs.forEach(d => {
    const out = Math.abs(Number(d.amount) || 0) - (paid[d.id] || 0)
    if (out <= 0.5) return
    if (d.direction === 'receivable') receivable += out; else payable += out
  })
  return { receivable, payable }
}
async function inventoryAsOf(date) {
  // оцінка — за середньою ціною приходів (без ПДВ), а не за buy_price довідника (там могла бути ціна продажу)
  const sm = await fetchAll(() => qc('stock_movements').select('id, product_id, type, quantity, price, cost_price').lte('date', date))
  const bal = {}, agg = {}
  sm.forEach(m => {
    const q = Number(m.quantity) || 0
    bal[m.product_id] = (bal[m.product_id] || 0) + (m.type === 'in' ? q : -q)
    if (m.type === 'in') { const u = Number(m.cost_price) || Number(m.price) || 0; if (u > 0 && q > 0) { const x = (agg[m.product_id] ||= { q: 0, v: 0 }); x.q += q; x.v += q * u } }
  })
  const ids = Object.keys(bal).filter(id => Math.abs(bal[id]) > 0.0001)
  const prods = ids.length ? await fetchAllIn(() => supabase.from('products').select('id, product_type'), 'id', ids) : []
  return prods.reduce((s, p) => s + ((p.product_type || 'goods') === 'goods' && agg[p.id] ? bal[p.id] * (agg[p.id].v / agg[p.id].q) : 0), 0)
}

// ── Звірка: прибуток за нарахуванням − Δдебіторки + Δкредиторки − Δзапасів ≈ чистий грошовий потік ──
export async function accrualReconciliation(year, month, netProfit) {
  const { from, to } = periodRange(year, month)
  const before = addDaysIso(from, -1)
  const [d0, d1, i0, i1, txs, periodDocs] = await Promise.all([
    debtsAsOf(before), debtsAsOf(to), inventoryAsOf(before), inventoryAsOf(to),
    fetchAll(() => qc('bank_transactions').select('id, amount, direction, article, is_validated').eq('is_ignored', false).gte('date', from).lte('date', to)),
    fetchAll(() => qc('documents').select('id, type, direction, amount, vat_amount, doc_date, created_at')),
  ])
  // ПДВ у документах періоду: у боргах (з ПДВ), але не в прибутку (без ПДВ) → вихідний − вхідний
  const docsInPeriod = periodDocs.filter(d => d.amount != null && d.direction && countsAsDebt(d.type) && debtDate(d) >= from && debtDate(d) <= to)
  // Діагностика даних: документи, які не потрапляють у борги на початок / виручку свого періоду
  const debtLike = periodDocs.filter(d => countsAsDebt(d.type))
  const dataIssues = {
    noDate: debtLike.filter(d => !d.doc_date && d.amount != null && d.direction).length,        // датуються днем внесення в систему
    noDateInPeriod: debtLike.filter(d => !d.doc_date && d.amount != null && d.direction && debtDate(d) >= from && debtDate(d) <= to).length,
    noAmount: debtLike.filter(d => d.amount == null).length,                                     // не входять у борги взагалі
    noDirection: debtLike.filter(d => d.amount != null && !d.direction).length,                  // невідомо, дебіторка чи кредиторка
  }
  const vatOf = (dir) => docsInPeriod.filter(d => d.direction === dir).reduce((s, d) => s + Math.abs(Number(d.vat_amount) || 0), 0)
  const vatInDocs = r2(vatOf('receivable') - vatOf('payable'))
  const dAR = d1.receivable - d0.receivable
  const dAP = d1.payable - d0.payable
  const dInv = i1 - i0
  const estimated = netProfit - dAR + dAP - dInv
  const cashFlow = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0)
  // відомі причини різниці: те, що є в грошах, але не в прибутку
  // Взаємовиключні категорії грошей, яких немає в прибутку (порядок важливий)
  const isWithdraw = (t) => /вивід|вивед|дивіденд/i.test(t.article || '')
  const cat = (t) => t.direction === 'ПФД' ? 'loans' : t.direction === 'ОЗ' ? 'fixedAssets' : isVatArticle(t.article) ? 'vat'
    : isWithdraw(t) ? 'withdrawals' : t.direction === 'Інше' ? 'other' : !(t.article || '').trim() ? 'noArticle' : !t.is_validated ? 'unvalidated' : null
  const explained = { loans: 0, fixedAssets: 0, vat: 0, withdrawals: 0, other: 0, noArticle: 0, unvalidated: 0, vatInDocs }
  txs.forEach(t => { const k = cat(t); if (k) explained[k] += Number(t.amount) || 0 })
  Object.keys(explained).forEach(k => { explained[k] = r2(explained[k]) })
  return {
    netProfit: r2(netProfit), dAR: r2(dAR), dAP: r2(dAP), dInv: r2(dInv),
    estimated: r2(estimated), cashFlow: r2(cashFlow), diff: r2(cashFlow - estimated), explained, dataIssues,
    opening: { receivable: r2(d0.receivable), payable: r2(d0.payable), inventory: r2(i0), date: before },
  }
}

// ── Маржа по замовленнях: виручка/собівартість відвантаженого, дата поставки, дата оплати, днів до оплати ──
export async function computeOrderMargins(from, to) {
  const sales = (await accrualSalesDocs('0000-01-01', to)).filter(s => s.doc.order_id)
  const byOrder = {}
  sales.forEach(s => { (byOrder[s.doc.order_id] ||= []).push(s) })
  const orderIds = Object.keys(byOrder)
  if (!orderIds.length) return []
  const orders = await fetchAllIn(() => qc('orders').select('id, order_number, client_id, paid_transaction_id, contractors(name)'), 'id', orderIds)
  const pays = await loadDocPayments(sales.map(s => s.doc.id))
  const paysByDoc = {}; pays.forEach(p => { (paysByDoc[p.document_id] ||= []).push(p) })
  const ots = await fetchAllIn(() => supabase.from('order_transactions').select('id, order_id, kind, amount, transaction_id, bank_transactions(date)'), 'order_id', orderIds).catch(() => [])
  const paidTxIds = orders.map(o => o.paid_transaction_id).filter(Boolean)
  const paidTxs = paidTxIds.length ? await fetchAllIn(() => supabase.from('bank_transactions').select('id, date, amount'), 'id', paidTxIds) : []
  const paidTxById = {}; paidTxs.forEach(t => { paidTxById[t.id] = t })

  const rows = []
  orders.forEach(o => {
    const list = byOrder[o.id] || []
    const shipDate = list.map(s => s.date).sort().pop() // дата поставки — остання видаткова/акт замовлення
    if (!shipDate || shipDate < from || shipDate > to) return
    const revenue = r2(list.reduce((t, s) => t + s.net, 0))
    const cost = r2(list.reduce((t, s) => t + s.cost, 0))
    const gross = list.reduce((t, s) => t + s.gross, 0)
    // оплати клієнта: по транзакціях (замовлення / документи / пряма прив'язка), одна транзакція — один раз
    // у межах одного джерела частки транзакції сумуються; між джерелами (документ / замовлення / пряма
    // прив'язка) та сама транзакція береться один раз — максимум
    const src = () => ({})
    const put = (m, txId, amount, date, key) => { const k = txId || key; const cur = (m[k] ||= { amount: 0, date: null }); cur.amount += amount; cur.date = cur.date || date || null }
    const fromDocs = src(), fromOrder = src(), fromDirect = src()
    list.forEach(s => (paysByDoc[s.doc.id] || []).forEach((p, i) => put(fromDocs, p.transaction_id, p.amount, p.date, 'd' + s.doc.id + i)))
    ots.filter(t => t.order_id === o.id && t.kind === 'income').forEach((t, i) => put(fromOrder, t.transaction_id, Number(t.amount) || 0, t.bank_transactions?.date, 'o' + i))
    const pt = o.paid_transaction_id && paidTxById[o.paid_transaction_id]
    if (pt) put(fromDirect, pt.id, Math.abs(Number(pt.amount) || 0), pt.date, 'p')
    const byTx = {}
    ;[fromDocs, fromOrder, fromDirect].forEach(m => Object.entries(m).forEach(([k, v]) => { if (!byTx[k] || v.amount > byTx[k].amount) byTx[k] = { amount: v.amount, date: v.date || byTx[k]?.date || null } }))
    const payments = Object.values(byTx).filter(p => p.amount > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    let acc = 0, payDate = null
    for (const p of payments) { acc += p.amount; if (acc >= gross - 0.5) { payDate = p.date; break } }
    const paid = r2(Math.min(acc, gross))
    rows.push({
      id: o.id, number: o.order_number || o.id.slice(0, 6), client: o.contractors?.name || '—',
      revenue, cost, margin: r2(revenue - cost), marginPct: revenue > 0 ? (revenue - cost) / revenue : null,
      shipDate, payDate, daysToPay: payDate ? daysBetween(shipDate, payDate) : null,
      paid, gross: r2(gross), paidPct: gross > 0 ? Math.min(1, paid / gross) : null,
      missingCost: list.some(s => s.missing.length), docs: list.length,
    })
  })
  return rows.sort((a, b) => (b.shipDate || '').localeCompare(a.shipDate || ''))
}

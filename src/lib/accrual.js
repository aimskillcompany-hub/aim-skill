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
import { computePLBreakdown, periodRange, rangeBucket } from './pl'
import { countsAsDebt, debtDate, loadDocPayments } from './debts'
import { computeOrderPlan, itemCost, itemSale } from './orderPlan'
import { getCompany } from './companyConfig'
import { addDaysIso, daysBetween } from './dates'
import { loadBatches } from './batches'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const isVatArticle = (name) => /ПДВ/i.test(name || '')
const DOC_LABEL = { waybill: 'Видаткові накладні (товари)', serviceAct: 'Акти (послуги)' }

// ── Документи реалізації періоду з собівартістю ──
// ── ПДВ постачальника по замовленню: з прихідних (vat_amount), для перевірки — текст платежів ──
// → { '<order>|<supplier>': { docVat: true|false|undefined, payVat: true|false|undefined, docs: [...], pays: [...] } }
// '<order>|*' — по всіх постачальниках замовлення. docVat — головне джерело; payVat лише для ⚠ «розбіжність ПДВ».
export const payTextVat = (t) => {
  const x = String(t || '').toLowerCase()
  if (/без\s*пдв|пдв\s*не\s*(перед|обклад|нарах)|не\s*(є\s*)?платник\w*\s*пдв|звільн\w*\s*від\s*пдв/.test(x)) return false
  if (/пдв|vat/.test(x)) return true
  return undefined
}
const vNorm = (t) => String(t || '').toLowerCase().replace(/[«»"'()[\],.;:]/g, ' ').replace(/\s+/g, ' ').trim()
const vTokens = (t) => vNorm(t).split(' ').filter(w => w.length >= 3)
function vNameScore(a, b) {
  const A = vTokens(a), B = vTokens(b)
  if (!A.length || !B.length) return 0
  const [short, long] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)]
  return short.filter(w => long.has(w)).length / short.length
}
const vItems = (raw) => { if (!raw) return []; if (Array.isArray(raw)) return raw; try { const x = JSON.parse(raw); return Array.isArray(x) ? x : [] } catch { return [] } }

// Прихідні постачальника по замовленню: прив'язані до замовлення (order_id) АБО від постачальника позиції замовлення,
// не прив'язані до жодного замовлення, з товаром замовлення в позиціях (назва ≥ 60% слів).
// Платежі постачальнику: прив'язані до прихідної (transaction_documents) або до замовлення (order_transactions)
// АБО оплати цьому контрагенту від −30 до +120 днів від дати прихідної. how — як знайдено (для перевірки).
export async function loadSupplierVat(orderIds, oItems = null) {
  const map = {}
  if (!orderIds?.length) return map
  const items = oItems || await fetchAllIn(() => supabase.from('order_items').select('id, order_id, product_id, name, supplier_id'), 'order_id', orderIds).catch(() => [])
  const isDebt = (d) => countsAsDebt(d.type) && d.amount != null
  const linked = (await fetchAllIn(() => qc('documents').select('id, type, order_id, contractor_id, vat_amount, amount, doc_number, doc_date, created_at, direction').eq('direction', 'payable'), 'order_id', orderIds)).filter(isDebt)
  const supIds = [...new Set(items.map(i => i.supplier_id).filter(Boolean))]
  const supDocs = supIds.length ? (await fetchAllIn(() => qc('documents').select('id, type, order_id, contractor_id, vat_amount, amount, doc_number, doc_date, created_at, direction, ocr_data').eq('direction', 'payable'), 'contractor_id', supIds)).filter(d => isDebt(d) && !d.order_id) : []
  const docs = linked.map(d => ({ ...d, how: 'прив\'язана до замовлення' }))
  supDocs.forEach(d => {
    const names = vItems(d.ocr_data?.items).map(i => i?.name).filter(Boolean)
    orderIds.forEach(oid => {
      const mine = items.filter(i => i.order_id === oid && i.supplier_id === d.contractor_id)
      if (mine.some(i => names.some(n => vNameScore(i.name, n) >= 0.6))) docs.push({ ...d, order_id: oid, how: 'постачальник позиції, товар у прихідній' })
    })
  })
  const docIds = [...new Set(docs.map(d => d.id))]
  const tds = docIds.length ? await fetchAllIn(() => supabase.from('transaction_documents').select('document_id, transaction_id'), 'document_id', docIds).catch(() => []) : []
  const ots = await fetchAllIn(() => supabase.from('order_transactions').select('order_id, transaction_id'), 'order_id', orderIds).catch(() => [])
  const ctrIds = [...new Set([...docs.map(d => d.contractor_id), ...supIds].filter(Boolean))]
  const byCtr = ctrIds.length ? await fetchAllIn(() => qc('bank_transactions').select('id, description, contractor_id, amount, date, is_ignored'), 'contractor_id', ctrIds).catch(() => []) : []
  const txIds = [...new Set([...tds, ...ots].map(t => t.transaction_id).filter(Boolean))].filter(id => !byCtr.some(t => t.id === id))
  const txs = [...byCtr, ...(txIds.length ? await fetchAllIn(() => supabase.from('bank_transactions').select('id, description, contractor_id, amount, date, is_ignored'), 'id', txIds).catch(() => []) : [])]
  const txById = {}; txs.forEach(t => { txById[t.id] = t })
  const ensure = (k) => (map[k] ||= { docs: [], pays: [] })
  docs.forEach(d => {
    const e = { id: d.id, number: d.doc_number || '—', date: debtDate(d), amount: Math.abs(Number(d.amount) || 0), vat: Math.abs(Number(d.vat_amount) || 0) > 0.005, how: d.how, contractorId: d.contractor_id }
    ensure(`${d.order_id}|${d.contractor_id}`).docs.push(e); ensure(`${d.order_id}|*`).docs.push(e)
  })
  const seen = new Set()
  const addPay = (orderId, ctrId, t, how) => {
    if (!t || t.is_ignored || !(Number(t.amount) < 0) || seen.has(orderId + t.id)) return   // лише оплати (видатки)
    seen.add(orderId + t.id)
    const p = { id: t.id, date: t.date, amount: Math.abs(Number(t.amount) || 0), text: t.description || '', vat: payTextVat(t.description), how }
    const c = ctrId || t.contractor_id
    if (c) ensure(`${orderId}|${c}`).pays.push(p)
    ensure(`${orderId}|*`).pays.push(p)
  }
  const docsById = {}; docs.forEach(d => { (docsById[d.id] ||= []).push(d) })
  tds.forEach(td => (docsById[td.document_id] || []).forEach(d => addPay(d.order_id, d.contractor_id, txById[td.transaction_id], `прив'язаний до прихідної № ${d.doc_number || '—'}`)))
  ots.forEach(o => addPay(o.order_id, null, txById[o.transaction_id], 'прив\'язаний до замовлення'))
  docs.forEach(d => {
    const dd = debtDate(d)
    byCtr.filter(t => t.contractor_id === d.contractor_id && t.date && dd && daysBetween(dd, t.date) >= -30 && daysBetween(dd, t.date) <= 120)
      .forEach(t => addPay(d.order_id, d.contractor_id, t, `оплата контрагенту ${dmyV(t.date)} (−30…+120 днів від прихідної)`))
  })
  // запасний варіант без прихідних — ознака платника ПДВ у картці постачальника
  const sups = supIds.length ? await fetchAllIn(() => supabase.from('contractors').select('id, name, is_vat_payer'), 'id', supIds).catch(() => []) : []
  const supById = {}; sups.forEach(c => { supById[c.id] = c })
  Object.entries(map).forEach(([k, v]) => {
    v.docVat = v.docs.length ? v.docs.some(d => d.vat) : undefined
    const pv = v.pays.map(p => p.vat).filter(x => x !== undefined)
    v.payVat = pv.length ? (pv.every(Boolean) ? true : pv.every(x => !x) ? false : 'mixed') : undefined
    v.mismatch = v.docVat !== undefined && v.payVat !== undefined && v.payVat !== v.docVat
  })
  map.__suppliers = supById
  return map
}
const dmyV = (s) => (s || '').split('-').reverse().join('.')
// ПДВ для позиції замовлення: прихідна цього постачальника → (позиція без постачальника) усі прихідні замовлення,
// якщо однакові → картка постачальника (is_vat_payer) → як у позиції
export function vatInfo(map, orderId, supplierId) {
  const own = supplierId ? map[`${orderId}|${supplierId}`] : null
  if (own?.docVat !== undefined) return { vat: own.docVat, source: 'прихідна', info: own }
  const all = map[`${orderId}|*`]
  if (!supplierId && all?.docs.length && (all.docs.every(d => d.vat) || all.docs.every(d => !d.vat))) return { vat: all.docVat, source: 'прихідні замовлення', info: all }
  const c = supplierId ? map.__suppliers?.[supplierId] : null
  if (c && c.is_vat_payer === false) return { vat: false, source: 'постачальник — неплатник ПДВ' }
  return { vat: undefined, source: 'ставка в позиції' }
}
function withSupplierVat(it, v) {
  if (v.vat === false) return { ...it, cost_vat_rate: 0 }
  if (v.vat === true && !(Number(it.cost_vat_rate ?? it.vat_rate) > 0)) return { ...it, cost_vat_rate: 20 }
  return it
}

// надруковані дати генерованих документів: { generated_doc_id: doc_date }
// етап 3 об'єднання: дата документа одна — documents.doc_date (з PDF синхронізується в обидва боки, 081);
// окреме читання generated_docs більше не потрібне
// eslint-disable-next-line no-unused-vars
export async function loadPrintDates(docs) { return {} }

// OUT-рухи з полями FIFO (071) і оцінки (074), з відступом для старіших схем
async function loadOutMovs(run, extra = '') {
  const base = 'id, document_id, product_id, quantity, cost_price, price, description, date, source' + extra
  for (const [cols, fifo] of [[', cost_missing_qty, cost_stale, cost_estimated_qty, cost_estimate_unit', true], [', cost_missing_qty, cost_stale', true], ['', false]]) {
    try {
      return { movs: await run(() => qc('stock_movements').select(base + cols).eq('type', 'out')), hasFifo: fifo }
    } catch (e) {
      if (!/cost_missing_qty|cost_stale|cost_estimated_qty|cost_estimate_unit/.test(e.message || '')) throw e
    }
  }
  return { movs: [], hasFifo: false }
}

// ── Списання товарів: OUT без документа (ручне списання/коригування), крім збірок (вони нейтральні —
// собівартість компонентів переходить у виріб). Собівартість — збережена в русі (FIFO), інакше середня приходів.
export async function accrualWriteoffs(from, to) {
  const { movs } = await loadOutMovs((make) => fetchAll(() => make().is('document_id', null).gte('date', from).lte('date', to)))
  const list = movs.filter(m => m.source !== 'assembly')
  if (!list.length) return []
  const prodIds = [...new Set(list.map(m => m.product_id).filter(Boolean))]
  const prods = prodIds.length ? await fetchAllIn(() => supabase.from('products').select('id, name, product_type'), 'id', prodIds) : []
  const prodById = {}; prods.forEach(p => { prodById[p.id] = p })
  const ins = prodIds.length ? await fetchAllIn(() => qc('stock_movements').select('id, product_id, quantity, price, cost_price').eq('type', 'in'), 'product_id', prodIds) : []
  const agg = {}; ins.forEach(m => { const u = Number(m.cost_price) || Number(m.price) || 0, q = Number(m.quantity) || 0; if (u > 0 && q > 0) { const x = (agg[m.product_id] ||= { q: 0, v: 0 }); x.q += q; x.v += q * u } })
  return list.filter(m => (prodById[m.product_id]?.product_type || 'goods') === 'goods').map(m => {
    const qty = Number(m.quantity) || 0
    const a = agg[m.product_id]
    const unit = Number(m.cost_price) > 0 ? Number(m.cost_price) : a?.q ? a.v / a.q : 0
    return { id: m.id, date: m.date, name: prodById[m.product_id]?.name || m.description || '—', qty, unit, cost: r2(qty * unit), description: m.description, missing: !(unit > 0) }
  })
}

// → [{ doc, net, vat, gross, date, cost, costSource: 'stock'|'order'|'none'|'service', missing: [{ name, qty, reason }] }]
export async function accrualSalesDocs(from, to) {
  const docsAll = await fetchAll(() => qc('documents')
    .select('id, type, doc_number, doc_date, created_at, amount, vat_amount, contractor_id, order_id, direction, generated_doc_id, contractors(name)')
    .eq('direction', 'receivable').not('amount', 'is', null))
  // дата видаткової — надрукована в документі (generated_docs.doc_date), далі doc_date, далі дата створення
  const gdate = await loadPrintDates(docsAll)
  const printDate = (d) => gdate[d.generated_doc_id] || debtDate(d)
  docsAll.forEach(d => { d.print_date = printDate(d) })
  const docs = docsAll.filter(d => countsAsDebt(d.type) && d.print_date >= from && d.print_date <= to)
  if (!docs.length) return []
  const ids = docs.map(d => d.id)

  // з міграцією 071 собівартість відвантаження зафіксована в русі (FIFO-партії) + к-сть без собівартості
  // 074: + к-сть, оцінена поточною собівартістю (партії немає) — позначка ⚠
  const { movs, hasFifo } = await loadOutMovs((make) => fetchAllIn(make, 'document_id', ids))
  const movsByDoc = {}; movs.forEach(m => { (movsByDoc[m.document_id] ||= []).push(m) })
  // FIFO-собівартість (071) — лише для відвантажень, реально розподілених по партіях; старі (до перебудови) —
  // колишнім ланцюгом, щоб звіт не показував 0 там, де партій ще не призначено
  const allocated = new Set()
  if (hasFifo && movs.length) {
    try {
      ;(await fetchAllIn(() => qc('stock_allocations').select('id, out_movement_id'), 'out_movement_id', movs.map(m => m.id))).forEach(a => allocated.add(a.out_movement_id))
    } catch { /* таблиці ще немає */ }
  }

  // позиції замовлень цих документів — джерело закупівельної ціни (2-й пріоритет) і частки для документів без руху
  const orderIds = [...new Set(docs.map(d => d.order_id).filter(Boolean))]
  const oItems = orderIds.length ? await fetchAllIn(() => supabase.from('order_items').select('id, order_id, product_id, qty, unit_price, cost_price, vat_rate, cost_vat_rate, price_includes_vat, name, supplier_id'), 'order_id', orderIds) : []
  const itemsByOrder = {}; oItems.forEach(i => { (itemsByOrder[i.order_id] ||= []).push(i) })
  const vatOn = (await getCompany().catch(() => null))?.isVatPayer !== false
  // ПДВ закупівлі — за прихідною постачальника (є ПДВ у документі), а не за ставкою в позиції / текстом платежу
  const supVat = await loadSupplierVat(orderIds, oItems)

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
    const unitCost = itemCost(withSupplierVat(it, vatInfo(supVat, orderId, it.supplier_id)), vatOn).net / q, unitSale = itemSale(it, vatOn).net / q
    return unitCost > 0 && !isSalePrice(unitCost, unitSale) ? unitCost : 0
  }

  // колишній ланцюг (те, що звіт показує без партій): 1) рух складу → 2) закупівельна позиції замовлення →
  // 3) середня закупівельна з приходів → 0. skipStored — для руху з FIFO (збережена = вже партійна)
  const legacyUnit = (m, name, skipStored) => {
    const saleNet = Number(m.price) || 0
    const d = docById[m.document_id]
    let unit = skipStored ? 0 : Number(m.cost_price) || 0
    if (unit > 0 && isSalePrice(unit, saleNet)) unit = 0
    if (!unit && d?.order_id) unit = orderItemCost(d.order_id, m.product_id, name)
    if (!unit) unit = avgIn[m.product_id] && !isSalePrice(avgIn[m.product_id], saleNet) ? avgIn[m.product_id] : 0
    return unit > 0 ? unit : 0
  }
  const docById = {}; docs.forEach(d => { docById[d.id] = d })

  return docs.map(d => {
    const gross = Math.abs(Number(d.amount) || 0)
    const vat = Math.abs(Number(d.vat_amount) || 0)
    const net = r2(gross - vat)
    // movUnits — поточна собівартість одиниці по кожному руху (оцінка для FIFO-нестачі); estimated — оцінені без партії (⚠)
    const out = { doc: d, date: d.print_date, net, vat, gross, cost: 0, costSource: 'none', missing: [], estimated: [], movUnits: [] }
    const ms = movsByDoc[d.id] || []
    if (ms.length) {
      out.costSource = 'stock'
      ms.forEach(m => {
        const p = prodById[m.product_id] || {}
        const qty = Number(m.quantity) || 0
        if ((p.product_type || 'goods') !== 'goods') return // послуги/витратні — без собівартості
        const name = p.name || (m.description || '').replace(/^.*?:\s*/, '') || '—'
        if (hasFifo && (allocated.has(m.id) || Number(m.cost_missing_qty) > 0 || m.cost_stale)) {
          // FIFO-партії: збережена собівартість; на що не вистачило партій — у блок (ціну з довідника не підставляємо)
          out.cost += qty * (Number(m.cost_price) || 0)
          out.movUnits.push({ id: m.id, unit: legacyUnit(m, name, true) })
          const est = Number(m.cost_estimated_qty) || 0
          if (est > 0.00001) out.estimated.push({ name, qty: est, unit: Number(m.cost_estimate_unit) || 0 })
          const miss = Number(m.cost_missing_qty) || 0
          if (miss > 0.00001) out.missing.push({ name, qty: miss, reason: 'не вистачило партій (приходів) на дату відвантаження' })
          if (m.cost_stale) out.missing.push({ name, qty, reason: 'партію, з якої списано, видалено — «Перерахувати собівартість за період»' })
          return
        }
        const saleNet = Number(m.price) || 0
        const polluted = Number(m.cost_price) > 0 && isSalePrice(Number(m.cost_price), saleNet)
        const unit = legacyUnit(m, name, false)
        out.movUnits.push({ id: m.id, unit })
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
export async function computeAccrualPL(year, month, opts = {}) {
  const range = opts.range || null
  const { from, to } = range || periodRange(year, month)
  const [cash, sales, writeoffs] = await Promise.all([computePLBreakdown(year, month, { range }), accrualSalesDocs(from, to), accrualWriteoffs(from, to).catch(() => [])])
  const cols = cash.cols
  const bucketOf = range ? rangeBucket(from, to) : (d) => month ? String(Number(d.slice(8, 10))) : String(Number(d.slice(5, 7)))
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
  // списання товарів зі складу — окремий рядок операційних витрат
  if (writeoffs.length) {
    const cells = zero(); writeoffs.forEach(w => { cells[bucketOf(w.date)] += w.cost })
    keep.opex.push({ type: 'row', label: 'Списання товарів зі складу (без документа)', level: 'opex', cells, total: sumCells(cells), writeoffs })
  }
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
  const estimated = sales.filter(s => s.estimated.length).map(s => ({ doc: s.doc, date: s.date, items: s.estimated }))
  const excludedVat = cash.rows.filter(r => r.type === 'row' && isVatArticle(r.label)).map(r => ({ label: r.label, total: r.total }))
  return { cols, rows, netTotal: sumCells(net), sales, missing, estimated, writeoffs, excludedVat, from, to }
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
  // запаси = FIFO-шари з рухів складу (lib/batches.js) — не залежить від перебудови FIFO
  const at = (await loadBatches(date)).at(date)
  const ids = Object.keys(at)
  const prods = ids.length ? await fetchAllIn(() => supabase.from('products').select('id, name, unit, product_type'), 'id', ids) : []
  const items = prods.filter(p => (p.product_type || 'goods') === 'goods').map(p => ({
    id: p.id, name: p.name, unit: p.unit || '', qty: at[p.id].qty, value: at[p.id].value,
    price: at[p.id].qty ? at[p.id].value / at[p.id].qty : 0, negative: at[p.id].negative || 0,
  }))
  return { value: items.reduce((s, x) => s + x.value, 0), items: items.filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 10) }
}

// ── Звірка: прибуток за нарахуванням − Δдебіторки + Δкредиторки − Δзапасів ≈ чистий грошовий потік ──
export async function accrualReconciliation(year, month, netProfit, opts = {}) {
  const { from, to } = opts.range || periodRange(year, month)
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
  const dInv = i1.value - i0.value
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
    opening: { receivable: r2(d0.receivable), payable: r2(d0.payable), inventory: r2(i0.value), date: before },
    inventoryTop: { opening: i0.items, closing: i1.items, closingValue: r2(i1.value), to },
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
      missingCost: list.some(s => s.missing.length), estimatedCost: list.some(s => s.estimated?.length), docs: list.length,
    })
  })
  return rows.sort((a, b) => (b.shipDate || '').localeCompare(a.shipDate || ''))
}

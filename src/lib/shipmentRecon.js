// «Звірка видаткових» (ТЗ 2026-10-20, міграція 076). Читання — лише читає дані (сухий прогін FIFO у тимчасових
// таблицях бази); зміни — лише через RPC з перевіркою ролі в базі (адміністратор / бухгалтер).
//   Рядок видаткової = документ + товар (сума OUT-рухів цього товару в документі).
//   Собівартість — як буде після «Застосувати FIFO»: 1) ручна прив'язка, 2) прихідна того ж замовлення,
//   3) FIFO на дату оприбуткування (warehouse_date ?? дата руху), 4) оцінка ⚠ (поточна собівартість).
//   Статус рядка: ✓ ок · ⏱ прихід пізніше · немає приходу · ⧉ інша картка · ⚠ ПДВ · ⚠ одиниці.
import { supabase } from './supabase'
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { accrualSalesDocs, loadSupplierVat } from './accrual'
import { buildEstimates } from './costDiagnostics'
import { debtDate } from './debts'
import { daysBetween } from './dates'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const EPS = 0.00001
export const dmy = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—')
const norm = (t) => String(t || '').toLowerCase().replace(/[«»"'()[\],.;:]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = (t) => norm(t).split(' ').filter(w => w.length >= 3)
// частка значущих слів коротшої назви, що є в довшій
export function nameScore(a, b) {
  const A = tokens(a), B = tokens(b)
  if (!A.length || !B.length) return 0
  const [short, long] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)]
  return short.filter(w => long.has(w)).length / short.length
}
const normSku = (s) => String(s || '').toUpperCase().replace(/[^0-9A-ZА-ЯІЇЄҐ]/gi, '')
// артикули не суперечать: однакові або в однієї з карток артикула немає
export const skuCompatible = (a, b) => !normSku(a) || !normSku(b) || normSku(a) === normSku(b)
const normUnit = (u) => String(u || 'шт').toLowerCase().replace(/[.\s]/g, '')
const parseItems = (raw) => { if (!raw) return []; if (Array.isArray(raw)) return raw; try { const x = JSON.parse(raw); return Array.isArray(x) ? x : [] } catch { return [] } }

export const STATUS = {
  broken: { label: '⚠ рядок змінився', cls: 'bad', rank: 7 },
  none: { label: 'немає приходу', cls: 'bad', rank: 6 },
  other: { label: '⧉ інша картка', cls: 'warn', rank: 5 },
  late: { label: '⏱ прихід пізніше', cls: 'warn', rank: 4 },
  vat: { label: '⚠ розбіжність ПДВ', cls: 'warn', rank: 3 },
  units: { label: '⚠ одиниці виміру', cls: 'warn', rank: 2 },
  ok: { label: '✓ ок', cls: 'ok', rank: 0 },
}
export const HOW_LABEL = { manual: 'вручну', order: 'те саме замовлення', fifo: 'FIFO' }

// Ціна партії без ПДВ — як batch_unit_cost (072): база збереженої ціни — звірка Σ(к-сть × ціна) прихідних рухів
// документа з сумою документа з ПДВ / без ПДВ; постачальник без ПДВ → повна ціна; ми неплатник → з ПДВ.
export function batchUnit(m, doc, docIns, wePayer = true) {
  const raw = (Number(m.cost_price) || 0) || (Number(m.price) || 0)
  if (!doc || !(Math.abs(Number(doc.amount) || 0) > 0)) return { unit: raw, basis: 'без документа — як у русі', vat: null }
  const amount = Math.abs(Number(doc.amount)), vat = Math.abs(Number(doc.vat_amount) || 0)
  if (vat <= 0.005) return { unit: raw, basis: 'постачальник без ПДВ — повна ціна', vat: false }
  const net = amount - vat
  const tot = (docIns || []).reduce((s, x) => s + (Number(x.quantity) || 0) * ((Number(x.cost_price) || 0) || (Number(x.price) || 0)), 0)
  const grossStored = Math.abs(tot - amount) < Math.abs(tot - net)
  if (wePayer) return grossStored ? { unit: Math.round(raw * net / amount * 10000) / 10000, basis: 'у русі з ПДВ → без ПДВ', vat: true } : { unit: raw, basis: 'без ПДВ', vat: true }
  return grossStored ? { unit: raw, basis: 'з ПДВ (ми неплатник)', vat: true } : { unit: raw * amount / (net || 1), basis: 'без ПДВ → з ПДВ (ми неплатник)', vat: true }
}

// ── Помилки RPC → зрозумілі повідомлення ──
export function rpcMessage(error) {
  const m = error?.message || String(error || '')
  if (/NO_RIGHTS/.test(m)) return 'Немає прав: змінювати прив\'язки, дати оприбуткування й картки товарів можуть лише адміністратор або бухгалтер.'
  if (/PERIOD_CLOSED/.test(m)) return 'Місяць закрито: ' + (m.replace(/^.*PERIOD_CLOSED:?\s*/, '') || 'дію над документами закритого періоду заборонено') + '. Переоткрийте його в «Закритті періоду».'
  if (/TAKEN/.test(m)) return m.replace(/^.*TAKEN:\s*/, 'Партію вже прив\'язано: ')
  if (/SKU_CONFLICT/.test(m)) return m.replace(/^.*SKU_CONFLICT:\s*/, 'Об\'єднання заборонено: ')
  if (/PGRST202|could not find the function|does not exist/i.test(m) && /shipment_link|set_warehouse_date|unmerge_products|fifo_dry_run_detail|shipment_links|warehouse_date|cost_action_log/.test(m))
    return 'Спершу застосуйте міграцію 076 («Звірка видаткових»).'
  return m
}
const call = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(rpcMessage(error))
  return data
}
// прив'язка конкретного рядка видаткової (OUT-рух) до конкретного рядка прихідної (IN-рух)
export const linkAdd = ({ outMov, inMov, qty }) => call('shipment_link_add', { p_out_mov: outMov, p_in_mov: inMov, p_qty: qty })
export const linkRemove = (linkId) => call('shipment_link_remove', { p_link: linkId })
export const setWarehouseDate = (inDoc, date, recalcOutDoc = null) => call('set_warehouse_date', { p_in_doc: inDoc, p_date: date || null, p_recalc_out_doc: recalcOutDoc })
export const mergeCards = (keepId, dupId) => call('merge_products', { p_keep: keepId, p_dup: dupId })
export const unmergeCards = (logId) => call('unmerge_products', { p_log: logId })

// останні об'єднання карток (для «Скасувати об'єднання»)
export async function loadRecentMerges(limit = 5) {
  const { data, error } = await supabase.from('cost_action_log').select('id, created_at, action, line, before, after').in('action', ['merge', 'unmerge']).order('created_at', { ascending: false }).limit(50)
  if (error) return []
  const undone = new Set((data || []).filter(x => x.action === 'unmerge').map(x => x.before?.merge_log))
  return (data || []).filter(x => x.action === 'merge' && !undone.has(x.id)).slice(0, limit)
}

// картка товару для вікна «Порівняти й об'єднати»: приходи, продажі, залишок
export async function loadCardStats(productId) {
  const [{ data: p }, mv] = await Promise.all([
    supabase.from('products').select('id, name, sku, unit, status').eq('id', productId).maybeSingle(),
    fetchAll(() => qc('stock_movements').select('id, type, quantity').eq('product_id', productId)),
  ])
  const ins = mv.filter(m => m.type === 'in'), outs = mv.filter(m => m.type === 'out')
  const sum = (a) => a.reduce((s, m) => s + (Number(m.quantity) || 0), 0)
  return { ...(p || { id: productId }), receipts: ins.length, receiptsQty: r2(sum(ins)), sales: outs.length, salesQty: r2(sum(outs)), stock: r2(sum(ins) - sum(outs)) }
}

// позиції документа «як у документі» (згенерований або розпізнаний), без перерахунку ПДВ
export async function loadDocLines(docId) {
  const { data: d } = await supabase.from('documents').select('id, ocr_data, generated_doc_id').eq('id', docId).maybeSingle()
  let items = []
  if (d?.generated_doc_id) {
    const { data: g } = await supabase.from('generated_docs').select('items').eq('id', d.generated_doc_id).maybeSingle()
    items = parseItems(g?.items)
  }
  if (!items.length) items = parseItems(d?.ocr_data?.items)
  return items.filter(i => i?.name).map(i => {
    const qty = Number(i.quantity ?? i.qty) || 0
    const price = Number(i.unitPrice ?? i.unit_price ?? i.price) || 0
    return { name: String(i.name), sku: i.sku || i.code || '', unit: i.unit || 'шт', qty, price, sum: r2(Number(i.amount) || qty * price), vat: i.vatRate ?? i.vat_rate ?? null }
  })
}

// повний рядок документа (для DocModal / перегляду скану)
export async function loadDocFull(docId) {
  const { data, error } = await supabase.from('documents').select('*, contractors(name)').eq('id', docId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// ───────────────────────── Завантаження ─────────────────────────
// Повертає { docs: [...], needs076, from, to } — усі видаткові періоду (без мовчазних лімітів), кожна з рядками,
// джерелами (партії сухого прогону), кандидатами, статусами.
export async function loadRecon(from, to) {
  const sales = await accrualSalesDocs(from, to)
  const saleDocs = sales.map(s => s.doc)
  const docIds = saleDocs.map(d => d.id)
  // doc_line (076) — номер рядка документа; до міграції — без нього
  const outCols = 'id, document_id, product_id, quantity, price, cost_price, date, order_id, created_at'
  let outs = []
  if (docIds.length) {
    for (const extra of [', doc_line, cost_missing_qty, cost_estimated_qty', ', cost_missing_qty, cost_estimated_qty', '']) {
      try { outs = await fetchAllIn(() => qc('stock_movements').select(outCols + extra).eq('type', 'out'), 'document_id', docIds); break } catch (e) { if (!extra) throw e }
    }
  }

  // сухий прогін з деталями партій — уся історія (щоб вільний залишок партій був точним)
  let dry = { rows: [], allocs: [] }, needs076 = false
  {
    const estimates = buildEstimates(sales)
    const { data, error } = await supabase.rpc('fifo_dry_run_detail_json', { p_cost_from: '2000-01-01', p_estimates: estimates })
    if (error) {
      needs076 = true
      const r = await supabase.rpc('fifo_dry_run_json', { p_cost_from: '2000-01-01', p_estimates: estimates })
      if (r.error) throw new Error(rpcMessage(r.error))
      dry = { rows: r.data || [], allocs: [] }
    } else dry = data || dry
  }
  // активні прив'язки, розв'язані до рухів (out_id / in_id; resolved=false — рядок документа змінився)
  let links = []
  {
    const { data, error } = await supabase.rpc('shipment_links_resolved_json')
    if (error) needs076 = true
    else links = data || []
  }

  // товари: рядків + усі активні (для «інша картка»)
  const allProds = await fetchAll(() => supabase.from('products').select('id, name, sku, unit, status, product_type'))
  const prodById = {}; allProds.forEach(p => { prodById[p.id] = p })
  const outProdIds = [...new Set(outs.map(m => m.product_id).filter(Boolean))]
  const similar = {}
  outProdIds.forEach(pid => {
    const p = prodById[pid]; if (!p?.name) { similar[pid] = []; return }
    similar[pid] = allProds.filter(x => x.id !== pid && x.status !== 'archived' && nameScore(p.name, x.name) >= 0.6 && skuCompatible(p.sku, x.sku))
  })
  const candProdIds = [...new Set([...outProdIds, ...Object.values(similar).flat().map(x => x.id)])]
  const inCols = 'id, product_id, quantity, price, cost_price, date, document_id, order_id, supplier_order_id, company_id, created_at'
  const selIns = async (col, ids) => {
    try { return await fetchAllIn(() => qc('stock_movements').select(inCols + ', doc_line').eq('type', 'in'), col, ids) } catch { return fetchAllIn(() => qc('stock_movements').select(inCols).eq('type', 'in'), col, ids) }
  }
  const ins = candProdIds.length ? await selIns('product_id', candProdIds) : []
  // приходи з алокацій (на випадок товару, якого немає серед кандидатів, напр. після об'єднання)
  const allocInIds = [...new Set(dry.allocs.map(a => a.in_id))].filter(id => !ins.some(m => m.id === id))
  if (allocInIds.length) ins.push(...await selIns('id', allocInIds))
  const inDocIds = [...new Set(ins.map(m => m.document_id).filter(Boolean))]
  const docCols = 'id, type, doc_number, doc_date, created_at, amount, vat_amount, contractor_id, order_id, direction, contractors(name)'
  let inDocs = []
  if (inDocIds.length) {
    try { inDocs = await fetchAllIn(() => qc('documents').select(docCols + ', warehouse_date'), 'id', inDocIds) } catch { needs076 = true; inDocs = await fetchAllIn(() => qc('documents').select(docCols), 'id', inDocIds) }
  }
  const inDocById = {}; inDocs.forEach(d => { inDocById[d.id] = d })
  // усі IN-рухи цих документів (для бази ПДВ у ціні партії)
  const docInsAll = inDocIds.length ? await fetchAllIn(() => qc('stock_movements').select('id, document_id, quantity, price, cost_price').eq('type', 'in'), 'document_id', inDocIds) : []
  const docIns = {}; docInsAll.forEach(m => { (docIns[m.document_id] ||= []).push(m) })
  const soIds = [...new Set(ins.map(m => m.supplier_order_id).filter(Boolean))]
  const sos = soIds.length ? await fetchAllIn(() => qc('supplier_orders').select('id, order_id'), 'id', soIds).catch(() => []) : []
  const soOrder = {}; sos.forEach(s => { soOrder[s.id] = s.order_id })
  const { data: comps } = await supabase.from('companies').select('id, is_vat_payer')
  const payer = {}; (comps || []).forEach(c => { payer[c.id] = c.is_vat_payer !== false })

  const orderIds = [...new Set([...saleDocs.map(d => d.order_id), ...outs.map(m => m.order_id)].filter(Boolean))]
  const orders = orderIds.length ? await fetchAllIn(() => qc('orders').select('id, order_number'), 'id', orderIds).catch(() => []) : []
  const orderNo = {}; orders.forEach(o => { orderNo[o.id] = o.order_number })
  const oItems = orderIds.length ? await fetchAllIn(() => supabase.from('order_items').select('id, order_id, product_id, name, supplier_id, qty, unit'), 'order_id', orderIds).catch(() => []) : []
  const vatMap = orderIds.length ? await loadSupplierVat(orderIds, oItems).catch(() => ({})) : {}

  const docs = computeRecon({ saleDocs, outs, dry, links, prodById, similar, ins, inDocById, docIns, soOrder, payer, orderNo, oItems, vatMap })
  return { docs, needs076, from, to }
}

// ───────────────────────── Розрахунок (чиста функція — для тестів) ─────────────────────────
export function computeRecon({ saleDocs, outs, dry, links, prodById, similar, ins, inDocById, docIns, soOrder = {}, payer = {}, orderNo = {}, oItems = [], vatMap = {} }) {
  const rowByOut = {}; (dry.rows || []).forEach(r => { rowByOut[r.out_id] = r })
  const allocsByOut = {}, usedByIn = {}
  ;(dry.allocs || []).forEach(a => { (allocsByOut[a.out_id] ||= []).push(a); usedByIn[a.in_id] = (usedByIn[a.in_id] || 0) + (Number(a.qty) || 0) })
  const linkedByIn = {}
  ;(links || []).filter(l => l.resolved !== false && l.in_id).forEach(l => { linkedByIn[l.in_id] = (linkedByIn[l.in_id] || 0) + (Number(l.qty) || 0) })
  const inById = {}; ins.forEach(m => { inById[m.id] = m })
  const insByProd = {}; ins.forEach(m => { (insByProd[m.product_id] ||= []).push(m) })
  const orderOfIn = (m) => m.order_id || inDocById[m.document_id]?.order_id || soOrder[m.supplier_order_id] || null
  const whDate = (m) => inDocById[m.document_id]?.warehouse_date || m.date
  const unitOf = (m) => batchUnit(m, inDocById[m.document_id], docIns[m.document_id], payer[m.company_id] !== false)
  const freeOf = (m) => r2((Number(m.quantity) || 0) - (usedByIn[m.id] || 0))

  const outsByDoc = {}; outs.forEach(m => { (outsByDoc[m.document_id] ||= []).push(m) })

  return saleDocs.filter(d => outsByDoc[d.id]?.length).map(d => {
    // рядок = конкретний OUT-рух (той самий товар двічі в документі — два рядки), у порядку рядків документа
    const docOuts = outsByDoc[d.id].slice().sort((a, b) => (a.doc_line ?? 1e9) - (b.doc_line ?? 1e9) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)))
    const orderId = d.order_id || docOuts.find(m => m.order_id)?.order_id || null
    const lines = docOuts.map((m0, idx) => {
      const pid = m0.product_id, ms = [m0]
      const p = prodById[pid] || {}
      const qty = r2(ms.reduce((s, m) => s + (Number(m.quantity) || 0), 0))
      const shipDate = ms.map(m => m.date).sort()[0]
      const saleNet = r2(ms.reduce((s, m) => s + (Number(m.quantity) || 0) * (Number(m.price) || 0), 0))
      const rows = ms.map(m => rowByOut[m.id]).filter(Boolean)
      const cost = r2(rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.new_unit) || 0), 0))
      const currentCost = r2(ms.reduce((s, m) => s + (Number(m.quantity) || 0) * (Number(m.cost_price) || 0), 0))
      const estQty = r2(rows.reduce((s, r) => s + (Number(r.est_qty) || 0), 0))
      const missingQty = r2(rows.reduce((s, r) => s + (Number(r.missing_qty) || 0), 0))
      const service = (p.product_type || 'goods') === 'service'
      // джерела — партії сухого прогону
      const sources = ms.flatMap(m => (allocsByOut[m.id] || []).map(a => {
        const im = inById[a.in_id] || {}, idoc = inDocById[im.document_id]
        return {
          inId: a.in_id, inDocId: im.document_id || null, inLine: im.doc_line ?? null, inProductId: im.product_id || null, docNo: idoc?.doc_number || '—', docDate: idoc ? debtDate(idoc) : im.date,
          inProductName: prodById[im.product_id]?.name || '', inProductSku: prodById[im.product_id]?.sku || '', inUnit: prodById[im.product_id]?.unit || '', inQty: Number(im.quantity) || 0,
          whDate: idoc?.warehouse_date || im.date, supplier: idoc?.contractors?.name || '—', qty: r2(a.qty), unit: Number(a.unit) || 0,
          vat: idoc ? Math.abs(Number(idoc.vat_amount) || 0) > 0.005 : null, how: a.how || 'fifo', basis: a.basis, otherCard: im.product_id && im.product_id !== pid,
          late: (idoc?.warehouse_date || im.date) > shipDate,
        }
      }))
      const covered = !service && estQty <= EPS && missingQty <= EPS && rows.length > 0
      const lineLinks = (links || []).filter(l => l.resolved !== false && l.out_id === m0.id)

      // кандидати (коли не все покрито партіями): 1) те саме замовлення, 2) той самий товар з вільним залишком,
      // 3) інша картка (назва ≥ 60%, артикули не суперечать)
      const candidates = []
      if (!covered && !service) {
        const usedIns = new Set(sources.map(s => s.inId))
        const mk = (m, kind) => {
          const idoc = inDocById[m.document_id], u = unitOf(m)
          const linked = linkedByIn[m.id] || 0
          const free = r2(Math.min(freeOf(m), (Number(m.quantity) || 0) - linked))
          const wd = whDate(m)
          return {
            kind, inId: m.id, inDocId: m.document_id || null, inLine: m.doc_line ?? null, inProductId: m.product_id, inProductName: prodById[m.product_id]?.name || '',
            inProductSku: prodById[m.product_id]?.sku || '', inUnit: prodById[m.product_id]?.unit || '', inQty: Number(m.quantity) || 0, docNo: idoc?.doc_number || '—', docDate: idoc ? debtDate(idoc) : m.date, whDate: wd,
            supplier: idoc?.contractors?.name || '—', late: wd > shipDate, unit: r2(u.unit), basis: u.basis, vat: u.vat, free, qty: Number(m.quantity) || 0,
            otherCard: m.product_id !== pid, sameOrder: !!orderId && orderOfIn(m) === orderId,
          }
        }
        const pool = [...(insByProd[pid] || []), ...(similar[pid] || []).flatMap(x => insByProd[x.id] || [])].filter(m => !usedIns.has(m.id))
        const seen = new Set()
        const push = (m, kind) => { if (seen.has(m.id)) return; seen.add(m.id); candidates.push(mk(m, kind)) }
        if (orderId) pool.filter(m => orderOfIn(m) === orderId).forEach(m => push(m, 'order'))
        pool.filter(m => m.product_id === pid).map(m => [m, freeOf(m)]).filter(([, f]) => f > EPS)
          .sort((a, b) => String(a[0].date).localeCompare(String(b[0].date))).forEach(([m]) => push(m, 'product'))
        pool.filter(m => m.product_id !== pid && freeOf(m) > EPS)
          .sort((a, b) => nameScore(p.name, prodById[b.product_id]?.name) - nameScore(p.name, prodById[a.product_id]?.name)).forEach(m => push(m, 'other'))
        candidates.splice(5)
      }

      // одиниці виміру
      const pu = normUnit(p.unit)
      const unitIssues = []
      oItems.filter(i => i.order_id === orderId && (i.product_id === pid || nameScore(i.name, p.name) >= 0.6) && i.unit && normUnit(i.unit) !== pu)
        .forEach(i => unitIssues.push(`у замовленні «${i.unit}» (${i.qty}), у довіднику «${p.unit || '—'}»`))
      ;(insByProd[pid] || []).forEach(m => { const k = (Number(m.quantity) || 0) / (qty || 1); if (qty && (k >= 500 || k <= 0.002)) unitIssues.push(`прихід ${m.quantity} від ${dmy(m.date)} — к-сть у ~${k >= 1 ? Math.round(k) : '1/' + Math.round(1 / k)} разів інша`) })
      if (qty && Math.abs(qty - Math.round(qty)) > 0.0001 && /шт|од/.test(pu)) unitIssues.push(`дробова к-сть ${qty} при одиниці «${p.unit || 'шт'}»`)

      // ПДВ: прихідна vs текст платежу (за постачальником позиції замовлення або всіма постачальниками замовлення)
      const supIds = [...new Set(oItems.filter(i => i.order_id === orderId && (i.product_id === pid || nameScore(i.name, p.name) >= 0.6)).map(i => i.supplier_id).filter(Boolean))]
      const supSrc = [...new Set(sources.map(s => s.inDocId && inDocById[s.inDocId]?.contractor_id).filter(Boolean))]
      const vatEntries = orderId ? [...new Set([...supIds, ...supSrc])].map(s => vatMap[`${orderId}|${s}`]).filter(Boolean) : []
      const vatMismatch = vatEntries.find(v => v.mismatch) || null

      const flags = []
      if (!service) {
        if (!covered) {
          if (candidates.some(c => !c.otherCard && c.late)) flags.push('late')
          else if (candidates.some(c => c.otherCard)) flags.push('other')
          else flags.push('none')
        }
        if (vatMismatch) flags.push('vat')
        if (unitIssues.length) flags.push('units')
      }
      const status = flags.length ? flags.slice().sort((a, b) => STATUS[b].rank - STATUS[a].rank)[0] : 'ok'
      return {
        key: m0.id, outId: m0.id, lineNo: m0.doc_line ?? idx + 1, unitPrice: Number(m0.price) || 0, productId: pid, name: p.name || '—', sku: p.sku || '', unit: p.unit || 'шт', qty, shipDate,
        saleNet, cost, currentCost, estQty, missingQty, margin: r2(saleNet - cost), marginPct: saleNet > 0 ? (saleNet - cost) / saleNet : null,
        sources, candidates, links: lineLinks, unitIssues, vatMismatch, flags, status, service, outIds: ms.map(m => m.id),
      }
    })
    const docStatus0 = lines.reduce((w, l) => STATUS[l.status].rank > STATUS[w].rank ? l.status : w, 'ok')
    const hasBroken = (links || []).some(l => l.resolved === false && l.out_document_id === d.id)
    const docStatus = hasBroken ? 'broken' : docStatus0
    const flags = [...new Set([...lines.flatMap(l => l.flags), ...(hasBroken ? ['broken'] : [])])]
    // підказка: усі документи постачальника пізніші за видаткову
    let tip = null
    const shipDate = docOuts.map(m => m.date).sort()[0]
    const prob = lines.filter(l => l.status === 'late')
    if (prob.length) {
      const v = orderId ? vatMap[`${orderId}|*`] : null
      const sdocs = [...(v?.docs || []).map(x => ({ t: `прихідна № ${x.number} від ${dmy(x.date)}`, date: x.date })),
        ...prob.flatMap(l => l.candidates.filter(c => c.late && !c.otherCard).map(c => ({ t: `прихідна № ${c.docNo} від ${dmy(c.docDate)}${c.whDate !== c.docDate ? ` (оприбуткування ${dmy(c.whDate)})` : ''}`, date: c.whDate })))]
      const pays = (v?.pays || []).map(x => ({ t: `оплата ${dmy(x.date)}`, date: x.date }))
      const all = [...new Map([...sdocs, ...pays].map(x => [x.t, x])).values()]
      if (all.length && all.every(x => x.date > shipDate)) {
        tip = `Усі документи постачальника пізніші за цю видаткову (${dmy(shipDate)}): ${all.map(x => x.t).join(', ')}. Якщо товар фізично прийшов раніше — «Виправити дату оприбуткування». Якщо прихідна саме під цю видаткову — «Взяти з цієї прихідної» (дата тоді не має значення).`
      }
    }
    if (!tip && lines.some(l => l.status === 'other')) tip = 'Прихід є, але записаний на іншу картку товару. Порівняйте картки й об\'єднайте, якщо це той самий товар.'
    return {
      id: d.id, type: d.type, number: d.doc_number || '—', date: debtDate(d), shipDate, contractor: d.contractors?.name || '—', orderId, orderNo: orderId ? orderNo[orderId] || null : null,
      lines, status: docStatus, flags, tip,
      // прив'язки, чий рядок не знайдено після редагування документа — перевірити / зняти
      brokenLinks: (links || []).filter(l => l.resolved === false && (l.out_document_id === d.id)).map(l => ({ ...l, productName: prodById[l.out_product_id]?.name || '—', inDocNo: inDocById[l.in_document_id]?.doc_number || '—' })),
      cost: r2(lines.reduce((s, l) => s + l.cost, 0)), needsAction: lines.filter(l => l.status !== 'ok').length,
    }
  })
}

export function sortDocs(docs) {
  return docs.slice().sort((a, b) => (STATUS[b.status].rank > 0) - (STATUS[a.status].rank > 0) || String(b.date || '').localeCompare(String(a.date || '')))
}

// ───────────────────────── Таблиця «продаж ↔ закупівля» (макет 2026-10-20) ─────────────────────────
const UNIT_K = { 'км|м': 1 / 1000, 'м|км': 1000, 'т|кг': 1 / 1000, 'кг|т': 1000, 'кг|г': 1 / 1000, 'г|кг': 1000, 'л|мл': 1 / 1000, 'мл|л': 1000 }
// ціна за одиницю закупівлі → за одиницю продажу (км → м: /1000); null — одиниці різні й непереводимі
export function unitFactor(inUnit, saleUnit) {
  const a = normUnit(inUnit), b = normUnit(saleUnit)
  if (!inUnit || a === b) return 1
  return UNIT_K[`${a}|${b}`] ?? null
}
const normName = (t) => String(t || '').toLowerCase().replace(/[«»"'()[\],.;:]/g, ' ').replace(/\s+/g, ' ').trim()

// рядок таблиці: продаж (рядок видаткової) ↔ закупівля (партія, з якої списано, або найкращий кандидат), дати, маржа, недоліки
// flags: [{ code, level: 'r'|'a', text }]; cls — підсвітка клітинок
export function tableRow(doc, l) {
  const src = l.sources.slice().sort((a, b) => b.qty - a.qty)[0] || null
  const pur = src || l.candidates[0] || null
  const k = pur ? unitFactor(pur.inUnit, l.unit) : 1
  const unitsDiffer = !!pur && !!pur.inUnit && normUnit(pur.inUnit) !== normUnit(l.unit)
  const salePrice = l.qty ? l.saleNet / l.qty : 0
  // собівартість одиниці продажу: FIFO (з оцінкою) у тих самих одиницях; якщо одиниці різні — ціна партії, переведена
  const costUnit = l.service ? 0
    : unitsDiffer && k != null && pur ? pur.unit * k
    : l.cost > 0 && l.qty ? l.cost / l.qty
    : pur ? pur.unit * (k ?? 1) : 0
  const costSum = r2(costUnit * l.qty)
  const marginUnit = salePrice - costUnit, marginSum = r2(l.saleNet - costSum)
  const marginPct = l.saleNet > 0 ? marginSum / l.saleNet * 100 : null
  const days = pur?.whDate && l.shipDate ? daysBetween(pur.whDate, l.shipDate) : null
  const flags = [], cls = {}
  const add = (code, level, text, cells = []) => { flags.push({ code, level, text }); cells.forEach(c => { if (cls[c] !== 'r') cls[c] = level }) }
  if (!l.service) {
    if (l.status === 'broken' || l.flags.includes('broken')) add('broken', 'r', '⚠ рядок змінився')
    if (!pur) add('none', 'r', 'немає приходу', ['rd', 'pc'])
    else if (!src && l.missingQty + l.estQty <= 0.0001) { /* покрито без джерела (напр. послуга) */ }
    if (days != null && days < 0) add('late', 'r', `прихід на ${-days} дн. пізніше`, ['dr', 'days'])
    if (pur && (pur.otherCard || (pur.inProductName && normName(pur.inProductName) !== normName(l.name)))) add('name', 'a', pur.otherCard ? '⧉ інша картка' : 'інша назва', ['nr'])
    if (unitsDiffer || l.unitIssues.length) add('unit', 'a', unitsDiffer ? `одиниці: ${l.unit} ↔ ${pur.inUnit}${k == null ? ' (не переводяться)' : ''}` : '⚠ одиниці', ['ur'])
    if (l.estQty > 0) add('est', 'a', '⚠ оцінка', ['pc'])
    if (l.missingQty > 0 && pur) add('nocost', 'r', `без собівартості ${l.missingQty}`, ['pc'])
    if (costUnit > 0 && Math.abs(costUnit - salePrice) < 0.5) add('eq', 'r', 'собівартість = ціна продажу', ['pc'])
    if (l.vatMismatch) add('vat', 'a', '⚠ розбіжність ПДВ', ['vat'])
    if (marginSum < 0) add('marg', 'r', 'збиток', ['m'])
    else if (marginPct != null && marginPct < 5) add('marg', 'a', 'маржа < 5%', ['m'])
    else if (marginPct != null && marginPct > 60) add('marg', 'a', 'маржа > 60% — чи є собівартість?', ['m'])
    else cls.m = cls.m || 'g'
  }
  const has = (c) => flags.some(f => f.code === c)
  return {
    key: l.key, doc, line: l, src: pur, fromBatch: !!src,
    lineNo: l.lineNo, saleName: l.name, saleSku: l.sku, qty: l.qty, saleUnit: l.unit, salePrice,
    purName: pur?.inProductName || (pur ? l.name : null), purDocNo: pur?.docNo || null, purDocId: pur?.inDocId || null, supplier: pur?.supplier || null,
    purQty: pur ? (src ? pur.inQty || pur.qty : pur.inQty || pur.qty) : null, purUnit: pur?.inUnit || null, purPriceRaw: pur?.unit ?? null,
    costUnit, costSum, vat: pur ? (pur.vat == null ? '—' : pur.vat ? 'так' : 'ні') : null,
    inDate: pur?.whDate || null, shipDate: l.shipDate, days, marginUnit, marginSum, marginPct,
    estimated: l.estQty > 0, service: l.service, flags, cls, bad: flags.length > 0,
    tags: { late: has('late'), none: has('none'), name: has('name'), unit: has('unit'), marg: has('marg') || has('eq'), vat: has('vat'), est: has('est'), broken: has('broken') },
  }
}

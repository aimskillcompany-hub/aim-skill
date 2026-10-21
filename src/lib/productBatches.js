// Партійний облік у картці товару: кожен прихід = партія (к-сть, ціна закупівлі без ПДВ, списано, залишок),
// під нею — відвантаження, що з неї взяли (ціна продажу, собівартість, маржа), і відвантаження без партії.
// Розподіл — той самий сухий прогін FIFO, що й у звірці (ручна прив'язка → те саме замовлення → FIFO на дату
// оприбуткування → оцінка ⚠ / вручну); постійні дані лише читаються.
import { supabase } from './supabase'
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { debtDate } from './debts'
import { loadPrintDates } from './accrual'
import { dmy } from './shipmentRecon'
import { batchUnit } from './batchPrice'
import { daysBetween } from './dates'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
// назва товару так, як вона записана в документі: опис руху «Прихідна накладна: <назва з документа>»
export const docItemName = (m) => {
  const d = String(m?.description || '').trim()
  if (!d || !m.document_id) return ''   // ручні рухи / збірки — опис не є назвою з документа
  const i = d.indexOf(': ')
  return (i >= 0 ? d.slice(i + 2) : d).trim()
}

// сухий прогін рахується по всій історії — кешуємо на кілька хвилин, щоб картки товарів відкривались швидко
let dryCache = null
async function dryRun(force = false) {
  if (!force && dryCache && Date.now() - dryCache.at < 5 * 60 * 1000) return dryCache.data
  const { data, error } = await supabase.rpc('fifo_dry_run_detail_json', { p_cost_from: '2000-01-01', p_estimates: {} })
  if (error) throw new Error(/fifo_dry_run_detail_json/.test(error.message || '') ? 'Спершу застосуйте міграцію 076.' : error.message)
  dryCache = { at: Date.now(), data: data || { rows: [], allocs: [] } }
  return dryCache.data
}
export const dropBatchesCache = () => { dryCache = null }

export async function loadProductBatches(productId, { force = false } = {}) {
  const movs = await fetchAll(() => qc('stock_movements').select('id, type, quantity, price, cost_price, date, document_id, order_id, company_id, source, created_at, description').eq('product_id', productId))
  const ins = movs.filter(m => m.type === 'in'), outs = movs.filter(m => m.type === 'out')
  const dry = await dryRun(force)
  const outIds = new Set(outs.map(m => m.id)), inIds = new Set(ins.map(m => m.id))
  const allocs = (dry.allocs || []).filter(a => inIds.has(a.in_id) || outIds.has(a.out_id))
  // ручні прив'язки (076) — щоб можна було зняти / переприв'язати
  const { data: linksAll } = await supabase.rpc('shipment_links_resolved_json')
  const links = (Array.isArray(linksAll) ? linksAll : []).filter(l => l.resolved !== false && (outIds.has(l.out_id) || inIds.has(l.in_id)))
  // закриті партії (080)
  const { data: locksAll } = await supabase.rpc('batch_locks_resolved_json')
  const lockByIn = {}; (Array.isArray(locksAll) ? locksAll : []).forEach(k => { if (k.in_id) lockByIn[k.in_id] = k })
  const rowByOut = {}; (dry.rows || []).forEach(r => { if (outIds.has(r.out_id)) rowByOut[r.out_id] = r })

  // документи (прихідні й видаткові) з надрукованими датами
  const docIds = [...new Set(movs.map(m => m.document_id).filter(Boolean))]
  const cols = 'id, type, doc_number, doc_date, created_at, amount, vat_amount, contractor_id, order_id, generated_doc_id, direction, contractors(name)'
  let docs = []
  if (docIds.length) {
    try { docs = await fetchAllIn(() => qc('documents').select(cols + ', warehouse_date'), 'id', docIds) } catch { docs = await fetchAllIn(() => qc('documents').select(cols), 'id', docIds) }
  }
  const gdate = await loadPrintDates(docs)
  const docById = {}; docs.forEach(d => { d.print_date = gdate[d.generated_doc_id] || debtDate(d); docById[d.id] = d })
  const inDocIds = [...new Set(ins.map(m => m.document_id).filter(Boolean))]
  const docInsAll = inDocIds.length ? await fetchAllIn(() => qc('stock_movements').select('id, document_id, quantity, price, cost_price').eq('type', 'in'), 'document_id', inDocIds) : []
  const docIns = {}; docInsAll.forEach(m => { (docIns[m.document_id] ||= []).push(m) })
  const { data: comps } = await supabase.from('companies').select('id, is_vat_payer')
  const payer = {}; (comps || []).forEach(c => { payer[c.id] = c.is_vat_payer !== false })

  const outById = {}; outs.forEach(m => { outById[m.id] = m })
  const shipment = (m) => {
    const d = docById[m.document_id]
    const r = rowByOut[m.id]
    const qty = Number(m.quantity) || 0
    return {
      outId: m.id, docId: m.document_id || null, docNo: d?.doc_number || (m.source === 'assembly' ? 'збірка' : m.source === 'manual' ? 'ручне списання' : '—'),
      date: d?.print_date || m.date, client: d?.contractors?.name || '', qty, salePrice: Number(m.price) || 0,
      cost: r ? r2(qty * (Number(r.new_unit) || 0)) : null, costUnit: r ? Number(r.new_unit) || 0 : null,
      estQty: Number(r?.est_qty) || 0, missingQty: Number(r?.missing_qty) || 0, manual: /вручну/.test(r?.bases || ''),
      isSale: !!d && d.direction === 'receivable', source: m.source, docName: docItemName(m),
    }
  }

  const batches = ins.slice().sort((a, b) => {
    const da = docById[a.document_id]?.warehouse_date || a.date, db = docById[b.document_id]?.warehouse_date || b.date
    return String(da).localeCompare(String(db)) || String(a.created_at).localeCompare(String(b.created_at))
  }).map(m => {
    const d = docById[m.document_id]
    const u = batchUnit(m, d, docIns[m.document_id], payer[m.company_id] !== false)
    const takes = allocs.filter(a => a.in_id === m.id)
    const qty = Number(m.quantity) || 0
    const used = takes.reduce((s, a) => s + (Number(a.qty) || 0), 0)
    const wh = d?.warehouse_date || m.date
    const ships = takes.map(a => {
      const o = outById[a.out_id]
      const s = o ? shipment(o) : { outId: a.out_id, docNo: 'інший товар', date: null, qty: 0, salePrice: 0 }   // рух іншої картки (ручна прив'язка)
      const q = Number(a.qty) || 0, unit = Number(a.unit) || 0
      const link = (a.how === 'manual') ? links.find(l => l.out_id === a.out_id && l.in_id === a.in_id) : null
      return { ...s, inId: m.id, takeQty: r2(q), takeUnit: unit, takeCost: r2(q * unit), takeRevenue: r2(q * s.salePrice), how: a.how || 'fifo', linkId: link?.id || null, days: s.date && wh ? daysBetween(wh, s.date) : null }
    }).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    const revenue = ships.filter(s => s.isSale).reduce((t, s) => t + s.takeRevenue, 0)
    const costSold = ships.filter(s => s.isSale).reduce((t, s) => t + s.takeCost, 0)
    return {
      inId: m.id, inDocId: m.document_id || null, locked: lockByIn[m.id] || null, docId: m.document_id || null, docNo: d?.doc_number || (m.source === 'assembly' ? 'збірка' : m.source === 'manual' ? 'ручний прихід' : '—'),
      docDate: d ? d.print_date : m.date, whDate: wh, supplier: d?.contractors?.name || '', docName: docItemName(m), qty, unit: u.unit, vat: u.vat, basis: u.basis,
      value: r2(qty * u.unit), used: r2(used), left: r2(qty - used), leftValue: r2((qty - used) * u.unit),
      ships, revenue: r2(revenue), costSold: r2(costSold), margin: r2(revenue - costSold), marginPct: revenue > 0 ? (revenue - costSold) / revenue * 100 : null,
    }
  })

  // відвантаження, на які партій не вистачило (оцінка ⚠ / вручну / без собівартості)
  const covered = {}; allocs.forEach(a => { covered[a.out_id] = (covered[a.out_id] || 0) + (Number(a.qty) || 0) })
  const unbatched = outs.map(shipment).map(s => ({ ...s, uncovered: r2(s.qty - (covered[s.outId] || 0)) }))
    .filter(s => s.uncovered > 0.00001).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    // підказка: партії з залишком, датовані ПІЗНІШЕ відвантаження (найчастіша причина «без партії»)
    .map(s => ({ ...s, later: batches.filter(b => b.left > 0.00001 && s.date && b.whDate > s.date).map(b => ({ docNo: b.docNo, whDate: b.whDate, left: b.left })) }))

  const sales = outs.map(shipment).filter(s => s.isSale)
  const totIn = ins.reduce((s, m) => s + (Number(m.quantity) || 0), 0), totOut = outs.reduce((s, m) => s + (Number(m.quantity) || 0), 0)
  const revenue = sales.reduce((s, x) => s + x.qty * x.salePrice, 0), cost = sales.reduce((s, x) => s + (x.cost || 0), 0)
  return {
    batches, unbatched,
    totals: {
      in: r2(totIn), out: r2(totOut), onHand: r2(totIn - totOut),
      leftValue: r2(batches.reduce((s, b) => s + Math.max(b.leftValue, 0), 0)),
      avgBuy: totIn ? r2(batches.reduce((s, b) => s + b.value, 0) / totIn) : 0,
      avgSale: sales.length ? r2(revenue / sales.reduce((s, x) => s + x.qty, 0)) : 0,
      revenue: r2(revenue), cost: r2(cost), margin: r2(revenue - cost), marginPct: revenue > 0 ? (revenue - cost) / revenue * 100 : null,
    },
    computedAt: dryCache?.at || Date.now(),
  }
}
export { dmy }

// Ціни закупівлі товару за партіями (легко, без FIFO-прогону): ціна кожного приходу без ПДВ, остання закупівля,
// діапазон, середня ціна ЗАЛИШКУ (залишок покривається найпізнішими партіями — як оцінка складу).
export async function loadPurchaseSummary(productId) {
  const movs = await fetchAll(() => qc('stock_movements').select('id, type, quantity, price, cost_price, date, document_id, company_id, created_at').eq('product_id', productId))
  const ins = movs.filter(m => m.type === 'in')
  const docIds = [...new Set(ins.map(m => m.document_id).filter(Boolean))]
  let docs = []
  if (docIds.length) {
    try { docs = await fetchAllIn(() => qc('documents').select('id, doc_number, doc_date, created_at, amount, vat_amount, warehouse_date, contractors(name)'), 'id', docIds) } catch { docs = await fetchAllIn(() => qc('documents').select('id, doc_number, doc_date, created_at, amount, vat_amount, contractors(name)'), 'id', docIds) }
  }
  const docById = {}; docs.forEach(d => { docById[d.id] = d })
  const docInsAll = docIds.length ? await fetchAllIn(() => qc('stock_movements').select('id, document_id, quantity, price, cost_price').eq('type', 'in'), 'document_id', docIds) : []
  const docIns = {}; docInsAll.forEach(m => { (docIns[m.document_id] ||= []).push(m) })
  const { data: comps } = await supabase.from('companies').select('id, is_vat_payer')
  const payer = {}; (comps || []).forEach(c => { payer[c.id] = c.is_vat_payer !== false })
  const units = {}
  const lots = ins.map(m => {
    const d = docById[m.document_id], u = batchUnit(m, d, docIns[m.document_id], payer[m.company_id] !== false)
    units[m.id] = u
    return { id: m.id, qty: Number(m.quantity) || 0, unit: u.unit, vat: u.vat, date: d?.warehouse_date || m.date, docNo: d?.doc_number || null, supplier: d?.contractors?.name || '', created: m.created_at }
  }).filter(x => x.unit > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created).localeCompare(String(b.created)))
  const onHand = movs.reduce((s, m) => s + (m.type === 'in' ? 1 : -1) * (Number(m.quantity) || 0), 0)
  let need = Math.max(onHand, 0), value = 0
  for (const l of lots.slice().reverse()) { if (need <= 0.00001) break; const t = Math.min(need, l.qty); value += t * l.unit; need -= t }
  const covered = Math.max(onHand, 0) - Math.max(need, 0)
  const all = lots.map(l => l.unit)
  return {
    units, lots, last: lots[lots.length - 1] || null, onHand: r2(onHand),
    stockAvg: covered > 0 ? r2(value / covered) : null, stockValue: r2(value),
    min: all.length ? Math.min(...all) : null, max: all.length ? Math.max(...all) : null,
    avg: lots.length ? r2(lots.reduce((s, l) => s + l.qty * l.unit, 0) / (lots.reduce((s, l) => s + l.qty, 0) || 1)) : null,
  }
}

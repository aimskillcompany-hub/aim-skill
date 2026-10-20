// Діагностика собівартості перед перебудовою FIFO (нічого не змінює):
//   1) по замовленнях: собівартість, яку ЗАРАЗ показує звіт (P&L/Маржа, з усіма фолбеками) → за FIFO-партіями
//      (сухий прогін fifo_compute — лише тимчасові таблиці) + як отримано ціну партій (база ПДВ);
//   2) позиції, яким не вистачило партій, і можливі джерела: прихід є, але датований пізніше відвантаження;
//      прихідні документи, НЕ проведені на склад, що містять цей товар (за назвою/артикулом) або від
//      постачальника цієї позиції замовлення в розумні дати.
import { supabase } from './supabase'
import { qc, getUserCompanyId } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { accrualSalesDocs, accrualWriteoffs, loadSupplierVat } from './accrual'
import { mergeProducts } from './stockService'
import { todayKyiv } from './dates'
import { countsAsDebt, debtDate } from './debts'
import { daysBetween } from './dates'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const norm = (t) => String(t || '').toLowerCase().replace(/[«»"'()[\],.;:]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = (t) => norm(t).split(' ').filter(w => w.length >= 3)
// схожість назв: частка значущих слів коротшої назви, що є в довшій
function nameScore(a, b) {
  const A = tokens(a), B = new Set(tokens(b))
  if (!A.length || !B.size) return 0
  const short = A.length <= B.size ? A : [...B], long = A.length <= B.size ? B : new Set(A)
  return short.filter(w => long.has(w)).length / short.length
}
const parseItems = (raw) => { if (!raw) return []; if (Array.isArray(raw)) return raw; try { const x = JSON.parse(raw); return Array.isArray(x) ? x : [] } catch { return [] } }

const GROUP_LABEL = {
  __no_order: '— без замовлення',
  __assembly: '— збірки (нейтрально: собівартість компонентів → виріб)',
  __writeoff: '— списання без документа (рядок витрат у P&L)',
}
const dmy = (s) => (s || '').split('-').reverse().join('.')
const normUnit = (u) => String(u || 'шт').toLowerCase().replace(/[.\s]/g, '')
// поточна собівартість одиниці по кожному руху відвантаження — оцінка для нестачі партій
function buildEstimates(sales) {
  const est = {}
  sales.forEach(s => (s.movUnits || []).forEach(m => { if (m.unit > 0) est[m.id] = Math.round(m.unit * 10000) / 10000 }))
  return est
}

// перенос дати приходу (рух складу) на дату відвантаження — дата документа постачальника НЕ змінюється
export async function moveInDate(inId, newDate) {
  const { error } = await qc('stock_movements').update({ date: newDate }).eq('id', inId).eq('type', 'in')
  if (error) throw new Error(/PERIOD_CLOSED/.test(error.message || '') ? 'Місяць закрито — дату змінити не можна' : error.message)
}

// прив'язати прихідну (документ) або прихід без документа до замовлення — FIFO візьме її як «своє замовлення»
export async function linkToOrder({ docId, inId, orderId }) {
  const q = docId ? qc('documents').update({ order_id: orderId }).eq('id', docId) : qc('stock_movements').update({ order_id: orderId }).eq('id', inId).eq('type', 'in')
  const { error } = await q
  if (error) throw new Error(/PERIOD_CLOSED/.test(error.message || '') ? 'Місяць закрито — змінити не можна' : error.message)
}
export async function mergeDuplicate(keepId, dupId) {
  const r = await mergeProducts(keepId, dupId)
  if (r.error) throw new Error(r.error)
  return r
}

// «Застосувати FIFO»: оцінки (поточна собівартість) по всіх відвантаженнях з from до сьогодні → набір у базі →
// fifo_apply_set (сама робить резервну копію). Якщо запит перевищить час — повертає SQL для SQL Editor.
export async function applyFifo(from) {
  const sales = await accrualSalesDocs(from, todayKyiv())
  const { data: set, error: sErr } = await supabase.from('fifo_estimate_sets').insert({ cost_from: from, estimates: buildEstimates(sales) }).select('id').single()
  if (sErr) throw new Error(/fifo_estimate_sets/.test(sErr.message || '') ? 'Спершу застосуйте міграцію 075.' : sErr.message)
  const { data, error } = await supabase.rpc('fifo_apply_set', { p_set: set.id })
  if (error) {
    if (/timeout|canceling statement/i.test(error.message || '')) return { timeout: true, sql: `select fifo_apply_set('${set.id}');` }
    throw new Error(/PERIOD_CLOSED/.test(error.message || '') ? 'Закритий місяць: ' + error.message.replace(/^.*PERIOD_CLOSED:\s*/, '') : error.message)
  }
  return { result: data, setId: set.id }
}
export async function listBackups() {
  const { data, error } = await supabase.from('cost_backups').select('id, created_at, label, cost_from, movements, allocations, prices').order('created_at', { ascending: false }).limit(5)
  if (error) return []
  return data || []
}
export async function restoreBackup(id) {
  const { data, error } = await supabase.rpc('cost_backup_restore', { p_backup: id })
  if (error) throw new Error(error.message)
  return data
}

export async function runCostDiagnostics(from, to) {
  const company = getUserCompanyId()
  // 1. «зараз» — як у звіті
  const [sales, writeoffs] = await Promise.all([accrualSalesDocs(from, to), accrualWriteoffs(from, to)])
  // 2. FIFO — сухий прогін (у тимчасових таблицях; постійні лише читає), одним jsonb (API обрізає набори до 1000).
  // Оцінка для нестачі партій — поточна собівартість руху, як зараз у звіті (074: не 0, а ⚠)
  const estimates = buildEstimates(sales)
  const { data: fifoAll, error } = await supabase.rpc('fifo_dry_run_json', { p_cost_from: from, p_estimates: estimates })
  if (error) throw new Error(/fifo_dry_run_json|fifo_rebuild|fifo_compute|WHERE clause|p_estimates/.test(error.message || '') ? 'Спершу застосуйте міграцію 074 (оцінка нестачі, ідентифікована собівартість, збірки).' : error.message)
  const fifo = (fifoAll || []).filter(r => (!company || r.company_id === company) && r.out_date <= to)

  const docIds = [...new Set(fifo.map(r => r.document_id).filter(Boolean))]
  const docs = docIds.length ? await fetchAllIn(() => qc('documents').select('id, type, doc_number, doc_date, created_at, order_id, contractor_id'), 'id', docIds) : []
  const docById = {}; docs.forEach(d => { docById[d.id] = d })
  sales.forEach(s => { docById[s.doc.id] = docById[s.doc.id] || s.doc })
  const orderIds = [...new Set([...fifo.map(r => r.order_id), ...sales.map(s => s.doc.order_id)].filter(Boolean))]
  const orders = orderIds.length ? await fetchAllIn(() => qc('orders').select('id, order_number, client_id, contractors(name)'), 'id', orderIds) : []
  const orderById = {}; orders.forEach(o => { orderById[o.id] = o })
  const prodIds = [...new Set(fifo.map(r => r.product_id).filter(Boolean))]
  const prods = prodIds.length ? await fetchAllIn(() => supabase.from('products').select('id, name, sku, unit'), 'id', prodIds) : []
  const prodById = {}; prods.forEach(p => { prodById[p.id] = p })

  // ── по замовленнях ──
  // без документа: збірки (нейтральні — собівартість переходить у виріб) і списання (рядок витрат у P&L)
  const key = (orderId, docId, source) => orderId || (docId ? '__no_order' : source === 'assembly' ? '__assembly' : '__writeoff')
  const byOrder = {}
  const ensure = (k) => (byOrder[k] ||= { key: k, current: 0, fifo: 0, shipments: 0, missingQty: 0, estQty: 0, estValue: 0, bases: new Set(), currentMissing: false })
  sales.forEach(s => {
    const g = ensure(key(s.doc.order_id, s.doc.id))
    g.current += s.cost
    if (s.missing.length) g.currentMissing = true
  })
  writeoffs.forEach(w => { const g = ensure('__writeoff'); g.current += w.cost; if (w.missing) g.currentMissing = true })
  fifo.forEach(r => {
    const g = ensure(key(r.order_id, r.document_id, r.source))
    g.fifo += (Number(r.qty) || 0) * (Number(r.new_unit) || 0)
    g.shipments += 1
    g.missingQty += Number(r.missing_qty) || 0
    g.estQty += Number(r.est_qty) || 0
    g.estValue += (Number(r.est_qty) || 0) * (Number(r.est_unit) || 0)
    String(r.bases || '').split('; ').filter(Boolean).forEach(b => g.bases.add(b))
  })
  const orderRows = Object.values(byOrder).map(g => {
    const o = orderById[g.key]
    return {
      order: o ? o.order_number : GROUP_LABEL[g.key] || g.key, neutral: g.key === '__assembly', vatWarn: [],
      orderId: o?.id || null, client: o?.contractors?.name || '',
      shipments: g.shipments, current: r2(g.current), fifo: r2(g.fifo), diff: r2(g.fifo - g.current),
      missingQty: r2(g.missingQty), estQty: r2(g.estQty), estValue: r2(g.estValue), currentMissing: g.currentMissing, bases: [...g.bases].join('; '),
    }
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

  // ── позиції без партій + можливі джерела ──
  const missingRows = fifo.filter(r => (Number(r.missing_qty) || 0) > 0.00001 || (Number(r.est_qty) || 0) > 0.00001)
  const missProdIds = [...new Set(missingRows.map(r => r.product_id))]
  // приходи цих товарів (для «є, але пізніше»)
  const ins = missProdIds.length ? await fetchAllIn(() => qc('stock_movements').select('id, product_id, quantity, date, document_id, order_id').eq('type', 'in'), 'product_id', missProdIds) : []
  const insByProd = {}; ins.forEach(m => { (insByProd[m.product_id] ||= []).push(m) })
  // прихідні документи, не проведені на склад
  const payDocs = (await fetchAll(() => qc('documents').select('id, type, direction, doc_number, doc_date, created_at, amount, contractor_id, order_id, generated_doc_id, contractors(name)').eq('direction', 'payable')))
    .filter(d => countsAsDebt(d.type) && d.type !== 'serviceAct')
  const postedDocIds = new Set(payDocs.length ? (await fetchAllIn(() => qc('stock_movements').select('id, document_id').eq('type', 'in'), 'document_id', payDocs.map(d => d.id))).map(m => m.document_id) : [])
  const unposted = payDocs.filter(d => !postedDocIds.has(d.id))
  const withItems = unposted.length ? await fetchAllIn(() => qc('documents').select('id, ocr_data'), 'id', unposted.map(d => d.id)) : []
  const ocrById = {}; withItems.forEach(x => { ocrById[x.id] = x.ocr_data })
  const genIds = unposted.map(d => d.generated_doc_id).filter(Boolean)
  const gens = genIds.length ? await fetchAllIn(() => qc('generated_docs').select('id, items'), 'id', genIds) : []
  const genById = {}; gens.forEach(g => { genById[g.id] = g.items })
  unposted.forEach(d => { d.items = [...parseItems(ocrById[d.id]?.items), ...parseItems(genById[d.generated_doc_id])].filter(i => i?.name) })
  // постачальники позицій замовлень (для збігу за постачальником)
  const missOrderIds = [...new Set(missingRows.map(r => r.order_id).filter(Boolean))]
  const oItems = missOrderIds.length ? await fetchAllIn(() => supabase.from('order_items').select('id, order_id, product_id, name, supplier_id, qty, unit, cost_price'), 'order_id', missOrderIds) : []
  const inDocIds = [...new Set(ins.map(m => m.document_id).filter(Boolean))]
  const inDocs = inDocIds.length ? await fetchAllIn(() => qc('documents').select('id, doc_number, doc_date, created_at, order_id, contractors(name)'), 'id', inDocIds) : []
  const inDocById = {}; inDocs.forEach(d => { inDocById[d.id] = d })

  // дублі карток: активні товари з дуже схожою назвою, що мають приходи
  const allProds = missProdIds.length ? await fetchAll(() => supabase.from('products').select('id, name, sku, unit, status').neq('status', 'archived')) : []
  const near = {}
  missProdIds.forEach(pid => { const p = prodById[pid]; if (p?.name) near[pid] = allProds.filter(x => x.id !== pid && nameScore(p.name, x.name) >= 0.75) })
  const nearIds = [...new Set(Object.values(near).flat().map(x => x.id))]
  const nearIns = nearIds.length ? await fetchAllIn(() => qc('stock_movements').select('id, product_id, quantity').eq('type', 'in'), 'product_id', nearIds) : []
  const inQtyOf = {}; nearIns.forEach(m => { inQtyOf[m.product_id] = (inQtyOf[m.product_id] || 0) + (Number(m.quantity) || 0) })
  const dupsOf = (p) => (near[p.id] || []).filter(x => inQtyOf[x.id] > 0).slice(0, 3).map(x => ({ ...x, inQty: r2(inQtyOf[x.id]) }))
  // ПДВ: прихідна (є ПДВ у документі) vs текст платежу постачальнику
  const vatMap = await loadSupplierVat(orderIds)
  const vatWarn = {}, vatInfoByOrder = {}
  const fmtDoc = (d) => `прихідна № ${d.number} від ${dmy(d.date)} на ${r2(d.amount)} — ${d.vat ? 'з ПДВ' : 'без ПДВ'} (${d.how})`
  const fmtPay = (p) => `платіж ${dmy(p.date)} на ${r2(p.amount)} «${(p.text || '').slice(0, 90)}» — ${p.vat === true ? 'з ПДВ' : p.vat === false ? 'без ПДВ' : 'ПДВ у тексті не вказано'} (${p.how})`
  Object.entries(vatMap).forEach(([k, v]) => {
    if (k.startsWith('__')) return
    const [orderId, ctr] = k.split('|')
    if (ctr === '*') {
      vatInfoByOrder[orderId] = [...v.docs.map(fmtDoc), ...v.pays.map(fmtPay)]
      // «усі постачальники» — лише якщо прихідні від одного контрагента (інакше змішуються різні постачальники)
      const ctrs = new Set(v.docs.map(d => d.contractorId))
      if (!v.mismatch || ctrs.size !== 1 || vatMap[`${orderId}|${[...ctrs][0]}`]?.mismatch) return
    } else if (!v.mismatch) return
    const pays = v.pays.filter(p => p.vat !== undefined && p.vat !== v.docVat)
    ;(vatWarn[orderId] ||= []).push(`⚠ розбіжність ПДВ: ${v.docs.map(fmtDoc).join('; ')} ↔ ${pays.map(fmtPay).join('; ')}. Собівартість — за прихідною.`)
  })

  const missing = missingRows.map(r => {
    const p = prodById[r.product_id] || {}
    const d = docById[r.document_id]
    const o = orderById[r.order_id]
    const outDate = r.out_date
    const cands = []
    // а) прихід є, але пізніше відвантаження
    ;(insByProd[r.product_id] || []).filter(m => m.date > outDate).forEach(m => {
      const idoc = inDocById[m.document_id]
      cands.push({ kind: 'later', inId: m.id, inDate: m.date, outDate, docId: m.document_id, linkedOrder: idoc ? idoc.order_id : m.order_id,
        text: `прихід ${m.quantity} ${p.unit || 'од.'} від ${dmy(m.date)}${idoc ? ` (${idoc.contractors?.name || 'постачальник ?'} № ${idoc.doc_number || '—'} від ${dmy(debtDate(idoc))})` : ''} — пізніше відвантаження ${dmy(outDate)}, FIFO на дату його не бере` })
    })
    // г) одиниці виміру: у довіднику / позиції замовлення / прихідних різні, або к-сть відрізняється в ~1000 разів
    const pu = normUnit(p.unit)
    const units = new Set()
    oItems.filter(i => i.order_id === r.order_id && (i.product_id === r.product_id || nameScore(i.name, p.name) >= 0.6) && i.unit && normUnit(i.unit) !== pu).forEach(i => units.add(`у замовленні «${i.unit}» (${i.qty})`))
    const qOut = Number(r.qty) || 0
    ;(insByProd[r.product_id] || []).forEach(m => { const k = (Number(m.quantity) || 0) / (qOut || 1); if (qOut && (k >= 500 || k <= 0.002)) units.add(`прихід ${m.quantity} від ${dmy(m.date)} — к-сть у ~${k >= 1 ? Math.round(k) : '1/' + Math.round(1 / k)} разів інша`) })
    if (qOut && Math.abs(qOut - Math.round(qOut)) > 0.0001 && /шт|од/.test(pu)) units.add(`дробова к-сть ${qOut} при одиниці «${p.unit || 'шт'}»`)
    if (units.size) cands.push({ kind: 'units', text: `перевірте одиниці (у довіднику «${p.unit || '—'}»): ${[...units].join('; ')}` })
    // б) непроведені прихідні з цим товаром у позиціях
    unposted.forEach(u => {
      const hit = u.items.map(i => ({ i, s: Math.max(nameScore(p.name, i.name), p.sku && (i.sku || i.code) && norm(p.sku) === norm(i.sku || i.code) ? 1 : 0) })).sort((a, b) => b.s - a.s)[0]
      if (hit && hit.s >= 0.6) cands.push({ kind: 'unposted', score: hit.s, linkedOrder: u.order_id, text: `не проведена на склад: ${u.contractors?.name || 'постачальник ?'} № ${u.doc_number || '—'} від ${(debtDate(u) || '').split('-').reverse().join('.')}, позиція «${hit.i.name}» ${hit.i.quantity ?? hit.i.qty ?? ''} ${hit.i.unit || ''} × ${hit.i.unitPrice ?? hit.i.price ?? ''}`, docId: u.id, date: debtDate(u) })
    })
    // в) непроведені прихідні від постачальника цієї позиції замовлення, ±60 днів
    const supIds = new Set(oItems.filter(i => i.order_id === r.order_id && (i.product_id === r.product_id || nameScore(i.name, p.name) >= 0.6) && i.supplier_id).map(i => i.supplier_id))
    unposted.filter(u => supIds.has(u.contractor_id) && !cands.some(c => c.docId === u.id) && Math.abs(daysBetween(debtDate(u), outDate)) <= 60)
      .forEach(u => cands.push({ kind: 'supplier', linkedOrder: u.order_id, text: `від постачальника позиції, не проведена: № ${u.doc_number || '—'} від ${(debtDate(u) || '').split('-').reverse().join('.')} на ${r2(u.amount)} грн (товар у позиціях не знайдено — перевірте)`, docId: u.id }))
    // д) можливий дубль картки товару з приходами
    dupsOf(p).forEach(x => cands.push({ kind: 'dup', dupId: x.id, dupName: x.name, keepId: r.product_id, keepName: p.name,
      text: `можливий дубль картки: «${x.name}»${x.sku ? ` (${x.sku})` : ''} — приходів ${x.inQty} ${x.unit || ''}; об'єднання перенесе їх сюди` }))
    // е) розбіжність ПДВ між прихідною і платежем по цьому замовленню
    ;(vatWarn[r.order_id] || []).forEach(t => cands.push({ kind: 'vat', text: t }))
    const rank = { vat: 0, unposted: 1, later: 2, dup: 3, units: 4, supplier: 5 }
    cands.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.score || 0) - (a.score || 0))
    return {
      order: o?.order_number || '— без замовлення', orderId: o?.id || null, client: o?.contractors?.name || '',
      doc: d ? `${d.doc_number || '—'} від ${(debtDate(d) || '').split('-').reverse().join('.')}` : '—',
      date: outDate, product: p.name || r.product_id, sku: p.sku || '', unit: p.unit || '', qty: Number(r.qty) || 0, missingQty: r2(r.missing_qty),
      estQty: r2(r.est_qty), estUnit: Number(r.est_unit) || 0, source: r.source,
      candidates: cands.slice(0, 8),
    }
  }).sort((a, b) => a.order.localeCompare(b.order) || a.date.localeCompare(b.date))

  orderRows.forEach(x => { if (x.orderId) { x.vatWarn = vatWarn[x.orderId] || []; x.vatInfo = vatInfoByOrder[x.orderId] || [] } })
  // збірки не входять у підсумок: їхня собівартість уже є в проданому виробі
  const counted = orderRows.filter(x => !x.neutral)
  const totals = { current: r2(counted.reduce((t, x) => t + x.current, 0)), fifo: r2(counted.reduce((t, x) => t + x.fifo, 0)),
    estValue: r2(counted.reduce((t, x) => t + x.estValue, 0)) }
  const unpostedDocs = unposted.map(u => ({ id: u.id, type: u.type, number: u.doc_number || '—', date: debtDate(u), contractor: u.contractors?.name || '—', amount: r2(u.amount), items: u.items }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  return { orderRows, missing, totals, unpostedCount: unposted.length, unpostedDocs, writeoffs, vatWarnCount: Object.values(vatWarn).flat().length }
}

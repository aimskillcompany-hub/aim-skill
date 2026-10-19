// Діагностика собівартості перед перебудовою FIFO (нічого не змінює):
//   1) по замовленнях: собівартість, яку ЗАРАЗ показує звіт (P&L/Маржа, з усіма фолбеками) → за FIFO-партіями
//      (сухий прогін fifo_rebuild) + як отримано ціну партій (база ПДВ);
//   2) позиції, яким не вистачило партій, і можливі джерела: прихід є, але датований пізніше відвантаження;
//      прихідні документи, НЕ проведені на склад, що містять цей товар (за назвою/артикулом) або від
//      постачальника цієї позиції замовлення в розумні дати.
import { supabase } from './supabase'
import { qc, getUserCompanyId } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { accrualSalesDocs } from './accrual'
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

export async function runCostDiagnostics(from, to) {
  const company = getUserCompanyId()
  // 1. «зараз» — як у звіті
  const sales = await accrualSalesDocs(from, to)
  // 2. FIFO — сухий прогін (рахує й відкочує)
  // одним значенням (jsonb) — API обрізає набори рядків до 1000
  const { data: fifoAll, error } = await supabase.rpc('fifo_dry_run_json', { p_cost_from: from })
  if (error) throw new Error(/fifo_dry_run_json|fifo_rebuild/.test(error.message || '') ? 'Спершу застосуйте міграцію 072 (ціна партії з ПДВ / без ПДВ).' : error.message)
  const fifo = (fifoAll || []).filter(r => (!company || r.company_id === company) && r.out_date <= to)

  const docIds = [...new Set(fifo.map(r => r.document_id).filter(Boolean))]
  const docs = docIds.length ? await fetchAllIn(() => qc('documents').select('id, type, doc_number, doc_date, created_at, order_id, contractor_id'), 'id', docIds) : []
  const docById = {}; docs.forEach(d => { docById[d.id] = d })
  sales.forEach(s => { docById[s.doc.id] = docById[s.doc.id] || s.doc })
  const orderIds = [...new Set([...fifo.map(r => r.order_id), ...sales.map(s => s.doc.order_id)].filter(Boolean))]
  const orders = orderIds.length ? await fetchAllIn(() => qc('orders').select('id, order_number, client_id, contractors(name)'), 'id', orderIds) : []
  const orderById = {}; orders.forEach(o => { orderById[o.id] = o })
  const prodIds = [...new Set(fifo.map(r => r.product_id).filter(Boolean))]
  const prods = prodIds.length ? await fetchAllIn(() => supabase.from('products').select('id, name, sku'), 'id', prodIds) : []
  const prodById = {}; prods.forEach(p => { prodById[p.id] = p })

  // ── по замовленнях ──
  const key = (orderId, docId) => orderId || (docId ? '__no_order' : '__no_doc')
  const byOrder = {}
  const ensure = (k) => (byOrder[k] ||= { key: k, current: 0, fifo: 0, shipments: 0, missingQty: 0, bases: new Set(), currentMissing: false })
  sales.forEach(s => {
    const g = ensure(key(s.doc.order_id, s.doc.id))
    g.current += s.cost
    if (s.missing.length) g.currentMissing = true
  })
  fifo.forEach(r => {
    const g = ensure(key(r.order_id, r.document_id))
    g.fifo += (Number(r.qty) || 0) * (Number(r.new_unit) || 0)
    g.shipments += 1
    g.missingQty += Number(r.missing_qty) || 0
    String(r.bases || '').split('; ').filter(Boolean).forEach(b => g.bases.add(b))
  })
  const orderRows = Object.values(byOrder).map(g => {
    const o = orderById[g.key]
    return {
      order: o ? o.order_number : g.key === '__no_order' ? '— без замовлення' : '— без документа (списання/збірки)',
      orderId: o?.id || null, client: o?.contractors?.name || '',
      shipments: g.shipments, current: r2(g.current), fifo: r2(g.fifo), diff: r2(g.fifo - g.current),
      missingQty: r2(g.missingQty), currentMissing: g.currentMissing, bases: [...g.bases].join('; '),
    }
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

  // ── позиції без партій + можливі джерела ──
  const missingRows = fifo.filter(r => (Number(r.missing_qty) || 0) > 0.00001)
  const missProdIds = [...new Set(missingRows.map(r => r.product_id))]
  // приходи цих товарів (для «є, але пізніше»)
  const ins = missProdIds.length ? await fetchAllIn(() => qc('stock_movements').select('id, product_id, quantity, date, document_id').eq('type', 'in'), 'product_id', missProdIds) : []
  const insByProd = {}; ins.forEach(m => { (insByProd[m.product_id] ||= []).push(m) })
  // прихідні документи, не проведені на склад
  const payDocs = (await fetchAll(() => qc('documents').select('id, type, direction, doc_number, doc_date, created_at, amount, contractor_id, generated_doc_id, contractors(name)').eq('direction', 'payable')))
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
  const oItems = missOrderIds.length ? await fetchAllIn(() => supabase.from('order_items').select('id, order_id, product_id, name, supplier_id, qty, cost_price'), 'order_id', missOrderIds) : []

  const missing = missingRows.map(r => {
    const p = prodById[r.product_id] || {}
    const d = docById[r.document_id]
    const o = orderById[r.order_id]
    const outDate = r.out_date
    const cands = []
    // а) прихід є, але пізніше відвантаження
    ;(insByProd[r.product_id] || []).filter(m => m.date > outDate).forEach(m => cands.push({ kind: 'later', text: `прихід ${m.quantity} од. від ${m.date.split('-').reverse().join('.')} — пізніше відвантаження (FIFO на дату його не бере)`, docId: m.document_id }))
    // б) непроведені прихідні з цим товаром у позиціях
    unposted.forEach(u => {
      const hit = u.items.map(i => ({ i, s: Math.max(nameScore(p.name, i.name), p.sku && (i.sku || i.code) && norm(p.sku) === norm(i.sku || i.code) ? 1 : 0) })).sort((a, b) => b.s - a.s)[0]
      if (hit && hit.s >= 0.6) cands.push({ kind: 'unposted', score: hit.s, text: `не проведена на склад: ${u.contractors?.name || 'постачальник ?'} № ${u.doc_number || '—'} від ${(debtDate(u) || '').split('-').reverse().join('.')}, позиція «${hit.i.name}» ${hit.i.quantity ?? hit.i.qty ?? ''} × ${hit.i.unitPrice ?? hit.i.price ?? ''}`, docId: u.id, date: debtDate(u) })
    })
    // в) непроведені прихідні від постачальника цієї позиції замовлення, ±60 днів
    const supIds = new Set(oItems.filter(i => i.order_id === r.order_id && (i.product_id === r.product_id || nameScore(i.name, p.name) >= 0.6) && i.supplier_id).map(i => i.supplier_id))
    unposted.filter(u => supIds.has(u.contractor_id) && !cands.some(c => c.docId === u.id) && Math.abs(daysBetween(debtDate(u), outDate)) <= 60)
      .forEach(u => cands.push({ kind: 'supplier', text: `від постачальника позиції, не проведена: № ${u.doc_number || '—'} від ${(debtDate(u) || '').split('-').reverse().join('.')} на ${r2(u.amount)} грн (товар у позиціях не знайдено — перевірте)`, docId: u.id }))
    cands.sort((a, b) => ({ unposted: 0, later: 1, supplier: 2 }[a.kind] - { unposted: 0, later: 1, supplier: 2 }[b.kind]) || (b.score || 0) - (a.score || 0))
    return {
      order: o?.order_number || '— без замовлення', orderId: o?.id || null, client: o?.contractors?.name || '',
      doc: d ? `${d.doc_number || '—'} від ${(debtDate(d) || '').split('-').reverse().join('.')}` : '—',
      date: outDate, product: p.name || r.product_id, sku: p.sku || '', qty: Number(r.qty) || 0, missingQty: r2(r.missing_qty),
      candidates: cands.slice(0, 6),
    }
  }).sort((a, b) => a.order.localeCompare(b.order) || a.date.localeCompare(b.date))

  const totals = { current: r2(orderRows.reduce((t, x) => t + x.current, 0)), fifo: r2(orderRows.reduce((t, x) => t + x.fifo, 0)) }
  return { orderRows, missing, totals, unpostedCount: unposted.length }
}

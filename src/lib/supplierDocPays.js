// Оплати постачальникам → замовлення через прихідну накладну (рішення власника 26.10.2026).
// Ланцюжок: оплата у виписці прив'язана до прихідної (transaction_documents) → товари прихідної (рухи «in») →
// партії, з яких FIFO списав видатки замовлення (stock_allocations) → замовлення.
// Частка замовлення в прихідній = вартість товару цієї прихідної, що пішов у замовлення ÷ вартість усієї прихідної
// (за цінами рухів, тож ПДВ скорочується). Оплата × частка = пропозиція «прив'язати до замовлення як витрату».
// Прихідна, прив'язана до замовлення напряму (documents.order_id) і без списань, — уся на це замовлення.
// Лише пропозиції: запис — linkSupplierDocPay після підтвердження.
import { supabase } from './supabase'
import { fetchAllIn } from './fetchAll'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const IN_TYPES = ['incomingWaybill', 'waybill_in', 'incoming_waybill']

// Чиста частина. allocs: [{ orderId, docId, value }] (вартість товару прихідної, що пішов у замовлення);
// docTotals: { docId: вартість усієї прихідної }; pays: [{ docId, txId, amount }];
// linked: Set('orderId|txId') — уже прив'язані; free: { txId: вільна сума транзакції }
export function proposePays({ allocs, docTotals, pays, linked = new Set(), free = {} }) {
  const share = {}
  allocs.forEach(a => {
    const tot = docTotals[a.docId]
    if (!(tot > 0)) return
    const k = a.docId + '|' + a.orderId
    share[k] = Math.min(1, (share[k] || 0) + a.value / tot)
  })
  const left = { ...free }
  const out = []
  pays.forEach(p => {
    Object.entries(share).filter(([k]) => k.startsWith(p.docId + '|')).forEach(([k, sh]) => {
      const orderId = k.split('|')[1]
      if (linked.has(orderId + '|' + p.txId)) return
      let amt = r2(p.amount * sh)
      if (left[p.txId] != null) amt = r2(Math.min(amt, left[p.txId]))
      if (!(amt > 0.5)) return
      if (left[p.txId] != null) left[p.txId] = r2(left[p.txId] - amt)
      out.push({ orderId, docId: p.docId, txId: p.txId, amount: amt, share: sh })
    })
  })
  return out
}

// orderIds — замовлення, для яких шукати (картка замовлення — одне; календар — усі «в прогнозі»)
export async function findSupplierDocPays(orderIds) {
  if (!orderIds?.length) return []
  const [docs, sos] = await Promise.all([
    fetchAllIn(() => supabase.from('documents').select('id, order_id, type, direction'), 'order_id', orderIds),
    fetchAllIn(() => supabase.from('supplier_orders').select('id, order_id'), 'order_id', orderIds).catch(() => []),
  ])
  const docOrder = {}; docs.forEach(d => { docOrder[d.id] = d.order_id })
  const soOrder = {}; sos.forEach(s => { soOrder[s.id] = s.order_id })
  const cols = 'id, type, document_id, order_id, supplier_order_id, assembly_id, quantity, price'
  const mv = {}
  const add = (list) => (list || []).forEach(m => { mv[m.id] = m })
  add(await fetchAllIn(() => supabase.from('stock_movements').select(cols), 'order_id', orderIds))
  if (docs.length) add(await fetchAllIn(() => supabase.from('stock_movements').select(cols), 'document_id', docs.map(d => d.id)))
  if (sos.length) add(await fetchAllIn(() => supabase.from('stock_movements').select(cols), 'supplier_order_id', sos.map(s => s.id)))
  const orderOf = (m) => m.order_id || docOrder[m.document_id] || soOrder[m.supplier_order_id] || null

  // списання видатків замовлень із партій
  const outs = Object.values(mv).filter(m => m.type !== 'in' && orderOf(m))
  const outOrder = {}; outs.forEach(m => { outOrder[m.id] = orderOf(m) })
  const al = outs.length ? await fetchAllIn(() => supabase.from('stock_allocations').select('out_movement_id, in_movement_id, qty'), 'out_movement_id', outs.map(m => m.id)) : []
  // від партії до прихідної; партія без документа зі збірки (assembly_id) — далі через компоненти збірки
  // (частка = скільки виробу пішло в замовлення ÷ скільки зібрано), до 3 рівнів вкладеності
  const allocs = []
  let level = al.map(a => ({ inId: a.in_movement_id, qty: Number(a.qty) || 0, orderId: outOrder[a.out_movement_id], factor: 1 }))
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const ids = [...new Set(level.map(x => x.inId))]
    const ins = await fetchAllIn(() => supabase.from('stock_movements').select(cols), 'id', ids)
    const inById = {}; ins.forEach(m => { inById[m.id] = m })
    const next = []
    const asm = {}   // assembly_id → [{ orderId, share }]
    level.forEach(x => {
      const im = inById[x.inId]; if (!im) return
      if (im.document_id) { allocs.push({ orderId: x.orderId, docId: im.document_id, value: x.factor * x.qty * (Number(im.price) || 0) }); return }
      if (im.assembly_id && depth < 3 && Number(im.quantity) > 0) (asm[im.assembly_id] ||= []).push({ orderId: x.orderId, share: x.factor * x.qty / Number(im.quantity) })
    })
    const asmIds = Object.keys(asm)
    if (asmIds.length) {
      const comps = await fetchAllIn(() => supabase.from('stock_movements').select('id, assembly_id').eq('type', 'out'), 'assembly_id', asmIds)
      const compAsm = {}; comps.forEach(c => { compAsm[c.id] = c.assembly_id })
      const ca = comps.length ? await fetchAllIn(() => supabase.from('stock_allocations').select('out_movement_id, in_movement_id, qty'), 'out_movement_id', comps.map(c => c.id)) : []
      ca.forEach(a => (asm[compAsm[a.out_movement_id]] || []).forEach(t => next.push({ inId: a.in_movement_id, qty: Number(a.qty) || 0, orderId: t.orderId, factor: t.share })))
    }
    level = next
  }
  // прихідні, прив'язані до замовлення напряму, без списань — уся вартість на замовлення
  const allocDocs = new Set(allocs.map(a => a.docId))
  docs.filter(d => (IN_TYPES.includes(d.type) || d.direction === 'payable') && !allocDocs.has(d.id)).forEach(d => allocs.push({ orderId: d.order_id, docId: d.id, value: null, whole: true }))

  const inDocIds = [...new Set(allocs.map(a => a.docId))]
  if (!inDocIds.length) return []
  const [docIns, docRows] = await Promise.all([
    fetchAllIn(() => supabase.from('stock_movements').select('document_id, quantity, price').eq('type', 'in'), 'document_id', inDocIds),
    fetchAllIn(() => supabase.from('documents').select('id, doc_number, doc_date, type, contractor_id, amount, contractors(name)'), 'id', inDocIds),
  ])
  const docTotals = {}; docIns.forEach(m => { docTotals[m.document_id] = (docTotals[m.document_id] || 0) + (Number(m.quantity) || 0) * (Number(m.price) || 0) })
  allocs.forEach(a => { if (a.whole) { a.value = docTotals[a.docId] || 1; if (!docTotals[a.docId]) docTotals[a.docId] = 1 } })
  const docById = {}; docRows.forEach(d => { docById[d.id] = d })

  // оплати прихідних
  const tds = await fetchAllIn(() => supabase.from('transaction_documents').select('document_id, transaction_id, amount'), 'document_id', inDocIds)
  const txIds = [...new Set(tds.map(t => t.transaction_id).filter(Boolean))]
  if (!txIds.length) return []
  const [txs, ots, paidOrders] = await Promise.all([
    fetchAllIn(() => supabase.from('bank_transactions').select('id, date, amount, counterparty, contractor_id, is_ignored'), 'id', txIds),
    fetchAllIn(() => supabase.from('order_transactions').select('order_id, transaction_id, amount'), 'transaction_id', txIds),
    fetchAllIn(() => supabase.from('orders').select('id, paid_transaction_id'), 'paid_transaction_id', txIds),
  ])
  const txById = {}; txs.forEach(t => { txById[t.id] = t })
  const linked = new Set(ots.map(o => o.order_id + '|' + o.transaction_id))
  const used = {}; ots.forEach(o => { used[o.transaction_id] = (used[o.transaction_id] || 0) + Math.abs(Number(o.amount) || 0) })
  const direct = new Set(paidOrders.map(o => o.paid_transaction_id))
  const free = {}
  txs.forEach(t => { free[t.id] = t.is_ignored || direct.has(t.id) || Number(t.amount) >= 0 ? 0 : r2(Math.abs(Number(t.amount) || 0) - (used[t.id] || 0)) })
  const pays = tds.filter(t => txById[t.transaction_id]).map(t => ({ docId: t.document_id, txId: t.transaction_id, amount: Math.abs(Number(t.amount) || 0) }))
  return proposePays({ allocs, docTotals, pays, linked, free }).map(p => ({ ...p, tx: txById[p.txId], doc: docById[p.docId] || null }))
}

export async function linkSupplierDocPay(p, userId) {
  const { error } = await supabase.from('order_transactions').insert({
    order_id: p.orderId, transaction_id: p.txId, kind: 'expense', amount: r2(p.amount),
    note: `Через прихідну ${p.doc?.doc_number || ''}`.trim() + (p.share < 0.999 ? ` (частка ${Math.round(p.share * 100)}%)` : ''),
    created_by: userId || null,
  })
  if (error) throw error
}

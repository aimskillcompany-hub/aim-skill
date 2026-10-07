// Звіт для бухгалтера по видатковій накладній: для кожного проданого товару простежуємо
// (FIFO), з якої ПРИХІДНОЇ накладної він прийшов (де й коли куплено). + архів усіх документів.
import { qc } from './companyScope'
import { supabase } from './supabase'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Список наших видаткових (для вибору)
export async function listOutgoingWaybills() {
  const { data } = await qc('documents')
    .select('id, doc_number, doc_date, amount, contractor_id, created_at')
    .eq('type', 'waybill').order('doc_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
  const ids = [...new Set((data || []).map(d => d.contractor_id).filter(Boolean))]
  const cn = {}
  for (let i = 0; i < ids.length; i += 100) {
    const { data: cs } = await supabase.from('contractors').select('id, name').in('id', ids.slice(i, i + 100))
    ;(cs || []).forEach(c => cn[c.id] = c.name)
  }
  return (data || []).map(d => ({ ...d, contractorName: cn[d.contractor_id] || 'Без контрагента' }))
}

// FIFO-трасування однієї видаткової → джерела закупівлі по кожному товару
export async function traceOutgoing(docId) {
  const { data: doc } = await qc('documents')
    .select('id, doc_number, doc_date, amount, vat_amount, contractor_id, storage_path, file_name')
    .eq('id', docId).maybeSingle()
  if (!doc) throw new Error('Видаткову не знайдено')
  const { data: contr } = doc.contractor_id ? await supabase.from('contractors').select('name, edrpou').eq('id', doc.contractor_id).maybeSingle() : { data: null }
  doc.contractorName = contr?.name || 'Без контрагента'
  doc.contractorEdrpou = contr?.edrpou || ''

  // OUT-рухи цієї видаткової
  const { data: ourOut } = await qc('stock_movements')
    .select('id, product_id, quantity, price, cost_price, total').eq('document_id', docId).eq('type', 'out')
  const ourOutIds = new Set((ourOut || []).map(m => m.id))
  const productIds = [...new Set((ourOut || []).map(m => m.product_id).filter(Boolean))]

  // імена товарів
  const pName = {}
  for (let i = 0; i < productIds.length; i += 100) {
    const { data } = await supabase.from('products').select('id, name, unit').in('id', productIds.slice(i, i + 100))
    ;(data || []).forEach(p => pName[p.id] = p)
  }

  const inDocIds = new Set()
  const items = []
  for (const pid of productIds) {
    const [{ data: ins }, { data: outs }] = await Promise.all([
      qc('stock_movements').select('id, document_id, quantity, price, date, source, created_at').eq('product_id', pid).eq('type', 'in').order('date').order('created_at'),
      qc('stock_movements').select('id, document_id, quantity, date, created_at').eq('product_id', pid).eq('type', 'out').order('date').order('created_at'),
    ])
    const inState = (ins || []).map(m => ({ ...m, remaining: Number(m.quantity) || 0 }))
    const alloc = {} // outId → [{ in, qty }]
    let ptr = 0
    for (const out of (outs || [])) {
      let need = Number(out.quantity) || 0
      const list = []
      while (need > 0.0001 && ptr < inState.length) {
        const inM = inState[ptr]
        if (inM.remaining <= 0.0001) { ptr++; continue }
        const take = Math.min(inM.remaining, need)
        list.push({ in: inM, qty: take })
        inM.remaining = r2(inM.remaining - take)
        need = r2(need - take)
        if (inM.remaining <= 0.0001) ptr++
      }
      if (ourOutIds.has(out.id)) alloc[out.id] = list
    }

    // зібрати джерела для наших OUT по цьому товару
    const soldQty = r2((ourOut || []).filter(m => m.product_id === pid).reduce((s, m) => s + (Number(m.quantity) || 0), 0))
    const bySource = {}
    Object.values(alloc).flat().forEach(({ in: inM, qty }) => {
      const key = inM.document_id || (inM.source === 'assembly' ? 'assembly' : 'nodoc')
      const s = (bySource[key] ||= { docId: inM.document_id || null, source: inM.source, qty: 0, cost: 0, date: inM.date })
      s.qty = r2(s.qty + qty)
      s.cost = r2(s.cost + qty * (Number(inM.price) || 0))
      if (inM.document_id) inDocIds.add(inM.document_id)
    })
    items.push({
      productId: pid, name: pName[pid]?.name || '—', unit: pName[pid]?.unit || 'шт',
      soldQty, sources: Object.values(bySource).sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    })
  }

  // прихідні документи-джерела
  const inDocs = {}
  const idArr = [...inDocIds]
  for (let i = 0; i < idArr.length; i += 100) {
    const { data } = await qc('documents').select('id, doc_number, doc_date, contractor_id, storage_path, file_name').in('id', idArr.slice(i, i + 100))
    ;(data || []).forEach(x => inDocs[x.id] = x)
  }
  const inCids = [...new Set(Object.values(inDocs).map(x => x.contractor_id).filter(Boolean))]
  const inCn = {}
  for (let i = 0; i < inCids.length; i += 100) {
    const { data } = await supabase.from('contractors').select('id, name').in('id', inCids.slice(i, i + 100))
    ;(data || []).forEach(c => inCn[c.id] = c.name)
  }
  Object.values(inDocs).forEach(x => x.supplierName = inCn[x.contractor_id] || 'Без постачальника')

  // підставити інфо документа в sources
  items.forEach(it => it.sources.forEach(s => {
    if (s.docId && inDocs[s.docId]) {
      const dd = inDocs[s.docId]
      s.docNumber = dd.doc_number; s.docDate = dd.doc_date; s.supplierName = dd.supplierName
      s.storage_path = dd.storage_path; s.file_name = dd.file_name
    } else {
      s.docNumber = s.source === 'assembly' ? 'Збірка' : 'Без прихідного документа'
    }
  }))

  return { doc, items, purchaseDocs: Object.values(inDocs) }
}

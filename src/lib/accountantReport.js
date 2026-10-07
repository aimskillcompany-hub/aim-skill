// Звіт для бухгалтера по видатковій накладній: для кожного проданого товару простежуємо
// (FIFO), з якої ПРИХІДНОЇ накладної він прийшов. Якщо товар — ЗБІРКА, розкриваємо її
// компоненти й простежуємо кожен компонент до його прихідної. + архів усіх документів.
import { qc } from './companyScope'
import { supabase } from './supabase'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const EPS = 0.0001

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

// FIFO-розподіл OUT-рухів товару по IN-рухах → алокації [{ in, qty }] лише для ourOutIds
async function allocate(productId, ourOutIds) {
  const [{ data: ins }, { data: outs }] = await Promise.all([
    qc('stock_movements').select('id, document_id, quantity, price, date, source, assembly_id, created_at').eq('product_id', productId).eq('type', 'in').order('date').order('created_at'),
    qc('stock_movements').select('id, quantity, date, created_at').eq('product_id', productId).eq('type', 'out').order('date').order('created_at'),
  ])
  const inState = (ins || []).map(m => ({ ...m, remaining: Number(m.quantity) || 0 }))
  const out = []
  let ptr = 0
  for (const o of (outs || [])) {
    let need = Number(o.quantity) || 0
    const take = []
    while (need > EPS && ptr < inState.length) {
      const inM = inState[ptr]
      if (inM.remaining <= EPS) { ptr++; continue }
      const t = Math.min(inM.remaining, need)
      take.push({ in: inM, qty: t })
      inM.remaining = r2(inM.remaining - t); need = r2(need - t)
      if (inM.remaining <= EPS) ptr++
    }
    if (ourOutIds.has(o.id)) out.push(...take)
  }
  return out
}

// Групування алокацій у джерела (doc / assembly / nodoc). depth — захист від нескінченної рекурсії.
async function buildSources(allocs, inDocIds, depth) {
  const byKey = {}
  for (const { in: inM, qty } of allocs) {
    const key = inM.document_id || (inM.source === 'assembly' ? 'asm:' + (inM.assembly_id || '?') : 'nodoc')
    const s = (byKey[key] ||= { key, docId: inM.document_id || null, source: inM.source, assemblyId: inM.assembly_id || null, qty: 0, cost: 0, date: inM.date })
    s.qty = r2(s.qty + qty); s.cost = r2(s.cost + qty * (Number(inM.price) || 0))
    if (inM.document_id) inDocIds.add(inM.document_id)
  }
  const sources = []
  for (const s of Object.values(byKey)) {
    if (s.docId) { s.type = 'doc'; sources.push(s); continue }
    if (s.source === 'assembly' && s.assemblyId && depth > 0) {
      // Розкриваємо збірку: компоненти → їх прихідні
      s.type = 'assembly'
      s.components = await expandAssembly(s.assemblyId, s.qty, inDocIds, depth - 1)
      const { data: asm } = await qc('assemblies').select('name').eq('id', s.assemblyId).maybeSingle()
      s.assemblyName = asm?.name || 'Збірка'
      sources.push(s); continue
    }
    s.type = s.source === 'assembly' ? 'assembly-leaf' : 'nodoc'
    sources.push(s)
  }
  return sources.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

// Компоненти збірки + їх джерела (прихідні). qtyTaken — скільки виробу взято (для масштабування).
async function expandAssembly(assemblyId, qtyTaken, inDocIds, depth) {
  const { data: asm } = await qc('assemblies').select('quantity').eq('id', assemblyId).maybeSingle()
  const batchQty = Number(asm?.quantity) || 1
  const factor = batchQty ? Math.min(1, (qtyTaken || batchQty) / batchQty) : 1
  // OUT-рухи компонентів цієї збірки
  const { data: compOuts } = await qc('stock_movements')
    .select('id, product_id, quantity').eq('assembly_id', assemblyId).eq('type', 'out')
  const byProduct = {}
  ;(compOuts || []).forEach(m => { (byProduct[m.product_id] ||= new Set()).add(m.id) })
  const pids = Object.keys(byProduct)
  const pInfo = {}
  for (let i = 0; i < pids.length; i += 100) {
    const { data } = await supabase.from('products').select('id, name, unit').in('id', pids.slice(i, i + 100))
    ;(data || []).forEach(p => pInfo[p.id] = p)
  }
  const components = []
  for (const pid of pids) {
    const allocs = await allocate(pid, byProduct[pid])
    // масштабуємо під qtyTaken
    const scaled = allocs.map(a => ({ in: a.in, qty: r2(a.qty * factor) }))
    const totalQty = r2(scaled.reduce((s, a) => s + a.qty, 0))
    components.push({
      productId: pid, name: pInfo[pid]?.name || '—', unit: pInfo[pid]?.unit || 'шт',
      qty: totalQty, sources: await buildSources(scaled, inDocIds, depth),
    })
  }
  return components
}

export async function traceOutgoing(docId) {
  const { data: doc } = await qc('documents')
    .select('id, doc_number, doc_date, amount, vat_amount, contractor_id, storage_path, file_name')
    .eq('id', docId).maybeSingle()
  if (!doc) throw new Error('Видаткову не знайдено')
  const { data: contr } = doc.contractor_id ? await supabase.from('contractors').select('name, edrpou').eq('id', doc.contractor_id).maybeSingle() : { data: null }
  doc.contractorName = contr?.name || 'Без контрагента'
  doc.contractorEdrpou = contr?.edrpou || ''

  const { data: ourOut } = await qc('stock_movements')
    .select('id, product_id, quantity').eq('document_id', docId).eq('type', 'out')
  const productIds = [...new Set((ourOut || []).map(m => m.product_id).filter(Boolean))]
  const outIdsByProduct = {}
  ;(ourOut || []).forEach(m => { (outIdsByProduct[m.product_id] ||= new Set()).add(m.id) })

  const pName = {}
  for (let i = 0; i < productIds.length; i += 100) {
    const { data } = await supabase.from('products').select('id, name, unit').in('id', productIds.slice(i, i + 100))
    ;(data || []).forEach(p => pName[p.id] = p)
  }

  const inDocIds = new Set()
  const items = []
  for (const pid of productIds) {
    const allocs = await allocate(pid, outIdsByProduct[pid])
    const soldQty = r2((ourOut || []).filter(m => m.product_id === pid).reduce((s, m) => s + (Number(m.quantity) || 0), 0))
    items.push({
      productId: pid, name: pName[pid]?.name || '—', unit: pName[pid]?.unit || 'шт',
      soldQty, sources: await buildSources(allocs, inDocIds, 2), // до 2 рівнів вкладених збірок
    })
  }

  // прихідні документи-джерела (для шапки/архіву)
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

  // підставити інфо документа в усі (у т.ч. вкладені) doc-джерела
  const fillDoc = (s) => {
    if (s.type === 'doc' && s.docId && inDocs[s.docId]) {
      const dd = inDocs[s.docId]
      s.docNumber = dd.doc_number; s.docDate = dd.doc_date; s.supplierName = dd.supplierName
      s.storage_path = dd.storage_path; s.file_name = dd.file_name
    } else if (s.type === 'assembly') {
      s.docNumber = 'Збірка: ' + (s.assemblyName || '')
      ;(s.components || []).forEach(c => c.sources.forEach(fillDoc))
    } else if (s.type === 'assembly-leaf') {
      s.docNumber = 'Збірка (вкладена)'
    } else {
      s.docNumber = 'Без прихідного документа'
    }
  }
  items.forEach(it => it.sources.forEach(fillDoc))

  return { doc, items, purchaseDocs: Object.values(inDocs) }
}

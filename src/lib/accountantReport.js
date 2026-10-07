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
    qc('stock_movements').select('id, product_id, document_id, quantity, price, date, source, assembly_id, description, created_at').eq('product_id', productId).eq('type', 'in').order('date').order('created_at'),
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

// IN-рух є збіркою? (source або опис «Збірка…») — враховує старі дані без assembly_id
const isAssemblyIn = (inM) => inM.source === 'assembly' || /^\s*Збірк/i.test(inM.description || '')

// Знайти id запису збірки для IN-руху (assembly_id або за готовим товаром, найближча за датою)
async function resolveAssemblyId(inM) {
  if (inM.assembly_id) return inM.assembly_id
  const { data } = await qc('assemblies').select('id, assembled_at').eq('result_product_id', inM.product_id).order('assembled_at')
  if (!data?.length) return null
  if (!inM.date) return data[0].id
  let best = data[0], bestDiff = Infinity
  for (const a of data) { const diff = Math.abs(new Date(a.assembled_at || 0) - new Date(inM.date)); if (diff < bestDiff) { bestDiff = diff; best = a } }
  return best.id
}

// Best-effort: розподілити qty товару по його IN-рухах з документом (найраніші першими)
async function allocateQty(productId, need) {
  const { data: ins } = await qc('stock_movements')
    .select('id, product_id, document_id, quantity, price, date, source, assembly_id, description, created_at')
    .eq('product_id', productId).eq('type', 'in').order('date').order('created_at')
  const out = []
  let left = Number(need) || 0
  for (const inM of (ins || [])) {
    if (left <= EPS) break
    const q = Number(inM.quantity) || 0
    if (q <= 0) continue
    const take = Math.min(q, left)
    out.push({ in: inM, qty: r2(take) }); left = r2(left - take)
  }
  return out
}

// Групування алокацій у джерела (doc / assembly / nodoc). depth — захист від нескінченної рекурсії.
async function buildSources(allocs, inDocIds, depth) {
  const byKey = {}
  for (const { in: inM, qty } of allocs) {
    const asm = isAssemblyIn(inM)
    const key = inM.document_id || (asm ? 'asm:' + (inM.assembly_id || inM.id) : 'nodoc')
    const s = (byKey[key] ||= { key, docId: inM.document_id || null, isAsm: asm, inM, qty: 0, cost: 0, date: inM.date })
    s.qty = r2(s.qty + qty); s.cost = r2(s.cost + qty * (Number(inM.price) || 0))
    if (inM.document_id) inDocIds.add(inM.document_id)
  }
  const sources = []
  for (const s of Object.values(byKey)) {
    if (s.docId) { s.type = 'doc'; sources.push(s); continue }
    if (s.isAsm && depth > 0) {
      const aid = await resolveAssemblyId(s.inM)
      if (aid) {
        s.type = 'assembly'
        const { data: asm } = await qc('assemblies').select('name').eq('id', aid).maybeSingle()
        s.assemblyName = asm?.name || (s.inM.description || 'Збірка').replace(/^\s*Збірка:\s*/i, '').split('(')[0].trim() || 'Збірка'
        s.components = await expandAssembly(aid, s.qty, inDocIds, depth - 1)
        sources.push(s); continue
      }
    }
    s.type = s.isAsm ? 'assembly-leaf' : 'nodoc'
    sources.push(s)
  }
  return sources.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

// Компоненти збірки (з assembly_items — завжди наявні) + їх джерела (прихідні).
async function expandAssembly(assemblyId, qtyTaken, inDocIds, depth) {
  const { data: asm } = await qc('assemblies').select('quantity').eq('id', assemblyId).maybeSingle()
  const batchQty = Number(asm?.quantity) || 1
  const factor = batchQty ? Math.min(1, (qtyTaken || batchQty) / batchQty) : 1
  const { data: compItems } = await supabase.from('assembly_items').select('product_id, quantity, cost_price').eq('assembly_id', assemblyId)
  // точні OUT-рухи компонентів (якщо є assembly_id)
  const { data: compOuts } = await qc('stock_movements').select('id, product_id, quantity').eq('assembly_id', assemblyId).eq('type', 'out')
  const outByProduct = {}
  ;(compOuts || []).forEach(m => { (outByProduct[m.product_id] ||= new Set()).add(m.id) })

  const pids = [...new Set((compItems || []).map(c => c.product_id))]
  const pInfo = {}
  for (let i = 0; i < pids.length; i += 100) {
    const { data } = await supabase.from('products').select('id, name, unit').in('id', pids.slice(i, i + 100))
    ;(data || []).forEach(p => pInfo[p.id] = p)
  }

  const components = []
  for (const item of (compItems || [])) {
    const pid = item.product_id
    const needScaled = r2((Number(item.quantity) || 0) * factor)
    let scaled
    if (outByProduct[pid]) {
      const allocs = await allocate(pid, outByProduct[pid])
      scaled = allocs.map(a => ({ in: a.in, qty: r2(a.qty * factor) }))
    } else {
      // старі збірки без assembly_id на рухах → best-effort по IN-рухах
      scaled = await allocateQty(pid, needScaled)
    }
    components.push({
      productId: pid, name: pInfo[pid]?.name || '—', unit: pInfo[pid]?.unit || 'шт',
      qty: needScaled || r2(scaled.reduce((s, a) => s + a.qty, 0)),
      sources: await buildSources(scaled, inDocIds, depth),
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
    .select('id, product_id, quantity, created_at').eq('document_id', docId).eq('type', 'out')
    .order('created_at').order('id') // порядок створення = порядок позицій у видатковій
  let productIds = [...new Set((ourOut || []).map(m => m.product_id).filter(Boolean))]

  // Якщо у документі є ocr_data.items — впорядковуємо товари точно як у видатковій
  const { data: docFull } = await qc('documents').select('ocr_data').eq('id', docId).maybeSingle()
  const ocrItems = Array.isArray(docFull?.ocr_data?.items) ? docFull.ocr_data.items : []
  if (ocrItems.length) {
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const { data: prods } = await supabase.from('products').select('id, name').in('id', productIds)
    const nameById = {}; (prods || []).forEach(p => nameById[p.id] = norm(p.name))
    const idxOf = (pid) => {
      const nm = nameById[pid] || ''
      const i = ocrItems.findIndex(it => { const n = norm(it.name); return n && (n === nm || n.includes(nm) || nm.includes(n)) })
      return i < 0 ? 9999 : i
    }
    productIds = [...productIds].sort((a, b) => idxOf(a) - idxOf(b))
  }
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

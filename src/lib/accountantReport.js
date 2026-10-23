// Звіт для бухгалтера по видатковій накладній: для кожного проданого товару простежуємо
// (FIFO), з якої ПРИХІДНОЇ накладної він прийшов. Якщо товар — ЗБІРКА, розкриваємо її
// компоненти й простежуємо кожен компонент до його прихідної. + архів усіх документів.
import { qc } from './companyScope'
import { supabase } from './supabase'
import { fetchAll } from './fetchAll'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const EPS = 0.0001

// Акт — двонапрямний тип: наш (вихідний) = doc_role outgoing або direction receivable
const isOutgoingAct = (d) => d.type === 'serviceAct' && (d.doc_role === 'outgoing' || (!d.doc_role && d.direction === 'receivable'))

// Список наших документів реалізації (видаткові + вихідні акти) для вибору
export async function listOutgoingDocs() {
  // усі документи (раніше .limit(3000) сервер обрізав до 1000) → сортуємо від найновіших
  const data = (await fetchAll(() => qc('documents')
    .select('id, type, doc_role, direction, doc_number, doc_date, amount, contractor_id, created_at')
    .in('type', ['waybill', 'serviceAct'])))
    .sort((a, b) => (b.doc_date || '').localeCompare(a.doc_date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
  const docs = (data || []).filter(d => d.type === 'waybill' || isOutgoingAct(d))
  const ids = [...new Set(docs.map(d => d.contractor_id).filter(Boolean))]
  const cn = {}
  for (let i = 0; i < ids.length; i += 100) {
    const { data: cs } = await supabase.from('contractors').select('id, name').in('id', ids.slice(i, i + 100))
    ;(cs || []).forEach(c => cn[c.id] = c.name)
  }
  return docs.map(d => ({ ...d, contractorName: cn[d.contractor_id] || 'Без контрагента' }))
}

// FIFO-розподіл OUT-рухів товару по IN-рухах → { allocs: [{ in, qty }], short } лише для ourOutIds.
// short — кількість наших OUT, на яку не вистачило прихідних (мінусовий залишок / не оприбутковано).
async function allocate(productId, ourOutIds) {
  // FIFO по ВСІХ рухах товару (без обрізання на 1000), у хронологічному порядку
  const byTime = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || '') || String(a.id).localeCompare(String(b.id))
  const [ins, outs] = await Promise.all([
    fetchAll(() => qc('stock_movements').select('id, product_id, document_id, quantity, price, date, source, assembly_id, description, created_at').eq('product_id', productId).eq('type', 'in')).then(r => r.sort(byTime)),
    fetchAll(() => qc('stock_movements').select('id, quantity, date, created_at').eq('product_id', productId).eq('type', 'out')).then(r => r.sort(byTime)),
  ])
  const inState = (ins || []).map(m => ({ ...m, remaining: Number(m.quantity) || 0 }))
  const out = []
  let ptr = 0, short = 0
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
    if (ourOutIds.has(o.id)) { out.push(...take); if (need > EPS) short = r2(short + need) }
  }
  return { allocs: out, short }
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
  const ins = (await fetchAll(() => qc('stock_movements')
    .select('id, product_id, document_id, quantity, price, date, source, assembly_id, description, created_at')
    .eq('product_id', productId).eq('type', 'in')))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''))
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
    let scaled, shortQty
    if (outByProduct[pid]) {
      const { allocs, short } = await allocate(pid, outByProduct[pid])
      scaled = allocs.map(a => ({ in: a.in, qty: r2(a.qty * factor) }))
      shortQty = r2(short * factor)
    } else {
      // старі збірки без assembly_id на рухах → best-effort по IN-рухах
      scaled = await allocateQty(pid, needScaled)
      shortQty = Math.max(0, r2(needScaled - scaled.reduce((s, a) => s + a.qty, 0)))
    }
    components.push({
      productId: pid, name: pInfo[pid]?.name || '—', unit: pInfo[pid]?.unit || 'шт',
      qty: needScaled || r2(scaled.reduce((s, a) => s + a.qty, 0)),
      shortQty,
      sources: await buildSources(scaled, inDocIds, depth),
    })
  }
  return components
}

export async function traceOutgoing(docId) {
  const { data: doc } = await qc('documents')
    .select('id, type, doc_number, doc_date, amount, vat_amount, contractor_id, order_id, storage_path, file_name')
    .eq('id', docId).maybeSingle()
  if (!doc) throw new Error('Документ не знайдено')
  doc.isAct = doc.type === 'serviceAct'
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
  const matchedIdx = new Set()
  if (ocrItems.length) {
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const { data: prods } = productIds.length ? await supabase.from('products').select('id, name').in('id', productIds) : { data: [] }
    const nameById = {}; (prods || []).forEach(p => nameById[p.id] = norm(p.name))
    const idxOf = (pid) => {
      const nm = nameById[pid] || ''
      const i = ocrItems.findIndex(it => { const n = norm(it.name); return n && nm && (n === nm || n.includes(nm) || nm.includes(n)) })
      if (i >= 0) matchedIdx.add(i)
      return i < 0 ? 9999 : i
    }
    const order = {}; productIds.forEach(pid => order[pid] = idxOf(pid))
    productIds = [...productIds].sort((a, b) => order[a] - order[b])
  }
  // Послуги акту: позиції без складського руху. Лише для актів — у видаткових назви товарів
  // часто не збігаються з OCR (аліаси), і це дало б хибні «позиції без руху».
  const services = !doc.isAct ? [] : ocrItems
    .map((it, i) => ({ it, i }))
    .filter(({ i }) => !matchedIdx.has(i))
    .map(({ it }) => ({ name: it.name || '—', qty: Number(it.quantity) || null, unit: it.unit || '', amount: Number(it.amount) || 0 }))
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
    const { allocs, short } = await allocate(pid, outIdsByProduct[pid])
    const soldQty = r2((ourOut || []).filter(m => m.product_id === pid).reduce((s, m) => s + (Number(m.quantity) || 0), 0))
    items.push({
      productId: pid, name: pName[pid]?.name || '—', unit: pName[pid]?.unit || 'шт',
      soldQty, shortQty: short, sources: await buildSources(allocs, inDocIds, 2), // до 2 рівнів вкладених збірок
    })
  }

  // нестача: товари (і компоненти збірок), на які не вистачило прихідних
  const shortages = []
  const collectShort = (name, unit, qty, via) => { if (qty > EPS) shortages.push({ name, unit, qty, via }) }
  const walkSrc = (s, parent) => {
    if (s.type !== 'assembly') return
    ;(s.components || []).forEach(c => {
      collectShort(c.name, c.unit, c.shortQty, parent)
      c.sources.forEach(cs => walkSrc(cs, c.name))
    })
  }
  items.forEach(it => {
    collectShort(it.name, it.unit, it.shortQty, null)
    it.sources.forEach(s => walkSrc(s, it.name))
  })

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

  // Для акту: вхідні документи витрат по тому ж замовленню (акти субпідрядників, прихідні) — джерело собівартості послуг
  let orderCostDocs = []
  if (doc.isAct && doc.order_id) {
    const { data: od } = await qc('documents')
      .select('id, type, doc_role, direction, doc_number, doc_date, amount, contractor_id, storage_path, file_name')
      .eq('order_id', doc.order_id).in('type', ['serviceAct', 'incomingWaybill', 'other']).neq('id', doc.id)
    orderCostDocs = (od || []).filter(x => x.type === 'incomingWaybill' || x.doc_role === 'incoming' || (!x.doc_role && x.direction === 'payable'))
      .filter(x => !inDocs[x.id])
    const cids = [...new Set(orderCostDocs.map(x => x.contractor_id).filter(Boolean))]
    const cm = {}
    if (cids.length) { const { data: cs } = await supabase.from('contractors').select('id, name').in('id', cids); (cs || []).forEach(c => cm[c.id] = c.name) }
    orderCostDocs.forEach(x => x.supplierName = cm[x.contractor_id] || 'Без постачальника')
    orderCostDocs.sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || ''))
  }

  return { doc, items, services, shortages, orderCostDocs, purchaseDocs: Object.values(inDocs) }
}

// ── Архів місяця для бухгалтера (ТЗ редизайну 5.4) ──
// Усі наші документи реалізації за місяць: кожен — у своїй папці разом зі звітом-переліком; прихідні й вхідні
// документи витрат (з traceOutgoing) — в одній спільній папці без дублів. Лише читання зі Storage.
const safeName = (s) => (s || '').replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'doc'
const COST_TYPE = { serviceAct: 'Вхідний акт', incomingWaybill: 'Прихідна', other: 'Документ' }

export async function buildMonthArchive(docs, { onProgress } = {}) {
  const files = {}, used = new Set(), byPath = {}
  const enc = new TextEncoder()
  const fetchFile = async (path) => {
    if (!path) return null
    if (byPath[path] !== undefined) return byPath[path]
    const { data } = await supabase.storage.from('documents').download(path)
    byPath[path] = data ? new Uint8Array(await data.arrayBuffer()) : null
    return byPath[path]
  }
  const put = (name, buf) => {
    let f = name, i = 1
    const dot = name.lastIndexOf('.')
    while (used.has(f)) { i++; f = `${name.slice(0, dot)} (${i})${name.slice(dot)}` }
    used.add(f); files[f] = buf
  }
  const ext = (p) => (p.split('.').pop() || 'pdf').toLowerCase()
  const lines = ['Пакет документів для бухгалтера', '']
  const missing = []
  const sharedDone = new Set()
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    onProgress?.(i + 1, docs.length)
    let rep
    try { rep = await traceOutgoing(d.id) } catch { missing.push(`${d.doc_number}: не вдалося простежити`); continue }
    const kind = rep.doc.isAct ? 'Акт' : 'Видаткова'
    const date = (rep.doc.doc_date || '').split('-').reverse().join('.')
    const folder = safeName(`${String(i + 1).padStart(2, '0')} ${kind} ${rep.doc.doc_number} ${rep.doc.contractorName}`)
    lines.push(`${kind} № ${rep.doc.doc_number} від ${date} — ${rep.doc.contractorName} — ${rep.doc.amount ?? ''} грн`)
    const own = await fetchFile(rep.doc.storage_path)
    if (own) put(`${folder}/${safeName(`${kind} ${rep.doc.doc_number}`)}.${ext(rep.doc.storage_path)}`, own)
    else missing.push(`${kind} № ${rep.doc.doc_number}: немає файлу`)
    const sources = [
      ...rep.purchaseDocs.map(p => ({ path: p.storage_path, label: `Прихідна ${p.doc_number || ''} ${p.supplierName || ''}`, line: `прихідна № ${p.doc_number || '—'} — ${p.supplierName || ''}` })),
      ...(rep.orderCostDocs || []).map(c => ({ path: c.storage_path, label: `${COST_TYPE[c.type] || 'Вхідний'} ${c.doc_number || ''} ${c.supplierName || ''}`, line: `${(COST_TYPE[c.type] || 'вхідний').toLowerCase()} № ${c.doc_number || '—'} — ${c.supplierName || ''}` })),
    ]
    for (const s of sources) {
      lines.push(`    ← ${s.line}${s.path ? '' : ' (без файлу)'}`)
      if (!s.path || sharedDone.has(s.path)) continue
      sharedDone.add(s.path)
      const buf = await fetchFile(s.path)
      if (buf) put(`Прихідні та витрати/${safeName(s.label)}.${ext(s.path)}`, buf)
    }
    if (rep.shortages?.length) lines.push(`    ! не вистачило прихідних: ${rep.shortages.length} поз.`)
  }
  if (missing.length) lines.push('', 'Без файлів:', ...missing.map(m => `  ${m}`))
  files['Перелік.txt'] = enc.encode(lines.join('\r\n'))
  return { files, missing, fileCount: Object.keys(files).length - 1 }
}

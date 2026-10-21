// Склад ↔ Excel: вивантаження рухів / карток / синонімів і завантаження ВИПРАВЛЕНЬ (не таблиць).
// Excel редагує лише колонки «Перенести на картку», «Тип», «Статус». Усе застосовується через
// split_product (087: роль, закритий місяць, журнал, скасування) та оновлення типу/статусу картки.
import { supabase } from './supabase'
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'

export const TYPE_LABEL = { goods: 'Товар', service: 'Послуга', expense: 'Розхідний матеріал' }
export const STATUS_LABEL = { active: 'активна', archived: 'архів' }
const fromLabel = (map, v) => {
  const t = String(v ?? '').trim().toLowerCase()
  if (!t) return null
  return Object.keys(map).find(k => map[k].toLowerCase() === t || k === t) || undefined   // undefined = невідоме значення
}

const H = {
  movId: 'ID руху', cardId: 'ID картки', card: 'Картка', sku: 'Артикул картки', warn: '⚠ різні назви', docName: 'Назва в документі',
  type: 'Тип руху', doc: 'Документ', date: 'Дата', contractor: 'Контрагент', qty: 'К-сть', price: 'Ціна приходу / собівартість',
  source: 'Джерело', move: 'Перенести на картку',
  cType: 'Тип', cStatus: 'Статус', cMovs: 'Рухів', cIn: 'Прийшло', cOut: 'Продано', cStock: 'Залишок', cNames: 'Різних назв у документах',
  alias: 'Синонім',
}
export const docName = (m) => (m.description || '').replace(/^[^:]*:\s*/, '').trim()
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12)
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const normSku = (s) => String(s || '').toUpperCase().replace(/[^0-9A-ZА-ЯІЇЄҐ]/g, '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SRC = { document: 'документ', manual: 'вручну', assembly: 'збірка', auto: 'авто' }

// ── вивантаження ──
export async function loadStockData() {
  const products = await fetchAll(() => qc('product_stock').select('id, name, sku, product_type, status, computed_stock, total_in, total_out'))
  const movs = await fetchAll(() => qc('stock_movements')
    .select('id, product_id, type, quantity, price, cost_price, date, description, source, documents(doc_number, doc_date, contractors(name))'))
  const ids = products.map(p => p.id)
  const aliases = ids.length ? await fetchAllIn(() => supabase.from('product_aliases').select('id, product_id, alias'), 'product_id', ids) : []
  return { products, movs, aliases }
}

export function buildWorkbookRows({ products, movs, aliases }) {
  const byId = new Map(products.map(p => [p.id, p]))
  const names = new Map()   // product → Set(nameKey)
  const cnt = new Map()
  for (const m of movs) cnt.set(m.product_id, (cnt.get(m.product_id) || 0) + 1)
  for (const m of movs) {
    if (m.source === 'assembly') continue
    const k = nameKey(docName(m)); if (!k) continue
    if (!names.has(m.product_id)) names.set(m.product_id, new Set())
    names.get(m.product_id).add(k)
  }
  const mixed = (pid) => (names.get(pid)?.size || 0) > 1
  const dt = (m) => m.documents?.doc_date || m.date || ''
  const movRows = movs.filter(m => byId.has(m.product_id))
    .sort((a, b) => (byId.get(a.product_id).name || '').localeCompare(byId.get(b.product_id).name || '', 'uk') || String(dt(a)).localeCompare(String(dt(b))))
    .map(m => {
      const p = byId.get(m.product_id)
      return {
        [H.card]: p.name, [H.sku]: p.sku || '', [H.warn]: mixed(p.id) ? '⚠' : '', [H.docName]: docName(m),
        [H.type]: m.type === 'in' ? 'прихід' : m.type === 'out' ? 'видаток' : m.type, [H.doc]: m.documents?.doc_number || '',
        [H.date]: dt(m), [H.contractor]: m.documents?.contractors?.name || '', [H.qty]: Number(m.quantity) || 0,
        [H.price]: Number(m.type === 'in' ? m.price : m.cost_price) || null, [H.source]: SRC[m.source] || m.source || '',
        [H.move]: '', [H.movId]: m.id, [H.cardId]: p.id,
      }
    })
  const cardRows = [...products].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk')).map(p => ({
    [H.card]: p.name, [H.sku]: p.sku || '', [H.cType]: TYPE_LABEL[p.product_type] || p.product_type || '', [H.cStatus]: STATUS_LABEL[p.status] || p.status || '',
    [H.cMovs]: cnt.get(p.id) || 0, [H.cIn]: Number(p.total_in) || 0, [H.cOut]: Number(p.total_out) || 0,
    [H.cStock]: Number(p.computed_stock) || 0, [H.cNames]: names.get(p.id)?.size || 0, [H.cardId]: p.id,
  }))
  const alRows = aliases.filter(a => byId.has(a.product_id))
    .sort((a, b) => (byId.get(a.product_id).name || '').localeCompare(byId.get(b.product_id).name || '', 'uk'))
    .map(a => ({ [H.card]: byId.get(a.product_id).name, [H.alias]: a.alias, [H.move]: '', [H.cardId]: a.product_id }))
  return { movRows, cardRows, alRows }
}

const HELP = [
  ['Як виправити склад через Excel'],
  [''],
  ['1. Аркуш «Рухи»: у рядках, що належать ІНШОМУ товару, заповніть «Перенести на картку».'],
  ['   • назва або артикул наявної картки (як в аркуші «Картки») — рух перейде на неї;'],
  ['   • нова назва — буде створено нову картку; артикул можна дописати через «|»: Відеоплата MSI GT1030 4Gb | MSI-4G'],
  ['   • ID картки (з колонки «ID картки») — якщо назви повторюються.'],
  ['2. Аркуш «Синоніми»: «Перенести на картку» — щоб імпорт документів підставляв правильну картку.'],
  ['3. Аркуш «Картки»: можна змінити «Тип» (Товар / Послуга / Розхідний матеріал) і «Статус» (активна / архів).'],
  ['4. Інші колонки НЕ змінюються при завантаженні (їх можна сортувати й фільтрувати). Колонки ID не видаляйте.'],
  ['5. Склад → «Excel: вивантажити / виправити» → «Завантажити виправлення» → перегляньте план → «Застосувати».'],
  [''],
  ['Собівартість при перенесенні не змінюється; після виправлень — «Діагностика» і «Застосувати FIFO» (з резервною копією).'],
  ['Кожне перенесення записане в журнал і скасовується в картці товару → «Розділити картку».'],
  ['Рухи закритого місяця, з ручною прив\'язкою / собівартістю, із закритої партії та збірки не переносяться — план покаже причину.'],
]

export async function exportStockXlsx(data) {
  const XLSX = await import('xlsx')
  const { movRows, cardRows, alRows } = buildWorkbookRows(data)
  const wb = XLSX.utils.book_new()
  const sheet = (rows, header, widths) => {
    const ws = XLSX.utils.json_to_sheet(rows, { header })
    ws['!cols'] = widths.map(w => ({ wch: w }))
    if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) }
    return ws
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(HELP), 'Як заповнювати')
  XLSX.utils.book_append_sheet(wb, sheet(movRows, [H.card, H.sku, H.warn, H.docName, H.type, H.doc, H.date, H.contractor, H.qty, H.price, H.source, H.move, H.movId, H.cardId],
    [40, 16, 6, 50, 9, 16, 11, 26, 7, 12, 10, 36, 38, 38]), 'Рухи')
  XLSX.utils.book_append_sheet(wb, sheet(cardRows, [H.card, H.sku, H.cType, H.cStatus, H.cMovs, H.cIn, H.cOut, H.cStock, H.cNames, H.cardId],
    [50, 18, 18, 10, 7, 9, 9, 9, 10, 38]), 'Картки')
  XLSX.utils.book_append_sheet(wb, sheet(alRows, [H.card, H.alias, H.move, H.cardId], [45, 60, 36, 38]), 'Синоніми')
  XLSX.writeFile(wb, `Склад_виправлення_${new Date().toISOString().slice(0, 10)}.xlsx`)
  return { movs: movRows.length, cards: cardRows.length, mixed: new Set(movRows.filter(r => r[H.warn]).map(r => r[H.cardId])).size }
}

// ── завантаження виправлень ──
export async function readCorrectionFile(file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const rows = (n) => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }) : null
  const movRows = rows('Рухи'), cardRows = rows('Картки'), alRows = rows('Синоніми')
  if (!movRows && !cardRows && !alRows) throw new Error('У файлі немає аркушів «Рухи», «Картки», «Синоніми» — завантажте файл, вивантажений зі складу')
  return { movRows: movRows || [], cardRows: cardRows || [], alRows: alRows || [] }
}

// Куди переносити: ID → артикул → назва → нова картка. Повертає { id } | { newName, newSku } | { error }
export function resolveTarget(text, products) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  if (UUID.test(raw)) {
    const p = products.find(x => x.id === raw.toLowerCase())
    return p ? { id: p.id, name: p.name } : { error: `картку з ID ${raw} не знайдено` }
  }
  const [namePart, skuPart] = raw.split('|').map(s => s.trim())
  const bySku = products.filter(p => normSku(p.sku) && normSku(p.sku) === normSku(namePart))
  if (bySku.length === 1) return { id: bySku[0].id, name: bySku[0].name }
  const byName = products.filter(p => norm(p.name) === norm(namePart))
  const active = byName.filter(p => p.status !== 'archived')
  const pick = active.length === 1 ? active : byName
  if (pick.length === 1) return { id: pick[0].id, name: pick[0].name }
  if (pick.length > 1 || bySku.length > 1) return { error: `«${namePart}» — кілька карток, вкажіть ID картки` }
  return { newName: namePart, newSku: skuPart || null }
}

export function buildPlan(file, { products, movs, aliases }) {
  const byId = new Map(products.map(p => [p.id, p]))
  const movById = new Map(movs.map(m => [m.id, m]))
  const alByKey = new Map(aliases.map(a => [a.product_id + '|' + a.alias, a]))
  const ops = new Map(), errors = [], cardChanges = []
  const opFor = (src, t) => {
    const key = src + '→' + (t.id || 'new:' + norm(t.newName))
    if (!ops.has(key)) ops.set(key, { src, srcName: byId.get(src)?.name, target: t, movs: [], aliases: [], inQty: 0, outQty: 0 })
    return ops.get(key)
  }
  file.movRows.forEach((r, i) => {
    const text = r[H.move]; if (!String(text ?? '').trim()) return
    const line = `Рухи, рядок ${i + 2}`
    const m = movById.get(String(r[H.movId] || '').trim())
    if (!m) { errors.push(`${line}: рух не знайдено (не змінюйте колонку «${H.movId}»)`); return }
    if (m.source === 'assembly') { errors.push(`${line}: рух збірки переноситься разом зі збіркою`); return }
    const t = resolveTarget(text, products)
    if (t.error) { errors.push(`${line}: ${t.error}`); return }
    if (t.id === m.product_id) return
    const op = opFor(m.product_id, t)
    op.movs.push(m.id)
    if (m.type === 'in') op.inQty += Number(m.quantity) || 0
    if (m.type === 'out') op.outQty += Number(m.quantity) || 0
  })
  file.alRows.forEach((r, i) => {
    const text = r[H.move]; if (!String(text ?? '').trim()) return
    const line = `Синоніми, рядок ${i + 2}`
    const pid = String(r[H.cardId] || '').trim(), alias = String(r[H.alias] ?? '')
    if (!alByKey.has(pid + '|' + alias)) { errors.push(`${line}: синонім «${alias}» на цій картці не знайдено`); return }
    const t = resolveTarget(text, products)
    if (t.error) { errors.push(`${line}: ${t.error}`); return }
    if (t.id === pid) return
    opFor(pid, t).aliases.push(alias)
  })
  file.cardRows.forEach((r, i) => {
    const line = `Картки, рядок ${i + 2}`
    const p = byId.get(String(r[H.cardId] || '').trim()); if (!p) return
    const type = fromLabel(TYPE_LABEL, r[H.cType]), status = fromLabel(STATUS_LABEL, r[H.cStatus])
    if (type === undefined) { errors.push(`${line}: невідомий тип «${r[H.cType]}» (Товар / Послуга / Розхідний матеріал)`); return }
    if (status === undefined) { errors.push(`${line}: невідомий статус «${r[H.cStatus]}» (активна / архів)`); return }
    const ch = {}
    if (type && type !== p.product_type) ch.product_type = type
    if (status && status !== p.status) ch.status = status
    if (Object.keys(ch).length) cardChanges.push({ id: p.id, name: p.name, from: { product_type: p.product_type, status: p.status }, ch })
  })
  // залишок, що лишиться на вихідних картках
  const left = new Map()
  for (const op of ops.values()) {
    const p = byId.get(op.src)
    const cur = left.get(op.src) ?? { in: Number(p?.total_in) || 0, out: Number(p?.total_out) || 0 }
    left.set(op.src, { in: cur.in - op.inQty, out: cur.out - op.outQty })
  }
  const list = [...ops.values()].map(op => ({ ...op, leftStock: left.get(op.src).in - left.get(op.src).out }))
  return { ops: list, cardChanges, errors }
}

// Застосування: послідовно; нова картка з тією самою назвою створюється один раз.
export async function applyPlan(plan, onStep = () => {}) {
  const created = new Map(), results = []
  for (const op of plan.ops) {
    const nk = op.target.newName ? norm(op.target.newName) : null
    const targetId = op.target.id || (nk && created.get(nk)) || null
    const { data, error } = await supabase.rpc('split_product', {
      p_src: op.src, p_movs: op.movs, p_target: targetId,
      p_new_name: targetId ? null : op.target.newName, p_new_sku: targetId ? null : op.target.newSku, p_aliases: op.aliases,
    })
    if (!error && nk && data?.created) created.set(nk, data.target)
    const r = { kind: 'split', op, ok: !error, error: error && (error.code === 'PGRST202' ? 'Міграцію 087 ще не застосовано' : error.message.replace(/^[A-Z_]+:\s*/, '')), data }
    results.push(r); onStep(r)
  }
  for (const c of plan.cardChanges) {
    const { error } = await supabase.from('products').update(c.ch).eq('id', c.id)
    const r = { kind: 'card', c, ok: !error, error: error?.message }
    results.push(r); onStep(r)
  }
  return results
}

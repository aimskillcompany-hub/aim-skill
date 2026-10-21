// Склад ↔ Excel: вивантаження і завантаження ВИПРАВЛЕНЬ (не таблиць).
// Редагуються лише окремі колонки; усе застосовується серверними функціями (087 split_product, 088 product_fix /
// split_movement / doc_fix / assembly_fix / alias_delete): роль, закритий місяць, журнал «було / стало», скасування.
// Порядок застосування (ТЗ): картки → документи → рухи → збірки → синоніми.
import { supabase } from './supabase'
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { normalizeName } from './stockService'

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
  source: 'Джерело', move: 'Перенести на картку', moveQty: 'К-сть до перенесення',
  cType: 'Тип', cStatus: 'Статус', cMovs: 'Рухів', cIn: 'Прийшло', cOut: 'Продано', cStock: 'Залишок', cNames: 'Різних назв у документах',
  newSku: 'Новий артикул', newName: 'Нова назва',
  alias: 'Синонім', conflict: 'Конфлікт',
  docId: 'ID документа', dType: 'Тип', dNum: 'Номер', dLines: 'Рядків', dSum: 'Сума', dOrder: 'Порядок у дні', dWarn: '⚠',
  dNewDate: 'Нова дата', dNewNum: 'Новий номер', dNewOrder: 'Новий порядок у дні',
  asmId: 'ID збірки', lineId: 'ID рядка', role: 'Роль', asmSku: 'Артикул', asmDate: 'Дата збірки', asmCost: 'Собівартість виробу',
  asmCurCost: 'Поточна собівартість / од', asmMismatch: 'Розбіжність', asmComp: 'Картка компонента',
  snapQty: 'К-сть при вивантаженні', snapDate: 'Дата при вивантаженні',
}
export const docName = (m) => (m.description || '').replace(/^[^:]*:\s*/, '').trim()
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12)
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const normSku = (s) => String(s || '').toUpperCase().replace(/[^0-9A-ZА-ЯІЇЄҐ]/g, '')
// синоніми: регістр, пробіли / переноси рядків, різні лапки й апострофи — однакові
export const aliasNorm = (s) => String(s || '').toLowerCase().replace(/[‘’ʼ`´']/g, "'")
  .replace(/[«»“”„"]/g, '"').replace(/\s+/g, ' ').trim()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SRC = { document: 'документ', manual: 'вручну', assembly: 'збірка', auto: 'авто' }
const PIECE = /^(шт|од|компл|комплект|пар)/i
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const blank = (v) => String(v ?? '').trim() === ''
const dmy = (iso) => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : ''

// дата з Excel: Date, число (серійна дата Excel), «28.05.2026», «2026-05-28». undefined — не дата.
export function toISO(v) {
  if (v instanceof Date) return isNaN(v) ? undefined : new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10)
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10) : undefined
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (m) { const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isNaN(new Date(iso)) ? undefined : iso }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return isNaN(new Date(m[0])) ? undefined : m[0]
  return undefined
}
const num = (v) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.')
  return s === '' ? null : (isNaN(Number(s)) ? NaN : Number(s))
}

// ── завантаження даних з бази ──
export async function loadStockData() {
  const products = await fetchAll(() => qc('product_stock').select('id, name, sku, unit, product_type, status, computed_stock, total_in, total_out'))
  const movs = await fetchAll(() => qc('stock_movements')
    .select('id, product_id, type, quantity, price, cost_price, date, description, source, document_id, assembly_id, documents(doc_number, doc_date, contractors(name))'))
  const ids = products.map(p => p.id)
  const aliases = ids.length ? await fetchAllIn(() => supabase.from('product_aliases').select('id, product_id, alias, created_at'), 'product_id', ids) : []
  const docIds = [...new Set(movs.map(m => m.document_id).filter(Boolean))]
  // day_order / manual_unit_cost з'являються з міграцією 088 — до неї вивантаження працює без них
  const withFallback = (run, cols, fallbackCols) => run(cols).catch(() => run(fallbackCols))
  const docs = docIds.length ? await withFallback(c => fetchAllIn(() => qc('documents').select(c), 'id', docIds),
    'id, type, doc_number, doc_date, contractor_id, amount, day_order, created_at, contractors(name)', 'id, type, doc_number, doc_date, contractor_id, amount, created_at, contractors(name)') : []
  const assemblies = await withFallback(c => fetchAll(() => qc('assemblies').select(c)),
    'id, name, result_product_id, quantity, total_cost, assembled_at, manual_unit_cost', 'id, name, result_product_id, quantity, total_cost, assembled_at')
  const asmIds = assemblies.map(a => a.id)
  const asmItems = asmIds.length ? await fetchAllIn(() => supabase.from('assembly_items').select('id, assembly_id, product_id, quantity, cost_price'), 'assembly_id', asmIds) : []
  const asmIn = movs.filter(m => m.assembly_id && m.type === 'in' && m.source === 'assembly').map(m => m.id)
  const asmAlloc = asmIn.length ? await fetchAllIn(() => supabase.from('stock_allocations').select('in_movement_id, out_movement_id, qty'), 'in_movement_id', asmIn) : []
  const { data: pc } = await qc('period_closings').select('period_year, period_month, status')
  const closed = (pc || []).filter(r => r.status === 'closed').map(r => `${r.period_year}-${String(r.period_month).padStart(2, '0')}`)
  return { products, movs, aliases, docs, assemblies, asmItems, asmAlloc, closed }
}

const movDate = (m) => m.documents?.doc_date || m.date || ''

// групи синонімів: картка + нормалізований текст → [синоніми] (перший — найстаріший, лишається)
function aliasGroups(aliases) {
  const g = new Map()
  for (const a of [...aliases].sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')) || String(x.id).localeCompare(String(y.id)))) {
    const k = a.product_id + '|' + aliasNorm(a.alias)
    if (!g.has(k)) g.set(k, [])
    g.get(k).push(a)
  }
  return g
}

// порядок документів у межах дня: заданий (day_order) → приходи → видатки → за часом створення
function dayOrderMap(docs, kindOf) {
  const byDate = new Map()
  for (const d of docs) { const k = d.doc_date || ''; if (!byDate.has(k)) byDate.set(k, []); byDate.get(k).push(d) }
  const res = new Map()
  for (const list of byDate.values()) {
    list.sort((a, b) => (a.day_order ?? 1e9) - (b.day_order ?? 1e9) || (kindOf(a) === 'in' ? 0 : 1) - (kindOf(b) === 'in' ? 0 : 1)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    list.forEach((d, i) => res.set(d.id, i + 1))
  }
  return res
}

export function buildWorkbookRows(data) {
  const { products, movs, aliases } = data
  const docs = data.docs || [], assemblies = data.assemblies || [], asmItems = data.asmItems || []
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
  const movRows = movs.filter(m => byId.has(m.product_id))
    .sort((a, b) => (byId.get(a.product_id).name || '').localeCompare(byId.get(b.product_id).name || '', 'uk') || String(movDate(a)).localeCompare(String(movDate(b))))
    .map(m => {
      const p = byId.get(m.product_id)
      return {
        [H.card]: p.name, [H.sku]: p.sku || '', [H.warn]: mixed(p.id) ? '⚠' : '', [H.docName]: docName(m),
        [H.type]: m.type === 'in' ? 'прихід' : m.type === 'out' ? 'видаток' : m.type, [H.doc]: m.documents?.doc_number || '',
        [H.date]: movDate(m), [H.contractor]: m.documents?.contractors?.name || '', [H.qty]: Number(m.quantity) || 0,
        [H.price]: Number(m.type === 'in' ? m.price : m.cost_price) || null, [H.source]: SRC[m.source] || m.source || '',
        [H.move]: '', [H.moveQty]: '', [H.movId]: m.id, [H.cardId]: p.id,
      }
    })
  const cardRows = [...products].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk')).map(p => ({
    [H.card]: p.name, [H.sku]: p.sku || '', [H.cType]: TYPE_LABEL[p.product_type] || p.product_type || '', [H.cStatus]: STATUS_LABEL[p.status] || p.status || '',
    [H.newSku]: '', [H.newName]: '',
    [H.cMovs]: cnt.get(p.id) || 0, [H.cIn]: Number(p.total_in) || 0, [H.cOut]: Number(p.total_out) || 0,
    [H.cStock]: Number(p.computed_stock) || 0, [H.cNames]: names.get(p.id)?.size || 0, [H.cardId]: p.id,
  }))

  // синоніми: без дублів (картка + однаковий після нормалізації текст), ⚠ якщо той самий синонім у кількох картках
  const groups = aliasGroups(aliases.filter(a => byId.has(a.product_id)))
  const cards = new Map()
  for (const list of groups.values()) { const k = aliasNorm(list[0].alias); if (!cards.has(k)) cards.set(k, new Set()); cards.get(k).add(list[0].product_id) }
  const alRows = [...groups.values()].map(list => list[0])
    .sort((a, b) => (byId.get(a.product_id).name || '').localeCompare(byId.get(b.product_id).name || '', 'uk'))
    .map(a => ({ [H.card]: byId.get(a.product_id).name, [H.alias]: a.alias,
      [H.conflict]: cards.get(aliasNorm(a.alias)).size > 1 ? `⚠ ще в ${cards.get(aliasNorm(a.alias)).size - 1} картці(ах)` : '',
      [H.move]: '', [H.cardId]: a.product_id }))

  // документи
  const movsByDoc = new Map()
  for (const m of movs) if (m.document_id) { if (!movsByDoc.has(m.document_id)) movsByDoc.set(m.document_id, []); movsByDoc.get(m.document_id).push(m) }
  const kindOf = (d) => { const t = new Set((movsByDoc.get(d.id) || []).map(m => m.type)); return t.has('in') && !t.has('out') ? 'in' : t.has('out') && !t.has('in') ? 'out' : 'mixed' }
  const order = dayOrderMap(docs, kindOf)
  const numKey = (d) => `${d.contractor_id || ''}|${norm(d.doc_number)}`
  const numCnt = new Map(); for (const d of docs) if (!blank(d.doc_number)) numCnt.set(numKey(d), (numCnt.get(numKey(d)) || 0) + 1)
  const docRows = [...docs].sort((a, b) => String(a.doc_date || '').localeCompare(String(b.doc_date || '')) || (order.get(a.id) - order.get(b.id))).map(d => {
    const ms = movsByDoc.get(d.id) || []
    const w = []
    if (blank(d.doc_number) || /^б\s*\/?\s*н$/i.test(String(d.doc_number).trim())) w.push('б/н')
    if ((numCnt.get(numKey(d)) || 0) > 1) w.push('номер повторюється в контрагента')
    if (ms.some(m => m.source !== 'assembly' && m.date && d.doc_date && m.date !== d.doc_date)) w.push('рухи з іншою датою')
    const k = kindOf(d)
    return {
      [H.docId]: d.id, [H.dType]: k === 'in' ? 'прихід' : k === 'out' ? 'видаток' : 'прихід / видаток', [H.dNum]: d.doc_number || '',
      [H.date]: d.doc_date || '', [H.contractor]: d.contractors?.name || '', [H.dLines]: ms.length, [H.dSum]: d.amount == null ? '' : Number(d.amount),
      [H.dOrder]: d.day_order != null ? String(d.day_order) : `${order.get(d.id)} (авто)`, [H.dWarn]: w.length ? '⚠ ' + w.join('; ') : '',
      [H.dNewDate]: '', [H.dNewNum]: '', [H.dNewOrder]: '',
    }
  })

  // збірки: виріб, під ним компоненти
  const asmRows = []
  const itemsBy = new Map(); for (const it of asmItems) { if (!itemsBy.has(it.assembly_id)) itemsBy.set(it.assembly_id, []); itemsBy.get(it.assembly_id).push(it) }
  for (const a of [...assemblies].sort((x, y) => String(x.assembled_at || '').localeCompare(String(y.assembled_at || '')))) {
    const am = movs.filter(m => m.assembly_id === a.id)
    const inM = am.find(m => m.type === 'in')
    const mism = am.some(m => m.date && a.assembled_at && m.date !== a.assembled_at)
    const p = byId.get(a.result_product_id)
    asmRows.push({
      [H.asmId]: a.id, [H.lineId]: '', [H.role]: 'виріб', [H.card]: p?.name || a.name || '', [H.asmSku]: p?.sku || '',
      [H.asmDate]: a.assembled_at || '', [H.qty]: Number(a.quantity) || 0,
      [H.asmCost]: a.manual_unit_cost != null ? Number(a.manual_unit_cost) : '',
      [H.asmCurCost]: inM ? r2(Number(inM.cost_price) || Number(inM.price)) : '',
      [H.asmMismatch]: !inM ? '⚠ стара збірка без рухів — змінюється лише в програмі' : mism ? '⚠ різні дати виробу й компонентів' : '',
      [H.asmComp]: '', [H.snapQty]: Number(a.quantity) || 0, [H.snapDate]: a.assembled_at || '',
    })
    for (const it of itemsBy.get(a.id) || []) {
      const c = byId.get(it.product_id)
      asmRows.push({
        [H.asmId]: a.id, [H.lineId]: it.id, [H.role]: 'компонент', [H.card]: c?.name || '', [H.asmSku]: c?.sku || '',
        [H.asmDate]: '', [H.qty]: Number(it.quantity) || 0, [H.asmCost]: '', [H.asmCurCost]: r2(it.cost_price),
        [H.asmMismatch]: '', [H.asmComp]: '', [H.snapQty]: Number(it.quantity) || 0, [H.snapDate]: '',
      })
    }
  }
  return { movRows, cardRows, alRows, docRows, asmRows }
}

const HELP = [
  ['Як виправити склад через Excel'],
  [''],
  ['Заповнюйте лише колонки, описані тут. Інші колонки — для довідки (сортуйте й фільтруйте), при завантаженні не змінюються. Колонки ID не видаляйте.'],
  ['Порожня клітинка = без змін. Після завантаження програма покаже план — нічого не змінюється до «Застосувати».'],
  ['Порядок застосування: Картки → Документи → Рухи → Збірки → Синоніми (тож рух можна перенести на картку, перейменовану в тому ж файлі).'],
  [''],
  ['КАРТКИ'],
  ['  Тип: Товар / Послуга / Розхідний матеріал.   Статус: активна / архів.'],
  ['  Новий артикул: напр. W5170.  «-» — очистити артикул. Якщо такий артикул уже є в іншій картці — попередження (не заборона).'],
  ['  Нова назва: перейменувати картку. Стара назва автоматично стає синонімом. Назва, що вже є в іншій картці, — заборонено (використайте «Перенести на картку»).'],
  [''],
  ['РУХИ'],
  ['  Перенести на картку: назва або артикул наявної картки; нова назва — створиться нова картка; артикул нової — через «|»: Відеоплата MSI GT1030 4Gb | MSI-4G'],
  ['  К-сть до перенесення: порожньо — весь рух. Менше за «К-сть» — рух ділиться: вказана кількість іде на картку, решта лишається.'],
  ['    Напр. продаж 3 шт, «К-сть до перенесення» = 1 → 2 шт лишаються, 1 шт переходить. Документ не змінюється — поділ лише складський.'],
  [''],
  ['ДОКУМЕНТИ'],
  ['  Нова дата: 28.05.2026 — змінює дату документа і всіх його рухів. Якщо вказати ту саму дату — рухи вирівнюються до дати документа.'],
  ['  Новий номер: напр. 13/1. Якщо такий номер уже є в цього контрагента в тому ж році — попередження.'],
  ['  Новий порядок у дні: 1, 2, 3… — хто йде першим серед документів однієї дати при розрахунку FIFO. «-» — прибрати порядок.'],
  ['    Без порядку приходи йдуть перед видатками. Напр. прихід 2109 = 1, ВН-0044 = 2 → ВН-0044 бере партію з 2109.'],
  ['  ⚠: б/н; номер повторюється в контрагента; рухи з іншою датою, ніж документ.'],
  [''],
  ['ЗБІРКИ (рядок «виріб», під ним «компонент»)'],
  ['  Дата збірки (лише рядок «виріб»): одна дата для виробу й усіх компонентів.'],
  ['  К-сть: нова кількість (у компонента — на всю збірку). 0 — прибрати компонент.'],
  ['  Додати компонент: новий рядок під виробом — той самий «ID збірки», порожній «ID рядка», «Картка компонента» (назва / артикул / ID), «К-сть».'],
  ['  Собівартість виробу (лише «виріб», на одиницю): порожньо — сума компонентів за FIFO; число — ручна; «авто» — зняти ручну.'],
  ['  Після змін собівартість виробу перераховується; план покаже «було / стане» і продані документи, де вона зміниться.'],
  [''],
  ['СИНОНІМИ'],
  ['  Перенести на картку: назва / артикул / ID картки — за синонімом імпорт документів підставлятиме цю картку.'],
  ['  «видалити» — синонім прибирається з картки, рухи не змінюються. Останній синонім, що збігається з назвою картки, видалити не можна.'],
  ['  Дублі (однакові після нормалізації: регістр, пробіли, лапки) прибираються автоматично під час завантаження. ⚠ Конфлікт — той самий синонім у кількох картках.'],
  [''],
  ['Рядок, який змінився в базі після вивантаження (к-сть, дата, картка, номер), пропускається з причиною «змінено після вивантаження» — вивантажте файл заново.'],
  ['Закритий місяць (стара або нова дата), ручна прив\'язка / собівартість, закрита партія — рядок пропускається з причиною.'],
  ['Кожна зміна записується в журнал і скасовується: Склад → «Excel: вивантажити / виправити» → «Журнал», або картка товару → «Розділити картку».'],
  ['Собівартість відвантажень імпорт не перераховує (крім виробу збірки). Після застосування: «Діагностика собівартості» → «Застосувати FIFO» (з резервною копією).'],
]

export async function exportStockXlsx(data) {
  const XLSX = await import('xlsx')
  const { movRows, cardRows, alRows, docRows, asmRows } = buildWorkbookRows(data)
  const wb = XLSX.utils.book_new()
  const sheet = (rows, header, widths) => {
    const ws = XLSX.utils.json_to_sheet(rows, { header })
    ws['!cols'] = widths.map(w => ({ wch: w }))
    if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) }
    return ws
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(HELP), 'Як заповнювати')
  XLSX.utils.book_append_sheet(wb, sheet(movRows, [H.card, H.sku, H.warn, H.docName, H.type, H.doc, H.date, H.contractor, H.qty, H.price, H.source, H.move, H.moveQty, H.movId, H.cardId],
    [40, 16, 6, 50, 9, 16, 11, 26, 7, 12, 10, 36, 12, 38, 38]), 'Рухи')
  XLSX.utils.book_append_sheet(wb, sheet(cardRows, [H.card, H.sku, H.cType, H.cStatus, H.newSku, H.newName, H.cMovs, H.cIn, H.cOut, H.cStock, H.cNames, H.cardId],
    [50, 18, 18, 10, 16, 40, 7, 9, 9, 9, 10, 38]), 'Картки')
  XLSX.utils.book_append_sheet(wb, sheet(docRows, [H.docId, H.dType, H.dNum, H.date, H.contractor, H.dLines, H.dSum, H.dOrder, H.dWarn, H.dNewDate, H.dNewNum, H.dNewOrder],
    [38, 14, 18, 11, 30, 7, 12, 12, 40, 12, 14, 12]), 'Документи')
  XLSX.utils.book_append_sheet(wb, sheet(asmRows, [H.asmId, H.lineId, H.role, H.card, H.asmSku, H.asmDate, H.qty, H.asmCost, H.asmCurCost, H.asmMismatch, H.asmComp, H.snapQty, H.snapDate],
    [38, 38, 11, 45, 16, 12, 8, 14, 14, 36, 36, 10, 12]), 'Збірки')
  XLSX.utils.book_append_sheet(wb, sheet(alRows, [H.card, H.alias, H.conflict, H.move, H.cardId], [45, 60, 18, 36, 38]), 'Синоніми')
  XLSX.writeFile(wb, `Склад_виправлення_${new Date().toISOString().slice(0, 10)}.xlsx`)
  return { movs: movRows.length, cards: cardRows.length, docs: docRows.length, asm: asmRows.filter(r => r[H.role] === 'виріб').length,
    mixed: new Set(movRows.filter(r => r[H.warn]).map(r => r[H.cardId])).size }
}

// ── завантаження виправлень ──
export async function readCorrectionFile(file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const rows = (n) => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }) : null
  const f = { movRows: rows('Рухи'), cardRows: rows('Картки'), alRows: rows('Синоніми'), docRows: rows('Документи'), asmRows: rows('Збірки') }
  if (Object.values(f).every(v => !v)) throw new Error('У файлі немає аркушів «Рухи», «Картки», «Документи», «Збірки», «Синоніми» — завантажте файл, вивантажений зі складу')
  for (const k of Object.keys(f)) f[k] = f[k] || []
  return f
}

// Куди переносити: ID → артикул → назва → нова картка. Повертає { id } | { newName, newSku } | { error }
export function resolveTarget(text, products, { allowNew = true } = {}) {
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
  if (!allowNew) return { error: `картку «${namePart}» не знайдено` }
  return { newName: namePart, newSku: skuPart || null }
}

export function buildPlan(file, data) {
  const { products, movs, aliases } = data
  const docs = data.docs || [], assemblies = data.assemblies || [], asmItems = data.asmItems || [], asmAlloc = data.asmAlloc || []
  const closed = new Set(data.closed || [])
  const isClosed = (iso) => !!iso && closed.has(iso.slice(0, 7))
  const byId = new Map(products.map(p => [p.id, p]))
  const movById = new Map(movs.map(m => [m.id, m]))
  const docById = new Map(docs.map(d => [d.id, d]))
  const errors = []
  const skip = (where, why) => errors.push(`${where}: ${why}`)
  const CHANGED = 'змінено після вивантаження — вивантажте файл заново'

  // ── 1. Картки ── (далі назви й артикули — вже змінені: перенесення може посилатися на перейменовану картку)
  const after = new Map(products.map(p => [p.id, { ...p }]))
  const cards = []
  file.cardRows.forEach((r, i) => {
    const line = `Картки, рядок ${i + 2}`
    const p = byId.get(String(r[H.cardId] || '').trim()); if (!p) return
    const type = fromLabel(TYPE_LABEL, r[H.cType]), status = fromLabel(STATUS_LABEL, r[H.cStatus])
    const ns = String(r[H.newSku] ?? '').trim(), nn = String(r[H.newName] ?? '').trim()
    const ch = {}
    if (type === undefined) { skip(line, `невідомий тип «${r[H.cType]}» (Товар / Послуга / Розхідний матеріал)`); return }
    if (status === undefined) { skip(line, `невідомий статус «${r[H.cStatus]}» (активна / архів)`); return }
    if (type && type !== p.product_type) ch.product_type = type
    if (status && status !== p.status) ch.status = status
    const op = { id: p.id, name: p.name, from: { product_type: p.product_type, status: p.status, sku: p.sku }, ch, warnings: [] }
    if (ns) {
      const to = ns === '-' ? null : ns
      if ((to || null) !== (p.sku || null)) {
        op.sku = { from: p.sku || null, to }
        const dup = to && [...after.values()].filter(x => x.id !== p.id && normSku(x.sku) && normSku(x.sku) === normSku(to))   // з урахуванням змін вище у файлі
        if (dup?.length) op.warnings.push(`артикул ${to} уже є в «${dup[0].name}»${dup.length > 1 ? ` і ще ${dup.length - 1}` : ''}`)
      }
    }
    if (nn && nn !== p.name) {
      const taken = [...after.values()].find(x => x.id !== p.id && norm(x.name) === norm(nn))
      if (taken) { skip(line, `назва «${nn}» уже є в іншій картці — щоб об'єднати, використайте «Перенести на картку»`); return }
      op.rename = { from: p.name, to: nn, aliasNorm: normalizeName(p.name) }
    }
    if (!op.sku && !op.rename && !Object.keys(ch).length) return
    if (norm(r[H.card]) !== norm(p.name) || String(r[H.sku] ?? '').trim() !== String(p.sku ?? '')) { skip(line, CHANGED); return }
    if (op.rename) after.get(p.id).name = nn
    if (op.sku) after.get(p.id).sku = op.sku.to
    cards.push(op)
  })
  const prodAfter = [...after.values()]

  // ── 2. Документи ──
  const docOps = []
  const newDate = new Map()   // doc → нова дата (для перевірки FIFO)
  const newOrder = new Map()
  file.docRows.forEach((r, i) => {
    const line = `Документи, рядок ${i + 2}`
    const d = docById.get(String(r[H.docId] || '').trim())
    const vDate = r[H.dNewDate], vNum = String(r[H.dNewNum] ?? '').trim(), vOrd = r[H.dNewOrder]
    if (blank(vDate) && !vNum && blank(vOrd)) return
    if (!d) { skip(line, `документ не знайдено (не змінюйте колонку «${H.docId}»)`); return }
    const iso = blank(vDate) ? null : toISO(vDate)
    if (iso === undefined) { skip(line, `«${vDate}» — не дата (формат 28.05.2026)`); return }
    let order = null, clear = false
    if (!blank(vOrd)) {
      if (String(vOrd).trim() === '-') clear = true
      else { order = num(vOrd); if (!Number.isInteger(order) || order < 1) { skip(line, `порядок у дні — ціле число від 1 (або «-»)`); return } }
    }
    if (toISO(r[H.date]) !== (d.doc_date || undefined) && !(blank(r[H.date]) && !d.doc_date)) { skip(line, CHANGED); return }
    if (String(r[H.dNum] ?? '').trim() !== String(d.doc_number ?? '').trim()) { skip(line, CHANGED); return }
    if (isClosed(d.doc_date) || isClosed(iso)) { skip(line, 'закритий період'); return }
    const ms = movs.filter(m => m.document_id === d.id && m.source !== 'assembly')
    const align = !!iso && iso === d.doc_date && ms.some(m => m.date !== d.doc_date)
    const op = { id: d.id, number: d.doc_number, date: d.doc_date, contractor: d.contractors?.name || '',
      newDate: iso && iso !== d.doc_date ? iso : null, newNumber: vNum && vNum !== d.doc_number ? vNum : null,
      order: clear ? null : order, clearOrder: clear, oldOrder: d.day_order, align, warnings: [] }
    if (!op.newDate && !op.newNumber && op.order == null && !clear && !align) return
    if (op.order != null && op.order === d.day_order) op.order = null
    if (op.newNumber) {
      const y = (op.newDate || d.doc_date || '').slice(0, 4)
      const dup = docs.find(x => x.id !== d.id && x.contractor_id === d.contractor_id && norm(x.doc_number) === norm(op.newNumber) && String(x.doc_date || '').slice(0, 4) === y)
      if (dup) op.warnings.push(`номер ${op.newNumber} уже є в цього контрагента (${dmy(dup.doc_date)})`)
    }
    if (!op.newDate && !align && ms.some(m => m.date !== d.doc_date)) op.warnings.push('рухи документа мають іншу дату — вкажіть «Нова дата» (можна ту саму), щоб вирівняти')
    if (op.newDate) newDate.set(d.id, op.newDate)
    if (op.order != null || clear) newOrder.set(d.id, clear ? null : op.order)
    docOps.push(op)
  })
  // FIFO-перевірка після змін дат / порядку: видаток раніше за прихід
  if (docOps.length) {
    const effDate = (m) => m.document_id ? (newDate.get(m.document_id) || docById.get(m.document_id)?.doc_date || m.date) : m.date
    const effOrder = (m) => m.document_id ? (newOrder.has(m.document_id) ? newOrder.get(m.document_id) : docById.get(m.document_id)?.day_order ?? null) : null
    for (const op of docOps) {
      const pids = [...new Set(movs.filter(m => m.document_id === op.id).map(m => m.product_id))]
      for (const pid of pids) {
        const ev = movs.filter(m => m.product_id === pid && (m.type === 'in' || m.type === 'out')).map(m => ({ m, d: effDate(m) || '', o: effOrder(m) }))
        ev.sort((a, b) => a.d.localeCompare(b.d) || (a.m.type === 'in' ? (a.o ?? -1) : (a.o ?? 1e9)) - (b.m.type === 'in' ? (b.o ?? -1) : (b.o ?? 1e9))
          || (a.m.type === 'in' ? 0 : 1) - (b.m.type === 'in' ? 0 : 1))
        let bal = 0, short = 0
        for (const e of ev) {
          bal += (e.m.type === 'in' ? 1 : -1) * (Number(e.m.quantity) || 0)
          if (e.m.document_id === op.id && e.m.type === 'out' && bal < -0.00001) short = Math.max(short, Math.min(-bal, Number(e.m.quantity) || 0))
        }
        if (short > 0) op.warnings.push(`⚠ видаток до приходу: «${byId.get(pid)?.name || pid}», нестача ${r2(short)}`)
      }
    }
  }

  // ── 3. Рухи ──
  const stock = new Map(products.map(p => [p.id, { in: Number(p.total_in) || 0, out: Number(p.total_out) || 0 }]))
  const bal = (pid) => { const s = stock.get(pid) || { in: 0, out: 0 }; return s.in - s.out }
  const shift = (pid, m, k, sign) => {
    if (!stock.has(pid)) stock.set(pid, { in: 0, out: 0 })
    const s = stock.get(pid); if (m.type === 'in') s.in += sign * k; else if (m.type === 'out') s.out += sign * k
  }
  const tKey = (t) => t.id || 'new:' + norm(t.newName)
  const whole = new Map(), parts = []
  file.movRows.forEach((r, i) => {
    const text = r[H.move], qv = r[H.moveQty]
    if (blank(text) && blank(qv)) return
    const line = `Рухи, рядок ${i + 2}`
    if (blank(text)) { skip(line, '«К-сть до перенесення» без «Перенести на картку»'); return }
    const m = movById.get(String(r[H.movId] || '').trim())
    if (!m) { skip(line, `рух не знайдено (не змінюйте колонку «${H.movId}»)`); return }
    if (m.source === 'assembly') { skip(line, 'рух збірки змінюється на аркуші «Збірки»'); return }
    if (Number(num(r[H.qty])) !== Number(m.quantity) || toISO(r[H.date]) !== (movDate(m) || undefined) || String(r[H.cardId] || '').trim() !== m.product_id) { skip(line, CHANGED); return }
    if (isClosed(m.date) || isClosed(movDate(m))) { skip(line, 'закритий період'); return }
    const t = resolveTarget(text, prodAfter)
    if (t.error) { skip(line, t.error); return }
    if (t.id === m.product_id) return
    const q = Number(m.quantity) || 0
    let k = null
    if (!blank(qv)) {
      k = num(qv)
      if (!(k > 0) || k >= q) { skip(line, `«К-сть до перенесення» має бути більшою за 0 і меншою за ${q} (для всього руху — залиште порожньою)`); return }
      const unit = byId.get(m.product_id)?.unit || 'шт'
      if (PIECE.test(unit) && !Number.isInteger(k)) { skip(line, `для одиниці «${unit}» кількість має бути цілою`); return }
      k = Math.round(k * 10000) / 10000
    }
    const doc = m.documents?.doc_number ? `№${m.documents.doc_number}` : (SRC[m.source] || '')
    if (k != null) {
      shift(m.product_id, m, -k, 1); shift(tKey(t), m, k, 1)
      parts.push({ kind: 'part', mov: m.id, src: m.product_id, srcName: byId.get(m.product_id)?.name, target: t, qty: k, was: q, type: m.type,
        doc: `${doc} ${dmy(movDate(m))}`.trim(), srcAfter: bal(m.product_id), tgtAfter: bal(tKey(t)) })
      return
    }
    const key = m.product_id + '→' + tKey(t)
    if (!whole.has(key)) whole.set(key, { kind: 'whole', src: m.product_id, srcName: byId.get(m.product_id)?.name, target: t, movs: [], inQty: 0, outQty: 0, aliases: [] })
    const op = whole.get(key)
    op.movs.push(m.id)
    if (m.type === 'in') op.inQty += q
    if (m.type === 'out') op.outQty += q
    shift(m.product_id, m, -q, 1); shift(tKey(t), m, q, 1)
  })
  const moves = [...whole.values(), ...parts].map(op => ({ ...op, leftStock: bal(op.src), tgtAfter: op.tgtAfter ?? bal(tKey(op.target)) }))

  // ── 4. Збірки ──
  const asmById = new Map(assemblies.map(a => [a.id, a]))
  const itemById = new Map(asmItems.map(it => [it.id, it]))
  const asmRowsBy = new Map()
  file.asmRows.forEach((r, i) => {
    const aid = String(r[H.asmId] || '').trim(); if (!aid) return
    if (!asmRowsBy.has(aid)) asmRowsBy.set(aid, [])
    asmRowsBy.get(aid).push({ r, line: `Збірки, рядок ${i + 2}` })
  })
  const asmOps = []
  for (const [aid, rows] of asmRowsBy) {
    const a = asmById.get(aid)
    const head = rows.find(x => String(x.r[H.role]).trim() === 'виріб')
    const where = head?.line || rows[0].line
    // що змінено
    const hq = head ? num(head.r[H.qty]) : null, hd = head ? head.r[H.asmDate] : '', hc = head ? String(head.r[H.asmCost] ?? '').trim() : ''
    const itemRows = rows.filter(x => x !== head)
    const anyEdit = (head && ((!blank(hd) && toISO(hd) !== toISO(head.r[H.snapDate])) || Number(hq) !== Number(num(head.r[H.snapQty]))
                    || (hc.toLowerCase() === 'авто' ? a?.manual_unit_cost != null : (hc === '' ? a?.manual_unit_cost != null : Number(num(hc)) !== Number(a?.manual_unit_cost)))))
      || itemRows.some(x => blank(x.r[H.lineId]) ? !blank(x.r[H.asmComp]) || !blank(x.r[H.qty]) : Number(num(x.r[H.qty])) !== Number(num(x.r[H.snapQty])))
    if (!anyEdit) continue
    if (!a) { skip(where, 'збірку не знайдено (не змінюйте «ID збірки»)'); continue }
    const am = movs.filter(m => m.assembly_id === aid)
    const inM = am.find(m => m.type === 'in' && m.source === 'assembly')
    if (!inM) { skip(where, 'стара збірка без складських рухів — змініть її в програмі (Склад → Збірки)'); continue }
    if (!head) { skip(where, 'немає рядка «виріб» цієї збірки'); continue }
    // змінено після вивантаження
    if (toISO(head.r[H.snapDate]) !== (a.assembled_at || undefined) || Number(num(head.r[H.snapQty])) !== Number(a.quantity)
        || itemRows.some(x => !blank(x.r[H.lineId]) && Number(num(x.r[H.snapQty])) !== Number(itemById.get(String(x.r[H.lineId]).trim())?.quantity))) {
      skip(where, CHANGED); continue
    }
    const date = blank(hd) ? a.assembled_at : toISO(hd)
    if (date === undefined) { skip(where, `«${hd}» — не дата`); continue }
    if (!(hq > 0)) { skip(where, 'кількість виробу має бути більшою за 0'); continue }
    if (isClosed(a.assembled_at) || isClosed(date)) { skip(where, 'закритий період'); continue }
    let manualMode = 'keep', manual = null
    if (hc.toLowerCase() === 'авто' || hc === '') { if (a.manual_unit_cost != null) manualMode = 'auto' }
    else { manual = num(hc); if (!(manual > 0)) { skip(where, `собівартість виробу «${hc}» — число більше 0, порожньо або «авто»`); continue } if (Number(manual) !== Number(a.manual_unit_cost)) manualMode = 'set' }
    // склад компонентів
    const cur = asmItems.filter(it => it.assembly_id === aid)
    let bad = false, changedItems = false
    const items = []
    for (const x of itemRows) {
      const lid = String(x.r[H.lineId] || '').trim()
      const q = num(x.r[H.qty])
      if (lid) {
        const it = itemById.get(lid)
        if (!it || it.assembly_id !== aid) { skip(x.line, 'рядок збірки не знайдено'); bad = true; break }
        if (!(q >= 0)) { skip(x.line, 'к-сть — число від 0'); bad = true; break }
        if (Number(q) !== Number(it.quantity)) changedItems = true
        items.push({ item_id: lid, product_id: it.product_id, qty: q })
      } else {
        if (blank(x.r[H.asmComp]) && blank(x.r[H.qty])) continue
        const t = resolveTarget(x.r[H.asmComp], prodAfter, { allowNew: false })
        if (!t || t.error) { skip(x.line, t?.error || 'вкажіть «Картка компонента»'); bad = true; break }
        if (!(q > 0)) { skip(x.line, 'к-сть нового компонента — більше 0'); bad = true; break }
        changedItems = true
        items.push({ item_id: null, product_id: t.id, qty: q })
      }
    }
    if (bad) continue
    // рядки, яких немає у файлі, лишаються як є
    for (const it of cur) if (!items.some(x => x.item_id === it.id)) items.push({ item_id: it.id, product_id: it.product_id, qty: Number(it.quantity) })
    const warnings = []
    // нестача компонента на дату збірки (без рухів самої збірки)
    for (const it of items.filter(x => x.qty > 0)) {
      const avail = movs.filter(m => m.product_id === it.product_id && m.assembly_id !== aid && (m.date || '') <= date)
        .reduce((s, m) => s + (m.type === 'in' ? 1 : m.type === 'out' ? -1 : 0) * (Number(m.quantity) || 0), 0)
      if (avail < it.qty - 0.00001) warnings.push(`⚠ нестача «${byId.get(it.product_id)?.name}» на ${dmy(date)}: потрібно ${r2(it.qty)}, є ${r2(Math.max(avail, 0))}`)
    }
    // було / стане (≈ — точну рахує сервер за FIFO)
    const oldUnit = r2(Number(inM.cost_price) || Number(inM.price))
    const avgIn = (pid) => { const ins = movs.filter(m => m.product_id === pid && m.type === 'in' && m.assembly_id !== aid); const q = ins.reduce((s, m) => s + (Number(m.quantity) || 0), 0); return q ? ins.reduce((s, m) => s + (Number(m.quantity) || 0) * (Number(m.price) || 0), 0) / q : 0 }
    const unitOf = (pid) => { const c = cur.find(x => x.product_id === pid); return c && Number(c.cost_price) > 0 ? Number(c.cost_price) : avgIn(pid) }
    const compSum = items.reduce((s, it) => s + it.qty * unitOf(it.product_id), 0)
    const estAuto = r2(compSum / hq)
    const effManual = manualMode === 'set' ? manual : manualMode === 'auto' ? null : a.manual_unit_cost
    const estUnit = effManual != null ? Number(effManual) : estAuto
    if (effManual != null && estAuto > 0 && Math.abs(effManual - estAuto) / estAuto > 0.01) warnings.push(`⚠ ручна собівартість ${r2(effManual)} відрізняється від суми компонентів ≈${estAuto} на ${r2(effManual - estAuto)} грн/од`)
    // виріб уже продано → зміниться собівартість у документах
    const sold = asmAlloc.filter(x => x.in_movement_id === inM.id).map(x => movById.get(x.out_movement_id)).filter(Boolean)
    const soldDocs = [...new Set(sold.map(m => m.documents?.doc_number || '(без номера)'))]
    if (soldDocs.length && Math.abs(estUnit - oldUnit) > 0.005) warnings.push(`виріб уже продано — після «Застосувати FIFO» зміниться собівартість у ${soldDocs.join(', ')}`)
    asmOps.push({ id: aid, name: byId.get(a.result_product_id)?.name || a.name, date: a.assembled_at, newDate: date !== a.assembled_at ? date : null,
      qty: Number(a.quantity), newQty: Number(hq) !== Number(a.quantity) ? hq : null,
      items: changedItems ? items.map(x => ({ item_id: x.item_id, product_id: x.product_id, qty: x.qty })) : null,
      itemsView: changedItems ? items.map(x => ({ name: byId.get(x.product_id)?.name, qty: x.qty, was: x.item_id ? Number(itemById.get(x.item_id)?.quantity) : null })) : null,
      manualMode, manual, oldUnit, estUnit, warnings })
  }

  // ── 5. Синоніми ──
  const groups = aliasGroups(aliases.filter(a => byId.has(a.product_id)))
  const dedupe = []
  for (const list of groups.values()) if (list.length > 1) dedupe.push({ card: byId.get(list[0].product_id)?.name, alias: list[0].alias, ids: list.slice(1).map(a => a.id) })
  const aliasDeletes = [], aliasMoves = new Map()
  file.alRows.forEach((r, i) => {
    const text = String(r[H.move] ?? '').trim(); if (!text) return
    const line = `Синоніми, рядок ${i + 2}`
    const pid = String(r[H.cardId] || '').trim()
    const list = groups.get(pid + '|' + aliasNorm(r[H.alias]))
    if (!list) { skip(line, `синонім «${r[H.alias]}» на цій картці не знайдено`); return }
    const p = byId.get(pid)
    if (text.toLowerCase() === 'видалити') {
      const same = (s) => norm(s) === norm(p?.name)
      if (same(list[0].alias) && ![...groups.values()].some(l => l !== list && l[0].product_id === pid && same(l[0].alias))) {
        skip(line, 'останній синонім, що збігається з назвою картки, видалити не можна'); return
      }
      aliasDeletes.push({ card: p?.name, alias: list[0].alias, ids: list.map(a => a.id) })
      return
    }
    const t = resolveTarget(text, prodAfter)
    if (t.error) { skip(line, t.error); return }
    if (t.id === pid) return
    const key = pid + '→' + tKey(t)
    if (!aliasMoves.has(key)) aliasMoves.set(key, { kind: 'alias', src: pid, srcName: p?.name, target: t, movs: [], aliases: [] })
    aliasMoves.get(key).aliases.push(list[0].alias)
  })

  const plan = { cards, docs: docOps, moves, assemblies: asmOps, aliases: { dedupe, deletes: aliasDeletes, moves: [...aliasMoves.values()] }, errors }
  plan.count = cards.reduce((s, c) => s + (c.sku ? 1 : 0) + (c.rename ? 1 : 0) + (Object.keys(c.ch).length ? 1 : 0), 0)
    + docOps.length + moves.length + asmOps.length + (dedupe.length ? 1 : 0) + aliasDeletes.length + aliasMoves.size
  // сумісність зі старим інтерфейсом
  plan.ops = moves; plan.cardChanges = cards.filter(c => Object.keys(c.ch).length)
  return plan
}

const errText = (error) => error && (error.code === 'PGRST202' ? 'Міграцію 088 ще не застосовано' : String(error.message || '').replace(/^[A-Z_]+:\s*/, ''))

// Застосування: картки → документи → рухи → збірки → синоніми. Нова картка з тією самою назвою створюється один раз.
export async function applyPlan(plan, onStep = () => {}) {
  const created = new Map(), results = []
  const push = (r) => { results.push(r); onStep(r) }
  const targetArgs = (t) => {
    const nk = t.newName ? norm(t.newName) : null
    const id = t.id || (nk && created.get(nk)) || null
    return { id, nk, args: { p_target: id, p_new_name: id ? null : t.newName, p_new_sku: id ? null : (t.newSku || null) } }
  }
  for (const c of plan.cards) {
    if (c.sku) { const { error } = await supabase.rpc('product_fix', { p_id: c.id, p_sku: c.sku.to ?? '', p_name: null, p_alias_norm: null }); push({ kind: 'card', what: 'sku', item: c, ok: !error, error: errText(error) }) }
    if (c.rename) { const { error } = await supabase.rpc('product_fix', { p_id: c.id, p_sku: null, p_name: c.rename.to, p_alias_norm: c.rename.aliasNorm }); push({ kind: 'card', what: 'name', item: c, ok: !error, error: errText(error) }) }
    if (Object.keys(c.ch).length) { const { error } = await supabase.from('products').update(c.ch).eq('id', c.id); push({ kind: 'card', what: 'type', item: c, ok: !error, error: error?.message }) }
  }
  for (const d of plan.docs) {
    const { data, error } = await supabase.rpc('doc_fix', { p_doc: d.id, p_date: d.newDate, p_number: d.newNumber, p_order: d.order, p_clear_order: !!d.clearOrder, p_align: !!d.align })
    push({ kind: 'doc', item: d, ok: !error, error: errText(error), data })
  }
  for (const op of plan.moves) {
    const t = targetArgs(op.target)
    const { data, error } = op.kind === 'part'
      ? await supabase.rpc('split_movement', { p_mov: op.mov, p_qty: op.qty, ...t.args })
      : await supabase.rpc('split_product', { p_src: op.src, p_movs: op.movs, ...t.args, p_aliases: op.aliases || [] })
    if (!error && t.nk && data?.created) created.set(t.nk, data.target)
    push({ kind: 'move', item: op, ok: !error, error: errText(error), data })
  }
  for (const a of plan.assemblies) {
    const { data, error } = await supabase.rpc('assembly_fix', { p_asm: a.id, p_date: a.newDate, p_qty: a.newQty, p_items: a.items, p_manual_mode: a.manualMode, p_manual: a.manual })
    push({ kind: 'asm', item: a, ok: !error, error: errText(error), data })
  }
  const dupIds = plan.aliases.dedupe.flatMap(x => x.ids)
  if (dupIds.length) { const { data, error } = await supabase.rpc('alias_delete', { p_ids: dupIds }); push({ kind: 'alias', what: 'dedupe', item: { count: dupIds.length }, ok: !error, error: errText(error), data }) }
  for (const x of plan.aliases.deletes) { const { error } = await supabase.rpc('alias_delete', { p_ids: x.ids }); push({ kind: 'alias', what: 'delete', item: x, ok: !error, error: errText(error) }) }
  for (const op of plan.aliases.moves) {
    const t = targetArgs(op.target)
    const { data, error } = await supabase.rpc('split_product', { p_src: op.src, p_movs: [], ...t.args, p_aliases: op.aliases })
    if (!error && t.nk && data?.created) created.set(t.nk, data.target)
    push({ kind: 'alias', what: 'move', item: op, ok: !error, error: errText(error), data })
  }
  return results
}

// ── журнал виправлень (скасування) ──
export const FIX_ACTIONS = ['split', 'split_qty', 'product_sku', 'product_rename', 'doc_fix', 'assembly_fix', 'alias_delete']
const ACTION_LABEL = { split: 'перенесення', split_qty: 'поділ руху', product_sku: 'артикул', product_rename: 'назва', doc_fix: 'документ', assembly_fix: 'збірка', alias_delete: 'синоніми видалено' }
export async function loadFixJournal({ productId = null, limit = 200 } = {}) {
  const { data } = await supabase.from('cost_action_log').select('id, created_at, action, document_id, line, before, after')
    .in('action', [...FIX_ACTIONS, 'split_undo', 'fix_undo']).order('created_at', { ascending: false }).limit(limit)
  const rows = data || []
  const undone = new Set(rows.filter(r => r.action === 'split_undo').map(r => r.before?.split_log).concat(rows.filter(r => r.action === 'fix_undo').map(r => r.before?.log)))
  // поділ руху скасовується цілком — його внутрішнє перенесення окремо не показуємо
  const inner = new Set(rows.filter(r => r.action === 'split_qty').map(r => r.after?.split_log))
  return rows.filter(r => FIX_ACTIONS.includes(r.action) && !undone.has(r.id) && !inner.has(r.id))
    .filter(r => !productId || r.line === productId || String(r.line || '').split(',').includes(productId)
      || r.before?.src?.id === productId || r.before?.target === productId || r.before?.assembly?.result_product_id === productId)
}
export function describeFix(r) {
  const b = r.before || {}, a = r.after || {}
  const L = ACTION_LABEL[r.action] || r.action
  switch (r.action) {
    case 'split': return `${L}: з «${b.src?.name}» — рухів ${(a.stock_movements || []).length}, синонімів ${(a.product_aliases || []).length}${b.created ? ' (нова картка)' : ''}`
    case 'split_qty': return `${L}: ${b.qty} → лишилось ${r2(b.qty - a.moved_qty)}, перенесено ${a.moved_qty}`
    case 'product_sku': return `${L}: ${b.sku || '—'} → ${a.sku || '—'}`
    case 'product_rename': return `${L}: «${b.name}» → «${a.name}»`
    case 'doc_fix': return `${L} ${b.doc_number || ''}: ${b.doc_date !== a.doc_date ? `дата ${dmy(b.doc_date)} → ${dmy(a.doc_date)}; ` : ''}${b.doc_number !== a.doc_number ? `номер ${b.doc_number} → ${a.doc_number}; ` : ''}${(b.day_order ?? null) !== (a.day_order ?? null) ? `порядок ${b.day_order ?? '—'} → ${a.day_order ?? '—'}` : ''}`
    case 'assembly_fix': return `${L} «${b.assembly?.name || ''}»: ${dmy(b.assembly?.assembled_at)} → ${dmy(a.date)}, собівартість ${r2(a.old_unit)} → ${r2(a.unit_cost)}`
    case 'alias_delete': return `${L}: ${(b.aliases || []).map(x => `«${x.alias}»`).join(', ')}`
    default: return L
  }
}
export async function undoFix(logId) {
  const { error } = await supabase.rpc('stock_fix_undo', { p_log: logId })
  return { ok: !error, error: errText(error) }
}

import * as XLSX from 'xlsx'
import { supabase } from './supabase'

// Прайс-листи постачальників — довідковий шар, ОКРЕМО від складу.
// Excel читається в браузері, рядки пишуться в supplier_prices.

// Поля, які мапимо на колонки Excel (індекси)
export const FIELDS = [
  { key: 'name', label: 'Найменування', required: true },
  { key: 'sku', label: 'Артикул / Код' },
  { key: 'uktzed', label: 'Код УКТЗД (ТН ЗЕД)' },
  { key: 'brand', label: 'Виробник / Бренд' },
  { key: 'category', label: 'Категорія' },
  { key: 'unit', label: 'Одиниця' },
  { key: 'price', label: 'Ціна закупівлі (Дилер)' },
  { key: 'retail_price', label: 'Ціна продажу (роздріб, грн)' },
  { key: 'warranty', label: 'Гарантія' },
  { key: 'warranty_term', label: 'Тип / термін гарантії' },
  { key: 'in_stock', label: 'Наявність' },
]

// Ключові слова для авто-визначення колонок за заголовком
const HINTS = {
  name: /найменув|назва|товар|опис|product|name/i,
  sku: /код|артикул|sku|partnumber|p\/n|part/i,
  uktzed: /уктзед|укт\s?зед|тн\s?зед|тнзед|hs.?code/i,
  brand: /виробник|бренд|brand|manufact|vendor/i,
  category: /^категор/i,
  unit: /одиниц|вимір|unit|^од\.?$/i,
  price: /собівар|закуп|опт|cost|дилер|dealer/i,
  retail_price: /роздріб|retail|^ціна$|rrp/i,
  warranty: /^гарант/i,
  warranty_term: /терм.*гар|гар.*терм|термін/i,
  in_stock: /кіл-ть|кільк|наявн|залиш|stock|qty|склад|avail/i,
}

// Режими визначення валюти ціни закупівлі
export const CURRENCY_MODES = [
  { key: 'uah', label: 'Уся ціна в грн' },
  { key: 'usd', label: 'Уся ціна в USD (× курс)' },
  { key: 'column', label: 'За колонкою у файлі' },
]
export const CURRENCY_RULES = [
  { key: 'one_is_uah', label: '1 = грн, 0/порожньо = USD (ERC: DDP)' },
  { key: 'one_is_usd', label: '1 = USD, 0/порожньо = грн' },
  { key: 'text', label: 'Текст: USD/$/840 → долар, інакше грн' },
]

// Авто-визначення режиму валюти за заголовками
export function guessCurrency(headers = []) {
  const ddp = headers.findIndex(h => /^ddp$/i.test(String(h || '')))
  if (ddp >= 0) return { mode: 'column', col: ddp, rule: 'one_is_uah' }
  const cur = headers.findIndex(h => /валюта|currency/i.test(String(h || '')))
  if (cur >= 0) return { mode: 'column', col: cur, rule: 'text' }
  return { mode: 'uah', col: null, rule: 'text' }
}

function rowCurrency(r, { mode, col, rule }) {
  if (mode === 'uah') return 'UAH'
  if (mode === 'usd') return 'USD'
  const v = String(col != null ? r[col] : '').trim()
  if (rule === 'one_is_uah') return (v === '1' || /^(так|yes|true)$/i.test(v)) ? 'UAH' : 'USD'
  if (rule === 'one_is_usd') return (v === '1' || /^(так|yes|true)$/i.test(v)) ? 'USD' : 'UAH'
  return /usd|\$|840|дол/i.test(v) ? 'USD' : 'UAH'
}

// Парсинг файлу → масив рядків (AoA), row[0] = заголовки
export async function parsePriceFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 1251, cellText: true, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
}

// Авто-мапінг колонок за рядком заголовків (повертає { field: colIndex })
export function guessMapping(headers = []) {
  const map = {}
  const used = new Set()
  for (const f of FIELDS) {
    const hint = HINTS[f.key]
    if (!hint) continue
    const idx = headers.findIndex((h, i) => !used.has(i) && hint.test(String(h || '')))
    if (idx >= 0) { map[f.key] = idx; used.add(idx) }
  }
  return map
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()

export function num(v) {
  if (v == null || v === '') return null
  const s = String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

// Імпорт: заміщує попередній прайс цього постачальника новим набором рядків.
// usdRate — курс USD→UAH; vatRate — ставка ПДВ (% на весь файл);
// currency — { mode, col, rule } для визначення валюти ціни закупівлі.
// onProgress(done, total) — для індикатора.
export async function importPriceList({ supplierId, fileName, map, headerRow, rows, userId, usdRate, vatRate, currency, defaultUnit }, onProgress) {
  const dataRows = rows.slice(headerRow + 1)
  const col = (r, key) => (map[key] != null ? r[map[key]] : undefined)
  const rate = Number(usdRate) || null
  const vat = vatRate === '' || vatRate == null ? null : Number(vatRate)
  const cur = currency || { mode: 'uah' }
  const defUnit = (defaultUnit || '').trim() || null

  const prepared = dataRows.map(r => {
    const orig = map.price != null ? num(col(r, 'price')) : null
    const ccy = orig != null ? rowCurrency(r, cur) : 'UAH'
    const priceUah = orig == null ? null : (ccy === 'USD' && rate ? Math.round(orig * rate * 100) / 100 : orig)
    return {
      name: decode(col(r, 'name')),
      sku: map.sku != null ? decode(col(r, 'sku')) || null : null,
      uktzed: map.uktzed != null ? decode(col(r, 'uktzed')) || null : null,
      brand: map.brand != null ? decode(col(r, 'brand')) || null : null,
      category: map.category != null ? decode(col(r, 'category')) || null : null,
      unit: (map.unit != null ? decode(col(r, 'unit')) : '') || defUnit,
      price_original: orig,
      currency: ccy,
      price: priceUah,
      retail_price: map.retail_price != null ? num(col(r, 'retail_price')) : null,
      vat_rate: vat,
      warranty: map.warranty != null ? decode(col(r, 'warranty')) || null : null,
      warranty_term: map.warranty_term != null ? decode(col(r, 'warranty_term')) || null : null,
      in_stock: map.in_stock != null ? decode(col(r, 'in_stock')) || null : null,
    }
  }).filter(r => r.name)

  // 1. Новий запис імпорту
  const { data: pl, error: plErr } = await supabase.from('supplier_price_lists').insert({
    supplier_id: supplierId, file_name: fileName, usd_rate: rate, vat_rate: vat,
    column_map: { ...map, headerRow, currency: cur, defaultUnit: defUnit }, imported_by: userId || null,
  }).select('id').single()
  if (plErr) throw plErr

  // 2. Прибрати попередні прайси цього постачальника (cascade зніме їхні рядки)
  await supabase.from('supplier_price_lists').delete().eq('supplier_id', supplierId).neq('id', pl.id)

  // 3. Вставити рядки чанками
  const CHUNK = 1000
  let done = 0
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const batch = prepared.slice(i, i + CHUNK).map(r => ({ ...r, price_list_id: pl.id, supplier_id: supplierId }))
    const { error } = await supabase.from('supplier_prices').insert(batch)
    if (error) throw error
    done += batch.length
    onProgress?.(done, prepared.length)
  }

  await supabase.from('supplier_price_lists').update({ rows_count: prepared.length }).eq('id', pl.id)
  return { count: prepared.length }
}

// Останній імпорт по кожному постачальнику (для прев'ю стану + переюзу мапінгу)
export async function loadPriceListMeta() {
  const { data } = await supabase.from('supplier_price_lists')
    .select('id, supplier_id, file_name, rows_count, column_map, usd_rate, vat_rate, imported_at, contractors(name)')
    .order('imported_at', { ascending: false })
  return data || []
}

// Пошук по всіх прайсах (за назвою/артикулом), відсортовано за ціною
export async function searchPrices(q, { limit = 80 } = {}) {
  const term = q.trim()
  if (!term) return []
  const esc = term.replace(/[%,]/g, ' ')
  const { data } = await supabase.from('supplier_prices')
    .select('id, sku, uktzed, name, brand, category, unit, price, price_original, currency, vat_rate, retail_price, warranty, warranty_term, in_stock, contractors(name)')
    .or(`name.ilike.%${esc}%,sku.ilike.%${esc}%`)
    .order('price', { ascending: true, nullsFirst: false })
    .limit(limit)
  return data || []
}

// Синхронізація прайсу постачальника BRAIN (api.brain.com.ua) → таблиця supplier_prices.
// Метод: /products по обраних категоріях (відома структура полів). Категорії обирає користувач у UI.
//
// Дії (body.action або ?action=):
//   'categories'      → список категорій Brain (для чекбоксів) + поточний вибір
//   'save_categories' → зберегти обрані категорії ({ categoryIds: [...] })
//   'sync' (default)  → синхронізувати товари обраних категорій у supplier_prices
//
// Brain API:
//   POST /auth (login + md5(password))            → SID
//   GET  /categories/{SID}?lang=ua                → дерево категорій
//   GET  /vendors/{SID}?lang=ua                   → виробники (vendorID→name)
//   GET  /products/{categoryID}/{SID}?lang=ua&limit=100&offset=N → товари категорії (з price_uah, articul, stocks…)
//
// Env: BRAIN_LOGIN, BRAIN_PASSWORD, BRAIN_SUPPLIER_ID (опц.), BRAIN_SUPPLIER_NAME ('Brain'), CRON_SECRET
import crypto from 'crypto'
import { getAdmin, verifyUser } from './_lib.js'

export const config = { maxDuration: 300 } // дати функції більше часу на синк великих категорій

const BASE = 'http://api.brain.com.ua'
const PAGE = 100              // ліміт сторінки /products для звичайних акаунтів
const MAX_PAGES = 200        // запобіжник на категорію (200×100 = 20k товарів)
const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex')

async function authorize(req) {
  const auth = req.headers['authorization'] || ''
  const secret = process.env.CRON_SECRET
  if (secret && auth === `Bearer ${secret}`) return true
  return !!(await verifyUser(req))
}

async function brainAuth() {
  const login = process.env.BRAIN_LOGIN
  const password = process.env.BRAIN_PASSWORD
  if (!login || !password) throw new Error('BRAIN_LOGIN / BRAIN_PASSWORD не налаштовано у Vercel env')
  const r = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ login, password: md5(password) }),
  })
  const j = await r.json().catch(() => ({}))
  if (j.status !== 1 || !j.result) throw new Error('Brain /auth відмовив: ' + JSON.stringify(j).slice(0, 300))
  return j.result
}

async function brainJson(path) {
  const r = await fetch(`${BASE}${path}`)
  return r.json().catch(() => ({}))
}

async function getCategories(sid) {
  const j = await brainJson(`/categories/${sid}?lang=ua`)
  return Array.isArray(j.result) ? j.result : []
}

async function getVendorsMap(sid) {
  const j = await brainJson(`/vendors/${sid}?lang=ua`)
  const arr = Array.isArray(j.result) ? j.result : []
  const map = {}
  for (const v of arr) {
    const id = v.vendorID ?? v.id
    const name = v.name ?? v.vendor ?? v.title
    if (id != null && name) map[String(id)] = String(name)
  }
  return map
}

const pick = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (v != null && v !== '') return v } return null }
const num = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : null }
function stockStr(o) {
  let total = 0
  if (Array.isArray(o?.stocks)) total += o.stocks.reduce((a, x) => a + (num(x) || 0), 0)
  if (o?.available && typeof o.available === 'object') total += Object.values(o.available).reduce((a, x) => a + (num(x) || 0), 0)
  const direct = pick(o, ['in_stock', 'count', 'quantity'])
  if (!total && direct != null) return String(direct).slice(0, 60)
  return total > 0 ? `${total}` : null
}

function mapProduct(o, vendors, catName, supplierId, priceListId) {
  const name = String(pick(o, ['name', 'title', 'brief_description']) ?? '').trim().slice(0, 500)
  if (!name) return null
  const vId = pick(o, ['vendorID', 'vendor_id', 'vendor'])
  const brand = vId != null ? (vendors[String(vId)] || String(vId)) : null
  const skuRaw = pick(o, ['articul', 'product_code', 'productID', 'id'])
  return {
    price_list_id: priceListId,
    supplier_id: supplierId,
    sku: skuRaw == null ? null : String(skuRaw).slice(0, 120),
    name,
    brand: brand ? String(brand).slice(0, 200) : null,
    category: catName ? String(catName).slice(0, 200) : null,
    unit: 'шт',
    price: num(pick(o, ['price_uah', 'priceUAH', 'price'])),
    retail_price: num(pick(o, ['retail_price_uah', 'recommendable_price', 'retail_price'])),
    in_stock: stockStr(o),
  }
}

// /products повертає товари категорії РАЗОМ з усіма підкатегоріями — обходити дочірні окремо не треба
async function fetchCategoryProducts(sid, categoryID, vendors, catName, supplierId, priceListId, out) {
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await brainJson(`/products/${categoryID}/${sid}?lang=ua&limit=${PAGE}&offset=${page * PAGE}`)
    const list = j?.result?.list || (Array.isArray(j?.result) ? j.result : [])
    if (!Array.isArray(list) || !list.length) break
    for (const o of list) { const m = mapProduct(o, vendors, catName, supplierId, priceListId); if (m) out.push(m) }
    const count = Number(j?.result?.count) || 0
    if (list.length < PAGE || (count && (page + 1) * PAGE >= count)) break
  }
}

// Живий пошук: по обраних категоріях (або по кореневих, якщо нічого не обрано)
async function searchProducts(sid, query, categoryIDs, vendors, supplierId, priceListId) {
  const out = []
  const seen = new Set()
  const search = encodeURIComponent(query)
  for (const cid of categoryIDs) {
    if (out.length >= 300) break
    const j = await brainJson(`/products/${cid}/${sid}?lang=ua&limit=100&search=${search}`)
    const list = j?.result?.list || (Array.isArray(j?.result) ? j.result : [])
    for (const o of list) {
      const key = String(o.productID ?? o.articul ?? o.name)
      if (seen.has(key)) continue
      seen.add(key)
      const m = mapProduct(o, vendors, null, supplierId, priceListId)
      if (m) out.push(m)
    }
  }
  return out
}

async function resolveSupplier(admin) {
  const id = process.env.BRAIN_SUPPLIER_ID
  if (id) return id
  const name = process.env.BRAIN_SUPPLIER_NAME || 'Brain'
  const { data: found } = await admin.from('contractors').select('id').ilike('name', `%${name}%`).eq('is_supplier', true).limit(1).maybeSingle()
  if (found?.id) return found.id
  const { data: created, error } = await admin.from('contractors').insert({ name, is_supplier: true }).select('id').single()
  if (error) throw new Error('Не вдалося знайти/створити контрагента Brain: ' + error.message)
  return created.id
}

// price_list-рядок для джерела brain_api (один на постачальника)
async function ensureList(admin, supplierId) {
  const { data } = await admin.from('supplier_price_lists')
    .select('id, categories').eq('supplier_id', supplierId).eq('source', 'brain_api').limit(1).maybeSingle()
  if (data?.id) return data
  const { data: created, error } = await admin.from('supplier_price_lists')
    .insert({ supplier_id: supplierId, file_name: 'Brain API', source: 'brain_api', rows_count: 0 })
    .select('id, categories').single()
  if (error) throw new Error('price_list insert: ' + error.message)
  return created
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!(await authorize(req))) return res.status(401).json({ error: 'Unauthorized' })

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const action = body.action || req.query?.action || 'sync'

  try {
    const admin = getAdmin()
    const supplierId = await resolveSupplier(admin)
    const list = await ensureList(admin, supplierId)

    if (action === 'save_categories') {
      const ids = Array.isArray(body.categoryIds) ? body.categoryIds.map(String) : []
      const { error } = await admin.from('supplier_price_lists').update({ categories: ids }).eq('id', list.id)
      if (error) throw new Error('save_categories: ' + error.message)
      return res.status(200).json({ ok: true, saved: ids.length })
    }

    if (action === 'categories') {
      const sid = await brainAuth()
      const cats = await getCategories(sid)
      return res.status(200).json({
        ok: true,
        categories: cats.map(c => ({ id: String(c.categoryID), parentID: String(c.parentID), name: c.name })),
        selected: Array.isArray(list.categories) ? list.categories.map(String) : [],
      })
    }

    if (action === 'search') {
      const q = (body.query || '').trim()
      if (q.length < 2) return res.status(200).json({ ok: true, results: [] })
      const sid = await brainAuth()
      const [allCats, vendors] = await Promise.all([getCategories(sid), getVendorsMap(sid)])
      const selected = Array.isArray(list.categories) ? list.categories.map(String) : []
      const cats = selected.length ? selected : allCats.filter(c => String(c.parentID) === '1').map(c => String(c.categoryID))
      const results = await searchProducts(sid, q, cats, vendors, supplierId, list.id)
      return res.status(200).json({ ok: true, results, priceListId: list.id, supplierId, scope: selected.length ? 'selected' : 'all' })
    }

    // ── sync (масове завантаження обраних категорій разом з підкатегоріями) ──
    const selected = Array.isArray(list.categories) ? list.categories.map(String) : []
    if (!selected.length) return res.status(200).json({ ok: true, count: 0, note: 'Оберіть категорії для завантаження (кнопка «Категорії»).' })

    const sid = await brainAuth()
    const [allCats, vendors] = await Promise.all([getCategories(sid), getVendorsMap(sid)])
    const nameById = {}; allCats.forEach(c => { nameById[String(c.categoryID)] = c.name })

    const mapped = []
    for (const cid of selected) {
      await fetchCategoryProducts(sid, cid, vendors, nameById[cid] || null, supplierId, list.id, mapped)
    }

    // Перезапис прайсу
    await admin.from('supplier_prices').delete().eq('price_list_id', list.id)
    let inserted = 0
    for (let i = 0; i < mapped.length; i += 500) {
      const chunk = mapped.slice(i, i + 500)
      const { error } = await admin.from('supplier_prices').insert(chunk)
      if (error) throw new Error(`insert chunk @${i}: ${error.message}`)
      inserted += chunk.length
    }
    await admin.from('supplier_price_lists').update({ rows_count: inserted, imported_at: new Date().toISOString() }).eq('id', list.id)

    return res.status(200).json({ ok: true, count: inserted, categoriesFetched: toFetch.length })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

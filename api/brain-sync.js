// Синхронізація прайсу постачальника BRAIN (api.brain.com.ua) → таблиці supplier_prices.
// Тригери: кнопка «Оновити з API» в UI (Bearer supabase-token) АБО Cron (Bearer CRON_SECRET).
//
// Послідовність Brain API:
//   1) POST /auth  (login + md5(password))                 → SID
//   2) GET  /pricelists/{targetID}/json/{SID}?lang=ua&full=1 → { url } (лінк на повний прайс одним файлом)
//   3) GET  {url}                                            → JSON з переліком товарів
//   4) мапимо рядки й перезаписуємо supplier_prices для контрагента-Brain.
//
// Env у Vercel:
//   BRAIN_LOGIN, BRAIN_PASSWORD  — обліковий запис дилерського кабінету (менеджер/адмін)
//   BRAIN_TARGET_ID              — точка отримання (distribution point); за замовч. 0
//   BRAIN_SUPPLIER_ID            — contractors.id постачальника Brain (опц.; інакше пошук/створення за назвою)
//   BRAIN_SUPPLIER_NAME          — назва для пошуку/створення контрагента (за замовч. 'Brain')
//   CRON_SECRET                  — для виклику з Cron
import crypto from 'crypto'
import { getAdmin, verifyUser } from './_lib.js'

const BASE = 'http://api.brain.com.ua'
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
  const body = new URLSearchParams({ login, password: md5(password) })
  const r = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const j = await r.json().catch(() => ({}))
  if (j.status !== 1 || !j.result) throw new Error('Brain /auth відмовив: ' + JSON.stringify(j).slice(0, 300))
  return j.result // SID
}

async function brainPricelist(sid) {
  const target = process.env.BRAIN_TARGET_ID || '0'
  const r = await fetch(`${BASE}/pricelists/${target}/json/${sid}?lang=ua&full=1`)
  const j = await r.json().catch(() => ({}))
  if (j.status !== 1 || !j.url) throw new Error('Brain /pricelists відмовив: ' + JSON.stringify(j).slice(0, 300))
  const fileRes = await fetch(j.url)
  const data = await fileRes.json().catch(async () => {
    const t = await fileRes.text().catch(() => '')
    throw new Error('Не вдалося розпарсити прайс-файл як JSON: ' + t.slice(0, 200))
  })
  // Файл може бути масивом або обгорткою { result | list | products | data: [...] }
  const rows = Array.isArray(data) ? data
    : data.result?.list || data.result || data.list || data.products || data.data || []
  return Array.isArray(rows) ? rows : []
}

const pick = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (v != null && v !== '') return v } return null }
const num = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : null }

function stockStr(o) {
  const direct = pick(o, ['in_stock', 'count', 'quantity', 'qty'])
  if (direct != null) return String(direct).slice(0, 60)
  let total = 0
  const s = o?.stocks
  if (Array.isArray(s)) total += s.reduce((a, x) => a + (num(x) || 0), 0)
  const av = o?.available
  if (av && typeof av === 'object') total += Object.values(av).reduce((a, x) => a + (num(x) || 0), 0)
  return total > 0 ? `${total}` : null
}

function mapRow(o, supplierId, priceListId) {
  const name = String(pick(o, ['name', 'title', 'brief_description']) ?? '').trim().slice(0, 500)
  if (!name) return null
  const brand = pick(o, ['vendor', 'brand', 'vendor_name', 'producer', 'manufacturer'])
  const cat = pick(o, ['category', 'category_name', 'group', 'categoryName'])
  return {
    price_list_id: priceListId,
    supplier_id: supplierId,
    sku: (() => { const v = pick(o, ['articul', 'article', 'product_code', 'code', 'productID', 'id']); return v == null ? null : String(v).slice(0, 120) })(),
    name,
    brand: brand == null ? null : String(brand).slice(0, 200),
    category: cat == null ? null : String(cat).slice(0, 200),
    unit: String(pick(o, ['unit', 'units']) ?? 'шт').slice(0, 40),
    price: num(pick(o, ['price_uah', 'priceUAH', 'price', 'dealer_price', 'dealerPrice'])),
    retail_price: num(pick(o, ['retail_price_uah', 'recommendable_price', 'rrp', 'retail_price', 'retailPrice'])),
    in_stock: stockStr(o),
  }
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

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!(await authorize(req))) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const admin = getAdmin()
    const supplierId = await resolveSupplier(admin)

    const sid = await brainAuth()
    const raw = await brainPricelist(sid)
    if (!raw.length) return res.status(200).json({ ok: true, count: 0, note: 'Прайс порожній або невідома структура файлу' })

    // price_list-рядок для джерела brain_api (один на постачальника)
    let { data: list } = await admin.from('supplier_price_lists')
      .select('id').eq('supplier_id', supplierId).eq('source', 'brain_api').limit(1).maybeSingle()
    if (!list?.id) {
      const { data: created, error } = await admin.from('supplier_price_lists')
        .insert({ supplier_id: supplierId, file_name: 'Brain API', source: 'brain_api', rows_count: 0 })
        .select('id').single()
      if (error) throw new Error('price_list insert: ' + error.message)
      list = created
    }
    const priceListId = list.id

    const mapped = raw.map(o => mapRow(o, supplierId, priceListId)).filter(Boolean)

    // Перезапис: прибрати старі рядки цього прайсу, вставити свіжі чанками
    await admin.from('supplier_prices').delete().eq('price_list_id', priceListId)
    let inserted = 0
    for (let i = 0; i < mapped.length; i += 500) {
      const chunk = mapped.slice(i, i + 500)
      const { error } = await admin.from('supplier_prices').insert(chunk)
      if (error) throw new Error(`insert chunk @${i}: ${error.message}`)
      inserted += chunk.length
    }
    await admin.from('supplier_price_lists').update({ rows_count: inserted, imported_at: new Date().toISOString() }).eq('id', priceListId)

    return res.status(200).json({
      ok: true, count: inserted,
      sampleKeys: Object.keys(raw[0] || {}).slice(0, 40), // діагностика мапінгу при першому запуску
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

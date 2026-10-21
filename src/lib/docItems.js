// Товарні рядки документа продажу (видаткова/акт) для звітів по дебіторці.
// Джерела: згенерований документ (generated_docs.items — ціни без ПДВ + vatRate) або розпізнаний
// (documents.ocr_data.items — база цін невідома, тому обираємо ту, що сходиться із сумою документа).
// Рядки повертаються З ПДВ; копійчана розбіжність округлення (≤1 грн) докладається в останній рядок,
// щоб сума рядків = сума документа. Більша розбіжність — позначка mismatch (лише у внутрішньому звіті).
import { supabase } from './supabase'

const n = (v) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : 0 }
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100

const parseItems = (raw) => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { const x = JSON.parse(raw); return Array.isArray(x) ? x : [] } catch { return [] }
}

// Рядки у двох базах: як записано (asIs) і з ПДВ поверх (plusVat)
function normalize(items) {
  return items.filter(it => (it?.name || '').trim()).map(it => {
    const q = n(it.quantity ?? it.qty) || 0
    const price = n(it.unitPrice ?? it.unit_price ?? it.price)
    const amount = n(it.amount) || q * price
    const v = n(it.vatRate ?? it.vat_rate)
    return { name: String(it.name).trim(), sku: (it.sku || '').trim() || null, productId: it.productId || it.product_id || null, unit: it.unit || 'шт', qty: q, price, amount, vat: v }
  })
}

function buildRows(norm, docAmount, mode) {
  const rows = norm.map((x, i) => {
    const k = mode === 'plusVat' ? 1 + x.vat / 100 : 1
    const sum = r2(x.amount * k)
    const price = x.qty ? r2(sum / x.qty) : r2(x.price * k)
    return { n: i + 1, name: x.name, sku: x.sku, productId: x.productId, unit: x.unit, qty: x.qty, price, sum }
  })
  const total = r2(rows.reduce((s, r) => s + r.sum, 0))
  return { rows, total, diff: r2(docAmount - total) }
}

// docs: [{ docId, generated_doc_id, amount }] → { [docId]: { rows, noItems, mismatch, diff, source } }
export async function loadDocItems(docs) {
  const out = {}
  if (!docs?.length) return out
  const ids = docs.map(d => d.docId)
  // етап 3 об'єднання: позиції згенерованого — у самій картці documents (items, print_data)
  const ocrById = {}, genById = {}
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('documents').select('id, ocr_data, items, print_data').in('id', ids.slice(i, i + 100))
    ;(data || []).forEach(x => { ocrById[x.id] = x.ocr_data; if (x.items) genById[x.id] = { items: x.items, contract_num: x.print_data?.contract_num, contract_date: x.print_data?.contract_date } })
  }

  const needSku = new Set()
  for (const d of docs) {
    const amount = Math.abs(Number(d.amount) || 0)
    const gen = genById[d.docId] || null
    const genItems = normalize(parseItems(gen?.items))
    const ocrItems = normalize(parseItems(ocrById[d.docId]?.items))
    const src = genItems.length ? genItems : ocrItems
    const source = genItems.length ? 'generated' : ocrItems.length ? 'ocr' : null
    if (!src.length) {
      out[d.docId] = { rows: [{ n: 1, name: 'Згідно документа', sku: null, unit: '', qty: null, price: null, sum: r2(amount) }], noItems: true, mismatch: false, diff: 0, source: null, contract: gen ? { num: gen.contract_num, date: gen.contract_date } : null }
      continue
    }
    // згенерований — ціни завжди без ПДВ; розпізнаний — база, що ближча до суми документа
    let best = buildRows(src, amount, 'plusVat')
    if (source === 'ocr') {
      const asIs = buildRows(src, amount, 'asIs')
      if (Math.abs(asIs.diff) < Math.abs(best.diff)) best = asIs
    }
    if (Math.abs(best.diff) > 0.001 && Math.abs(best.diff) <= 1 && best.rows.length) {
      const last = best.rows[best.rows.length - 1]
      last.sum = r2(last.sum + best.diff)
      best.diff = 0
    }
    best.rows.forEach(r => { if (!r.sku && r.productId) needSku.add(r.productId) })
    out[d.docId] = { rows: best.rows, noItems: false, mismatch: Math.abs(best.diff) > 1, diff: best.diff, source, contract: gen ? { num: gen.contract_num, date: gen.contract_date } : null }
  }

  // артикул з довідника, якщо в рядку його немає
  if (needSku.size) {
    const pids = [...needSku], skuOf = {}
    for (let i = 0; i < pids.length; i += 100) {
      const { data } = await supabase.from('products').select('id, sku').in('id', pids.slice(i, i + 100))
      ;(data || []).forEach(p => { if (p.sku) skuOf[p.id] = p.sku })
    }
    Object.values(out).forEach(x => x.rows.forEach(r => { if (!r.sku && r.productId) r.sku = skuOf[r.productId] || null }))
  }
  return out
}

// Оцінка складу на дату — FIFO-шари з РУХІВ (не залежить від stock_allocations, тобто від того,
// чи застосовано перебудову FIFO): залишок товару = Σ приходів − Σ видач з датою ≤ дати; за FIFO на складі
// лишаються НАЙПІЗНІШІ партії, тож вартість = залишок, покритий останніми приходами × їхня ціна без ПДВ (batchUnit).
// Від'ємний залишок (видано більше, ніж оприбутковано) — не актив: 0 і позначка negative.
// (До 2026-10-19 тут бралися партії мінус stock_allocations — до перебудови старі відвантаження не мали
// списань, і запаси дорівнювали всім закупівлям за весь час.)
import { supabase } from './supabase'
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { batchUnit } from './batchPrice'

export async function loadBatches(toDate) {
  const mv = await fetchAll(() => qc('stock_movements').select('id, product_id, type, quantity, price, cost_price, date, created_at, document_id, company_id').lte('date', toDate))
  const ins = mv.filter(m => m.type === 'in')
  // ціна партії без ПДВ (як у FIFO / звірці): за сумою документа з ПДВ і без ПДВ
  const docIds = [...new Set(ins.map(m => m.document_id).filter(Boolean))]
  const docs = docIds.length ? await fetchAllIn(() => qc('documents').select('id, amount, vat_amount'), 'id', docIds).catch(() => []) : []
  const docById = {}; docs.forEach(d => { docById[d.id] = d })
  const docIns = {}; ins.forEach(m => { if (m.document_id) (docIns[m.document_id] ||= []).push(m) })
  const { data: comps } = await supabase.from('companies').select('id, is_vat_payer')
  const payer = {}; (comps || []).forEach(c => { payer[c.id] = c.is_vat_payer !== false })
  const unitOf = {}; ins.forEach(m => { unitOf[m.id] = batchUnit(m, docById[m.document_id], docIns[m.document_id], payer[m.company_id] !== false).unit })
  // від найпізніших — за FIFO на складі лишаються саме вони
  ins.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.created_at || '').localeCompare(String(a.created_at || '')))
  // залишки й вартість станом на дату: { [productId]: { qty, value, negative } }
  const at = (date) => {
    const bal = {}
    mv.forEach(m => {
      if (!m.product_id || (m.date || '') > date) return
      const q = Number(m.quantity) || 0
      bal[m.product_id] = (bal[m.product_id] || 0) + (m.type === 'in' ? q : -q)
    })
    const out = {}
    const need = {}
    Object.entries(bal).forEach(([pid, q]) => {
      if (q > 0.00001) { need[pid] = q; out[pid] = { qty: q, value: 0 } }
      else if (q < -0.00001) out[pid] = { qty: 0, value: 0, negative: q }
    })
    ins.forEach(m => {   // від найпізніших
      if ((m.date || '') > date || !(need[m.product_id] > 0.00001)) return
      const take = Math.min(need[m.product_id], Number(m.quantity) || 0)
      out[m.product_id].value += take * (unitOf[m.id] || 0)
      need[m.product_id] -= take
    })
    return out
  }
  return { at }
}

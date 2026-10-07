// Звіт «Прибутковість реалізації»: по кожній видатковій і товару — закупка(FIFO)→реалізація→
// прибуток→агентські→чистий. Усі суми БЕЗ ПДВ (окрім «ПДВ до сплати»).
// Рішення власника: собівартість FIFO; неплатник-постачальник → повний ПДВ з реалізації;
// послуги (закупка 0) → прибуток = вся сума; один агент на накладну.
import { qc, getActiveCompanyId, setActiveCompanyId } from './companyScope'
import { clearCompanyCache } from './companyConfig'
import { supabase } from './supabase'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const VAT = 0.20
let _lock = Promise.resolve()

export async function loadAgents(docIds) {
  if (!docIds.length) return {}
  const map = {}
  for (let i = 0; i < docIds.length; i += 200) {
    const { data } = await supabase.from('agent_commissions').select('document_id, agent_name, percent').in('document_id', docIds.slice(i, i + 200))
    ;(data || []).forEach(a => map[a.document_id] = a)
  }
  return map
}

export async function saveAgent(documentId, { agentName, percent, userId }) {
  const { error } = await supabase.from('agent_commissions').upsert({
    document_id: documentId, agent_name: agentName || null, percent: Number(percent) || 0,
    created_by: userId || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'document_id' })
  if (error) throw error
}

export async function computeProfitability(companyId, companyIsVat, from, to) {
  const run = async () => {
    const saved = getActiveCompanyId()
    try {
      setActiveCompanyId(companyId); clearCompanyCache()

      const { data: docs } = await qc('documents')
        .select('id, doc_number, doc_date, contractor_id, amount, vat_amount')
        .eq('type', 'waybill').gte('doc_date', from).lte('doc_date', to)
        .order('doc_date').order('doc_number')
      if (!docs?.length) return { invoices: [], totals: emptyTotals() }

      const docIds = docs.map(d => d.id)
      // контрагенти
      const cids = [...new Set(docs.map(d => d.contractor_id).filter(Boolean))]
      const cName = {}
      for (let i = 0; i < cids.length; i += 100) {
        const { data } = await supabase.from('contractors').select('id, name').in('id', cids.slice(i, i + 100))
        ;(data || []).forEach(c => cName[c.id] = c.name)
      }
      // агенти
      const agents = await loadAgents(docIds)
      // OUT-рухи всіх цих видаткових
      const moves = []
      for (let i = 0; i < docIds.length; i += 200) {
        const { data } = await qc('stock_movements')
          .select('document_id, product_id, quantity, price, cost_price, created_at')
          .in('document_id', docIds.slice(i, i + 200)).eq('type', 'out')
        ;(data || []).forEach(m => moves.push(m))
      }
      const prodIds = [...new Set(moves.map(m => m.product_id).filter(Boolean))]
      const pInfo = {}
      for (let i = 0; i < prodIds.length; i += 100) {
        const { data } = await supabase.from('products').select('id, name, unit, buy_price').in('id', prodIds.slice(i, i + 100))
        ;(data || []).forEach(p => pInfo[p.id] = p)
      }
      // чи є вхідний ПДВ по товару (куплено в платника ПДВ) — для «ПДВ до сплати»
      const hasInputVat = await computeInputVat(prodIds)

      const movesByDoc = {}
      moves.forEach(m => { (movesByDoc[m.document_id] ||= []).push(m) })

      const invoices = docs.map(d => {
        const items = (movesByDoc[d.id] || []).map(m => {
          const qty = Number(m.quantity) || 0
          const sellUnit = r2(Number(m.price) || 0)
          // FIFO-собівартість руху; якщо не записана — фолбек на ціну закупки з картки товару (нетто)
          const buyUnit = r2(Number(m.cost_price) > 0 ? Number(m.cost_price) : (Number(pInfo[m.product_id]?.buy_price) || 0))
          const sellSum = r2(qty * sellUnit)
          const buySum = r2(qty * buyUnit)
          const profit = r2(sellSum - buySum)
          const outVat = companyIsVat ? r2(sellSum * VAT) : 0
          const inVat = companyIsVat && hasInputVat[m.product_id] ? r2(buySum * VAT) : 0
          const vatToPay = r2(outVat - inVat)
          return {
            productId: m.product_id, name: pInfo[m.product_id]?.name || '—', unit: pInfo[m.product_id]?.unit || 'шт',
            qty, buyUnit, buySum, sellUnit, sellSum, vatToPay, profit,
            margin: sellSum > 0 ? profit / sellSum : null,
          }
        }).sort((a, b) => a.name.localeCompare(b.name))

        const sellSum = r2(items.reduce((s, x) => s + x.sellSum, 0))
        const buySum = r2(items.reduce((s, x) => s + x.buySum, 0))
        const profit = r2(items.reduce((s, x) => s + x.profit, 0))
        const vatToPay = r2(items.reduce((s, x) => s + x.vatToPay, 0))
        const ag = agents[d.id]
        const percent = ag ? Number(ag.percent) || 0 : 0
        const commission = profit > 0 ? r2(profit * percent / 100) : 0
        const net = r2(profit - commission)
        return {
          id: d.id, doc_number: d.doc_number || '(без №)', doc_date: d.doc_date,
          client: cName[d.contractor_id] || 'Без контрагента',
          items, sellSum, buySum, profit, vatToPay,
          margin: sellSum > 0 ? profit / sellSum : null,
          agentName: ag?.agent_name || '', percent, commission, net,
        }
      })

      return { invoices, totals: computeTotals(invoices) }
    } finally {
      setActiveCompanyId(saved); clearCompanyCache()
    }
  }
  const result = _lock.then(run, run)
  _lock = result.then(() => {}, () => {})
  return result
}

// Чи має товар вхідний ПДВ (куплений у платника ПДВ): прихідна з vat_amount>0
async function computeInputVat(prodIds) {
  const res = {}
  if (!prodIds.length) return res
  // IN-рухи з документами
  const docByProd = {}
  for (let i = 0; i < prodIds.length; i += 100) {
    const { data } = await qc('stock_movements').select('product_id, document_id').eq('type', 'in').not('document_id', 'is', null).in('product_id', prodIds.slice(i, i + 100))
    ;(data || []).forEach(m => { (docByProd[m.product_id] ||= new Set()).add(m.document_id) })
  }
  const allDocIds = [...new Set(Object.values(docByProd).flatMap(s => [...s]))]
  const vatByDoc = {}
  for (let i = 0; i < allDocIds.length; i += 100) {
    const { data } = await qc('documents').select('id, vat_amount').in('id', allDocIds.slice(i, i + 100))
    ;(data || []).forEach(d => vatByDoc[d.id] = Number(d.vat_amount) || 0)
  }
  prodIds.forEach(pid => {
    const set = docByProd[pid]
    res[pid] = set ? [...set].some(did => (vatByDoc[did] || 0) > 0.5) : false
  })
  return res
}

function emptyTotals() { return { count: 0, sellSum: 0, profit: 0, vatToPay: 0, commission: 0, net: 0, margin: null, lossCount: 0, lossSum: 0 } }
function computeTotals(invoices) {
  const t = emptyTotals()
  t.count = invoices.length
  invoices.forEach(v => {
    t.sellSum = r2(t.sellSum + v.sellSum); t.profit = r2(t.profit + v.profit)
    t.vatToPay = r2(t.vatToPay + v.vatToPay); t.commission = r2(t.commission + v.commission); t.net = r2(t.net + v.net)
    if (v.profit < 0) { t.lossCount++; t.lossSum = r2(t.lossSum + v.profit) }
  })
  t.margin = t.sellSum > 0 ? t.profit / t.sellSum : null
  return t
}

// Звіт «Прибутковість реалізації»: по кожній видатковій і товару — закупка(FIFO)→реалізація→
// прибуток→агентські→чистий. Усі суми БЕЗ ПДВ (окрім «ПДВ до сплати»).
// Рішення власника: собівартість FIFO; неплатник-постачальник → повний ПДВ з реалізації;
// послуги (закупка 0) → прибуток = вся сума; один агент на накладну.
import { qc, setReportScope, runExclusive } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { clearCompanyCache } from './companyConfig'
import { supabase } from './supabase'
import { loadDocPayments } from './debts'
import { PROFIT_TAX } from './orderPlan'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const VAT = 0.20

// Агентські — від ЧИСТОГО прибутку: після ПДВ (суми вже без ПДВ) і податку на прибуток 18%
// (рішення власника 05.11.2026; те саме правило, що в картці замовлення — orderPlan.computeOrderPlan).
// Податок — лише для юрособи-платника ПДВ (загальна система), ФОП — 0. Збиток → податок і агентські 0.
export function agentCalc(profit, percent, taxOn = true) {
  const p = Number(profit) || 0
  const tax = taxOn && p > 0 ? r2(p * PROFIT_TAX) : 0
  const base = r2(p - tax)
  const commission = p > 0 ? r2(base * (Number(percent) || 0) / 100) : 0
  return { tax, base, commission, net: r2(p - tax - commission) }
}

export async function loadAgents(docIds) {
  if (!docIds.length) return {}
  const map = {}
  for (let i = 0; i < docIds.length; i += 200) {
    const part = docIds.slice(i, i + 200)
    let { data, error } = await supabase.from('agent_commissions').select('document_id, agent_name, percent, paid, paid_at').in('document_id', part)
    if (error && /paid/.test(error.message || '')) ({ data } = await supabase.from('agent_commissions').select('document_id, agent_name, percent').in('document_id', part)) // до міграції 109
    ;(data || []).forEach(a => map[a.document_id] = a)
  }
  return map
}

// % агентських із замовлень (orders.agent_commission_pct — частка: 0.35 = 35%) → { orderId: { percent (у %), number } }
export async function loadOrderAgentPct(orderIds) {
  const map = {}
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await supabase.from('orders').select('id, order_number, agent_commission_pct, commission_paid').in('id', orderIds.slice(i, i + 200))
    ;(data || []).forEach(o => { map[o.id] = { percent: r2((Number(o.agent_commission_pct) || 0) * 100), number: o.order_number, paid: !!o.commission_paid } })
  }
  return map
}

// % агентських накладної, прив'язаної до замовлення, — це % самого замовлення (рішення власника 05.11.2026):
// змінюється всюди (картка, прогноз, план оплат, звіт інвестору, інші накладні замовлення).
export async function saveOrderAgentPct(orderId, percent) {
  const { error } = await supabase.from('orders').update({ agent_commission_pct: Math.max(0, Number(percent) || 0) / 100 }).eq('id', orderId)
  if (error) throw error
}

// «Агентські сплачено»: накладна із замовленням — відмітка замовлення (orders.commission_paid, як у списку замовлень);
// без замовлення — agent_commissions.paid (міграція 109).
export async function setAgentPaid(inv, paid) {
  if (inv.orderId) {
    const { error } = await supabase.from('orders').update({ commission_paid: paid }).eq('id', inv.orderId)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('agent_commissions').upsert({
    document_id: inv.id, agent_name: inv.agentName || null, percent: Number(inv.percent) || 0,
    paid, paid_at: paid ? new Date().toISOString().slice(0, 10) : null, updated_at: new Date().toISOString(),
  }, { onConflict: 'document_id' })
  if (error) throw new Error(/paid/.test(error.message || '') ? 'Потрібна міграція 109 (агентські сплачено)' : error.message)
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
    try {
      setReportScope(companyId); clearCompanyCache()

      const docs = (await fetchAll(() => qc('documents')
        .select('id, doc_number, doc_date, contractor_id, order_id, amount, vat_amount')
        .eq('type', 'waybill').gte('doc_date', from).lte('doc_date', to)))
        .sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || '') || String(a.doc_number || '').localeCompare(String(b.doc_number || '')))
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
      // немає ручного % на накладній → беремо % агентських із замовлення накладної
      const orderAgent = await loadOrderAgentPct([...new Set(docs.map(d => d.order_id).filter(Boolean))])
      // оплати клієнта, прив'язані до накладної (те саме правило, що «Дебіторка»)
      const payByDoc = {}
      ;(await loadDocPayments(docIds)).forEach(x => {
        const p = (payByDoc[x.document_id] ||= { sum: 0, last: null })
        p.sum += x.amount; if (x.date && (!p.last || x.date > p.last)) p.last = x.date
      })
      // OUT-рухи всіх цих видаткових
      const moves = await fetchAllIn(() => qc('stock_movements')
          .select('id, document_id, product_id, quantity, price, cost_price, created_at').eq('type', 'out'), 'document_id', docIds)
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
        // накладна із замовленням: % замовлення — головний; ручний % накладної лише якщо в замовленні не вказано
        const ord = d.order_id ? orderAgent[d.order_id] : null
        const fromOrder = ord && (ord.percent > 0 || !ag) ? ord : null
        const percent = fromOrder ? fromOrder.percent : ag ? Number(ag.percent) || 0 : 0
        const { tax, commission, net } = agentCalc(profit, percent, companyIsVat)
        return {
          id: d.id, doc_number: d.doc_number || '(без №)', doc_date: d.doc_date,
          client: cName[d.contractor_id] || 'Без контрагента', contractorId: d.contractor_id || null,
          items, sellSum, buySum, profit, vatToPay,
          margin: sellSum > 0 ? profit / sellSum : null,
          agentName: ag?.agent_name || '', percent, tax, taxOn: !!companyIsVat, commission, net,
          pctSource: fromOrder ? 'order' : ag ? 'manual' : null, orderId: d.order_id || null, orderNumber: ord?.number || null,
          agentPaid: d.order_id && ord ? ord.paid : !!ag?.paid,
          clientPay: payStatus(Math.abs(Number(d.amount) || 0), payByDoc[d.id]),
        }
      })

      return { invoices, totals: computeTotals(invoices) }
    } finally {
      setReportScope(null); clearCompanyCache()
    }
  }
  return runExclusive(run)
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

// стан оплати клієнтом: paid (залишок ≤ 0,5 грн) | partial | none; сума з ПДВ, як у документі
export function payStatus(amount, p) {
  const paid = r2(p?.sum || 0)
  const rest = r2(amount - paid)
  return { amount: r2(amount), paid, rest: rest > 0 ? rest : 0, last: p?.last || null, state: amount > 0 && rest <= 0.5 ? 'paid' : paid > 0.5 ? 'partial' : 'none' }
}

function emptyTotals() { return { count: 0, sellSum: 0, profit: 0, vatToPay: 0, commission: 0, tax: 0, net: 0, margin: null, lossCount: 0, lossSum: 0, agentDue: 0, unpaidCount: 0, unpaidSum: 0 } }
export function computeTotals(invoices) {
  const t = emptyTotals()
  t.count = invoices.length
  invoices.forEach(v => {
    t.sellSum = r2(t.sellSum + v.sellSum); t.profit = r2(t.profit + v.profit)
    t.vatToPay = r2(t.vatToPay + v.vatToPay); t.commission = r2(t.commission + v.commission); t.tax = r2(t.tax + (v.tax || 0)); t.net = r2(t.net + v.net)
    if (v.profit < 0) { t.lossCount++; t.lossSum = r2(t.lossSum + v.profit) }
    if (v.commission > 0 && !v.agentPaid) t.agentDue = r2(t.agentDue + v.commission)
    if (v.clientPay && v.clientPay.state !== 'paid') { t.unpaidCount++; t.unpaidSum = r2(t.unpaidSum + v.clientPay.rest) }
  })
  t.margin = t.sellSum > 0 ? t.profit / t.sellSum : null
  return t
}

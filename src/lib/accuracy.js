// «Точність прогнозу» (ТЗ редизайну 6.2). Для ЗАКРИТИХ замовлень (статус «Закрито» — рішення власника) зі знімком
// прогнозу рахуємо факт тими самими статтями:
//   виручка й закупівля — з видаткових / актів і собівартості FIFO (computeOrderMargins, як «Маржа по замовленнях»);
//   логістика / комісії / агентські / інше — витрати, прив'язані до замовлення (order_transactions), за статтею
//   транзакції (costBucket; оплати постачальникам за товар — уже в собівартості, не дублюємо);
//   податок — за тим самим правилом, що в плані (18% від валового, якщо в плані він був);
//   дата оплати клієнта — коли оплати покрили суму документів (payDate з computeOrderMargins).
// точність = факт ÷ прогноз × 100%; затримка = дата оплати факт − план, днів. Без знімка — не рахуємо.
import { supabase } from './supabase'
import { computeOrderMargins } from './accrual'
import { listSnapshots, costBucket } from './snapshots'
import { setReportScope, runExclusive } from './companyScope'
import { clearCompanyCache } from './companyConfig'
import { todayKyiv } from './dates'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const days = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null
export const KEYS = ['revenue', 'purchase', 'logistics', 'commission', 'agent', 'tax', 'other']

export const grade = (acc) => acc == null ? null : acc >= 0.95 && acc <= 1.05 ? 'ok' : acc >= 0.85 && acc <= 1.15 ? 'fair' : 'bad'

export async function computeAccuracy(companies) {
  const snaps = await listSnapshots()
  if (!snaps.length) return { rows: [], withoutSnap: 0 }
  const { data: closed } = await supabase.from('orders').select('id, order_number, company_id, status, contractors(name)').eq('status', 'closed')
  const closedIds = new Set((closed || []).map(o => o.id))
  // останній знімок на замовлення (поточний або, якщо позначку знімали, — найсвіжіший історичний)
  const snapBy = {}
  snaps.forEach(s => { if (closedIds.has(s.order_id) && (!snapBy[s.order_id] || s.is_current)) snapBy[s.order_id] = s })
  const ids = Object.keys(snapBy)
  const withoutSnap = (closed || []).filter(o => !snapBy[o.id]).length
  if (!ids.length) return { rows: [], withoutSnap }

  // факт виручки/собівартості/оплати — по кожній юрособі (computeOrderMargins скоупиться компанією)
  const margins = {}
  await runExclusive(async () => {
    try {
      for (const c of companies || []) {
        setReportScope(c.id); clearCompanyCache()
        const rows = await computeOrderMargins('0000-01-01', todayKyiv()).catch(() => [])
        rows.forEach(r => { if (snapBy[r.id]) margins[r.id] = r })
      }
    } finally { setReportScope(null); clearCompanyCache() }
  })
  // факт інших витрат — прив'язані до замовлення витрати за статтями
  const ots = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('order_transactions').select('order_id, kind, amount, bank_transactions(article)').in('order_id', ids.slice(i, i + 200)).eq('kind', 'expense')
    ;(data || []).forEach(x => ots.push(x))
  }
  const byOrder = Object.fromEntries((closed || []).map(o => [o.id, o]))
  const rows = ids.map(id => {
    const s = snapBy[id], m = margins[id], o = byOrder[id]
    const pc = s.costs || {}
    const plan = { revenue: Number(s.revenue_net) || 0, purchase: pc.purchase || 0, logistics: pc.logistics || 0, commission: pc.commission || 0, agent: pc.agent || 0, tax: pc.tax || 0, other: pc.other || 0 }
    const fact = { revenue: m?.revenue || 0, purchase: m?.cost || 0, logistics: 0, commission: 0, agent: 0, tax: 0, other: 0 }
    ots.filter(t => t.order_id === id).forEach(t => {
      const art = t.bank_transactions?.article || ''
      if (/закуп|постачальн|товар/i.test(art)) return           // оплата за товар — уже в собівартості FIFO
      const b = /агент/i.test(art) ? 'agent' : costBucket(art)
      fact[b] = r2(fact[b] + Math.abs(Number(t.amount) || 0))
    })
    const gross = fact.revenue - fact.purchase - fact.logistics - fact.commission - fact.other
    fact.tax = plan.tax > 0 ? r2(Math.max(0, gross) * 0.18) : 0
    const profit = (x) => r2(x.revenue - x.purchase - x.logistics - x.commission - x.agent - x.tax - x.other)
    const pProfit = Number(s.profit) || profit(plan), fProfit = profit(fact)
    // відхилення: вплив на прибуток (+ краще, − гірше)
    const dev = Object.fromEntries(KEYS.map(k => [k, r2(k === 'revenue' ? fact[k] - plan[k] : plan[k] - fact[k])]))
    const acc = pProfit > 0 ? fProfit / pProfit : null
    return {
      id, number: o?.order_number || id.slice(0, 6), client: o?.contractors?.name || '—', companyId: o?.company_id,
      snap: s, late: s.late, plan, fact, planProfit: pProfit, factProfit: fProfit, accuracy: acc, grade: grade(acc), dev,
      planPay: s.client_pay_date, factPay: m?.payDate || null, delay: days(s.client_pay_date, m?.payDate), noFact: !m,
    }
  }).sort((a, b) => (b.factPay || '').localeCompare(a.factPay || ''))
  return { rows, withoutSnap }
}

// Разовий знімок для замовлень, що вже стоять «в прогнозі» без знімка (рішення власника 23.10.2026: late = true)
export async function inForecastWithoutSnapshot() {
  const [{ data: os }, snaps] = await Promise.all([
    supabase.from('orders').select('id, order_number').eq('in_forecast', true).neq('status', 'closed'),
    listSnapshots(),
  ])
  const has = new Set(snaps.filter(s => s.is_current).map(s => s.order_id))
  return (os || []).filter(o => !has.has(o.id))
}

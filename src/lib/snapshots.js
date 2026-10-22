// Знімок прогнозу замовлення (ТЗ редизайну 6.2; міграція 099). Береться з того самого розрахунку, що й
// «Прогноз» (buildOrderForecasts → computeOrderPlan), у момент позначки «в прогноз»; далі не змінюється.
import { supabase } from './supabase'
import { buildOrderForecasts } from './forecast'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
export const isMissingSnapTable = (e) => /forecast_snapshots/.test(e?.message || '') && /(does not exist|not find|schema cache)/i.test(e?.message || '')

// Стаття витрати за назвою (однакове правило для плану й факту — рішення власника 23.10.2026):
// «Транспорт / логістика», доставка → логістика; «Банківські комісії», «Комісія Prozorro» → комісії; решта → інше.
export function costBucket(name) {
  const s = (name || '').toLowerCase()
  if (/логіст|транспорт|достав|перевез|пошта|кур'?єр/.test(s)) return 'logistics'
  if (/коміс/.test(s)) return 'commission'
  return 'other'
}
export const COST_LABELS = { purchase: 'Закупівля (собівартість)', logistics: 'Логістика', commission: 'Комісії', agent: 'Агентські', tax: 'Податок на прибуток', other: 'Інші витрати' }

export async function buildSnapshot(orderId) {
  const [rows, { data: exps }] = await Promise.all([
    buildOrderForecasts({ orderIds: [orderId] }),
    supabase.from('order_expenses').select('name, amount').eq('order_id', orderId),
  ])
  const o = rows?.[0]
  if (!o) throw new Error('Замовлення не знайдено')
  const p = o.plan || {}
  const costs = { purchase: r2(p.costNet), logistics: 0, commission: 0, agent: r2(p.agent), tax: r2(p.tax), other: 0 }
  let named = 0
  ;(exps || []).forEach(e => { const b = costBucket(e.name); const a = Number(e.amount) || 0; costs[b] = r2(costs[b] + a); named += a })
  costs.other = r2(costs.other + Math.max(0, (Number(p.other) || 0) - named))   // «інші витрати» без назви
  return {
    order_id: orderId, company_id: o.companyId || null,
    revenue_net: r2(p.revenueNet), costs, profit: r2(p.net),
    schedule: (o.lines || []).map(l => ({ date: l.date || null, kind: l.kind, label: l.label, amount: r2(l.plan) })),
    client_pay_date: o.clientDate || null,
  }
}

// Позначили «в прогноз» → новий поточний знімок (попередній, якщо лишився, — в історію)
export async function takeSnapshot(orderId, { late = false } = {}) {
  const snap = await buildSnapshot(orderId)
  await supersedeSnapshot(orderId)
  const { error } = await supabase.from('forecast_snapshots').insert({ ...snap, late })
  if (error) throw error
}
// Зняли позначку → поточний знімок стає історичним
export async function supersedeSnapshot(orderId) {
  const { error } = await supabase.from('forecast_snapshots').update({ is_current: false }).eq('order_id', orderId).eq('is_current', true)
  if (error) throw error
}
export async function listSnapshots() {
  const { data, error } = await supabase.from('forecast_snapshots').select('*').order('taken_at', { ascending: false })
  if (error) throw error
  return data || []
}

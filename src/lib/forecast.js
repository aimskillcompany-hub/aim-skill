// Ручний прогноз грошових потоків для інвестора.
// Замовлення з orders.in_forecast=true → у forecast_items вносяться прогнозні
// надходження (від клієнта) і витрати (постачальнику тощо) з очікуваною датою.
// Консолідовано по ВСІХ юрособах (читаємо напряму, без скоупу — forecast_items має company_id).
import { supabase } from './supabase'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Усі замовлення в прогнозі + їх прогнозні рядки (по всіх компаніях).
export async function loadForecast() {
  const { data: orders } = await supabase.from('orders')
    .select('id, order_number, status, company_id, total, contractors(name), companies(short_name, name)')
    .eq('in_forecast', true).order('order_number')
  const ids = (orders || []).map(o => o.id)
  let items = []
  if (ids.length) {
    const { data } = await supabase.from('forecast_items').select('*').in('order_id', ids).order('expected_date', { nullsFirst: false })
    items = data || []
  }
  const byOrder = {}
  items.forEach(it => (byOrder[it.order_id] ||= []).push(it))

  const rows = (orders || []).map(o => {
    const lines = byOrder[o.id] || []
    const income = r2(lines.filter(l => l.kind === 'income').reduce((s, l) => s + (Number(l.amount) || 0), 0))
    const expense = r2(lines.filter(l => l.kind === 'expense').reduce((s, l) => s + (Number(l.amount) || 0), 0))
    return {
      id: o.id, number: o.order_number || o.id.slice(0, 6),
      company: o.companies?.short_name || o.companies?.name || '—', companyId: o.company_id,
      client: o.contractors?.name || '—', status: o.status, total: Number(o.total) || 0,
      lines, income, expense, net: r2(income - expense),
    }
  })
  const totals = rows.reduce((t, r) => ({ income: r2(t.income + r.income), expense: r2(t.expense + r.expense), net: r2(t.net + r.net) }), { income: 0, expense: 0, net: 0 })
  return { rows, totals }
}

// Прогнозний нетто-потік станом на дату (expected_date <= toDate; без дати — враховуємо завжди).
export async function forecastNetByDate(toDate) {
  const { data: orders } = await supabase.from('orders').select('id').eq('in_forecast', true)
  const ids = (orders || []).map(o => o.id)
  if (!ids.length) return { income: 0, expense: 0, net: 0, items: [] }
  const all = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('forecast_items').select('kind, amount, expected_date, order_id').in('order_id', ids.slice(i, i + 200))
    ;(data || []).forEach(x => all.push(x))
  }
  const within = all.filter(x => !toDate || !x.expected_date || x.expected_date <= toDate)
  const income = r2(within.filter(x => x.kind === 'income').reduce((s, x) => s + (Number(x.amount) || 0), 0))
  const expense = r2(within.filter(x => x.kind === 'expense').reduce((s, x) => s + (Number(x.amount) || 0), 0))
  return { income, expense, net: r2(income - expense), items: within }
}

export async function addForecastItem({ orderId, companyId, kind, amount, expectedDate, note, userId }) {
  const { error } = await supabase.from('forecast_items').insert({
    order_id: orderId, company_id: companyId, kind, amount: r2(amount),
    expected_date: expectedDate || null, note: note || null, created_by: userId || null,
  })
  if (error) throw error
}

export async function removeForecastItem(id) {
  const { error } = await supabase.from('forecast_items').delete().eq('id', id)
  if (error) throw error
}

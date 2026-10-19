// Партії складу (міграція 071): партія = прихідний рух; залишок партії на дату = к-сть − списане
// з неї відвантаженнями (stock_allocations) з датою відвантаження ≤ дати. Запаси = Σ залишок × ціна партії (без ПДВ).
// Повертає null, якщо міграцію 071 ще не застосовано (тоді звіти оцінюють склад по-старому).
import { qc } from './companyScope'
import { fetchAll } from './fetchAll'

export async function loadBatches(toDate) {
  let allocs
  try {
    allocs = await fetchAll(() => qc('stock_allocations').select('id, in_movement_id, qty, out_date').lte('out_date', toDate))
  } catch (e) {
    if (/stock_allocations/.test(e.message || '')) return null
    throw e
  }
  const ins = await fetchAll(() => qc('stock_movements').select('id, product_id, quantity, price, cost_price, date').eq('type', 'in').lte('date', toDate))
  const allocByIn = {}
  allocs.forEach(a => { (allocByIn[a.in_movement_id] ||= []).push(a) })
  // залишки й вартість партій станом на дату: { [productId]: { qty, value } }
  const at = (date) => {
    const out = {}
    ins.forEach(m => {
      if (m.date > date) return
      const used = (allocByIn[m.id] || []).reduce((s, a) => s + (a.out_date && a.out_date <= date ? Number(a.qty) || 0 : 0), 0)
      const rest = (Number(m.quantity) || 0) - used
      if (rest <= 0.00001) return
      const unit = Number(m.cost_price) || Number(m.price) || 0
      const x = (out[m.product_id] ||= { qty: 0, value: 0 })
      x.qty += rest; x.value += rest * unit
    })
    return out
  }
  return { at }
}

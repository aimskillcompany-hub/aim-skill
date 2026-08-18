// Атомна генерація номера замовлення.
//
// Основний шлях — RPC next_order_number() (послідовність у БД, міграція 031):
// стійкий до гонок і видалень. Фолбек (поки міграцію 031 не запущено) —
// max(order_number)+1, а НЕ count+1: не задвоює після видалення заявки нижче
// максимуму (гонки лишаються можливими до застосування 031).
//
// Працює і з браузерним клієнтом (supabase), і з серверним (admin/service-role) —
// обидва мають .rpc і .from.
export async function nextOrderNumber(client) {
  const { data, error } = await client.rpc('next_order_number')
  if (!error && data) return data
  const { data: rows } = await client.from('orders').select('order_number')
  const max = (rows || []).reduce((m, r) => {
    const n = parseInt(String(r.order_number || '').replace(/\D/g, ''), 10)
    return isNaN(n) ? m : Math.max(m, n)
  }, 0)
  return String(max + 1).padStart(4, '0')
}

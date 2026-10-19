// Читання ВСІХ рядків запиту посторінково. Supabase/PostgREST віддає не більше 1000 рядків за раз,
// і раніше звіти мовчки рахували лише перші 1000 (аудит 2026-10-19).
//   make — функція, що щоразу будує НОВИЙ запит: () => qc('bank_transactions').select('...').eq(...)
//   Сортування за id — стабільні сторінки (без пропусків і дублів між сторінками).
//   Помилка запиту кидається, а не перетворюється на «порожньо/0».
export async function fetchAll(make, { pageSize = 1000, order = 'id' } = {}) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    let q = make()
    if (order) q = q.order(order, { ascending: true })
    const { data, error } = await q.range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (data?.length) out.push(...data)
    if (!data || data.length < pageSize) break
  }
  return out
}

// Те саме, але у формі { data } — щоб підставити в існуючий код на кшталт `const { data } = await …`
export const fetchAllData = (make, opts) => fetchAll(make, opts).then(data => ({ data, error: null }))

// Пакетне .in(column, ids) з посторінковим читанням кожного пакета
export async function fetchAllIn(make, column, ids, { chunk = 200, ...opts } = {}) {
  const out = []
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk)
    out.push(...await fetchAll(() => make().in(column, part), opts))
  }
  return out
}

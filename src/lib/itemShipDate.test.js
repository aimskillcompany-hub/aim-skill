// Окрема дата відвантаження позиції (105): оплата клієнта, постачальнику й ПДВ за неї — від її дати.
import { describe, it, expect, vi } from 'vitest'

const T = {}
const builder = (table) => {
  const res = () => Promise.resolve({ data: T[table] || [], error: null })
  const b = { select: () => b, in: () => b, eq: () => b, is: () => b, neq: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, not: () => b, or: () => b,
    maybeSingle: () => Promise.resolve({ data: (T[table] || [])[0] || null, error: null }), then: (f, r) => res().then(f, r) }
  return b
}
vi.mock('./supabase', () => ({ supabase: { from: (t) => builder(t) } }))
vi.mock('./companyScope', () => ({ qc: (t) => builder(t), withCompany: (x) => x }))
const { buildOrderForecasts } = await import('./forecast.js')

const O = 'o27', A = 'supA', P = 'supP'
describe('дата відвантаження позиції', () => {
  it('плотер пізніше: окремі оплата клієнта, постачальнику й ПДВ', async () => {
    T.orders = [{ id: O, order_number: '0027', status: 'shipped', company_id: 'c1', total: 0, agent_commission_pct: 0, in_forecast: true, companies: { is_vat_payer: true } }]
    T.order_items = [
      { order_id: O, qty: 1, unit_price: 1200, cost_price: 600, vat_rate: 20, price_includes_vat: true, supplier_id: A },
      { order_id: O, qty: 1, unit_price: 2400, cost_price: 1200, vat_rate: 20, price_includes_vat: true, supplier_id: P, ship_date: '2026-12-15' },
    ]
    T.order_payment_plan = [
      { order_id: O, kind: 'ship', supplier_id: null, plan_date: '2026-11-10', days: null, part_no: 1 },
      { order_id: O, kind: 'client', supplier_id: null, plan_date: null, days: 10, part_no: 1 },
    ]
    T.contractors = [{ id: A, name: 'МТІ', payment_delay_days: 0 }, { id: P, name: 'Плотер-постач', payment_delay_days: 5 }]
    T.order_expenses = []; T.order_transactions = []; T.supplier_orders = []; T.documents = []; T.bank_transactions = []; T.transaction_documents = []
    const [o] = await buildOrderForecasts({ orderIds: [O] })
    const cli = o.lines.filter(l => l.kind === 'income' && l.plan > 0).map(l => [l.key, l.date, l.plan])
    expect(cli).toEqual(expect.arrayContaining([['client', '2026-11-20', 1200], ['client-s2026-12-15', '2026-12-25', 2400]]))
    const sp = o.lines.filter(l => l.supplierId === P).map(l => [l.date, l.plan, l.itemShip])
    expect(sp).toEqual([['2026-12-20', 1200, '2026-12-15']])
    const sa = o.lines.filter(l => l.supplierId === A).map(l => [l.date, l.plan])
    expect(sa).toEqual([['2026-11-10', 600]])
    const vat = o.lines.filter(l => l.key.startsWith('vat')).map(l => [l.key, l.date, l.plan])
    expect(vat).toEqual(expect.arrayContaining([['vat-s2026-12-15', '2027-01-30', 200], ['vat', '2026-12-30', 100]]))
  })
})

// Умови оплати постачальнику (103): частини, відстрочка з картки, відстрочка позиції, ручна дата, факт по черзі.
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

const O = 'o1', A = 'supA', B = 'supB'
const base = () => {
  T.orders = [{ id: O, order_number: '0052', status: 'needs_contract', company_id: 'c1', total: 0, agent_commission_pct: 0, in_forecast: true, companies: { is_vat_payer: true } }]
  // A: 2 × 1200 з ПДВ = 2400; B: 1 × 600 = 600 + позиція B з власною відстрочкою 1 × 1200
  T.order_items = [
    { order_id: O, qty: 2, unit_price: 2000, cost_price: 1200, vat_rate: 20, price_includes_vat: true, supplier_id: A },
    { order_id: O, qty: 1, unit_price: 1000, cost_price: 600, vat_rate: 20, price_includes_vat: true, supplier_id: B },
    { order_id: O, qty: 1, unit_price: 2000, cost_price: 1200, vat_rate: 20, price_includes_vat: true, supplier_id: B, pay_days: 45 },
  ]
  T.order_payment_plan = [
    { order_id: O, kind: 'ship', supplier_id: null, plan_date: '2026-11-10', days: null, part_no: 1 },
    { order_id: O, kind: 'supplier', supplier_id: A, part_no: 1, share_pct: 50, days: -5, plan_date: null, base_date: null, is_manual: false },
    { order_id: O, kind: 'supplier', supplier_id: A, part_no: 2, share_pct: 50, days: 30, plan_date: null, base_date: null, is_manual: false },
  ]
  T.contractors = [{ id: A, name: 'Альфа', payment_delay_days: 10 }, { id: B, name: 'Бета', payment_delay_days: 14 }]
  T.order_expenses = []; T.order_transactions = []; T.supplier_orders = []; T.documents = []; T.bank_transactions = []; T.transaction_documents = []
}

describe('умови оплати постачальнику', () => {
  it('частини, відстрочка з картки, позиція з власною відстрочкою', async () => {
    base()
    const [o] = await buildOrderForecasts({ orderIds: [O] })
    const sup = o.lines.filter(l => l.key.startsWith('sup-'))
    const a = sup.filter(l => l.supplierId === A).sort((x, y) => x.date.localeCompare(y.date))
    expect(a.map(l => [l.date, l.plan])).toEqual([['2026-11-05', 1200], ['2026-12-10', 1200]])
    const b = sup.filter(l => l.supplierId === B).sort((x, y) => x.date.localeCompare(y.date))
    // Бета: 600 — за карткою постачальника (14 дн.), 1200 — позиція з відстрочкою 45 дн.
    expect(b.map(l => [l.date, l.plan, l.ownDays])).toEqual([['2026-11-24', 600, false], ['2026-12-25', 1200, true]])
    // сума карток = собівартість з ПДВ
    expect(sup.reduce((s, l) => s + l.plan, 0)).toBe(4200)
  })
  it('ручна дата частини й дата отримання товару', async () => {
    base()
    T.order_payment_plan[1] = { ...T.order_payment_plan[1], plan_date: '2026-11-01', is_manual: true }
    T.order_payment_plan[2] = { ...T.order_payment_plan[2], base_date: '2026-11-20' }
    const [o] = await buildOrderForecasts({ orderIds: [O] })
    const a = o.lines.filter(l => l.supplierId === A).sort((x, y) => x.date.localeCompare(y.date))
    expect(a.map(l => [l.date, l.manual])).toEqual([['2026-11-01', true], ['2026-12-20', false]])
  })
  it('без умов у замовленні — відстрочка з картки постачальника', async () => {
    base()
    T.order_payment_plan = [T.order_payment_plan[0]]
    const [o] = await buildOrderForecasts({ orderIds: [O] })
    const a = o.lines.filter(l => l.supplierId === A)
    expect(a.map(l => [l.date, l.plan])).toEqual([['2026-11-20', 2400]])
  })
})

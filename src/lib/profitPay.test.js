import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { payStatus, computeTotals } from './profitability'

describe('Прибутковість: оплата клієнта і агентські до сплати', () => {
  it('стан оплати накладної', () => {
    expect(payStatus(1200, { sum: 1200, last: '2026-10-05' }).state).toBe('paid')
    expect(payStatus(1200, { sum: 1199.6 }).state).toBe('paid') // копійки
    const p = payStatus(1200, { sum: 500 })
    expect(p.state).toBe('partial'); expect(p.rest).toBe(700)
    expect(payStatus(1200, undefined).state).toBe('none')
  })
  it('підсумки: борг клієнтів і несплачені агентські', () => {
    const t = computeTotals([
      { sellSum: 1000, profit: 200, vatToPay: 0, commission: 70, net: 130, agentPaid: false, clientPay: payStatus(1200, { sum: 500 }) },
      { sellSum: 1000, profit: 200, vatToPay: 0, commission: 70, net: 130, agentPaid: true, clientPay: payStatus(1200, { sum: 1200 }) },
    ])
    expect(t.agentDue).toBe(70); expect(t.unpaidCount).toBe(1); expect(t.unpaidSum).toBe(700)
  })
})

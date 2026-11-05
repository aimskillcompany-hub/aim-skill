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

import { agentCalc } from './profitability'
describe('Агентські від чистого прибутку', () => {
  it('платник ПДВ: (прибуток − 18%) × %', () => {
    const c = agentCalc(20000, 35, true)
    expect(c.tax).toBe(3600); expect(c.commission).toBe(5740); expect(c.net).toBe(10660)
  })
  it('ФОП: без податку на прибуток', () => {
    expect(agentCalc(20000, 35, false).commission).toBe(7000)
  })
  it('збиток: нічого', () => {
    const c = agentCalc(-500, 35, true)
    expect(c.tax).toBe(0); expect(c.commission).toBe(0); expect(c.net).toBe(-500)
  })
})

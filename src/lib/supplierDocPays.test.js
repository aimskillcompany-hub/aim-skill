import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { proposePays } from './supplierDocPays'

describe('оплати постачальникам через прихідну', () => {
  it('частка замовлення в прихідній × оплата; уже прив’язане й понад вільну суму — ні', () => {
    const allocs = [
      { orderId: 'A', docId: 'D', value: 600 }, { orderId: 'B', docId: 'D', value: 300 },   // 100 ще на складі
    ]
    const pays = [{ docId: 'D', txId: 't1', amount: 1200 }]
    const p = proposePays({ allocs, docTotals: { D: 1000 }, pays, free: { t1: 1200 } })
    expect(p.map(x => [x.orderId, x.amount])).toEqual([['A', 720], ['B', 360]])
    const p2 = proposePays({ allocs, docTotals: { D: 1000 }, pays, linked: new Set(['A|t1']), free: { t1: 400 } })
    expect(p2.map(x => [x.orderId, x.amount])).toEqual([['B', 360]])
    const p3 = proposePays({ allocs, docTotals: { D: 1000 }, pays, free: { t1: 500 } })
    expect(p3.map(x => [x.orderId, x.amount])).toEqual([['A', 500]])
  })
})

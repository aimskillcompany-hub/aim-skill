import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { eliminateIntragroup } from './group'

const row = (id, o) => { const r = { id, cash: 0, stock: 0, fa: 0, recv: 0, pay: 0, loans: 0, ...o }; r.assets = r.cash + r.stock + r.fa + r.recv; r.equity = r.assets - r.pay - r.loans; return r }

describe('eliminateIntragroup', () => {
  it('капітал групи не змінюється, коли обидві сторони обліковані однаково', () => {
    const rows = [row('A', { cash: 100, recv: 60 }), row('B', { cash: 50, pay: 60, loans: 10 })]
    const before = rows.reduce((t, r) => t + r.equity, 0)
    const r = eliminateIntragroup(rows, { A: { recv: 60, pay: 0 }, B: { recv: 0, pay: 60 } })
    expect(r.total.equity).toBe(before)
    expect(r.mismatch).toBe(0)
    expect(r.total.recv).toBe(0)
    expect(r.total.pay).toBe(0)
    expect(r.rows[0].assets).toBe(100)
  })
  it('несиметричний облік показує розбіжність', () => {
    const rows = [row('A', { recv: 60 }), row('B', { pay: 40 })]
    const r = eliminateIntragroup(rows, { A: { recv: 60, pay: 0 }, B: { recv: 0, pay: 40 } })
    expect(r.mismatch).toBe(20)
    expect(r.total.equity).toBe(rows.reduce((t, x) => t + x.equity, 0) - 20)
  })
  it('без внутрішньогрупових боргів нічого не змінює', () => {
    const rows = [row('A', { cash: 10, recv: 5 })]
    const r = eliminateIntragroup(rows, {})
    expect(r.rows[0]).toMatchObject({ recv: 5, equity: 15 })
    expect(r.mismatch).toBe(0)
  })
})

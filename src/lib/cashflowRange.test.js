import { describe, it, expect, vi } from 'vitest'

const { q } = vi.hoisted(() => {
const TX = [
  { id: 't1', account_id: 'a', amount: 1000, article: 'Продаж', date: '2026-09-30' },   // до періоду → залишок на початок
  { id: 't2', account_id: 'a', amount: 5000, article: 'Продаж', date: '2026-10-01' },
  { id: 't3', account_id: 'a', amount: -2000, article: 'Закупка', date: '2026-10-15' },
  { id: 't4', account_id: 'a', amount: 700, article: 'Продаж', date: '2026-11-03' },
  { id: 't5', account_id: 'a', amount: 999, article: 'Продаж', date: '2026-11-20' },    // після періоду
]
const q = (table) => {
  let data = table === 'accounts' ? [{ id: 'a', opening_balance: 100, opening_balance_date: null }] : TX.slice()
  const api = {
    select: () => api, eq: () => api, order: () => api,
    gte: (k, v) => { data = data.filter(r => r[k] >= v); return api }, lte: (k, v) => { data = data.filter(r => r[k] <= v); return api },
    lt: (k, v) => { data = data.filter(r => r[k] < v); return api },
    then: (res) => res({ data, error: null }),
  }
  return api
}
return { q }
})
vi.mock('./companyScope', () => ({ qc: q }))
vi.mock('./supabase', () => ({ supabase: { from: q } }))
vi.mock('./fetchAll', () => ({ fetchAllData: async (mk) => mk(), fetchAll: async (mk) => (await mk()).data, fetchAllIn: async () => [] }))
vi.mock('./txSplits', () => ({ withSplits: async (l) => l }))
import { computeCashFlow } from './cashflow'

describe('Cash Flow за довільний період', () => {
  it('01.10–10.11: колонки-місяці, залишки', async () => {
    const d = await computeCashFlow(2026, null, { range: { from: '2026-10-01', to: '2026-11-10' } })
    expect(d.cols.map(c => c.key)).toEqual(['2026-10', '2026-11'])
    expect(d.openingCash).toBe(1100)
    expect(d.inflow.total).toBe(5700); expect(d.outflow.total).toBe(2000)
    expect(d.netByCol['2026-10']).toBe(3000); expect(d.netByCol['2026-11']).toBe(700)
    expect(d.closingCash).toBe(4800)
  })
  it('до 31 дня — колонки-дні', async () => {
    const d = await computeCashFlow(2026, null, { range: { from: '2026-10-01', to: '2026-10-15' } })
    expect(d.cols).toHaveLength(15)
    expect(d.netByCol['2026-10-15']).toBe(-2000)
  })
})

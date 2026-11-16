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

describe('Акти наданих послуг у прибутковості', () => {
  it('собівартість акту — вхідні акти замовлення, пропорційно', async () => {
    vi.resetModules()
    const rows = {
      documents: [
        { id: 'a1', type: 'serviceAct', doc_role: 'outgoing', doc_number: 'АКТ-1', doc_date: '2026-10-10', contractor_id: 'c1', order_id: 'o1', amount: 120000, vat_amount: 20000 },
        { id: 'a2', type: 'serviceAct', doc_role: 'outgoing', doc_number: 'АКТ-2', doc_date: '2026-10-12', contractor_id: 'c1', order_id: 'o1', amount: 60000, vat_amount: 10000 },
        { id: 'in1', type: 'serviceAct', doc_role: 'incoming', doc_number: 'П-1', doc_date: '2026-10-05', contractor_id: 's1', order_id: 'o1', amount: 72000, vat_amount: 12000 },
        { id: 'a3', type: 'serviceAct', doc_role: 'outgoing', doc_number: 'АКТ-3', doc_date: '2026-10-15', contractor_id: 'c1', order_id: null, amount: 12000, vat_amount: 2000 },
      ],
    }
    const q = (table) => {
      let data = (rows[table] || []).slice()
      const api = {
        select: () => api, eq: (k, v) => { data = data.filter(r => r[k] === v); return api }, in: (k, vs) => { data = data.filter(r => vs.includes(r[k])); return api },
        gte: (k, v) => { data = data.filter(r => (r[k] || '') >= v); return api }, lte: (k, v) => { data = data.filter(r => (r[k] || '') <= v); return api },
        not: () => api, order: () => api, range: () => api, limit: () => api,
        then: (res) => res({ data, error: null }),
      }
      return api
    }
    vi.doMock('./supabase', () => ({ supabase: { from: q } }))
    vi.doMock('./companyScope', () => ({ qc: q, setReportScope: () => {}, runExclusive: (f) => f() }))
    vi.doMock('./companyConfig', () => ({ clearCompanyCache: () => {} }))
    vi.doMock('./fetchAll', () => ({
      fetchAll: async (mk) => (await mk()).data || [],
      fetchAllIn: async (mk, col, ids) => ((await mk()).data || []).filter(r => ids.includes(r[col])),
    }))
    vi.doMock('./debts', () => ({ loadDocPayments: async () => [] }))
    const { computeProfitability } = await import('./profitability')
    const r = await computeProfitability('co', true, '2026-10-01', '2026-10-31')
    const by = Object.fromEntries(r.invoices.map(i => [i.doc_number, i]))
    expect(Object.keys(by).sort()).toEqual(['АКТ-1', 'АКТ-2', 'АКТ-3']) // вхідний акт — не реалізація
    expect(by['АКТ-1'].kind).toBe('act')
    expect(by['АКТ-1'].sellSum).toBe(100000); expect(by['АКТ-1'].buySum).toBe(40000)   // 60 000 × 100/150
    expect(by['АКТ-2'].buySum).toBe(20000)
    expect(by['АКТ-1'].vatToPay).toBe(20000 - 8000)
    expect(by['АКТ-3'].buySum).toBe(0); expect(by['АКТ-3'].costSource).toBe(null)
  })
})

describe('Операції без ПДВ', () => {
  it('документ із ПДВ 0 → ПДВ до сплати 0', async () => {
    vi.resetModules()
    const rows = {
      documents: [{ id: 'w1', type: 'waybill', doc_number: '3', doc_date: '2026-02-24', contractor_id: 'c1', order_id: null, amount: 1000, vat_amount: 0 },
                  { id: 'w2', type: 'waybill', doc_number: '4', doc_date: '2026-02-25', contractor_id: 'c1', order_id: null, amount: 1200, vat_amount: 200 }],
      stock_movements: [{ id: 'm1', document_id: 'w1', product_id: 'p', quantity: 1, price: 1000, cost_price: 600, type: 'out' },
                        { id: 'm2', document_id: 'w2', product_id: 'p', quantity: 1, price: 1000, cost_price: 600, type: 'out' }],
      products: [{ id: 'p', name: 'Ноутбук', unit: 'шт', buy_price: 600 }],
    }
    const q = (table) => {
      let data = (rows[table] || []).slice()
      const api = { select: () => api, eq: (k, v) => { data = data.filter(r => r[k] === v); return api }, in: (k, vs) => { data = data.filter(r => vs.includes(r[k])); return api },
        gte: (k, v) => { data = data.filter(r => (r[k] || '') >= v); return api }, lte: (k, v) => { data = data.filter(r => (r[k] || '') <= v); return api },
        not: () => api, order: () => api, range: () => api, limit: () => api, then: (res) => res({ data, error: null }) }
      return api
    }
    vi.doMock('./supabase', () => ({ supabase: { from: q } }))
    vi.doMock('./companyScope', () => ({ qc: q, setReportScope: () => {}, runExclusive: (f) => f() }))
    vi.doMock('./companyConfig', () => ({ clearCompanyCache: () => {} }))
    vi.doMock('./fetchAll', () => ({ fetchAll: async (mk) => (await mk()).data || [], fetchAllIn: async (mk, col, ids) => ((await mk()).data || []).filter(r => ids.includes(r[col])) }))
    vi.doMock('./debts', () => ({ loadDocPayments: async () => [] }))
    const { computeProfitability } = await import('./profitability')
    const r = await computeProfitability('co', true, '2026-02-01', '2026-02-28')
    const by = Object.fromEntries(r.invoices.map(i => [i.doc_number, i]))
    expect(by['3'].vatFree).toBe(true); expect(by['3'].vatToPay).toBe(0)
    expect(by['4'].vatFree).toBe(false); expect(by['4'].vatToPay).toBe(200)
    expect(by['3'].profit).toBe(400)
  })
})

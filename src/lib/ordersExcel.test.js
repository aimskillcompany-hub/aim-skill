import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./companyScope', () => ({ qc: () => ({}) }))
vi.mock('./forecast', () => ({ savePaymentPlanEntry: vi.fn() }))
vi.mock('./snapshots', () => ({ takeSnapshot: vi.fn(), supersedeSnapshot: vi.fn(), isMissingSnapTable: () => true }))
vi.mock('./stockService', () => ({ resolveProduct: vi.fn() }))
import { buildRows, buildPlan, O_COLS, I_COLS } from './ordersExcel'

const OID = '11111111-1111-1111-1111-111111111111', IID = '22222222-2222-2222-2222-222222222222', CLOSED = '33333333-3333-3333-3333-333333333333'
const data = () => ({
  orders: [
    { id: OID, order_number: '0027', type: 'trade', status: 'shipped', client_id: 'c1', manager_id: 'p1', in_forecast: false, agent_commission_pct: null, total: 2400, created_at: '2026-10-01T10:00:00Z' },
    { id: CLOSED, order_number: '0002', type: 'trade', status: 'closed', client_id: 'c1', in_forecast: false, total: 0, created_at: '2026-01-01T10:00:00Z' },
  ],
  items: [{ id: IID, order_id: OID, name: 'Плотер', qty: 1, unit: 'шт', cost_price: 1200, unit_price: 2400, vat_rate: 20, price_includes_vat: true, supplier_id: 's1', created_at: '2026-10-01' }],
  plans: [{ order_id: OID, kind: 'client', days: 30, plan_date: null }],
  profs: [{ id: 'p1', full_name: 'Дмитро Редько' }, { id: 'p2', full_name: 'Олена Коваль' }],
  contractors: [{ id: 'c1', name: 'ГУНП', edrpou: '40108646' }, { id: 's1', name: 'ТОВ "МТІ"', edrpou: '12345678' }],
})
const all = [...data().contractors, { id: 's2', name: 'ТОВ «КОМЕЛ»', edrpou: '87654321' }]

describe('замовлення ↔ Excel', () => {
  it('вивантажений файл без змін — план порожній', () => {
    const d = data(); const { oRows, iRows } = buildRows(d)
    expect(oRows).toHaveLength(2); expect(iRows).toHaveLength(1)
    expect(Object.keys(oRows[0])).toEqual(O_COLS.map(c => c[1])); expect(Object.keys(iRows[0])).toEqual(I_COLS.map(c => c[1]))
    const p = buildPlan({ oRows, iRows }, d, all)
    expect(p.count).toBe(0); expect(p.errors).toEqual([])
  })
  it('зміни замовлення й позиції, нова позиція, закрите — пропущено, помилки', () => {
    const d = data(); const { oRows, iRows } = buildRows(d)
    const o = oRows.find(r => r['№'] === '0027'), c = oRows.find(r => r['№'] === '0002')
    o['Статус'] = 'Оплачено'; o['Менеджер'] = 'Олена Коваль'; o['В прогнозі'] = 'так'; o['Дата відвантаження'] = '15.12.2026'; o['Клієнт платить через, дн.'] = 10
    c['Опис'] = 'щось'
    iRows[0]['К-сть'] = 2; iRows[0]['Постачальник'] = 'тов комел'; iRows[0]['Відвантаження позиції'] = '20.12.2026'
    iRows.push({ 'ID позиції': '', '№ замовлення': '0027', 'Назва': 'Картридж', 'К-сть': 3, 'Ціна продажу за од.': 100 })
    iRows.push({ 'ID позиції': '', '№ замовлення': '0999', 'Назва': 'Нічия', 'К-сть': 1 })
    o['Клієнт'] = 'Невідомий клієнт'
    const p = buildPlan({ oRows, iRows }, d, all)
    const oc = p.orderChanges[0].changes.map(x => [x.label, x.to])
    expect(oc).toEqual(expect.arrayContaining([['Статус', 'Оплачено'], ['Менеджер', 'Олена Коваль'], ['В прогнозі', 'так'], ['Дата відвантаження', '15.12.2026'], ['Клієнт платить через, дн.', 10]]))
    const it = p.itemChanges[0]
    expect(it.edits[IID].map(x => [x.f, x.val])).toEqual(expect.arrayContaining([['qty', 2], ['supplier_id', 's2'], ['ship_date', '2026-12-20']]))
    expect(it.adds).toHaveLength(1); expect(it.adds[0]).toMatchObject({ name: 'Картридж', qty: 3, unit_price: 100 })
    expect(p.errors.some(e => /0002.*закрите/.test(e))).toBe(true)
    expect(p.errors.some(e => /0999/.test(e))).toBe(true)
    expect(p.errors.some(e => /Невідомий клієнт/.test(e))).toBe(true)
  })
  it('повний цикл через xlsx: без правок — змін немає', async () => {
    const XLSX = await import('xlsx')
    const d = data(); const { oRows, iRows } = buildRows(d)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oRows, { header: O_COLS.map(c => c[1]) }), 'Замовлення')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(iRows, { header: I_COLS.map(c => c[1]) }), 'Позиції')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const rb = XLSX.read(buf, { type: 'array', cellDates: true })
    const back = { oRows: XLSX.utils.sheet_to_json(rb.Sheets['Замовлення'], { defval: '' }), iRows: XLSX.utils.sheet_to_json(rb.Sheets['Позиції'], { defval: '' }) }
    const p = buildPlan(back, d, all)
    expect(p.errors).toEqual([]); expect(p.count).toBe(0)
  })
})

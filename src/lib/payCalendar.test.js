import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { buildCalendar, holdingOrders, calendarRows, matchPaid, lineType } from './payCalendar'

const T = '2026-10-26'
const order = (id, number, client, lines) => ({ id, number, client, companyId: 'c1', lines })
const L = (key, kind, remaining, date, extra = {}) => ({ key, kind, label: extra.label || key, remaining, plan: remaining, fact: 0, date, ...extra })

const orders = [
  order('o52', '0052', 'ДУ «ЦОП НПУ»', [
    L('sup-a-p1', 'expense', 14000000, '2026-12-01', { supplierId: 's1', label: 'ТОВ «А»' }),
    L('client', 'income', 15000000, '2026-12-11'),
  ]),
  order('o27', '0027', 'ГУНП', [
    L('sup-b-p1', 'expense', 470000, '2026-10-20', { supplierId: 's2', label: 'ТОВ «МТІ»' }),   // прострочено
    L('client', 'income', 240000, '2026-11-05', { estimated: true }),
  ]),
]

describe('платіжний календар', () => {
  it('тип рядка', () => {
    expect(lineType({ kind: 'income' })).toBe('client')
    expect(lineType({ kind: 'expense', label: 'ПДВ до сплати' })).toBe('vat')
    expect(lineType({ kind: 'expense', key: 'agent', label: 'Агентські' })).toBe('agent')
    expect(lineType({ kind: 'expense', key: 'sup-x', label: 'ТОВ' })).toBe('supplier')
  })

  it('прострочене переноситься на сьогодні', () => {
    const rows = calendarRows({ orders, today: T })
    const late = rows.find(r => r.orderId === 'o27' && r.amount < 0)
    expect(late.date).toBe(T); expect(late.overdue).toBe(true); expect(late.origDate).toBe('2026-10-20')
  })

  it('залишок по днях, розрив, причина і перемикач «без №»', () => {
    const c = buildCalendar({ orders, manual: [], startCash: 1000000, today: T })
    expect(c.days[0]).toMatchObject({ date: T, start: 1000000, net: -470000, end: 530000 })
    expect(c.gap).toMatchObject({ date: '2026-12-01', value: 530000 + 240000 - 14000000, to: '2026-12-11' })
    expect(c.gap.from).toBe('2026-12-01'); expect(c.gap.duration).toBe(10)
    expect(c.cause.number).toBe('0052'); expect(c.cause.share).toBeGreaterThan(0.98)
    expect(c.cause.clientDate).toBe('2026-12-11')
    expect(c.cause.withoutMin).toBe(530000)          // без №0052 мінусу немає
    expect(c.totals).toMatchObject({ inc: 15240000, out: -14470000, end: 1770000, lastDate: '2026-12-11' })
    const ex = buildCalendar({ orders, manual: [], startCash: 1000000, today: T, exclude: '0052' })
    expect(ex.excluded).toBe('0052'); expect(ex.gap).toBe(null); expect(ex.totals.end).toBe(770000)
  })

  it('«тримають гроші»: період і «не повертається»', () => {
    const rows = calendarRows({ orders, today: T })
    const h = holdingOrders(rows)
    expect(h[0]).toMatchObject({ number: '0052', hold: -14000000, from: '2026-12-01', to: '2026-12-11', days: 10 })
    expect(h[1]).toMatchObject({ number: '0027', hold: -470000, from: T, to: null })
  })

  it('«можливо, вже оплачено»: контрагент, сума ±1% / ±50, неприв’язані', () => {
    const rows = calendarRows({ orders, today: T })
    const lines = rows.filter(r => r.type === 'supplier' && r.overdue)
    const sups = { s2: { id: 's2', name: 'ТОВ «МТІ»', edrpou: '123' } }
    const txs = [
      { id: 't1', date: '2026-10-21', amount: -470040, edrpou: '123', counterparty: 'МТІ' },
      { id: 't2', date: '2026-10-22', amount: -300000, edrpou: '123' },             // сума не та
      { id: 't3', date: '2026-10-23', amount: -470000, edrpou: '999' },             // інший контрагент
    ]
    const p = matchPaid(lines, txs, sups, T)
    expect(p[0]).toMatchObject({ partial: false, amount: 470040 }); expect(p[0].tx.id).toBe('t1')
    expect(p.filter(x => x.tx.id === 't3')).toHaveLength(0)                       // інший контрагент — ніколи
    expect(matchPaid(lines, [{ id: 't4', date: '2026-07-01', amount: -470000, edrpou: '123' }], sups, T)).toHaveLength(0)   // старше 90 днів
  })

  it('часткові оплати: залишок платежу розкладається на прострочені замовлення від найстаріших', () => {
    const sups = { s9: { id: 's9', name: 'ІП «I-AP-CI»', edrpou: '555' } }
    const lines = [
      { key: 'sup-s9-p1', orderId: 'o89', number: '0089', supplierId: 's9', amount: -100000, origDate: '2026-10-10' },
      { key: 'sup-s9-p1', orderId: 'o55', number: '0055', supplierId: 's9', amount: -60000, origDate: '2026-10-01' },
    ]
    const txs = [
      { id: 'a', date: '2026-10-15', amount: -90000, edrpou: '555' },
      { id: 'b', date: '2026-10-20', amount: -200000, edrpou: '555', free: 30000 },   // уже частково розподілена
    ]
    const p = matchPaid(lines, txs, sups, T)
    expect(p.every(x => x.partial)).toBe(true)
    expect(p.map(x => [x.tx.id, x.line.number, x.amount])).toEqual([['a', '0055', 60000], ['a', '0089', 30000], ['b', '0089', 30000]])
  })
})

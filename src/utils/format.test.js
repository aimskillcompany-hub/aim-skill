import { describe, it, expect } from 'vitest'
import { formatMoney, formatAmount, formatShort, formatDate, MINUS, NNBSP } from './format'

// нерозривні пробіли uk-UA (U+00A0 / U+202F) → звичайні, щоб порівнювати з текстом ТЗ
const plain = (s) => s.replace(/[  ]/g, ' ')

describe('formatMoney', () => {
  it('тисячі через пробіл, кома, 2 знаки', () => {
    expect(plain(formatMoney(2816143.75))).toBe('2 816 143,75')
    expect(plain(formatMoney(538614))).toBe('538 614,00')
    expect(plain(formatMoney(109717.5))).toBe('109 717,50')
  })
  it('рядок-число, нуль, від’ємні', () => {
    expect(plain(formatMoney('13200'))).toBe('13 200,00')
    expect(formatMoney(0)).toBe('0,00')
    expect(plain(formatMoney(-1500.456))).toBe('\u22121 500,46')
  })
  it('порожнє → «—»', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(undefined)).toBe('—')
    expect(formatMoney('')).toBe('—')
    expect(formatMoney('abc')).toBe('—')
  })
})

describe('formatAmount (ТЗ: «−» і вузький пробіл)', () => {
  it('роздільник тисяч — U+202F, мінус — U+2212', () => {
    expect(formatAmount(-1307205, { decimals: 0 })).toBe(`${MINUS}1${NNBSP}307${NNBSP}205`)
    expect(formatAmount(2218346, { decimals: 0, currency: true })).toBe(`2${NNBSP}218${NNBSP}346${NNBSP}₴`)
  })
  it('знак «+» на вимогу; нуль без знака', () => {
    expect(formatAmount(911141, { decimals: 0, sign: 'always' })).toBe(`+911${NNBSP}141`)
    expect(formatAmount(-0.001)).toBe('0,00')
    expect(formatAmount(0, { sign: 'always' })).toBe('0,00')
  })
  it('без звичайного дефіса й звичайних пробілів', () => {
    const s = formatAmount(-24887553.5)
    expect(s).not.toMatch(/[- \u00A0]/)
  })
})

describe('formatShort', () => {
  const p = (s) => s.replace(/\u202F/g, ' ')
  it('тис / млн / дрібні', () => {
    expect(p(formatShort(641000))).toBe('641 тис')
    expect(p(formatShort(2700000))).toBe('2,7 млн')
    expect(p(formatShort(20534000))).toBe('20,5 млн')
    expect(p(formatShort(4500000))).toBe('4,5 млн')
    expect(p(formatShort(1000000))).toBe('1 млн')
    expect(formatShort(950)).toBe('950')
    expect(p(formatShort(-589000))).toBe('\u2212589 тис')
  })
})

describe('formatDate', () => {
  const now = new Date('2026-10-22T10:00:00Z')   // четвер, 22 жов 2026 (Київ)
  it('сьогодні / завтра / вчора', () => {
    expect(formatDate('2026-10-22', { now })).toBe('Сьогодні')
    expect(formatDate('2026-10-23', { now })).toBe('Завтра')
    expect(formatDate('2026-10-21', { now })).toBe('Вчора')
  })
  it('поточний рік — без року', () => {
    expect(formatDate('2026-09-01', { now })).toBe('1 вер')
    expect(formatDate('2026-10-26', { now, withWeekday: true })).toBe('пн, 26 жов')
  })
  it('інший рік — з роком', () => {
    expect(formatDate('2025-06-06', { now })).toBe('6 чер 2025')
    expect(formatDate('2027-01-05', { now, withWeekday: true })).toBe('вт, 5 січ 2027')
  })
  it('повний ISO-час рахується за Києвом', () => {
    // 21.10 22:30 UTC = 22.10 01:30 за Києвом → «Сьогодні»
    expect(formatDate('2026-10-21T22:30:00Z', { now })).toBe('Сьогодні')
  })
  it('без жодної крапки', () => {
    for (const d of ['2026-01-15', '2026-03-03', '2025-12-31']) expect(formatDate(d, { now, withWeekday: true })).not.toMatch(/\./)
  })
  it('порожнє / зіпсоване → «—»', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('не дата')).toBe('—')
  })
})

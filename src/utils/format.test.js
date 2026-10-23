import { describe, it, expect } from 'vitest'
import { formatMoney, formatDate } from './format'

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
    expect(plain(formatMoney(-1500.456))).toMatch(/^-1 500,46$/)
  })
  it('порожнє → «—»', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(undefined)).toBe('—')
    expect(formatMoney('')).toBe('—')
    expect(formatMoney('abc')).toBe('—')
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

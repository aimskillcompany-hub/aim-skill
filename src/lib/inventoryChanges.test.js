import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { inventoryChanges } from './accrual'

const item = (id, qty, value) => ({ id, name: `Товар ${id}`, unit: 'шт', qty, value })

describe('Звірка: зміна запасів по товарах', () => {
  it('незмінний залишок не показує', () => {
    expect(inventoryChanges([item('a', 1, 14857.27)], [item('a', 1, 14857.27)])).toEqual([])
  })
  it('новий, проданий і частково проданий товар одним рядком', () => {
    const rows = inventoryChanges(
      [item('sold', 1, 5658.34), item('part', 3, 300)],
      [item('new', 1, 98527.66), item('part', 1, 100)],
    )
    expect(rows.map(r => [r.title, r.sub, r.amount])).toEqual([
      ['Товар sold', 'було 1 шт, стало 0 шт', 5658.34],
      ['Товар part', 'було 3 шт, стало 1 шт', 200],
      ['Товар new', 'було 0 шт, стало 1 шт', -98527.66],
    ])
  })
  it('сума рядків дорівнює −Δзапасів, навіть якщо товарів понад 10', () => {
    const opening = Array.from({ length: 15 }, (_, n) => item(`o${n}`, 1, 100 + n))
    const closing = Array.from({ length: 15 }, (_, n) => item(`c${n}`, 2, 500 + n))
    const delta = closing.reduce((s, x) => s + x.value, 0) - opening.reduce((s, x) => s + x.value, 0)
    const rows = inventoryChanges(opening, closing)
    expect(rows).toHaveLength(30)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(-delta, 2)
  })
})

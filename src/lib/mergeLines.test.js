import { describe, it, expect } from 'vitest'
import { mergeSameLines } from './orderPlan'

describe('документи клієнта: рядки, розділені між постачальниками, — одним рядком', () => {
  it('зливає однаковий товар і ціну продажу, різне — лишає', () => {
    const items = [
      { name: 'PMNN4807A', unit: 'шт', qty: 100, unit_price: 3320, vat_rate: 20, price_includes_vat: false, supplier_id: 'A', cost_price: 850 },
      { name: 'PMNN4544A', unit: 'шт', qty: 160, unit_price: 1847, vat_rate: 20, price_includes_vat: false },
      { name: 'PMNN4807A ', unit: 'шт', qty: 40, unit_price: 3320, vat_rate: 20, price_includes_vat: false, supplier_id: 'B', cost_price: 900 },
      { name: 'PMNN4807A', unit: 'шт', qty: 5, unit_price: 3000, vat_rate: 20, price_includes_vat: false },
    ]
    const m = mergeSameLines(items)
    expect(m.map(x => [x.name.trim(), x.qty, x.unit_price])).toEqual([['PMNN4807A', 140, 3320], ['PMNN4544A', 160, 1847], ['PMNN4807A', 5, 3000]])
    expect(items[0].qty).toBe(100)   // вхідні рядки не змінюються
  })
})

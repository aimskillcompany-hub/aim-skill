import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./companyScope', () => ({ qc: () => ({}) }))
import { rangeCols, rangeBucket, rangeKeyBounds } from './pl'

describe('P&L з … по …', () => {
  it('довгий період — колонки по місяцях через роки', () => {
    const c = rangeCols('2025-01-01', '2026-09-30')
    expect(c).toHaveLength(21); expect(c[0]).toEqual({ key: '2025-01', label: 'Січ 25' }); expect(c[20]).toEqual({ key: '2026-09', label: 'Вер 26' })
    expect(rangeBucket('2025-01-01', '2026-09-30')('2025-07-17')).toBe('2025-07')
  })
  it('до 31 дня — по днях', () => {
    const c = rangeCols('2026-10-05', '2026-10-20')
    expect(c).toHaveLength(16); expect(c[0]).toEqual({ key: '2026-10-05', label: '5.10' })
    expect(rangeBucket('2026-10-05', '2026-10-20')('2026-10-07')).toBe('2026-10-07')
  })
  it('межі клітинки обрізаються періодом', () => {
    const r = { from: '2025-01-15', to: '2026-09-10' }
    expect(rangeKeyBounds(r, '2025-01')).toEqual({ from: '2025-01-15', to: '2025-01-31' })
    expect(rangeKeyBounds(r, '2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-10' })
    expect(rangeKeyBounds(r, 'total')).toEqual({ from: '2025-01-15', to: '2026-09-10' })
    expect(rangeKeyBounds(r, '2026-02-03')).toEqual({ from: '2026-02-03', to: '2026-02-03' })
  })
})

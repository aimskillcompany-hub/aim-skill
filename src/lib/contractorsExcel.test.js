import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { buildRows, buildPlan, C_FIELDS } from './contractorsExcel'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const data = () => ({
  rows: [
    { id: A, name: 'ТОВ "МТІ"', edrpou: '12345678', is_client: false, is_supplier: true, is_vat_payer: true, iban: '', payment_delay_days: 0, contract_valid_until: null },
    { id: B, name: 'ГУНП', edrpou: '40108646', is_client: true, is_supplier: false, is_vat_payer: false, iban: null, payment_delay_days: 10, contract_valid_until: '2026-12-31' },
  ],
  fields: C_FIELDS.filter(f => ['name', 'edrpou', 'is_client', 'is_supplier', 'is_vat_payer', 'iban', 'payment_delay_days', 'contract_valid_until'].includes(f[0])),
})

describe('контрагенти ↔ Excel', () => {
  it('без змін — план порожній, повний цикл через xlsx', async () => {
    const XLSX = await import('xlsx')
    const d = data(), rows = buildRows(d)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Контрагенти')
    const back = XLSX.utils.sheet_to_json(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true }).Sheets['Контрагенти'], { defval: '' })
    const p = buildPlan(back, d)
    expect(p.errors).toEqual([]); expect(p.count).toBe(0)
  })
  it('зміни, новий, дубль ЄДРПОУ, помилки', () => {
    const d = data(), rows = buildRows(d)
    const mti = rows.find(r => r['Назва'] === 'ТОВ "МТІ"')
    mti['Клієнт'] = 'так'; mti['Відстрочка, дн.'] = 14; mti['IBAN'] = 'UA213223130000026007233566001'
    rows.find(r => r['Назва'] === 'ГУНП')['Договір дійсний до'] = '31.12.2027'
    rows.push({ 'ID контрагента': '', 'Назва': 'ТОВ «КОМЕЛ»', 'ЄДРПОУ': '87654321', 'Постачальник': 'так', 'Клієнт': 'ні', 'Платник ПДВ': 'так' })
    rows.push({ 'ID контрагента': '', 'Назва': 'Дубль МТІ', 'ЄДРПОУ': '12345678', 'Клієнт': 'ні', 'Постачальник': 'так', 'Платник ПДВ': 'так' })
    rows.push({ 'ID контрагента': '', 'Назва': 'Кривий', 'ЄДРПОУ': '123', 'Клієнт': 'ні', 'Постачальник': 'ні', 'Платник ПДВ': 'ні' })
    const p = buildPlan(rows, d)
    const m = p.updates.find(u => u.row.id === A).changes.map(c => [c.f, c.val])
    expect(m).toEqual(expect.arrayContaining([['is_client', true], ['payment_delay_days', 14], ['iban', 'UA213223130000026007233566001']]))
    expect(p.updates.find(u => u.row.id === B).changes.map(c => [c.f, c.val])).toEqual([['contract_valid_until', '2027-12-31']])
    expect(p.creates).toHaveLength(1); expect(p.creates[0].row).toMatchObject({ name: 'ТОВ «КОМЕЛ»', edrpou: '87654321', is_supplier: true, payment_delay_days: 0 })
    expect(p.errors.some(e => /12345678 уже є/.test(e))).toBe(true)
    expect(p.errors.some(e => /8 або 10 цифр/.test(e))).toBe(true)
  })
})

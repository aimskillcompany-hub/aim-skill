import { describe, it, expect, vi } from 'vitest'
const written = {}
vi.mock('xlsx', async () => {
  const real = await vi.importActual('xlsx')
  return { ...real, writeFile: (wb) => { written.wb = wb } }
})
vi.mock('./docgen/pdfBuilder', () => ({ downloadPdf: () => {} }))
import * as XLSX from 'xlsx'
import { exportReportXlsx } from './reportExport'

describe('Excel звітів: дата — справжня дата', () => {
  it('YYYY-MM-DD → комірка-дата ДД.ММ.РРРР', () => {
    exportReportXlsx({ fileName: 't', columns: [{ key: 'doc', label: 'Накладна' }, { key: 'date', label: 'Дата', date: true }], rows: [{ doc: 'ВН-0051', date: '2026-10-27' }, { doc: 'x', date: '' }] })
    const ws = written.wb.Sheets[written.wb.SheetNames[0]]
    expect(ws.B2.t).toBe('d')
    // як побачить Excel: зберегти у файл і прочитати назад
    const back = XLSX.read(XLSX.write(written.wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    const c = back.Sheets[back.SheetNames[0]].B2
    expect(c.t).toBe('n')                       // число-дата, а не текст
    expect(c.w).toBe('27.10.2026')               // формат ДД.ММ.РРРР
    expect(back.Sheets[back.SheetNames[0]].B3?.v ?? '').toBe('')
  })
  it('додатковий аркуш «Товари»', () => {
    exportReportXlsx({ fileName: 't', sheet: 'Прибутковість', columns: [{ key: 'doc', label: 'Накладна' }], rows: [{ doc: 'ВН-1' }],
      sheets: [{ sheet: 'Товари', columns: [{ key: 'name', label: 'Товар' }, { key: 'buySum', label: 'Собівартість, сума', num: true }], rows: [{ name: 'Ноутбук', buySum: 25000 }] }] })
    expect(written.wb.SheetNames).toEqual(['Прибутковість', 'Товари'])
    expect(written.wb.Sheets['Товари'].B2.v).toBe(25000)
  })
})

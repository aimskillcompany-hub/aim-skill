// Експорт таблиці звіту в Excel і PDF (ТЗ редизайну 5.4: «експорт Excel/PDF» у спільній шапці «Звітів»).
//   columns: [{ key, label, num?, date? }], rows: [{ [key]: value }], total?: { [key]: value }
//   date — значення YYYY-MM-DD: у Excel справжня дата (ДД.ММ.РРРР, фільтр і сортування за датою), у PDF — ДД.ММ.РРРР
// PDF — pdfmake (кирилиця з docgen); ₴ → «грн», бо у вбудованому шрифті немає гліфа гривні.
import * as XLSX from 'xlsx'
import { downloadPdf } from './docgen/pdfBuilder'

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2, minimumFractionDigits: 0 })
const cell = (v, num) => num ? (v == null || v === '' ? '' : (Number(v) < 0 ? '−' : '') + fmt.format(Math.abs(Number(v) || 0))) : (v ?? '')
const isoRe = /^\d{4}-\d{2}-\d{2}/
const dmy = (v) => isoRe.test(String(v || '')) ? String(v).slice(0, 10).split('-').reverse().join('.') : (v ?? '')
// полудень UTC — щоб часовий пояс не зсунув дату на день
const toDate = (v) => isoRe.test(String(v || '')) ? new Date(String(v).slice(0, 10) + 'T12:00:00Z') : (v ?? '')
// крапки в екрануванні: «dd.mm.yyyy» SheetJS не розбирає (bad second format)
const DATE_NF = 'dd\\.mm\\.yyyy'
const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-')

export function exportReportXlsx({ fileName, sheet = 'Звіт', columns, rows, total }) {
  const val = (c, v) => c.date ? toDate(v) : (v ?? '')
  const aoa = [columns.map(c => c.label), ...rows.map(r => columns.map(c => val(c, r[c.key])))]
  if (total) aoa.push(columns.map(c => val(c, total[c.key])))
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: DATE_NF })
  columns.forEach((c, ci) => {
    if (!c.date) return
    for (let ri = 1; ri < aoa.length; ri++) { const ref = XLSX.utils.encode_cell({ r: ri, c: ci }); if (ws[ref]?.t === 'd') ws[ref].z = DATE_NF }
  })
  ws['!cols'] = columns.map(c => ({ wch: c.num ? 14 : Math.min(48, Math.max(10, c.label.length + 4)) }))
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31))
  XLSX.writeFile(wb, `${safe(fileName)}.xlsx`)
}

// after — довільні блоки під таблицею: [{ heading, text }] (напр. «Обговорення» в протоколі наради)
export function exportReportPdf({ fileName, title, subtitle, columns, rows, total, after = [] }) {
  const head = columns.map(c => ({ text: c.label, bold: true, fontSize: 8, color: '#5B655F', alignment: c.num ? 'right' : 'left', fillColor: '#F7F8F6' }))
  const body = rows.map(r => columns.map(c => ({ text: String(c.date ? dmy(r[c.key]) : cell(r[c.key], c.num)), fontSize: 8.5, alignment: c.num ? 'right' : 'left' })))
  if (total) body.push(columns.map(c => ({ text: String(cell(total[c.key], c.num)), fontSize: 8.5, bold: true, alignment: c.num ? 'right' : 'left', fillColor: '#F7F8F6' })))
  downloadPdf({
    pageSize: 'A4', pageOrientation: columns.length > 5 ? 'landscape' : 'portrait', pageMargins: [28, 28, 28, 28],
    content: [
      { text: title, fontSize: 15, bold: true },
      subtitle ? { text: subtitle, fontSize: 9, color: '#5B655F', margin: [0, 2, 0, 10] } : { text: '', margin: [0, 0, 0, 8] },
      { table: { headerRows: 1, widths: columns.map(c => c.num ? 'auto' : '*'), body: [head, ...body] }, layout: { hLineColor: () => '#EEF0EC', vLineWidth: () => 0, hLineWidth: () => 0.6, paddingTop: () => 4, paddingBottom: () => 4 } },
      ...after.filter(b => b?.text).flatMap(b => [{ text: b.heading, fontSize: 11, bold: true, margin: [0, 14, 0, 4] }, { text: b.text, fontSize: 9.5 }]),
    ],
    defaultStyle: { font: 'Roboto' },
  }, `${safe(fileName)}.pdf`)
}

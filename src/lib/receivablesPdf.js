// PDF «Дебіторка» — A4 книжково, через pdfmake. ₴ → «грн» (Roboto без гліфа гривні).
import { downloadPdf } from './docgen/pdfBuilder'
import { LOGO_BASE64 } from './docgen/logo'
import { BUCKETS } from './receivables'

const _int = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const n0 = (v) => _int.format(Math.round(Math.abs(Number(v) || 0)))
const money = (v) => n0(v) + ' грн'
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const RED = '#C62828', GREY = '#5E5A6B'

export function exportReceivablesPdf({ contractors, summary, asOf, scopeName }) {
  const genAt = new Date().toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // Шкала старіння (canvas)
  const BARW = 535
  const segs = []; let x = 0
  BUCKETS.forEach(b => { const w = summary.total ? BARW * (summary.buckets[b.key] / summary.total) : 0; if (w > 0.3) { segs.push({ type: 'rect', x, y: 0, w, h: 10, color: b.color }); x += w } })

  const legend = {
    columns: BUCKETS.map(b => ({
      width: '*',
      stack: [
        { columns: [{ width: 10, canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, r: 2, color: b.color }] }, { text: ' ' + b.label, fontSize: 7.5, color: GREY }] },
        { text: n0(summary.buckets[b.key]), fontSize: 9, color: b.key === '30+' ? RED : '#17151F', bold: b.key === '30+', margin: [12, 1, 0, 0] },
      ],
    })),
    columnGap: 8, margin: [0, 8, 0, 0],
  }

  // Таблиця: контрагент + його документи
  const body = [[
    { text: 'Контрагент / документ', fontSize: 8, color: GREY, bold: true },
    { text: 'Дата', fontSize: 8, color: GREY, bold: true, alignment: 'right' },
    { text: 'Сума', fontSize: 8, color: GREY, bold: true, alignment: 'right' },
    { text: 'Оплачено', fontSize: 8, color: GREY, bold: true, alignment: 'right' },
    { text: 'Залишок', fontSize: 8, color: GREY, bold: true, alignment: 'right' },
    { text: 'Вік', fontSize: 8, color: GREY, bold: true, alignment: 'right' },
  ]]
  contractors.forEach(c => {
    body.push([
      { text: [{ text: c.name, bold: true }, { text: `  ${c.docs.length} док.`, color: GREY, fontSize: 8 }], fontSize: 9.5, fillColor: '#F7F5FC' },
      { text: '', fillColor: '#F7F5FC' },
      { text: '', fillColor: '#F7F5FC' },
      { text: '', fillColor: '#F7F5FC' },
      { text: money(c.total), alignment: 'right', bold: true, fontSize: 9.5, fillColor: '#F7F5FC' },
      { text: c.oldest + ' дн.', alignment: 'right', fontSize: 9, color: c.oldest > 30 ? RED : '#17151F', fillColor: '#F7F5FC' },
    ])
    c.docs.forEach(xd => {
      const flags = []
      if (!xd.is_verified) flags.push('не звірено')
      if (!xd.is_signed) flags.push('не підписано')
      body.push([
        { text: [{ text: '   ' + xd.doc_number, color: '#5B2FD6' }, ...(flags.length ? [{ text: '  ' + flags.join(', '), color: RED, fontSize: 7.5 }] : [])], fontSize: 8.5 },
        { text: d(xd.doc_date), alignment: 'right', fontSize: 8.5 },
        { text: n0(xd.amount), alignment: 'right', fontSize: 8.5 },
        { text: xd.paid > 0 ? n0(xd.paid) : '0', alignment: 'right', fontSize: 8.5, color: xd.paid > 0 ? '#17151F' : '#B8B4C4' },
        { text: n0(xd.outstanding), alignment: 'right', fontSize: 8.5, bold: true },
        { text: String(xd.ageDays), alignment: 'right', fontSize: 8.5, color: xd.ageDays > 30 ? RED : '#17151F' },
      ])
    })
  })
  body.push([
    { text: 'РАЗОМ', bold: true, fontSize: 9.5, fillColor: '#FAF9FC' },
    { text: '', fillColor: '#FAF9FC' }, { text: '', fillColor: '#FAF9FC' }, { text: '', fillColor: '#FAF9FC' },
    { text: money(summary.total), alignment: 'right', bold: true, fontSize: 9.5, fillColor: '#FAF9FC' },
    { text: '', fillColor: '#FAF9FC' },
  ])

  const docDefinition = {
    pageSize: 'A4', pageOrientation: 'portrait', pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#17151F' },
    footer: (cur, cnt) => ({
      margin: [28, 6, 28, 0],
      columns: [
        { text: 'AiM Skill · Звіт по дебіторці', fontSize: 7, color: '#9AA0AE' },
        { text: `Сформовано ${genAt} · ${cur}/${cnt}`, fontSize: 7, color: '#9AA0AE', alignment: 'right' },
      ],
    }),
    content: [
      { columns: [
        { width: '*', stack: [
          { text: 'Дебіторська заборгованість', fontSize: 18, bold: true },
          { text: `${scopeName} · станом на ${d(asOf)}`, fontSize: 9, color: GREY, margin: [0, 2, 0, 0] },
        ] },
        { width: 60, image: LOGO_BASE64, fit: [60, 32], alignment: 'right' },
      ], margin: [0, 0, 0, 14] },

      // Підсумок
      {
        table: { widths: ['*', '*', '*', '*'], body: [[
          sumCell('Дебіторка разом', money(summary.total), '#17151F', 16),
          sumCell('Старше 30 днів', `${money(summary.over30)} · ${Math.round(summary.over30Pct * 100)}%`, RED, 12),
          sumCell('Боржників', String(summary.debtors), '#17151F', 12),
          sumCell('У т.ч. ПДВ', money(summary.vat), GREY, 12),
        ]] },
        layout: 'noBorders', margin: [0, 0, 0, 6],
      },
      { canvas: segs.length ? segs : [{ type: 'rect', x: 0, y: 0, w: BARW, h: 10, color: '#EEE' }] },
      legend,

      { text: '', margin: [0, 10, 0, 0] },
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'], body },
        layout: {
          hLineWidth: (i) => (i === 1 ? 1 : 0.5), hLineColor: () => '#ECEAF2', vLineWidth: () => 0,
          paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 3, paddingBottom: () => 3,
        },
      },
      { text: 'Вік — від дати документа станом на кінець періоду. Борг = сума документа − оплати.', fontSize: 7.5, color: '#9AA0AE', margin: [0, 10, 0, 0] },
    ],
  }
  downloadPdf(docDefinition, `Дебіторка ${d(asOf)}.pdf`)
}

function sumCell(label, value, color, size) {
  return {
    border: [false, false, false, false],
    stack: [
      { text: label, fontSize: 8, color: GREY, bold: true },
      { text: value, fontSize: size, bold: true, color, margin: [0, 3, 0, 0] },
    ],
  }
}

// PDF «Зведений баланс групи» — один аркуш A4 альбомно, через pdfmake (кирилиця з docgen).
import { downloadPdf } from './docgen/pdfBuilder'

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']
const _int = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const r0 = (n) => Math.round(Number(n) || 0)
const numText = (n) => (r0(n) < 0 ? '−' : '') + _int.format(Math.abs(r0(n)))
const col = (n, purple) => { const v = r0(n); if (v < 0) return '#C62828'; if (v === 0) return '#A39FB0'; return purple ? '#5B2FD6' : '#17151F' }
const DARK = '#17151F', GREEN = '#1F7A4D', RED = '#C62828', BLUE = '#2848C7', PURPLE = '#5B2FD6'

export function exportConsolidatedPdf({ rows, total, forecast, year, month }) {
  const t = total
  const liab = r0(t.pay) + r0(t.loans)
  const income = forecast?.income || 0, expense = forecast?.expense || 0, net = forecast?.net || 0
  const nCols = 1 + rows.length + 3 // Стаття + компанії + Разом + Рух + Прогноз
  const lastDay = new Date(year, month, 0).getDate()
  const fcHead = `${String(lastDay).padStart(2, '0')}.${String(month).padStart(2, '0')}`

  // ── числова комірка ──
  const nc = (v, { bold, purple, size, fill } = {}) => ({
    text: numText(v), alignment: 'right', color: col(v, purple),
    bold: bold || r0(v) < 0, fontSize: size || 8.5, ...(fill ? { fillColor: fill } : {}),
  })
  // ── рядок секції на всю ширину ──
  const sec = (label) => {
    const r = [{ text: label, colSpan: nCols, bold: true, fontSize: 8, color: '#5E5A6B', characterSpacing: 1, margin: [0, 6, 0, 2], border: [false, false, false, false] }]
    for (let i = 1; i < nCols; i++) r.push({ text: '', border: [false, false, false, false] })
    return r
  }
  // ── рядок статті ──
  const val = (row, field, fn) => fn ? fn(row) : r0(row[field])
  const statRow = (label, { field, fn, totalVal, isTot, big, purple, move, moveNum, fcVal }) => {
    const size = big ? 10 : 8.5
    const cells = [{ text: label, fontSize: size, bold: isTot, color: '#17151F' }]
    rows.forEach(row => cells.push(nc(val(row, field, fn), { bold: isTot, purple, size })))
    cells.push(nc(totalVal, { bold: true, purple, size }))
    // Рух прогнозу
    if (moveNum !== undefined) {
      const v = r0(moveNum)
      cells.push({ text: (v > 0 ? '+' : '') + numText(moveNum), alignment: 'right', fontSize: size, fillColor: '#F1F4FF', color: v < 0 ? RED : v > 0 ? GREEN : '#A39FB0' })
    } else if (Array.isArray(move)) {
      cells.push({ stack: move, alignment: 'right', fillColor: '#F1F4FF', fontSize: 8 })
    } else {
      cells.push({ text: '—', alignment: 'right', fontSize: size, fillColor: '#F1F4FF', color: '#A39FB0' })
    }
    cells.push(nc(fcVal, { bold: true, purple, size, fill: '#E6EBFF' }))
    return cells
  }

  const headRow = [
    { text: 'Стаття', fontSize: 8, color: '#5E5A6B', bold: true },
    ...rows.map(r => ({ text: r.name, fontSize: 8, color: '#5E5A6B', bold: true, alignment: 'right' })),
    { text: 'Разом · факт', fontSize: 8, color: '#17151F', bold: true, alignment: 'right' },
    { text: 'Рух прогнозу', fontSize: 8, color: BLUE, bold: true, alignment: 'right', fillColor: '#F1F4FF' },
    { text: `Прогноз ${fcHead}`, fontSize: 8, color: BLUE, bold: true, alignment: 'right', fillColor: '#E6EBFF' },
  ]

  const body = [
    headRow,
    sec('АКТИВИ'),
    statRow('Гроші', { field: 'cash', totalVal: t.cash, move: [{ text: '+' + _int.format(Math.abs(r0(income))), color: GREEN }, { text: '−' + _int.format(Math.abs(r0(expense))), color: RED, fontSize: 7 }], fcVal: t.cash + net }),
    statRow('Склад', { field: 'stock', totalVal: t.stock, move: null, fcVal: t.stock }),
    statRow('Дебіторка', { field: 'recv', totalVal: t.recv, move: null, fcVal: t.recv }),
    statRow('Основні засоби', { field: 'fa', totalVal: t.fa, move: null, fcVal: t.fa }),
    statRow('Активи разом', { field: 'assets', totalVal: t.assets, isTot: true, moveNum: net, fcVal: t.assets + net }),
    sec("ЗОБОВ'ЯЗАННЯ"),
    statRow('Кредиторка', { field: 'pay', totalVal: t.pay, move: null, fcVal: t.pay }),
    statRow('Поворотна фін. допомога', { field: 'loans', totalVal: t.loans, move: null, fcVal: t.loans }),
    statRow("Зобов'язання разом", { fn: r => r0(r.pay) + r0(r.loans), totalVal: liab, isTot: true, move: null, fcVal: liab }),
    sec('ВЛАСНИЙ КАПІТАЛ'),
    statRow('Власний капітал', { field: 'equity', totalVal: t.equity, isTot: true, big: true, purple: true, moveNum: net, fcVal: t.equity + net }),
  ]

  // рядок часток капіталу
  const shareRow = [{ text: 'Частка у капіталі групи', fontSize: 7.5, color: '#5E5A6B' }]
  rows.forEach(r => shareRow.push({ text: ((r.equity / (t.equity || 1)) * 100).toFixed(1).replace('.', ',') + '%', alignment: 'right', fontSize: 7.5, color: '#5E5A6B' }))
  shareRow.push({ text: '100%', alignment: 'right', fontSize: 7.5, color: '#5E5A6B' })
  shareRow.push({ text: '', fillColor: '#F1F4FF' }, { text: '', fillColor: '#E6EBFF' })
  body.push(shareRow)

  const docDefinition = {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [28, 28, 28, 28],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#17151F' },
    content: [
      { text: 'Зведений баланс групи', fontSize: 18, bold: true },
      { text: `Станом на ${lastDay} ${MONTHS[month - 1]} ${year} · ${rows.length} юрособи`, fontSize: 9, color: '#5E5A6B', margin: [0, 2, 0, 12] },

      // Смуга рівняння
      {
        table: {
          widths: ['*', 'auto', '*', 'auto', '*'],
          body: [[
            eqCell('АКТИВИ', t.assets, '#FFFFFF'),
            { text: '=', color: '#8A849C', fontSize: 16, alignment: 'center', margin: [0, 10, 0, 0], border: [false, false, false, false] },
            eqCell("ЗОБОВ'ЯЗАННЯ", liab, '#FFFFFF'),
            { text: '+', color: '#8A849C', fontSize: 16, alignment: 'center', margin: [0, 10, 0, 0], border: [false, false, false, false] },
            eqCell('ВЛАСНИЙ КАПІТАЛ', t.equity, '#B9A2FF'),
          ]],
        },
        layout: {
          fillColor: () => DARK, hLineWidth: () => 0, vLineWidth: () => 0,
          paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 10, paddingBottom: () => 12,
        },
        margin: [0, 0, 0, 16],
      },

      // Основна таблиця
      {
        table: { headerRows: 1, widths: ['*', ...rows.map(() => 'auto'), 'auto', 'auto', 'auto'], body },
        layout: {
          hLineWidth: (i, node) => (i === 1 ? 1 : 0.5),
          hLineColor: () => '#ECEAF2',
          vLineWidth: () => 0,
          paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
        },
      },
    ],
  }

  downloadPdf(docDefinition, `Зведений баланс ${fcHead}.${year}.pdf`)
}

function eqCell(label, value, valColor) {
  return {
    border: [false, false, false, false],
    stack: [
      { text: label, color: '#B9B4C9', fontSize: 8, characterSpacing: 1 },
      { text: numText(value) + ' ₴', color: r0(value) < 0 ? '#FF7A6B' : valColor, fontSize: 16, bold: true, margin: [0, 2, 0, 0] },
    ],
  }
}

// PDF «Зведений баланс групи» — один аркуш A4 альбомно, через pdfmake (кирилиця з docgen).
// ₴ замінено на «грн» (вбудований Roboto не має гліфа гривні → квадратики).
import { downloadPdf } from './docgen/pdfBuilder'
import { LOGO_BASE64 } from './docgen/logo'

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']
const _int = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const r0 = (n) => Math.round(Number(n) || 0)
const numText = (n) => (r0(n) < 0 ? '−' : '') + _int.format(Math.abs(r0(n)))
const money = (n) => numText(n) + ' грн'
const col = (n, purple) => { const v = r0(n); if (v < 0) return '#C62828'; if (v === 0) return '#A39FB0'; return purple ? '#5B2FD6' : '#17151F' }
const pct1 = (frac) => (Math.abs(frac * 100)).toFixed(1).replace('.', ',') + '%'
const changeText = (delta, base) => { const v = r0(delta); if (v === 0 || !base) return 'без змін'; const p = (delta / base * 100); return (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1).replace('.', ',') + '%' }
const DARK = '#17151F', GREEN = '#1F7A4D', RED = '#C62828', BLUE = '#2848C7', PURPLE = '#5B2FD6'

// Геометрія сторінки A4 альбомно
const PAGE_W = 841.89, MARGIN = 28
const USABLE = PAGE_W - 2 * MARGIN           // 785.89
const CARD_GAP = 12
const CARD_W = Math.floor((USABLE - 2 * CARD_GAP) / 3) // ~253
const CARD_PAD = 10
const CARD_INNER = CARD_W - 2 * CARD_PAD - 1
const BAR_W = CARD_INNER                       // ширина шкали в картці
const STRIP_BAR_W = Math.floor(USABLE - 24)    // шкала в темній смузі (padding 12)

const frac = (v, total) => { if (!total) return 0; return Math.max(0, Math.min(1, Math.abs(v) / Math.abs(total))) }

// Горизонтальна шкала (canvas): фон-трек + заповнення
function bar(value, total, { w = BAR_W, h = 4, track = '#F1EEFB', fill = '#17151F' } = {}) {
  const neg = r0(value) < 0
  const fw = w * frac(value, total)
  return {
    canvas: [
      { type: 'rect', x: 0, y: 0, w, h, r: 2, color: track },
      ...(fw > 0.5 ? [{ type: 'rect', x: 0, y: 0, w: fw, h, r: 2, color: neg ? RED : fill }] : []),
    ],
    margin: [0, 2, 0, 0],
  }
}

// Рядок статті в картці: назва + сума, під ним шкала
function cardRow(label, value, total, opt = {}) {
  return {
    stack: [
      { columns: [
        { text: label, fontSize: 9 },
        { text: numText(value), alignment: 'right', fontSize: 9, color: col(value), bold: r0(value) < 0 },
      ] },
      bar(value, total, opt),
    ],
    margin: [0, 0, 0, 7],
  }
}

// Плашка «Прогноз на кінець місяця»
function forecastPlate(value, delta, base) {
  return {
    table: { widths: ['*', 'auto'], body: [[
      { text: 'Прогноз на кінець місяця', fontSize: 8, color: BLUE, bold: true, border: [false, false, false, false] },
      { text: `${money(value)} · ${changeText(delta, base)}`, fontSize: 8, color: BLUE, bold: true, alignment: 'right', border: [false, false, false, false] },
    ]] },
    layout: { fillColor: () => '#F1F4FF', paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
    margin: [0, 6, 0, 0],
  }
}

// Картка (білий бокс із рамкою)
function card(stackContent) {
  return {
    width: CARD_W,
    table: { widths: [CARD_INNER], body: [[{ stack: stackContent, border: [false, false, false, false] }]] },
    layout: {
      fillColor: () => '#FFFFFF',
      hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#ECEAF2', vLineColor: () => '#ECEAF2',
      paddingLeft: () => CARD_PAD, paddingRight: () => CARD_PAD, paddingTop: () => CARD_PAD, paddingBottom: () => CARD_PAD,
    },
  }
}

export function exportConsolidatedPdf({ rows, total, forecast, year, month }) {
  const t = total
  const liab = r0(t.pay) + r0(t.loans)
  const income = forecast?.income || 0, expense = forecast?.expense || 0, net = forecast?.net || 0
  const otherNet = t.equity - t.fa - t.cash
  const nCols = 1 + rows.length + 3
  const moveColIdx = 1 + rows.length + 1 // межа перед «Рух прогнозу»
  const lastDay = new Date(year, month, 0).getDate()
  const fcHead = `${String(lastDay).padStart(2, '0')}.${String(month).padStart(2, '0')}`
  const genAt = new Date().toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // ── числова комірка таблиці ──
  const nc = (v, { bold, purple, size, fill } = {}) => ({
    text: numText(v), alignment: 'right', color: col(v, purple),
    bold: bold || r0(v) < 0, fontSize: size || 8.5, ...(fill ? { fillColor: fill } : {}),
  })
  const sec = (label) => {
    const r = [{ text: label, colSpan: nCols, bold: true, fontSize: 8, color: '#5E5A6B', characterSpacing: 1, margin: [0, 6, 0, 2], border: [false, false, false, false] }]
    for (let i = 1; i < nCols; i++) r.push({ text: '', border: [false, false, false, false] })
    return r
  }
  const val = (row, field, fn) => fn ? fn(row) : r0(row[field])
  const statRow = (label, { field, fn, totalVal, isTot, big, purple, move, moveNum, fcVal }) => {
    const size = big ? 10 : 8.5
    const baseFill = isTot ? '#FAF9FC' : undefined
    const fcFill = isTot ? '#E6EBFF' : '#F1F4FF'
    const cells = [{ text: label, fontSize: size, bold: isTot, color: '#17151F', ...(baseFill ? { fillColor: baseFill } : {}) }]
    rows.forEach(row => cells.push(nc(val(row, field, fn), { bold: isTot, purple, size, fill: baseFill })))
    cells.push(nc(totalVal, { bold: true, purple, size, fill: baseFill }))
    // Рух прогнозу
    if (moveNum !== undefined) {
      const v = r0(moveNum)
      cells.push({ text: (v > 0 ? '+' : '') + numText(moveNum), alignment: 'right', fontSize: size, fillColor: fcFill, color: v < 0 ? RED : v > 0 ? GREEN : '#A39FB0' })
    } else if (Array.isArray(move)) {
      cells.push({ stack: move, alignment: 'right', fillColor: fcFill, fontSize: 8.5 })
    } else {
      cells.push({ text: '—', alignment: 'right', fontSize: size, fillColor: fcFill, color: '#A39FB0' })
    }
    cells.push(nc(fcVal, { bold: true, purple, size, fill: fcFill }))
    return cells
  }

  const headRow = [
    { text: 'Стаття', fontSize: 8, color: '#5E5A6B', bold: true },
    ...rows.map(r => ({ text: r.name, fontSize: 8, color: '#5E5A6B', bold: true, alignment: 'right' })),
    { text: 'Разом · факт', fontSize: 8, color: '#17151F', bold: true, alignment: 'right' },
    { text: 'Рух прогнозу', fontSize: 8, color: BLUE, bold: true, alignment: 'right', fillColor: '#F1F4FF' },
    { text: `Прогноз ${fcHead}`, fontSize: 8, color: BLUE, bold: true, alignment: 'right', fillColor: '#E6EBFF' },
  ]

  const moveCash = [
    { text: '+' + _int.format(Math.abs(r0(income))), color: GREEN, fontSize: 8.5, alignment: 'right' },
    { text: '−' + _int.format(Math.abs(r0(expense))), color: RED, fontSize: 8.5, alignment: 'right' },
  ]

  const body = [
    headRow,
    sec('АКТИВИ'),
    statRow('Гроші', { field: 'cash', totalVal: t.cash, move: moveCash, fcVal: t.cash + net }),
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
  // частки капіталу
  const shareRow = [{ text: 'Частка у капіталі групи', fontSize: 7.5, color: '#5E5A6B' }]
  rows.forEach(r => shareRow.push({ text: pct1(r.equity / (t.equity || 1)), alignment: 'right', fontSize: 7.5, color: '#5E5A6B' }))
  shareRow.push({ text: '100%', alignment: 'right', fontSize: 7.5, color: '#5E5A6B' })
  shareRow.push({ text: '', fillColor: '#F1F4FF' }, { text: '', fillColor: '#E6EBFF' })
  body.push(shareRow)

  // ── Темна смуга: рівняння + шкала + підписи ──
  const eqCell = (label, value, valColor) => ({
    width: '*',
    stack: [
      { text: label, color: '#B9B4C9', fontSize: 8, characterSpacing: 1 },
      { text: money(value), color: r0(value) < 0 ? '#FF7A6B' : valColor, fontSize: 16, bold: true, margin: [0, 2, 0, 0] },
    ],
  })
  const lw = STRIP_BAR_W * frac(liab, t.assets)
  const stripBar = {
    canvas: [
      { type: 'rect', x: 0, y: 0, w: lw, h: 6, color: '#FF7A6B' },
      { type: 'rect', x: lw + 2, y: 0, w: Math.max(0, STRIP_BAR_W - lw - 2), h: 6, color: '#8B63FF' },
    ],
    margin: [0, 10, 0, 6],
  }
  const strip = {
    table: { widths: ['*'], body: [[{
      border: [false, false, false, false],
      stack: [
        { columns: [
          eqCell('АКТИВИ', t.assets, '#FFFFFF'),
          { width: 14, text: '=', color: '#8A849C', fontSize: 16, alignment: 'center', margin: [0, 10, 0, 0] },
          eqCell("ЗОБОВ'ЯЗАННЯ", liab, '#FFFFFF'),
          { width: 14, text: '+', color: '#8A849C', fontSize: 16, alignment: 'center', margin: [0, 10, 0, 0] },
          eqCell('ВЛАСНИЙ КАПІТАЛ', t.equity, '#B9A2FF'),
        ], columnGap: 10 },
        stripBar,
        { columns: [
          { text: `Зобов'язання · ${pct1(liab / (t.assets || 1))} активів`, color: '#B9B4C9', fontSize: 8 },
          { text: `Капітал · ${pct1(t.equity / (t.assets || 1))} активів`, color: '#B9B4C9', fontSize: 8, alignment: 'right' },
        ] },
      ],
    }]] },
    layout: { fillColor: () => DARK, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 10, paddingBottom: () => 12 },
    margin: [0, 0, 0, 14],
  }

  // ── Три картки ──
  const equitySeg = () => {
    const segs = [[t.fa, '#5B2FD6'], [t.cash, '#A98CFF'], [otherNet, '#DCD1FF']]
    const canvasEls = []; let x = 0
    segs.forEach(([v, c]) => { const w = BAR_W * frac(v, t.equity); if (w > 0.5) { canvasEls.push({ type: 'rect', x, y: 0, w, h: 8, color: r0(v) < 0 ? RED : c }); x += w + 2 } })
    return { canvas: canvasEls.length ? canvasEls : [{ type: 'rect', x: 0, y: 0, w: BAR_W, h: 8, color: '#F1EEFB' }], margin: [0, 4, 0, 8] }
  }
  const legendRow = (dot, label, value, fr) => ({
    columns: [
      { width: 'auto', columns: [{ width: 10, canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, r: 2, color: dot }] }, { text: ' ' + label, fontSize: 9 }] },
      { text: [{ text: numText(value), color: col(value) }, { text: '  ' + pct1(fr), color: '#5E5A6B', fontSize: 8 }], alignment: 'right', fontSize: 9 },
    ],
    margin: [0, 0, 0, 6],
  })

  const cardsRow = {
    columns: [
      card([
        { text: 'АКТИВИ (РАЗОМ)', fontSize: 7, color: '#5E5A6B', bold: true, characterSpacing: 0.5 },
        { text: money(t.assets), fontSize: 16, bold: true, color: col(t.assets), margin: [0, 4, 0, 10] },
        cardRow('Гроші', t.cash, t.assets),
        cardRow('Склад', t.stock, t.assets),
        cardRow('Дебіторка', t.recv, t.assets),
        cardRow('Основні засоби', t.fa, t.assets),
        forecastPlate(t.assets + net, net, t.assets),
      ]),
      card([
        { text: "ЗОБОВ'ЯЗАННЯ (РАЗОМ)", fontSize: 7, color: '#5E5A6B', bold: true, characterSpacing: 0.5 },
        { text: money(liab), fontSize: 16, bold: true, color: col(liab), margin: [0, 4, 0, 10] },
        cardRow('Кредиторка', t.pay, liab, { track: '#FDEEEC', fill: '#B4291F' }),
        cardRow('Поворотна фін. допомога', t.loans, liab, { track: '#FDEEEC', fill: '#B4291F' }),
        forecastPlate(liab, 0, liab),
      ]),
      card([
        { text: 'ВЛАСНИЙ КАПІТАЛ (РАЗОМ)', fontSize: 7, color: '#5E5A6B', bold: true, characterSpacing: 0.5 },
        { text: money(t.equity), fontSize: 16, bold: true, color: col(t.equity, true), margin: [0, 4, 0, 6] },
        { text: 'Чим забезпечений капітал', fontSize: 8, color: '#5E5A6B', bold: true },
        equitySeg(),
        legendRow('#5B2FD6', 'Основні засоби', t.fa, t.fa / (t.equity || 1)),
        legendRow('#A98CFF', 'Гроші', t.cash, t.cash / (t.equity || 1)),
        legendRow('#DCD1FF', 'Інші чисті активи', otherNet, otherNet / (t.equity || 1)),
        forecastPlate(t.equity + net, net, t.equity),
      ]),
    ],
    columnGap: CARD_GAP,
    margin: [0, 0, 0, 16],
  }

  const docDefinition = {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [MARGIN, MARGIN, MARGIN, 36],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#17151F' },
    footer: (currentPage, pageCount) => ({
      margin: [MARGIN, 6, MARGIN, 0],
      columns: [
        { text: 'AiM Skill · Звіт інвестору', fontSize: 7, color: '#9AA0AE' },
        { text: `Сформовано ${genAt} · ${currentPage}/${pageCount}`, fontSize: 7, color: '#9AA0AE', alignment: 'right' },
      ],
    }),
    content: [
      { columns: [
        { width: '*', stack: [
          { text: 'Зведений баланс групи', fontSize: 18, bold: true },
          { text: `Станом на ${lastDay} ${MONTHS[month - 1]} ${year} · ${rows.length} юрособи`, fontSize: 9, color: '#5E5A6B', margin: [0, 2, 0, 0] },
        ] },
        { width: 60, image: LOGO_BASE64, fit: [60, 32], alignment: 'right' },
      ], margin: [0, 0, 0, 12] },
      strip,
      cardsRow,
      {
        table: { headerRows: 1, widths: ['*', ...rows.map(() => 'auto'), 'auto', 'auto', 'auto'], body },
        layout: {
          hLineWidth: (i) => (i === 1 ? 1 : 0.5),
          hLineColor: () => '#ECEAF2',
          vLineWidth: (i) => (i === moveColIdx ? 1 : 0),
          vLineColor: () => '#9AA8E8',
          vLineStyle: (i) => (i === moveColIdx ? { dash: { length: 3, space: 2 } } : null),
          paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
        },
      },
    ],
  }

  downloadPdf(docDefinition, `Зведений баланс ${fcHead}.${year}.pdf`)
}

// ── Шаблон: Акт наданих послуг — IT-стиль ──
import { formatMoney, formatDate, formatDateLong, amountInWords, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'

const BRAND = '#1a1a2e'
const ACCENT = '#0066ff'
const LIGHT = '#f0f4ff'
const GRAY = '#666'

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const hasVat = vatAmount > 0
  const qrData = `AIM-SKILL|ACT|${docNumber}|${docDate}|${total}|${company.edrpou}|${contractor.edrpou || ''}`

  const itemRows = items.map((it, i) => {
    const qty = parseFloat(it.quantity) || 0
    const price = parseFloat(it.unitPrice) || 0
    const amount = parseFloat(it.amount) || qty * price
    const vatRate = parseFloat(it.vatRate) || 0
    const vat = vatRate > 0 ? amount * vatRate / 100 : 0
    return [
      { text: i + 1, alignment: 'center', fontSize: 9 },
      { text: it.name || '', fontSize: 9 },
      { text: qty, alignment: 'center', fontSize: 9 },
      { text: it.unit || 'послуга', alignment: 'center', fontSize: 9, color: GRAY },
      { text: formatMoney(price), alignment: 'right', fontSize: 9 },
      { text: vatRate > 0 ? `${vatRate}%` : '—', alignment: 'center', fontSize: 9, color: GRAY },
      { text: formatMoney(vat), alignment: 'right', fontSize: 9 },
      { text: formatMoney(amount + vat), alignment: 'right', fontSize: 9, bold: true },
    ]
  })

  return {
    pageSize: 'A4',
    pageMargins: [40, 30, 40, 30],
    defaultStyle: { fontSize: 10, font: 'Roboto' },
    content: [
      // ═══ ШАПКА ═══
      {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: company.shortName || company.name, fontSize: 20, bold: true, color: '#fff', margin: [0, 0, 0, 4] },
              { text: [
                company.edrpou ? `ЄДРПОУ ${company.edrpou}` : '',
                company.phone ? `  ·  ${company.phone}` : '',
                company.email ? `  ·  ${company.email}` : '',
              ].filter(Boolean).join(''), fontSize: 9, color: '#b0c4ff' },
            ],
            fillColor: BRAND, color: '#fff', margin: [16, 14, 16, 14],
          }]],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 16],
      },

      // ═══ НАЗВА ═══
      { text: 'АКТ НАДАНИХ ПОСЛУГ', fontSize: 11, color: ACCENT, bold: true, letterSpacing: 2, alignment: 'center', margin: [0, 0, 0, 2] },
      { text: `№ ${docNumber}`, fontSize: 22, bold: true, color: BRAND, alignment: 'center' },
      { text: `від ${formatDateLong(docDate)}`, fontSize: 12, color: GRAY, alignment: 'center', margin: [0, 0, 0, 16] },

      // ═══ ПРЕАМБУЛА ═══
      {
        text: [
          { text: company.shortName || company.name, bold: true },
          ' (Виконавець) в особі ',
          { text: `${company.directorPosition || 'Директора'} ${company.director || '________'}` },
          ', з однієї сторони, та ',
          { text: contractor.short_name || contractor.name || '________', bold: true },
          ' (Замовник)',
          contractor.contact_person ? ` в особі ${contractor.contact_position || ''} ${contractor.contact_person}` : '',
          ', з іншої сторони, склали цей Акт про наступне:',
        ],
        fontSize: 10, lineHeight: 1.5, margin: [0, 0, 0, 16],
      },

      // ═══ ТАБЛИЦЯ ═══
      {
        table: {
          headerRows: 1,
          widths: [22, '*', 35, 45, 60, 30, 50, 65],
          body: [
            ['№', 'Найменування послуги', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'].map(t => ({
              text: t, fontSize: 8, bold: true, color: '#fff', fillColor: BRAND, alignment: 'center', margin: [0, 4, 0, 4],
            })),
            ...itemRows,
          ],
        },
        layout: {
          hLineWidth: (i, node) => i === 1 ? 2 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? BRAND : '#e0e0e0',
          paddingLeft: () => 4, paddingRight: () => 4,
          paddingTop: () => 5, paddingBottom: () => 5,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#f8f9fa' : null,
        },
      },

      // ═══ ПІДСУМКИ ═══
      { text: '', margin: [0, 8] },
      {
        table: {
          widths: ['*', 100, 90],
          body: [
            [{ text: '' }, { text: 'Разом без ПДВ:', alignment: 'right', fontSize: 10, color: GRAY }, { text: `${formatMoney(subtotal)} грн`, alignment: 'right', fontSize: 10 }],
            ...(hasVat ? [[{ text: '' }, { text: 'ПДВ:', alignment: 'right', fontSize: 10, color: GRAY }, { text: `${formatMoney(vatAmount)} грн`, alignment: 'right', fontSize: 10 }]] : []),
            [{ text: '' }, { text: 'ВСЬОГО:', alignment: 'right', fontSize: 13, bold: true, color: BRAND }, { text: `${formatMoney(total)} грн`, alignment: 'right', fontSize: 13, bold: true, color: ACCENT, fillColor: LIGHT, margin: [4, 4, 4, 4] }],
          ],
        },
        layout: 'noBorders',
      },
      { text: amountInWords(total), fontSize: 9, italics: true, color: GRAY, margin: [0, 6, 0, 0] },

      // ═══ ТЕКСТ АКТУ ═══
      { text: '', margin: [0, 10] },
      {
        table: {
          widths: ['*'],
          body: [[{
            text: 'Вищевказані послуги виконані повністю та в строк. Замовник претензій щодо обсягу, якості та строків надання послуг не має.',
            fontSize: 10, lineHeight: 1.4, margin: [12, 8, 12, 8], color: BRAND,
          }]],
        },
        layout: {
          hLineWidth: () => 0, vLineWidth: () => 0,
          fillColor: () => LIGHT,
        },
      },

      notes ? { text: `Примітка: ${notes}`, margin: [0, 12, 0, 0], fontSize: 9, color: GRAY, italics: true } : {},

      // ═══ ПІДПИСИ ═══
      { text: '', margin: [0, 24] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#ddd' }] },
      { text: '', margin: [0, 10] },
      {
        columns: [
          {
            width: '48%',
            stack: [
              { text: 'ВИКОНАВЕЦЬ:', fontSize: 9, color: ACCENT, bold: true, letterSpacing: 1 },
              { text: company.shortName || company.name, fontSize: 9, margin: [0, 4, 0, 0] },
              company.edrpou ? { text: `ЄДРПОУ: ${company.edrpou}`, fontSize: 8, color: GRAY } : {},
              { text: '', margin: [0, 16] },
              { text: '________________________', fontSize: 9, color: '#ccc' },
              { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, margin: [0, 4, 0, 0] },
              { text: 'М.П.', fontSize: 8, color: '#ccc', margin: [0, 4, 0, 0] },
            ],
          },
          {
            width: '48%',
            stack: [
              { text: 'ЗАМОВНИК:', fontSize: 9, color: ACCENT, bold: true, letterSpacing: 1 },
              { text: contractor.short_name || contractor.name || '', fontSize: 9, margin: [0, 4, 0, 0] },
              contractor.edrpou ? { text: `ЄДРПОУ: ${contractor.edrpou}`, fontSize: 8, color: GRAY } : {},
              { text: '', margin: [0, 16] },
              { text: '________________________', fontSize: 9, color: '#ccc' },
              { text: contractor.contact_person || '', fontSize: 9, margin: [0, 4, 0, 0] },
              { text: 'М.П.', fontSize: 8, color: '#ccc', margin: [0, 4, 0, 0] },
            ],
          },
        ],
      },

      // ═══ ФУТЕР з QR ═══
      { text: '', margin: [0, 16] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.3, lineColor: '#ddd' }] },
      {
        columns: [
          { qr: qrData, fit: 50, margin: [0, 6, 0, 0] },
          {
            stack: [
              { text: `ID: ${docNumber} · ${formatDate(docDate)}`, fontSize: 7, color: '#aaa', margin: [8, 8, 0, 0] },
              { text: `${company.email || ''}  ·  ${company.phone || ''}`, fontSize: 7, color: '#aaa', margin: [8, 2, 0, 0] },
              { text: company.address || '', fontSize: 7, color: '#aaa', margin: [8, 2, 0, 0] },
            ],
            width: '*',
          },
        ],
        margin: [0, 4, 0, 0],
      },
    ],
  }
}

export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)

  const data = [
    [`Акт наданих послуг №${docNumber} від ${formatDate(docDate)}`],
    [],
    ['Виконавець:', company.shortName || company.name, '', 'ЄДРПОУ:', company.edrpou],
    ['Замовник:', contractor.short_name || contractor.name, '', 'ЄДРПОУ:', contractor.edrpou],
    [],
    ['№', 'Найменування', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'],
    ...items.map((it, i) => {
      const qty = parseFloat(it.quantity) || 0
      const price = parseFloat(it.unitPrice) || 0
      const amount = parseFloat(it.amount) || qty * price
      const vatRate = parseFloat(it.vatRate) || 0
      const vat = vatRate > 0 ? amount * vatRate / 100 : 0
      return [i + 1, it.name, qty, it.unit || 'послуга', price, vatRate > 0 ? `${vatRate}%` : '', vat, amount + vat]
    }),
    [],
    ['', '', '', '', '', '', 'Без ПДВ:', subtotal],
    ['', '', '', '', '', '', 'ПДВ:', vatAmount],
    ['', '', '', '', '', '', 'Всього:', total],
    [],
    [amountInWords(total)],
  ]

  const wb = createWorkbook()
  addSheet(wb, data, 'Акт')
  return wb
}

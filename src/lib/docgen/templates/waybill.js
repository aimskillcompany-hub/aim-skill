// ── Шаблон: Видаткова накладна — IT-стиль ──
import { formatMoney, formatDate, formatDateLong, amountInWords, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'

const BRAND = '#1a1a2e'
const ACCENT = '#0066ff'
const LIGHT = '#f0f4ff'
const GRAY = '#666'

function partyBlock(label, entity, isCompany) {
  const name = isCompany ? (entity.shortName || entity.name) : (entity.short_name || entity.name || '—')
  const edrpou = isCompany ? entity.edrpou : entity.edrpou
  const address = isCompany ? entity.address : (entity.legal_address || entity.address)
  const iban = isCompany ? entity.iban : entity.iban
  const bank = isCompany ? (entity.bankName ? `${entity.bankName}${entity.mfo ? ', МФО ' + entity.mfo : ''}` : '') : ''

  return {
    stack: [
      { text: label, fontSize: 8, color: ACCENT, bold: true, letterSpacing: 1, margin: [10, 0, 0, 4] },
      { text: name, fontSize: 11, bold: true, margin: [10, 0, 0, 2] },
      edrpou ? { text: `ЄДРПОУ: ${edrpou}`, fontSize: 8, color: GRAY, margin: [10, 0, 0, 1] } : {},
      address ? { text: address, fontSize: 8, color: GRAY, margin: [10, 0, 0, 1] } : {},
      iban ? { text: `IBAN: ${iban}`, fontSize: 8, color: GRAY, margin: [10, 0, 0, 1] } : {},
      bank ? { text: bank, fontSize: 8, color: GRAY, margin: [10, 0, 0, 0] } : {},
    ],
  }
}

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const hasVat = vatAmount > 0

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
      { text: it.unit || 'шт', alignment: 'center', fontSize: 9, color: GRAY },
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
      { text: 'ВИДАТКОВА НАКЛАДНА', fontSize: 11, color: ACCENT, bold: true, letterSpacing: 2, margin: [0, 0, 0, 2] },
      {
        columns: [
          { text: `№ ${docNumber}`, fontSize: 22, bold: true, color: BRAND, width: 'auto' },
          { text: `від ${formatDateLong(docDate)}`, fontSize: 12, color: GRAY, margin: [10, 10, 0, 0], width: '*' },
        ],
        margin: [0, 0, 0, 16],
      },

      // ═══ СТОРОНИ ═══
      {
        columns: [
          { width: '48%', ...partyBlock('ПОСТАЧАЛЬНИК', company, true) },
          { width: '4%', text: '' },
          { width: '48%', ...partyBlock('ПОКУПЕЦЬ', contractor, false) },
        ],
        margin: [0, 0, 0, 20],
      },

      // ═══ ТАБЛИЦЯ ═══
      {
        table: {
          headerRows: 1,
          widths: [22, '*', 35, 40, 60, 30, 50, 65],
          body: [
            ['№', 'Найменування товару', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'].map(t => ({
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

      notes ? { text: `Примітка: ${notes}`, margin: [0, 12, 0, 0], fontSize: 9, color: GRAY, italics: true } : {},

      // ═══ ПІДПИСИ ═══
      { text: '', margin: [0, 30] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#ddd' }] },
      { text: '', margin: [0, 10] },
      {
        columns: [
          {
            width: '48%',
            stack: [
              { text: 'Від постачальника:', fontSize: 9, color: ACCENT, bold: true },
              { text: '', margin: [0, 20] },
              { text: '________________________', fontSize: 9, color: '#ccc' },
              { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, margin: [0, 4, 0, 0] },
              { text: 'М.П.', fontSize: 8, color: '#ccc', margin: [0, 4, 0, 0] },
            ],
          },
          {
            width: '48%',
            stack: [
              { text: 'Отримав:', fontSize: 9, color: ACCENT, bold: true },
              { text: '', margin: [0, 20] },
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
          { qr: `AIM-SKILL|WB|${docNumber}|${docDate}|${total}|${company.edrpou}|${contractor.edrpou || ''}`, fit: 50, margin: [0, 6, 0, 0] },
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
    [`Видаткова накладна №${docNumber} від ${formatDate(docDate)}`],
    [],
    ['Постачальник:', company.shortName || company.name, '', 'ЄДРПОУ:', company.edrpou],
    ['Адреса:', company.address, '', 'IBAN:', company.iban],
    ['Покупець:', contractor.short_name || contractor.name, '', 'ЄДРПОУ:', contractor.edrpou],
    [],
    ['№', 'Найменування', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'],
    ...items.map((it, i) => {
      const qty = parseFloat(it.quantity) || 0
      const price = parseFloat(it.unitPrice) || 0
      const amount = parseFloat(it.amount) || qty * price
      const vatRate = parseFloat(it.vatRate) || 0
      const vat = vatRate > 0 ? amount * vatRate / 100 : 0
      return [i + 1, it.name, qty, it.unit || 'шт', price, vatRate > 0 ? `${vatRate}%` : '', vat, amount + vat]
    }),
    [],
    ['', '', '', '', '', '', 'Без ПДВ:', subtotal],
    ['', '', '', '', '', '', 'ПДВ:', vatAmount],
    ['', '', '', '', '', '', 'Всього:', total],
    [],
    [amountInWords(total)],
  ]

  const wb = createWorkbook()
  addSheet(wb, data, 'Видаткова')
  return wb
}

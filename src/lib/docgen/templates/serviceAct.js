// ── Шаблон: Акт наданих послуг ──
import { formatMoney, formatDate, formatDateLong, amountInWords, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const hasVat = vatAmount > 0

  return {
    pageSize: 'A4',
    pageMargins: [40, 30, 40, 30],
    defaultStyle: { fontSize: 10 },
    content: [
      { text: `АКТ №${docNumber}`, style: 'header', alignment: 'center' },
      { text: `наданих послуг (виконаних робіт)`, alignment: 'center', fontSize: 12, margin: [0, 0, 0, 3] },
      { text: `від ${formatDateLong(docDate)}`, alignment: 'center', fontSize: 11, color: '#555', margin: [0, 0, 0, 10] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#ccc' }], margin: [0, 0, 0, 10] },

      // Преамбула
      {
        text: [
          { text: company.shortName || company.name, bold: true },
          ' (надалі — Виконавець) в особі ',
          { text: `${company.directorPosition || 'Директора'} ${company.director || '________________'}` },
          ', з однієї сторони, та ',
          { text: contractor.short_name || contractor.name || '________________', bold: true },
          ' (надалі — Замовник)',
          contractor.contact_person ? ` в особі ${contractor.contact_position || ''} ${contractor.contact_person}` : '',
          ', з іншої сторони, склали цей Акт про наступне:',
        ],
        fontSize: 10, lineHeight: 1.4, margin: [0, 0, 0, 12],
      },

      // Таблиця
      {
        table: {
          headerRows: 1,
          widths: [25, '*', 40, 50, 70, 30, 50, 70],
          body: [
            ['№', 'Найменування послуги', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'].map(t => ({ text: t, style: 'th' })),
            ...items.map((it, i) => {
              const qty = parseFloat(it.quantity) || 0
              const price = parseFloat(it.unitPrice) || 0
              const amount = parseFloat(it.amount) || qty * price
              const vatRate = parseFloat(it.vatRate) || 0
              const vat = vatRate > 0 ? amount * vatRate / 100 : 0
              return [
                { text: i + 1, alignment: 'center' },
                it.name || '',
                { text: qty, alignment: 'center' },
                { text: it.unit || 'послуга', alignment: 'center' },
                { text: formatMoney(price), alignment: 'right' },
                { text: vatRate > 0 ? `${vatRate}%` : '—', alignment: 'center' },
                { text: formatMoney(vat), alignment: 'right' },
                { text: formatMoney(amount + vat), alignment: 'right' },
              ]
            }),
          ],
        },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#ccc', vLineColor: () => '#ccc',
          paddingLeft: () => 4, paddingRight: () => 4,
          paddingTop: () => 3, paddingBottom: () => 3,
        },
      },

      { text: '', margin: [0, 6] },
      { columns: [{ text: '', width: '*' }, { text: `Разом без ПДВ: ${formatMoney(subtotal)} грн`, width: 'auto', alignment: 'right' }] },
      hasVat ? { columns: [{ text: '', width: '*' }, { text: `ПДВ: ${formatMoney(vatAmount)} грн`, width: 'auto', alignment: 'right' }] } : {},
      { columns: [{ text: '', width: '*' }, { text: `Всього: ${formatMoney(total)} грн`, width: 'auto', alignment: 'right', fontSize: 12, bold: true }] },
      { text: amountInWords(total), italics: true, fontSize: 9, color: '#555', margin: [0, 4, 0, 0] },

      // Текст акту
      { text: '', margin: [0, 10] },
      { text: 'Вищевказані послуги виконані повністю та в строк. Замовник претензій щодо обсягу, якості та строків надання послуг не має.', fontSize: 10, lineHeight: 1.3 },

      notes ? { text: `Примітка: ${notes}`, margin: [0, 10, 0, 0], fontSize: 9, color: '#666' } : {},

      // Підписи
      { text: '', margin: [0, 30] },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Виконавець:', bold: true, fontSize: 10, margin: [0, 0, 0, 5] },
              { text: company.shortName || company.name, fontSize: 9 },
              company.edrpou ? { text: `ЄДРПОУ: ${company.edrpou}`, fontSize: 9, color: '#555' } : {},
              { text: '', margin: [0, 20] },
              { text: `${company.directorPosition || 'Директор'} ________________ ${company.director || ''}`, fontSize: 9 },
              { text: 'М.П.', fontSize: 8, color: '#999', margin: [0, 5] },
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'Замовник:', bold: true, fontSize: 10, margin: [0, 0, 0, 5] },
              { text: contractor.short_name || contractor.name || '', fontSize: 9 },
              contractor.edrpou ? { text: `ЄДРПОУ: ${contractor.edrpou}`, fontSize: 9, color: '#555' } : {},
              { text: '', margin: [0, 20] },
              { text: `________________ ${contractor.contact_person || '________________'}`, fontSize: 9 },
              { text: 'М.П.', fontSize: 8, color: '#999', margin: [0, 5] },
            ],
          },
        ],
      },
    ],
    styles: {
      header: { fontSize: 18, bold: true, margin: [0, 0, 0, 3] },
      label: { fontSize: 9, color: '#888', margin: [0, 0, 0, 2] },
      small: { fontSize: 9, color: '#555', margin: [0, 0, 0, 1] },
      th: { bold: true, fontSize: 9, fillColor: '#f5f5f5', alignment: 'center' },
    },
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
  ]

  const wb = createWorkbook()
  addSheet(wb, data, 'Акт')
  return wb
}

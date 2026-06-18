// ── Шаблон: Рахунок на оплату ──
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
      // Заголовок
      { text: `Рахунок на оплату №${docNumber} від ${formatDateLong(docDate)}`, style: 'header' },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: '#333' }], margin: [0, 5, 0, 10] },

      // Постачальник
      { text: 'Постачальник:', style: 'label' },
      { text: company.shortName || company.name, style: 'value', bold: true },
      company.edrpou ? { text: `ЄДРПОУ: ${company.edrpou}${company.ipn ? ', ІПН: ' + company.ipn : ''}`, style: 'small' } : {},
      company.address ? { text: `Адреса: ${company.address}`, style: 'small' } : {},
      company.iban ? { text: `IBAN: ${company.iban}, ${company.bankName || ''} ${company.mfo ? 'МФО ' + company.mfo : ''}`, style: 'small' } : {},
      company.phone ? { text: `Тел: ${company.phone}`, style: 'small' } : {},
      { text: '', margin: [0, 8] },

      // Покупець
      { text: 'Покупець:', style: 'label' },
      { text: contractor.short_name || contractor.name || '—', style: 'value', bold: true },
      contractor.edrpou ? { text: `ЄДРПОУ: ${contractor.edrpou}${contractor.ipn ? ', ІПН: ' + contractor.ipn : ''}`, style: 'small' } : {},
      contractor.legal_address || contractor.address ? { text: `Адреса: ${contractor.legal_address || contractor.address}`, style: 'small' } : {},
      contractor.iban ? { text: `IBAN: ${contractor.iban}`, style: 'small' } : {},
      { text: '', margin: [0, 8] },

      // Таблиця позицій
      {
        table: {
          headerRows: 1,
          widths: [25, '*', 40, 50, 70, 30, 50, 70],
          body: [
            [
              { text: '№', style: 'th' },
              { text: 'Найменування', style: 'th' },
              { text: 'К-сть', style: 'th' },
              { text: 'Од.', style: 'th' },
              { text: 'Ціна', style: 'th' },
              { text: 'ПДВ%', style: 'th' },
              { text: 'ПДВ', style: 'th' },
              { text: 'Сума', style: 'th' },
            ],
            ...items.map((it, i) => {
              const qty = parseFloat(it.quantity) || 0
              const price = parseFloat(it.unitPrice) || 0
              const amount = parseFloat(it.amount) || qty * price
              const vatRate = parseFloat(it.vatRate) || 0
              const vat = vatRate > 0 ? amount * vatRate / 100 : 0
              return [
                { text: i + 1, alignment: 'center' },
                { text: it.name || '' },
                { text: qty, alignment: 'center' },
                { text: it.unit || 'шт', alignment: 'center' },
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
          hLineColor: () => '#ccc',
          vLineColor: () => '#ccc',
          paddingLeft: () => 4, paddingRight: () => 4,
          paddingTop: () => 3, paddingBottom: () => 3,
        },
      },

      // Підсумки
      { text: '', margin: [0, 6] },
      { columns: [{ text: '', width: '*' }, { text: `Разом без ПДВ: ${formatMoney(subtotal)} грн`, width: 'auto', alignment: 'right', fontSize: 10 }] },
      hasVat ? { columns: [{ text: '', width: '*' }, { text: `ПДВ: ${formatMoney(vatAmount)} грн`, width: 'auto', alignment: 'right', fontSize: 10 }] } : {},
      { columns: [{ text: '', width: '*' }, { text: `Всього до сплати: ${formatMoney(total)} грн`, width: 'auto', alignment: 'right', fontSize: 12, bold: true }] },
      { text: '', margin: [0, 4] },
      { text: amountInWords(total), italics: true, fontSize: 9, color: '#555' },

      // Примітки
      notes ? { text: `Примітка: ${notes}`, margin: [0, 10, 0, 0], fontSize: 9, color: '#666' } : {},

      // Підписи
      { text: '', margin: [0, 30] },
      {
        columns: [
          { text: `${company.directorPosition || 'Директор'} ________________ ${company.director || ''}`, fontSize: 9 },
          { text: 'М.П.', alignment: 'center', fontSize: 9 },
        ],
      },
    ],
    styles: {
      header: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      label: { fontSize: 9, color: '#888', margin: [0, 0, 0, 2] },
      value: { fontSize: 11, margin: [0, 0, 0, 2] },
      small: { fontSize: 9, color: '#555', margin: [0, 0, 0, 1] },
      th: { bold: true, fontSize: 9, fillColor: '#f5f5f5', alignment: 'center' },
    },
  }
}

export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)

  const data = [
    [`Рахунок на оплату №${docNumber} від ${formatDate(docDate)}`],
    [],
    ['Постачальник:', company.shortName || company.name, '', 'ЄДРПОУ:', company.edrpou],
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
  ]

  const wb = createWorkbook()
  addSheet(wb, data, 'Рахунок')
  return wb
}

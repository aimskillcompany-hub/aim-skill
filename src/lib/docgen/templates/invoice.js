// ── Шаблон: Рахунок на оплату ──
import { formatMoney, formatDate, formatDateLong, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'
import { defaultDocDef, header, partiesRow, tableHeader, tableLayout, totalsBlock, signatures, footer, itemRow } from './shared'

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const rows = items.map((it, i) => itemRow(it, i).cells)

  return {
    ...defaultDocDef,
    content: [
      ...header(company, 'РАХУНОК НА ОПЛАТУ', docNumber, formatDateLong(docDate)),
      partiesRow(company, contractor),
      {
        table: {
          headerRows: 1,
          widths: [22, '*', 35, 40, 58, 28, 48, 62],
          body: [tableHeader(['№', 'Найменування', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума']), ...rows],
        },
        layout: tableLayout,
      },
      ...totalsBlock(subtotal, vatAmount, total),
      notes ? { text: `Примітка: ${notes}`, margin: [0, 10, 0, 0], fontSize: 8, color: '#999', italics: true } : {},
      ...signatures(company, contractor, company.directorPosition || 'Директор', null),
      ...footer(company, 'INV', docNumber, docDate, total, contractor.edrpou),
    ],
  }
}

export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const data = [
    [`Рахунок на оплату №${docNumber} від ${formatDate(docDate)}`],
    [], ['Постачальник:', company.shortName || company.name, '', 'ЄДРПОУ:', company.edrpou],
    ['Адреса:', company.address, '', 'IBAN:', company.iban],
    ['Покупець:', contractor.short_name || contractor.name, '', 'ЄДРПОУ:', contractor.edrpou],
    [], ['№', 'Найменування', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'],
    ...items.map((it, i) => { const r = itemRow(it, i); return [i+1, it.name, r.qty, it.unit||'шт', r.price, r.vatRate>0?`${r.vatRate}%`:'', r.vat, r.amount+r.vat] }),
    [], ['','','','','','','Без ПДВ:', subtotal], ['','','','','','','ПДВ:', vatAmount], ['','','','','','','Всього:', total],
  ]
  const wb = createWorkbook(); addSheet(wb, data, 'Рахунок'); return wb
}

// ── Шаблон: Акт наданих послуг ──
import { formatMoney, formatDate, formatDateLong, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'
import { C, defaultDocDef, header, partiesRow, tableHeader, tableLayout, totalsBlock, signatures, footer, itemRow } from './shared'

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const rows = items.map((it, i) => itemRow(it, i).cells)

  return {
    ...defaultDocDef,
    content: [
      ...header(company, 'АКТ НАДАНИХ ПОСЛУГ', docNumber, formatDateLong(docDate)),

      // Преамбула
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
        fontSize: 9, lineHeight: 1.5, margin: [0, 0, 0, 14],
      },

      // Сторони
      partiesRow(company, contractor, 'ВИКОНАВЕЦЬ', 'ЗАМОВНИК'),

      // Таблиця
      {
        table: {
          headerRows: 1,
          widths: [22, '*', 35, 42, 58, 28, 48, 62],
          body: [tableHeader(['№', 'Найменування послуги', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума']), ...rows],
        },
        layout: tableLayout,
      },
      ...totalsBlock(subtotal, vatAmount, total),

      // Текст прийому
      { text: '', margin: [0, 10] },
      {
        table: {
          widths: ['*'],
          body: [[{
            text: 'Вищевказані послуги виконані повністю та в строк. Замовник претензій щодо обсягу, якості та строків надання послуг не має.',
            fontSize: 9, lineHeight: 1.4, margin: [10, 8, 10, 8], color: C.brand,
          }]],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => C.blueBg },
      },

      notes ? { text: `Примітка: ${notes}`, margin: [0, 10, 0, 0], fontSize: 8, color: '#999', italics: true } : {},
      ...signatures(company, contractor, 'ВИКОНАВЕЦЬ:', 'ЗАМОВНИК:'),
      ...footer(company, 'ACT', docNumber, docDate, total, contractor.edrpou),
    ],
  }
}

export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const data = [
    [`Акт наданих послуг №${docNumber} від ${formatDate(docDate)}`],
    [], ['Виконавець:', company.shortName || company.name, '', 'ЄДРПОУ:', company.edrpou],
    ['Замовник:', contractor.short_name || contractor.name, '', 'ЄДРПОУ:', contractor.edrpou],
    [], ['№', 'Найменування', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'],
    ...items.map((it, i) => { const r = itemRow(it, i); return [i+1, it.name, r.qty, it.unit||'послуга', r.price, r.vatRate>0?`${r.vatRate}%`:'', r.vat, r.amount+r.vat] }),
    [], ['','','','','','','Без ПДВ:', subtotal], ['','','','','','','ПДВ:', vatAmount], ['','','','','','','Всього:', total],
  ]
  const wb = createWorkbook(); addSheet(wb, data, 'Акт'); return wb
}

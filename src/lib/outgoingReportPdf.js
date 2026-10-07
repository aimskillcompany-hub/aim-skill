// PDF «Звіт по видатковій» для бухгалтера: шапка видаткової + по кожному товару джерела
// закупівлі (прихідні накладні, FIFO). Через pdfmake; ₴ → «грн».
import { downloadPdf } from './docgen/pdfBuilder'
import { getCompany } from './companyConfig'

const _m = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n) => _m.format(Math.round((Number(n) || 0) * 100) / 100) + ' грн'
const _q = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 })
const qn = (n) => _q.format(Number(n) || 0)
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const GREY = '#5E5A6B', DARK = '#17151F'

export async function exportOutgoingReportPdf(report) {
  const company = await getCompany().catch(() => null)
  const { doc, items } = report

  const body = []
  items.forEach((it, idx) => {
    // рядок товару
    body.push([
      { text: `${idx + 1}. ${it.name}`, bold: true, fontSize: 10, colSpan: 4, fillColor: '#F4F2FA', margin: [0, 2, 0, 2] }, {}, {}, {},
      { text: `${qn(it.soldQty)} ${it.unit}`, bold: true, fontSize: 9.5, alignment: 'right', fillColor: '#F4F2FA' },
    ])
    // підзаголовок джерел
    body.push([
      { text: 'Прихідна накладна', fontSize: 7.5, color: GREY, bold: true },
      { text: 'Дата', fontSize: 7.5, color: GREY, bold: true },
      { text: 'Постачальник', fontSize: 7.5, color: GREY, bold: true },
      { text: 'К-сть', fontSize: 7.5, color: GREY, bold: true, alignment: 'right' },
      { text: 'Собівартість', fontSize: 7.5, color: GREY, bold: true, alignment: 'right' },
    ])
    if (!it.sources.length) {
      body.push([{ text: 'Джерело не знайдено (немає прихідних рухів)', colSpan: 5, fontSize: 8.5, color: '#C62828' }, {}, {}, {}, {}])
    }
    it.sources.forEach(s => {
      body.push([
        { text: s.docNumber || '—', fontSize: 8.5 },
        { text: s.docDate ? d(s.docDate) : '—', fontSize: 8.5 },
        { text: s.supplierName || '—', fontSize: 8.5 },
        { text: `${qn(s.qty)} ${it.unit}`, fontSize: 8.5, alignment: 'right' },
        { text: money(s.cost), fontSize: 8.5, alignment: 'right' },
      ])
    })
  })
  const totalCost = items.reduce((s, it) => s + it.sources.reduce((x, src) => x + (Number(src.cost) || 0), 0), 0)
  body.push([
    { text: 'Разом собівартість проданого', colSpan: 4, bold: true, fontSize: 9, fillColor: '#FAF9FC' }, {}, {}, {},
    { text: money(totalCost), bold: true, fontSize: 9.5, alignment: 'right', fillColor: '#FAF9FC' },
  ])

  const docDefinition = {
    pageSize: 'A4', pageOrientation: 'portrait', pageMargins: [40, 36, 40, 44],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: DARK },
    footer: (cur, cnt) => ({ margin: [40, 8, 40, 0], columns: [
      { text: 'Сформовано в AiM Skill', fontSize: 7, color: '#9AA0AE' },
      { text: `${cur}/${cnt}`, fontSize: 7, color: '#9AA0AE', alignment: 'right' },
    ] }),
    content: [
      { text: (company?.shortName || company?.name || 'Компанія'), fontSize: 10, bold: true },
      company?.edrpou ? { text: `ЄДРПОУ ${company.edrpou}`, fontSize: 8.5, color: GREY } : {},
      { text: 'Звіт по видатковій накладній', fontSize: 16, bold: true, margin: [0, 14, 0, 2] },
      { text: `№ ${doc.doc_number} від ${d(doc.doc_date)}`, fontSize: 10.5, bold: true, margin: [0, 0, 0, 2] },
      { text: `Покупець: ${doc.contractorName}${doc.contractorEdrpou ? ' · ЄДРПОУ ' + doc.contractorEdrpou : ''}`, fontSize: 9, color: GREY },
      { text: `Сума: ${money(doc.amount)}${doc.vat_amount ? ' (у т.ч. ПДВ ' + money(doc.vat_amount) + ')' : ''}`, fontSize: 9, color: GREY, margin: [0, 0, 0, 14] },

      { text: 'ТОВАРИ ТА ДЖЕРЕЛА ЗАКУПІВЛІ (FIFO)', fontSize: 9, bold: true, margin: [0, 0, 0, 6] },
      {
        table: { widths: ['*', 'auto', '*', 'auto', 'auto'], body },
        layout: { hLineWidth: () => 0.5, hLineColor: () => '#ECEAF2', vLineWidth: () => 0, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 3, paddingBottom: () => 3 },
      },
      { text: 'Джерело кожного товару визначено за FIFO (найраніші закупівлі списуються першими).', fontSize: 7.5, color: '#9AA0AE', margin: [0, 10, 0, 0] },
    ],
  }
  downloadPdf(docDefinition, `Звіт по видатковій ${doc.doc_number}.pdf`)
}

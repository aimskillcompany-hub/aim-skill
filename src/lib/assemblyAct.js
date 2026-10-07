// PDF «Акт збірки» для бухгалтера: списані компоненти (витрачено) + оприбуткований виріб (отримано).
// Через pdfmake; ₴ → «грн» (Roboto без гліфа гривні).
import { downloadPdf } from './docgen/pdfBuilder'
import { getCompany } from './companyConfig'

const _m = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n) => _m.format(Math.round((Number(n) || 0) * 100) / 100) + ' грн'
const _q = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 })
const qty = (n) => _q.format(Number(n) || 0)
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''
const GREY = '#5E5A6B', DARK = '#17151F'

export async function exportAssemblyAct(a) {
  const company = await getCompany().catch(() => null)
  const items = a.items || []
  const spent = items.reduce((s, it) => s + (Number(it.total) || 0), 0)
  const unitCost = a.quantity ? (Number(a.total_cost) || spent) / a.quantity : (Number(a.total_cost) || spent)
  const prodName = a.products?.name || a.name || 'Готовий виріб'
  const prodUnit = a.products?.unit || 'шт'
  const num = (a.id || '').slice(0, 8).toUpperCase()

  const compHead = [
    { text: '№', bold: true, fontSize: 8.5, color: GREY },
    { text: 'Компонент (списано)', bold: true, fontSize: 8.5, color: GREY },
    { text: 'К-сть', bold: true, fontSize: 8.5, color: GREY, alignment: 'right' },
    { text: 'Од.', bold: true, fontSize: 8.5, color: GREY, alignment: 'center' },
    { text: 'Собівартість/од', bold: true, fontSize: 8.5, color: GREY, alignment: 'right' },
    { text: 'Сума', bold: true, fontSize: 8.5, color: GREY, alignment: 'right' },
  ]
  const compBody = [compHead]
  items.forEach((it, i) => {
    compBody.push([
      { text: String(i + 1), fontSize: 9 },
      { text: it.products?.name || '—', fontSize: 9 },
      { text: qty(it.quantity), fontSize: 9, alignment: 'right' },
      { text: it.products?.unit || 'шт', fontSize: 9, alignment: 'center' },
      { text: money(it.cost_price), fontSize: 9, alignment: 'right' },
      { text: money(it.total), fontSize: 9, alignment: 'right', bold: true },
    ])
  })
  compBody.push([
    { text: 'Разом списано', colSpan: 5, bold: true, fontSize: 9, fillColor: '#FAF9FC' }, {}, {}, {}, {},
    { text: money(spent), bold: true, fontSize: 9.5, alignment: 'right', fillColor: '#FAF9FC' },
  ])

  const recvBody = [
    compHead.map((h, i) => i === 1 ? { ...h, text: 'Готовий виріб (оприбутковано)' } : h),
    [
      { text: '1', fontSize: 9 },
      { text: prodName, fontSize: 9 },
      { text: qty(a.quantity), fontSize: 9, alignment: 'right' },
      { text: prodUnit, fontSize: 9, alignment: 'center' },
      { text: money(unitCost), fontSize: 9, alignment: 'right' },
      { text: money(a.total_cost || spent), fontSize: 9, alignment: 'right', bold: true },
    ],
    [
      { text: 'Разом оприбутковано', colSpan: 5, bold: true, fontSize: 9, fillColor: '#FAF9FC' }, {}, {}, {}, {},
      { text: money(a.total_cost || spent), bold: true, fontSize: 9.5, alignment: 'right', fillColor: '#FAF9FC' },
    ],
  ]

  const widths = ['auto', '*', 'auto', 'auto', 'auto', 'auto']
  const tableLayout = {
    hLineWidth: (i) => (i === 1 ? 1 : 0.5), hLineColor: () => '#ECEAF2', vLineWidth: () => 0,
    paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
  }

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
      { text: `АКТ збірки № ${num}`, fontSize: 16, bold: true, margin: [0, 14, 0, 2] },
      { text: `від ${d(a.assembled_at)} · операція виробництва/комплектації`, fontSize: 9, color: GREY, margin: [0, 0, 0, 14] },

      { text: `Виготовлено: ${prodName} — ${qty(a.quantity)} ${prodUnit}`, fontSize: 10.5, bold: true, margin: [0, 0, 0, 10] },

      { text: 'СПИСАНО ЗІ СКЛАДУ (витрачено)', fontSize: 9, bold: true, color: '#991B1B', margin: [0, 0, 0, 4] },
      { table: { headerRows: 1, widths, body: compBody }, layout: tableLayout, margin: [0, 0, 0, 16] },

      { text: 'ОПРИБУТКОВАНО НА СКЛАД (отримано)', fontSize: 9, bold: true, color: '#166534', margin: [0, 0, 0, 4] },
      { table: { headerRows: 1, widths, body: recvBody }, layout: tableLayout, margin: [0, 0, 0, 16] },

      { text: `Собівартість готового виробу дорівнює вартості списаних компонентів: ${money(a.total_cost || spent)}.`, fontSize: 9, color: GREY, margin: [0, 0, 0, 24] },

      { columns: [
        { stack: [{ text: 'Склав: _______________', fontSize: 9 }, { text: '(підпис, П.І.Б.)', fontSize: 7.5, color: GREY, margin: [0, 2, 0, 0] }] },
        { stack: [{ text: 'Перевірив (бухгалтер): _______________', fontSize: 9 }, { text: '(підпис, П.І.Б.)', fontSize: 7.5, color: GREY, margin: [0, 2, 0, 0] }], alignment: 'right' },
      ] },
    ],
  }
  downloadPdf(docDefinition, `Акт збірки ${num} ${d(a.assembled_at)}.pdf`)
}

// PDF «Звіт по видатковій / акту» для бухгалтера: шапка документа + по кожному товару джерела
// закупівлі (прихідні накладні, FIFO). Через pdfmake; ₴ → «грн».
import { downloadPdf } from './docgen/pdfBuilder'
import { getCompany } from './companyConfig'

const _m = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n) => _m.format(Math.round((Number(n) || 0) * 100) / 100) + ' грн'
const _q = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 })
const qn = (n) => _q.format(Number(n) || 0)
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const GREY = '#5E5A6B', DARK = '#17151F'
const pad = (n) => ' '.repeat(n * 3)

const RED = '#C62828', RED_BG = '#FDECEC'
// Рядок нестачі: кількість, не покрита прихідними
function pushShort(body, qty, unit, depth) {
  body.push([
    { text: pad(depth) + '⚠ Нестача — не покрито прихідними', colSpan: 3, fontSize: 8.5, bold: true, color: RED, fillColor: RED_BG }, {}, {},
    { text: `${qn(qty)} ${unit}`, fontSize: 8.5, bold: true, color: RED, alignment: 'right', fillColor: RED_BG },
    { text: '—', fontSize: 8.5, color: GREY, alignment: 'right', fillColor: RED_BG },
  ])
}

// Рекурсивно додає рядок джерела (прихідна або розкрита збірка) у body таблиці
function pushSource(body, s, unit, depth) {
  if (s.type === 'assembly') {
    body.push([
      { text: pad(depth) + (s.docNumber || 'Збірка'), colSpan: 3, fontSize: 8.5, bold: true, color: '#5B2FD6', fillColor: '#F4F2FA' }, {}, {},
      { text: `${qn(s.qty)} ${unit}`, fontSize: 8.5, alignment: 'right', fillColor: '#F4F2FA' },
      { text: money(s.cost), fontSize: 8.5, alignment: 'right', fillColor: '#F4F2FA' },
    ])
    ;(s.components || []).forEach(c => {
      body.push([{ text: pad(depth + 1) + '↳ ' + c.name + '  ·  ' + qn(c.qty) + ' ' + c.unit, colSpan: 5, fontSize: 8, italics: true, color: GREY }, {}, {}, {}, {}])
      if (!c.sources.length && !(c.shortQty > 0)) body.push([{ text: pad(depth + 2) + 'джерело не знайдено', colSpan: 5, fontSize: 8, color: '#C62828' }, {}, {}, {}, {}])
      c.sources.forEach(cs => pushSource(body, cs, c.unit, depth + 2))
      if (c.shortQty > 0) pushShort(body, c.shortQty, c.unit, depth + 2)
    })
    return
  }
  body.push([
    { text: pad(depth) + (s.docNumber || '—'), fontSize: 8.5, color: s.type === 'doc' ? DARK : GREY },
    { text: s.docDate ? d(s.docDate) : '—', fontSize: 8.5 },
    { text: s.supplierName || '—', fontSize: 8.5 },
    { text: `${qn(s.qty)} ${unit}`, fontSize: 8.5, alignment: 'right' },
    { text: money(s.cost), fontSize: 8.5, alignment: 'right' },
  ])
}

export async function exportOutgoingReportPdf(report) {
  const company = await getCompany().catch(() => null)
  const { doc, items } = report
  const shortages = report.shortages || []

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
    if (!it.sources.length && !(it.shortQty > 0)) {
      body.push([{ text: 'Джерело не знайдено (немає прихідних рухів)', colSpan: 5, fontSize: 8.5, color: RED }, {}, {}, {}, {}])
    }
    it.sources.forEach(s => pushSource(body, s, it.unit, 0))
    if (it.shortQty > 0) pushShort(body, it.shortQty, it.unit, 0)
  })
  const services = report.services || []
  const costDocs = report.orderCostDocs || []
  const COST_LABEL = { serviceAct: 'Вхідний акт', incomingWaybill: 'Прихідна', other: 'Документ' }
  const tblLayout = { hLineWidth: () => 0.5, hLineColor: () => '#ECEAF2', vLineWidth: () => 0, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 3, paddingBottom: () => 3 }
  const headCell = (t, right) => ({ text: t, fontSize: 7.5, color: GREY, bold: true, alignment: right ? 'right' : 'left' })
  const servicesBlock = services.length ? [
    { text: doc.isAct ? 'ПОСЛУГИ ЗА АКТОМ' : 'ПОЗИЦІЇ БЕЗ СКЛАДСЬКОГО РУХУ', fontSize: 9, bold: true, margin: [0, 14, 0, 6] },
    { table: { widths: ['*', 'auto', 'auto'], body: [
      [headCell('Найменування'), headCell('К-сть', 1), headCell('Сума', 1)],
      ...services.map(sv => [
        { text: sv.name, fontSize: 8.5 },
        { text: sv.qty != null ? `${qn(sv.qty)} ${sv.unit}` : '—', fontSize: 8.5, alignment: 'right' },
        { text: money(sv.amount), fontSize: 8.5, alignment: 'right' },
      ]),
    ] }, layout: tblLayout },
  ] : []
  const costBlock = doc.isAct ? [
    { text: 'ВИТРАТИ ПО ЗАМОВЛЕННЮ (ВХІДНІ ДОКУМЕНТИ)', fontSize: 9, bold: true, margin: [0, 14, 0, 6] },
    costDocs.length ? { table: { widths: ['*', 'auto', '*', 'auto'], body: [
      [headCell('Документ'), headCell('Дата'), headCell('Постачальник'), headCell('Сума', 1)],
      ...costDocs.map(cd => [
        { text: `${COST_LABEL[cd.type] || 'Документ'} № ${cd.doc_number || '—'}`, fontSize: 8.5 },
        { text: d(cd.doc_date), fontSize: 8.5 },
        { text: cd.supplierName, fontSize: 8.5 },
        { text: money(cd.amount), fontSize: 8.5, alignment: 'right' },
      ]),
      [{ text: 'Разом витрат', colSpan: 3, bold: true, fontSize: 9, fillColor: '#FAF9FC' }, {}, {},
       { text: money(costDocs.reduce((t, x) => t + (Number(x.amount) || 0), 0)), bold: true, fontSize: 9, alignment: 'right', fillColor: '#FAF9FC' }],
    ] }, layout: tblLayout }
    : { text: doc.order_id ? 'У замовленні немає вхідних актів / прихідних накладних.' : "Акт не прив'язаний до замовлення.", fontSize: 8.5, color: GREY },
  ] : []

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
      { text: doc.isAct ? 'Звіт по акту наданих послуг' : 'Звіт по видатковій накладній', fontSize: 16, bold: true, margin: [0, 14, 0, 2] },
      { text: `№ ${doc.doc_number} від ${d(doc.doc_date)}`, fontSize: 10.5, bold: true, margin: [0, 0, 0, 2] },
      { text: `Покупець: ${doc.contractorName}${doc.contractorEdrpou ? ' · ЄДРПОУ ' + doc.contractorEdrpou : ''}`, fontSize: 9, color: GREY },
      { text: `Сума: ${money(doc.amount)}${doc.vat_amount ? ' (у т.ч. ПДВ ' + money(doc.vat_amount) + ')' : ''}`, fontSize: 9, color: GREY, margin: [0, 0, 0, 14] },

      shortages.length ? {
        table: { widths: ['*', 'auto'], body: [
          [{ text: `⚠ НЕСТАЧА: ${shortages.length} поз. без прихідних — собівартість по них не врахована`, colSpan: 2, bold: true, fontSize: 9, color: RED, fillColor: RED_BG }, {}],
          ...shortages.map(s => [
            { text: s.name + (s.via ? `  ·  компонент збірки «${s.via}»` : ''), fontSize: 8.5 },
            { text: `${qn(s.qty)} ${s.unit}`, fontSize: 8.5, bold: true, color: RED, alignment: 'right' },
          ]),
        ] },
        layout: { hLineWidth: () => 0.5, hLineColor: () => '#F2C4C4', vLineWidth: () => 0, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 3, paddingBottom: () => 3 },
        margin: [0, 0, 0, 14],
      } : {},

      ...(items.length || !doc.isAct ? [
        { text: 'ТОВАРИ ТА ДЖЕРЕЛА ЗАКУПІВЛІ (FIFO)', fontSize: 9, bold: true, margin: [0, 0, 0, 6] },
        { table: { widths: ['*', 'auto', '*', 'auto', 'auto'], body }, layout: tblLayout },
      ] : []),
      ...servicesBlock,
      ...costBlock,
      { text: 'Джерело кожного товару визначено за FIFO (найраніші закупівлі списуються першими).', fontSize: 7.5, color: '#9AA0AE', margin: [0, 10, 0, 0] },
    ],
  }
  downloadPdf(docDefinition, `Звіт по ${doc.isAct ? 'акту' : 'видатковій'} ${doc.doc_number}.pdf`)
}

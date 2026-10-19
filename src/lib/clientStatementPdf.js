// PDF «Нагадування про заборгованість / Виписка по розрахунках» для клієнта (pdfmake, Roboto з кирилицею).
// A4 книжкова, «Стор. X з N», шапка таблиці повторюється на кожній сторінці.
// Спрощено (ТЗ 2026-10-19): шапка постачальника + «Кому» + таблиця документів із товарами + «Разом до сплати».
// Без KPI-карток, реквізитів для оплати й підпису. Кожна накладна — жирний рядок на сірому фоні, товари з відступом.
import { downloadPdf, getPdfBlob } from './docgen/pdfBuilder'
import { LOGO_BASE64 } from './docgen/logo'
import { money, dmy, docTitle, fileBase } from './clientStatement'

const DARK = '#17151F', GREY = '#5E5A6B', LIGHT = '#9AA0AE', LINE = '#E6E2F0', DOC_BG = '#F2F2F2'
const _q = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 })
const qn = (v) => _q.format(Number(v) || 0).replace(/ /g, ' ')

export function clientStatementDoc(st) {
  const c = st.company
  const logo = c.logoBase64 || (c.isAim ? LOGO_BASE64 : null)
  const contractLine = st.contracts.length
    ? st.contracts.map(x => `№ ${x.num}${x.date ? ' від ' + dmy(x.date) : ''}`).join('; ')
    : null

  // ── Таблиця: Документ / товар · Дата відвант. · Сума · Залишок · Днів з відвантаження ──
  const H = (t, right) => ({ text: t, bold: true, fontSize: 7.5, color: GREY, alignment: right ? 'right' : 'left', margin: [0, 2, 0, 2] })
  const body = [[H('Документ / товар'), H('Дата відвант.'), H('Сума, грн', 1), H('Залишок, грн', 1), H('Днів з відвант.', 1)]]
  const docRowIdx = new Set() // індекси рядків-документів — над ними лінія-розділювач
  st.docs.forEach(d => {
    docRowIdx.add(body.length)
    const cell = (o) => ({ fillColor: DOC_BG, bold: true, fontSize: 9, margin: [0, 2, 0, 2], ...o })
    body.push([
      cell({ text: docTitle(d) }),
      cell({ text: dmy(d.doc_date), bold: false, fontSize: 8.5 }),
      cell({ text: money(d.amount), alignment: 'right' }),
      cell({ text: money(d.outstanding), alignment: 'right' }),
      cell({ text: String(d.ageDays), alignment: 'right' }),
    ])
    if (st.withItems && d.items?.rows?.length) {
      d.items.rows.forEach(r => {
        const qty = r.qty != null ? `  ·  ${qn(r.qty)} ${r.unit || ''} × ${money(r.price)}` : ''
        body.push([
          { text: [{ text: `${r.n}. `, color: LIGHT }, r.name, r.sku ? { text: `  · арт. ${r.sku}`, color: LIGHT } : '', { text: qty, color: LIGHT }], colSpan: 2, fontSize: 8, color: GREY, margin: [12, 0, 0, 0] }, {},
          { text: money(r.sum), fontSize: 8, color: GREY, alignment: 'right' },
          {}, {},
        ])
      })
    }
    d.payments.filter(p => p.amount > 0).forEach(p => {
      body.push([
        { text: `Оплачено ${p.date ? dmy(p.date) : ''}`, colSpan: 2, fontSize: 8, italics: true, color: '#1F7A4D', margin: [12, 0, 0, 0] }, {},
        { text: `−${money(p.amount)}`, fontSize: 8, italics: true, color: '#1F7A4D', alignment: 'right' }, {}, {},
      ])
    })
  })
  const totalIdx = body.length
  body.push([
    { text: 'Разом до сплати', colSpan: 3, bold: true, fontSize: 10, margin: [0, 4, 0, 4] }, {}, {},
    { text: money(st.summary.total), bold: true, fontSize: 10, alignment: 'right', margin: [0, 4, 0, 4] },
    { text: '' },
  ])

  return {
    pageSize: 'A4', pageOrientation: 'portrait', pageMargins: [36, 36, 36, 46],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: DARK },
    footer: (cur, cnt) => ({ margin: [36, 12, 36, 0], columns: [
      { text: `${c.shortName || c.name} · ${st.title}`, fontSize: 7, color: LIGHT },
      { text: `Стор. ${cur} з ${cnt}`, fontSize: 7, color: LIGHT, alignment: 'right' },
    ] }),
    content: [
      // Шапка постачальника
      { columns: [
        { width: '*', stack: [
          logo ? { image: logo, width: 70, margin: [0, 0, 0, 6] } : {},
          { text: c.name || c.shortName, bold: true, fontSize: 10 },
          { text: [c.edrpou ? `ЄДРПОУ ${c.edrpou}` : '', c.ipn ? `  ·  ІПН ${c.ipn}` : ''].join(''), fontSize: 8, color: GREY },
          c.address ? { text: c.address, fontSize: 8, color: GREY } : {},
          { text: [c.phone, c.email].filter(Boolean).join('  ·  '), fontSize: 8, color: GREY },
        ] },
        { width: 250, stack: [
          { text: st.title, fontSize: 15, bold: true, alignment: 'right' },
          { text: `станом на ${dmy(st.asOf)}`, fontSize: 9.5, alignment: 'right', margin: [0, 2, 0, 0] },
          { text: `сформовано ${dmy(st.generatedAt.slice(0, 10))}`, fontSize: 7.5, color: LIGHT, alignment: 'right' },
        ] },
      ] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 10, 0, 8] },
      // Кому
      { text: 'КОМУ', fontSize: 7, bold: true, color: GREY, letterSpacing: 1 },
      { text: st.contractor.name, bold: true, fontSize: 10.5, margin: [0, 1, 0, 0] },
      { text: [st.contractor.edrpou ? `ЄДРПОУ ${st.contractor.edrpou}` : '', contractLine ? `${st.contractor.edrpou ? '  ·  ' : ''}Договір ${contractLine}` : ''].join(''), fontSize: 8.5, color: GREY, margin: [0, 0, 0, 14] },

      // Документи
      { table: { headerRows: 1, dontBreakRows: true, widths: ['*', 58, 70, 74, 50], body },
        layout: {
          // тонка лінія над кожною накладною (крім першої) і над «Разом»; між товарами ліній немає
          hLineWidth: (i) => (i === 1 ? 0.8 : (docRowIdx.has(i) && i > 1) || i === totalIdx ? 0.8 : 0),
          hLineColor: () => '#CFCBD9', vLineWidth: () => 0,
          paddingLeft: () => 5, paddingRight: () => 5,
          paddingTop: (i) => (docRowIdx.has(i) && i > 1 ? 4 : 2), paddingBottom: () => 2,
        } },
    ],
  }
}

export const pdfFileName = (st) => `Нагадування_${fileBase(st)}.pdf`
export function downloadClientStatementPdf(st) { downloadPdf(clientStatementDoc(st), pdfFileName(st)) }
export function clientStatementPdfBlob(st) { return getPdfBlob(clientStatementDoc(st)) }

// PDF «Нагадування про заборгованість / Виписка по розрахунках» для клієнта (pdfmake, Roboto з кирилицею).
// A4 книжкова, «Стор. X з N», шапка таблиці повторюється на кожній сторінці. 4 блоки: шапка, підсумок,
// деталізація (документ → товари → оплати), реквізити для оплати + підпис менеджера.
import { downloadPdf, getPdfBlob } from './docgen/pdfBuilder'
import { LOGO_BASE64 } from './docgen/logo'
import { money, dmy, docTitle, fileBase } from './clientStatement'

const DARK = '#17151F', GREY = '#5E5A6B', LIGHT = '#9AA0AE', LINE = '#E6E2F0', SOFT = '#F6F4FA', RED = '#C62828'
const _q = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 })
const qn = (v) => _q.format(Number(v) || 0).replace(/ /g, ' ')

export function clientStatementDoc(st, manager = {}) {
  const c = st.company
  const logo = c.logoBase64 || (c.isAim ? LOGO_BASE64 : null)
  const contractLine = st.contracts.length
    ? st.contracts.map(x => `№ ${x.num}${x.date ? ' від ' + dmy(x.date) : ''}`).join('; ')
    : null

  // ── Деталізація ──
  const H = (t, right) => ({ text: t, bold: true, fontSize: 7.5, color: GREY, alignment: right ? 'right' : 'left', fillColor: SOFT, margin: [0, 2, 0, 2] })
  const body = [[H('Документ / товар'), H('Дата відвант.'), H('Строк оплати'), H('Сума, грн', 1), H('Оплачено, грн', 1), H('Залишок, грн', 1), H('Простр., дн.', 1)]]
  st.docs.forEach(d => {
    body.push([
      { text: docTitle(d), bold: true, fontSize: 9 },
      { text: dmy(d.doc_date), fontSize: 8.5 },
      { text: dmy(d.dueDate), fontSize: 8.5 },
      { text: money(d.amount), fontSize: 8.5, alignment: 'right' },
      { text: money(d.paid), fontSize: 8.5, alignment: 'right', color: d.paid > 0 ? DARK : LIGHT },
      { text: money(d.outstanding), fontSize: 9, bold: true, alignment: 'right' },
      { text: d.overdueDays > 0 ? String(d.overdueDays) : '—', fontSize: 9, bold: d.overdueDays > 0, alignment: 'right', color: d.overdueDays > 0 ? RED : LIGHT },
    ])
    if (st.withItems && d.items?.rows?.length) {
      d.items.rows.forEach(r => {
        const qty = r.qty != null ? `${qn(r.qty)} ${r.unit || ''} × ${money(r.price)}` : ''
        body.push([
          { text: [{ text: `${r.n}. `, color: LIGHT }, r.name, r.sku ? { text: `  · арт. ${r.sku}`, color: LIGHT } : ''], colSpan: 3, fontSize: 8, color: GREY, margin: [10, 0, 0, 0] }, {}, {},
          { text: qty, colSpan: 2, fontSize: 7.5, color: GREY, alignment: 'right' }, {},
          { text: money(r.sum), fontSize: 8, color: GREY, alignment: 'right' },
          {},
        ])
      })
    }
    d.payments.filter(p => p.amount > 0).forEach(p => {
      body.push([
        { text: `Оплата ${p.date ? 'від ' + dmy(p.date) : ''}`, colSpan: 4, fontSize: 8, italics: true, color: '#1F7A4D', margin: [10, 0, 0, 0] }, {}, {}, {},
        { text: money(p.amount), fontSize: 8, italics: true, color: '#1F7A4D', alignment: 'right' }, {}, {},
      ])
    })
  })
  body.push([
    { text: 'Разом до сплати', colSpan: 5, bold: true, fontSize: 10, fillColor: SOFT, margin: [0, 3, 0, 3] }, {}, {}, {}, {},
    { text: money(st.summary.total), bold: true, fontSize: 10, alignment: 'right', fillColor: SOFT, margin: [0, 3, 0, 3] },
    { text: '', fillColor: SOFT },
  ])

  const kv = (k, v) => v ? { columns: [{ text: k, width: 70, fontSize: 8, color: GREY }, { text: v, width: '*', fontSize: 8.5 }], margin: [0, 1, 0, 1] } : null
  const box = (label, value, sub, color) => ({
    width: '*', table: { widths: ['*'], body: [[{ stack: [
      { text: label, fontSize: 7.5, color: GREY },
      { text: value, fontSize: 14, bold: true, color: color || DARK, margin: [0, 2, 0, 0] },
      sub ? { text: sub, fontSize: 7.5, color: GREY, margin: [0, 2, 0, 0] } : {},
    ], margin: [8, 6, 8, 6], fillColor: SOFT }]] }, layout: 'noBorders',
  })

  return {
    pageSize: 'A4', pageOrientation: 'portrait', pageMargins: [36, 36, 36, 46],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: DARK },
    footer: (cur, cnt) => ({ margin: [36, 12, 36, 0], columns: [
      { text: `${c.shortName || c.name} · ${st.title}`, fontSize: 7, color: LIGHT },
      { text: `Стор. ${cur} з ${cnt}`, fontSize: 7, color: LIGHT, alignment: 'right' },
    ] }),
    content: [
      // 1. Шапка
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
      { text: 'КОМУ', fontSize: 7, bold: true, color: GREY, letterSpacing: 1 },
      { text: st.contractor.name, bold: true, fontSize: 10.5, margin: [0, 1, 0, 0] },
      { text: [st.contractor.edrpou ? `ЄДРПОУ ${st.contractor.edrpou}` : '', contractLine ? `${st.contractor.edrpou ? '  ·  ' : ''}Договір ${contractLine}` : ''].join(''), fontSize: 8.5, color: GREY, margin: [0, 0, 0, 12] },

      // 2. Підсумок
      { columns: [
        box('До сплати', `${money(st.summary.total)} грн`, st.vatPayer ? `у т.ч. ПДВ ${money(st.summary.vat)} грн` : 'Без ПДВ'),
        { width: 8, text: '' },
        box('З них прострочено', `${money(st.summary.overdue)} грн`, st.summary.overdue > 0 ? `найбільша прострочка — ${st.summary.maxOverdue} дн.` : 'прострочки немає', st.summary.overdue > 0 ? RED : DARK),
        { width: 8, text: '' },
        box('Неоплачених документів', String(st.summary.count), st.onlyOverdue ? 'лише прострочені' : null),
      ], margin: [0, 0, 0, 14] },

      // 3. Деталізація
      { text: 'ДЕТАЛІЗАЦІЯ', fontSize: 7.5, bold: true, color: GREY, letterSpacing: 1, margin: [0, 0, 0, 4] },
      { table: { headerRows: 1, dontBreakRows: true, widths: ['*', 50, 50, 62, 58, 64, 34], body },
        layout: { hLineWidth: (i) => i === 0 ? 0 : 0.5, hLineColor: () => LINE, vLineWidth: () => 0, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 } },

      // 4. Реквізити для оплати
      { text: 'РЕКВІЗИТИ ДЛЯ ОПЛАТИ', fontSize: 7.5, bold: true, color: GREY, letterSpacing: 1, margin: [0, 16, 0, 4] },
      { unbreakable: true, stack: [
        kv('Отримувач', c.name || c.shortName),
        kv('ЄДРПОУ', c.edrpou),
        kv('IBAN', c.iban),
        kv('Банк', c.bankName ? `${c.bankName}${c.mfo ? ', МФО ' + c.mfo : ''}` : null),
        kv('Сума', `${money(st.summary.total)} грн`),
        kv('Призначення', st.purpose),
      ].filter(Boolean) },
      { text: 'Якщо оплату вже здійснено — просимо надіслати платіжне доручення.', fontSize: 8.5, italics: true, color: GREY, margin: [0, 10, 0, 0] },

      // Підпис
      { unbreakable: true, margin: [0, 22, 0, 0], columns: [
        { width: '*', stack: [
          { text: manager.position || 'Менеджер', fontSize: 8, color: GREY },
          { text: manager.name || '', fontSize: 9.5, bold: true },
          { text: [manager.phone, manager.email].filter(Boolean).join('  ·  '), fontSize: 8, color: GREY },
        ] },
        { width: 180, stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 22, x2: 170, y2: 22, lineWidth: 0.5, lineColor: GREY }] },
          { text: 'підпис', fontSize: 7, color: LIGHT, margin: [0, 2, 0, 0] },
        ] },
      ] },
    ],
  }
}

export const pdfFileName = (st) => `Нагадування_${fileBase(st)}.pdf`
export function downloadClientStatementPdf(st, manager) { downloadPdf(clientStatementDoc(st, manager), pdfFileName(st)) }
export function clientStatementPdfBlob(st, manager) { return getPdfBlob(clientStatementDoc(st, manager)) }

// ── Шаблон: Рахунок на оплату ──
import { formatMoney, formatDate, formatDateLong, amountInWords, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'
import { LOGO_BASE64 } from '../logo'

const BLACK = '#0A0A0A'
const DARK = '#1C1C1E'
const G1 = '#3A3A3C'
const G2 = '#8E8E93'
const G3 = '#C7C7CC'
const G4 = '#E5E5EA'
const GREEN = '#00C853'

function itm(it, i) {
  const q = parseFloat(it.quantity) || 0, p = parseFloat(it.unitPrice) || 0
  const a = parseFloat(it.amount) || q * p, vr = parseFloat(it.vatRate) || 0
  const v = vr > 0 ? a * vr / 100 : 0
  return { n: i + 1, name: it.name || '', q, u: it.unit || 'шт', p, vr, v, t: a + v, a }
}

const rv = (label, value) => value ? {
  columns: [
    { text: label, width: 52, fontSize: 7.5, color: G2, alignment: 'right', margin: [0, 0, 4, 0] },
    { text: value, width: '*', fontSize: 8, color: G1 },
  ], margin: [0, 1.5, 0, 1.5],
} : null

const aimLogo = (size) => ({
  text: [
    { text: 'A', color: BLACK, bold: true }, { text: 'i', color: GREEN, bold: true },
    { text: 'M ', color: BLACK, bold: true }, { text: 'Sk', color: BLACK, bold: true },
    { text: 'i', color: GREEN, bold: true }, { text: 'll.', color: BLACK, bold: true },
  ], fontSize: size || 8,
})

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes, contractNum, contractDate, paymentDue, city } = options
  const { subtotal, vatAmount, total, vatByRate } = calcTotals(items)
  const qrData = `AIM|INV|${docNumber}|${docDate}|${total}|${company.edrpou}|${contractor.edrpou || ''}`
  const rows = items.map((it, i) => itm(it, i))
  const contractStr = contractNum ? `№${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : null
  const paymentPurpose = `Оплата за товари/послуги згідно рахунку №${docNumber} від ${formatDate(docDate)}${contractStr ? `, Договір ${contractStr}` : ''}. ${vatAmount > 0 ? `В т.ч. ПДВ 20% — ${formatMoney(vatAmount)} грн` : 'Без ПДВ'}`

  return {
    pageSize: 'A4',
    pageMargins: [44, 40, 44, 46],
    defaultStyle: { fontSize: 9.5, color: G1 },

    header: {
      columns: [
        { image: LOGO_BASE64, width: 64, margin: [44, 16, 0, 0] },
        {
          width: '*', alignment: 'right', margin: [0, 18, 44, 0],
          stack: [
            { text: company.shortName || company.name, fontSize: 9, bold: true, color: BLACK },
            { text: `ЄДРПОУ ${company.edrpou}  ·  ІПН ${company.ipn || ''}`, fontSize: 7, color: G2, margin: [0, 2, 0, 0] },
          ],
        },
      ],
    },

    footer: (currentPage, pageCount) => ({
      margin: [44, 0, 44, 10],
      columns: [
        { qr: qrData, fit: 30, foreground: G2 },
        {
          stack: [
            { text: `${docNumber}  ·  ${formatDate(docDate)}  ·  ${formatMoney(total)} грн`, fontSize: 6.5, color: G2, margin: [6, 5, 0, 0] },
            { text: 'QR: тип, номер, дата, сума, ЄДРПОУ сторін', fontSize: 5, color: G3, margin: [6, 1, 0, 0] },
          ],
          width: '*',
        },
        {
          width: 'auto', alignment: 'right', margin: [0, 4, 0, 0],
          stack: [aimLogo(8), { text: `${currentPage}/${pageCount}`, fontSize: 5.5, color: G3, alignment: 'right', margin: [0, 1, 0, 0] }],
        },
      ],
    }),

    content: [
      { text: '', margin: [0, 10, 0, 0] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 427, y2: 0, lineWidth: 2, lineColor: BLACK }], margin: [0, 0, 0, 20] },

      // ═══ НАЗВА ═══
      { text: 'РАХУНОК НА ОПЛАТУ', fontSize: 7.5, letterSpacing: 4, color: G2 },
      { text: `№ ${docNumber}`, fontSize: 26, bold: true, color: BLACK, margin: [0, 2, 0, 4] },
      {
        columns: [
          { text: formatDateLong(docDate), fontSize: 10, color: G2, width: 'auto' },
          city ? { text: `  ·  ${city}`, fontSize: 10, color: G2, width: 'auto' } : {},
        ],
        margin: [0, 0, 0, 14],
      },

      // ═══ СТОРОНИ ═══
      {
        columns: [
          {
            width: '49%',
            stack: [
              { text: 'ПОСТАЧАЛЬНИК', fontSize: 7, letterSpacing: 2, color: G2, margin: [0, 0, 0, 6] },
              { text: company.shortName || company.name, fontSize: 10, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
              rv('ЄДРПОУ', company.edrpou), rv('ІПН', company.ipn),
              rv('Адреса', company.address),
              rv('IBAN', company.iban),
              rv('Банк', company.bankName ? `${company.bankName}, МФО ${company.mfo}` : null),
              rv('Тел.', company.phone), rv('Email', company.email),
            ].filter(Boolean),
          },
          { width: '2%', text: '' },
          {
            width: '49%',
            stack: [
              { text: 'ПОКУПЕЦЬ', fontSize: 7, letterSpacing: 2, color: G2, margin: [0, 0, 0, 6] },
              { text: contractor.short_name || contractor.name || '—', fontSize: 10, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
              rv('ЄДРПОУ', contractor.edrpou),
              rv('Адреса', contractor.legal_address || contractor.address),
              rv('IBAN', contractor.iban),
              rv('Тел.', contractor.phone),
            ].filter(Boolean),
          },
        ],
        margin: [0, 0, 0, 12],
      },

      // ═══ ДОДАТКОВА ІНФОРМАЦІЯ ═══
      (contractStr || paymentDue) ? {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: 'ДОДАТКОВА ІНФОРМАЦІЯ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 4] },
              contractStr ? { text: `Договір ${contractStr}`, fontSize: 8.5, color: G1, margin: [0, 0, 0, 2] } : {},
              paymentDue ? { text: `Термін оплати: ${paymentDue}`, fontSize: 8.5, color: G1 } : {},
            ].filter(Boolean),
            margin: [10, 8, 10, 8],
          }]],
        },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => G4 },
        margin: [0, 0, 0, 16],
      } : { text: '', margin: [0, 0, 0, 4] },

      // ═══ ТАБЛИЦЯ ═══
      {
        table: {
          headerRows: 1,
          widths: [20, '*', 30, 36, 62, 24, 48, 62],
          body: [
            ['№', 'Найменування', 'К-сть', 'Од.', 'Вартість без ПДВ', 'ПДВ', 'Сума ПДВ', 'Сума'].map(t => ({
              text: t, fontSize: 6.5, bold: true, color: '#FFF', fillColor: DARK,
              alignment: 'center', margin: [0, 7, 0, 7],
            })),
            ...rows.map(r => [
              { text: r.n, alignment: 'center', fontSize: 9, color: G2 },
              { text: r.name, fontSize: 9, color: BLACK },
              { text: r.q, alignment: 'center', fontSize: 9 },
              { text: r.u, alignment: 'center', fontSize: 8, color: G2 },
              { text: formatMoney(r.p), alignment: 'right', fontSize: 9 },
              { text: r.vr > 0 ? `${r.vr}%` : '—', alignment: 'center', fontSize: 7.5, color: G2 },
              { text: formatMoney(r.v), alignment: 'right', fontSize: 9, color: G2 },
              { text: formatMoney(r.t), alignment: 'right', fontSize: 9, bold: true, color: BLACK },
            ]),
          ],
        },
        layout: {
          hLineWidth: (i) => i === 0 ? 0 : i === 1 ? 1.5 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? DARK : G4,
          paddingLeft: () => 5, paddingRight: () => 5,
          paddingTop: () => 7, paddingBottom: () => 7,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
        },
      },

      // ═══ ПІДСУМКИ ═══
      { text: '', margin: [0, 10] },
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 230,
            stack: [
              sr('Разом без ПДВ', subtotal),
              ...Object.entries(vatByRate).map(([rate, amt]) => sr(`ПДВ ${rate}%`, amt)),
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 1, lineColor: DARK }], margin: [0, 6, 0, 6] },
              {
                columns: [
                  { text: 'Всього до сплати', alignment: 'right', fontSize: 12, bold: true, color: BLACK, width: '*' },
                  { text: formatMoney(total), alignment: 'right', fontSize: 16, bold: true, color: BLACK, width: 120 },
                  { text: 'грн', fontSize: 10, color: G2, width: 26, margin: [4, 5, 0, 0] },
                ],
              },
            ],
          },
        ],
      },
      { text: '', margin: [0, 4] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 427, y2: 0, lineWidth: 0.5, lineColor: G4 }], margin: [0, 0, 0, 4] },
      { text: amountInWords(total), fontSize: 8, italics: true, color: G2 },

      // ═══ ПРИЗНАЧЕННЯ ПЛАТЕЖУ ═══
      { text: '', margin: [0, 10] },
      { text: 'ПРИЗНАЧЕННЯ ПЛАТЕЖУ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 4] },
      { text: paymentPurpose, fontSize: 8.5, color: G1, lineHeight: 1.4 },

      notes ? { text: `Примітка: ${notes}`, fontSize: 8, color: G2, italics: true, margin: [0, 8, 0, 0] } : {},

      // ═══ ПІДПИС ═══
      { text: '', margin: [0, 18] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 427, y2: 0, lineWidth: 0.5, lineColor: G4 }], margin: [0, 0, 0, 8] },
      {
        width: '48%',
        stack: [
          { text: 'ВИПИСАВ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 16] },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
          { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
          { text: 'М.П.', fontSize: 6.5, color: G3, margin: [0, 5, 0, 0] },
        ],
      },
    ],
  }
}

function sr(label, amount) {
  return {
    columns: [
      { text: label, alignment: 'right', fontSize: 9, color: G2, width: '*' },
      { text: formatMoney(amount), alignment: 'right', fontSize: 9, color: G1, width: 120 },
      { text: 'грн', fontSize: 8, color: G3, width: 26, margin: [4, 1, 0, 0] },
    ],
    margin: [0, 2, 0, 2],
  }
}

export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate, contractNum, contractDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const contract = contractNum ? `Договір №${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : ''
  const data = [
    [`Рахунок на оплату №${docNumber} від ${formatDate(docDate)}`],
    contract ? [contract] : [],
    [], ['Постачальник:', company.shortName || company.name, '', 'ЄДРПОУ:', company.edrpou],
    ['Адреса:', company.address, '', 'IBAN:', company.iban],
    ['Покупець:', contractor.short_name || contractor.name, '', 'ЄДРПОУ:', contractor.edrpou],
    [], ['№', 'Найменування', 'К-сть', 'Од.', 'Вартість без ПДВ', 'ПДВ%', 'Сума ПДВ', 'Сума'],
    ...items.map((it, i) => { const r = itm(it, i); return [r.n, r.name, r.q, r.u, r.p, r.vr > 0 ? `${r.vr}%` : '', r.v, r.t] }),
    [], ['','','','','','','Без ПДВ:', subtotal], ['','','','','','','ПДВ:', vatAmount], ['','','','','','','Всього:', total],
    [], [amountInWords(total)],
  ].filter(r => r.length > 0)
  const wb = createWorkbook(); addSheet(wb, data, 'Рахунок'); return wb
}

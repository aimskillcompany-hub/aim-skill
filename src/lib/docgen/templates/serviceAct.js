// ── Шаблон: Акт здачі-прийняття робіт (надання послуг) ──
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
  return { n: i + 1, name: it.name || '', q, u: it.unit || 'послуга', p, vr, v, t: a + v, a }
}

const aimLogo = (sz) => ({
  text: [
    { text: 'A', color: BLACK, bold: true }, { text: 'i', color: GREEN, bold: true },
    { text: 'M ', color: BLACK, bold: true }, { text: 'Sk', color: BLACK, bold: true },
    { text: 'i', color: GREEN, bold: true }, { text: 'll.', color: BLACK, bold: true },
  ], fontSize: sz || 8,
})

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes, contractNum, contractDate, city, invoiceRef, invoiceRefDate } = options
  const { subtotal, vatAmount, total, vatByRate } = calcTotals(items)
  const qrData = `AIM|ACT|${docNumber}|${docDate}|${total}|${company.edrpou}|${contractor.edrpou || ''}`
  const rows = items.map((it, i) => itm(it, i))
  const contractStr = contractNum ? `${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : '____'
  const dirShort = company.director ? company.director.split(' ').map((w, i) => i === 0 ? w : w[0] + '.').join(' ') : ''
  const contrDirShort = contractor.contact_person ? contractor.contact_person.split(' ').map((w, i) => i === 0 ? w : w[0] + '.').join(' ') : '________'

  return {
    pageSize: 'A4',
    pageMargins: [44, 20, 44, 46],
    defaultStyle: { fontSize: 9.5, color: G1 },

    footer: (cp, pc) => ({
      margin: [44, 0, 44, 10],
      columns: [
        { qr: qrData, fit: 28, foreground: G2 },
        { text: `${docNumber} · ${formatDate(docDate)} · ${formatMoney(total)} грн`, fontSize: 6, color: G3, margin: [6, 8, 0, 0], width: '*' },
        { ...aimLogo(7), alignment: 'right', margin: [0, 7, 0, 0], width: 'auto' },
      ],
    }),

    content: [
      // ═══ БЛОК "ЗАТВЕРДЖУЮ" — дві колонки ═══
      {
        columns: [
          approveBlock(
            company.shortName || company.name,
            company.edrpou, company.ipn, company.iban,
            company.bankName ? `${company.bankName}, МФО ${company.mfo}` : '',
            company.address,
            company.directorPosition || 'Директор', company.director || '',
          ),
          { width: 20, text: '' },
          approveBlock(
            contractor.short_name || contractor.name || '________',
            contractor.edrpou || '________', contractor.ipn || '',
            contractor.iban || '________',
            '', // банк
            contractor.legal_address || contractor.address || '________',
            contractor.contact_position || '________', contractor.contact_person || '________',
          ),
        ],
        margin: [0, 0, 0, 16],
      },

      // ═══ ЗАГОЛОВОК ═══
      {
        text: [
          { text: 'Акт', bold: true, fontSize: 14 },
          { text: '  |  ', color: G3, fontSize: 14 },
          { text: `№ ${docNumber}`, bold: true, fontSize: 14 },
          { text: ` від ${formatDate(docDate)}`, fontSize: 14 },
        ],
        alignment: 'center',
        margin: [0, 0, 0, 4],
      },
      {
        text: `здачі-прийняття робіт (надання послуг) згідно договору ${contractStr}`,
        alignment: 'center', fontSize: 10, color: G1,
        margin: [0, 0, 0, 14],
      },

      // ═══ ПРЕАМБУЛА ═══
      {
        text: [
          { text: 'Ми, представник Замовника ' },
          { text: contractor.short_name || contractor.name || '________', bold: true },
          { text: ` ${contrDirShort}` },
          { text: ', з одного боку, та представник Виконавця ' },
          { text: company.shortName || company.name, bold: true },
          { text: ` ${dirShort}` },
          { text: ', з іншого боку, склали цей Акт про те, що Виконавцем були виконані наступні роботи (надані послуги):' },
        ],
        fontSize: 9.5, lineHeight: 1.5, alignment: 'justify',
        margin: [0, 0, 0, 14],
      },

      // ═══ ТАБЛИЦЯ ═══
      {
        table: {
          headerRows: 1,
          widths: [22, '*', 36, 36, 68, 72],
          body: [
            ['№', 'Роботи / послуга', 'Од.', 'К-сть', 'Ціна без ПДВ', 'Сума (без ПДВ)'].map(t => ({
              text: t, fontSize: 8, bold: true, color: '#FFF', fillColor: DARK,
              alignment: 'center', margin: [0, 6, 0, 6],
            })),
            ...rows.map(r => [
              { text: r.n, alignment: 'center', fontSize: 9.5 },
              { text: r.name, fontSize: 9.5, color: BLACK },
              { text: r.u, alignment: 'center', fontSize: 9, color: G2 },
              { text: r.q, alignment: 'center', fontSize: 9.5 },
              { text: formatMoney(r.p), alignment: 'right', fontSize: 9.5 },
              { text: formatMoney(r.a), alignment: 'right', fontSize: 9.5, bold: true },
            ]),
          ],
        },
        layout: {
          hLineWidth: (i) => i === 0 ? 0 : i === 1 ? 1.5 : 0.5,
          vLineWidth: () => 0.5,
          hLineColor: (i) => i === 1 ? DARK : G4,
          vLineColor: () => G4,
          paddingLeft: () => 6, paddingRight: () => 6,
          paddingTop: () => 6, paddingBottom: () => 6,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
        },
      },

      // ═══ ПІДСУМКИ ═══
      { text: '', margin: [0, 6] },
      {
        table: {
          widths: ['*', 100, 90],
          body: [
            ['', { text: 'Всього без ПДВ:', alignment: 'right', fontSize: 9.5, color: G1 }, { text: formatMoney(subtotal), alignment: 'right', fontSize: 9.5, bold: true }],
            ...Object.entries(vatByRate).map(([rate, amt]) =>
              ['', { text: `Сума ПДВ ${rate}%:`, alignment: 'right', fontSize: 9.5, color: G1 }, { text: formatMoney(amt), alignment: 'right', fontSize: 9.5, bold: true }]
            ),
            ['', { text: 'Всього з ПДВ:', alignment: 'right', fontSize: 11, bold: true, color: BLACK }, { text: formatMoney(total), alignment: 'right', fontSize: 13, bold: true, color: BLACK }],
          ],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 4],
      },
      { text: amountInWords(total), fontSize: 8.5, italics: true, color: G2, margin: [0, 0, 0, 12] },

      // ═══ ТЕКСТ ПРИЙОМУ ═══
      {
        text: 'Підписання цього акту Замовником підтверджує факт виконання робіт (надання послуг) у повному обсязі, належної якості та в узгоджені терміни. Претензії щодо обсягу, якості або строків виконання після підписання не приймаються, якщо інше не передбачено договором.',
        fontSize: 9.5, lineHeight: 1.5, alignment: 'justify', color: G1,
        margin: [0, 0, 0, 20],
      },

      notes ? { text: `Примітка: ${notes}`, fontSize: 8, color: G2, italics: true, margin: [0, 0, 0, 14] } : {},

      // ═══ ПІДПИСИ ═══
      {
        columns: [
          {
            width: '48%',
            stack: [
              { text: 'ВІД ВИКОНАВЦЯ (ПОСТАЧАЛЬНИКА)', fontSize: 7, letterSpacing: 1, color: G2, margin: [0, 0, 0, 10] },
              { text: `Посада: ${company.directorPosition || 'Директор'}`, fontSize: 9, margin: [0, 0, 0, 4] },
              { text: `ПІБ: ${dirShort}`, fontSize: 9, margin: [0, 0, 0, 10] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
              { text: '(підпис)', fontSize: 7, color: G3, margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: '48%',
            stack: [
              { text: 'ВІД ЗАМОВНИКА', fontSize: 7, letterSpacing: 1, color: G2, margin: [0, 0, 0, 10] },
              { text: `Посада: ${contractor.contact_position || '________'}`, fontSize: 9, margin: [0, 0, 0, 4] },
              { text: `ПІБ: ${contrDirShort}`, fontSize: 9, margin: [0, 0, 0, 10] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
              { text: '(підпис)', fontSize: 7, color: G3, margin: [0, 2, 0, 0] },
            ],
          },
        ],
      },
    ],
  }
}

function approveBlock(name, edrpou, ipn, iban, bank, address, position, director) {
  return {
    width: '*',
    stack: [
      { text: 'З А Т В Е Р Д Ж У Ю', fontSize: 8, letterSpacing: 2, bold: true, color: G1, margin: [0, 0, 0, 6] },
      { text: name, fontSize: 9, bold: true, color: BLACK, margin: [0, 0, 0, 3] },
      edrpou ? { text: `ЄДРПОУ: ${edrpou}`, fontSize: 8, color: G1, margin: [0, 0, 0, 1] } : {},
      iban ? { text: `IBAN: ${iban}`, fontSize: 7.5, color: G1, margin: [0, 0, 0, 1] } : {},
      bank ? { text: bank, fontSize: 7.5, color: G2, margin: [0, 0, 0, 1] } : {},
      ipn ? { text: `ІПН: ${ipn}`, fontSize: 8, color: G1, margin: [0, 0, 0, 1] } : {},
      address ? { text: `Адреса: ${address}`, fontSize: 7.5, color: G2, margin: [0, 0, 0, 6] } : {},
      { text: '____________________________', fontSize: 9, color: G3, margin: [0, 0, 0, 2] },
      { text: `${position} ${director}`, fontSize: 8.5, color: G1 },
    ],
  }
}

// ── EXCEL ──
export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate, contractNum, contractDate, invoiceRef, invoiceRefDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const contractStr = contractNum ? `Договір №${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : ''
  const data = [
    [`Акт здачі-прийняття робіт (надання послуг) №${docNumber} від ${formatDate(docDate)}`],
    contractStr ? [contractStr] : [],
    [],
    ['Виконавець:', company.shortName || company.name, 'ЄДРПОУ:', company.edrpou, 'IBAN:', company.iban],
    ['Замовник:', contractor.short_name || contractor.name, 'ЄДРПОУ:', contractor.edrpou],
    [],
    ['№', 'Роботи / послуга', 'Од.', 'К-сть', 'Ціна без ПДВ', 'Сума (без ПДВ)'],
    ...items.map((it, i) => { const r = itm(it, i); return [r.n, r.name, r.u, r.q, r.p, r.a] }),
    [],
    ['', '', '', '', 'Всього без ПДВ:', subtotal],
    ['', '', '', '', 'Сума ПДВ 20%:', vatAmount],
    ['', '', '', '', 'Всього з ПДВ:', total],
    [],
    [amountInWords(total)],
  ].filter(r => r.length > 0)
  const wb = createWorkbook(); addSheet(wb, data, 'Акт'); return wb
}

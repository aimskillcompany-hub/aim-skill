// ── Шаблон: Акт наданих послуг — Perfected ──
import { formatMoney, formatDate, formatDateLong, amountInWords, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'
import { LOGO_BASE64 } from '../logo'

const BLACK = '#0A0A0A'
const DARK = '#1C1C1E'
const G1 = '#3A3A3C'
const G2 = '#8E8E93'
const G3 = '#C7C7CC'
const G4 = '#E5E5EA'
const G5 = '#F2F2F7'

function itm(it, i) {
  const q = parseFloat(it.quantity) || 0, p = parseFloat(it.unitPrice) || 0
  const a = parseFloat(it.amount) || q * p, vr = parseFloat(it.vatRate) || 0
  const v = vr > 0 ? a * vr / 100 : 0
  return { n: i + 1, name: it.name || '', q, u: it.unit || 'послуга', p, vr, v, t: a + v, a }
}

// ── Лінія ──
const line = (w, c, m) => ({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: w || 515, y2: 0, lineWidth: 0.5, lineColor: c || G4 }], margin: m || [0, 0, 0, 0] })

// ── Рядок реквізитів ──
const rv = (label, value) => value ? {
  columns: [
    { text: label, width: 52, fontSize: 7.5, color: G2, alignment: 'right', margin: [0, 0, 4, 0] },
    { text: value, width: '*', fontSize: 8, color: G1 },
  ], margin: [0, 1, 0, 1],
} : null

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes, contractNum, contractDate, city } = options
  const { subtotal, vatAmount, total, vatByRate } = calcTotals(items)
  const qrData = `AIM|ACT|${docNumber}|${docDate}|${total}|${company.edrpou}`
  const rows = items.map((it, i) => itm(it, i))
  const contract = contractNum ? `№${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : null

  return {
    pageSize: 'A4',
    pageMargins: [44, 40, 44, 50],
    defaultStyle: { fontSize: 9.5, color: G1 },

    // ═══ HEADER як повторюваний елемент ═══
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

    // ═══ FOOTER ═══
    footer: (currentPage, pageCount) => ({
      margin: [44, 0, 44, 0],
      columns: [
        { qr: qrData, fit: 28, foreground: G3 },
        { text: `${docNumber}  ·  ${formatDate(docDate)}`, fontSize: 6, color: G3, margin: [6, 9, 0, 0], width: 'auto' },
        { text: `${currentPage}/${pageCount}`, fontSize: 6, color: G3, alignment: 'center', margin: [0, 9, 0, 0] },
        { text: 'AiM Skill', fontSize: 7, bold: true, color: G3, alignment: 'right', margin: [0, 9, 0, 0] },
      ],
    }),

    content: [
      // Відступ від header
      { text: '', margin: [0, 10, 0, 0] },

      // ═══ ЛІНІЯ ═══
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 427, y2: 0, lineWidth: 2, lineColor: BLACK }], margin: [0, 0, 0, 20] },

      // ═══ ДОКУМЕНТ ═══
      { text: 'АКТ НАДАНИХ ПОСЛУГ', fontSize: 7.5, letterSpacing: 4, color: G2 },
      { text: `№ ${docNumber}`, fontSize: 26, bold: true, color: BLACK, margin: [0, 2, 0, 0] },
      {
        columns: [
          { text: formatDateLong(docDate), fontSize: 10, color: G2, width: 'auto' },
          city ? { text: `  ·  ${city}`, fontSize: 10, color: G2, width: 'auto' } : {},
        ],
        margin: [0, 2, 0, 0],
      },
      contract ? { text: `Договір ${contract}`, fontSize: 9, color: G1, margin: [0, 4, 0, 0] } : {},

      { text: '', margin: [0, 14, 0, 0] },

      // ═══ ПРЕАМБУЛА — структурований текст ═══
      {
        text: [
          { text: company.name || company.shortName, bold: true, color: BLACK },
          { text: ` (Виконавець), в особі ${company.directorPosition || 'Директора'} ` },
          { text: company.director || '________', color: BLACK },
          { text: ', що діє на підставі Статуту, з однієї сторони,\nта ' },
          { text: contractor.name || contractor.short_name || '________', bold: true, color: BLACK },
          { text: ' (Замовник)' },
          contractor.contact_person ? { text: `, в особі ${(contractor.contact_position || '').trim()} ${contractor.contact_person}`.trim() } : {},
          { text: ', з іншої сторони,' },
          contract ? { text: `\nна підставі Договору ${contract},` } : {},
          { text: '\nсклали цей Акт про наступне:' },
        ],
        fontSize: 9, lineHeight: 1.6, color: G1, margin: [0, 0, 0, 16],
      },

      // ═══ СТОРОНИ — структуровані рядки ═══
      {
        columns: [
          {
            width: '49%',
            stack: [
              { text: 'ВИКОНАВЕЦЬ', fontSize: 7, letterSpacing: 2, color: G2, margin: [0, 0, 0, 6] },
              { text: company.shortName || company.name, fontSize: 10, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
              rv('ЄДРПОУ', company.edrpou),
              rv('Адреса', company.address),
              rv('IBAN', company.iban),
              rv('Банк', company.bankName ? `${company.bankName}, МФО ${company.mfo}` : null),
              rv('Тел.', company.phone),
            ].filter(Boolean),
          },
          { width: '2%', text: '' },
          {
            width: '49%',
            stack: [
              { text: 'ЗАМОВНИК', fontSize: 7, letterSpacing: 2, color: G2, margin: [0, 0, 0, 6] },
              { text: contractor.short_name || contractor.name || '—', fontSize: 10, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
              rv('ЄДРПОУ', contractor.edrpou),
              rv('Адреса', contractor.legal_address || contractor.address),
              rv('IBAN', contractor.iban),
              rv('Тел.', contractor.phone),
            ].filter(Boolean),
          },
        ],
        margin: [0, 0, 0, 18],
      },

      // ═══ ТАБЛИЦЯ ═══
      {
        table: {
          headerRows: 1,
          widths: [20, '*', 30, 36, 58, 24, 46, 62],
          body: [
            ['№', 'Найменування послуги', 'К-сть', 'Од.', 'Ціна', 'ПДВ', 'ПДВ ₴', 'Сума'].map(t => ({
              text: t, fontSize: 7, bold: true, color: '#FFF', fillColor: DARK,
              alignment: 'center', margin: [0, 7, 0, 7],
            })),
            ...rows.map((r, i) => [
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
          paddingLeft: () => 6, paddingRight: () => 6,
          paddingTop: () => 7, paddingBottom: () => 7,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
        },
      },

      // ═══ ПІДСУМКИ — виражені ═══
      { text: '', margin: [0, 10] },
      ...sumBlock(subtotal, vatByRate, total),

      // Сума прописом
      { text: '', margin: [0, 4] },
      line(427, G4, [0, 0, 0, 4]),
      { text: amountInWords(total), fontSize: 8, italics: true, color: G2 },

      // ═══ ТЕКСТ ПРИЙОМУ ═══
      { text: '', margin: [0, 12] },
      {
        text: [
          'Виконавець виконав, а Замовник прийняв послуги у повному обсязі. ',
          'Сторони не мають взаємних претензій щодо строків, якості та обсягу наданих послуг. ',
          'Вартість наданих послуг складає ',
          { text: `${formatMoney(total)} грн`, bold: true, color: BLACK },
          ` (${amountInWords(total).toLowerCase()})`,
          vatAmount > 0 ? `, у т.ч. ПДВ — ${formatMoney(vatAmount)} грн` : ', без ПДВ',
          '.',
        ],
        fontSize: 9, lineHeight: 1.5, color: G1,
      },

      notes ? { text: notes, fontSize: 8, color: G2, italics: true, margin: [0, 8, 0, 0] } : {},

      // ═══ ПІДПИСИ — табличні, вирівняні ═══
      { text: '', margin: [0, 20] },
      line(427, G4, [0, 0, 0, 0]),
      { text: '', margin: [0, 8] },
      {
        columns: [
          sigBlock('ВИКОНАВЕЦЬ', company.directorPosition || 'Директор', company.director || ''),
          { width: 30, text: '' },
          sigBlock('ЗАМОВНИК', contractor.contact_position || '', contractor.contact_person || ''),
        ],
      },
    ],
  }
}

// ═══ Підсумковий блок ═══
function sumBlock(subtotal, vatByRate, total) {
  const rows = [
    sr('Разом без ПДВ', subtotal),
    ...Object.entries(vatByRate).map(([rate, amt]) => sr(`ПДВ ${rate}%`, amt)),
  ]
  return [
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 220,
          stack: [
            ...rows,
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 1, lineColor: DARK }], margin: [0, 6, 0, 6] },
            {
              columns: [
                { text: 'Всього', alignment: 'right', fontSize: 13, bold: true, color: BLACK, width: '*' },
                { text: formatMoney(total), alignment: 'right', fontSize: 16, bold: true, color: BLACK, width: 110 },
                { text: 'грн', fontSize: 10, color: G2, width: 24, margin: [4, 5, 0, 0] },
              ],
            },
          ],
        },
      ],
    },
  ]
}

function sr(label, amount) {
  return {
    columns: [
      { text: label, alignment: 'right', fontSize: 9, color: G2, width: '*' },
      { text: formatMoney(amount), alignment: 'right', fontSize: 9, color: G1, width: 110 },
      { text: 'грн', fontSize: 8, color: G3, width: 24, margin: [4, 1, 0, 0] },
    ],
    margin: [0, 2, 0, 2],
  }
}

function sigBlock(title, position, name) {
  return {
    width: '*',
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: title, fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 20] },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
          (position || name) ? { text: `${position} ${name}`.trim(), fontSize: 9, color: G1, margin: [0, 4, 0, 0] } : {},
          { text: 'М.П.', fontSize: 6.5, color: G3, margin: [0, 6, 0, 0] },
        ],
        margin: [0, 0, 0, 0],
      }]],
    },
    layout: 'noBorders',
  }
}

function rv2(label, value) {
  return value ? {
    columns: [
      { text: label, width: 52, fontSize: 7.5, color: G2, alignment: 'right', margin: [0, 0, 4, 0] },
      { text: value, width: '*', fontSize: 8, color: G1 },
    ], margin: [0, 1, 0, 1],
  } : null
}

// ── EXCEL ──
export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate, contractNum, contractDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const contract = contractNum ? `Договір №${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : ''
  const data = [
    [`Акт наданих послуг №${docNumber} від ${formatDate(docDate)}`],
    contract ? [`Підстава: ${contract}`] : [],
    [], ['Виконавець:', company.shortName || company.name, '', 'ЄДРПОУ:', company.edrpou],
    ['Замовник:', contractor.short_name || contractor.name, '', 'ЄДРПОУ:', contractor.edrpou],
    [], ['№', 'Найменування', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'],
    ...items.map((it, i) => { const r = itm(it, i); return [r.n, r.name, r.q, r.u, r.p, r.vr > 0 ? `${r.vr}%` : '', r.v, r.t] }),
    [], ['','','','','','','Без ПДВ:', subtotal], ['','','','','','','ПДВ:', vatAmount], ['','','','','','','Всього:', total],
    [], [amountInWords(total)],
  ].filter(r => r.length > 0)
  const wb = createWorkbook(); addSheet(wb, data, 'Акт'); return wb
}

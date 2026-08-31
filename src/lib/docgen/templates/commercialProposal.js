// ── Шаблон: Комерційна пропозиція ──
import { formatMoney, formatDate, formatDateLong, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'
import { LOGO_BASE64 } from '../logo'
import { stampOverlay } from '../stamp'

const BLACK = '#0A0A0A'
const DARK = '#1C1C1E'
const G1 = '#3A3A3C'
const G2 = '#8E8E93'
const G3 = '#C7C7CC'
const G4 = '#E5E5EA'
const LIME = '#14DF62'   // акцентний колір КП
const GREEN = '#4A7C59'
const ACCENT = '#2E7D46' // темно-зелений акцент (тонкі лінії)

// Скорочення форми власності у назві: «ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ …» → «ТОВ …»
const shortenName = (n) => (n || '')
  .replace(/товариство з обмеженою відповідальністю/i, 'ТОВ')
  .replace(/приватне підприємство/i, 'ПП')
  .replace(/фізична особа[-\s—]*підприємець/i, 'ФОП')
  .replace(/\s+/g, ' ').trim()

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + (Number(days) || 14))
  return d.toISOString().slice(0, 10)
}

function itm(it, i) {
  const q = parseFloat(it.quantity) || 0, p = parseFloat(it.unitPrice) || 0
  const a = parseFloat(it.amount) || q * p, vr = parseFloat(it.vatRate) || 0
  const v = vr > 0 ? a * vr / 100 : 0
  return { n: i + 1, name: it.name || '', q, u: it.unit || 'шт', p, vr, v, t: a + v, a }
}

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes, validityDays } = options
  const brand = options.brand || { theme: 'aim' } // тема документа (AiM лише для ЕЙМ СКІЛ)
  const logoImg = brand.theme === 'aim' ? LOGO_BASE64 : brand.companyLogo
  const footerLine = brand.theme === 'aim'
    ? 'Сформовано в системі AiM Skill  ·  aim-skill.com.ua'
    : [brand.name, brand.phone, brand.email].filter(Boolean).join('  ·  ')
  const { subtotal, vatAmount, total, vatByRate } = calcTotals(items)
  const rows = items.map((it, i) => itm(it, i))
  const companyName = company.shortName || shortenName(company.name) || 'ТОВ «ЕЙМ СКІЛ»'
  const validTo = formatDate(addDays(docDate, validityDays))
  const vatPayer = options.vatPayer !== false
  // Чиста тема (не ЕЙМ СКІЛ): монохромні акценти замість фірмового зеленого AiM.
  const aim = brand.theme === 'aim'
  const accent = aim ? ACCENT : DARK
  const totalBg = aim ? '#F2FBF5' : '#F4F4F5'
  const ctaBg = aim ? '#F7FAF8' : '#F4F4F5'

  return {
    pageSize: 'A4',
    pageMargins: [48, 36, 48, 52],
    defaultStyle: { fontSize: 9.5, color: G1, lineHeight: 1.15 },

    footer: (page, count) => ({
      margin: [48, 0, 48, 0],
      columns: [
        { text: footerLine, fontSize: 6, color: G3 },
        { text: count > 1 ? `${page} / ${count}` : '', fontSize: 6, color: G3, alignment: 'right' },
      ],
    }),

    content: [
      // ═══ ШАПКА: лого зліва · реквізити справа ═══
      {
        columns: [
          logoImg ? { image: logoImg, width: 96, margin: [0, 6, 0, 0] } : { text: '', width: 1 },
          {
            width: '*',
            stack: [
              { text: companyName, fontSize: 12, bold: true, color: BLACK, alignment: 'right', characterSpacing: 0.3, margin: [0, 0, 0, 4] },
              { text: company.address || '', fontSize: 8.5, color: G1, alignment: 'right', lineHeight: 1.3 },
              company.phone ? { text: `телефон: ${company.phone}`, fontSize: 8.5, color: G1, alignment: 'right' } : null,
              company.email ? { text: `email: ${company.email}`, fontSize: 8.5, color: G1, alignment: 'right' } : null,
            ].filter(Boolean),
          },
        ],
        columnGap: 16,
        margin: [0, 0, 0, 8],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.6, lineColor: DARK }], margin: [0, 0, 0, 10] },

      // ═══ НОМЕР + ТЕРМІН ДІЇ ═══
      { text: `№ ${docNumber} від ${formatDateLong(docDate)}`, fontSize: 10.5, color: BLACK, margin: [0, 0, 0, 1] },
      { text: `Пропозиція дійсна до ${validTo} р.`, fontSize: 9.5, color: G1, margin: [0, 0, 0, 12] },

      // ═══ КОМУ (з відступом праворуч) ═══
      {
        columns: [
          { width: '46%', text: '' },
          {
            width: '54%',
            stack: [
              { text: 'КОМУ:', fontSize: 9, bold: true, color: G2, characterSpacing: 0.5, margin: [0, 0, 0, 3] },
              { text: contractor.name || contractor.short_name || '—', fontSize: 11, bold: true, color: BLACK, lineHeight: 1.2 },
              contractor.edrpou ? { text: `ЄДРПОУ ${contractor.edrpou}`, fontSize: 9.5, color: G1, margin: [0, 2, 0, 0] } : null,
              (contractor.legal_address || contractor.address) ? { text: contractor.legal_address || contractor.address, fontSize: 9.5, color: G1, margin: [0, 2, 0, 0], lineHeight: 1.3 } : null,
            ].filter(Boolean),
          },
        ],
        margin: [0, 0, 0, 12],
      },

      // ═══ ЗАГОЛОВОК ПО ЦЕНТРУ З ВЕРТИКАЛЬНИМ АКЦЕНТОМ ЗЛІВА ═══
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            columns: [
              { width: 3, canvas: [{ type: 'rect', x: 0, y: 2, w: 3, h: 17, color: accent }] },
              { width: 11, text: '' },
              { width: 'auto', text: 'КОМЕРЦІЙНА ПРОПОЗИЦІЯ', fontSize: 16, bold: true, color: BLACK, characterSpacing: 1.2 },
            ],
          },
          { width: '*', text: '' },
        ],
        margin: [0, 0, 0, 16],
      },

      // ═══ ВСТУП ═══
      {
        text: 'Дякуємо за звернення. Згідно з Вашим запитом надаємо комерційну пропозицію на поставку наступного товару:',
        alignment: 'justify', fontSize: 10, color: DARK, lineHeight: 1.35, leadingIndent: 26, margin: [0, 0, 0, 10],
      },

      // ═══ ТАБЛИЦЯ ТОВАРІВ ═══
      {
        table: {
          headerRows: 1,
          widths: vatPayer ? [18, '*', 26, 28, 58, 22, 44, 54] : [18, '*', 32, 34, 78, 78],
          body: [
            (vatPayer
              ? ['№', 'Найменування', 'Од.', 'К-сть', 'Ціна без ПДВ', 'ПДВ', 'Сума ПДВ', 'Сума']
              : ['№', 'Найменування', 'Од.', 'К-сть', 'Ціна', 'Сума']
            ).map((t, ci) => ({
              text: t, fontSize: 6.5, bold: true, color: '#FFF', fillColor: DARK,
              alignment: ci === 1 ? 'left' : 'center', margin: [0, 4, 0, 4],
            })),
            ...rows.map(r => [
              { text: r.n, alignment: 'center', fontSize: 8.5, color: G2 },
              { text: r.name, fontSize: 8.5, color: BLACK, lineHeight: 1.2 },
              { text: r.u, alignment: 'center', fontSize: 8, color: G2 },
              { text: r.q, alignment: 'center', fontSize: 8.5 },
              { text: formatMoney(vatPayer ? r.p : (r.q ? r.t / r.q : r.t)), alignment: 'right', fontSize: 8.5 },
              ...(vatPayer ? [
                { text: r.vr > 0 ? `${r.vr}%` : '—', alignment: 'center', fontSize: 7, color: G2 },
                { text: formatMoney(r.v), alignment: 'right', fontSize: 8.5, color: G2 },
              ] : []),
              { text: formatMoney(r.t), alignment: 'right', fontSize: 8.5, bold: true, color: BLACK },
            ]),
          ],
        },
        layout: {
          hLineWidth: (i) => i === 0 ? 0 : i === 1 ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? DARK : G4,
          paddingLeft: () => 6, paddingRight: () => 6,
          paddingTop: () => 5, paddingBottom: () => 5,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
        },
      },

      // ═══ ПІДСУМКИ ═══
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 220,
            table: {
              widths: [110, 110],
              body: [
                ...(vatPayer ? [
                  [{ text: 'Сума без ПДВ:', alignment: 'right', fontSize: 9, color: G2 }, { text: `${formatMoney(subtotal)} грн`, alignment: 'right', fontSize: 9 }],
                  ...(vatAmount > 0
                    ? Object.entries(vatByRate).map(([rate, amt]) => [{ text: `ПДВ ${rate}%:`, alignment: 'right', fontSize: 9, color: G2 }, { text: `${formatMoney(amt)} грн`, alignment: 'right', fontSize: 9 }])
                    : [[{ text: 'ПДВ:', alignment: 'right', fontSize: 9, color: G2 }, { text: 'без ПДВ', alignment: 'right', fontSize: 9, color: G2 }]]),
                ] : []),
                [
                  { text: vatPayer ? 'Всього з ПДВ:' : 'Всього:', alignment: 'right', fontSize: 10.5, bold: true, color: BLACK, fillColor: totalBg, margin: [0, 4, 0, 4] },
                  { text: `${formatMoney(total)} грн`, alignment: 'right', fontSize: 10.5, bold: true, color: BLACK, fillColor: totalBg, margin: [0, 4, 4, 4] },
                ],
              ],
            },
            layout: { defaultBorder: false, paddingTop: () => 2, paddingBottom: () => 2, paddingLeft: () => 4, paddingRight: () => 0 },
            margin: [0, 6, 0, 0],
          },
        ],
      },

      notes ? { text: notes, fontSize: 9, color: G1, margin: [0, 10, 0, 0], lineHeight: 1.4 } : {},

      // ═══ ПІДПИС + ПЕЧАТКА ═══
      { text: '', margin: [0, 8] },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'З повагою,', fontSize: 10, color: G1, margin: [0, 0, 0, 1] },
              { text: companyName, fontSize: 10.5, bold: true, color: BLACK, margin: [0, 0, 0, 16] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
              {
                text: [
                  { text: `${company.directorPosition || 'Директор'}   `, color: G2 },
                  { text: company.director || '', bold: true, color: BLACK },
                ], fontSize: 9.5, margin: [0, 4, 0, 0],
              },
            ],
          },
          {
            width: 150,
            stack: [
              { text: 'М.П.', fontSize: 9, color: G2, alignment: 'center', margin: [0, 34, 0, 0] },
              stampOverlay(options, { x: 12, y: -74, w: 134 }),
            ],
          },
        ],
      },

    ],
  }
}

export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const data = [
    [`Комерційна пропозиція №${docNumber} від ${formatDate(docDate)}`],
    [], ['Від:', company.shortName || company.name, 'ЄДРПОУ:', company.edrpou],
    ['Кому:', contractor.short_name || contractor.name, 'ЄДРПОУ:', contractor.edrpou],
    [], ['№', 'Найменування', 'Од.', 'К-сть', 'Ціна', 'Сума'],
    ...items.map((it, i) => { const r = itm(it, i); return [r.n, r.name, r.u, r.q, r.p, r.t] }),
    [], ...(vatAmount > 0 ? [['', '', '', '', 'Без ПДВ:', subtotal], ['', '', '', '', 'ПДВ:', vatAmount]] : []), ['', '', '', '', 'Всього:', total],
  ].filter(r => r.length > 0)
  const wb = createWorkbook(); addSheet(wb, data, 'КП'); return wb
}

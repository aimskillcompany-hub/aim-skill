// ── Шаблон: Комерційна пропозиція ──
import { formatMoney, formatDate, formatDateLong, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'
import { LOGO_BASE64 } from '../logo'

const BLACK = '#0A0A0A'
const DARK = '#1C1C1E'
const G1 = '#3A3A3C'
const G2 = '#8E8E93'
const G3 = '#C7C7CC'
const G4 = '#E5E5EA'
const LIME = '#14DF62'   // акцентний колір КП
const GREEN = '#4A7C59'
const TAGLINE = 'Комплексні ІТ-рішення та обладнання для бізнесу'
const ADVANTAGES = [
  'Офіційний партнер провідних брендів',
  'Гарантія та сервісна підтримка',
  'Індивідуальні умови та ціни під проєкт',
  'Швидка поставка й супровід замовлення',
]

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

const rvLine = (label, value) => value ? {
  columns: [
    { text: label, width: 42, fontSize: 8, color: G2, alignment: 'left', margin: [0, 0, 2, 0] },
    { text: value, width: '*', fontSize: 8, color: G1 },
  ], margin: [0, 1, 0, 1],
} : null

const sectionTitle = (text) => ({ text: text, fontSize: 7.5, letterSpacing: 2, color: G2, bold: true, margin: [0, 0, 0, 6] })

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes, validityDays } = options
  const { subtotal, vatAmount, total, vatByRate } = calcTotals(items)
  const rows = items.map((it, i) => itm(it, i))

  return {
    pageSize: 'A4',
    pageMargins: [40, 20, 40, 56],
    defaultStyle: { fontSize: 9, color: G1 },

    footer: () => ({
      margin: [40, 0, 40, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.3, lineColor: G4 }], margin: [0, 0, 0, 5] },
        {
          columns: [
            {
              stack: [
                { text: docNumber, fontSize: 6, bold: true, color: G2 },
                { text: 'Сформовано в корпоративній системі AiM Skill  ·  073 700 77 58  ·  office@aim-skill.com.ua  ·  www.aim-skill.com.ua', fontSize: 5.5, color: G3, margin: [0, 1, 0, 0] },
              ],
              width: '*', margin: [0, 3, 0, 0],
            },
          ],
        },
      ],
    }),

    content: [
      // ═══ ШАПКА: лого + слоган ═══
      {
        columns: [
          { image: LOGO_BASE64, width: 78, margin: [0, 2, 0, 0] },
          {
            width: '*',
            stack: [
              { text: company.shortName || company.name, fontSize: 11, bold: true, color: BLACK, alignment: 'right' },
              { text: TAGLINE, fontSize: 8, color: G2, alignment: 'right', margin: [0, 2, 0, 0] },
              { text: `${company.phone || ''}  ·  ${company.email || ''}`, fontSize: 7.5, color: G2, alignment: 'right', margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 8],
      },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 3, color: LIME }], margin: [0, 0, 0, 14] },

      // ═══ НАЗВА + БЕЙДЖ ТЕРМІНУ ═══
      {
        columns: [
          {
            width: '*',
            stack: [
              sectionTitle('КОМЕРЦІЙНА ПРОПОЗИЦІЯ'),
              { text: `від ${formatDateLong(docDate)}`, fontSize: 9, color: G1, margin: [0, 0, 0, 2] },
              { text: `№ ${docNumber}`, fontSize: 24, bold: true, color: BLACK },
            ],
          },
          {
            width: 'auto',
            table: { body: [[{ text: `Дійсна до ${formatDate(addDays(docDate, validityDays))}`, fontSize: 8.5, bold: true, color: BLACK, fillColor: LIME, margin: [10, 6, 10, 6] }]] },
            layout: 'noBorders',
            margin: [0, 6, 0, 0],
          },
        ],
        margin: [0, 0, 0, 12],
      },

      {
        columns: [
          {
            width: '49%',
            stack: [
              sectionTitle('ВІД КОГО'),
              { text: company.shortName || company.name, fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
              rvLine('ЄДРПОУ', company.edrpou),
              rvLine('Адреса', company.address),
              rvLine('Тел.', company.phone),
              rvLine('Email', company.email),
            ].filter(Boolean),
          },
          { width: '2%', text: '' },
          {
            width: '49%',
            stack: [
              sectionTitle('КОМУ'),
              { text: contractor.short_name || contractor.name || '—', fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
              rvLine('ЄДРПОУ', contractor.edrpou),
              rvLine('Адреса', contractor.legal_address || contractor.address),
              rvLine('Тел.', contractor.phone),
              rvLine('Email', contractor.email),
            ].filter(Boolean),
          },
        ],
        margin: [0, 0, 0, 10],
      },

      {
        table: {
          headerRows: 1,
          widths: [18, '*', 28, 32, 70, 70],
          body: [
            ['№', 'Найменування', 'Од.', 'К-сть', 'Ціна', 'Сума'].map(t => ({
              text: t, fontSize: 6.5, bold: true, color: '#FFF', fillColor: DARK,
              alignment: 'center', margin: [0, 3, 0, 3],
            })),
            ...rows.map(r => [
              { text: r.n, alignment: 'center', fontSize: 8.5, color: G2 },
              { text: r.name, fontSize: 8.5, color: BLACK },
              { text: r.u, alignment: 'center', fontSize: 8, color: G2 },
              { text: r.q, alignment: 'center', fontSize: 8.5 },
              { text: formatMoney(r.p), alignment: 'right', fontSize: 8.5 },
              { text: formatMoney(r.t), alignment: 'right', fontSize: 8.5, bold: true, color: BLACK },
            ]),
          ],
        },
        layout: {
          hLineWidth: (i) => i === 0 ? 0 : i === 1 ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? DARK : G4,
          paddingLeft: () => 4, paddingRight: () => 4,
          paddingTop: () => 4, paddingBottom: () => 4,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
        },
      },

      {
        columns: [
          { width: '*', text: '' },
          {
            width: 190,
            table: {
              widths: [90, 90],
              body: [
                ...(vatAmount > 0 ? [
                  [{ text: 'Без ПДВ:', alignment: 'right', fontSize: 8.5, color: G2 }, { text: `${formatMoney(subtotal)} грн`, alignment: 'right', fontSize: 8.5 }],
                  ...Object.entries(vatByRate).map(([rate, amt]) =>
                    [{ text: `ПДВ ${rate}%:`, alignment: 'right', fontSize: 8.5, color: G2 }, { text: `${formatMoney(amt)} грн`, alignment: 'right', fontSize: 8.5 }]
                  ),
                ] : []),
                [{ text: 'Всього:', alignment: 'right', fontSize: 10, bold: true, color: BLACK }, { text: `${formatMoney(total)} грн`, alignment: 'right', fontSize: 10, bold: true, color: BLACK }],
              ],
            },
            layout: 'noBorders',
            margin: [0, 4, 0, 0],
          },
        ],
      },

      notes ? { text: notes, fontSize: 8.5, color: G1, margin: [0, 8, 0, 0], lineHeight: 1.4 } : {},

      // ═══ ЧОМУ МИ ═══
      { text: '', margin: [0, 8] },
      sectionTitle('ЧОМУ AIM SKILL'),
      {
        columns: ADVANTAGES.map(a => ({
          width: '25%',
          stack: [
            { canvas: [{ type: 'rect', x: 0, y: 0, w: 18, h: 3, color: LIME }], margin: [0, 0, 0, 5] },
            { text: a, fontSize: 8, color: G1, lineHeight: 1.3 },
          ],
          margin: [0, 0, 8, 0],
        })),
        margin: [0, 0, 0, 4],
      },

      // ═══ ЗАКЛИК + КОНТАКТИ ═══
      { text: '', margin: [0, 8] },
      {
        table: {
          widths: ['*'],
          body: [[{
            border: [false, false, false, false],
            fillColor: '#FAFAFA',
            margin: [14, 12, 14, 12],
            stack: [
              { text: 'Готові обговорити деталі чи оформити замовлення?', fontSize: 10, bold: true, color: BLACK },
              { text: `Зв'яжіться з нами — підберемо оптимальне рішення під ваш бюджет.`, fontSize: 8.5, color: G1, margin: [0, 3, 0, 6] },
              { text: [
                { text: company.phone || '', bold: true, color: BLACK },
                { text: company.phone ? '   ·   ' : '', color: G3 },
                { text: company.email || '', color: GREEN },
                { text: '   ·   www.aim-skill.com.ua', color: G2 },
              ], fontSize: 9 },
            ],
          }]],
        },
        layout: { defaultBorder: false },
      },

      // ═══ ПІДПИС ═══
      { text: '', margin: [0, 10] },
      {
        width: '48%',
        stack: [
          { text: 'ПІДГОТУВАВ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 12] },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
          { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
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

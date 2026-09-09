// ── Шаблон: Комерційна пропозиція ──
import { formatMoney, formatDate, formatDateLong, calcTotals, amountInWords } from '../formatUtils'
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
  return { n: i + 1, name: it.name || '', ch: (it.characteristics || '').trim(), q, u: it.unit || 'шт', p, vr, v, t: a + v, a }
}

// Клітинка «Найменування»: назва жирна, характеристики — дрібним сірим під нею.
function nameCell(r, G2) {
  const stack = [{ text: r.name, fontSize: 9, bold: true, color: '#0A0A0A', lineHeight: 1.15 }]
  if (r.ch) stack.push({ text: r.ch, fontSize: 7.5, color: G2, lineHeight: 1.2, margin: [0, 2, 0, 0] })
  return { stack }
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
  // Теми: aim (ЕЙМ СКІЛ, зелений) · bit (БІ АЙ ТІ ГРУП, фіолетовий) — обидві на єдиному
  // чистому бланку. clean — окремий лист ФОП (нижче).
  const aim = brand.theme === 'aim'
  const bit = brand.theme === 'bit'
  const PURPLE = '#6D28D9'
  const accent = aim ? ACCENT : bit ? PURPLE : DARK
  const headerLine = aim ? '#3DBE59' : bit ? PURPLE : DARK
  const totalBg = aim ? '#F2FBF5' : bit ? '#F4F1FC' : '#F4F4F5'
  const ctaBg = aim ? '#F7FAF8' : '#F4F4F5'

  // Спільна таблиця товарів (обидві теми)
  const priceHdr = vatPayer ? 'Ціна без ПДВ' : 'Ціна'
  const sumHdr = vatPayer ? 'Сума без ПДВ' : 'Сума'
  const productsTable = {
    table: {
      headerRows: 1,
      widths: [16, '*', 24, 28, 60, 76],
      body: [
        ['№', 'Найменування', 'Од.', 'К-сть', priceHdr, sumHdr].map((t, ci) => ({
          text: t, fontSize: 6.5, bold: true, color: '#FFF', fillColor: DARK,
          alignment: ci === 1 ? 'left' : 'center', margin: [0, 4, 0, 4],
        })),
        ...rows.map(r => [
          { text: r.n, alignment: 'center', fontSize: 8.5, color: G2, noWrap: true },
          nameCell(r, G2),
          { text: r.u, alignment: 'center', fontSize: 8, color: G2, noWrap: true },
          { text: r.q, alignment: 'center', fontSize: 8.5, noWrap: true },
          { text: formatMoney(r.p), alignment: 'right', fontSize: 8.5, noWrap: true },
          { text: formatMoney(r.a), alignment: 'right', fontSize: 8.5, bold: true, color: BLACK, noWrap: true },
        ]),
      ],
    },
    layout: {
      hLineWidth: (i) => i === 0 ? 0 : i === 1 ? 1 : 0.5,
      vLineWidth: () => 0,
      hLineColor: (i) => i === 1 ? DARK : G4,
      paddingLeft: (ci) => ci === 1 ? 6 : 3, paddingRight: (ci) => ci === 1 ? 6 : 3,
      paddingTop: () => 5, paddingBottom: () => 5,
      fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
    },
  }
  const totalsBlock = {
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
  }


  // ══════════════ ТЕМА BIT: офіційний діловий лист (за зразком БІ АЙ ТІ ГРУП) ══════════════
  if (bit) {
    const fullName = (company.name || companyName).replace(/"([^"]*)"/g, '«$1»')
    const shortNm = (company.shortName || shortenName(company.name) || fullName).replace(/"([^"]*)"/g, '«$1»')
    const dp = (company.director || '').trim().split(/\s+/).filter(Boolean)
    const dirShort = dp.length ? dp[0] + (dp[1] ? ` ${dp[1][0]}.` : '') + (dp[2] ? ` ${dp[2][0]}.` : '') : ''
    const amtWords = amountInWords(total).charAt(0).toLowerCase() + amountInWords(total).slice(1)
    // Клітинка назви для рамкової таблиці (назва жирна + характеристики дрібним)
    const cellName = (r) => { const s = [{ text: r.name, fontSize: 9.5, bold: true, lineHeight: 1.15 }]; if (r.ch) s.push({ text: r.ch, fontSize: 8, color: G1, lineHeight: 1.2, margin: [0, 1, 0, 0] }); return { stack: s } }
    const hd = (t, al) => ({ text: t, bold: true, fontSize: 9, alignment: al || 'center', margin: [0, 2, 0, 2] })
    return {
      pageSize: 'A4',
      pageMargins: [64, 42, 56, 92],
      defaultStyle: { fontSize: 11, color: BLACK, lineHeight: 1.2 },
      footer: () => ({
        margin: [56, 0, 56, 22],
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.8, lineColor: BLACK }], margin: [0, 0, 0, 4] },
          { text: fullName, fontSize: 8, bold: true, alignment: 'center', lineHeight: 1.2 },
          { text: `${company.address || ''}${company.edrpou ? `  ·  код ЄДРПОУ ${company.edrpou}` : ''}`, fontSize: 8, color: G1, alignment: 'center', lineHeight: 1.2 },
          company.iban ? { text: `IBAN ${company.iban}${company.bankName ? ` в ${company.bankName}` : ''}${company.mfo ? `, МФО ${company.mfo}` : ''}`, fontSize: 8, color: G1, alignment: 'center', lineHeight: 1.2 } : null,
        ].filter(Boolean),
      }),
      content: [
        // Лого зліва + отримувач справа
        {
          columns: [
            logoImg ? { image: logoImg, width: 92, margin: [0, 0, 0, 0] } : { text: '', width: 92 },
            { width: '*', stack: [
              { text: contractor.name || contractor.short_name || '—', fontSize: 11, bold: true, alignment: 'right', lineHeight: 1.25 },
              (contractor.legal_address || contractor.address) ? { text: contractor.legal_address || contractor.address, fontSize: 10, color: G1, alignment: 'right', margin: [0, 1, 0, 0], lineHeight: 1.25 } : null,
            ].filter(Boolean) },
          ],
          columnGap: 16, margin: [0, 0, 0, 26],
        },
        // Заголовок по центру
        { text: 'КОМЕРЦІЙНА ПРОПОЗИЦІЯ', fontSize: 13, bold: true, alignment: 'center', characterSpacing: 0.5, margin: [0, 0, 0, 2] },
        { text: `№ ${docNumber} від ${formatDateLong(docDate)}`, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 16] },
        // Вступ
        { text: `На виконання Вашого запиту ${shortNm} пропонує до постачання наступні товари:`, fontSize: 11, alignment: 'justify', margin: [0, 0, 0, 12], lineHeight: 1.3 },
        // Рамкова таблиця
        {
          table: {
            headerRows: 1,
            widths: [24, '*', 40, 36, 62, 72],
            body: [
              [hd('№ з/п'), hd('Найменування товару, технічні характеристики', 'center'), hd('Одиниця виміру'), hd('Кількість'), hd('Ціна за одиницю, грн'), hd('Загальна вартість, грн')],
              ...rows.map(r => [
                { text: r.n, alignment: 'center', fontSize: 9.5 },
                cellName(r),
                { text: r.u, alignment: 'center', fontSize: 9.5, noWrap: true },
                { text: r.q, alignment: 'center', fontSize: 9.5, noWrap: true },
                { text: formatMoney(r.p), alignment: 'right', fontSize: 9.5, noWrap: true },
                { text: formatMoney(r.t), alignment: 'right', fontSize: 9.5, noWrap: true },
              ]),
              [{ text: 'Усього:', colSpan: 5, alignment: 'right', bold: true, fontSize: 10, margin: [0, 2, 0, 2] }, {}, {}, {}, {}, { text: formatMoney(total), alignment: 'right', bold: true, fontSize: 10, noWrap: true }],
            ],
          },
          layout: {
            hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => '#333', vLineColor: () => '#333',
            paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4,
          },
        },
        // Сума прописом + примітка ПДВ
        { text: `Загальна вартість пропозиції становить ${formatMoney(total)} грн (${amtWords}), ${vatPayer ? (vatAmount > 0 ? `у тому числі ПДВ 20% — ${formatMoney(vatAmount)} грн` : 'з ПДВ') : 'без ПДВ'}.`, fontSize: 11, alignment: 'justify', margin: [0, 14, 0, 4], lineHeight: 1.3 },
        !vatPayer ? { text: 'Постачальник не є платником податку на додану вартість.', fontSize: 11, margin: [0, 0, 0, 4] } : null,
        // Підпис
        { text: '', margin: [0, 22] },
        {
          columns: [
            { width: '*', stack: [
              { text: company.directorPosition || 'Директор', fontSize: 11 },
              { text: shortNm, fontSize: 11, margin: [0, 1, 0, 0] },
            ] },
            { width: 200, stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 0.6, lineColor: '#999' }], margin: [0, 18, 0, 0] },
              { text: dirShort, fontSize: 11, bold: true, alignment: 'center', margin: [0, 3, 0, 0] },
              stampOverlay(options, { x: 30, y: -70, w: 140 }),
            ] },
          ],
        },
      ].filter(Boolean),
    }
  }

  // ══════════════ ЧИСТА ТЕМА (ФОП/інше): лист з реквізитами продавця внизу ══════════════
  // Отримувач угорі справа · заголовок по центру · таблиця · підпис · реквізити продавця внизу (синім)
  if (brand.theme === 'clean') {
    const BLUE = '#1560BD'
    const sellerTitle = company.isFop ? 'Фізична особа-підприємець' : (company.shortName || company.name || '')
    const sellerName = company.isFop ? (company.director || company.name || '') : ''
    return {
      pageSize: 'A4',
      pageMargins: [56, 44, 56, 152],
      defaultStyle: { fontSize: 10, color: BLACK, lineHeight: 1.2 },
      footer: () => ({
        margin: [56, 0, 56, 26],
        columns: [
          logoImg ? { image: logoImg, width: 96, alignment: 'left' } : { text: '', width: 1 },
          { width: 28, text: '' },
          {
            width: '*',
            stack: [
              { text: sellerTitle, fontSize: 10.5, bold: true, color: BLUE, lineHeight: 1.25 },
              sellerName ? { text: sellerName, fontSize: 10.5, bold: true, color: BLUE, margin: [0, 0, 0, 2] } : null,
              company.address ? { text: `Адреса: ${company.address}`, fontSize: 9, color: BLUE, lineHeight: 1.3 } : null,
              company.ipn ? { text: `ІПН (РНОКПП): ${company.ipn}`, fontSize: 9, color: BLUE } : null,
              (!company.isFop && company.edrpou) ? { text: `ЄДРПОУ: ${company.edrpou}`, fontSize: 9, color: BLUE } : null,
              company.iban ? { text: `р/р ${company.iban}`, fontSize: 9, color: BLUE } : null,
              company.bankName ? { text: `у ${company.bankName}`, fontSize: 9, color: BLUE } : null,
            ].filter(Boolean),
          },
        ],
      }),
      content: [
        // Адресовано (справа)
        {
          columns: [
            { width: '*', text: '' },
            {
              width: 250,
              stack: [
                { text: 'Адресовано:', fontSize: 10.5, color: BLACK },
                { text: contractor.name || contractor.short_name || '—', fontSize: 10.5, bold: true, color: BLACK, margin: [0, 2, 0, 0], lineHeight: 1.25 },
                contractor.edrpou ? { text: `ЄДРПОУ ${contractor.edrpou}`, fontSize: 10, color: G1, margin: [0, 1, 0, 0] } : null,
                (contractor.legal_address || contractor.address) ? { text: contractor.legal_address || contractor.address, fontSize: 10, color: G1, margin: [0, 1, 0, 0], lineHeight: 1.3 } : null,
              ].filter(Boolean),
            },
          ],
          margin: [0, 0, 0, 30],
        },
        // Заголовок по центру
        { text: 'КОМЕРЦІЙНА ПРОПОЗИЦІЯ', fontSize: 13, color: BLACK, alignment: 'center', characterSpacing: 0.5 },
        { text: `№${docNumber} від ${formatDate(docDate)}`, fontSize: 11, color: BLACK, alignment: 'center', margin: [0, 3, 0, 22] },
        // Вступ
        { text: 'Відповідно до Вашого запиту пропонуємо наступні товари:', fontSize: 10.5, color: BLACK, margin: [0, 0, 0, 14] },
        productsTable,
        totalsBlock,
        notes ? { text: notes, fontSize: 9, color: G1, margin: [0, 10, 0, 0], lineHeight: 1.4 } : {},
        // Підпис
        { text: '', margin: [0, 18] },
        {
          columns: [
            {
              width: '*',
              stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
                { text: sellerName || sellerTitle, fontSize: 9.5, bold: true, color: BLACK, margin: [0, 4, 0, 0] },
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
      // ═══ ШАПКА: лого зліва · реквізити справа (велика назва компанії) ═══
      {
        columns: [
          logoImg ? { image: logoImg, width: 84, margin: [0, 2, 0, 0] } : { text: '', width: 1 },
          {
            width: '*',
            stack: [
              { text: (company.name || companyName).replace(/"([^"]*)"/g, '«$1»'), fontSize: 10.5, bold: true, color: BLACK, alignment: 'center', lineHeight: 1.1, margin: [0, 0, 0, 3] },
              company.address ? { text: `Адреса для листування: ${company.address}`, fontSize: 7, color: G1, alignment: 'center', lineHeight: 1.2 } : null,
              (company.edrpou || company.ipn) ? { text: [company.edrpou ? `Код ЄДРПОУ ${company.edrpou}` : '', (company.edrpou && company.ipn) ? '  ·  ' : '', company.ipn ? `Індивідуальний податковий номер ${company.ipn}` : ''].join(''), fontSize: 7, color: G1, alignment: 'center', lineHeight: 1.2 } : null,
              company.iban ? { text: `IBAN ${company.iban}${company.bankName ? `, ${company.bankName}` : ''}${company.mfo ? `, МФО ${company.mfo}` : ''}`, fontSize: 7, color: G1, alignment: 'center', lineHeight: 1.2 } : null,
              { text: [company.phone ? `Тел./факс: ${company.phone}` : '', company.email ? `${company.phone ? '  ·  ' : ''}e-mail: ${company.email}` : '', company.email ? `  ·  www.${company.email.split('@')[1] || ''}` : ''].join(''), fontSize: 7, color: G1, alignment: 'center', lineHeight: 1.2 },
            ].filter(Boolean),
          },
        ],
        columnGap: 12,
        margin: [0, 0, 0, 8],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 1.2, lineColor: headerLine }], margin: [0, 0, 0, 12] },

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

      // ═══ ТАБЛИЦЯ ТОВАРІВ + ПІДСУМКИ (спільні) ═══
      productsTable,
      totalsBlock,

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

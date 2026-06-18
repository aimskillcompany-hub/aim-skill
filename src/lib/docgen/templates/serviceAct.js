// ── Шаблон: Акт наданих послуг — Premium Tech Style ──
import { formatMoney, formatDate, formatDateLong, amountInWords, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'

// Палітра — темна, мінімалістична, tech
const BLACK = '#0A0A0A'
const DARK = '#1C1C1E'
const GRAY1 = '#3A3A3C'
const GRAY2 = '#8E8E93'
const GRAY3 = '#C7C7CC'
const GRAY4 = '#E5E5EA'
const GRAY5 = '#F2F2F7'
const GREEN = '#34C759'  // AiM brand green (iOS-style)
const WHITE = '#FFFFFF'

function itemData(it, i) {
  const qty = parseFloat(it.quantity) || 0
  const price = parseFloat(it.unitPrice) || 0
  const amount = parseFloat(it.amount) || qty * price
  const vatRate = parseFloat(it.vatRate) || 0
  const vat = vatRate > 0 ? amount * vatRate / 100 : 0
  return { i: i + 1, name: it.name || '', qty, unit: it.unit || 'послуга', price, vatRate, vat, total: amount + vat, amount }
}

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const hasVat = vatAmount > 0
  const qrData = `AIM|ACT|${docNumber}|${docDate}|${total}|${company.edrpou}`
  const rows = items.map((it, i) => itemData(it, i))

  return {
    pageSize: 'A4',
    pageMargins: [48, 48, 48, 60],
    defaultStyle: { fontSize: 9.5, color: GRAY1 },
    content: [

      // ═══════════════════════════════════════════
      // HEADER — лого + реквізити компанії
      // ═══════════════════════════════════════════
      {
        columns: [
          // Логотип — стилізований як у сайдбарі
          {
            width: 80,
            stack: [
              {
                canvas: [
                  { type: 'rect', x: 0, y: 0, w: 64, h: 56, r: 8, color: BLACK },
                ],
              },
              // Текст поверх canvas
              {
                text: [
                  { text: 'A', color: WHITE, bold: true },
                  { text: 'i', color: GREEN, bold: true },
                  { text: 'M', color: WHITE, bold: true },
                ],
                fontSize: 18, absolutePosition: { x: 60, y: 52 },
              },
              {
                text: [
                  { text: 'Sk', color: WHITE, bold: true },
                  { text: 'i', color: GREEN, bold: true },
                  { text: 'll.', color: WHITE, bold: true },
                ],
                fontSize: 18, absolutePosition: { x: 60, y: 72 },
              },
            ],
          },
          // Реквізити справа
          {
            width: '*',
            alignment: 'right',
            stack: [
              { text: company.shortName || company.name, fontSize: 11, bold: true, color: BLACK },
              { text: company.address || '', fontSize: 8, color: GRAY2, margin: [0, 3, 0, 0] },
              { text: `ЄДРПОУ ${company.edrpou || ''}  ·  ІПН ${company.ipn || ''}`, fontSize: 8, color: GRAY2, margin: [0, 2, 0, 0] },
              { text: `${company.phone || ''}  ·  ${company.email || ''}`, fontSize: 8, color: GRAY2, margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 24],
      },

      // ═══════════════════════════════════════════
      // DOCUMENT TITLE
      // ═══════════════════════════════════════════
      {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: 'АКТ НАДАНИХ ПОСЛУГ', fontSize: 8, letterSpacing: 3, color: GRAY2, margin: [0, 0, 0, 4] },
              {
                columns: [
                  { text: `№ ${docNumber}`, fontSize: 24, bold: true, color: BLACK, width: 'auto' },
                  { text: '', width: 12 },
                  { text: formatDateLong(docDate), fontSize: 11, color: GRAY2, margin: [0, 13, 0, 0] },
                ],
              },
            ],
            margin: [20, 16, 20, 16],
          }]],
        },
        layout: {
          hLineWidth: () => 0, vLineWidth: () => 0,
          fillColor: () => GRAY5,
        },
        margin: [0, 0, 0, 24],
      },

      // ═══════════════════════════════════════════
      // ПРЕАМБУЛА
      // ═══════════════════════════════════════════
      {
        text: [
          { text: company.shortName || company.name, bold: true, color: BLACK },
          { text: ' (Виконавець) в особі ' },
          { text: `${company.directorPosition || 'Директора'} ${company.director || '________'}`, color: BLACK },
          { text: ', з однієї сторони, та ' },
          { text: contractor.short_name || contractor.name || '________', bold: true, color: BLACK },
          { text: ' (Замовник)' },
          contractor.contact_person ? { text: ` в особі ${contractor.contact_position || ''} ${contractor.contact_person}`, color: BLACK } : { text: '' },
          { text: ', з іншої сторони, склали цей Акт про наступне:' },
        ],
        fontSize: 9, lineHeight: 1.6, margin: [0, 0, 0, 20], color: GRAY1,
      },

      // ═══════════════════════════════════════════
      // СТОРОНИ — дві картки
      // ═══════════════════════════════════════════
      {
        columns: [
          partyCard('Виконавець', company, true),
          { width: 16, text: '' },
          partyCard('Замовник', contractor, false),
        ],
        margin: [0, 0, 0, 20],
      },

      // ═══════════════════════════════════════════
      // ТАБЛИЦЯ
      // ═══════════════════════════════════════════
      {
        table: {
          headerRows: 1,
          widths: [22, '*', 36, 42, 60, 28, 48, 64],
          body: [
            // Header
            ['№', 'Послуга', 'К-сть', 'Од.', 'Ціна', 'ПДВ', 'ПДВ ₴', 'Сума'].map(t => ({
              text: t, fontSize: 7, bold: true, color: GRAY2,
              alignment: 'center', margin: [0, 6, 0, 6],
              borderColor: [WHITE, WHITE, WHITE, GRAY4],
            })),
            // Rows
            ...rows.map(r => [
              { text: r.i, alignment: 'center', fontSize: 9, color: GRAY2 },
              { text: r.name, fontSize: 9, color: BLACK },
              { text: r.qty, alignment: 'center', fontSize: 9 },
              { text: r.unit, alignment: 'center', fontSize: 8, color: GRAY2 },
              { text: formatMoney(r.price), alignment: 'right', fontSize: 9 },
              { text: r.vatRate > 0 ? `${r.vatRate}%` : '—', alignment: 'center', fontSize: 8, color: GRAY2 },
              { text: formatMoney(r.vat), alignment: 'right', fontSize: 9, color: GRAY2 },
              { text: formatMoney(r.total), alignment: 'right', fontSize: 9, bold: true, color: BLACK },
            ]),
          ],
        },
        layout: {
          hLineWidth: (i) => i === 1 ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? GRAY3 : GRAY4,
          paddingLeft: () => 6, paddingRight: () => 6,
          paddingTop: () => 7, paddingBottom: () => 7,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
        },
      },

      // ═══════════════════════════════════════════
      // ПІДСУМКИ
      // ═══════════════════════════════════════════
      { text: '', margin: [0, 12] },
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 200,
            stack: [
              sumLine('Без ПДВ', subtotal, false),
              ...(hasVat ? [sumLine('ПДВ', vatAmount, false)] : []),
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: GRAY4 }], margin: [0, 4, 0, 4] },
              sumLine('Всього', total, true),
            ],
          },
        ],
      },
      { text: amountInWords(total), fontSize: 8, italics: true, color: GRAY2, margin: [0, 8, 0, 0] },

      // ═══════════════════════════════════════════
      // ПРИЙОМ РОБІТ
      // ═══════════════════════════════════════════
      { text: '', margin: [0, 14] },
      {
        table: {
          widths: [3, '*'],
          body: [[
            { text: '', fillColor: GREEN, border: [false, false, false, false] },
            {
              text: 'Вищевказані послуги виконані повністю та в строк. Замовник претензій щодо обсягу, якості та строків надання послуг не має.',
              fontSize: 9, lineHeight: 1.5, color: GRAY1, margin: [12, 10, 12, 10],
              border: [false, false, false, false],
            },
          ]],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: (r, n, c) => c === 0 ? GREEN : GRAY5 },
      },

      notes ? { text: notes, fontSize: 8, color: GRAY2, italics: true, margin: [0, 12, 0, 0] } : {},

      // ═══════════════════════════════════════════
      // ПІДПИСИ
      // ═══════════════════════════════════════════
      { text: '', margin: [0, 28] },
      {
        columns: [
          signatureBlock('Виконавець', company.directorPosition || 'Директор', company.director || ''),
          { width: 40, text: '' },
          signatureBlock('Замовник', contractor.contact_position || '', contractor.contact_person || ''),
        ],
      },

      // ═══════════════════════════════════════════
      // FOOTER
      // ═══════════════════════════════════════════
      { text: '', margin: [0, 20] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.5, lineColor: GRAY4 }] },
      {
        columns: [
          { qr: qrData, fit: 40, margin: [0, 8, 0, 0], foreground: GRAY1 },
          {
            stack: [
              { text: `${docNumber}  ·  ${formatDate(docDate)}  ·  ${formatMoney(total)} грн`, fontSize: 7, color: GRAY3, margin: [10, 10, 0, 0] },
              { text: 'Документ згенеровано в системі AiM Skill', fontSize: 6, color: GRAY3, margin: [10, 3, 0, 0] },
            ],
            width: '*',
          },
          {
            width: 50, alignment: 'right',
            stack: [
              { text: [
                { text: 'A', color: BLACK, bold: true },
                { text: 'i', color: GREEN, bold: true },
                { text: 'M', color: BLACK, bold: true },
              ], fontSize: 11, margin: [0, 8, 0, 0] },
              { text: [
                { text: 'Sk', color: BLACK, bold: true },
                { text: 'i', color: GREEN, bold: true },
                { text: 'll.', color: BLACK, bold: true },
              ], fontSize: 11 },
            ],
          },
        ],
      },
    ],
  }
}

// ── Допоміжні функції ──

function partyCard(label, entity, isCompany) {
  const name = isCompany ? (entity.shortName || entity.name) : (entity.short_name || entity.name || '—')
  const edrpou = entity.edrpou
  const address = isCompany ? entity.address : (entity.legal_address || entity.address)
  const iban = isCompany ? entity.iban : entity.iban

  return {
    width: '*',
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: label.toUpperCase(), fontSize: 7, letterSpacing: 1.5, color: GRAY2, margin: [0, 0, 0, 6] },
          { text: name, fontSize: 11, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
          edrpou ? { text: `ЄДРПОУ ${edrpou}`, fontSize: 8, color: GRAY1, margin: [0, 0, 0, 2] } : {},
          address ? { text: address, fontSize: 8, color: GRAY2, margin: [0, 0, 0, 2] } : {},
          iban ? { text: `IBAN ${iban}`, fontSize: 7.5, color: GRAY2 } : {},
        ],
        margin: [14, 12, 14, 12],
      }]],
    },
    layout: {
      hLineWidth: () => 1, vLineWidth: () => 1,
      hLineColor: () => GRAY4, vLineColor: () => GRAY4,
    },
  }
}

function sumLine(label, amount, isBold) {
  return {
    columns: [
      { text: label, alignment: 'right', fontSize: isBold ? 12 : 9, bold: isBold, color: isBold ? BLACK : GRAY2, width: '*' },
      { text: `${formatMoney(amount)} грн`, alignment: 'right', fontSize: isBold ? 13 : 9, bold: isBold, color: isBold ? BLACK : GRAY1, width: 100 },
    ],
    margin: [0, 2, 0, 2],
  }
}

function signatureBlock(title, position, name) {
  return {
    width: '*',
    stack: [
      { text: title.toUpperCase(), fontSize: 7, letterSpacing: 1.5, color: GRAY2, margin: [0, 0, 0, 20] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.5, lineColor: GRAY3 }] },
      position || name ? { text: `${position} ${name}`.trim(), fontSize: 9, color: GRAY1, margin: [0, 4, 0, 0] } : {},
      { text: 'М.П.', fontSize: 7, color: GRAY3, margin: [0, 8, 0, 0] },
    ],
  }
}

// ── EXCEL ──
export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const data = [
    [`Акт наданих послуг №${docNumber} від ${formatDate(docDate)}`],
    [], ['Виконавець:', company.shortName || company.name, '', 'ЄДРПОУ:', company.edrpou],
    ['Замовник:', contractor.short_name || contractor.name, '', 'ЄДРПОУ:', contractor.edrpou],
    [], ['№', 'Найменування', 'К-сть', 'Од.', 'Ціна', 'ПДВ%', 'ПДВ', 'Сума'],
    ...items.map((it, i) => { const r = itemData(it, i); return [r.i, r.name, r.qty, r.unit, r.price, r.vatRate > 0 ? `${r.vatRate}%` : '', r.vat, r.total] }),
    [], ['','','','','','','Без ПДВ:', subtotal], ['','','','','','','ПДВ:', vatAmount], ['','','','','','','Всього:', total],
    [], [amountInWords(total)],
  ]
  const wb = createWorkbook(); addSheet(wb, data, 'Акт'); return wb
}

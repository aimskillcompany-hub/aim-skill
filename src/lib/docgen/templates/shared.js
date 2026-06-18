// ── Спільні елементи для всіх шаблонів документів ──
import { formatMoney, formatDate, amountInWords } from '../formatUtils'

// Кольори відповідно до стилістики системи
export const C = {
  brand: '#1a1a2e',       // dark header
  blue: '#2563EB',        // --blue (основний акцент)
  green: '#4A7C59',       // --green (AiM лого)
  lime: '#C7F33C',        // --accent
  bg: '#F4F6F8',          // --bg
  surface: '#FFFFFF',
  border: '#E2E8F0',
  text: '#000000',
  text2: '#6B6B6B',
  text3: '#9A9A9A',
  blueBg: '#EFF4FF',
}

// ── Логотип AiM Skill як текстовий елемент для pdfmake ──
export function logo() {
  return {
    stack: [
      {
        text: [
          { text: 'A', fontSize: 22, bold: true, color: C.brand },
          { text: 'i', fontSize: 22, bold: true, color: C.green },
          { text: 'M', fontSize: 22, bold: true, color: C.brand },
        ],
      },
      {
        text: [
          { text: 'Sk', fontSize: 22, bold: true, color: C.brand },
          { text: 'i', fontSize: 22, bold: true, color: C.green },
          { text: 'll.', fontSize: 22, bold: true, color: C.brand },
        ],
      },
      { text: 'ITSOLUTION', fontSize: 6, letterSpacing: 1.5, color: C.text3, margin: [0, 2, 0, 0] },
    ],
    width: 'auto',
  }
}

// ── Шапка документа ──
export function header(company, docTitle, docNumber, docDateStr) {
  return [
    // Лого + реквізити
    {
      columns: [
        logo(),
        {
          width: '*',
          alignment: 'right',
          stack: [
            { text: company.shortName || company.name, fontSize: 10, bold: true, color: C.brand },
            company.address ? { text: company.address, fontSize: 8, color: C.text3, margin: [0, 2, 0, 0] } : {},
            { text: [
              company.phone ? `${company.phone}` : '',
              company.email ? `  ·  ${company.email}` : '',
            ].filter(Boolean).join(''), fontSize: 8, color: C.text3, margin: [0, 1, 0, 0] },
            company.edrpou ? { text: `ЄДРПОУ ${company.edrpou}${company.ipn ? '  ·  ІПН ' + company.ipn : ''}`, fontSize: 8, color: C.text3, margin: [0, 1, 0, 0] } : {},
          ],
        },
      ],
      margin: [0, 0, 0, 8],
    },
    // Лінія
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: C.blue }], margin: [0, 0, 0, 14] },
    // Назва документа
    { text: docTitle, fontSize: 9, color: C.blue, bold: true, letterSpacing: 2, margin: [0, 0, 0, 2] },
    {
      columns: [
        { text: `№ ${docNumber}`, fontSize: 20, bold: true, color: C.brand, width: 'auto' },
        { text: `від ${docDateStr}`, fontSize: 11, color: C.text2, margin: [10, 9, 0, 0], width: '*' },
      ],
      margin: [0, 0, 0, 14],
    },
  ]
}

// ── Блок сторони (Постачальник / Покупець) ──
export function partyBlock(label, entity, isCompany) {
  const name = isCompany ? (entity.shortName || entity.name) : (entity.short_name || entity.name || '—')
  const edrpou = isCompany ? entity.edrpou : entity.edrpou
  const address = isCompany ? entity.address : (entity.legal_address || entity.address)
  const iban = isCompany ? entity.iban : entity.iban
  const bank = isCompany ? entity.bankName : null
  const mfo = isCompany ? entity.mfo : null

  return {
    stack: [
      { text: label, fontSize: 7, color: C.blue, bold: true, letterSpacing: 1.5, margin: [0, 0, 0, 4] },
      {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: name, fontSize: 11, bold: true, color: C.brand, margin: [0, 0, 0, 3] },
              edrpou ? { text: `ЄДРПОУ: ${edrpou}`, fontSize: 8, color: C.text2 } : {},
              address ? { text: address, fontSize: 8, color: C.text3, margin: [0, 1, 0, 0] } : {},
              iban ? { text: `IBAN: ${iban}`, fontSize: 8, color: C.text3, margin: [0, 1, 0, 0] } : {},
              bank ? { text: `${bank}${mfo ? ', МФО ' + mfo : ''}`, fontSize: 8, color: C.text3, margin: [0, 1, 0, 0] } : {},
            ],
            margin: [8, 6, 8, 6],
          }]],
        },
        layout: {
          hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 3 : 0,
          vLineColor: () => C.blue,
          paddingLeft: () => 0, paddingRight: () => 0,
          paddingTop: () => 0, paddingBottom: () => 0,
        },
      },
    ],
  }
}

// ── Двосторонній блок ──
export function partiesRow(company, contractor, leftLabel, rightLabel) {
  return {
    columns: [
      { width: '48%', ...partyBlock(leftLabel || 'ПОСТАЧАЛЬНИК', company, true) },
      { width: '4%', text: '' },
      { width: '48%', ...partyBlock(rightLabel || 'ПОКУПЕЦЬ', contractor, false) },
    ],
    margin: [0, 0, 0, 16],
  }
}

// ── Заголовок таблиці ──
export function tableHeader(columns) {
  return columns.map(t => ({
    text: t, fontSize: 7, bold: true, color: C.blue, alignment: 'center',
    margin: [0, 5, 0, 5], borderColor: [C.border, C.blue, C.border, C.border],
  }))
}

// ── Layout таблиці ──
export const tableLayout = {
  hLineWidth: (i, node) => i === 0 ? 0 : i === 1 ? 2 : 0.5,
  vLineWidth: () => 0,
  hLineColor: (i) => i === 1 ? C.blue : C.border,
  paddingLeft: () => 5, paddingRight: () => 5,
  paddingTop: () => 5, paddingBottom: () => 5,
  fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFBFC' : null,
}

// ── Підсумки ──
export function totalsBlock(subtotal, vatAmount, total) {
  const hasVat = vatAmount > 0
  return [
    { text: '', margin: [0, 8] },
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 220,
          table: {
            widths: [110, 100],
            body: [
              [{ text: 'Разом без ПДВ:', alignment: 'right', fontSize: 9, color: C.text2, border: [false, false, false, false] },
               { text: `${formatMoney(subtotal)} грн`, alignment: 'right', fontSize: 9, border: [false, false, false, false] }],
              ...(hasVat ? [[
                { text: 'ПДВ:', alignment: 'right', fontSize: 9, color: C.text2, border: [false, false, false, false] },
                { text: `${formatMoney(vatAmount)} грн`, alignment: 'right', fontSize: 9, border: [false, false, false, false] },
              ]] : []),
              [{ text: 'ВСЬОГО:', alignment: 'right', fontSize: 12, bold: true, color: C.brand, border: [false, false, false, false] },
               { text: `${formatMoney(total)} грн`, alignment: 'right', fontSize: 12, bold: true, color: C.blue, fillColor: C.blueBg, border: [false, false, false, false], margin: [6, 4, 6, 4] }],
            ],
          },
          layout: 'noBorders',
        },
      ],
    },
    { text: amountInWords(total), fontSize: 8, italics: true, color: C.text3, margin: [0, 6, 0, 0] },
  ]
}

// ── Підписи (два блоки) ──
export function signatures(company, contractor, leftTitle, rightTitle) {
  return [
    { text: '', margin: [0, 24] },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: C.border }] },
    { text: '', margin: [0, 10] },
    {
      columns: [
        {
          width: '48%',
          stack: [
            { text: leftTitle || 'Від постачальника:', fontSize: 8, color: C.blue, bold: true, letterSpacing: 1 },
            { text: '', margin: [0, 20] },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: C.border }] },
            { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, margin: [0, 4, 0, 0] },
            { text: 'М.П.', fontSize: 7, color: C.text3, margin: [0, 6, 0, 0] },
          ],
        },
        {
          width: '48%',
          stack: [
            { text: rightTitle || 'Отримав:', fontSize: 8, color: C.blue, bold: true, letterSpacing: 1 },
            { text: '', margin: [0, 20] },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: C.border }] },
            { text: contractor.contact_person || '', fontSize: 9, margin: [0, 4, 0, 0] },
            { text: 'М.П.', fontSize: 7, color: C.text3, margin: [0, 6, 0, 0] },
          ],
        },
      ],
    },
  ]
}

// ── Футер з QR ──
export function footer(company, docTypeCode, docNumber, docDate, total, contractorEdrpou) {
  const qrData = `AIM-SKILL|${docTypeCode}|${docNumber}|${docDate}|${total}|${company.edrpou}|${contractorEdrpou || ''}`
  return [
    { text: '', margin: [0, 14] },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.3, lineColor: C.border }] },
    {
      columns: [
        { qr: qrData, fit: 46, margin: [0, 6, 0, 0] },
        {
          stack: [
            { text: `${docTypeCode}-${docNumber}  ·  ${formatDate(docDate)}`, fontSize: 7, color: C.text3, margin: [8, 8, 0, 0] },
            { text: `${company.email || ''}  ·  ${company.phone || ''}`, fontSize: 7, color: C.text3, margin: [8, 2, 0, 0] },
            { text: 'Документ згенеровано в AiM Skill', fontSize: 6, color: '#bbb', margin: [8, 2, 0, 0] },
          ],
          width: '*',
        },
        { ...logo(), margin: [0, 4, 0, 0] },
      ],
      margin: [0, 4, 0, 0],
    },
  ]
}

// ── Стандартні стилі pdfmake ──
export const defaultDocDef = {
  pageSize: 'A4',
  pageMargins: [40, 30, 40, 30],
  defaultStyle: { fontSize: 10, font: 'Roboto' },
}

// ── Рядок таблиці позицій ──
export function itemRow(it, i) {
  const qty = parseFloat(it.quantity) || 0
  const price = parseFloat(it.unitPrice) || 0
  const amount = parseFloat(it.amount) || qty * price
  const vatRate = parseFloat(it.vatRate) || 0
  const vat = vatRate > 0 ? amount * vatRate / 100 : 0
  return {
    cells: [
      { text: i + 1, alignment: 'center', fontSize: 9 },
      { text: it.name || '', fontSize: 9 },
      { text: qty, alignment: 'center', fontSize: 9 },
      { text: it.unit || 'шт', alignment: 'center', fontSize: 9, color: C.text3 },
      { text: formatMoney(price), alignment: 'right', fontSize: 9 },
      { text: vatRate > 0 ? `${vatRate}%` : '—', alignment: 'center', fontSize: 8, color: C.text3 },
      { text: formatMoney(vat), alignment: 'right', fontSize: 9 },
      { text: formatMoney(amount + vat), alignment: 'right', fontSize: 9, bold: true },
    ],
    amount, vat, qty, price, vatRate,
  }
}

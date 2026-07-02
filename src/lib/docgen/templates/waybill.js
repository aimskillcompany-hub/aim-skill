// ── Шаблон: Видаткова накладна ──
import { formatMoney, formatDate, formatDateLong, amountInWords, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'
import { LOGO_BASE64 } from '../logo'
import { stampOverlay } from '../stamp'

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

function vatInWords(vatAmount) {
  if (!vatAmount || vatAmount === 0) return 'нуль гривень 00 копійок ПДВ'
  return amountInWords(vatAmount).toLowerCase() + ' ПДВ'
}

// EAN-8 з номера документа (беремо останні 7 цифр + контрольна)
function docToEan8(docNumber) {
  const digits = (docNumber || '').replace(/\D/g, '')
  const d7 = digits.slice(-7).padStart(7, '0')
  // Контрольна цифра EAN-8
  let sum = 0
  for (let i = 0; i < 7; i++) {
    sum += parseInt(d7[i]) * (i % 2 === 0 ? 3 : 1)
  }
  const check = (10 - (sum % 10)) % 10
  return d7 + check
}

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes, contractNum, contractDate, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress } = options
  const { subtotal, vatAmount, total, vatByRate } = calcTotals(items)
  const rows = items.map((it, i) => itm(it, i))
  const contractStr = contractNum ? `№${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : null
  const invoiceStr = invoiceRef ? `№${invoiceRef}${invoiceRefDate ? ` від ${formatDate(invoiceRefDate)}` : ''}` : null
  const itemCount = items.length
  const ean8 = docToEan8(docNumber)

  // Додаткова інформація — збираємо рядки
  const addInfo = [
    contractStr ? [{ text: 'Договір: ', color: G2 }, { text: contractStr, color: G1 }] : null,
    invoiceStr ? [{ text: 'Рахунок: ', color: G2 }, { text: invoiceStr, color: G1 }] : null,
    deliveryBasis ? [{ text: 'Базис поставки: ', color: G2 }, { text: deliveryBasis, color: G1 }] : null,
    deliveryAddress ? [{ text: 'Адреса поставки: ', color: G2 }, { text: deliveryAddress, color: G1 }] : null,
  ].filter(Boolean)

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
            { qr: `${docNumber}|${formatDate(docDate)}|${formatMoney(total)}`, fit: 36, margin: [0, 0, 4, 0] },
            {
              stack: [
                { text: docNumber, fontSize: 6, bold: true, color: G2 },
                { text: 'Сформовано в корпоративній системі AiM Skill', fontSize: 5.5, color: G3, margin: [0, 1, 0, 0] },
                { text: '073 700 77 58  ·  office@aim-skill.com.ua  ·  www.aim-skill.com.ua', fontSize: 5.5, color: G3, margin: [0, 1, 0, 0] },
              ],
              width: '*', margin: [0, 3, 0, 0],
            },
            { image: LOGO_BASE64, width: 52, alignment: 'right' },
          ],
        },
      ],
    }),

    content: [
      // ═══ НАЗВА ═══
      sectionTitle('ВИДАТКОВА НАКЛАДНА'),
      { text: `від ${formatDateLong(docDate)}${city ? '  ·  ' + city : ''}`, fontSize: 9, color: G1, margin: [0, 0, 0, 2] },
      { text: `№ ${docNumber}`, fontSize: 24, bold: true, color: BLACK, margin: [0, 0, 0, 12] },

      // ═══ РЕКВІЗИТИ ═══
      {
        columns: [
          {
            width: '49%',
            stack: [
              sectionTitle('ПОСТАЧАЛЬНИК'),
              { text: company.shortName || company.name, fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
              rvLine('ЄДРПОУ', company.edrpou),
              rvLine('ІПН', company.ipn),
              rvLine('Адреса', company.address),
              rvLine('IBAN', company.iban),
              rvLine('Банк', company.bankName ? `${company.bankName}, МФО ${company.mfo}` : null),
              rvLine('Тел.', company.phone),
              rvLine('Email', company.email),
            ].filter(Boolean),
          },
          { width: '2%', text: '' },
          {
            width: '49%',
            stack: [
              sectionTitle('ПОКУПЕЦЬ'),
              { text: contractor.short_name || contractor.name || '—', fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
              rvLine('ЄДРПОУ', contractor.edrpou),
              rvLine('ІПН', contractor.ipn),
              rvLine('Адреса', contractor.legal_address || contractor.address),
              rvLine('IBAN', contractor.iban),
              rvLine('Банк', contractor.bank_name ? `${contractor.bank_name}${contractor.mfo ? ', МФО ' + contractor.mfo : ''}` : null),
              rvLine('Тел.', contractor.phone),
              rvLine('Email', contractor.email),
            ].filter(Boolean),
          },
        ],
        margin: [0, 0, 0, 8],
      },

      // ═══ ДОДАТКОВА ІНФОРМАЦІЯ ═══
      ...(addInfo.length > 0 ? [
        sectionTitle('ДОДАТКОВА ІНФОРМАЦІЯ'),
        ...addInfo.map(line => ({ text: line, fontSize: 8.5, margin: [0, 0, 0, 1] })),
        { text: '', margin: [0, 0, 0, 4] },
      ] : [{ text: '', margin: [0, 0, 0, 2] }]),

      // ═══ ТАБЛИЦЯ ═══
      {
        table: {
          headerRows: 1,
          widths: [18, '*', 28, 28, 58, 22, 42, 56],
          body: [
            ['№', 'Найменування товару', 'Од.', 'К-сть', 'Ціна без ПДВ', 'ПДВ', 'Сума ПДВ', 'Сума'].map(t => ({
              text: t, fontSize: 6, bold: true, color: '#FFF', fillColor: DARK,
              alignment: 'center', margin: [0, 3, 0, 3],
            })),
            ...rows.map(r => [
              { text: r.n, alignment: 'center', fontSize: 8.5, color: G2 },
              { text: r.name, fontSize: 8.5, color: BLACK },
              { text: r.u, alignment: 'center', fontSize: 8, color: G2 },
              { text: r.q, alignment: 'center', fontSize: 8.5 },
              { text: formatMoney(r.p), alignment: 'right', fontSize: 8.5 },
              { text: r.vr > 0 ? `${r.vr}%` : '—', alignment: 'center', fontSize: 7, color: G2 },
              { text: formatMoney(r.v), alignment: 'right', fontSize: 8.5, color: G2 },
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

      { text: `Кількість найменувань: ${itemCount}`, fontSize: 7.5, color: G2, margin: [0, 3, 0, 0] },

      // ═══ ПІДСУМКИ ═══
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 190,
            table: {
              widths: [90, 90],
              body: [
                [{ text: 'Без ПДВ:', alignment: 'right', fontSize: 8.5, color: G2 }, { text: `${formatMoney(subtotal)} грн`, alignment: 'right', fontSize: 8.5 }],
                ...Object.entries(vatByRate).map(([rate, amt]) =>
                  [{ text: `ПДВ ${rate}%:`, alignment: 'right', fontSize: 8.5, color: G2 }, { text: `${formatMoney(amt)} грн`, alignment: 'right', fontSize: 8.5 }]
                ),
                [{ text: 'Всього:', alignment: 'right', fontSize: 10, bold: true, color: BLACK }, { text: `${formatMoney(total)} грн`, alignment: 'right', fontSize: 10, bold: true, color: BLACK }],
              ],
            },
            layout: 'noBorders',
            margin: [0, 4, 0, 0],
          },
        ],
      },

      // ═══ РОЗШИФРОВКА ═══
      { text: '', margin: [0, 6] },
      {
        text: [
          { text: 'Всього до сплати: ' },
          { text: amountInWords(total).charAt(0).toLowerCase() + amountInWords(total).slice(1) },
        ],
        fontSize: 9, color: G1, margin: [0, 0, 0, 1],
      },
      vatAmount > 0 ? {
        text: [
          { text: 'у тому числі ' },
          { text: vatInWords(vatAmount) },
        ],
        fontSize: 9, color: G1,
      } : {},

      notes ? { text: `Примітка: ${notes}`, fontSize: 8, color: G2, italics: true, margin: [0, 6, 0, 0] } : {},

      // ═══ ПІДПИСИ ═══
      { text: '', margin: [0, 12] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: G4 }], margin: [0, 0, 0, 6] },
      {
        columns: [
          {
            width: '48%',
            stack: [
              { text: 'ВІДПУСТИВ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 12] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
              { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
              { text: 'М.П.', fontSize: 6.5, color: G3, margin: [0, 4, 0, 0] },
              stampOverlay(options),
            ],
          },
          {
            width: '48%',
            stack: [
              { text: 'ОТРИМАВ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 12] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
              { text: contractor.contact_person || '', fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
              { text: 'М.П.', fontSize: 6.5, color: G3, margin: [0, 4, 0, 0] },
            ],
          },
        ],
      },
    ],
  }
}

function rvLine(label, value) {
  if (!value) return null
  return {
    columns: [
      { text: label, width: 42, fontSize: 8, color: G2, alignment: 'left', margin: [0, 0, 2, 0] },
      { text: value, width: '*', fontSize: 8, color: G1 },
    ],
    margin: [0, 1, 0, 1],
  }
}

function sectionTitle(text) {
  return { text: text, fontSize: 7.5, letterSpacing: 2, color: G2, bold: true, margin: [0, 0, 0, 6] }
}

// ── EXCEL ──
export function xlsx(company, contractor, items, options) {
  const { docNumber, docDate, contractNum, contractDate, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress } = options
  const { subtotal, vatAmount, total } = calcTotals(items)
  const contract = contractNum ? `Договір №${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : ''
  const invoice = invoiceRef ? `Рахунок №${invoiceRef}${invoiceRefDate ? ` від ${formatDate(invoiceRefDate)}` : ''}` : ''
  const data = [
    [`Видаткова накладна №${docNumber} від ${formatDate(docDate)}`],
    contract ? [contract] : [], invoice ? [invoice] : [],
    deliveryBasis ? [`Базис поставки: ${deliveryBasis}`] : [],
    deliveryAddress ? [`Адреса поставки: ${deliveryAddress}`] : [],
    [], ['Постачальник:', company.shortName || company.name, 'ЄДРПОУ:', company.edrpou, 'IBAN:', company.iban],
    ['Покупець:', contractor.short_name || contractor.name, 'ЄДРПОУ:', contractor.edrpou],
    [], ['№', 'Найменування', 'Од.', 'К-сть', 'Ціна без ПДВ', 'ПДВ%', 'Сума ПДВ', 'Сума'],
    ...items.map((it, i) => { const r = itm(it, i); return [r.n, r.name, r.u, r.q, r.p, r.vr > 0 ? `${r.vr}%` : '', r.v, r.t] }),
    [], [`Кількість найменувань: ${items.length}`],
    ['', '', '', '', '', 'Без ПДВ:', '', subtotal],
    ['', '', '', '', '', 'ПДВ:', '', vatAmount],
    ['', '', '', '', '', 'Всього:', '', total],
    [], [`Всього до сплати: ${amountInWords(total).charAt(0).toLowerCase() + amountInWords(total).slice(1)}`],
    vatAmount > 0 ? [`у тому числі ${amountInWords(vatAmount).toLowerCase()} ПДВ`] : [],
  ].filter(r => r.length > 0)
  const wb = createWorkbook(); addSheet(wb, data, 'Видаткова'); return wb
}

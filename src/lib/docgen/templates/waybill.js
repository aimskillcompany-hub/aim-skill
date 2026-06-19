// ── Шаблон: Видаткова накладна ──
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

// Сума ПДВ прописом
function vatInWords(vatAmount) {
  if (!vatAmount || vatAmount === 0) return 'нуль гривень 00 копійок ПДВ'
  return amountInWords(vatAmount).toLowerCase() + ' ПДВ'
}

const aimLogo = (sz) => ({
  text: [
    { text: 'A', color: BLACK, bold: true }, { text: 'i', color: GREEN, bold: true },
    { text: 'M ', color: BLACK, bold: true }, { text: 'Sk', color: BLACK, bold: true },
    { text: 'i', color: GREEN, bold: true }, { text: 'll.', color: BLACK, bold: true },
  ], fontSize: sz || 8,
})

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes, contractNum, contractDate, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress } = options
  const { subtotal, vatAmount, total, vatByRate } = calcTotals(items)
  const barcodeData = `${docNumber}|${formatDate(docDate)}`
  const rows = items.map((it, i) => itm(it, i))
  const contractStr = contractNum ? `№${contractNum}${contractDate ? ` від ${formatDate(contractDate)}` : ''}` : null
  const invoiceStr = invoiceRef ? `№${invoiceRef}${invoiceRefDate ? ` від ${formatDate(invoiceRefDate)}` : ''}` : null
  const itemCount = items.length

  return {
    pageSize: 'A4',
    pageMargins: [40, 20, 40, 56],
    defaultStyle: { fontSize: 9, color: G1 },

    // ═══ FOOTER ═══
    footer: () => ({
      margin: [40, 0, 40, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.3, lineColor: G4 }], margin: [0, 0, 0, 6] },
        {
          columns: [
            // Штрихкод (code128)
            { qr: barcodeData, fit: 28, foreground: G1 },
            // Інфо
            {
              stack: [
                { text: `${docNumber} | ${formatDate(docDate)}`, fontSize: 6, color: G2, margin: [6, 2, 0, 0] },
                { text: 'Сформовано в корпоративній системі AiM Skill', fontSize: 5.5, color: G3, margin: [6, 1, 0, 0] },
                { text: '073 700 77 58  ·  office@aim-skill.com.ua  ·  www.aim-skill.com.ua', fontSize: 5.5, color: G3, margin: [6, 1, 0, 0] },
              ],
              width: '*',
            },
            // Лого
            {
              width: 'auto', alignment: 'right',
              stack: [
                { image: LOGO_BASE64, width: 44, margin: [0, 0, 0, 0] },
              ],
            },
          ],
        },
      ],
    }),

    content: [
      // ═══ НАЗВА ДОКУМЕНТА (без хедера) ═══
      { text: 'ВИДАТКОВА НАКЛАДНА', fontSize: 8, letterSpacing: 4, color: G2, margin: [0, 6, 0, 2] },
      {
        columns: [
          { text: `від ${formatDateLong(docDate)}`, fontSize: 10, color: G1, width: 'auto' },
          city ? { text: `  ·  ${city}`, fontSize: 10, color: G2, width: 'auto' } : {},
        ],
        margin: [0, 0, 0, 2],
      },
      { text: `№ ${docNumber}`, fontSize: 24, bold: true, color: BLACK, margin: [0, 0, 0, 14] },

      // ═══ РЕКВІЗИТИ — ліворуч, з лейблами ═══
      {
        columns: [
          {
            width: '49%',
            stack: [
              { text: 'Постачальник:', fontSize: 8, color: G2, margin: [0, 0, 0, 2] },
              { text: company.shortName || company.name, fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 2] },
              { text: `ЄДРПОУ ${company.edrpou}${company.ipn ? '  ·  ІПН ' + company.ipn : ''}`, fontSize: 8, color: G1, margin: [0, 0, 0, 1] },
              { text: company.address || '', fontSize: 8, color: G1, margin: [0, 0, 0, 1] },
              company.iban ? { text: `IBAN ${company.iban}`, fontSize: 7.5, color: G1, margin: [0, 0, 0, 1] } : {},
              company.bankName ? { text: `${company.bankName}${company.mfo ? ', МФО ' + company.mfo : ''}`, fontSize: 7.5, color: G2, margin: [0, 0, 0, 1] } : {},
              { text: [company.phone, company.email].filter(Boolean).join('  ·  '), fontSize: 7.5, color: G2 },
            ],
          },
          { width: '2%', text: '' },
          {
            width: '49%',
            stack: [
              { text: 'Покупець:', fontSize: 8, color: G2, margin: [0, 0, 0, 2] },
              { text: contractor.short_name || contractor.name || '—', fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 2] },
              contractor.edrpou ? { text: `ЄДРПОУ ${contractor.edrpou}`, fontSize: 8, color: G1, margin: [0, 0, 0, 1] } : {},
              (contractor.legal_address || contractor.address) ? { text: contractor.legal_address || contractor.address, fontSize: 8, color: G1, margin: [0, 0, 0, 1] } : {},
              contractor.iban ? { text: `IBAN ${contractor.iban}`, fontSize: 7.5, color: G1, margin: [0, 0, 0, 1] } : {},
              contractor.phone ? { text: contractor.phone, fontSize: 7.5, color: G2 } : {},
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },

      // ═══ ДОДАТКОВА ІНФОРМАЦІЯ ═══
      (contractStr || invoiceStr || deliveryBasis || deliveryAddress) ? {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: 'ДОДАТКОВА ІНФОРМАЦІЯ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 4] },
              contractStr ? { text: [{ text: 'Договір: ', color: G2 }, { text: contractStr, color: G1 }], fontSize: 8.5, margin: [0, 0, 0, 2] } : {},
              invoiceStr ? { text: [{ text: 'Рахунок: ', color: G2 }, { text: invoiceStr, color: G1 }], fontSize: 8.5, margin: [0, 0, 0, 2] } : {},
              deliveryBasis ? { text: [{ text: 'Базис поставки: ', color: G2 }, { text: deliveryBasis, color: G1 }], fontSize: 8.5, margin: [0, 0, 0, 2] } : {},
              deliveryAddress ? { text: [{ text: 'Адреса поставки: ', color: G2 }, { text: deliveryAddress, color: G1 }], fontSize: 8.5 } : {},
            ].filter(Boolean),
            margin: [10, 8, 10, 8],
          }]],
        },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => G4 },
        margin: [0, 0, 0, 12],
      } : { text: '', margin: [0, 0, 0, 4] },

      // ═══ ТАБЛИЦЯ ═══
      {
        table: {
          headerRows: 1,
          widths: [18, '*', 28, 28, 58, 22, 42, 56],
          body: [
            ['№', 'Найменування товару', 'Од.', 'К-сть', 'Ціна без ПДВ', 'ПДВ', 'Сума ПДВ', 'Сума'].map(t => ({
              text: t, fontSize: 6, bold: true, color: '#FFF', fillColor: DARK,
              alignment: 'center', margin: [0, 5, 0, 5],
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
          paddingTop: () => 5, paddingBottom: () => 5,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
        },
      },

      // Кількість найменувань
      { text: `Кількість найменувань: ${itemCount}`, fontSize: 7.5, color: G2, margin: [0, 4, 0, 0] },

      // ═══ ПІДСУМКИ — компактні ═══
      { text: '', margin: [0, 4] },
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 200,
            table: {
              widths: [100, 90],
              body: [
                [{ text: 'Без ПДВ:', alignment: 'right', fontSize: 8.5, color: G2 }, { text: `${formatMoney(subtotal)} грн`, alignment: 'right', fontSize: 8.5 }],
                ...Object.entries(vatByRate).map(([rate, amt]) =>
                  [{ text: `ПДВ ${rate}%:`, alignment: 'right', fontSize: 8.5, color: G2 }, { text: `${formatMoney(amt)} грн`, alignment: 'right', fontSize: 8.5 }]
                ),
                [{ text: 'Всього:', alignment: 'right', fontSize: 10, bold: true, color: BLACK }, { text: `${formatMoney(total)} грн`, alignment: 'right', fontSize: 11, bold: true, color: BLACK }],
              ],
            },
            layout: 'noBorders',
          },
        ],
      },

      // ═══ РОЗШИФРОВКА СУМИ ═══
      { text: '', margin: [0, 6] },
      {
        text: [
          { text: 'Всього до сплати: ', fontSize: 9, color: G1 },
          { text: amountInWords(total), fontSize: 9, bold: true, color: BLACK },
        ],
        margin: [0, 0, 0, 2],
      },
      vatAmount > 0 ? {
        text: [
          { text: 'у тому числі ', fontSize: 9, color: G1 },
          { text: vatInWords(vatAmount), fontSize: 9, bold: true, color: BLACK },
        ],
      } : {},

      notes ? { text: `Примітка: ${notes}`, fontSize: 8, color: G2, italics: true, margin: [0, 8, 0, 0] } : {},

      // ═══ ПІДПИСИ ═══
      { text: '', margin: [0, 14] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: G4 }], margin: [0, 0, 0, 8] },
      {
        columns: [
          {
            width: '48%',
            stack: [
              { text: 'ВІДПУСТИВ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 14] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
              { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
              { text: 'М.П.', fontSize: 6.5, color: G3, margin: [0, 5, 0, 0] },
            ],
          },
          {
            width: '48%',
            stack: [
              { text: 'ОТРИМАВ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 14] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
              { text: contractor.contact_person || '', fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
              { text: 'М.П.', fontSize: 6.5, color: G3, margin: [0, 5, 0, 0] },
            ],
          },
        ],
      },
    ],
  }
}

function sr(label, amount) {
  return {
    columns: [
      { text: label, alignment: 'right', fontSize: 8.5, color: G2, width: '*' },
      { text: `${formatMoney(amount)} грн`, alignment: 'right', fontSize: 8.5, color: G1, width: 90 },
    ],
    margin: [0, 1, 0, 1],
  }
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
    [], [`Всього до сплати: ${amountInWords(total)}`],
    vatAmount > 0 ? [`у тому числі ${amountInWords(vatAmount).toLowerCase()} ПДВ`] : [],
  ].filter(r => r.length > 0)
  const wb = createWorkbook(); addSheet(wb, data, 'Видаткова'); return wb
}

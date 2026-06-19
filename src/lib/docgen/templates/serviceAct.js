// ── Шаблон: Акт наданих послуг ──
import { formatMoney, formatDate, formatDateLong, amountInWords, calcTotals } from '../formatUtils'
import { createWorkbook, addSheet } from '../xlsxBuilder'
import { LOGO_BASE64 } from '../logo'

const BLACK = '#0A0A0A'
const DARK = '#1C1C1E'
const GRAY1 = '#3A3A3C'
const GRAY2 = '#8E8E93'
const GRAY3 = '#C7C7CC'
const GRAY4 = '#E5E5EA'
const GRAY5 = '#F2F2F7'
const GREEN = '#00C853'

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
    pageMargins: [40, 36, 40, 40],
    defaultStyle: { fontSize: 9.5, color: GRAY1 },
    content: [

      // ═══ HEADER ═══
      {
        columns: [
          { image: LOGO_BASE64, width: 80, margin: [0, 0, 0, 0] },
          {
            width: '*', alignment: 'right',
            stack: [
              { text: company.shortName || company.name, fontSize: 10, bold: true, color: BLACK },
              { text: company.address || '', fontSize: 8, color: GRAY2, margin: [0, 2, 0, 0] },
              { text: `ЄДРПОУ ${company.edrpou || ''}  ·  ІПН ${company.ipn || ''}`, fontSize: 8, color: GRAY2, margin: [0, 1, 0, 0] },
              { text: `${company.phone || ''}  ·  ${company.email || ''}`, fontSize: 8, color: GRAY2, margin: [0, 1, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 12],
      },

      // Лінія
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: BLACK }], margin: [0, 0, 0, 16] },

      // ═══ НАЗВА ДОКУМЕНТА ═══
      { text: 'АКТ НАДАНИХ ПОСЛУГ', fontSize: 8, letterSpacing: 3, color: GRAY2, margin: [0, 0, 0, 3] },
      {
        columns: [
          { text: `№ ${docNumber}`, fontSize: 22, bold: true, color: BLACK, width: 'auto' },
          { text: formatDateLong(docDate), fontSize: 11, color: GRAY2, margin: [10, 11, 0, 0] },
        ],
        margin: [0, 0, 0, 14],
      },

      // ═══ ПРЕАМБУЛА ═══
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
        fontSize: 9, lineHeight: 1.5, margin: [0, 0, 0, 14], color: GRAY1,
      },

      // ═══ СТОРОНИ ═══
      {
        columns: [
          partyBlock('Виконавець', company, true),
          { width: 20, text: '' },
          partyBlock('Замовник', contractor, false),
        ],
        margin: [0, 0, 0, 16],
      },

      // ═══ ТАБЛИЦЯ ═══
      {
        table: {
          headerRows: 1,
          widths: [20, '*', 32, 38, 56, 26, 46, 60],
          body: [
            ['№', 'Послуга', 'К-сть', 'Од.', 'Ціна', 'ПДВ', 'ПДВ ₴', 'Сума'].map(t => ({
              text: t, fontSize: 7.5, bold: true, color: '#FFFFFF', fillColor: DARK, alignment: 'center', margin: [0, 6, 0, 6],
            })),
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
          paddingLeft: () => 5, paddingRight: () => 5,
          paddingTop: () => 6, paddingBottom: () => 6,
          fillColor: (i) => i > 0 && i % 2 === 0 ? GRAY5 : null,
        },
      },

      // ═══ ПІДСУМКИ ═══
      { text: '', margin: [0, 8] },
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 190,
            stack: [
              sumRow('Без ПДВ', subtotal, false),
              ...(hasVat ? [sumRow('ПДВ', vatAmount, false)] : []),
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 0.5, lineColor: GRAY4 }], margin: [0, 3, 0, 3] },
              sumRow('Всього', total, true),
            ],
          },
        ],
      },
      { text: amountInWords(total), fontSize: 8, italics: true, color: GRAY2, margin: [0, 6, 0, 0] },

      // ═══ ПРИЙОМ ═══
      { text: '', margin: [0, 8] },
      { text: 'Вищевказані послуги виконані повністю та в строк. Замовник претензій щодо обсягу, якості та строків надання послуг не має.',
        fontSize: 9, lineHeight: 1.4, color: GRAY1, margin: [0, 0, 0, 0] },

      notes ? { text: notes, fontSize: 8, color: GRAY2, italics: true, margin: [0, 8, 0, 0] } : {},

      // ═══ ПІДПИСИ — компактні ═══
      { text: '', margin: [0, 16] },
      {
        columns: [
          {
            width: '48%',
            stack: [
              { text: 'ВИКОНАВЕЦЬ', fontSize: 7, letterSpacing: 1, color: GRAY2, margin: [0, 0, 0, 12] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: GRAY3 }] },
              { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, color: GRAY1, margin: [0, 3, 0, 0] },
              { text: 'М.П.', fontSize: 7, color: GRAY3, margin: [0, 4, 0, 0] },
            ],
          },
          {
            width: '48%',
            stack: [
              { text: 'ЗАМОВНИК', fontSize: 7, letterSpacing: 1, color: GRAY2, margin: [0, 0, 0, 12] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: GRAY3 }] },
              { text: contractor.contact_person || '', fontSize: 9, color: GRAY1, margin: [0, 3, 0, 0] },
              { text: 'М.П.', fontSize: 7, color: GRAY3, margin: [0, 4, 0, 0] },
            ],
          },
        ],
      },

      // ═══ FOOTER ═══
      { text: '', margin: [0, 14] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.3, lineColor: GRAY4 }] },
      {
        columns: [
          { qr: qrData, fit: 36, margin: [0, 6, 0, 0], foreground: GRAY1 },
          {
            stack: [
              { text: `${docNumber}  ·  ${formatDate(docDate)}  ·  ${formatMoney(total)} грн`, fontSize: 7, color: GRAY3, margin: [8, 8, 0, 0] },
              { text: 'Документ згенеровано в AiM Skill', fontSize: 6, color: GRAY3, margin: [8, 2, 0, 0] },
            ],
            width: '*',
          },
          { image: LOGO_BASE64, width: 50, alignment: 'right', margin: [0, 4, 0, 0] },
        ],
      },
    ],
  }
}

// ── Допоміжні ──
function partyBlock(label, entity, isCompany) {
  const name = isCompany ? (entity.shortName || entity.name) : (entity.short_name || entity.name || '—')
  const edrpou = entity.edrpou
  const address = isCompany ? entity.address : (entity.legal_address || entity.address)
  const iban = isCompany ? entity.iban : entity.iban

  return {
    width: '*',
    stack: [
      { text: label.toUpperCase(), fontSize: 7, letterSpacing: 1.5, color: GRAY2, margin: [0, 0, 0, 4] },
      { text: name, fontSize: 10, bold: true, color: BLACK, margin: [0, 0, 0, 2] },
      edrpou ? { text: `ЄДРПОУ ${edrpou}`, fontSize: 8, color: GRAY1 } : {},
      address ? { text: address, fontSize: 8, color: GRAY2, margin: [0, 1, 0, 0] } : {},
      iban ? { text: `IBAN ${iban}`, fontSize: 7.5, color: GRAY2, margin: [0, 1, 0, 0] } : {},
    ],
  }
}

function sumRow(label, amount, isBold) {
  return {
    columns: [
      { text: label, alignment: 'right', fontSize: isBold ? 11 : 9, bold: isBold, color: isBold ? BLACK : GRAY2, width: '*' },
      { text: `${formatMoney(amount)} грн`, alignment: 'right', fontSize: isBold ? 12 : 9, bold: isBold, color: isBold ? BLACK : GRAY1, width: 95 },
    ],
    margin: [0, 1, 0, 1],
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

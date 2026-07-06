// ── Шаблон: Інвестиційний розрахунок по замовленню (монохромний стиль) ──
// Рентабельність, потрібний капітал, прибуток, ROI — для рішення про участь у закупівлі.
import { formatMoney, formatDate } from '../formatUtils'
import { LOGO_BASE64 } from '../logo'

const BLACK = '#0A0A0A'
const DARK = '#1C1C1E'
const G1 = '#3A3A3C'
const G2 = '#8E8E93'
const G3 = '#C7C7CC'
const G4 = '#E5E5EA'
const GREEN = '#1A7F52'
const RED = '#B3261E'

const money = n => `${formatMoney(n)} грн`
const pct = n => `${(n * 100).toFixed(1)}%`

function compute(items) {
  const rows = (items || []).filter(it => (it.name || '').trim()).map(it => {
    const qty = Number(it.qty) || 0
    const cost = Number(it.cost_price) || 0
    const up = Number(it.unit_price) || 0
    const v = Number(it.vat_rate) || 0
    const sellUnit = it.price_includes_vat ? up : up * (1 + v / 100)
    const costSum = cost * qty
    const sellSum = sellUnit * qty
    const margin = sellSum - costSum
    return { name: it.name, qty, cost, sellUnit, costSum, sellSum, margin, marginPct: sellSum ? margin / sellSum : 0 }
  })
  const capital = rows.reduce((s, r) => s + r.costSum, 0)
  const revenue = rows.reduce((s, r) => s + r.sellSum, 0)
  const marginGross = revenue - capital
  const marginNet = marginGross / 1.2
  const vatToPay = marginGross - marginNet
  const incomeTax = marginNet * 0.18
  const netProfit = marginNet - incomeTax
  const roi = capital ? netProfit / capital : 0
  const marginPct = revenue ? marginGross / revenue : 0
  return { rows, capital, revenue, marginGross, marginNet, vatToPay, incomeTax, netProfit, roi, marginPct }
}

export function pdf(company, order, items, options = {}) {
  const m = compute(items)
  const client = order?.contractors?.name || order?.client_name || '—'
  const orderNo = order?.order_number || (order?.id || '').slice(0, 6)
  const today = options.date || new Date().toISOString().slice(0, 10)

  // Монохромна KPI-картка: тонка верхня лінія + підпис + велике значення
  const kpi = (label, value, accent) => ({
    table: { widths: ['*'], body: [[{
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 1.5, lineColor: accent || BLACK }], margin: [0, 0, 0, 7] },
        { text: label, fontSize: 7, color: G2, letterSpacing: 0.5, margin: [0, 0, 0, 4] },
        { text: value, fontSize: 15, bold: true, color: accent || BLACK },
      ],
      margin: [0, 0, 0, 0],
    }]] },
    layout: 'noBorders',
  })

  const th = (t, align) => ({ text: t, fontSize: 6.5, bold: true, color: G2, alignment: align || 'left', letterSpacing: 0.3, margin: [0, 3, 0, 5] })
  const td = (t, align, opt = {}) => ({ text: t, fontSize: 8.5, alignment: align || 'left', color: opt.color || G1, bold: opt.bold, margin: [0, 3, 0, 3] })

  const sumRow = (label, value, opt = {}) => ([
    { text: label, fontSize: opt.big ? 10.5 : 9, color: opt.big ? BLACK : G2, bold: opt.big, alignment: 'right', border: [false, opt.top || false, false, false], borderColor: [G4, BLACK, G4, G4], margin: [0, opt.big ? 5 : 2.5, 0, opt.big ? 5 : 2.5] },
    { text: value, fontSize: opt.big ? 10.5 : 9, color: opt.color || (opt.big ? BLACK : G1), bold: opt.big || opt.bold, alignment: 'right', border: [false, opt.top || false, false, false], borderColor: [G4, BLACK, G4, G4], margin: [0, opt.big ? 5 : 2.5, 0, opt.big ? 5 : 2.5] },
  ])

  return {
    pageSize: 'A4',
    pageMargins: [42, 26, 42, 30],
    defaultStyle: { fontSize: 9, color: G1 },
    content: [
      // ── Шапка ──
      {
        columns: [
          { image: LOGO_BASE64, width: 58 },
          { width: '*', alignment: 'right', stack: [
            { text: company.shortName || company.name, fontSize: 9.5, bold: true, color: BLACK },
            { text: company.edrpou ? `ЄДРПОУ ${company.edrpou}` : '', fontSize: 7.5, color: G2, margin: [0, 2, 0, 0] },
          ] },
        ],
        margin: [0, 0, 0, 10],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 511, y2: 0, lineWidth: 1.5, lineColor: BLACK }], margin: [0, 0, 0, 14] },

      { text: 'ІНВЕСТИЦІЙНИЙ РОЗРАХУНОК', fontSize: 8, color: G2, bold: true, letterSpacing: 3 },
      { text: `Замовлення № ${orderNo}`, fontSize: 22, bold: true, color: BLACK, margin: [0, 3, 0, 3] },
      { text: `Замовник: ${client}      Станом на ${formatDate(today)}`, fontSize: 9, color: G1, margin: [0, 0, 0, 18] },

      // ── Ключові показники ──
      { columns: [
        kpi('ПОТРІБНИЙ КАПІТАЛ', money(m.capital), BLACK), { width: 14, text: '' },
        kpi('ВИРУЧКА (з ПДВ)', money(m.revenue), BLACK),
      ], margin: [0, 0, 0, 14] },
      { columns: [
        kpi('ЧИСТИЙ ПРИБУТОК', money(m.netProfit), GREEN), { width: 14, text: '' },
        kpi('ROI (на капітал)', pct(m.roi), GREEN),
      ], margin: [0, 0, 0, 20] },

      // ── Склад замовлення ──
      { text: 'СКЛАД ЗАМОВЛЕННЯ', fontSize: 7.5, color: G2, bold: true, letterSpacing: 2, margin: [0, 0, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: [14, '*', 24, 54, 54, 62, 64, 58, 26],
          body: [
            [th('№', 'center'), th('НАЙМЕНУВАННЯ'), th('К-СТЬ', 'center'), th('ЗАКУП/ОД', 'right'), th('ПРОД/ОД', 'right'), th('СУМА ЗАКУП', 'right'), th('СУМА ПРОД', 'right'), th('МАРЖА', 'right'), th('%', 'right')],
            ...m.rows.map((r, i) => ([
              td(i + 1, 'center', { color: G3 }),
              td(r.name, 'left', { color: DARK }),
              td(r.qty, 'center'),
              td(formatMoney(r.cost), 'right', { color: G2 }),
              td(formatMoney(r.sellUnit), 'right'),
              td(formatMoney(r.costSum), 'right', { color: G2 }),
              td(formatMoney(r.sellSum), 'right', { bold: true, color: BLACK }),
              td(formatMoney(r.margin), 'right', { bold: true, color: r.margin >= 0 ? GREEN : RED }),
              td(pct(r.marginPct), 'right', { color: G2 }),
            ])),
          ],
        },
        layout: {
          hLineWidth: (i) => i === 0 ? 0 : i === 1 ? 1.2 : 0.4,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? BLACK : G4,
          paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 0, paddingBottom: () => 0,
        },
      },

      // ── Фінансовий підсумок ──
      { columns: [
        { width: '*', text: '' },
        { width: 288, margin: [0, 14, 0, 0], table: { widths: [172, 116], body: [
          sumRow('Сума закупівлі (капітал)', money(m.capital)),
          sumRow('Сума продажу (з ПДВ)', money(m.revenue)),
          sumRow('Валова маржа', `${money(m.marginGross)}  ·  ${pct(m.marginPct)}`, { bold: true, color: GREEN }),
          sumRow('ПДВ до сплати (з маржі)', money(m.vatToPay)),
          sumRow('Прибуток до податку', money(m.marginNet)),
          sumRow('Податок на прибуток 18%', `− ${money(m.incomeTax)}`, { color: RED }),
          sumRow('ЧИСТИЙ ПРИБУТОК', money(m.netProfit), { big: true, top: true, color: GREEN }),
        ] }, layout: { hLineWidth: (i, node) => i === node.table.body.length - 1 ? 1.2 : 0, vLineWidth: () => 0, hLineColor: () => BLACK, paddingLeft: () => 0, paddingRight: () => 0 } },
      ] },

      // ── Висновок ──
      { table: { widths: ['*'], body: [[{
        stack: [
          { text: 'ВИСНОВОК ДЛЯ РІШЕННЯ', fontSize: 7.5, bold: true, color: G2, letterSpacing: 2, margin: [0, 0, 0, 7] },
          { text: [
            { text: 'На кожну 1 грн капіталу — ', fontSize: 9.5, color: G1 },
            { text: `${m.roi.toFixed(2)} грн `, fontSize: 9.5, bold: true, color: GREEN },
            { text: `чистого прибутку (ROI ${pct(m.roi)}).  Маржинальність — ${pct(m.marginPct)}.`, fontSize: 9.5, color: G1 },
          ] },
          { text: `Залучити ${money(m.capital)} на закупівлю · очікуваний чистий прибуток ${money(m.netProfit)}.`, fontSize: 9.5, color: G1, margin: [0, 5, 0, 0] },
        ],
        margin: [14, 11, 14, 11],
      }]] }, layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 2.5 : 0, vLineColor: () => GREEN, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 }, margin: [0, 20, 0, 0] },

      { text: 'Розрахунок орієнтовний — на основі поточних цін закупівлі та продажу в замовленні. Не є фінансовою гарантією.', fontSize: 7, italics: true, color: G3, margin: [0, 14, 0, 0] },
    ],
  }
}

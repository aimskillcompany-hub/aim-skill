// ── Шаблон: Інвестиційний розрахунок по замовленню (для інвестора) ──
// Рентабельність, потрібний капітал, прибуток, ROI — для рішення про участь у закупівлі.
import { formatMoney, formatDate } from '../formatUtils'
import { C, logo } from './shared'

const money = n => `${formatMoney(n)} грн`
const pct = n => `${(n * 100).toFixed(1)}%`

function compute(items) {
  const rows = (items || []).filter(it => (it.name || '').trim()).map(it => {
    const qty = Number(it.qty) || 0
    const cost = Number(it.cost_price) || 0
    const up = Number(it.unit_price) || 0
    const v = Number(it.vat_rate) || 0
    const sellUnit = it.price_includes_vat ? up : up * (1 + v / 100) // ціна продажу з ПДВ/од
    const costSum = cost * qty
    const sellSum = sellUnit * qty
    const margin = sellSum - costSum
    return { name: it.name, sku: it.sku, qty, cost, sellUnit, costSum, sellSum, margin, marginPct: sellSum ? margin / sellSum : 0 }
  })
  const capital = rows.reduce((s, r) => s + r.costSum, 0)   // потрібний капітал (закупівля з ПДВ)
  const revenue = rows.reduce((s, r) => s + r.sellSum, 0)   // виручка (продаж з ПДВ)
  const marginGross = revenue - capital
  const marginNet = marginGross / 1.2                        // прибуток до податку (без вихідного ПДВ)
  const vatToPay = marginGross - marginNet                   // ПДВ до сплати (з маржі)
  const incomeTax = marginNet * 0.18                         // податок на прибуток 18%
  const netProfit = marginNet - incomeTax                    // чистий прибуток
  const roi = capital ? netProfit / capital : 0              // рентабельність капіталу
  const marginPct = revenue ? marginGross / revenue : 0
  return { rows, capital, revenue, marginGross, marginNet, vatToPay, incomeTax, netProfit, roi, marginPct }
}

export function pdf(company, order, items, options = {}) {
  const m = compute(items)
  const client = order?.contractors?.name || order?.client_name || '—'
  const orderNo = order?.order_number || (order?.id || '').slice(0, 6)
  const today = options.date || new Date().toISOString().slice(0, 10)

  const kpi = (label, value, color, big) => ({
    table: { widths: ['*'], body: [[{
      stack: [
        { text: label, fontSize: 7.5, color: C.text3, margin: [0, 0, 0, 3] },
        { text: value, fontSize: big ? 15 : 12, bold: true, color: color || C.brand },
      ], margin: [10, 8, 10, 8],
    }]] },
    layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 3 : 0, vLineColor: () => color || C.blue, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
  })

  const itemRow = (r, i) => ([
    { text: i + 1, fontSize: 8, alignment: 'center', color: C.text3 },
    { text: r.name, fontSize: 8.5 },
    { text: r.qty, fontSize: 8.5, alignment: 'center' },
    { text: formatMoney(r.cost), fontSize: 8.5, alignment: 'right', color: C.text2 },
    { text: formatMoney(r.sellUnit), fontSize: 8.5, alignment: 'right' },
    { text: formatMoney(r.costSum), fontSize: 8.5, alignment: 'right', color: C.text2 },
    { text: formatMoney(r.sellSum), fontSize: 8.5, alignment: 'right', bold: true },
    { text: formatMoney(r.margin), fontSize: 8.5, alignment: 'right', color: r.margin >= 0 ? C.green : '#C0392B', bold: true },
    { text: pct(r.marginPct), fontSize: 8, alignment: 'right', color: C.text3 },
  ])

  return {
    pageSize: 'A4',
    pageMargins: [40, 34, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    content: [
      {
        columns: [
          logo(),
          { width: '*', alignment: 'right', stack: [
            { text: company.shortName || company.name, fontSize: 10, bold: true, color: C.brand },
            { text: company.edrpou ? `ЄДРПОУ ${company.edrpou}` : '', fontSize: 8, color: C.text3, margin: [0, 2, 0, 0] },
          ] },
        ],
        margin: [0, 0, 0, 8],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: C.blue }], margin: [0, 0, 0, 14] },

      { text: 'ІНВЕСТИЦІЙНИЙ РОЗРАХУНОК', fontSize: 9, color: C.blue, bold: true, letterSpacing: 2 },
      { text: `Замовлення № ${orderNo}`, fontSize: 18, bold: true, color: C.brand, margin: [0, 2, 0, 2] },
      { text: `Замовник: ${client}   ·   станом на ${formatDate(today)}`, fontSize: 9, color: C.text2, margin: [0, 0, 0, 14] },

      // Ключові показники для рішення
      { columns: [
        kpi('ПОТРІБНИЙ КАПІТАЛ (закупівля)', money(m.capital), C.brand, true),
        { width: 8, text: '' },
        kpi('ВИРУЧКА (продаж з ПДВ)', money(m.revenue), C.brand, true),
      ], margin: [0, 0, 0, 8] },
      { columns: [
        kpi('ЧИСТИЙ ПРИБУТОК', money(m.netProfit), C.green, true),
        { width: 8, text: '' },
        kpi('РЕНТАБЕЛЬНІСТЬ КАПІТАЛУ (ROI)', pct(m.roi), C.green, true),
      ], margin: [0, 0, 0, 16] },

      // Таблиця позицій
      { text: 'СКЛАД ЗАМОВЛЕННЯ', fontSize: 8, color: C.blue, bold: true, letterSpacing: 1.5, margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1,
          widths: [16, '*', 26, 52, 52, 60, 62, 58, 26],
          body: [
            ['№', 'Найменування', 'К-сть', 'Закуп/од', 'Прод/од', 'Сума закуп', 'Сума прод', 'Маржа', '%'].map(t => ({ text: t, fontSize: 7, bold: true, color: C.blue, alignment: 'center', margin: [0, 4, 0, 4] })),
            ...m.rows.map((r, i) => itemRow(r, i)),
          ],
        },
        layout: {
          hLineWidth: (i) => i === 0 ? 0 : i === 1 ? 1.5 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? C.blue : C.border,
          paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4,
          fillColor: (i) => i > 1 && i % 2 === 1 ? '#FAFBFC' : null,
        },
      },

      // Фінансовий підсумок
      { text: '', margin: [0, 10] },
      { columns: [
        { width: '*', text: '' },
        { width: 300, table: { widths: [180, 120], body: [
          [{ text: 'Сума закупівлі (капітал):', fontSize: 9, color: C.text2, alignment: 'right', border: [false, false, false, false] }, { text: money(m.capital), fontSize: 9, alignment: 'right', border: [false, false, false, false] }],
          [{ text: 'Сума продажу (з ПДВ):', fontSize: 9, color: C.text2, alignment: 'right', border: [false, false, false, false] }, { text: money(m.revenue), fontSize: 9, alignment: 'right', border: [false, false, false, false] }],
          [{ text: 'Валова маржа:', fontSize: 9, color: C.text2, alignment: 'right', border: [false, false, false, false] }, { text: `${money(m.marginGross)}  (${pct(m.marginPct)})`, fontSize: 9, alignment: 'right', bold: true, color: C.green, border: [false, false, false, false] }],
          [{ text: 'ПДВ до сплати (з маржі):', fontSize: 9, color: C.text2, alignment: 'right', border: [false, false, false, false] }, { text: money(m.vatToPay), fontSize: 9, alignment: 'right', border: [false, false, false, false] }],
          [{ text: 'Прибуток до податку:', fontSize: 9, color: C.text2, alignment: 'right', border: [false, false, false, false] }, { text: money(m.marginNet), fontSize: 9, alignment: 'right', border: [false, false, false, false] }],
          [{ text: 'Податок на прибуток (18%):', fontSize: 9, color: C.text2, alignment: 'right', border: [false, false, false, false] }, { text: `− ${money(m.incomeTax)}`, fontSize: 9, alignment: 'right', color: '#C0392B', border: [false, false, false, false] }],
          [{ text: 'ЧИСТИЙ ПРИБУТОК:', fontSize: 11, bold: true, color: C.brand, alignment: 'right', border: [false, true, false, false], borderColor: [C.border, C.blue, C.border, C.border] }, { text: money(m.netProfit), fontSize: 11, bold: true, color: C.green, alignment: 'right', border: [false, true, false, false], borderColor: [C.border, C.blue, C.border, C.border] }],
        ] }, layout: { hLineWidth: (i, node) => i === node.table.body.length - 1 ? 1 : 0, vLineWidth: () => 0, hLineColor: () => C.blue, paddingTop: () => 3, paddingBottom: () => 3 } },
      ] },

      // Оцінка
      { text: '', margin: [0, 12] },
      { table: { widths: ['*'], body: [[{
        stack: [
          { text: 'ВИСНОВОК ДЛЯ РІШЕННЯ', fontSize: 8, bold: true, color: C.blue, letterSpacing: 1, margin: [0, 0, 0, 6] },
          { text: [
            { text: 'На кожну 1 грн вкладеного капіталу очікується ', fontSize: 9, color: C.text },
            { text: `${(m.roi).toFixed(2)} грн `, fontSize: 9, bold: true, color: C.green },
            { text: `чистого прибутку (ROI ${pct(m.roi)}). Маржинальність замовлення — ${pct(m.marginPct)}.`, fontSize: 9, color: C.text },
          ] },
          { text: `Потрібно залучити ${money(m.capital)} на закупівлю; очікуваний чистий прибуток ${money(m.netProfit)}.`, fontSize: 9, color: C.text, margin: [0, 4, 0, 0] },
        ], margin: [12, 10, 12, 10],
      }]] }, layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 3 : 0, vLineColor: () => C.green, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 } },

      { text: 'Розрахунок орієнтовний, на основі поточних цін закупівлі та продажу в замовленні. Не є фінансовою гарантією.', fontSize: 7, italics: true, color: C.text3, margin: [0, 14, 0, 0] },
    ],
  }
}

// Єдиний розрахунок ПЛАНУ замовлення з його позицій — джерело для «Планової прибутковості»
// (вкладка «Прибутковість») і для «Прогнозу». Усе рахується тут, щоб цифри не розходились.
//
// Ціни позиції — у базисі price_includes_vat (як у вкладці «Товари»): true → ціна вже з ПДВ.
// ПДВ продажу — vat_rate; ПДВ закупівлі — cost_vat_rate (міграція 067; null → як vat_rate).
// Неплатник ПДВ (компанія замовлення) → усі ставки 0: net = gross.

export const PROFIT_TAX = 0.18 // податок на прибуток: валовий × 18% (лише юрособа-платник ПДВ; ФОП/єдиний податок — 0)

const n = (v) => Number(v) || 0
const hasVal = (v) => v !== null && v !== undefined && v !== ''

export const saleRate = (r, vatOn = true) => vatOn ? n(r.vat_rate) : 0
export const costRate = (r, vatOn = true) => vatOn ? (hasVal(r.cost_vat_rate) ? n(r.cost_vat_rate) : n(r.vat_rate)) : 0

const toNet = (p, v, incl) => (incl && v > 0 ? p / (1 + v / 100) : p)
const toGross = (p, v, incl) => (incl ? p : p * (1 + v / 100))

// Продаж і закупівля однієї позиції: { net, gross } на всю кількість
export function itemSale(r, vatOn = true) {
  const v = saleRate(r, vatOn), incl = vatOn && !!r.price_includes_vat, q = n(r.qty), p = n(r.unit_price)
  return { net: q * toNet(p, v, incl), gross: q * toGross(p, v, incl) }
}
export function itemCost(r, vatOn = true) {
  const v = costRate(r, vatOn), incl = vatOn && !!r.price_includes_vat, q = n(r.qty), c = n(r.cost_price)
  return { net: q * toNet(c, v, incl), gross: q * toGross(c, v, incl) }
}

// План замовлення. items — order_items; agentPct — частка (0.35 = 35%); otherExpenses — Σ «Інших витрат».
// Єдині правила (рішення власника 2026-10-19, як у звіті інвестору):
//   податок = валовий × 18% (лише якщо юрособа платник ПДВ — загальна система; інакше 0);
//   агентські = (валовий − податок) × %. Від'ємний валовий → податок і агентські 0.
export function computeOrderPlan(items, { vatOn = true, agentPct = 0, otherExpenses = 0, profitTax = vatOn } = {}) {
  let revenueNet = 0, revenueGross = 0, costNet = 0, costGross = 0
  const bySupplier = {}
  for (const r of items || []) {
    const s = itemSale(r, vatOn), c = itemCost(r, vatOn)
    revenueNet += s.net; revenueGross += s.gross; costNet += c.net; costGross += c.gross
    const key = r.supplier_id || '__none__'
    const b = (bySupplier[key] ||= { supplierId: r.supplier_id || null, net: 0, gross: 0 })
    b.net += c.net; b.gross += c.gross
  }
  const saleVat = revenueGross - revenueNet
  const purchaseVat = costGross - costNet
  const gross = revenueNet - costNet
  const tax = gross > 0 && profitTax ? gross * PROFIT_TAX : 0
  const agent = gross > 0 ? (gross - tax) * n(agentPct) : 0
  const other = n(otherExpenses)
  const net = gross - tax - agent - other
  return {
    revenueNet, revenueGross, saleVat, costNet, costGross, purchaseVat,
    vatPayable: saleVat - purchaseVat,
    gross, tax, agent, other, net, bySupplier,
  }
}

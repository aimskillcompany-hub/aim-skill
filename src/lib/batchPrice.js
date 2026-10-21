// Ціна партії (прихідного руху) без ПДВ — спільна для звірки, картки товару й оцінки складу.
// Ціна партії без ПДВ — як batch_unit_cost (072): база збереженої ціни — звірка Σ(к-сть × ціна) прихідних рухів
// документа з сумою документа з ПДВ / без ПДВ; постачальник без ПДВ → повна ціна; ми неплатник → з ПДВ.
export function batchUnit(m, doc, docIns, wePayer = true) {
  const raw = (Number(m.cost_price) || 0) || (Number(m.price) || 0)
  if (!doc || !(Math.abs(Number(doc.amount) || 0) > 0)) return { unit: raw, basis: 'без документа — як у русі', vat: null }
  const amount = Math.abs(Number(doc.amount)), vat = Math.abs(Number(doc.vat_amount) || 0)
  if (vat <= 0.005) return { unit: raw, basis: 'постачальник без ПДВ — повна ціна', vat: false }
  const net = amount - vat
  const tot = (docIns || []).reduce((s, x) => s + (Number(x.quantity) || 0) * ((Number(x.cost_price) || 0) || (Number(x.price) || 0)), 0)
  const grossStored = Math.abs(tot - amount) < Math.abs(tot - net)
  if (wePayer) return grossStored ? { unit: Math.round(raw * net / amount * 10000) / 10000, basis: 'у русі з ПДВ → без ПДВ', vat: true } : { unit: raw, basis: 'без ПДВ', vat: true }
  return grossStored ? { unit: raw, basis: 'з ПДВ (ми неплатник)', vat: true } : { unit: raw * amount / (net || 1), basis: 'без ПДВ → з ПДВ (ми неплатник)', vat: true }
}


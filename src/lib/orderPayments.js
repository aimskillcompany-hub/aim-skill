// Прив'язка замовлення до банківської оплати клієнта (статус «Оплачено клієнтом»).
// Модель: orders.paid_transaction_id → bank_transactions (одна оплата на замовлення).
// Автоматч (за вимогою користувача): контрагент оплати = клієнт замовлення
// І сума оплати ≈ сума замовлення (з ПДВ). Незалежна від orders.status.
import { supabase } from './supabase'
import { qc } from './companyScope'

// Допуск збігу суми: ≤1 грн або ≤0.5% (щоб покрити копійчані розбіжності округлення).
export function amountMatches(orderTotal, txAmount) {
  const a = Math.abs(Number(orderTotal) || 0)
  const b = Math.abs(Number(txAmount) || 0)
  if (a === 0 || b === 0) return false
  return Math.abs(a - b) <= Math.max(1, a * 0.005)
}

// Кандидати на оплату замовлення: вхідні транзакції (Доходи) того самого контрагента
// з відповідною сумою, не проігноровані, ще не прив'язані до ІНШОГО замовлення.
export async function paymentCandidates(order) {
  if (!order?.client_id || !order?.total) return []
  const { data: txs } = await qc('bank_transactions')
    .select('id, date, amount, direction, description, counterparty, contractor_id')
    .eq('contractor_id', order.client_id)
    .eq('direction', 'Доходи')
    .eq('is_ignored', false)
    .order('date', { ascending: false })
  let list = (txs || []).filter(t => amountMatches(order.total, t.amount))
  if (list.length) {
    // Прибираємо транзакції, вже зайняті іншим замовленням (щоб не двоїти оплату).
    try {
      const ids = list.map(t => t.id)
      const { data: taken } = await qc('orders').select('id, paid_transaction_id').in('paid_transaction_id', ids)
      const takenBy = {}
      ;(taken || []).forEach(r => { if (r.paid_transaction_id) takenBy[r.paid_transaction_id] = r.id })
      list = list.filter(t => !takenBy[t.id] || takenBy[t.id] === order.id)
    } catch { /* колонка paid_transaction_id ще не створена (міграція 056) — ігноруємо фільтр */ }
  }
  return list
}

// Усі вхідні оплати клієнта (для ручної прив'язки — навіть якщо сума не збігається).
export async function clientPayments(order, limit = 50) {
  if (!order?.client_id) return []
  const { data } = await qc('bank_transactions')
    .select('id, date, amount, direction, description, counterparty, contractor_id')
    .eq('contractor_id', order.client_id)
    .eq('direction', 'Доходи')
    .eq('is_ignored', false)
    .order('date', { ascending: false })
    .limit(limit)
  return data || []
}

// Автопідбір: лінкує, лише якщо рівно один впевнений кандидат (контрагент + сума).
// Повертає прив'язану транзакцію або null. Кидає помилку лише на збої запису.
export async function autoLinkPayment(order) {
  if (order.paid_transaction_id) return null
  const cands = await paymentCandidates(order)
  if (cands.length !== 1) return null
  const tx = cands[0]
  const { error } = await qc('orders').update({ paid_transaction_id: tx.id }).eq('id', order.id)
  if (error) throw error
  return tx
}

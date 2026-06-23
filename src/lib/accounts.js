// Єдине джерело розрахунку залишків рахунків — використовується всюди
// (Банк/Каса, Дашборд, Бюджет/прогноз), щоб цифра завжди збігалась.
//
// ВАЖЛИВО: залишок рахує ВСІ неігноровані транзакції (валідовані + ні),
// бо це реальні гроші у виписці. Валідація (is_validated) — лише для P&L,
// а не для того, чи рухнулись кошти.
//
//   Залишок = opening_balance + (Надходження − Витрати) від opening_balance_date
import { supabase } from './supabase'

export async function getAccountBalances() {
  const [{ data: accs }, { data: txs }] = await Promise.all([
    supabase.from('accounts').select('id, name, type, bank_name, is_active, opening_balance, opening_balance_date, sort_order').order('sort_order'),
    supabase.from('bank_transactions').select('account_id, amount, date').eq('is_ignored', false),
  ])
  const agg = {}
  ;(accs || []).forEach(a => { agg[a.id] = { inflow: 0, outflow: 0 } })
  ;(txs || []).forEach(t => {
    const a = agg[t.account_id]; if (!a) return
    const od = (accs.find(x => x.id === t.account_id) || {}).opening_balance_date
    if (od && t.date && t.date < od) return
    const amt = Number(t.amount) || 0
    if (amt >= 0) a.inflow += amt; else a.outflow += -amt
  })
  return (accs || []).map(a => {
    const m = agg[a.id]
    const opening = Number(a.opening_balance) || 0
    const movement = m.inflow - m.outflow
    return {
      id: a.id, name: a.name, type: a.type, bank_name: a.bank_name, is_active: a.is_active,
      opening, inflow: m.inflow, outflow: m.outflow, movement, balance: opening + movement,
    }
  })
}

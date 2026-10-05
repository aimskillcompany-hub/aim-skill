// Єдине джерело розрахунку залишків рахунків — використовується всюди
// (Банк/Каса, Дашборд, Аналітика/прогноз), щоб цифра завжди збігалась.
//
// ВАЖЛИВО: залишок рахує ВСІ неігноровані транзакції (валідовані + ні),
// бо це реальні гроші у виписці. Валідація (is_validated) — лише для P&L,
// а не для того, чи рухнулись кошти.
//
//   Залишок = opening_balance + (Надходження − Витрати) від opening_balance_date
import { supabase } from './supabase'
import { qc } from './companyScope'

export async function getAccountBalances() {
  // ВАЖЛИВО: Supabase віддає максимум 1000 рядків за запит. Транзакцій набагато більше,
  // тож вибираємо посторінково — інакше залишок рахувався б лише по перших 1000 (завищено/занижено).
  const fetchAllTx = async () => {
    let from = 0, all = []
    while (true) {
      const { data } = await qc('bank_transactions').select('account_id, amount, date').eq('is_ignored', false).range(from, from + 999)
      if (!data?.length) break
      all.push(...data)
      if (data.length < 1000) break
      from += 1000
    }
    return all
  }
  const [{ data: accs }, txs] = await Promise.all([
    qc('accounts').select('id, name, type, bank_name, is_active, opening_balance, opening_balance_date, sort_order').order('sort_order'),
    fetchAllTx(),
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

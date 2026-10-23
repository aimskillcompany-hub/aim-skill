// Рішення про витрати в протоколах нарад (ТЗ редизайну 6.1; міграція 098, доступ — лише адміністратор через RLS).
// Читаємо й пишемо таблицю meeting_decisions; старі текстові рішення в meeting_minutes.decisions не чіпаємо.
import { supabase } from './supabase'
import { getAccountBalances } from './accounts'
import { setReportScope, runExclusive } from './companyScope'
import { clearCompanyCache } from './companyConfig'

export const CATEGORIES = [
  { key: 'owner_payout', label: 'Виплати власникам', color: 'var(--brand)' },
  { key: 'salary', label: 'Зарплата / винагорода', color: 'var(--info-fg)' },
  { key: 'agent_fee', label: 'Агентські', color: 'var(--group-fg)' },
  { key: 'purchase', label: 'Закупівля', color: 'var(--warn-mark)' },
  { key: 'other', label: 'Інше', color: 'var(--muted-2)' },
]
export const catOf = (k) => CATEGORIES.find(c => c.key === k) || CATEGORIES[CATEGORIES.length - 1]
export const isMissingTable = (e) => /meeting_decisions/.test(e?.message || '') && /(does not exist|not find|schema cache)/i.test(e?.message || '')

export async function listDecisions() {
  const { data, error } = await supabase.from('meeting_decisions').select('*').order('created_at')
  if (error) throw error
  return data || []
}
export async function createDecision(row) {
  const { data, error } = await supabase.from('meeting_decisions').insert(row).select('*').single()
  if (error) throw error
  return data
}
export async function updateDecision(id, patch) {
  const { data, error } = await supabase.from('meeting_decisions').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  return data
}
export async function deleteDecision(id) {
  const { error } = await supabase.from('meeting_decisions').delete().eq('id', id)
  if (error) throw error
}

// Залишки рахунків усіх юросіб групи (той самий getAccountBalances по кожній компанії)
export async function groupAccountBalances(companies) {
  return runExclusive(async () => {
    const out = []
    try {
      for (const c of companies || []) {
        setReportScope(c.id); clearCompanyCache()
        const list = await getAccountBalances().catch(() => [])
        list.forEach(a => out.push({ ...a, companyId: c.id, companyName: c.short_name || c.name }))
      }
    } finally { setReportScope(null); clearCompanyCache() }
    return out
  })
}

// Платежі-кандидати для запланованих рішень: витрата з того самого рахунку, сума ±1%, не раніше дати наради,
// ще не прив'язана до іншого рішення; якщо в рішенні вказано контрагента — той самий контрагент.
// Лише пропозиція: прив'язка — після підтвердження (linkPayment).
export async function findPaymentCandidates(decisions, minutesById) {
  const planned = decisions.filter(d => d.status === 'planned' && d.source_account_id)
  if (!planned.length) return {}
  const accIds = [...new Set(planned.map(d => d.source_account_id))]
  const from = planned.map(d => minutesById[d.protocol_id]?.meeting_date).filter(Boolean).sort()[0] || '2000-01-01'
  const { data, error } = await supabase.from('bank_transactions')
    .select('id, date, amount, account_id, counterparty, contractor_id, description')
    .in('account_id', accIds).lt('amount', 0).eq('is_ignored', false).gte('date', from).order('date')
  if (error) return {}
  const used = new Set(decisions.map(d => d.paid_transaction_id).filter(Boolean))
  const res = {}
  planned.forEach(d => {
    const md = minutesById[d.protocol_id]?.meeting_date || from
    const amt = Number(d.amount)
    res[d.id] = (data || []).filter(t => !used.has(t.id) && t.account_id === d.source_account_id && t.date >= md
      && Math.abs(Math.abs(Number(t.amount)) - amt) <= amt * 0.01
      && (!d.contractor_id || t.contractor_id === d.contractor_id)).slice(0, 3)
  })
  return res
}
export const linkPayment = (id, txId) => updateDecision(id, { status: 'paid', paid_transaction_id: txId })

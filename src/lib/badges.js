// Лічильники в меню (ТЗ, розділ 3): що чекає дії. Лише підрахунок (head + count), нічого не змінює.
//   documents — неперевірені або без суми (проведені; чернетки замовлень не рахуються)
//   bank      — неігноровані операції, не підтверджені або без статті
//   tasks     — мої прострочені задачі
// Рахується в межах активної юрособи (qc). Якщо колонки ще немає (стара схема) — 0, без помилки.
import { qc } from './companyScope'
import { supabase } from './supabase'
import { isOverdue } from './tasks'

const count = async (q) => {
  const { count: n, error } = await q
  return error ? 0 : (n || 0)
}

export async function loadBadges(userId) {
  const head = { count: 'exact', head: true }
  const [documents, bank, tasks] = await Promise.all([
    count(qc('documents').select('id', head).not('posted', 'is', false).or('is_verified.is.false,is_verified.is.null,amount.is.null,amount.eq.0')),
    count(qc('bank_transactions').select('id', head).eq('is_ignored', false).or('is_validated.eq.false,article.is.null,article.eq.')),
    (async () => {
      if (!userId) return 0
      const { data, error } = await supabase.from('tasks').select('id, status, due_at, due_date').eq('assignee_id', userId).not('status', 'in', '(done,cancelled,on_hold)')
      return error ? 0 : (data || []).filter(t => isOverdue(t)).length
    })(),
  ])
  return { documents, bank, tasks }
}

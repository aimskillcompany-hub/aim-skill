// Розбиття банківської операції на кілька статей (міграція 110).
// Операція — один рядок bank_transactions (рахунок, дата, сума, контрагент, документи); is_split = true означає,
// що її статті й суми — у bank_transaction_splits. Звіти за статтями розгортають операцію в частини: кожна частина —
// копія операції з власними article / article_id / amount (напрям спільний), тож решта коду рахує їх як звичайні операції.
import { supabase } from './supabase'
import { fetchAllIn } from './fetchAll'

export const SPLIT_FIELDS = 'id, transaction_id, article, article_id, amount, position'

// txs × частини → рядки для звітів. Операції без частин лишаються як є.
export function applySplits(txs = [], parts = []) {
  if (!parts.length) return txs
  const by = {}
  parts.forEach(p => { (by[p.transaction_id] ||= []).push(p) })
  Object.values(by).forEach(list => list.sort((a, b) => (a.position || 0) - (b.position || 0)))
  return txs.flatMap(t => {
    const ps = t.is_split ? by[t.id] : null
    if (!ps?.length) return [t]
    return ps.map(p => ({ ...t, article: p.article, article_id: p.article_id, amount: Number(p.amount), split_id: p.id, split_total: Number(t.amount) }))
  })
}

export async function loadSplits(txIds = []) {
  const ids = [...new Set(txIds)].filter(Boolean)
  if (!ids.length) return []
  return fetchAllIn(() => supabase.from('bank_transaction_splits').select(SPLIT_FIELDS), 'transaction_id', ids)
}

// розгорнути розбиті операції (потрібні поля id і is_split у вибірці)
export async function withSplits(txs = []) {
  const ids = txs.filter(t => t.is_split).map(t => t.id)
  if (!ids.length) return txs
  return applySplits(txs, await loadSplits(ids))
}

// частини до кожної операції списку: r._splits = [{ article, amount, … }] (для показу в «Банку»)
export async function attachSplits(rows = []) {
  const ids = rows.filter(r => r.is_split).map(r => r.id)
  const parts = ids.length ? await loadSplits(ids) : []
  const by = {}
  parts.forEach(p => { (by[p.transaction_id] ||= []).push(p) })
  rows.forEach(r => { r._splits = r.is_split ? (by[r.id] || []).sort((a, b) => (a.position || 0) - (b.position || 0)) : [] })
  return rows
}

// правила за текстом статті (ПФД, позика, «документ не потрібен»), де операцію не можна ділити на рядки
// (прив'язки до документів і зарахування — на всю операцію): article = статті всіх частин через пробіл
export async function withSplitArticles(txs = []) {
  if (!txs.some(t => t.is_split)) return txs
  await attachSplits(txs)
  txs.forEach(t => { if (t.is_split) t.article = articleText(t) })
  return txs
}

// текст статті для правил «документ не потрібен» тощо: стаття операції або статті всіх частин
export const articleText = (r) => r?.is_split ? (r._splits || []).map(p => p.article || '').join(' ') : (r?.article || '')

const round2 = (n) => Math.round(n * 100) / 100

// перевірка форми розбиття: parts = [{ article_id, amount }] (сума — модулем, як вводить користувач)
export function validateSplit(total, parts = []) {
  const abs = round2(Math.abs(Number(total) || 0))
  const filled = parts.map(p => ({ ...p, value: round2(Math.abs(Number(String(p.amount ?? '').replace(',', '.').replace(/\s/g, '')) || 0)) }))
  const sum = round2(filled.reduce((s, p) => s + p.value, 0))
  const rest = round2(abs - sum)
  let error = null
  if (!abs) error = 'Операцію з нульовою сумою не розбивають'
  else if (filled.length < 2) error = 'Потрібно щонайменше дві частини'
  else if (filled.some(p => !p.article_id)) error = 'У кожній частині оберіть статтю'
  else if (filled.some(p => p.value <= 0)) error = 'У кожній частині має бути сума більше нуля'
  else if (Math.abs(rest) >= 0.005) error = rest > 0 ? `Не розподілено ${rest.toFixed(2)} грн` : `Розподілено на ${(-rest).toFixed(2)} грн більше за суму операції`
  return { ok: !error, error, sum, rest, parts: filled.map(p => ({ article_id: p.article_id, amount: p.value })) }
}

export async function splitTransaction(txId, parts) {
  const { error } = await supabase.rpc('split_transaction', { p_tx: txId, p_parts: parts })
  if (error) throw new Error(splitErrorText(error.message))
}

export async function unsplitTransaction(txId, articleId = null) {
  const { error } = await supabase.rpc('unsplit_transaction', { p_tx: txId, p_article_id: articleId })
  if (error) throw new Error(splitErrorText(error.message))
}

export function splitErrorText(msg = '') {
  if (/PERIOD_CLOSED/.test(msg)) return 'Період закрито — розбиття змінити не можна. Спершу відкрийте період.'
  if (/split_transaction|bank_transaction_splits|is_split/.test(msg) && /does not exist|not find|schema cache/i.test(msg))
    return 'Розбиття ще не ввімкнено в базі: потрібно застосувати міграцію 110.'
  const m = msg.match(/SPLIT_[A-Z_]+:\s*(.*)$/)
  return m ? m[1] : msg
}

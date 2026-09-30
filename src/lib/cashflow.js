// Cash Flow (рух грошей) — прямий метод.
// Реальний рух коштів: УСІ неігноровані банк-транзакції (валідовані + ні),
// бо це фактичні гроші (як у getAccountBalances), на відміну від P&L (лише validated).
// Надходження/витрати групуються по статтях; колонки = місяці (рік) або дні (місяць).
import { qc } from './companyScope'
import { periodRange } from './pl'

const MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const monthEnd = (y, m) => new Date(y, m, 0).getDate()

export async function computeCashFlow(year, month) {
  const { from, to } = periodRange(year, month)

  const [{ data: txs }, { data: accs }, { data: prevTxs }] = await Promise.all([
    qc('bank_transactions').select('amount, article, direction, date').eq('is_ignored', false).gte('date', from).lte('date', to),
    qc('accounts').select('id, opening_balance, opening_balance_date'),
    qc('bank_transactions').select('account_id, amount, date').eq('is_ignored', false).lt('date', from),
  ])

  // Залишок на початок періоду = Σ opening_balance + Σ рухів до 'from'
  const accById = Object.fromEntries((accs || []).map(a => [a.id, a]))
  let openingCash = (accs || []).reduce((s, a) => s + (Number(a.opening_balance) || 0), 0)
  ;(prevTxs || []).forEach(t => {
    const acc = accById[t.account_id]
    if (acc?.opening_balance_date && t.date && t.date < acc.opening_balance_date) return
    openingCash += Number(t.amount) || 0
  })

  const cols = month
    ? Array.from({ length: monthEnd(year, month) }, (_, i) => ({ key: String(i + 1), label: String(i + 1) }))
    : Array.from({ length: 12 }, (_, i) => ({ key: String(i + 1), label: MONTHS[i] }))
  const bucketOf = (d) => month ? String(Number(d.slice(8, 10))) : String(Number(d.slice(5, 7)))

  // Надходження (amount ≥ 0) і витрати (amount < 0) по статтях, по колонках
  const inflow = {}, outflow = {}
  const netByCol = {}
  ;(txs || []).forEach(t => {
    const amt = Number(t.amount) || 0
    if (!amt) return
    const b = bucketOf(t.date)
    netByCol[b] = (netByCol[b] || 0) + amt
    const art = (t.article || '').trim() || 'Без статті'
    const tgt = amt >= 0 ? inflow : outflow
    ;(tgt[art] ||= {})[b] = (tgt[art][b] || 0) + Math.abs(amt)
  })

  // Розкласти у рядки + підсумки по статтях і по колонках
  const buildSection = (map) => {
    const rows = Object.entries(map).map(([article, cells]) => ({
      article, cells, total: Object.values(cells).reduce((s, v) => s + v, 0),
    })).sort((a, b) => b.total - a.total)
    const totalByCol = {}
    rows.forEach(r => cols.forEach(c => { if (r.cells[c.key]) totalByCol[c.key] = (totalByCol[c.key] || 0) + r.cells[c.key] }))
    const total = rows.reduce((s, r) => s + r.total, 0)
    return { rows, totalByCol, total }
  }
  const inSec = buildSection(inflow)
  const outSec = buildSection(outflow)

  // Чистий потік і залишок (накопичувальний) по колонках
  const netTotal = cols.reduce((s, c) => s + (netByCol[c.key] || 0), 0)
  let running = openingCash
  const closingByCol = {}
  cols.forEach(c => { running += (netByCol[c.key] || 0); closingByCol[c.key] = running })

  return {
    cols, inflow: inSec, outflow: outSec,
    netByCol, netTotal,
    openingCash, closingCash: openingCash + netTotal, closingByCol,
  }
}

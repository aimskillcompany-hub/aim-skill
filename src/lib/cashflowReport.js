// CashFlow-звіт за рік у розрізі статей і ПРОЕКТІВ (активна компанія).
// Статті «Виручка: товари / ПЗ» і «Закупівля товарів» розкладаються по проектах
// (bank_transactions.project_id → finance_projects). Решта — за статтею.
import { qc } from './companyScope'

export const REVENUE_ART = 'Виручка: товари / ПЗ'
export const PURCHASE_ART = 'Закупівля товарів'
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const emptyMonths = () => Array(12).fill(0)

export async function computeCashflow(year) {
  const from = `${year}-01-01`, to = `${year}-12-31`
  const [{ data: txs }, { data: projects }] = await Promise.all([
    qc('bank_transactions').select('date, amount, article, direction, project_id, is_ignored')
      .eq('is_ignored', false).gte('date', from).lte('date', to),
    qc('finance_projects').select('id, name').then(r => r).catch(() => ({ data: [] })),
  ])
  const projName = {}; (projects || []).forEach(p => projName[p.id] = p.name)

  // key → { label, months[12] }
  const projIncome = {}, projExpense = {}, income = {}, expense = {}
  const ensure = (map, key, label) => (map[key] ||= { key, label, months: emptyMonths() })

  ;(txs || []).forEach(t => {
    const amt = Number(t.amount) || 0
    if (amt === 0 || !t.date) return
    const m = Number(t.date.slice(5, 7)) - 1
    if (m < 0 || m > 11) return
    const art = t.article || 'Без статті'
    if (art === REVENUE_ART) {
      const k = t.project_id || 'none'
      ensure(projIncome, k, t.project_id ? (projName[t.project_id] || 'Проект') : 'Без проекту').months[m] += amt
    } else if (art === PURCHASE_ART) {
      const k = t.project_id || 'none'
      ensure(projExpense, k, t.project_id ? (projName[t.project_id] || 'Проект') : 'Без проекту').months[m] += Math.abs(amt)
    } else if (amt > 0) {
      ensure(income, art, art).months[m] += amt
    } else {
      ensure(expense, art, art).months[m] += Math.abs(amt)
    }
  })

  const finalize = (map) => Object.values(map)
    .map(r => ({ ...r, months: r.months.map(r2), total: r2(r.months.reduce((s, x) => s + x, 0)) }))
    .filter(r => Math.abs(r.total) > 0.5)
    .sort((a, b) => b.total - a.total)

  const sumRows = (rows) => {
    const months = emptyMonths()
    rows.forEach(r => r.months.forEach((v, i) => months[i] += v))
    return { months: months.map(r2), total: r2(months.reduce((s, x) => s + x, 0)) }
  }

  const sections = {
    projIncome: finalize(projIncome),
    income: finalize(income),
    projExpense: finalize(projExpense),
    expense: finalize(expense),
  }
  const totals = {
    projIncome: sumRows(sections.projIncome),
    income: sumRows(sections.income),
    projExpense: sumRows(sections.projExpense),
    expense: sumRows(sections.expense),
  }
  // Підсумкові рядки
  const inflow = sumRows([...sections.projIncome, ...sections.income])
  const outflow = sumRows([...sections.projExpense, ...sections.expense])
  const net = { months: inflow.months.map((v, i) => r2(v - outflow.months[i])), total: r2(inflow.total - outflow.total) }

  return { year, sections, totals, inflow, outflow, net }
}

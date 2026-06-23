// Автоматичний матч документ ↔ банківська транзакція за трьома сигналами:
// контрагент (обов'язково) + сума (±1%) + дата документа (±15 днів).
import { countsAsDebt } from './debts'

export const DATE_TOLERANCE_DAYS = 15

// Напрям транзакції має відповідати напряму документа:
// гроші прийшли (Доходи) → дебіторський документ (клієнт оплачує накладну/рахунок);
// гроші пішли (Витрати) → кредиторський документ (ми платимо постачальнику).
export function dirMatch(txDir, docDir) {
  if (!docDir) return true // напрям документа не задано — не відкидаємо
  if (txDir === 'Доходи') return docDir === 'receivable'
  if (txDir === 'Витрати') return docDir === 'payable'
  return false
}

// Оцінка збігу однієї пари. outstanding — непокрита сума документа.
export function matchScore(tx, doc, outstanding) {
  const txAmt = Math.abs(Number(tx.amount) || 0)
  const out = outstanding != null ? outstanding : Math.abs(Number(doc.amount) || 0)
  const amtDiff = Math.abs(txAmt - out)
  const amountClose = out > 0 && amtDiff <= Math.max(1, txAmt * 0.01) // ±1% або 1 грн
  const docDate = doc.doc_date || doc.created_at
  const daysDiff = docDate && tx.date ? Math.abs((new Date(tx.date) - new Date(docDate)) / 864e5) : 999
  const dateClose = daysDiff <= DATE_TOLERANCE_DAYS
  let score = 0
  if (amountClose) score += 1000
  else if (out > 0 && amtDiff <= txAmt * 0.05) score += 300 // близько (±5%)
  if (dateClose) score += Math.max(0, Math.round(100 - daysDiff * 3))
  if (countsAsDebt(doc.type)) score += 10 // радше накладна/акт, ніж рахунок
  return { score, amountClose, dateClose, daysDiff: Math.round(daysDiff), amtDiff, outstanding: out }
}

// Кандидати для транзакції, відсортовані за збігом (найкращі перші).
export function rankCandidates(tx, docs, coverageByDoc = {}) {
  return (docs || [])
    .filter(d => dirMatch(tx.direction, d.direction))
    .map(d => {
      const out = Math.abs(Number(d.amount) || 0) - (coverageByDoc[d.id] || 0)
      return { doc: d, ...matchScore(tx, d, out) }
    })
    .filter(c => c.outstanding > 0.5)
    .sort((a, b) => b.score - a.score)
}

// Впевнений єдиний збіг (для масової авто-прив'язки): рівно один кандидат зі збігом
// суми І дати. Повертає кандидата або null.
export function confidentMatch(tx, docs, coverageByDoc = {}) {
  const ranked = rankCandidates(tx, docs, coverageByDoc)
  const strong = ranked.filter(c => c.amountClose && c.dateClose)
  return strong.length === 1 ? strong[0] : null
}

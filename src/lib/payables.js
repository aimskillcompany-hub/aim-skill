// Кредиторка (ТЗ редизайну 6.3): кому і скільки винні ми. Дзеркально до дебіторки (lib/receivables):
// борг = прихідна накладна / акт отриманий (direction='payable') − наші оплати, прив'язані до документа,
// з датою ≤ кінця періоду. Строк оплати = дата документа + відстрочка з картки постачальника.
// Передоплати постачальникам (оплачено понад документ) — окремо, це актив.
// Підсумок збігається з «Кредиторкою» в «Балансі» (те саме правило).
import { loadDebtsAsOf, groupReceivables } from './receivables'

const lastDay = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

export function loadPayables(companies, year, month) {
  return loadDebtsAsOf(companies, lastDay(year, month), 'payable')
}
export const loadPayablesAsOf = (companies, asOf) => loadDebtsAsOf(companies, asOf, 'payable')
// групування за постачальником і підсумки — та сама чиста функція, що й для дебіторки
export const groupPayables = groupReceivables

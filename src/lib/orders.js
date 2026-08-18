// Статуси замовлень — єдиний спрощений набір для всіх типів (trade/service/agent).
// Статус — єдиний контрол стану заявки, рухається вручну (випадайка «Статус» у «Деталях»).

export const ORDER_TYPES = { trade: 'Торгівля', service: 'Послуги', agent: 'Агент' }
export const TYPE_COLORS = { trade: '#2563EB', service: '#7C3AED', agent: '#0D9488' }

// Результат замовлення (тендер/конкурс) — задається при архівуванні
export const OUTCOME = {
  won: { label: 'Виграно', icon: 'ti-trophy', color: 'var(--green)', bg: 'var(--green-bg, #e7f7ec)' },
  lost: { label: 'Програно', icon: 'ti-mood-sad', color: 'var(--red)', bg: 'var(--red-bg)' },
}

// Єдиний цикл із 6 статусів
const STAGES = [
  { s: 'new',               label: 'Новий' },
  { s: 'processing',        label: 'В опрацюванні' },
  { s: 'ordering_supplier', label: 'Замовлення у дистрибютора' },
  { s: 'shipped',           label: 'Відвантажено' },
  { s: 'paid',              label: 'Оплачено' },
  { s: 'closed',            label: 'Закрито' },
]
const FLOW = { trade: STAGES, service: STAGES, agent: STAGES }

// Легасі-статуси (старий набір, до застосування міграції 032) → підпис нового набору,
// щоб наявні замовлення показувались читабельно ще до переназначення в БД.
const LEGACY = {
  proposal_sent: 'В опрацюванні', confirmed: 'В опрацюванні', contract_signed: 'В опрацюванні',
  invoiced: 'В опрацюванні', paid_partial: 'В опрацюванні',
  client_transferred: 'В опрацюванні', deal_done: 'В опрацюванні',
  in_transit: 'Замовлення у дистрибютора', ready_to_ship: 'Замовлення у дистрибютора',
  docs_received: 'Відвантажено',
}

export const flowFor = (type) => FLOW[type] || FLOW.trade
export const stepFor = (o) => flowFor(o.type).find(x => x.s === o.status) || flowFor(o.type)[0]
export const statusLabel = (o) => STAGES.find(x => x.s === o.status)?.label || LEGACY[o.status] || stepFor(o).label

// Порядок статусів для Kanban-дошки
export const STATUS_ORDER = ['new', 'processing', 'ordering_supplier', 'shipped', 'paid', 'closed']

// Лейбл статусу без прив'язки до типу (для колонок канбану)
export const labelForStatus = (s) => STAGES.find(x => x.s === s)?.label || LEGACY[s] || s
export const isOpen = (o) => o.status !== 'closed'

// КП без відповіді понад 48 год у статусі «В опрацюванні» → прострочено (підсвітка)
export function proposalOverdue(o, latestSentAt) {
  if (o.status !== 'processing' || !latestSentAt) return false
  const ageH = (Date.now() - new Date(latestSentAt).getTime()) / 36e5
  return ageH > 48
}

// Прострочення оплати по субзамовленнях (payment_due_date минув)
export function paymentOverdue(supplierOrders = []) {
  const today = new Date().toISOString().split('T')[0]
  return supplierOrders.some(s => s.payment_due_date && s.payment_due_date < today && s.status !== 'paid')
}

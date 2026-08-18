// Статуси трьох циклів замовлень. Статус — єдиний контрол стану заявки,
// рухається вручну менеджером (випадайка «Статус» у вкладці «Деталі»).

export const ORDER_TYPES = { trade: 'Торгівля', service: 'Послуги', agent: 'Агент' }
export const TYPE_COLORS = { trade: '#2563EB', service: '#7C3AED', agent: '#0D9488' }

// Результат замовлення (тендер/конкурс) — задається при архівуванні
export const OUTCOME = {
  won: { label: 'Виграно', icon: 'ti-trophy', color: 'var(--green)', bg: 'var(--green-bg, #e7f7ec)' },
  lost: { label: 'Програно', icon: 'ti-mood-sad', color: 'var(--red)', bg: 'var(--red-bg)' },
}

const FLOW = {
  trade: [
    { s: 'new',              label: 'Новий' },
    { s: 'proposal_sent',    label: 'КП надіслано' },
    { s: 'confirmed',        label: 'Підтверджено' },
    { s: 'contract_signed',  label: 'Договір підписано' },
    { s: 'invoiced',         label: 'Рахунок виставлено' },
    { s: 'paid_partial',     label: 'Часткова оплата' },
    { s: 'ordering_supplier',label: 'Замовлення дистриб.' },
    { s: 'in_transit',       label: 'В дорозі' },
    { s: 'ready_to_ship',    label: 'Готово до відправки' },
    { s: 'shipped',          label: 'Відвантажено' },
    { s: 'docs_received',    label: 'Документи отримано' },
    { s: 'closed',           label: 'Закрито' },
  ],
  service: [
    { s: 'new',      label: 'Новий' },
    { s: 'invoiced', label: 'Рахунок виставлено' },
    { s: 'paid',     label: 'Оплачено' },
    { s: 'closed',   label: 'Закрито' },
  ],
  agent: [
    { s: 'new',                label: 'Новий' },
    { s: 'client_transferred', label: 'Клієнт переданий' },
    { s: 'deal_done',          label: 'Угода закрита' },
    { s: 'invoiced',           label: 'Рахунок виставлено' },
    { s: 'closed',             label: 'Закрито' },
  ],
}

export const flowFor = (type) => FLOW[type] || FLOW.trade
export const stepFor = (o) => flowFor(o.type).find(x => x.s === o.status) || flowFor(o.type)[0]
export const statusLabel = (o) => stepFor(o).label

// Канонічний порядок статусів для Kanban-дошки (об'єднання трьох циклів)
export const STATUS_ORDER = [
  'new', 'proposal_sent', 'confirmed', 'contract_signed', 'invoiced',
  'paid_partial', 'paid', 'ordering_supplier', 'in_transit', 'ready_to_ship',
  'shipped', 'docs_received', 'client_transferred', 'deal_done', 'closed',
]

// Лейбл статусу без прив'язки до типу (для колонок канбану)
const ALL_STEPS = [...FLOW.trade, ...FLOW.service, ...FLOW.agent]
export const labelForStatus = (s) => ALL_STEPS.find(x => x.s === s)?.label || s
export const isOpen = (o) => o.status !== 'closed'

// КП без відповіді понад 48 год → прострочено (підсвітка в реєстрі/канбані)
export function proposalOverdue(o, latestSentAt) {
  if (o.status !== 'proposal_sent' || !latestSentAt) return false
  const ageH = (Date.now() - new Date(latestSentAt).getTime()) / 36e5
  return ageH > 48
}

// Прострочення оплати по субзамовленнях (payment_due_date минув)
export function paymentOverdue(supplierOrders = []) {
  const today = new Date().toISOString().split('T')[0]
  return supplierOrders.some(s => s.payment_due_date && s.payment_due_date < today && s.status !== 'paid')
}

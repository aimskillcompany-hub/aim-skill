// Статус-машини трьох циклів замовлень + логіка «наступної дії».
// Статус рухається вручну менеджером кнопкою «Наступна дія» (act:'do'),
// або очікує зовнішньої події (act:'wait'). Переходи строго по порядку.

export const ORDER_TYPES = { trade: 'Торгівля', service: 'Послуги', agent: 'Агент' }
export const TYPE_COLORS = { trade: '#2563EB', service: '#7C3AED', agent: '#0D9488' }

// act: 'do' — потребує дії менеджера; 'wait' — очікування; 'done' — закрито
const FLOW = {
  trade: [
    { s: 'new',              label: 'Новий',                 next: 'Підібрати товар',                act: 'do' },
    { s: 'proposal_sent',    label: 'КП надіслано',          next: 'Чекати відповіді клієнта',       act: 'wait', reminderH: 48 },
    { s: 'confirmed',        label: 'Підтверджено',          next: 'Підписати договір/специфікацію', act: 'do' },
    { s: 'contract_signed',  label: 'Договір підписано',     next: 'Виставити рахунок',              act: 'do' },
    { s: 'invoiced',         label: 'Рахунок виставлено',    next: 'Чекати оплати',                  act: 'wait' },
    { s: 'paid_partial',     label: 'Часткова оплата',       next: 'Отримати залишок оплати',        act: 'do' },
    { s: 'ordering_supplier',label: 'Замовлення дистриб.',   next: 'Замовити у дистрибютора',        act: 'do' },
    { s: 'in_transit',       label: 'В дорозі',              next: 'Чекати товару',                  act: 'wait' },
    { s: 'ready_to_ship',    label: 'Готово до відправки',   next: 'Поставити клієнту',              act: 'do' },
    { s: 'shipped',          label: 'Відвантажено',          next: 'Отримати підписаний документ',   act: 'do' },
    { s: 'docs_received',    label: 'Документи отримано',    next: 'Чекати оплати',                  act: 'wait' },
    { s: 'closed',           label: 'Закрито',               next: '—',                              act: 'done' },
  ],
  service: [
    { s: 'new',      label: 'Новий',              next: 'Виставити рахунок',               act: 'do' },
    { s: 'invoiced', label: 'Рахунок виставлено', next: 'Чекати оплати',                   act: 'wait' },
    { s: 'paid',     label: 'Оплачено',           next: 'Виконати роботи і підписати акт', act: 'do' },
    { s: 'closed',   label: 'Закрито',            next: '—',                               act: 'done' },
  ],
  agent: [
    { s: 'new',                label: 'Новий',            next: 'Передати клієнта партнеру',        act: 'do' },
    { s: 'client_transferred', label: 'Клієнт переданий', next: 'Чекати повідомлення про угоду',    act: 'wait' },
    { s: 'deal_done',          label: 'Угода закрита',    next: 'Виставити рахунок на комісію',     act: 'do' },
    { s: 'invoiced',           label: 'Рахунок виставлено',next: 'Чекати оплати комісії',           act: 'wait' },
    { s: 'closed',             label: 'Закрито',          next: '—',                                act: 'done' },
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
export const nextActionLabel = (o) => stepFor(o).next
export const isOpen = (o) => o.status !== 'closed'
export const needsAction = (o) => stepFor(o).act === 'do'

// Наступний статус по порядку циклу
export function nextStatus(o) {
  const flow = flowFor(o.type)
  const i = flow.findIndex(x => x.s === o.status)
  return i >= 0 && i < flow.length - 1 ? flow[i + 1].s : o.status
}

// КП без відповіді понад 48 год → прострочено (нагадування)
export function proposalOverdue(o, latestSentAt) {
  if (o.status !== 'proposal_sent' || !latestSentAt) return false
  const ageH = (Date.now() - new Date(latestSentAt).getTime()) / 36e5
  return ageH > (stepFor(o).reminderH || 48)
}

// Прострочення оплати по субзамовленнях (payment_due_date минув)
export function paymentOverdue(supplierOrders = []) {
  const today = new Date().toISOString().split('T')[0]
  return supplierOrders.some(s => s.payment_due_date && s.payment_due_date < today && s.status !== 'paid')
}

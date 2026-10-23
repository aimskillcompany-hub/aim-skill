// Мапи статусів → тони StatusPill. Підписи беруться з довідників застосунку (src/lib/orders.js, src/lib/tasks.js),
// тут — лише тон. Правило для замовлень:
//   «Новий» → neutral; етап, де потрібна дія від нас або клієнта → attention; проміжні робочі етапи → progress;
//   фінальний успішний → success; «Програно» / «Скасовано» → danger.
import { labelForStatus, OUTCOME } from '../../lib/orders'
import { STATUS as TASK_STATUS } from '../../lib/tasks'

export const TONES = {
  neutral: { bg: '#f3f4f6', fg: '#374151' },
  progress: { bg: '#e6edf3', fg: '#28486a' },   // приглушений синьо-сірий — не сперечається із зеленим акцентом
  attention: { bg: '#fef3c7', fg: '#92400e' },
  success: { bg: '#e3f4ec', fg: '#0b5e45' },
  danger: { bg: '#fee2e2', fg: '#b91c1c' },
}

// Ключ — код статусу в базі (orders.status); результат архівування — won / lost (orders.outcome)
export const ORDER_STATUS_TONE = {
  new: 'neutral',               // Новий
  tender: 'attention',          // Тендер — у застосунку позначений як етап, що потребує дії (accent)
  processing: 'progress',       // В опрацюванні
  needs_contract: 'attention',  // Потребує договір
  ordering_supplier: 'progress',// Замовлення у дистрибютора
  shipped: 'progress',          // Відвантажено
  needs_payment: 'attention',   // Потребує оплати
  paid: 'success',              // Оплачено (далі ще «Закрито»; див. відкриті питання)
  closed: 'success',            // Закрито
  // легасі-коди до міграції 032 — тон за етапом, на який вони відображаються
  proposal_sent: 'progress', confirmed: 'progress', contract_signed: 'progress', invoiced: 'progress', paid_partial: 'progress',
  client_transferred: 'progress', deal_done: 'progress', in_transit: 'progress', ready_to_ship: 'progress', docs_received: 'progress',
  won: 'success',               // результат: Виконано
  lost: 'danger',               // результат: Програно
}
export const orderStatusLabel = (code) => code === 'won' || code === 'lost' ? OUTCOME[code].label : labelForStatus(code)

// Статуси задач (tasks.status)
export const TASK_STATUS_TONE = {
  new: 'neutral',
  in_progress: 'progress',
  review: 'attention',
  done: 'success',
  on_hold: 'neutral',
  cancelled: 'danger',
}
export const taskStatusLabel = (code) => TASK_STATUS[code]?.label || code

export const STATUS_MAPS = {
  order: { tones: ORDER_STATUS_TONE, label: orderStatusLabel },
  task: { tones: TASK_STATUS_TONE, label: taskStatusLabel },
}

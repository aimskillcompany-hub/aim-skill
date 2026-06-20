// ── Реєстр типів документів ──
// Додати новий тип = додати файл шаблону + один рядок тут
import * as invoice from './invoice'
import * as waybill from './waybill'
import * as serviceAct from './serviceAct'

import * as loanAgreement from './loanAgreement'
import * as supplyAgreement from './supplyAgreement'

export const DOCUMENT_TYPES = [
  { key: 'invoice', label: 'Рахунок на оплату', prefix: 'РФ', icon: 'ti-file-invoice', template: invoice, direction: 'outgoing' },
  { key: 'waybill', label: 'Видаткова накладна', prefix: 'ВН', icon: 'ti-truck-delivery', template: waybill, direction: 'outgoing', stockEffect: 'out' },
  { key: 'serviceAct', label: 'Акт наданих послуг', prefix: 'АКТ', icon: 'ti-file-check', template: serviceAct, direction: 'outgoing' },
  { key: 'incomingWaybill', label: 'Прихідна накладна', prefix: 'ПН', icon: 'ti-package-import', template: waybill, direction: 'incoming', stockEffect: 'in' },
  { key: 'loanAgreement', label: 'Договір фін. допомоги', prefix: 'ДФД', icon: 'ti-cash', template: loanAgreement, direction: 'outgoing', isContract: true },
  { key: 'supplyAgreement', label: 'Договір поставки', prefix: 'ДП', icon: 'ti-truck', template: supplyAgreement, direction: 'outgoing', isContract: true },
]

export function getDocType(key) {
  return DOCUMENT_TYPES.find(t => t.key === key)
}

export function getDocLabel(key) {
  return getDocType(key)?.label || key
}

export const STATUS_LABELS = {
  draft: 'Чернетка',
  sent: 'Відправлено',
  paid: 'Оплачено',
  cancelled: 'Скасовано',
}

export const STATUS_COLORS = {
  draft: { bg: 'var(--surface2)', color: 'var(--text3)' },
  sent: { bg: 'var(--blue-bg)', color: 'var(--blue)' },
  paid: { bg: 'var(--green-bg)', color: 'var(--green)' },
  cancelled: { bg: 'var(--red-bg)', color: 'var(--red)' },
}

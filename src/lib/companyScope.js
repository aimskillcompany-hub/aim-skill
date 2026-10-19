// Активна компанія як module-singleton — щоб lib-модулі (pl, debts, accounts,
// orders, stockService…) і серверні хелпери читали company_id без React-контексту.
// Оновлюється з CompanyProvider (src/lib/company.jsx) при вході й перемиканні.
import { supabase } from './supabase'

// «Грошові» таблиці, що скоупляться за company_id (root-таблиці; дочірні —
// order_items, assembly_items, supplier_order_items, transaction_items — через батька).
export const SCOPED_TABLES = new Set([
  'accounts',
  'bank_transactions',
  'documents',
  'generated_docs',
  'orders',
  'commercial_proposals',
  'supplier_orders',
  'stock_movements',
  'assemblies',
  'product_stock', // в'юха з company_id (міграція 042)
  'period_closings',
  'tasks',
  'emails',
  'plans',
  'notes',
  'finance_projects', // фінрезультат проекту (company_id, міграція 055)
  'loan_allocations', // зарахування повернень ПФД (company_id, міграція 060)
])

export const isScoped = (table) => SCOPED_TABLES.has(table)

// Дві «активні юрособи» (аудит 2026-10-19):
//   _activeCompanyId — вибір КОРИСТУВАЧА (перемикач у шапці); за нею йдуть УСІ записи (withCompany).
//   _reportScope     — тимчасова юрособа звіту по всіх юрособах (Зведений баланс, Дебіторка, Рентабельність):
//                      впливає лише на читання qc(). Раніше звіт перемикав спільну змінну, і нові
//                      транзакції/документи, створені в цей момент в іншому розділі, отримували чужий company_id,
//                      а після звіту перемикач повертався на стару юрособу, навіть якщо користувач її змінив.
let _activeCompanyId = null
let _reportScope = null

export function getActiveCompanyId() {
  return _reportScope || _activeCompanyId
}
export function getUserCompanyId() {
  return _activeCompanyId
}
export function setActiveCompanyId(id) {
  _activeCompanyId = id || null
}
export function setReportScope(id) {
  _reportScope = id || null
}
// Звіти, що перемикають _reportScope, виконуються строго по черзі (один спільний замок на всі модулі)
let _reportLock = Promise.resolve()
export function runExclusive(fn) {
  const wrapped = async () => { try { return await fn() } finally { _reportScope = null } }
  const result = _reportLock.then(wrapped, wrapped)
  _reportLock = result.then(() => {}, () => {})
  return result
}

// Скоуплений SELECT: qc('bank_transactions').select('*').eq(...) →
// авто-додає .eq('company_id', активна) одразу після .select().
// Insert/update/delete проходять без змін (перший виклик не .select → не перехоплюється),
// тож для запису company_id підставляй через withCompany().
// Назва qc (query-company), НЕ q — щоб не колізувати з поширеним локальним `q` (пошук/лічильники).
export function qc(table) {
  const builder = supabase.from(table)
  const id = _reportScope || _activeCompanyId
  if (!id || !isScoped(table)) return builder
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver)
      if (prop === 'select' && typeof orig === 'function') {
        return (...args) => orig.apply(target, args).eq('company_id', id)
      }
      return typeof orig === 'function' ? orig.bind(target) : orig
    },
  })
}

// Підстановка company_id у payload для insert (об'єкт або масив).
// Не перезаписує вже заданий company_id.
export function withCompany(payload) {
  const id = _activeCompanyId
  if (!id) return payload
  if (Array.isArray(payload)) return payload.map(r => ({ company_id: id, ...r }))
  return { company_id: id, ...payload }
}

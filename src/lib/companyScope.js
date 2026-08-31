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
  'period_closings',
  'tasks',
  'emails',
  'plans',
  'notes',
])

export const isScoped = (table) => SCOPED_TABLES.has(table)

let _activeCompanyId = null

export function getActiveCompanyId() {
  return _activeCompanyId
}

export function setActiveCompanyId(id) {
  _activeCompanyId = id || null
}

// Скоуплений SELECT: q('bank_transactions').select('*').eq(...) →
// авто-додає .eq('company_id', активна) одразу після .select().
// Insert/update/delete проходять без змін (перший виклик не .select → не перехоплюється),
// тож для запису company_id підставляй через withCompany().
export function q(table) {
  const builder = supabase.from(table)
  const id = _activeCompanyId
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

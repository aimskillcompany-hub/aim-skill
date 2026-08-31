// Активна компанія як module-singleton — щоб lib-модулі (pl, debts, accounts,
// orders, stockService…) і серверні хелпери читали company_id без React-контексту.
// Оновлюється з CompanyProvider (src/lib/company.jsx) при вході й перемиканні.
//
// Фаза 0: лише зберігання активного id + перелік скоуплених таблиць.
// Авто-фільтрація запитів (q/insertScoped) вмикається у Фазі 1, коли з'являться
// колонки company_id.

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

// «Звіти» (ТЗ редизайну, 5.4; етап 1): одна сторінка з вкладками замість окремих розділів меню.
// На етапі 1 у вкладках — наявні звіти без змін; новий вигляд (плитки з головними цифрами) і
// «Кредиторка» (нова логіка, ТЗ 6.3) — етап 3. Активна вкладка — в адресі (?tab=…).
import { lazy, Suspense } from 'react'
import { useUser } from '../lib/auth'
import { canAccess } from '../lib/permissions'
import { PageHeader, Tabs, useTabParam, EmptyState, TableSkeleton } from '../components/ui'

const ReceivablesReport = lazy(() => import('../components/ReceivablesReport'))
const ProfitabilityReport = lazy(() => import('../components/ProfitabilityReport'))
const AccountantReport = lazy(() => import('./AccountantReport'))

const TABS = [
  { id: 'receivables', label: 'Дебіторка', section: 'receivables' },
  { id: 'payables', label: 'Кредиторка', section: 'receivables' },
  { id: 'profit', label: 'Прибутковість', section: 'profitability' },
  { id: 'accountant', label: 'Для бухгалтера', section: 'accountant' },
]

export default function Reports() {
  const { user } = useUser()
  const tabs = TABS.filter(t => canAccess(user?.role, t.section))
  const [tab, setTab] = useTabParam(tabs[0]?.id || 'receivables', tabs.map(t => t.id))
  return (
    <div>
      <PageHeader title="Звіти" />
      <Tabs ariaLabel="Звіти" idPrefix="reports-tab" tabs={tabs} value={tab} onChange={setTab} />
      <div className="reports-panel" role="tabpanel" aria-labelledby={`reports-tab-${tab}`}>
        <Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
          {tab === 'receivables' && <ReceivablesReport />}
          {tab === 'payables' && (
            <div className="card">
              <EmptyState icon="ti-receipt-2" title="Кредиторка з'явиться на етапі 3"
                text="Тут буде, кому і скільки винні ми: прихідні накладні й акти мінус наші оплати, строк оплати і кнопка «Оплатити»." />
            </div>
          )}
          {tab === 'profit' && <ProfitabilityReport />}
          {tab === 'accountant' && <AccountantReport />}
        </Suspense>
      </div>
    </div>
  )
}

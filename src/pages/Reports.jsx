// «Звіти» (ТЗ редизайну 5.4): одна сторінка з чотирма плитками-вкладками (назва + головна цифра + підпис).
// Цифри на плитках — ті самі розрахунки, що й у звітах: дебіторка / кредиторка станом на сьогодні (правило «Балансу»),
// прибутковість і пакет для бухгалтера — за поточний місяць. Активна вкладка — в адресі (?tab=…).
import { lazy, Suspense, useEffect, useState } from 'react'
import { useUser } from '../lib/auth'
import { useCompany } from '../lib/company'
import { canAccess } from '../lib/permissions'
import { todayKyiv } from '../lib/dates'
import { loadReceivablesAsOf, groupReceivables } from '../lib/receivables'
import { loadPayablesAsOf, groupPayables } from '../lib/payables'
import { computeProfitability } from '../lib/profitability'
import { listOutgoingDocs } from '../lib/accountantReport'
import { formatAmount, formatShort, plural } from '../utils/format'
import { useTabParam, TableSkeleton } from '../components/ui'
import './Reports.css'

const ReceivablesReport = lazy(() => import('../components/ReceivablesReport'))
const PayablesReport = lazy(() => import('../components/PayablesReport'))
const ProfitabilityReport = lazy(() => import('../components/ProfitabilityReport'))
const AccountantReport = lazy(() => import('./AccountantReport'))

const TABS = [
  { id: 'receivables', label: 'Дебіторка', section: 'receivables', icon: 'ti-arrow-down-left' },
  { id: 'payables', label: 'Кредиторка', section: 'receivables', icon: 'ti-arrow-up-right' },
  { id: 'profit', label: 'Прибутковість', section: 'profitability', icon: 'ti-chart-line' },
  { id: 'accountant', label: 'Для бухгалтера', section: 'accountant', icon: 'ti-file-zip' },
]
const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']

// Головні цифри для плиток (лише читання). Помилка одного розрахунку не ламає інші.
function useTileFigures(companies, active) {
  const [f, setF] = useState({})
  useEffect(() => {
    if (!companies?.length) return
    let alive = true
    const set = (k, v) => alive && setF(x => ({ ...x, [k]: v }))
    const today = todayKyiv(), from = today.slice(0, 8) + '01'
    ;(async () => {
      try { const r = groupReceivables((await loadReceivablesAsOf(companies, today)).docs); set('receivables', { value: r.summary.total, sub: `${r.summary.debtors} ${plural(r.summary.debtors, ['боржник', 'боржники', 'боржників'])} · 30+ днів ${formatShort(r.summary.over30)} ₴` }) } catch { set('receivables', { error: true }) }
      try { const r = groupPayables((await loadPayablesAsOf(companies, today)).docs); set('payables', { value: r.summary.total, sub: `${r.summary.debtors} ${plural(r.summary.debtors, ['постачальник', 'постачальники', 'постачальників'])}` }) } catch { set('payables', { error: true }) }
      try {
        const c = active || companies[0]
        const r = await computeProfitability(c.id, c.is_vat_payer !== false, from, today)
        set('profit', { value: r.totals.net, sub: `${MONTHS[Number(today.slice(5, 7)) - 1]}: ${r.totals.count} ${plural(r.totals.count, ['накладна', 'накладні', 'накладних'])}${r.totals.margin != null ? ` · маржа ${(r.totals.margin * 100).toFixed(1).replace('.', ',')}%` : ''}` })
      } catch { set('profit', { error: true }) }
      try {
        const list = await listOutgoingDocs()
        const month = list.filter(d => (d.doc_date || '').slice(0, 7) === today.slice(0, 7))
        set('accountant', { value: month.reduce((s, d) => s + (Number(d.amount) || 0), 0), sub: `${MONTHS[Number(today.slice(5, 7)) - 1]}: ${month.length} ${plural(month.length, ['документ', 'документи', 'документів'])}` })
      } catch { set('accountant', { error: true }) }
    })()
    return () => { alive = false }
  }, [companies, active?.id])
  return f
}

export default function Reports() {
  const { user } = useUser()
  const { companies, active } = useCompany()
  const tabs = TABS.filter(t => canAccess(user?.role, t.section))
  const [tab, setTab] = useTabParam(tabs[0]?.id || 'receivables', tabs.map(t => t.id))
  const fig = useTileFigures(companies, active)
  return (
    <div className="rpt-page">
      <div className="rpt-head">
        <h1 className="rpt-h1">Звіти</h1>
        <p className="rpt-sub">Дебіторка й кредиторка — станом на сьогодні; прибутковість і пакет для бухгалтера — за поточний місяць</p>
      </div>
      <div className="rpt-tiles" role="tablist" aria-label="Звіти">
        {tabs.map(t => {
          const x = fig[t.id]
          return (
            <button key={t.id} id={`rpt-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls="rpt-panel" className="rpt-tile" onClick={() => setTab(t.id)}>
              <span className="rpt-tile-name"><i className={`ti ${t.icon}`} aria-hidden="true" />{t.label}</span>
              <b className={`rpt-tile-value${x?.value < 0 ? ' is-neg' : ''}`}>{!x ? '…' : x.error ? '—' : `${formatAmount(x.value, { decimals: 0 })} ₴`}</b>
              <span className="rpt-tile-sub">{x?.error ? 'не вдалося порахувати' : x?.sub || ' '}</span>
            </button>
          )
        })}
      </div>
      <div id="rpt-panel" className="reports-panel" role="tabpanel" aria-labelledby={`rpt-tab-${tab}`}>
        <Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
          {tab === 'receivables' && <ReceivablesReport />}
          {tab === 'payables' && <PayablesReport />}
          {tab === 'profit' && <ProfitabilityReport />}
          {tab === 'accountant' && <AccountantReport />}
        </Suspense>
      </div>
    </div>
  )
}

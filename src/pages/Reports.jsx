// «Звіти» (ТЗ редизайну 5.4): одна сторінка з чотирма плитками-вкладками (назва + головна цифра + підпис).
// Цифри на плитках — ті самі розрахунки, що й у звітах: дебіторка / кредиторка станом на сьогодні (правило «Балансу»),
// прибутковість і пакет для бухгалтера — за поточний місяць. Активна вкладка — в адресі (?tab=…).
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useUser } from '../lib/auth'
import { useCompany } from '../lib/company'
import { canAccess } from '../lib/permissions'
import { todayKyiv } from '../lib/dates'
import { loadReceivablesAsOf, groupReceivables } from '../lib/receivables'
import { loadPayablesAsOf, groupPayables } from '../lib/payables'
import { computeProfitability } from '../lib/profitability'
import { listOutgoingDocs } from '../lib/accountantReport'
import { formatAmount, formatShort, plural } from '../utils/format'
import { useTabParam, TableSkeleton, Button, PeriodMenu, InfoTip } from '../components/ui'
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
        // макет Reports: на плитці — кількість документів, сума — підписом
        set('accountant', { value: month.length, text: `${month.length} ${plural(month.length, ['документ', 'документи', 'документів'])}`, sub: `${MONTHS[Number(today.slice(5, 7)) - 1]}: на ${formatAmount(month.reduce((s, d) => s + (Number(d.amount) || 0), 0), { decimals: 0 })} ₴` })
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
  const [showGroup, setShowGroup] = useState(true)   // ТЗ 6.4: операції всередині групи (типово показуємо)
  const [tab, setTab] = useTabParam(tabs[0]?.id || 'receivables', tabs.map(t => t.id))
  const fig = useTileFigures(companies, active)
  // ТЗ 5.4: спільні для всіх вкладок — період, юрособа, експорт Excel / PDF
  const now = new Date()
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [scope, setScope] = useState('all')
  const [exp, setExp] = useState(null)
  const registerExport = useCallback((x) => setExp(() => x), [])
  useEffect(() => { setExp(null) }, [tab])
  const ctl = { year: period.year, month: period.month, scope, registerExport }
  return (
    <div className="rpt-page">
      <div className="rpt-head rpt-head-row">
        <div>
          <h1 className="rpt-h1">Звіти<InfoTip label="Звіти">Хто нам винен, кому винні ми, на чому заробили, і пакет документів для бухгалтера.</InfoTip></h1>
        </div>
        <div className="rpt-head-acts">
          <PeriodMenu year={period.year} month={period.month} allowYear={tab === 'profit'} onChange={p => setPeriod({ year: p.year, month: p.month || (tab === 'profit' ? 0 : now.getMonth() + 1) })} />
          <Button variant="secondary" icon="ti-file-spreadsheet" disabled={!exp?.xlsx} onClick={() => exp?.xlsx?.()} aria-label="Excel" className="rpt-exp"><span className="rpt-exp-t">Excel</span></Button>
          <Button variant="primary" icon="ti-file-download" disabled={!exp?.pdf} onClick={() => exp?.pdf?.()} aria-label="PDF" className="rpt-exp"><span className="rpt-exp-t">PDF</span></Button>
        </div>
      </div>
      <div className="rpt-tiles" role="tablist" aria-label="Звіти">
        {tabs.map(t => {
          const x = fig[t.id]
          return (
            <button key={t.id} id={`rpt-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls="rpt-panel" className="rpt-tile" onClick={() => setTab(t.id)}>
              <span className="rpt-tile-name"><i className={`ti ${t.icon}`} aria-hidden="true" />{t.label}</span>
              <b className={`rpt-tile-value${x?.value < 0 ? ' is-neg' : ''}`}>{!x ? '…' : x.error ? '—' : x.text || `${formatAmount(x.value, { decimals: 0 })} ₴`}</b>
              <span className="rpt-tile-sub">{x?.error ? 'не вдалося порахувати' : x?.sub || ' '}</span>
            </button>
          )
        })}
      </div>
      <div id="rpt-panel" className="reports-panel" role="tabpanel" aria-labelledby={`rpt-tab-${tab}`}>
        <Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
          {tab !== 'accountant' && (
            <div className="rpt-scope">
              {(companies || []).length > 1 && <div className="rpt-cos" role="group" aria-label="Юрособа"><span>Юрособа</span>
                {[{ id: 'all', short_name: 'Усі' }, ...companies].map(c => <button key={c.id} type="button" aria-pressed={scope === c.id} onClick={() => setScope(c.id)}>{c.short_name || c.name}</button>)}</div>}
              <label className="rpt-groupchk" title="Вимкніть, щоб прибрати продажі й борги між нашими компаніями (позначені «група»)">
                <input type="checkbox" checked={showGroup} onChange={e => setShowGroup(e.target.checked)} />Показувати операції всередині групи</label>
            </div>
          )}
          {tab === 'receivables' && <ReceivablesReport showGroup={showGroup} ctl={ctl} />}
          {tab === 'payables' && <PayablesReport showGroup={showGroup} ctl={ctl} />}
          {tab === 'profit' && <ProfitabilityReport showGroup={showGroup} ctl={ctl} />}
          {tab === 'accountant' && <AccountantReport ctl={ctl} />}
        </Suspense>
      </div>
    </div>
  )
}

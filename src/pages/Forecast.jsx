import { useCallback, useState } from 'react'
import ForecastBalance from '../components/ForecastBalance'
import { useNewUi } from '../lib/uiPrefs'
import { Tabs, useTabParam, InfoTip, Segmented } from '../components/ui'
import ForecastAccuracy from '../components/ForecastAccuracy'
import PayCalendar, { usePayCalendarCo } from '../components/PayCalendar'
import { useCompany } from '../lib/company'
import { plural } from '../utils/format'
import './Reports.css'

// Окремий розділ «Прогноз» — звіт із замовлень (позначених «в прогноз»): план − факт = залишок.
// Проєкція показується також на балансі в розділі «Інвестору».
export default function Forecast() {
  const newUi = useNewUi()
  if (newUi) return <ForecastNewPage />
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ti ti-trending-up" style={{ fontSize: 22, color: '#2563EB' }} />
        <h1 style={{ margin: 0 }}>Прогноз</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
        Майбутні надходження і витрати по угодах у роботі — рахуються із самих замовлень (позначених <i className="ti ti-trending-up" style={{ color: '#2563EB' }} /> «в прогноз»):
        план з позицій мінус уже оплачене. Дати — з «Графіка платежів» у замовленні. Проєкція відображається на балансі (Інвестору → Зведений баланс).
      </p>
      <ForecastBalance />
    </div>
  )
}

// Новий інтерфейс (ТЗ 5.3, 04): вкладки «Угоди в роботі» · «Платіжний календар» · «Точність прогнозу» (в адресі ?tab=…)
const MS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру']
const dS = (s, y) => { const [yy, m, d] = String(s).split('-').map(Number); return `${d} ${MS[m - 1]}${y ? ' ' + yy : ''}` }
function ForecastNewPage() {
  const [tab, setTab] = useTabParam('deals', ['deals', 'calendar', 'accuracy'])
  const [co, setCo] = usePayCalendarCo()
  const { companies } = useCompany()
  const [meta, setMeta] = useState(null)
  const onMeta = useCallback((m) => setMeta(m), [])
  const cal = tab === 'calendar'
  return (
    <div className="rpt-page">
      <div className={cal ? 'pc-page-h' : undefined}>
        <div>
          <h1 className="rpt-h1">Прогноз<InfoTip label="Прогноз">{tab === 'accuracy'
            ? <>Що планували при позначці «в прогноз» і що вийшло після закриття замовлення: план проти факту з банку й складу.</>
            : cal ? <>Рядки — з «Графіка платежів» замовлень «в прогнозі»: план мінус уже оплачене. Прострочене переноситься на сьогодні.<br /><b>Старт</b> — гроші на рахунках на сьогодні.<br /><b>Залишок</b> рахується по днях: залишок на початок дня + усі рухи дня.</>
            : <>Звіт із замовлень «в прогнозі». Змінюється в самому замовленні.<br /><b>Сума</b> — план з позицій мінус уже оплачене.<br /><b>Дата</b> — з «Графіка платежів» у замовленні.<br />Підсумок іде в Зведений баланс групи.</>}</InfoTip>
            {!cal && <span className="fcn-badge"><i className="ti ti-lock" aria-hidden="true" />тільки перегляд</span>}</h1>
          {cal && meta && <p className="pc-sub">{dS(meta.from)} — {dS(meta.to, meta.to.slice(0, 4) !== meta.from.slice(0, 4))} · {meta.orders} {plural(meta.orders, ['замовлення', 'замовлення', 'замовлень'])}</p>}
        </div>
        {cal && (companies || []).length > 1 && <Segmented ariaLabel="Юрособа" value={co} onChange={setCo}
          options={[{ value: 'all', label: 'Уся група' }, ...companies.map(c => ({ value: c.id, label: c.short_name || c.name }))]} />}
      </div>
      <Tabs ariaLabel="Розділи прогнозу" idPrefix="fc" value={tab} onChange={setTab}
        tabs={[{ id: 'deals', label: 'Угоди в роботі' }, { id: 'calendar', label: 'Платіжний календар' }, { id: 'accuracy', label: 'Точність прогнозу' }]} />
      {tab === 'deals' ? <ForecastBalance /> : cal ? <PayCalendar co={co} onMeta={onMeta} /> : <ForecastAccuracy />}
    </div>
  )
}

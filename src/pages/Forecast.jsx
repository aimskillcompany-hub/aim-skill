import ForecastBalance from '../components/ForecastBalance'
import { useNewUi } from '../lib/uiPrefs'
import { Tabs, useTabParam } from '../components/ui'
import ForecastAccuracy from '../components/ForecastAccuracy'
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

// Новий інтерфейс (ТЗ 5.3): вкладки «Угоди в роботі» · «Точність прогнозу» (в адресі ?tab=…)
function ForecastNewPage() {
  const [tab, setTab] = useTabParam('deals', ['deals', 'accuracy'])
  return (
    <div className="rpt-page">
      <div>
        <h1 className="rpt-h1">Прогноз <span className="fcn-badge"><i className="ti ti-lock" aria-hidden="true" />Звіт · тільки перегляд</span></h1>
        <p className="rpt-sub">{tab === 'accuracy'
          ? 'Наскільки справдився прогноз у закритих замовленнях: план на момент позначки «в прогноз» проти факту з банку й складу.'
          : 'Цифри беруться із замовлень з позначкою «в прогноз». Щоб змінити прогноз, змініть замовлення.'}</p>
      </div>
      <Tabs ariaLabel="Розділи прогнозу" idPrefix="fc" value={tab} onChange={setTab}
        tabs={[{ id: 'deals', label: 'Угоди в роботі', icon: 'ti-trending-up' }, { id: 'accuracy', label: 'Точність прогнозу', icon: 'ti-target-arrow' }]} />
      {tab === 'deals' ? <ForecastBalance /> : <ForecastAccuracy />}
    </div>
  )
}

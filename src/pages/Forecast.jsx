import ForecastBalance from '../components/ForecastBalance'
import { useNewUi } from '../lib/uiPrefs'
import './Reports.css'

// Окремий розділ «Прогноз» — звіт із замовлень (позначених «в прогноз»): план − факт = залишок.
// Проєкція показується також на балансі в розділі «Інвестору».
export default function Forecast() {
  const newUi = useNewUi()
  if (newUi) return (
    <div className="rpt-page">
      <div>
        <h1 className="rpt-h1">Прогноз <span className="fcn-badge"><i className="ti ti-lock" aria-hidden="true" />Звіт · тільки перегляд</span></h1>
        <p className="rpt-sub">Цифри беруться із замовлень з позначкою «в прогноз». Щоб змінити прогноз, змініть замовлення.</p>
      </div>
      <ForecastBalance />
    </div>
  )
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

import ForecastBalance from '../components/ForecastBalance'

// Окремий розділ «Прогноз» — ведення прогнозних надходжень/витрат по замовленнях
// (позначених «в прогноз»). Проєкція показується також на балансі в розділі «Інвестору».
export default function Forecast() {
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ti ti-trending-up" style={{ fontSize: 22, color: '#2563EB' }} />
        <h1 style={{ margin: 0 }}>Прогноз</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
        Майбутні надходження і витрати по угодах у роботі. Познач замовлення <i className="ti ti-trending-up" style={{ color: '#2563EB' }} /> «в прогноз»
        у реєстрі <b>Замовлення</b>, потім унеси тут очікувані суми й дати. Проєкція відображається на балансі (Інвестору → Зведений баланс).
      </p>
      <ForecastBalance />
    </div>
  )
}

import { useState } from 'react'
import OwnerReport from '../components/OwnerReport'
import ConsolidatedBalance from '../components/ConsolidatedBalance'
import MeetingMinutes from '../components/MeetingMinutes'

// Розділ «Інвестору»: (1) по-замовленнєвий прибуток/агентські по всіх компаніях;
// (2) зведений баланс — консолідація балансів усіх юросіб; (3) протоколи нарад.
const TABS = [
  { id: 'report', label: 'Прибуток / агентські', icon: 'ti-report-money' },
  { id: 'balance', label: 'Зведений баланс', icon: 'ti-scale' },
  { id: 'minutes', label: 'Протокол наради', icon: 'ti-clipboard-text' },
]

export default function Investor() {
  const [tab, setTab] = useState('report')
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ti ti-diamond" style={{ fontSize: 24, color: '#7C3AED' }} />
        <h1 style={{ margin: 0 }}>Інвестору</h1>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
            borderBottom: tab === t.id ? '2px solid #7C3AED' : '2px solid transparent',
            color: tab === t.id ? '#7C3AED' : 'var(--text2)', fontWeight: tab === t.id ? 600 : 400,
          }}><i className={`ti ${t.icon}`} style={{ marginRight: 6 }} />{t.label}</button>
        ))}
      </div>

      {tab === 'report' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
            Розрахунок прибутку та агентських по всіх юрособах. Враховуються лише замовлення з відміткою
            <b style={{ color: '#7C3AED' }}> «Інвестор» </b>
            (позначаються в реєстрі замовлень або в картці).
          </p>
          <OwnerReport />
        </>
      )}
      {tab === 'balance' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
            Консолідований баланс усіх юросіб системи — повна картина бізнесу: активи, зобов'язання і власний капітал разом.
            Унизу — проєкція «Прогноз» (вноситься в окремому розділі «Прогноз»).
          </p>
          <ConsolidatedBalance />
        </>
      )}
      {tab === 'minutes' && <MeetingMinutes />}
    </div>
  )
}

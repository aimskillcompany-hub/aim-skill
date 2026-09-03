import OwnerReport from '../components/OwnerReport'

// Розділ «Інвестору» — по-замовленнєвий розрахунок прибутку/агентських по всіх компаніях.
// У розрахунок потрапляють лише замовлення з відміткою «врахувати в розрахунку інвестора».
export default function Investor() {
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ti ti-diamond" style={{ fontSize: 24, color: '#7C3AED' }} />
        <h1 style={{ margin: 0 }}>Інвестору</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
        Розрахунок прибутку та агентських по всіх юрособах. Враховуються лише замовлення з відміткою
        <b style={{ color: '#7C3AED' }}> «Інвестор» </b>
        (позначаються в реєстрі замовлень або в картці).
      </p>
      <OwnerReport />
    </div>
  )
}

import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'

// Навігація per ТЗ 5.1 — 8 розділів
const NAV = [
  { to: '/orders',      label: 'Замовлення',   icon: 'ti-shopping-cart',  section: 'Облік' },
  { to: '/contractors', label: 'Контрагенти',  icon: 'ti-users' },
  { to: '/bank',        label: 'Банк / Каса',  icon: 'ti-building-bank' },
  { to: '/inventory',   label: 'Склад',        icon: 'ti-package' },
  { to: '/documents',   label: 'Документи',    icon: 'ti-files' },
  { to: '/analytics',   label: 'Аналітика',    icon: 'ti-chart-dots-3',   section: 'Аналіз' },
  { to: '/budget',      label: 'Бюджет',       icon: 'ti-calendar-stats' },
  { to: '/settings',    label: 'Налаштування', icon: 'ti-settings',       section: 'Система' },
]

const MOBILE_NAV = [
  { to: '/orders',      label: 'Замовлення', icon: 'ti-shopping-cart', primary: true },
  { to: '/contractors', label: 'Клієнти',    icon: 'ti-users' },
  { to: '/bank',        label: 'Банк',       icon: 'ti-building-bank' },
  { to: '/inventory',   label: 'Склад',      icon: 'ti-package' },
  { to: '/analytics',   label: 'Аналітика',  icon: 'ti-chart-dots-3' },
]

const AimLogo = ({ size = 18 }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <div style={{ fontFamily: "'Arial Black',sans-serif", fontWeight: 900, fontSize: size, lineHeight: 1.1, letterSpacing: '-0.5px' }}>
      <span style={{ color: '#000' }}>A</span><span style={{ color: '#16A34A' }}>i</span><span style={{ color: '#000' }}>m</span><br />
      <span style={{ color: '#000' }}>Sk</span><span style={{ color: '#16A34A' }}>i</span><span style={{ color: '#000' }}>ll.</span>
    </div>
    <div style={{ fontSize: 7, color: 'var(--text2)', letterSpacing: '0.15em', marginTop: 3 }}>ITSOLUTION</div>
  </div>
)

export default function Layout() {
  const { user } = useUser()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const role = user?.role || 'viewer'
  const handleLogout = () => supabase.auth.signOut()
  const close = () => setSidebarOpen(false)

  const NavItems = () => (
    <nav className="sidebar-nav">
      {NAV.map((item, i) => (
        <div key={item.to}>
          {item.section && item.section !== NAV[i - 1]?.section && (
            <div className="nav-section">{item.section}</div>
          )}
          <NavLink
            to={item.to}
            onClick={close}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <i className={`ti ${item.icon}`} aria-hidden="true" />
            {item.label}
          </NavLink>
        </div>
      ))}
    </nav>
  )

  const Footer = () => (
    <div className="sidebar-footer">
      <div className="ellip" title={user?.email} style={{ marginBottom: 6, color: 'var(--text2)', fontSize: 13 }}>{user?.email}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 500 }}>{role}</div>
      <span style={{ cursor: 'pointer', color: 'var(--text2)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' }} onClick={handleLogout}>
        <i className="ti ti-logout" style={{ fontSize: 16 }} />Вийти
      </span>
    </div>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo"><AimLogo size={18} /></div>
        <NavItems />
        <Footer />
      </aside>

      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 300, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn .2s ease' }} onClick={close}>
          <aside style={{ width: 280, height: '100%', background: 'var(--surface)', display: 'flex', flexDirection: 'column', animation: 'slideInLeft .25s cubic-bezier(.22,.68,0,1)', borderRight: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div className="sidebar-logo" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <AimLogo size={16} />
              <button onClick={close} aria-label="Закрити" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 16, cursor: 'pointer', width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ti ti-x" />
              </button>
            </div>
            <NavItems />
            <Footer />
          </aside>
        </div>
      )}

      <main className="main">
        <div className="mobile-topbar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Меню">
            <i className="ti ti-menu-2" />
          </button>
          <AimLogo size={14} />
        </div>

        <div className="page-inner"><Outlet /></div>

        <nav className="mobile-nav">
          {MOBILE_NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''} ${item.primary ? 'primary' : ''}`}
            >
              <i className={`ti ${item.icon} mobile-nav-icon`} aria-hidden="true" />
              <span className="mobile-nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </main>
      <style>{`@keyframes slideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
    </div>
  )
}

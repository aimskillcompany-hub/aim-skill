import { useState } from 'react'
import { supabase } from '../lib/supabase'


const NAV = [
  { id: 'dashboard', label: 'Дашборд',      icon: 'ti-layout-dashboard', section: 'Огляд' },
  { id: 'add',       label: 'Додати',        icon: 'ti-upload',            section: 'Введення' },
  { id: 'batch',     label: 'Масове завант.', icon: 'ti-files',             section: null },
  { id: 'registry',  label: 'Реєстр',        icon: 'ti-list-details',      section: null },
  { id: 'bank',      label: 'Банк / Звірка', icon: 'ti-building-bank',     section: null },
  { id: 'cash',      label: 'Каса',          icon: 'ti-cash',              section: null },
  { id: 'contractors', label: 'Контрагенти', icon: 'ti-users',             section: 'Облік' },
  { id: 'projects',  label: 'Проєкти',       icon: 'ti-briefcase',         section: null },
  { id: 'inventory', label: 'Склад',         icon: 'ti-package',           section: null },
  { id: 'reports',   label: 'Звіти P&L',     icon: 'ti-chart-bar',         section: null },
  { id: 'planning',  label: 'Планування',    icon: 'ti-calendar-stats',    section: null },
  { id: 'settings',  label: 'Налаштування',  icon: 'ti-settings',          section: 'Адмін' },
]

const MOBILE_NAV = [
  { id: 'dashboard', label: 'Дашборд', icon: 'ti-layout-dashboard' },
  { id: 'add',       label: 'Додати',  icon: 'ti-upload', primary: true },
  { id: 'registry',  label: 'Реєстр', icon: 'ti-list-details' },
  { id: 'cash',      label: 'Каса',   icon: 'ti-cash' },
  { id: 'bank',      label: 'Банк',   icon: 'ti-building-bank' },
]

export default function Layout({ page, onPage, user, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const role = user?.role || 'viewer'

  const visibleNav = NAV.filter(item => {
    if (item.id === 'settings' && role !== 'admin') return false
    return true
  })

  const navigate = (id) => { onPage(id); setSidebarOpen(false) }
  const handleLogout = async () => { await supabase.auth.signOut() }

  const AimLogo = ({ size = 18 }) => (
    <div style={{ display:'flex', flexDirection:'column' }}>
      <div style={{ fontFamily:"'Arial Black',sans-serif", fontWeight:900, fontSize:size, lineHeight:1.1, letterSpacing:'-0.5px' }}>
        <span style={{ color:'#000' }}>A</span><span style={{ color:'#16A34A' }}>i</span><span style={{ color:'#000' }}>m</span><br/>
        <span style={{ color:'#000' }}>Sk</span><span style={{ color:'#16A34A' }}>i</span><span style={{ color:'#000' }}>ll.</span>
      </div>
      <div style={{ fontSize:7, color:'var(--text2)', letterSpacing:'0.15em', marginTop:3 }}>ITSOLUTION</div>
    </div>
  )

  const LogoBlock = () => (
    <div className="sidebar-logo">
      <AimLogo size={18} />
    </div>
  )

  const SidebarContent = () => (
    <>
      <nav className="sidebar-nav">
        {visibleNav.map((item, i) => {
          const prev = i > 0 ? visibleNav[i - 1] : null
          const showSection = item.section && item.section !== prev?.section
          return (
            <div key={item.id}>
              {showSection && <div className="nav-section">{item.section}</div>}
              <div className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
                <i className={`ti ${item.icon}`} aria-hidden="true" />
                {item.label}
              </div>
            </div>
          )
        })}
      </nav>
      <div className="sidebar-footer">
        <div style={{ marginBottom: 6, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{user?.email}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 500 }}>{role}</div>
        <span style={{ cursor: 'pointer', color: 'var(--text2)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' }} onClick={handleLogout}>
          <i className="ti ti-logout" style={{ fontSize: 16 }} />Вийти
        </span>
      </div>
    </>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <LogoBlock />
        <SidebarContent />
      </aside>

      {sidebarOpen && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.3)',zIndex:300,backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',animation:'fadeIn .2s ease' }} onClick={() => setSidebarOpen(false)}>
          <aside style={{ width:280,height:'100%',background:'var(--surface)',display:'flex',flexDirection:'column',animation:'slideInLeft .25s cubic-bezier(.22,.68,0,1)',borderRight:'1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div className="sidebar-logo" style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
              <AimLogo size={16} />
              <button onClick={() => setSidebarOpen(false)} style={{ background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text2)',fontSize:16,cursor:'pointer',width:36,height:36,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center' }}>
                <i className="ti ti-x" />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}

      <main className="main">
        <div className="mobile-topbar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
            <i className="ti ti-menu-2" />
          </button>
          <AimLogo size={14} />
        </div>

        <div className="page-inner">{children}</div>

        <nav className="mobile-nav">
          {MOBILE_NAV.map(item => (
            <button
              key={item.id}
              className={`mobile-nav-item ${page === item.id ? 'active' : ''} ${item.primary ? 'primary' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <i className={`ti ${item.icon} mobile-nav-icon`} aria-hidden="true" />
              <span className="mobile-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </main>
      <style>{`@keyframes slideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
    </div>
  )
}

// Каркас нового інтерфейсу (ТЗ редизайну, розділ 3; макети Sidebar / SidebarMini / MoreMobile).
// Показується лише з прапорцем «Новий інтерфейс»; інакше — старий Layout.
//   ≥ 1280 — меню за вибором користувача (типово розгорнуте, 248 px; згорнуте — 72 px)
//   1024–1279 — згорнуте автоматично
//   768–1023 — меню ховається, відкривається шторкою зліва
//   < 768 — нижня плаваюча панель + екран «Ще»
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { useCompany } from '../lib/company'
import { canAccess, ROLE_LABELS } from '../lib/permissions'
import { loadBadges } from '../lib/badges'
import { readCollapsed, saveUiPrefs, writeCollapsedLocal } from '../lib/uiPrefs'
import QuickTaskFab from './QuickTaskFab'
import NewUiToggle from './NewUiToggle'
import { Menu } from './ui'
import '../styles/shell.css'

// Склад меню — ТЗ, розділ 3. desc — для екрана «Ще».
export const NAV_GROUPS = [
  { title: 'Облік', items: [
    { to: '/orders', section: 'orders', label: 'Замовлення', icon: 'ti-clipboard-list', desc: 'реєстр і картки замовлень' },
    { to: '/tasks', section: 'tasks', label: 'Задачі', icon: 'ti-square-check', badge: 'tasks', desc: 'мої та командні задачі' },
    { to: '/contractors', section: 'contractors', label: 'Контрагенти', icon: 'ti-users', desc: 'клієнти й постачальники' },
    { to: '/portals', section: 'contractors', label: 'Портали постачальників', icon: 'ti-key', desc: 'входи на B2B-портали дистриб’юторів' },
    { to: '/bank', section: 'bank', label: 'Банк / Каса', icon: 'ti-building-bank', badge: 'bank', desc: 'рахунки й операції' },
    { to: '/inventory', section: 'inventory', label: 'Склад', icon: 'ti-box', desc: 'склад і картки товарів' },
    { to: '/prices', section: 'prices', label: 'Прайси', icon: 'ti-tag', desc: 'ціни постачальників' },
    { to: '/documents', section: 'documents', label: 'Документи', icon: 'ti-file-text', badge: 'documents', desc: 'накладні, акти, розпізнавання' },
  ] },
  { title: 'Аналіз', items: [
    { to: '/analytics', section: 'analytics', label: 'Аналітика', icon: 'ti-chart-bar', desc: 'Cash Flow, P&L, баланс, маржа' },
    { to: '/investor', section: 'investor', label: 'Інвестору', icon: 'ti-diamond', desc: 'зведений баланс, протоколи нарад' },
    { to: '/forecast', section: 'forecast', label: 'Прогноз', icon: 'ti-trending-up', desc: 'платіжний календар, угоди в роботі, точність' },
    { to: '/reports', section: 'reports', label: 'Звіти', icon: 'ti-report-analytics', desc: 'дебіторка, кредиторка, прибутковість' },
    { to: '/finance', section: 'finance', label: 'Фінрезультат проєкту', icon: 'ti-chart-pie', desc: 'результат по проєктах' },
    { to: '/loans', section: 'loans', label: 'Поворотна фін. допомога', icon: 'ti-database', desc: 'позики отримані й видані' },
  ] },
  { title: 'Сервіс', items: [
    { to: '/period-close', section: 'period-close', label: 'Закриття періоду', icon: 'ti-lock', desc: 'перевірки й закриття місяця' },
    { to: '/settings', section: 'settings', label: 'Налаштування', icon: 'ti-settings', desc: 'компанії, статті, рахунки, доступи' },
  ] },
]

// Нижня панель телефона: Замовлення · Задачі · Клієнти · Банк · Ще
const BOTTOM = [
  { to: '/orders', section: 'orders', label: 'Замовлення', icon: 'ti-clipboard-list' },
  { to: '/tasks', section: 'tasks', label: 'Задачі', icon: 'ti-square-check', badge: 'tasks' },
  { to: '/contractors', section: 'contractors', label: 'Клієнти', icon: 'ti-users' },
  { to: '/bank', section: 'bank', label: 'Банк', icon: 'ti-building-bank', badge: 'bank' },
]

// Ініціали: «ТОВ «Ейм Скіл»» → «ЕС», «Дмитро Редько» → «ДР» (організаційно-правова форма не враховується)
const FORMS = /^(тов|тзов|фоп|пп|прат|ат|кнп|дп)$/i
export const initials = (s) => (s || '').replace(/[«»"'.,@]/g, ' ').split(/\s+/).filter(w => w && !FORMS.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·'
const companyName = (c) => c?.short_name || c?.name || ''

function useMedia(query) {
  const get = () => typeof window !== 'undefined' && window.matchMedia?.(query).matches
  const [m, setM] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return m
}

// Лічильники: при завантаженні, зміні маршруту / юрособи, поверненні у вкладку і щохвилини
function useBadges(userId, activeId, pathname) {
  const [b, setB] = useState({ documents: 0, bank: 0, tasks: 0 })
  const refresh = useCallback(() => { loadBadges(userId).then(setB).catch(() => {}) }, [userId, activeId])
  useEffect(() => { refresh() }, [refresh, pathname])
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState !== 'hidden') refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const t = setInterval(refresh, 60000)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); clearInterval(t) }
  }, [refresh])
  return b
}

export function CompanyPicker({ collapsed = false, onPicked }) {
  const { companies, active, setActiveCompany } = useCompany()
  if (!companies.length) return null
  const idx = Math.max(0, companies.findIndex(c => c.id === active?.id))
  const sub = companies.length > 1 ? `${idx + 1} з ${companies.length} юросіб групи` : 'юрособа'
  const card = (
    <button type="button" className={`shell-company${collapsed ? ' is-mini' : ''}`} aria-label={`Юрособа: ${companyName(active)}. Змінити`} title={collapsed ? companyName(active) : undefined}>
      <span className="shell-avatar is-brand" aria-hidden="true">{initials(companyName(active))}</span>
      {!collapsed && <span className="shell-company-text"><span className="shell-company-name">{companyName(active)}</span><span className="shell-company-sub">{sub}</span></span>}
      {!collapsed && companies.length > 1 && <i className="ti ti-selector" aria-hidden="true" />}
    </button>
  )
  if (companies.length < 2) return card
  return <Menu align="left" trigger={card} items={companies.map(c => ({
    label: (c.id === active?.id ? '✓ ' : '') + companyName(c), onClick: () => { setActiveCompany(c.id); onPicked?.() },
  }))} />
}

export default function AppShell() {
  const { user } = useUser()
  const { activeId } = useCompany()
  const { pathname } = useLocation()
  const role = user?.role || 'viewer'
  const badges = useBadges(user?.id, activeId, pathname)

  const isAuto = useMedia('(min-width: 1024px) and (max-width: 1279px)')
  const isDrawerMode = useMedia('(max-width: 1023px)')
  const reduce = useMedia('(prefers-reduced-motion: reduce)')
  const [pref, setPref] = useState(() => readCollapsed(user))
  const [autoExpanded, setAutoExpanded] = useState(false)
  const [drawer, setDrawer] = useState(false)
  useEffect(() => { setPref(readCollapsed(user)) }, [user?.settings?.sidebar_collapsed])
  useEffect(() => { setDrawer(false); setAutoExpanded(false) }, [pathname])
  const collapsed = isDrawerMode ? false : isAuto ? !autoExpanded : pref

  const toggle = useCallback(() => {
    if (isDrawerMode) { setDrawer(d => !d); return }
    if (isAuto) { setAutoExpanded(v => !v); return }
    const v = !pref
    setPref(v); writeCollapsedLocal(v)
    if (user?.id) saveUiPrefs(user.id, { sidebar_collapsed: v })
  }, [isDrawerMode, isAuto, pref, user?.id])

  // Ctrl + \ — згорнути / розгорнути меню
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); toggle() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggle])

  const groups = useMemo(() => NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => canAccess(role, i.section)) }))
    .filter(g => g.items.length), [role])

  // Підказка з назвою для згорнутого меню (hover і фокус з клавіатури)
  const [tip, setTip] = useState(null)
  const showTip = (e, text) => { if (!collapsed) return; const r = e.currentTarget.getBoundingClientRect(); setTip({ text, top: r.top + r.height / 2 }) }
  const hideTip = () => setTip(null)

  const navLink = (item) => {
    const n = item.badge ? badges[item.badge] : 0
    const tipText = item.label + (n ? ` · ${n}` : '')
    return (
      <NavLink key={item.to} to={item.to} className={({ isActive }) => `shell-link${isActive ? ' is-active' : ''}`}
        onMouseEnter={e => showTip(e, tipText)} onMouseLeave={hideTip} onFocus={e => showTip(e, tipText)} onBlur={hideTip}>
        <span className="shell-link-icon"><i className={`ti ${item.icon}`} aria-hidden="true" />{collapsed && n > 0 && <span className="shell-dot" aria-hidden="true" />}</span>
        <span className="shell-link-label">{item.label}</span>
        {n > 0 && <span className="shell-badge" aria-label={`, чекає дії: ${n}`}>{n}</span>}
      </NavLink>
    )
  }

  const userName = user?.full_name || user?.email || ''
  const side = (
    <aside className="shell-side" aria-label="Головне меню">
      <div className="shell-top">
        <NavLink to="/orders" className="shell-logo" aria-label="AiM Skill — на головну">
          {collapsed ? <span className="shell-logo-mini">A.</span> : <><span className="shell-logo-word">AiM<span>.</span>Skill</span><span className="shell-logo-sub">ITSOLUTION</span></>}
        </NavLink>
        <button type="button" className="shell-icon-btn" onClick={toggle} aria-label={isDrawerMode ? 'Закрити меню' : collapsed ? 'Розгорнути меню' : 'Згорнути меню'}
          aria-expanded={isDrawerMode ? drawer : !collapsed} title={isDrawerMode ? 'Закрити' : 'Ctrl + \\'}>
          <i className={`ti ${isDrawerMode ? 'ti-x' : collapsed ? 'ti-layout-sidebar-left-expand' : 'ti-layout-sidebar-left-collapse'}`} aria-hidden="true" />
        </button>
      </div>
      <div className="shell-company-wrap"><CompanyPicker collapsed={collapsed} /></div>
      <nav className="shell-nav">
        {groups.map(g => (
          <div key={g.title} className="shell-group" role="group" aria-label={g.title}>
            {collapsed ? <hr className="shell-sep" /> : <div className="shell-group-title">{g.title}</div>}
            {g.items.map(navLink)}
          </div>
        ))}
      </nav>
      <div className="shell-foot">
        <div className="shell-user">
          <span className="shell-avatar is-ink" aria-hidden="true" title={collapsed ? userName : undefined}>{initials(userName)}</span>
          {!collapsed && <span className="shell-user-text"><span className="shell-user-name">{userName}</span><span className="shell-user-role">{ROLE_LABELS[role] || role}</span></span>}
          {!collapsed && <button type="button" className="shell-icon-btn" onClick={() => supabase.auth.signOut()} aria-label="Вийти" title="Вийти"><i className="ti ti-logout" aria-hidden="true" /></button>}
        </div>
        {!collapsed && <div className="shell-flag"><NewUiToggle compact /></div>}
        {!isDrawerMode && (
          <button type="button" className="shell-collapse" onClick={toggle} aria-label={collapsed ? 'Розгорнути меню' : 'Згорнути меню'}>
            <i className={`ti ${collapsed ? 'ti-chevron-right' : 'ti-chevron-left'}`} aria-hidden="true" />
            {!collapsed && <><span>Згорнути меню</span><kbd>Ctrl \</kbd></>}
          </button>
        )}
      </div>
    </aside>
  )

  const onMore = !BOTTOM.some(b => pathname === b.to || pathname.startsWith(b.to + '/'))
  const mainRef = useRef(null)

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}${drawer ? ' is-drawer-open' : ''}${reduce ? ' no-motion' : ''}`}>
      <a href="#shell-main" className="shell-skip" onClick={e => { e.preventDefault(); const m = document.getElementById('shell-main'); m?.focus(); m?.scrollIntoView() }}>До вмісту</a>
      {side}
      {drawer && <div className="shell-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <div className="shell-main" id="shell-main" ref={mainRef} tabIndex={-1}>
        <header className="shell-bar">
          <button type="button" className="shell-icon-btn shell-burger" onClick={() => setDrawer(true)} aria-label="Відкрити меню" aria-expanded={drawer}>
            <i className="ti ti-menu-2" aria-hidden="true" />
          </button>
          <span className="shell-logo-word is-bar">AiM<span>.</span>Skill</span>
          <span className="shell-bar-spacer" />
          {canAccess(role, 'tasks') && <span className="shell-bar-task"><QuickTaskFab variant="header" /></span>}
        </header>
        <div className="page-inner" key={activeId || 'none'}><Outlet /></div>
      </div>

      {canAccess(role, 'tasks') && <span className="shell-fab-wrap"><QuickTaskFab /></span>}

      <nav className="shell-bottom" aria-label="Нижнє меню">
        {BOTTOM.filter(b => canAccess(role, b.section)).map(b => {
          const n = b.badge ? badges[b.badge] : 0
          return (
            <NavLink key={b.to} to={b.to} className={({ isActive }) => `shell-tab${isActive ? ' is-active' : ''}`}>
              <span className="shell-tab-icon"><i className={`ti ${b.icon}`} aria-hidden="true" />{n > 0 && <span className="shell-dot" aria-hidden="true" />}</span>
              <span>{b.label}</span>
            </NavLink>
          )
        })}
        <NavLink to="/more" className={() => `shell-tab${onMore ? ' is-active' : ''}`} aria-current={onMore ? 'page' : undefined}>
          <span className="shell-tab-icon"><i className="ti ti-dots" aria-hidden="true" />{badges.documents > 0 && <span className="shell-dot" aria-hidden="true" />}</span>
          <span>Ще</span>
        </NavLink>
      </nav>

      {tip && collapsed && <div className="shell-tip" role="tooltip" style={{ top: tip.top }}>{tip.text}</div>}
    </div>
  )
}

// Екран «Ще» (телефон): перемикач юрособи, решта розділів групами з описом і лічильниками, профіль, «Вийти».
export function MorePage() {
  const { user } = useUser()
  const { companies, activeId, setActiveCompany } = useCompany()
  const { pathname } = useLocation()
  const role = user?.role || 'viewer'
  const badges = useBadges(user?.id, activeId, pathname)
  const inBottom = new Set(BOTTOM.map(b => b.to))
  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => !inBottom.has(i.to) && canAccess(role, i.section)) }))
    .filter(g => g.items.length)
  const userName = user?.full_name || user?.email || ''
  return (
    <div className="more">
      <h1 className="more-title">Ще</h1>
      {companies.length > 0 && (
        <section className="more-company" aria-label="Юрособа">
          <span className="more-company-label">Юрособа</span>
          <div className="more-chips" role="group" aria-label="Юрособа">
            {companies.map(c => (
              <button key={c.id} type="button" aria-pressed={c.id === activeId} className="more-chip" onClick={() => setActiveCompany(c.id)}>{companyName(c)}</button>
            ))}
          </div>
        </section>
      )}
      {groups.map(g => (
        <section key={g.title} className="more-group">
          <h2 className="more-group-title">{g.title}</h2>
          <div className="more-list">
            {g.items.map(i => {
              const n = i.badge ? badges[i.badge] : 0
              return (
                <NavLink key={i.to} to={i.to} className="more-item">
                  <span className={`more-icon${g.title === 'Аналіз' ? ' is-brand' : g.title === 'Сервіс' ? ' is-plain' : ''}`}><i className={`ti ${i.icon}`} aria-hidden="true" /></span>
                  <span className="more-item-text"><span className="more-item-name">{i.label}</span><span className="more-item-desc">{i.desc}</span></span>
                  {n > 0 && <span className="shell-badge">{n}</span>}
                  <i className="ti ti-chevron-right more-chev" aria-hidden="true" />
                </NavLink>
              )
            })}
          </div>
        </section>
      ))}
      <section className="more-profile">
        <span className="shell-avatar is-ink is-lg" aria-hidden="true">{initials(userName)}</span>
        <span className="more-profile-text"><span className="more-item-name">{userName}</span><span className="more-item-desc">{user?.email}{ROLE_LABELS[role] ? ` · ${ROLE_LABELS[role]}` : ''}</span></span>
        <button type="button" className="btn btn-secondary" onClick={() => supabase.auth.signOut()}>Вийти</button>
      </section>
      {role === 'admin' && <section className="more-profile"><NewUiToggle /></section>}
    </div>
  )
}

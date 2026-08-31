// Контекст активної компанії: перелік доступних користувачу юросіб + вибір поточної.
// Синхронізує module-singleton (companyScope) для lib-модулів.
// Стійкий до відсутності таблиць companies/user_companies (до застосування міграції 039).
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useUser } from './auth'
import { setActiveCompanyId } from './companyScope'

const Ctx = createContext(null)
const LS_KEY = 'active_company_id'

export function CompanyProvider({ children }) {
  const { user } = useUser()
  const [companies, setCompanies] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [loading, setLoading] = useState(true)

  function applyActive(id) {
    setActiveId(id)
    setActiveCompanyId(id)
    try {
      if (id) localStorage.setItem(LS_KEY, id)
      else localStorage.removeItem(LS_KEY)
    } catch {}
  }

  useEffect(() => {
    if (!user?.id) {
      setCompanies([])
      applyActive(null)
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      let list = []
      // Компанії, призначені користувачу.
      const { data, error } = await supabase
        .from('user_companies')
        .select('company_id, companies(*)')
        .eq('user_id', user.id)
      if (!error) list = (data || []).map(r => r.companies).filter(Boolean)
      // Фолбек: призначень нема (свіжа БД / до Фази 5) — усі компанії.
      if (!list.length) {
        const { data: all } = await supabase.from('companies').select('*')
        list = all || []
      }
      list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.short_name || a.name || '').localeCompare(b.short_name || b.name || '', 'uk'))
      if (cancelled) return
      setCompanies(list)
      let saved = null
      try { saved = localStorage.getItem(LS_KEY) } catch {}
      const pick = list.find(c => c.id === saved) || list[0] || null
      applyActive(pick?.id || null)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const active = companies.find(c => c.id === activeId) || null
  return (
    <Ctx.Provider value={{ companies, active, activeId, setActiveCompany: applyActive, loading }}>
      {children}
    </Ctx.Provider>
  )
}

export function useCompany() {
  return useContext(Ctx) || {
    companies: [], active: null, activeId: null, setActiveCompany: () => {}, loading: false,
  }
}

// Перемикач компаній для шапки/сайдбару. Ховається, якщо компаній нема.
export function CompanySwitcher({ compact = false }) {
  const { companies, activeId, setActiveCompany } = useCompany()
  if (!companies.length) return null
  const label = (c) => c.short_name || c.name

  // Одна компанія — просто підпис, без вибору.
  if (companies.length === 1) {
    return (
      <div className="company-switch one" title={companies[0].name}>
        <i className="ti ti-building" aria-hidden="true" />
        <span className="ellip">{label(companies[0])}</span>
      </div>
    )
  }

  return (
    <div className={`company-switch${compact ? ' compact' : ''}`}>
      <i className="ti ti-building" aria-hidden="true" />
      <select
        value={activeId || ''}
        onChange={e => setActiveCompany(e.target.value)}
        aria-label="Активна компанія"
        title="Активна компанія"
      >
        {companies.map(c => (
          <option key={c.id} value={c.id}>{label(c)}</option>
        ))}
      </select>
    </div>
  )
}

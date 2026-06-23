// Контекст користувача: сесія Supabase + профіль (роль) + захист роутів.
// Ролі: admin / accountant / manager — усі мають повний доступ (per ТЗ 5.2).
import { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from './supabase'

const UserCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      session ? loadProfile(session.user.id) : setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) loadProfile(s.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(id) {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single()
    setProfile(data)
    setLoading(false)
  }

  const user = session ? { ...session.user, ...profile, role: profile?.role || 'viewer' } : null
  return <UserCtx.Provider value={{ user, session, loading }}>{children}</UserCtx.Provider>
}

export const useUser = () => useContext(UserCtx)

// Захист роуту: немає сесії → /login
export function RequireAuth({ children }) {
  const { session, loading } = useUser()
  const location = useLocation()
  if (loading) return <FullScreen>Завантаження…</FullScreen>
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

export function FullScreen({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text2)' }}>
      {children}
    </div>
  )
}

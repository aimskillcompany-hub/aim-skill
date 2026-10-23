// Особисті налаштування інтерфейсу в profiles.settings (jsonb, без міграцій):
//   new_ui            — «Новий інтерфейс» (етапи редизайну за прапорцем; вмикає адміністратор собі)
//   sidebar_collapsed — згорнуте бокове меню (дублюється в localStorage, щоб не блимало при завантаженні)
import { useEffect } from 'react'
import { supabase } from './supabase'
import { useUser } from './auth'

const LS_COLLAPSED = 'sidebar_collapsed'

export function useNewUi() {
  const { user } = useUser() || {}
  const on = !!user?.settings?.new_ui
  useEffect(() => {
    const el = document.documentElement
    if (on) el.dataset.ui = 'new'
    else delete el.dataset.ui
  }, [on])
  return on
}

// Злити ключі в profiles.settings поточного користувача (лише свій рядок)
export async function saveUiPrefs(userId, patch) {
  if (!userId) return { error: new Error('Немає користувача') }
  const { data, error } = await supabase.from('profiles').select('settings').eq('id', userId).maybeSingle()
  if (error) return { error }
  const settings = { ...(data?.settings || {}), ...patch }
  return supabase.from('profiles').update({ settings }).eq('id', userId)
}

export function readCollapsed(user) {
  if (typeof user?.settings?.sidebar_collapsed === 'boolean') return user.settings.sidebar_collapsed
  try { return localStorage.getItem(LS_COLLAPSED) === '1' } catch { return false }
}
export function writeCollapsedLocal(v) {
  try { localStorage.setItem(LS_COLLAPSED, v ? '1' : '0') } catch {}
}

import { useState } from 'react'
import { useUser } from '../lib/auth'
import { saveUiPrefs } from '../lib/uiPrefs'
import { Switch, useToast } from './ui'

// Перемикач «Новий інтерфейс» (етапи редизайну за прапорцем). Лише адміністратор, лише для себе.
export default function NewUiToggle({ compact = false }) {
  const { user, refreshProfile } = useUser()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (user?.role !== 'admin') return null
  const on = !!user?.settings?.new_ui
  const change = async (v) => {
    setBusy(true)
    const { error } = await saveUiPrefs(user.id, { new_ui: v })
    setBusy(false)
    if (error) { toast('Не вдалося зберегти: ' + error.message, { type: 'error' }); return }
    await refreshProfile?.()
    toast(v ? 'Новий інтерфейс увімкнено — лише для вас' : 'Повернуто попередній інтерфейс')
  }
  return <Switch checked={on} onChange={change} disabled={busy} label="Новий інтерфейс"
    description={compact ? undefined : 'Бачите лише ви, поки не ввімкнемо всім'} />
}

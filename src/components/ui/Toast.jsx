import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

// Сповіщення внизу по центру, 3 с. ToastProvider — один на застосунок (main.jsx); у компонентах:
//   const toast = useToast(); toast('Збережено'); toast('Не вдалося', { type: 'error' })
//   після масових дій (ТЗ): toast('Змінено 12 операцій', { action: { label: 'Скасувати', onClick: undo } }) — 6 с
const Ctx = createContext(null)

export function ToastProvider({ children, duration = 3000 }) {
  const [items, setItems] = useState([])
  const seq = useRef(0)
  const remove = useCallback((id) => setItems(x => x.filter(t => t.id !== id)), [])
  const toast = useCallback((message, { type = 'success', action, duration: d } = {}) => {
    const id = ++seq.current
    setItems(x => [...x, { id, message, type, action }])
    setTimeout(() => remove(id), d ?? (action ? 6000 : duration))
  }, [duration, remove])
  const value = useMemo(() => toast, [toast])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="ui-toast-host" role="status" aria-live="polite">
        {items.map(t => <div key={t.id} className={`ui-toast ui-toast-${t.type}`}>
          <i className={`ti ${t.type === 'error' ? 'ti-alert-circle' : 'ti-check'}`} aria-hidden="true" />{t.message}
          {t.action && <button type="button" className="ui-toast-action" onClick={() => { remove(t.id); t.action.onClick?.() }}>{t.action.label}</button>}
        </div>)}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const t = useContext(Ctx)
  if (!t) throw new Error('useToast() — потрібен <ToastProvider> вище в дереві')
  return t
}

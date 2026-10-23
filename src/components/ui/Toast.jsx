import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

// Сповіщення внизу по центру, 3 с. ToastProvider — один на застосунок (main.jsx); у компонентах:
//   const toast = useToast(); toast('Збережено'); toast('Не вдалося', { type: 'error' })
const Ctx = createContext(null)

export function ToastProvider({ children, duration = 3000 }) {
  const [items, setItems] = useState([])
  const seq = useRef(0)
  const toast = useCallback((message, { type = 'success' } = {}) => {
    const id = ++seq.current
    setItems(x => [...x, { id, message, type }])
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), duration)
  }, [duration])
  const value = useMemo(() => toast, [toast])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="ui-toast-host" role="status" aria-live="polite">
        {items.map(t => <div key={t.id} className={`ui-toast ui-toast-${t.type}`}>
          <i className={`ti ${t.type === 'error' ? 'ti-alert-circle' : 'ti-check'}`} aria-hidden="true" />{t.message}
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

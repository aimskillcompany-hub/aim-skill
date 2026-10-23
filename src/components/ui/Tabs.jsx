// Вкладки (ТЗ, розділ 2): підкреслення 2 px brand; на телефоні — горизонтальні чипи зі скролом.
//   tabs [{ id, label, icon?, count? }], value, onChange(id), ariaLabel. Стрілки ←/→, Home/End.
// Активну вкладку сторінки тримайте в URL (?tab=…) — див. useTabParam.
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

// variant="pills" — сегмент-пігулки (макети Аналітики); tabs[].short — коротка назва на телефоні
export default function Tabs({ tabs = [], value, onChange, ariaLabel, idPrefix = 'tab', variant }) {
  const ref = useRef(null)
  useEffect(() => {
    const box = ref.current, el = box?.querySelector('[aria-selected="true"]')
    if (!el || box.scrollWidth <= box.clientWidth) return
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
    box.scrollLeft += (r.left - b.left) - (b.width - r.width) / 2
  }, [value])
  const onKey = (e) => {
    const i = tabs.findIndex(t => t.id === value)
    const go = (j) => { e.preventDefault(); const t = tabs[(j + tabs.length) % tabs.length]; onChange?.(t.id); document.getElementById(`${idPrefix}-${t.id}`)?.focus() }
    if (e.key === 'ArrowRight') go(i + 1)
    else if (e.key === 'ArrowLeft') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(tabs.length - 1)
  }
  return (
    <div className={`ui-tabs${variant === 'pills' ? ' is-pills' : ''}`} role="tablist" aria-label={ariaLabel} ref={ref} onKeyDown={onKey}>
      {tabs.map(t => (
        <button key={t.id} id={`${idPrefix}-${t.id}`} type="button" role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1}
          className="ui-tab" onClick={() => onChange?.(t.id)}>
          {t.icon && <i className={`ti ${t.icon}`} aria-hidden="true" />}{t.short ? <><span className="ui-tab-long">{t.label}</span><span className="ui-tab-short" aria-hidden="true">{t.short}</span></> : t.label}
          {t.count != null && <span className="ui-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// Активна вкладка в URL: const [tab, setTab] = useTabParam('receivables', ['receivables', 'payables'])
export function useTabParam(fallback, allowed) {
  const [qs, setQs] = useSearchParams()
  const raw = qs.get('tab')
  const tab = raw && (!allowed || allowed.includes(raw)) ? raw : fallback
  const setTab = (id) => setQs(p => { const n = new URLSearchParams(p); n.set('tab', id); return n }, { replace: true })
  return [tab, setTab]
}

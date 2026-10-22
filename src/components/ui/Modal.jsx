import { useEffect, useId, useRef } from 'react'

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

// Модальне вікно (класи .modal-bg / .modal з base.css — так само виглядають і наявні вікна).
//   open, onClose, title, footer, size: 'md' | 'lg' | 'xl'
// role="dialog" + aria-modal; фокус — на перше поле (або першу кнопку); Tab не виходить за вікно;
// Esc і клік по фону закривають; після закриття фокус повертається туди, де був.
export default function Modal({ open, onClose, title, footer, size = 'md', children, closeOnBackdrop = true }) {
  const ref = useRef(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    const el = ref.current
    const first = el?.querySelector('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])') || el?.querySelector(FOCUSABLE)
    first?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.() }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null)
        if (!items.length) return
        const [a, z] = [items[0], items[items.length - 1]]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open])
  if (!open) return null
  return (
    <div className="modal-bg" onMouseDown={e => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.() }}>
      <div ref={ref} className={`modal ${size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : ''}`} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
        {title && <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрити"><i className="ti ti-x" aria-hidden="true" /></button>
        </div>}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

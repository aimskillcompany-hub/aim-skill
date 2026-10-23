import { cloneElement, useEffect, useId, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'

// Випадне меню «⋯».
//   trigger — елемент-кнопка (напр. <Button iconOnly icon="ti-dots" aria-label="Інші дії" />)
//   items — [{ label, icon, danger, disabled, confirm: true | { title, text, confirmLabel }, onClick }] або { divider: true }
// Клавіатура: ↓/↑ — між пунктами, Home/End, Enter/Space — вибрати, Esc — закрити й повернути фокус на кнопку, Tab — закрити.
export default function Menu({ trigger, items = [], align = 'right' }) {
  const [open, setOpen] = useState(false)
  const [ask, setAsk] = useState(null)
  const wrap = useRef(null)
  const btn = useRef(null)
  const id = useId()
  const actionable = () => [...(wrap.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])]
  const close = (focusTrigger = true) => { setOpen(false); if (focusTrigger) btn.current?.focus() }

  useEffect(() => {
    if (!open) return
    actionable()[0]?.focus()
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const onKeyDown = (e) => {
    const list = actionable(), i = list.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') setOpen(false)
  }
  const choose = (it) => {
    close(!it.confirm)
    if (it.confirm) setAsk(it)
    else it.onClick?.()
  }
  const t = cloneElement(trigger, {
    ref: btn, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
    onClick: (e) => { trigger.props.onClick?.(e); setOpen(o => !o) },
    onKeyDown: (e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } },
  })
  const c = ask && (typeof ask.confirm === 'object' ? ask.confirm : {})
  return (
    <span className="ui-menu-wrap" ref={wrap}>
      {t}
      {open && <div className={`ui-menu ui-menu-${align}`} role="menu" id={id} onKeyDown={onKeyDown}>
        {items.map((it, i) => it.divider
          ? <div key={i} className="ui-menu-divider" role="separator" />
          : <button key={i} type="button" role="menuitem" className={`ui-menu-item${it.danger ? ' is-danger' : ''}`} disabled={it.disabled} onClick={() => choose(it)}>
              {it.icon && <i className={`ti ${it.icon}`} aria-hidden="true" />}{it.label}
            </button>)}
      </div>}
      <ConfirmDialog open={!!ask} danger={!!ask?.danger}
        title={c?.title || (ask ? `${ask.label}?` : '')} text={c?.text} confirmLabel={c?.confirmLabel || ask?.label}
        onCancel={() => { setAsk(null); btn.current?.focus() }}
        onConfirm={() => { const it = ask; setAsk(null); it?.onClick?.() }} />
    </span>
  )
}

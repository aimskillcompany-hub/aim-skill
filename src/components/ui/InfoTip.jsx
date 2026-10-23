// Підказка ⓘ (ТЗ «Підказки», розділ 2; макет InfoTip): пояснення не займають місце на екрані.
//   <InfoTip text="…" label="Залишок на кінець" placement="auto|top|bottom|left|right" tone="onDark" />
//   або дочірні елементи замість text (можна <b>, <br />). Значок — span role="button": його можна ставити й усередині
//   кнопок-плиток (вкладені <button> недопустимі); клік по ньому не спрацьовує як клік по плитці.
// Комп'ютер — наведення (затримка 150 мс), курсор може перейти на попап; телефон — дотик; Tab фокусує, Esc закриває.
// Одночасно відкрита лише одна підказка. Попап — у portal (не обрізається overflow батьків) і не виходить за край екрана.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

let closeCurrent = null   // закрити відкриту зараз підказку (лише одна)
const GAP = 8, EDGE = 8

export default function InfoTip({ text, children, label = '', placement = 'auto', tone, className = '' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null), pop = useRef(null)
  const timer = useRef(null)
  const touch = useRef(false)
  const pressing = useRef(false)   // фокус від натискання — відкриває/закриває click, а не focus
  const id = useId()

  const hide = useCallback(() => { clearTimeout(timer.current); setOpen(false) }, [])
  const show = useCallback(() => {
    clearTimeout(timer.current)
    if (closeCurrent && closeCurrent !== hide) closeCurrent()
    closeCurrent = hide
    setOpen(true)
  }, [hide])
  useEffect(() => () => { clearTimeout(timer.current); if (closeCurrent === hide) closeCurrent = null }, [hide])

  // позиція: під значком; не вміщається — вгору; по горизонталі — по центру, притиснуто до країв екрана
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const b = btn.current?.getBoundingClientRect(), p = pop.current
      if (!b || !p) return
      const w = p.offsetWidth, h = p.offsetHeight, vw = window.innerWidth, vh = window.innerHeight
      let side = placement === 'auto' ? 'bottom' : placement
      if (side === 'bottom' && b.bottom + GAP + h > vh - EDGE && b.top - GAP - h > EDGE) side = 'top'
      if (side === 'top' && b.top - GAP - h < EDGE) side = 'bottom'
      if (side === 'right' && b.right + GAP + w > vw - EDGE) side = 'left'
      if (side === 'left' && b.left - GAP - w < EDGE) side = 'right'
      let top, left
      if (side === 'bottom' || side === 'top') {
        top = side === 'bottom' ? b.bottom + GAP : b.top - GAP - h
        left = b.left + b.width / 2 - w / 2
      } else {
        top = b.top + b.height / 2 - h / 2
        left = side === 'right' ? b.right + GAP : b.left - GAP - w
      }
      left = Math.max(EDGE, Math.min(left, vw - w - EDGE))
      top = Math.max(EDGE, Math.min(top, vh - h - EDGE))
      setPos({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, placement])

  // закриття: Esc, дотик / клік поза значком і попапом
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { hide(); btn.current?.focus() } }
    const onDown = (e) => { if (!btn.current?.contains(e.target) && !pop.current?.contains(e.target)) hide() }
    document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown) }
  }, [open, hide])

  const hoverOpened = useRef(false)   // відкрито наведенням — клік мишею не має закривати
  const enter = (e) => { if (e.pointerType === 'touch') return; clearTimeout(timer.current); timer.current = setTimeout(() => { hoverOpened.current = true; show() }, 150) }
  const leave = (e) => { if (e.pointerType === 'touch') return; clearTimeout(timer.current); timer.current = setTimeout(() => { hoverOpened.current = false; hide() }, 120) }

  return (
    <>
      <span ref={btn} role="button" tabIndex={0} className={`ui-tip${tone === 'onDark' ? ' is-dark' : ''}${open ? ' is-open' : ''} ${className}`}
        aria-label={label ? `Пояснення: ${label}` : 'Пояснення'} aria-describedby={open ? id : undefined} aria-expanded={open}
        onPointerDown={e => { touch.current = e.pointerType === 'touch'; pressing.current = true }}
        onPointerEnter={enter} onPointerLeave={leave}
        onClick={e => { e.preventDefault(); e.stopPropagation(); pressing.current = false; open && !hoverOpened.current ? hide() : show(); hoverOpened.current = false }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open ? hide() : show() } }}
        onFocus={() => { if (!pressing.current) show() }}
        onBlur={e => { if (!pop.current?.contains(e.relatedTarget)) hide() }}>i</span>
      {open && createPortal(
        <span ref={pop} id={id} role="tooltip" className="ui-tip-pop" style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
          onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}>
          {children ?? text}
        </span>, document.body)}
    </>
  )
}

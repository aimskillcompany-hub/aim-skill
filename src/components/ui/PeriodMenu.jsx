// Компактний вибір періоду (ТЗ редизайну, розділ 2; макети: «Жовтень 2026 ▾» / «Січень — жовтень 2026 ▾» у шапці).
//   year, month (0 — весь рік), onChange({ year, month }); years — дозволені роки; allowYear — чи можна «весь рік»;
//   allowAll — пункт «Усі періоди» (year: null)
//   yearOnly — лише рік (для Cash Flow, де місяці — чипами). Майбутні місяці поточного року — неактивні.
import { useEffect, useId, useRef, useState } from 'react'

const MN = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const MS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']

export const periodText = (year, month) => {
  if (month) return `${MN[month - 1]} ${year}`
  const now = new Date()
  const last = year === now.getFullYear() ? now.getMonth() : 11
  return last === 11 ? `${year} рік` : `${MN[0]} — ${MN[last].toLowerCase()} ${year}`
}

export default function PeriodMenu({ year, month = 0, onChange, years, allowYear = true, yearOnly = false, allowAll = false, align = 'right' }) {
  const [open, setOpen] = useState(false)
  const [y, setY] = useState(year ?? new Date().getFullYear())
  const wrap = useRef(null), btn = useRef(null)
  const id = useId()
  const now = new Date()
  const ys = years || [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()]
  useEffect(() => { if (open) setY(year ?? now.getFullYear()) }, [open, year])
  useEffect(() => {
    if (!open) return
    wrap.current?.querySelector('[aria-pressed="true"], .ui-pm-grid button:not(:disabled)')?.focus()
    const onDoc = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  const pick = (yy, mm) => { onChange({ year: yy, month: mm }); setOpen(false); btn.current?.focus() }
  const lastMonth = y === now.getFullYear() ? now.getMonth() + 1 : y > now.getFullYear() ? 0 : 12
  const label = year == null ? 'Усі періоди' : yearOnly ? String(year) : periodText(year, month)

  return (
    <span className="ui-pm" ref={wrap}>
      <button ref={btn} type="button" className="ui-pm-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(o => !o)}>
        <i className="ti ti-calendar" aria-hidden="true" />{label}<i className="ti ti-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <div className={`ui-pm-pop is-${align}`} role="dialog" id={id} aria-label="Вибір періоду">
          <div className="ui-pm-year">
            <button type="button" aria-label="Попередній рік" disabled={!ys.includes(y - 1)} onClick={() => setY(y - 1)}><i className="ti ti-chevron-left" aria-hidden="true" /></button>
            <b>{y}</b>
            <button type="button" aria-label="Наступний рік" disabled={!ys.includes(y + 1)} onClick={() => setY(y + 1)}><i className="ti ti-chevron-right" aria-hidden="true" /></button>
          </div>
          {allowAll && <button type="button" className="ui-pm-all" aria-pressed={year == null} onClick={() => pick(null, 0)}>Усі періоди</button>}
          {yearOnly ? <button type="button" className="ui-pm-all" aria-pressed={y === year} onClick={() => pick(y, month)}>Обрати {y}</button> : <>
            {allowYear && <button type="button" className="ui-pm-all" aria-pressed={y === year && !month} onClick={() => pick(y, 0)}>{y === now.getFullYear() ? `Січень — ${MN[now.getMonth()].toLowerCase()}` : 'Весь рік'}</button>}
            <div className="ui-pm-grid">
              {MS.map((m, i) => <button key={m} type="button" aria-pressed={y === year && month === i + 1} disabled={i + 1 > lastMonth} onClick={() => pick(y, i + 1)}>{m}</button>)}
            </div>
          </>}
        </div>
      )}
    </span>
  )
}

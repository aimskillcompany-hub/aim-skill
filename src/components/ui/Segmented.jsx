// Сегментований перемикач (замість ряду кнопок-фільтрів).
//   options [{ value, label, count?, icon? }] або рядки; value; onChange(value); ariaLabel — обов'язковий опис групи
// className="is-chips-sm" — на телефоні окремі чипи з темним активним (макети мобільних фільтрів)
export default function Segmented({ options = [], value, onChange, ariaLabel, size = 'md', className = '' }) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  return (
    <div className={`ui-segmented ui-segmented-${size}${className ? ' ' + className : ''}`} role="group" aria-label={ariaLabel}>
      {opts.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} className="ui-seg-btn" onClick={() => onChange?.(o.value)}>
          {o.icon && <i className={`ti ${o.icon}`} aria-hidden="true" />}{o.label}
          {o.count != null && <span className="ui-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

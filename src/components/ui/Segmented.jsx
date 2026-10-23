// Сегментований перемикач (замість ряду кнопок-фільтрів).
//   options [{ value, label, count?, icon? }] або рядки; value; onChange(value); ariaLabel — обов'язковий опис групи
export default function Segmented({ options = [], value, onChange, ariaLabel, size = 'md' }) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  return (
    <div className={`ui-segmented ui-segmented-${size}`} role="group" aria-label={ariaLabel}>
      {opts.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} className="ui-seg-btn" onClick={() => onChange?.(o.value)}>
          {o.icon && <i className={`ti ${o.icon}`} aria-hidden="true" />}{o.label}
          {o.count != null && <span className="ui-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

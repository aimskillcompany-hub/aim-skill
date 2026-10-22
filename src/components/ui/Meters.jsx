import { formatAmount } from '../../utils/format'

// Шкала частки (ТЗ, розділ 2): label, value, max, amount (підпис праворуч), tone brand | expense | warn | danger.
export function BarMeter({ label, value = 0, max = 100, amount, tone = 'brand', showPct = true }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="ui-meter">
      {(label || amount != null) && <div className="ui-meter-head"><span>{label}</span>{amount != null && <span className="ui-num">{amount}</span>}</div>}
      <div className={`ui-meter-track is-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {showPct && <div className="ui-meter-pct ui-num">{Math.round(pct)}%</div>}
    </div>
  )
}

// Структура (вік боргу, склад капіталу): segments [{ label, value, color }] + легенда із сумами.
// Колір — не єдиний носій сенсу: у легенді назва й сума.
export function StackBar({ segments = [], total, ariaLabel = 'Структура', decimals = 0 }) {
  const sum = total ?? segments.reduce((s, x) => s + (Number(x.value) || 0), 0)
  return (
    <div className="ui-stack">
      <div className="ui-stack-bar" role="img" aria-label={`${ariaLabel}: ` + segments.map(s => `${s.label} ${formatAmount(s.value, { decimals })}`).join(', ')}>
        {segments.map((s, i) => <span key={i} style={{ flexGrow: sum > 0 ? Math.max(0, s.value) / sum : 0, background: s.color }} />)}
      </div>
      <ul className="ui-stack-legend">
        {segments.map((s, i) => (
          <li key={i}><span className="ui-dot" style={{ background: s.color }} aria-hidden="true" />{s.label}
            <span className="ui-num">{formatAmount(s.value, { decimals })}</span>
            {sum > 0 && <span className="ui-muted ui-num">· {Math.round((s.value / sum) * 100)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

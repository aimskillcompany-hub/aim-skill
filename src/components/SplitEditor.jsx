// Розбиття однієї банківської операції на кілька статей (міграція 110): стаття + сума на рядок.
// Суми вводяться модулем; знак (прихід / витрата) береться з операції. Сума частин має дорівнювати сумі операції.
import { validateSplit } from '../lib/txSplits'
import { fmt } from '../lib/fmt'

export default function SplitEditor({ total, parts, onChange, grouped, typeLabels = {}, disabled = false }) {
  const v = validateSplit(total, parts)
  const set = (i, patch) => onChange(parts.map((p, n) => n === i ? { ...p, ...patch } : p))
  const remove = (i) => onChange(parts.filter((_, n) => n !== i))
  const add = () => onChange([...parts, { article_id: '', amount: v.rest > 0 ? String(v.rest) : '' }])
  const fillRest = (i) => {
    const own = validateSplit(total, parts.filter((_, n) => n !== i)).rest
    if (own > 0) set(i, { amount: String(own) })
  }

  return (
    <div className="split-editor" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Розбиття на статті</div>
      {parts.map((p, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <select className="form-input" value={p.article_id || ''} disabled={disabled} aria-label={`Стаття частини ${i + 1}`}
            onChange={e => set(i, { article_id: e.target.value })}>
            <option value="">Стаття…</option>
            {Object.entries(grouped).map(([type, arts]) => (
              <optgroup key={type} label={typeLabels[type] || type}>
                {arts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            ))}
          </select>
          <input className="form-input" inputMode="decimal" placeholder="Сума" value={p.amount ?? ''} disabled={disabled}
            aria-label={`Сума частини ${i + 1}, грн`} style={{ textAlign: 'right' }}
            onChange={e => set(i, { amount: e.target.value })}
            onDoubleClick={() => fillRest(i)} title="Подвійний клік — уся нерозподілена решта" />
          <button type="button" className="btn" onClick={() => remove(i)} disabled={disabled || parts.length <= 2}
            aria-label={`Прибрати частину ${i + 1}`} title="Прибрати" style={{ padding: '4px 8px' }}><i className="ti ti-x" /></button>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <button type="button" className="btn" onClick={add} disabled={disabled}><i className="ti ti-plus" /> Додати статтю</button>
        <span role="status" style={{ fontSize: 13, color: v.ok ? 'var(--text2)' : 'var(--red)' }}>
          {v.ok ? `Розподілено всю суму: ${fmt(v.sum)} грн` : `Розподілено ${fmt(v.sum)} з ${fmt(Math.abs(Number(total) || 0))} грн`
            + (Math.abs(v.rest) >= 0.005 ? ` · ${v.rest > 0 ? 'залишок' : 'зайве'} ${fmt(Math.abs(v.rest))}` : '')}
        </span>
      </div>
    </div>
  )
}

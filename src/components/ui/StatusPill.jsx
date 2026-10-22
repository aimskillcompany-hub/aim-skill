import { TONES, STATUS_MAPS } from './statusMaps'

const warned = new Set()

// Статус — пігулка зі світлим фоном і темним текстом (контраст ≥ 4.5:1).
//   status — код статусу з бази (напр. 'needs_payment' або 'in_progress'); kind — 'order' | 'task';
//   label — свій підпис замість довідникового; size — 'sm' | 'md'.
// Невідомий статус → neutral (+ попередження в консолі в режимі розробки).
export default function StatusPill({ status, kind = 'order', label, size = 'md' }) {
  const map = STATUS_MAPS[kind] || STATUS_MAPS.order
  let tone = map.tones[status]
  if (!tone) {
    tone = 'neutral'
    if (import.meta.env?.DEV && !warned.has(kind + ':' + status)) {
      warned.add(kind + ':' + status)
      console.warn(`[StatusPill] невідомий статус «${status}» (${kind}) — показано нейтральним`)
    }
  }
  const t = TONES[tone]
  return (
    <span className={`ui-pill ui-pill-${size}`} data-tone={tone} style={{ background: t.bg, color: t.fg }}>
      {label || map.label(status)}
    </span>
  )
}

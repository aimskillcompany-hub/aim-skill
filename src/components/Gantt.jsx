import { useMemo } from 'react'
import { ORDER_TYPES, statusLabel, isOpen } from '../lib/orders'

// Горизонтальна шкала часу. Кожне замовлення — два бари:
//   оплата клієнта (синій / червоний якщо прострочено) і поставка/виконання (зелений).
const DAY = 864e5

export default function Gantt({ orders, onOpen }) {
  const { start, span, todayPct } = useMemo(() => {
    const dates = []
    orders.forEach(o => {
      if (o.created_at) dates.push(new Date(o.created_at).getTime())
      if (o.closed_at) dates.push(new Date(o.closed_at).getTime())
    })
    const now = Date.now()
    dates.push(now)
    let min = Math.min(...dates) - 3 * DAY
    let max = Math.max(...dates) + 7 * DAY
    if (!isFinite(min) || !isFinite(max) || min === max) { min = now - 30 * DAY; max = now + 30 * DAY }
    const span = max - min
    return { start: min, span, todayPct: ((now - min) / span) * 100 }
  }, [orders])

  if (!orders.length) return <div className="card"><p style={{ color: 'var(--text3)', textAlign: 'center', padding: 24 }}>Замовлень немає</p></div>

  const pct = (t) => ((new Date(t).getTime() - start) / span) * 100

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div style={{ position: 'relative', minWidth: 640 }}>
        {/* лінія сьогодні */}
        <div style={{ position: 'absolute', left: `calc(180px + (100% - 180px) * ${todayPct / 100})`, top: 0, bottom: 0, width: 2, background: 'var(--blue)', opacity: .5, zIndex: 1 }} title="Сьогодні" />
        {orders.map(o => {
          const from = o.created_at || new Date(start).toISOString()
          const to = o.closed_at || new Date().toISOString()
          const left = Math.max(0, pct(from))
          const width = Math.max(1.5, pct(to) - left)
          const payColor = o.overdue ? 'var(--red)' : '#2563EB'
          return (
            <div key={o.id} onClick={() => onOpen(o.id)} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 180, flexShrink: 0, paddingRight: 10 }}>
                <div className="ellip" style={{ fontSize: 13, fontWeight: 500 }} title={`${o.order_number || o.id.slice(0, 6)} · ${o.clientName}`}>{o.order_number || o.id.slice(0, 6)} · {o.clientName}</div>
                <div className="ellip" style={{ fontSize: 11, color: 'var(--text3)' }} title={`${ORDER_TYPES[o.type]} · ${statusLabel(o)}`}>{ORDER_TYPES[o.type]} · {statusLabel(o)}</div>
              </div>
              <div style={{ position: 'relative', flex: 1, height: 30 }}>
                {/* бар оплати */}
                <div title={`Оплата · ${statusLabel(o)}`} style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 2, height: 11, borderRadius: 4, background: payColor, opacity: isOpen(o) ? .9 : .5 }} />
                {/* бар поставки/виконання */}
                <div title="Поставка / виконання" style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 16, height: 11, borderRadius: 4, background: '#16A34A', opacity: isOpen(o) ? .9 : .5 }} />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text2)' }}>
        <Legend color="#2563EB" label="Оплата клієнта" />
        <Legend color="var(--red)" label="Прострочено" />
        <Legend color="#16A34A" label="Поставка / виконання" />
      </div>
    </div>
  )
}

const Legend = ({ color, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block' }} />{label}
  </span>
)

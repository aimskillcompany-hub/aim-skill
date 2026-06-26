import { useMemo } from 'react'
import {
  ORDER_TYPES, TYPE_COLORS, flowFor, labelForStatus, STATUS_ORDER,
  isOpen, needsAction, nextActionLabel,
} from '../lib/orders'
import { fmt } from '../lib/fmt'

// Kanban-дошка замовлень. Колонки = статуси.
//   • фільтр за типом (trade/service/agent) → повний pipeline цього типу (з порожніми колонками)
//   • змішаний режим → лише наявні статуси в канонічному порядку
export default function Kanban({ orders, onOpen, type }) {
  const columns = useMemo(() => {
    let statuses
    if (['trade', 'service', 'agent'].includes(type)) {
      statuses = flowFor(type).map(x => x.s)
    } else {
      const present = new Set(orders.map(o => o.status))
      statuses = STATUS_ORDER.filter(s => present.has(s))
      orders.forEach(o => { if (!statuses.includes(o.status)) statuses.push(o.status) })
    }
    return statuses.map(s => ({
      status: s,
      label: labelForStatus(s),
      items: orders.filter(o => o.status === s),
    }))
  }, [orders, type])

  if (!orders.length) return <div className="card"><p style={{ color: 'var(--text3)', textAlign: 'center', padding: 24 }}>Замовлень немає</p></div>

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
      {columns.map(col => (
        <div key={col.status} style={{ flex: '0 0 260px', width: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', marginBottom: 8, borderBottom: '2px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: col.status === 'closed' ? 'var(--text3)' : 'var(--text)' }}>{col.label}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 10, padding: '1px 8px' }}>{col.items.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {col.items.map(o => <Card key={o.id} o={o} onOpen={onOpen} />)}
            {col.items.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '12px 0' }}>—</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Card({ o, onOpen }) {
  return (
    <div
      onClick={() => onOpen(o.id)}
      style={{
        cursor: 'pointer', background: o.overdue ? 'var(--red-bg)' : 'var(--surface)',
        border: '1px solid var(--border)', borderLeft: `3px solid ${TYPE_COLORS[o.type]}`,
        borderRadius: 8, padding: 10, opacity: isOpen(o) ? 1 : .6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{o.order_number || o.id.slice(0, 6)}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: TYPE_COLORS[o.type] }}>{ORDER_TYPES[o.type]}</span>
      </div>
      <div className="ellip" style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }} title={o.clientName}>{o.clientName}</div>
      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>{fmt(o.total)}</div>
      {isOpen(o) && (
        <div style={{ fontSize: 11, marginTop: 6, color: o.overdue ? 'var(--red)' : needsAction(o) ? 'var(--text)' : 'var(--text3)', fontWeight: needsAction(o) ? 600 : 400 }}>
          {o.overdue && <i className="ti ti-alert-triangle" style={{ marginRight: 4 }} />}{nextActionLabel(o)}
        </div>
      )}
    </div>
  )
}

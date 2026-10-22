import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useUser } from '../lib/auth'
import TaskForm from './TaskForm'

// Плаваюча кнопка «+ Задача» на всіх екранах. Враховує, де ви: у замовленні — задача прив'язується до нього,
// у картці контрагента — до контрагента. На сторінці «Задачі» не показується (там свій рядок додавання).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
function contextOf(path) {
  const o = path.match(new RegExp(`^/orders/(${UUID})`, 'i'))
  if (o) return { entity_type: 'order', entity_id: o[1], label: 'до цього замовлення' }
  const c = path.match(new RegExp(`^/contractors/(${UUID})`, 'i'))
  if (c) return { entity_type: 'counterparty', entity_id: c[1], entity_ref: `/contractors/${c[1]}`, label: 'до цього контрагента' }
  return null
}

export default function QuickTaskFab() {
  const { user } = useUser()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(null)
  if (!user || pathname.startsWith('/tasks')) return null
  const ctx = contextOf(pathname)
  return (
    <>
      <style>{`.task-fab{position:fixed;right:24px;bottom:24px;z-index:190}
        @media (max-width:768px){.task-fab{right:16px;bottom:calc(76px + env(safe-area-inset-bottom))}.task-fab .lbl{display:none}}`}</style>
      <div className="task-fab">
        {done && <div role="status" style={{ position: 'absolute', right: 0, bottom: 60, whiteSpace: 'nowrap', background: '#111827', color: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>
          ✓ Задачу створено · <Link to={`/tasks?task=${done}`} style={{ color: '#93c5fd' }} onClick={() => setDone(null)}>Відкрити</Link>
          <button onClick={() => setDone(null)} aria-label="Закрити" style={{ marginLeft: 8, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>×</button>
        </div>}
        <button onClick={() => { setDone(null); setOpen(true) }} title={ctx ? `Нова задача (буде прив'язана ${ctx.label})` : 'Нова задача'} aria-label="Нова задача"
          style={{ height: 52, minWidth: 52, padding: '0 18px', borderRadius: 999, border: 'none', background: '#111827', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', boxShadow: '0 8px 24px rgba(17,24,39,.3)', font: 'inherit' }}>
          <i className="ti ti-plus" style={{ fontSize: 20 }} /><span className="lbl">Задача</span>
        </button>
      </div>
      {open && <TaskForm task={{ priority: 'normal', assignee_id: user.id, ...(ctx ? { entity_type: ctx.entity_type, entity_id: ctx.entity_id, entity_ref: ctx.entity_ref } : {}) }}
        me={user.id} lockOrder={ctx?.entity_type === 'order'}
        onClose={() => setOpen(false)} onSaved={(id) => { setOpen(false); setDone(id); setTimeout(() => setDone(d => d === id ? null : d), 8000) }} />}
    </>
  )
}

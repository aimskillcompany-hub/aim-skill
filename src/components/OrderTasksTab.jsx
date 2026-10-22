import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { STATUS, PRIORITY, ACTIVE, isOverdue, shortDate, kyivTime, personName, loadPeople, errText } from '../lib/tasks'
import TaskForm from './TaskForm'

// Вкладка «Задачі» в замовленні: задачі, прив'язані до цього замовлення (entity_type = 'order'), і створення нової.
export default function OrderTasksTab({ o }) {
  const { user } = useUser()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [people, setPeople] = useState([])
  const [form, setForm] = useState(false)
  const [err, setErr] = useState(null)
  const load = () => supabase.from('tasks').select('*').eq('entity_type', 'order').eq('entity_id', o.id)
    .order('created_at', { ascending: false })
    .then(({ data, error }) => { if (error) { setErr(errText(error)); setRows([]) } else setRows(data || []) })
  useEffect(() => { load(); loadPeople().then(setPeople) }, [o.id])
  const P = (id) => people.find(p => p.id === id)
  const active = (rows || []).filter(ACTIVE), closed = (rows || []).filter(t => !ACTIVE(t))

  const Row = ({ t }) => {
    const s = STATUS[t.status] || STATUS.new
    const late = isOverdue(t)
    return (
      <div onClick={() => navigate(`/tasks?task=${t.id}`)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: s.dot, flex: '0 0 auto' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: ACTIVE(t) ? 'var(--text)' : 'var(--text3)' }}>{t.title}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '0 8px', fontWeight: 600 }}>{s.label}</span>
            {t.due_date && <span style={{ color: late ? '#b91c1c' : undefined, fontWeight: late ? 600 : 400 }}>{late ? 'Прострочено · ' : ''}{shortDate(t.due_date)}{t.due_at && kyivTime(t.due_at) !== '18:00' ? ' ' + kyivTime(t.due_at) : ''}</span>}
            <span>{personName(P(t.assignee_id))}</span>
            {t.priority !== 'normal' && <span style={{ color: PRIORITY[t.priority]?.fg === '#fff' ? '#dc2626' : PRIORITY[t.priority]?.fg }}>{PRIORITY[t.priority]?.label}</span>}
          </div>
        </div>
        <i className="ti ti-chevron-right" style={{ color: 'var(--text3)' }} />
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <b>Задачі по замовленню</b>
        <button className="btn btn-primary btn-sm" onClick={() => setForm(true)}><i className="ti ti-plus" /> Створити задачу</button>
      </div>
      {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
      {rows == null ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Завантаження…</p>
        : !rows.length ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Задач по цьому замовленню ще немає.</p>
        : <>
          {active.map(t => <Row key={t.id} t={t} />)}
          {closed.length > 0 && <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>Виконані та скасовані ({closed.length})</summary>{closed.map(t => <Row key={t.id} t={t} />)}</details>}
        </>}
      {form && <TaskForm task={{ entity_type: 'order', entity_id: o.id, priority: 'normal', assignee_id: user?.id }} people={people} me={user?.id} lockOrder
        onClose={() => setForm(false)} onSaved={() => { setForm(false); load() }} />}
    </div>
  )
}

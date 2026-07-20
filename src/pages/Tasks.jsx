import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'

const PRIORITY = {
  high: { label: 'Високий', color: 'var(--red)', bg: 'var(--red-bg)' },
  normal: { label: 'Звичайний', color: 'var(--text2)', bg: 'var(--surface2)' },
  low: { label: 'Низький', color: 'var(--text3)', bg: 'var(--surface2)' },
}
const todayStr = () => new Date().toISOString().slice(0, 10)

export default function Tasks() {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('open') // open | done | all
  const [edit, setEdit] = useState(null) // task or {} for new

  const load = async () => {
    const { data } = await supabase.from('tasks').select('*')
      .order('status').order('due_date', { nullsFirst: false }).order('created_at', { ascending: false })
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const toggle = async (t) => {
    const done = t.status !== 'done'
    await supabase.from('tasks').update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null }).eq('id', t.id)
    load()
  }
  const remove = async (t) => { if (confirm('Видалити задачу?')) { await supabase.from('tasks').delete().eq('id', t.id); load() } }

  const view = useMemo(() => {
    const list = (rows || []).filter(t => filter === 'all' ? true : filter === 'done' ? t.status === 'done' : t.status !== 'done')
    return list
  }, [rows, filter])

  const openCount = (rows || []).filter(t => t.status !== 'done').length
  const overdue = (rows || []).filter(t => t.status !== 'done' && t.due_date && t.due_date < todayStr()).length

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Задачі</h1>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
            Активних: <b>{openCount}</b>{overdue > 0 && <span style={{ color: 'var(--red)' }}> · прострочено: {overdue}</span>}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setEdit({ priority: 'normal' })}><i className="ti ti-plus" /> Нова задача</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[['open', 'Активні'], ['done', 'Виконані'], ['all', 'Усі']].map(([k, lbl]) => (
          <button key={k} className="btn" onClick={() => setFilter(k)}
            style={{ background: filter === k ? 'var(--blue)' : 'var(--surface)', color: filter === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>{lbl}</button>
        ))}
      </div>

      <div className="card">
        {rows == null ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p>
          : view.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Задач немає. Додай першу — «Нова задача».</p>
          : view.map(t => {
            const done = t.status === 'done'
            const late = !done && t.due_date && t.due_date < todayStr()
            const today = !done && t.due_date === todayStr()
            const p = PRIORITY[t.priority] || PRIORITY.normal
            return (
              <div key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" checked={done} onChange={() => toggle(t)} style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer' }} />
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setEdit(t)}>
                  <div style={{ fontWeight: 500, textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text3)' : 'var(--text)' }}>{t.title}</div>
                  {t.description && <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>{t.description}</div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    {t.due_date && <span style={{ color: late ? 'var(--red)' : today ? 'var(--amber, #b45309)' : 'var(--text3)', fontWeight: late || today ? 600 : 400 }}>
                      <i className="ti ti-calendar" /> {t.due_date}{late ? ' · прострочено' : today ? ' · сьогодні' : ''}
                    </span>}
                    {t.priority !== 'normal' && <span style={{ background: p.bg, color: p.color, borderRadius: 6, padding: '1px 8px', fontWeight: 600 }}>{p.label}</span>}
                    {t.source === 'bot' && <span style={{ color: 'var(--text3)' }}><i className="ti ti-brand-telegram" /> з бота</span>}
                  </div>
                </div>
                <button className="btn" onClick={() => remove(t)} style={{ padding: '2px 8px', color: 'var(--red)' }} title="Видалити"><i className="ti ti-trash" /></button>
              </div>
            )
          })}
      </div>

      {edit && <TaskModal task={edit} userId={user?.id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </div>
  )
}

function TaskModal({ task, userId, onClose, onSaved }) {
  const isEdit = !!task.id
  const [title, setTitle] = useState(task.title || '')
  const [desc, setDesc] = useState(task.description || '')
  const [due, setDue] = useState(task.due_date || '')
  const [priority, setPriority] = useState(task.priority || 'normal')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const save = async () => {
    if (!title.trim()) { setErr('Вкажи назву задачі'); return }
    setBusy(true); setErr(null)
    const payload = { title: title.trim(), description: desc.trim() || null, due_date: due || null, priority }
    let error
    if (isEdit) ({ error } = await supabase.from('tasks').update(payload).eq('id', task.id))
    else ({ error } = await supabase.from('tasks').insert({ ...payload, created_by: userId || null, source: 'app' }))
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header"><h2>{isEdit ? 'Задача' : 'Нова задача'}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group"><label>Що зробити *</label><input className="form-input" value={title} autoFocus onChange={e => setTitle(e.target.value)} placeholder="Напр. подзвонити ПРООН щодо оплати" /></div>
          <div className="form-group"><label>Деталі (опц.)</label><input className="form-input" value={desc} onChange={e => setDesc(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}><label>Термін</label><input type="date" className="form-input" value={due} onChange={e => setDue(e.target.value)} /></div>
            <div className="form-group" style={{ flex: 1 }}><label>Пріоритет</label>
              <select className="form-input" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="low">Низький</option><option value="normal">Звичайний</option><option value="high">Високий</option>
              </select>
            </div>
          </div>
          {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={onClose}>Скасувати</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Зберегти'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

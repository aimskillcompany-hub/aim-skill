import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PRIORITY, kyivTime, dueAtFrom, personName, loadPeople, createTask, updateTask, errText } from '../lib/tasks'

// Створення / редагування задачі. Прив'язка до замовлення: поле «Замовлення» (або передано з картки замовлення).
//   task: наявна задача або заготовка { entity_type: 'order', entity_id, title, … }
export default function TaskForm({ task, people: peopleIn, me, onClose, onSaved, lockOrder = false }) {
  const isEdit = !!task.id
  const tmInit = task.due_at ? kyivTime(task.due_at) : ''
  const [people, setPeople] = useState(peopleIn || [])
  const [orders, setOrders] = useState([])
  const [f, setF] = useState({
    title: task.title || '', description: (task.description || '').replace(/\n*Звірка:\s*\/inventory\/recon\?\S+\s*$/, ''),
    assignee_id: task.assignee_id || me, due: task.due_date || '', time: tmInit === '18:00' ? '' : tmInit, start_date: task.start_date || '',
    priority: task.priority || 'normal', requires_review: task.requires_review ?? false,
    order_id: task.entity_type === 'order' ? task.entity_id : '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  useEffect(() => { if (!peopleIn?.length) loadPeople().then(setPeople) }, [])
  // замовлення для прив'язки (останні 300 + поточне)
  const otherEntity = task.entity_type && task.entity_type !== 'order'
  useEffect(() => {
    if (lockOrder || otherEntity) return
    supabase.from('orders').select('id, order_number, contractors(name)').order('created_at', { ascending: false }).limit(300)
      .then(({ data }) => setOrders(data || []))
  }, [])
  const keepRecon = (task.description || '').match(/\n*Звірка:\s*\/inventory\/recon\?\S+\s*$/)?.[0] || ''

  const save = async () => {
    if (!f.title.trim()) { setErr('Вкажіть, що зробити'); return }
    setBusy(true); setErr(null)
    const row = { title: f.title.trim().slice(0, 200), description: (f.description.trim() + keepRecon) || null, assignee_id: f.assignee_id || me,
      due_at: dueAtFrom(f.due, f.time), start_date: f.start_date || null, priority: f.priority, requires_review: !!f.requires_review }
    if (!otherEntity) {   // прив'язка до замовлення (звірку / документ не перезаписуємо)
      Object.assign(row, f.order_id
        ? { entity_type: 'order', entity_id: f.order_id, entity_ref: `/orders/${f.order_id}` }
        : { entity_type: null, entity_id: null, entity_ref: null })
    }
    try {
      if (isEdit) { await updateTask(task.id, row); onSaved(task.id) } else onSaved(await createTask(row))
    } catch (e) { setErr(errText(e)) }
    setBusy(false)
  }
  const ord = orders.find(o => o.id === f.order_id)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header"><h2>{isEdit ? 'Редагувати задачу' : 'Нова задача'}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group"><label>Що зробити * <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{f.title.length}/200</span></label>
            <input className="form-input" value={f.title} maxLength={200} autoFocus onChange={e => set('title', e.target.value)} /></div>
          <div className="form-group"><label>Опис — постановка, очікуваний результат</label>
            <textarea className="form-input" rows={3} value={f.description} onChange={e => set('description', e.target.value)} style={{ resize: 'vertical', height: 'auto' }} /></div>
          {!otherEntity && (lockOrder
            ? <div style={{ fontSize: 13, color: 'var(--text2)' }}><i className="ti ti-shopping-cart" /> Задача буде прив'язана до цього замовлення</div>
            : <div className="form-group"><label>Замовлення (необов'язково)</label>
                <select className="form-input" value={f.order_id || ''} onChange={e => set('order_id', e.target.value)}>
                  <option value="">— без прив'язки —</option>
                  {f.order_id && !ord && <option value={f.order_id}>поточне замовлення</option>}
                  {orders.map(o => <option key={o.id} value={o.id}>№{o.order_number || o.id.slice(0, 6)}{o.contractors?.name ? ` · ${o.contractors.name}` : ''}</option>)}
                </select></div>)}
          <div className="form-grid">
            <div className="form-group"><label>Відповідальний *</label>
              <select className="form-input" value={f.assignee_id || ''} onChange={e => { set('assignee_id', e.target.value); if (!isEdit) set('requires_review', e.target.value !== me) }}>
                {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
              </select></div>
            <div className="form-group"><label>Пріоритет</label>
              <select className="form-input" value={f.priority} onChange={e => set('priority', e.target.value)}>
                {Object.entries(PRIORITY).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select></div>
            <div className="form-group"><label>Термін</label><input type="date" className="form-input" value={f.due} onChange={e => set('due', e.target.value)} /></div>
            <div className="form-group"><label>Час (без часу — 18:00)</label><input type="time" className="form-input" value={f.time} onChange={e => set('time', e.target.value)} /></div>
            <div className="form-group"><label>Початок</label><input type="date" className="form-input" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></div>
            <div className="form-group"><label>&nbsp;</label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}><input type="checkbox" checked={f.requires_review} onChange={e => set('requires_review', e.target.checked)} /> Потребує перевірки (приймає постановник)</label></div>
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

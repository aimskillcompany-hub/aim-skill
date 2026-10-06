import { useEffect, useState } from 'react'
import { useUser } from '../lib/auth'
import { listMinutes, createMinute, updateMinute, deleteMinute } from '../lib/minutes'

// Протоколи нарад: зберігаємо обговорення й ухвалені рішення (відповідальний/строк/статус).
const today = () => new Date().toISOString().slice(0, 10)
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const emptyDecision = () => ({ text: '', owner: '', due: '', done: false })

export default function MeetingMinutes() {
  const { user } = useUser()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null) // об'єкт протоколу або {new:true}

  const reload = () => { setErr(null); listMinutes().then(setList).catch(e => setErr(e.message)) }
  useEffect(() => { reload() }, [])

  if (err) return <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}{/meeting_minutes/.test(err) ? ' — запустіть міграцію 063.' : ''}</div>
  if (!list) return <p style={{ color: 'var(--text3)' }}>Завантаження…</p>

  if (editing) return <Editor rec={editing} userId={user?.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: 0 }}>Протоколи нарад: обговорення й ухвалені рішення. За потреби — повертайтесь і відмічайте виконання.</p>
        <button className="btn btn-primary" onClick={() => setEditing({ new: true, meeting_date: today(), title: '', participants: '', notes: '', decisions: [emptyDecision()] })}>
          <i className="ti ti-plus" /> Новий протокол
        </button>
      </div>

      {list.length === 0 ? (
        <div className="card"><p style={{ color: 'var(--text3)' }}>Протоколів ще немає. Створіть перший.</p></div>
      ) : list.map(m => {
        const dec = Array.isArray(m.decisions) ? m.decisions : []
        const open = dec.filter(x => !x.done).length
        return (
          <div key={m.id} className="card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => setEditing(m)}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{m.title}</span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{d(m.meeting_date)}</span>
              {m.participants && <span style={{ fontSize: 12, color: 'var(--text3)' }}>· {m.participants}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>
                рішень: {dec.length}{open > 0 && <b style={{ color: '#D97706' }}> · {open} відкрито</b>}
              </span>
            </div>
            {dec.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--text2)' }}>
                {dec.slice(0, 3).map((x, i) => (
                  <li key={i} style={{ textDecoration: x.done ? 'line-through' : 'none', color: x.done ? 'var(--text3)' : 'var(--text2)' }}>
                    {x.text || '—'}{x.owner ? ` (${x.owner}${x.due ? ', до ' + d(x.due) : ''})` : ''}
                  </li>
                ))}
                {dec.length > 3 && <li style={{ color: 'var(--text3)', listStyle: 'none' }}>… ще {dec.length - 3}</li>}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Editor({ rec, userId, onClose, onSaved }) {
  const isNew = !!rec.new
  const [date, setDate] = useState(rec.meeting_date || today())
  const [title, setTitle] = useState(rec.title || '')
  const [participants, setParticipants] = useState(rec.participants || '')
  const [notes, setNotes] = useState(rec.notes || '')
  const [decisions, setDecisions] = useState(Array.isArray(rec.decisions) && rec.decisions.length ? rec.decisions : [emptyDecision()])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const setDec = (i, k, v) => setDecisions(ds => ds.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const addDec = () => setDecisions(ds => [...ds, emptyDecision()])
  const rmDec = (i) => setDecisions(ds => ds.filter((_, j) => j !== i))

  const save = async () => {
    if (!title.trim()) { setErr('Вкажіть назву/тему наради'); return }
    setBusy(true); setErr(null)
    try {
      const clean = decisions.filter(x => (x.text || '').trim())
      const payload = { meeting_date: date, title, participants, notes, decisions: clean }
      if (isNew) await createMinute({ ...payload, userId })
      else await updateMinute(rec.id, payload)
      onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!confirm('Видалити протокол? Дію не можна скасувати.')) return
    setBusy(true)
    try { await deleteMinute(rec.id); onSaved() } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="card" style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button className="btn" onClick={onClose}><i className="ti ti-arrow-left" /></button>
        <h2 style={{ margin: 0, fontSize: 18 }}>{isNew ? 'Новий протокол' : 'Протокол наради'}</h2>
        {!isNew && <button className="btn" onClick={remove} disabled={busy} style={{ marginLeft: 'auto', color: 'var(--red)' }}><i className="ti ti-trash" /> Видалити</button>}
      </div>

      <div className="form-grid">
        <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="form-group full"><label>Тема наради *</label><input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Напр. Підсумки вересня, план закупівель" /></div>
        <div className="form-group full"><label>Учасники</label><input className="form-input" value={participants} onChange={e => setParticipants(e.target.value)} placeholder="Хто був присутній" /></div>
        <div className="form-group full"><label>Обговорення</label><textarea className="form-input" rows={5} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Перебіг обговорення, аргументи, цифри…" /></div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', margin: '14px 0 8px' }}>Ухвалені рішення</div>
      {decisions.map((x, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', paddingTop: 10 }} title="Виконано">
            <input type="checkbox" checked={!!x.done} onChange={e => setDec(i, 'done', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
          </label>
          <input className="form-input" style={{ flex: '2 1 280px', textDecoration: x.done ? 'line-through' : 'none' }} value={x.text} onChange={e => setDec(i, 'text', e.target.value)} placeholder="Рішення" />
          <input className="form-input" style={{ flex: '1 1 140px' }} value={x.owner} onChange={e => setDec(i, 'owner', e.target.value)} placeholder="Відповідальний" />
          <input className="form-input" type="date" style={{ width: 150 }} value={x.due || ''} onChange={e => setDec(i, 'due', e.target.value)} title="Строк" />
          <button className="btn" onClick={() => rmDec(i)} style={{ padding: '6px 10px' }}><i className="ti ti-x" /></button>
        </div>
      ))}
      <button className="btn" onClick={addDec} style={{ marginTop: 2 }}><i className="ti ti-plus" /> Додати рішення</button>

      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <button className="btn" onClick={onClose}>Скасувати</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Зберегти'}</button>
      </div>
    </div>
  )
}

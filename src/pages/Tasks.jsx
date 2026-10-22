import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUser } from '../lib/auth'
import { todayKyiv } from '../lib/dates'
import {
  STATUS, PRIORITY, RESULT, GROUPS, ACTIVE, bucket, isOverdue, shortDate, kyivTime, dueAtFrom, parseQuick,
  loadPeople, loadTasks, createTask, updateTask, deleteTask, addWatcher, removeWatcher, addComment, loadFeed,
  describeActivity, personName, initials, avatarColor, errText,
} from '../lib/tasks'

// Планер задач (ТЗ 22.10.2026, етап 1): відповідальний, спостерігачі, статуси з перевіркою, результат, коментарі, історія.
const pill = (m) => ({ display: 'inline-block', fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '2px 10px', background: m.bg, color: m.fg, whiteSpace: 'nowrap' })
const prioStyle = (p) => { const m = PRIORITY[p] || PRIORITY.normal; return { fontSize: 12, borderRadius: 6, padding: '2px 8px', background: m.bg, color: m.fg, fontWeight: m.bold ? 600 : 400, whiteSpace: 'nowrap' } }
const Avatar = ({ person, id, size = 28 }) => (
  <span title={personName(person)} style={{ width: size, height: size, borderRadius: 999, background: avatarColor(id), color: '#fff', fontSize: Math.round(size * 0.42), fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{initials(person)}</span>
)
const dueView = (t) => {
  if (!t.due_date) return { label: 'Без терміну', style: { color: 'var(--text3)' } }
  const today = todayKyiv(), tm = t.due_at ? kyivTime(t.due_at) : ''
  const time = tm && tm !== '18:00' ? ' ' + tm : ''
  if (isOverdue(t)) return { label: `Прострочено · ${shortDate(t.due_date)}${time}`, style: { color: '#b91c1c', fontWeight: 600 } }
  if (t.due_date === today) return { label: `Сьогодні${time}`, style: { color: '#c2410c', fontWeight: 600 } }
  return { label: `${shortDate(t.due_date)}${time}`, style: { color: 'var(--text2)' } }
}

export default function Tasks() {
  const { user } = useUser()
  const me = user?.id
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState(null)
  const [people, setPeople] = useState([])
  const [scope, setScope] = useState('mine')          // mine | created | watch | all
  const [view, setView] = useState('list')            // list | board
  const [selId, setSelId] = useState(params.get('task'))
  const [quick, setQuick] = useState('')
  const [toast, setToast] = useState(null)
  const [err, setErr] = useState(null)
  const [edit, setEdit] = useState(null)
  const quickRef = useRef(null)

  const reload = () => loadTasks().then(setTasks).catch(e => { setErr(errText(e)); setTasks([]) })
  useEffect(() => { reload(); loadPeople().then(setPeople) }, [])
  const flash = (m) => { setToast(m); clearTimeout(flash.t); flash.t = setTimeout(() => setToast(null), 4000) }
  const pick = (id) => { setSelId(id); setParams(id ? { task: id } : {}, { replace: true }) }
  const P = (id) => people.find(p => p.id === id)

  const inScope = (t) => scope === 'mine' ? t.assignee_id === me
    : scope === 'created' ? t.created_by === me && t.assignee_id !== me
    : scope === 'watch' ? t.watchers.includes(me) : true
  const list = useMemo(() => (tasks || []).filter(inScope), [tasks, scope, me])
  const counts = useMemo(() => Object.fromEntries(['mine', 'created', 'watch', 'all'].map(s => [s, (tasks || []).filter(t => ACTIVE(t) && (
    s === 'mine' ? t.assignee_id === me : s === 'created' ? t.created_by === me && t.assignee_id !== me : s === 'watch' ? t.watchers.includes(me) : true)).length])), [tasks, me])
  const active = (tasks || []).filter(ACTIVE)
  const sel = (tasks || []).find(t => t.id === selId)

  const addQuick = async () => {
    const q = parseQuick(quick, people, me)
    if (!q.title) { flash('Введіть текст задачі'); return }
    try {
      const id = await createTask({ title: q.title.slice(0, 200), assignee_id: q.assignee, due_at: dueAtFrom(q.due, q.time), priority: q.priority,
        requires_review: q.assignee !== me })
      setQuick(''); await reload(); pick(id)
      if (q.assignee !== me) { setScope('created'); flash(`Призначено: ${personName(P(q.assignee))}. Результат прийматимете ви.`) } else flash('Задачу додано')
    } catch (e) { flash(errText(e)) }
  }

  const Row = ({ t }) => {
    const d = dueView(t), s = STATUS[t.status], on = t.id === selId
    return (
      <button onClick={() => pick(t.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: 'none', borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', background: on ? 'var(--blue-bg, #eff6ff)' : 'var(--surface)', boxShadow: on ? 'inset 3px 0 0 #2563eb' : 'none', color: 'var(--text)', font: 'inherit' }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: s.dot, flex: '0 0 auto' }} />
        <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.35, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' || t.status === 'cancelled' ? 'var(--text3)' : 'var(--text)' }}>{t.title}</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text3)' }}>
            <span style={pill(s)}>{s.label}</span>
            <span style={d.style}>{d.label}</span>
            {t.entity_type === 'reconciliation' && <span style={{ background: '#eef2ff', color: '#3730a3', borderRadius: 6, padding: '1px 6px' }}>зі звірки</span>}
            {t.source === 'bot' && <span><i className="ti ti-brand-telegram" /> з бота</span>}
            {t.requires_review && <span title="Результат приймає постановник">перевірка</span>}
            {t.comments > 0 && <span><i className="ti ti-message" /> {t.comments}</span>}
          </span>
        </span>
        {t.priority !== 'normal' && <span style={prioStyle(t.priority)}>{PRIORITY[t.priority]?.label}</span>}
        <Avatar person={P(t.assignee_id)} id={t.assignee_id} size={30} />
      </button>
    )
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: '1 1 240px' }}>
          <h1>Задачі</h1>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
            Активних: <b>{active.length}</b> · прострочено: <b style={{ color: '#b91c1c' }}>{active.filter(t => isOverdue(t)).length}</b> · на перевірці: <b>{active.filter(t => t.status === 'review').length}</b>
          </div>
        </div>
        <button className="btn" onClick={() => setEdit({ priority: 'normal', assignee_id: me })}><i className="ti ti-forms" /> Детальна форма</button>
        <button className="btn btn-primary" onClick={() => quickRef.current?.focus()}><i className="ti ti-plus" /> Нова задача</button>
      </div>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 10, marginBottom: 14 }}>
        <input ref={quickRef} className="form-input" value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => e.key === 'Enter' && addQuick()}
          placeholder="Швидко: «Надіслати акт ПРООН завтра 15:00 @Олена !високий»" style={{ flex: '1 1 320px', minWidth: 0, border: 'none' }} />
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>@ім'я — відповідальний · сьогодні / завтра / 25.10 · 15:00 · !високий / !терміново</span>
        <button className="btn" onClick={addQuick}>Додати</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[['mine', 'Мої'], ['created', 'Я поставив'], ['watch', 'Я спостерігаю'], ['all', 'Усі']].map(([k, l]) => (
            <button key={k} role="tab" className="btn" onClick={() => setScope(k)} style={{ background: scope === k ? '#2563eb' : 'var(--surface)', color: scope === k ? '#fff' : 'var(--text)', border: `1px solid ${scope === k ? '#2563eb' : 'var(--border)'}`, fontWeight: 600 }}>
              {l} <span style={{ opacity: 0.7 }}>{counts[k]}</span></button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 3, borderRadius: 10 }}>
          {[['list', 'Список'], ['board', 'Канбан']].map(([k, l]) => (
            <button key={k} className="btn" onClick={() => setView(k)} style={{ border: 'none', background: view === k ? 'var(--surface)' : 'transparent', boxShadow: view === k ? '0 1px 2px rgba(0,0,0,.12)' : 'none', fontWeight: 600 }}>{l}</button>
          ))}
        </div>
      </div>
      {toast && <div role="status" style={{ background: '#111827', color: '#fff', borderRadius: 10, padding: '8px 14px', fontSize: 13, marginBottom: 12, display: 'inline-block' }}>{toast}</div>}
      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 520px', minWidth: 0 }}>
          {tasks == null ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : view === 'list' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {GROUPS.map(([k, name, color]) => {
                const items = list.filter(t => bucket(t) === k)
                if (!items.length) return null
                return (
                  <section key={k} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '9px 14px', fontWeight: 700, fontSize: 13, background: 'var(--surface2)', color: color || 'var(--text)' }}>{name} <span style={{ color: 'var(--text3)', fontWeight: 500 }}>{items.length}</span></div>
                    {(k === 'done' ? items.slice(0, 30) : items).map(t => <Row key={t.id} t={t} />)}
                  </section>
                )
              })}
              {!list.length && <div className="card" style={{ color: 'var(--text3)', fontSize: 13 }}>Задач немає. Додайте рядком вище.</div>}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
              {['new', 'in_progress', 'review', 'done'].map(st => {
                const items = list.filter(t => t.status === st)
                return (
                  <div key={st} style={{ background: 'var(--surface2)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 320 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 4px 6px' }}><span style={pill(STATUS[st])}>{STATUS[st].label}</span><span style={{ color: 'var(--text3)', fontSize: 12 }}>{items.length}</span></div>
                    {items.slice(0, 50).map(t => { const d = dueView(t); return (
                      <button key={t.id} onClick={() => pick(t.id)} style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', background: 'var(--surface)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', color: 'var(--text)', font: 'inherit', border: t.id === selId ? '2px solid #2563eb' : '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>{t.title}</span>
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12 }}><span style={d.style}>{d.label}</span>{t.priority !== 'normal' && <span style={prioStyle(t.priority)}>{PRIORITY[t.priority]?.label}</span>}</span>
                        <span style={{ display: 'flex', justifyContent: 'flex-end' }}><Avatar person={P(t.assignee_id)} id={t.assignee_id} size={24} /></span>
                      </button>
                    ) })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {sel && <TaskPanel key={sel.id} task={sel} people={people} me={me} isAdmin={user?.role === 'admin'} onClose={() => pick(null)} onChanged={reload} flash={flash} onEdit={() => setEdit(sel)} />}
      </div>
      {edit && <TaskForm task={edit} people={people} me={me} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); reload(); if (id) pick(id) }} />}
    </div>
  )
}

// ── Картка задачі (панель справа) ──
function TaskPanel({ task: t, people, me, isAdmin, onClose, onChanged, flash, onEdit }) {
  const [feed, setFeed] = useState([])
  const [form, setForm] = useState(null)       // 'result' | 'return'
  const [draft, setDraft] = useState('')
  const [rtype, setRtype] = useState('full')
  const [cmt, setCmt] = useState('')
  const [busy, setBusy] = useState(false)
  const [addW, setAddW] = useState(false)
  const P = (id) => people.find(p => p.id === id)
  const loadF = () => loadFeed(t.id).then(setFeed).catch(() => setFeed([]))
  useEffect(() => { loadF() }, [t.id, t.status, t.assignee_id, t.due_at, t.comments])

  const run = async (fn, msg) => {
    setBusy(true)
    let ok = false
    try { await fn(); ok = true; if (msg) flash(msg); await onChanged(); loadF() } catch (e) { flash(errText(e)) }
    setBusy(false)
    return ok
  }
  const isCreator = t.created_by === me
  const isAssignee = t.assignee_id === me
  const canEdit = isCreator || isAssignee || isAdmin
  const s = STATUS[t.status], d = dueView(t)
  const submit = () => {
    if (!draft.trim()) { flash('Опишіть результат — без нього задачу не закрити'); return }
    const next = t.requires_review && !isCreator ? 'review' : 'done'
    run(() => updateTask(t.id, { result_text: draft.trim(), result_type: rtype, status: next }),
      next === 'review' ? `Передано на перевірку — ${personName(P(t.created_by))} прийме результат` : 'Задачу закрито з результатом').then(ok => { if (ok) { setForm(null); setDraft('') } })
  }
  const giveBack = () => {
    if (!draft.trim()) { flash('Напишіть, що доопрацювати'); return }
    run(async () => { await addComment(t.id, `Повернуто на доопрацювання: ${draft.trim()}`); await updateTask(t.id, { status: 'in_progress' }) }, 'Повернуто на доопрацювання')
      .then(ok => { if (ok) { setForm(null); setDraft('') } })
  }
  const recon = t.entity_ref || (t.description || '').match(/Звірка:\s*(\/inventory\/recon\?\S+)/)?.[1]
  const desc = (t.description || '').replace(/\n*Звірка:\s*\/inventory\/recon\?\S+\s*$/, '')
  const btn = (bg, fg = '#fff', border = 'none') => ({ height: 38, padding: '0 14px', borderRadius: 8, border, background: bg, color: fg, fontWeight: 600, cursor: 'pointer', font: 'inherit' })

  return (
    <aside aria-label="Картка задачі" style={{ flex: '1 1 360px', maxWidth: 480, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={pill(s)}>{s.label}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {canEdit && <button className="btn btn-sm" onClick={onEdit} title="Редагувати"><i className="ti ti-pencil" /></button>}
          <button className="btn btn-sm" onClick={onClose} aria-label="Закрити картку"><i className="ti ti-x" /></button>
        </span>
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>{t.title}</h2>
        {desc && <p style={{ margin: '8px 0 0', color: 'var(--text2)', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{desc}</p>}
        {recon && <Link to={recon} style={{ fontSize: 13, display: 'inline-block', marginTop: 6 }}><i className="ti ti-arrows-exchange" /> Відкрити в звірці</Link>}
      </div>

      {/* дії */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {t.status === 'new' && (isAssignee || isCreator) && <button disabled={busy} style={btn('#2563eb')} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), 'Взято в роботу')}>Взяти в роботу</button>}
        {['new', 'in_progress'].includes(t.status) && (isAssignee || isCreator) && <button disabled={busy} style={btn('#111827')} onClick={() => { setForm('result'); setDraft(t.result_text || ''); setRtype(t.result_type || 'full') }}>Здати результат</button>}
        {t.status === 'review' && isCreator && <>
          <button disabled={busy} style={btn('#15803d')} onClick={() => run(() => updateTask(t.id, { status: 'done' }), `Результат прийнято`)}>Прийняти</button>
          <button disabled={busy} style={btn('var(--surface)', 'var(--text)', '1px solid var(--border)')} onClick={() => { setForm('return'); setDraft('') }}>Повернути на доопрацювання</button>
        </>}
        {t.status === 'review' && !isCreator && <span style={{ fontSize: 13, color: '#92400e', background: '#fef3c7', padding: '8px 12px', borderRadius: 8 }}>Очікує перевірки: {personName(P(t.created_by))}</span>}
        {['done', 'cancelled'].includes(t.status) && canEdit && <button disabled={busy} style={btn('var(--surface)', 'var(--text)', '1px solid var(--border)')} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), 'Відкрито знову')}>Відкрити знову</button>}
        {t.status === 'on_hold' && canEdit && <button disabled={busy} style={btn('var(--surface)', 'var(--text)', '1px solid var(--border)')} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), 'Відновлено')}>Відновити</button>}
        {ACTIVE(t) && t.status !== 'on_hold' && canEdit && <button disabled={busy} className="btn btn-sm" onClick={() => run(() => updateTask(t.id, { status: 'on_hold' }), 'Відкладено')}>Відкласти</button>}
        {ACTIVE(t) && (isCreator || isAdmin) && <button disabled={busy} className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => confirm('Скасувати задачу?') && run(() => updateTask(t.id, { status: 'cancelled' }), 'Скасовано')}>Скасувати</button>}
      </div>

      {form && <div style={{ border: '1px solid #c7d2fe', background: 'var(--surface2)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontWeight: 600, fontSize: 13 }}>{form === 'result' ? 'Результат виконання *' : 'Що доопрацювати *'}</label>
        <textarea className="form-input" rows={4} value={draft} onChange={e => setDraft(e.target.value)} autoFocus
          placeholder={form === 'result' ? 'Що зроблено, з яким результатом, що залишилось' : 'Коментар для відповідального'} style={{ resize: 'vertical' }} />
        {form === 'result' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(RESULT).map(([k, l]) => <button key={k} onClick={() => setRtype(k)} style={{ height: 30, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, font: 'inherit', border: `1px solid ${rtype === k ? '#111827' : 'var(--border)'}`, background: rtype === k ? '#111827' : 'var(--surface)', color: rtype === k ? '#fff' : 'var(--text)' }}>{l}</button>)}
        </div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy} style={btn('#111827')} onClick={form === 'result' ? submit : giveBack}>
            {form === 'return' ? 'Повернути' : t.requires_review && !isCreator ? 'Надіслати на перевірку' : 'Закрити з результатом'}</button>
          <button className="btn" onClick={() => setForm(null)}>Скасувати</button>
        </div>
      </div>}

      {t.result_text && form !== 'result' && <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 10, padding: 12, color: '#14532d' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 600, color: '#166534' }}>
          <span>Результат{t.result_type ? ` · ${RESULT[t.result_type]}` : ''}</span>
          <span style={{ fontWeight: 500 }}>{personName(P(t.result_by))}{t.result_at ? `, ${shortDate(String(t.result_at).slice(0, 10))} ${kyivTime(t.result_at)}` : ''}</span>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4, whiteSpace: 'pre-line' }}>{t.result_text}</div>
      </div>}

      {/* атрибути */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '9px 12px', alignItems: 'center', fontSize: 13 }}>
        <span style={{ color: 'var(--text3)' }}>Відповідальний</span>
        <select className="form-input" disabled={!canEdit || busy} value={t.assignee_id || ''} style={{ padding: '6px 10px', fontSize: 13, lineHeight: 1.4 }}
          onChange={e => run(() => updateTask(t.id, { assignee_id: e.target.value || null }), `Призначено: ${personName(P(e.target.value))}`)}>
          {!t.assignee_id && <option value="">—</option>}
          {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
        </select>
        <span style={{ color: 'var(--text3)' }}>Поставив</span><span>{personName(P(t.created_by))}</span>
        <span style={{ color: 'var(--text3)' }}>Спостерігачі</span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {t.watchers.map(w => <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Avatar person={P(w)} id={w} size={26} />
            {canEdit && <button className="btn btn-sm" title="Прибрати" style={{ padding: '0 4px', fontSize: 11 }} onClick={() => run(() => removeWatcher(t.id, w))}>×</button>}</span>)}
          {addW ? <select className="form-input" style={{ padding: '4px 8px', fontSize: 13, lineHeight: 1.4, width: 170 }} autoFocus onBlur={() => setAddW(false)}
              onChange={e => { setAddW(false); e.target.value && run(() => addWatcher(t.id, e.target.value)) }}>
              <option value="">обрати…</option>
              {people.filter(p => !t.watchers.includes(p.id)).map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
            </select>
            : <button className="btn btn-sm" style={{ borderStyle: 'dashed', borderRadius: 999 }} onClick={() => setAddW(true)}>+ додати</button>}
        </span>
        <span style={{ color: 'var(--text3)' }}>Термін</span><span style={d.style}>{d.label}</span>
        <span style={{ color: 'var(--text3)' }}>Пріоритет</span>
        <select className="form-input" disabled={!canEdit || busy} value={t.priority || 'normal'} style={{ padding: '6px 10px', fontSize: 13, lineHeight: 1.4 }}
          onChange={e => run(() => updateTask(t.id, { priority: e.target.value }))}>
          {Object.entries(PRIORITY).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <span style={{ color: 'var(--text3)' }}>Перевірка</span>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: isCreator ? 'pointer' : 'default' }}>
          <input type="checkbox" checked={!!t.requires_review} disabled={!isCreator || busy} onChange={e => run(() => updateTask(t.id, { requires_review: e.target.checked }))} />
          {t.requires_review ? `потрібна — приймає ${personName(P(t.created_by))}` : 'не потрібна'}
        </label>
      </div>

      {/* коментарі та історія */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Коментарі та історія</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="form-input" value={cmt} onChange={e => setCmt(e.target.value)} placeholder="Написати коментар…" style={{ padding: '7px 10px', fontSize: 13 }}
            onKeyDown={e => { if (e.key === 'Enter' && cmt.trim()) run(() => addComment(t.id, cmt.trim())).then(ok => ok && setCmt('')) }} />
          <button className="btn" disabled={!cmt.trim() || busy} onClick={() => run(() => addComment(t.id, cmt.trim())).then(ok => ok && setCmt(''))}>Надіслати</button>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {feed.map(f => <div key={f.kind + f.id} style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text2)', ...(f.kind === 'comment' ? { background: 'var(--surface2)', borderRadius: 8, padding: '6px 8px' } : {}) }}>
            <b style={{ color: 'var(--text)' }}>{f.who ? personName(P(f.who)) : 'Система'}</b>{' '}
            {f.kind === 'comment' ? <span style={{ whiteSpace: 'pre-line', color: 'var(--text)' }}>{f.body}</span> : describeActivity(f, people)}
            <span style={{ color: 'var(--text3)' }}> · {shortDate(String(f.created_at).slice(0, 10))} {kyivTime(f.created_at)}</span>
          </div>)}
        </div>
      </div>
      {(isCreator || isAdmin) && <button className="btn btn-sm" style={{ color: 'var(--red)', alignSelf: 'flex-start' }}
        onClick={() => confirm('Видалити задачу назавжди? Краще «Скасувати» — тоді лишиться історія.') && run(async () => { await deleteTask(t.id); onClose() }, 'Задачу видалено')}><i className="ti ti-trash" /> Видалити</button>}
    </aside>
  )
}

// ── Створення / редагування ──
function TaskForm({ task, people, me, onClose, onSaved }) {
  const isEdit = !!task.id
  const tmInit = task.due_at ? kyivTime(task.due_at) : ''
  const [f, setF] = useState({
    title: task.title || '', description: (task.description || '').replace(/\n*Звірка:\s*\/inventory\/recon\?\S+\s*$/, ''),
    assignee_id: task.assignee_id || me, due: task.due_date || '', time: tmInit === '18:00' ? '' : tmInit, start_date: task.start_date || '',
    priority: task.priority || 'normal', requires_review: task.requires_review ?? false,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const keepRecon = (task.description || '').match(/\n*Звірка:\s*\/inventory\/recon\?\S+\s*$/)?.[0] || ''
  const save = async () => {
    if (!f.title.trim()) { setErr('Вкажіть, що зробити'); return }
    setBusy(true); setErr(null)
    const row = { title: f.title.trim().slice(0, 200), description: (f.description.trim() + keepRecon) || null, assignee_id: f.assignee_id || me,
      due_at: dueAtFrom(f.due, f.time), start_date: f.start_date || null, priority: f.priority, requires_review: !!f.requires_review }
    try {
      if (isEdit) { await updateTask(task.id, row); onSaved(task.id) } else onSaved(await createTask(row))
    } catch (e) { setErr(errText(e)) }
    setBusy(false)
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header"><h2>{isEdit ? 'Редагувати задачу' : 'Нова задача'}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group"><label>Що зробити * <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{f.title.length}/200</span></label>
            <input className="form-input" value={f.title} maxLength={200} autoFocus onChange={e => set('title', e.target.value)} /></div>
          <div className="form-group"><label>Опис — постановка, очікуваний результат</label>
            <textarea className="form-input" rows={3} value={f.description} onChange={e => set('description', e.target.value)} style={{ resize: 'vertical' }} /></div>
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

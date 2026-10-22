import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import TaskForm from '../components/TaskForm'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { todayKyiv } from '../lib/dates'
import {
  STATUS, PRIORITY, RESULT, GROUPS, ACTIVE, bucket, isOverdue, shortDate, kyivTime, dueAtFrom, parseQuick,
  loadPeople, loadTasks, createTask, updateTask, deleteTask, addWatcher, removeWatcher, addComment, loadFeed,
  describeActivity, personName, initials, avatarColor, errText,
  loadNotifications, markNotificationsRead, subscribeNotifications, NOTIFY_PREFS, loadMyNotifySettings, saveNotifyPrefs,
  telegramLinkUrl, telegramUnlink, remindMe, loadSubtasks, addSubtasks, updateSubtask, deleteSubtask,
  loadTaskFiles, uploadTaskFiles, openTaskFile, deleteTaskFile, MAX_FILE_MB,
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
  const [showDone, setShowDone] = useState(() => { try { return localStorage.getItem('tasks.showDone') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('tasks.showDone', showDone ? '1' : '0') } catch {} }, [showDone])
  const quickRef = useRef(null)
  const [notifs, setNotifs] = useState([])
  const [bell, setBell] = useState(false)
  const [settings, setSettings] = useState(false)
  useEffect(() => {
    if (!me) return
    loadNotifications(me).then(setNotifs)
    return subscribeNotifications(me, (n) => { setNotifs(x => [n, ...x].slice(0, 40)); reload() })
  }, [me])
  const unread = notifs.filter(n => !n.read_at).length

  const reload = () => loadTasks().then(setTasks).catch(e => { setErr(errText(e)); setTasks([]) })
  useEffect(() => { reload(); loadPeople().then(setPeople) }, [])
  const flash = (m) => { setToast(m); clearTimeout(flash.t); flash.t = setTimeout(() => setToast(null), 4000) }
  const pick = (id) => { setSelId(id); setParams(id ? { task: id } : {}, { replace: true }) }
  const P = (id) => people.find(p => p.id === id)

  const mineOf = (t) => t.assignee_id === me || (t.subAssignees || []).includes(me)
  const inScope = (t) => scope === 'mine' ? mineOf(t)
    : scope === 'created' ? t.created_by === me && t.assignee_id !== me
    : scope === 'watch' ? t.watchers.includes(me) : true
  const list = useMemo(() => (tasks || []).filter(inScope), [tasks, scope, me])
  const counts = useMemo(() => Object.fromEntries(['mine', 'created', 'watch', 'all'].map(s => [s, (tasks || []).filter(t => ACTIVE(t) && (
    s === 'mine' ? mineOf(t) : s === 'created' ? t.created_by === me && t.assignee_id !== me : s === 'watch' ? t.watchers.includes(me) : true)).length])), [tasks, me])
  const active = (tasks || []).filter(ACTIVE)
  const sel = (tasks || []).find(t => t.id === selId)

  const addQuick = async () => {
    const q = parseQuick(quick, people, me)
    if (!q.title) { flash('Введіть текст задачі'); return }
    try {
      let link = {}
      if (q.orderNo) {   // «№1234» — прив'язати до замовлення
        const { data: o } = await supabase.from('orders').select('id').eq('order_number', q.orderNo).limit(1).maybeSingle()
        if (!o) { flash(`Замовлення №${q.orderNo} не знайдено`); return }
        link = { entity_type: 'order', entity_id: o.id, entity_ref: `/orders/${o.id}` }
      }
      const id = await createTask({ title: q.title.slice(0, 200), assignee_id: q.assignee, due_at: dueAtFrom(q.due, q.time), priority: q.priority,
        requires_review: q.assignee !== me, ...link })
      setQuick(''); await reload(); pick(id)
      if (q.assignee !== me) { setScope('created'); flash(`Призначено: ${personName(P(q.assignee))}. Результат прийматимете ви.`) } else flash('Задачу додано')
    } catch (e) { flash(errText(e)) }
  }

  const Row = ({ t }) => {
    const d = dueView(t), s = STATUS[t.status], on = t.id === selId
    return (
      <button onClick={() => pick(t.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: 'none', borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', background: on ? 'var(--blue-bg, #eff6ff)' : 'var(--surface)', boxShadow: on ? 'inset 3px 0 0 #2563eb' : 'none', color: 'var(--text)', fontFamily: 'inherit' }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: s.dot, flex: '0 0 auto' }} />
        <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.35, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' || t.status === 'cancelled' ? 'var(--text3)' : 'var(--text)' }}>{t.title}</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text3)' }}>
            <span style={pill(s)}>{s.label}</span>
            <span style={d.style}>{d.label}</span>
            {t.entity_type === 'reconciliation' && <span style={{ background: '#eef2ff', color: '#3730a3', borderRadius: 6, padding: '1px 6px' }}>зі звірки</span>}
            {t.entity_type === 'order' && <span style={{ background: '#ecfdf5', color: '#065f46', borderRadius: 6, padding: '1px 6px' }}><i className="ti ti-shopping-cart" /> №{t.order?.order_number || '…'}</span>}
            {t.entity_type === 'counterparty' && <span style={{ background: '#fdf4ff', color: '#86198f', borderRadius: 6, padding: '1px 6px' }}><i className="ti ti-users" /> {t.counterparty?.name || 'контрагент'}</span>}
            {t.source === 'bot' && <span><i className="ti ti-brand-telegram" /> з бота</span>}
            {t.subTotal > 0 && <span title="Підзадачі" style={{ color: t.subDone === t.subTotal ? '#166534' : undefined }}><i className="ti ti-list-check" /> {t.subDone}/{t.subTotal}</span>}
            {t.assignee_id !== me && (t.subAssignees || []).includes(me) && <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '1px 6px' }}>підзадача для вас</span>}
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
        <div style={{ position: 'relative' }}>
          <button className="btn" aria-label="Сповіщення" onClick={() => setBell(b => !b)} style={{ position: 'relative' }}>
            <i className="ti ti-bell" />
            {unread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread}</span>}
          </button>
          {bell && <div role="dialog" aria-label="Сповіщення" style={{ position: 'absolute', right: 0, top: 46, width: 380, maxWidth: '90vw', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 32px rgba(17,24,39,.15)', zIndex: 20, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <b style={{ fontSize: 14 }}>Сповіщення</b>
              <span style={{ display: 'flex', gap: 6 }}>
                {unread > 0 && <button className="btn btn-sm" onClick={async () => { await markNotificationsRead(me); setNotifs(x => x.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }))) }}>Прочитати всі</button>}
                <button className="btn btn-sm" onClick={() => { setBell(false); setSettings(true) }} title="Налаштування сповіщень і Telegram"><i className="ti ti-settings" /></button>
              </span>
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {notifs.length === 0 && <div style={{ padding: 14, fontSize: 13, color: 'var(--text3)' }}>Сповіщень немає</div>}
              {notifs.map(n => <button key={n.id} onClick={async () => { if (!n.read_at) { await markNotificationsRead(me, [n.id]); setNotifs(x => x.map(y => y.id === n.id ? { ...y, read_at: new Date().toISOString() } : y)) } if (n.task_id) pick(n.task_id); setBell(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none', borderBottom: '1px solid var(--border)', background: n.read_at ? 'var(--surface)' : 'var(--blue-bg, #eff6ff)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)' }}>
                <div style={{ fontSize: 13, fontWeight: n.read_at ? 400 : 600 }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 2 }}>{n.body}</div>}
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{shortDate(String(n.created_at).slice(0, 10))} {kyivTime(n.created_at)}</div>
              </button>)}
            </div>
          </div>}
        </div>
        <button className="btn" onClick={() => setSettings(true)}><i className="ti ti-brand-telegram" /> Сповіщення</button>
        <button className="btn" onClick={() => setEdit({ priority: 'normal', assignee_id: me })}><i className="ti ti-forms" /> Детальна форма</button>
        <button className="btn btn-primary" onClick={() => quickRef.current?.focus()}><i className="ti ti-plus" /> Нова задача</button>
      </div>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 10, marginBottom: 14 }}>
        <input ref={quickRef} className="form-input" value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => e.key === 'Enter' && addQuick()}
          placeholder="Швидко: «Надіслати акт ПРООН завтра 15:00 @Олена !високий №1234»" style={{ flex: '1 1 320px', minWidth: 0, border: 'none' }} />
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>@ім'я — відповідальний · сьогодні / завтра / 25.10 · 15:00 · !високий / !терміново · №замовлення</span>
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
                const folded = k === 'done' && !showDone      // виконані — згорнуті, відкриваються за потреби
                return (
                  <section key={k} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                    {k === 'done'
                      ? <button onClick={() => setShowDone(v => !v)} aria-expanded={!folded} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13, background: 'var(--surface2)', color: color, border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          <i className={`ti ti-chevron-${folded ? 'right' : 'down'}`} />{name} <span style={{ color: 'var(--text3)', fontWeight: 500 }}>{items.length}</span>
                          <span style={{ marginLeft: 'auto', fontWeight: 500, fontSize: 12, color: 'var(--text3)' }}>{folded ? 'показати' : 'сховати'}</span>
                        </button>
                      : <div style={{ padding: '9px 14px', fontWeight: 700, fontSize: 13, background: 'var(--surface2)', color: color || 'var(--text)' }}>{name} <span style={{ color: 'var(--text3)', fontWeight: 500 }}>{items.length}</span></div>}
                    {!folded && (k === 'done' ? items.slice(0, 50) : items).map(t => <Row key={t.id} t={t} />)}
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
                      <button key={t.id} onClick={() => pick(t.id)} style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', background: 'var(--surface)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit', border: t.id === selId ? '2px solid #2563eb' : '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>{t.title}</span>
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12 }}><span style={d.style}>{d.label}</span>{t.priority !== 'normal' && <span style={prioStyle(t.priority)}>{PRIORITY[t.priority]?.label}</span>}</span>
                        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text3)' }}>
                          <span>{t.subTotal > 0 ? `☑ ${t.subDone}/${t.subTotal}` : ''}</span><Avatar person={P(t.assignee_id)} id={t.assignee_id} size={24} /></span>
                      </button>
                    ) })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {sel && <TaskPanel key={sel.id} task={sel} people={people} me={me} isAdmin={user?.role === 'admin'} onClose={() => pick(null)} onChanged={reload} flash={flash} onEdit={() => setEdit(sel)} onOpen={(id) => { reload().then(() => pick(id)) }} />}
      </div>
      {settings && <NotifySettings me={me} onClose={() => setSettings(false)} />}
      {edit && <TaskForm task={edit} people={people} me={me} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); reload(); if (id) pick(id) }} />}
    </div>
  )
}

// ── Картка задачі (редизайн 22.10: вся робоча область; ліворуч — задача, підзадачі, коментарі; праворуч — властивості) ──
const C = { line: 'var(--border, #eceef1)', soft: 'var(--surface2, #f3f4f6)', muted: 'var(--text3, #6b7280)', text: 'var(--text, #111827)' }
const STEPS = ['new', 'in_progress', 'review', 'done']
const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const dueLong = (t) => {
  if (!t.due_date) return null
  const d = new Date(t.due_date + 'T12:00:00Z'), today = todayKyiv()
  const diff = Math.round((Date.parse(t.due_date) - Date.parse(today)) / 864e5)
  const tm = t.due_at ? kyivTime(t.due_at) : ''
  const rel = isOverdue(t) ? 'прострочено' : diff === 0 ? 'сьогодні' : diff === 1 ? 'завтра' : diff > 1 ? `через ${diff} ${diff < 5 ? 'дні' : 'днів'}` : ''
  return { main: `${WD[d.getUTCDay()]}, ${shortDate(t.due_date)}${tm && tm !== '18:00' ? ' ' + tm : ''}`, rel, late: isOverdue(t) }
}
const ghostBtn = { border: 'none', background: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }

function TaskPanel({ task: t, people, me, isAdmin, onClose, onChanged, flash, onEdit, onOpen }) {
  const [feed, setFeed] = useState([])
  const [form, setForm] = useState(null)       // 'result' | 'return'
  const [draft, setDraft] = useState('')
  const [rtype, setRtype] = useState('full')
  const [cmt, setCmt] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [tab, setTab] = useState('comments')
  const [addW, setAddW] = useState(false)
  const P = (id) => people.find(p => p.id === id)
  const loadF = () => loadFeed(t.id).then(setFeed).catch(() => setFeed([]))
  useEffect(() => { loadF() }, [t.id, t.status, t.assignee_id, t.due_at, t.comments, t.subDone, t.subTotal])
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-bg')) { if (menu) setMenu(false); else onClose() } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose, menu])

  const run = async (fn, msg) => {
    setBusy(true); setMenu(false)
    let ok = false
    try { await fn(); ok = true; if (msg) flash(msg); await onChanged(); loadF() } catch (e) { flash(errText(e)) }
    setBusy(false)
    return ok
  }
  const isCreator = t.created_by === me, isAssignee = t.assignee_id === me
  const canEdit = isCreator || isAssignee || isAdmin
  const s = STATUS[t.status] || STATUS.new
  const submit = () => {
    if (!draft.trim()) { flash('Опишіть результат — без нього задачу не закрити'); return }
    const open = (t.subTotal || 0) - (t.subDone || 0)
    if (open > 0 && !confirm(`Невиконаних підзадач: ${open}. Все одно здати результат?`)) return
    const next = t.requires_review && !isCreator ? 'review' : 'done'
    run(() => updateTask(t.id, { result_text: draft.trim(), result_type: rtype, status: next }),
      next === 'review' ? `Надіслано на перевірку — ${personName(P(t.created_by))} прийме результат` : 'Задачу закрито').then(ok => { if (ok) { setForm(null); setDraft('') } })
  }
  const giveBack = () => {
    if (!draft.trim()) { flash('Напишіть, що доопрацювати'); return }
    run(async () => { await addComment(t.id, `Повернуто на доопрацювання: ${draft.trim()}`); await updateTask(t.id, { status: 'in_progress' }) }, 'Повернуто на доопрацювання')
      .then(ok => { if (ok) { setForm(null); setDraft('') } })
  }
  // зміна статусу з панелі: «На перевірці» / «Виконано» без результату — спершу форма результату
  const changeStatus = (st) => {
    if (st === t.status) return
    if ((st === 'review' || st === 'done') && !(t.result_text || '').trim()) {
      setForm('result'); setDraft(''); setRtype('full')
      flash(st === 'review' ? 'Опишіть результат — і задача піде на перевірку' : 'Опишіть результат — без нього задачу не закрити')
      return
    }
    if (st === 'done' && t.requires_review && !isCreator) { flash(`Задача потребує перевірки — прийняти її може ${personName(P(t.created_by))}`); return }
    if (st === 'cancelled' && !confirm('Скасувати задачу?')) return
    run(() => updateTask(t.id, { status: st }), `Статус: ${STATUS[st].label}`)
  }
  const duplicate = () => run(async () => {
    const id = await createTask({ title: `${t.title} (копія)`.slice(0, 200), description: t.description, assignee_id: t.assignee_id, priority: t.priority,
      due_at: t.due_at, start_date: t.start_date, requires_review: t.requires_review, entity_type: t.entity_type, entity_id: t.entity_id, entity_ref: t.entity_ref })
    const subs = await loadSubtasks(t.id).catch(() => [])
    if (subs.length) await addSubtasks(id, subs.map(x => ({ text: x.text, assignee_id: x.assignee_id, due_date: x.due_date })))
    onOpen?.(id)
  }, 'Створено копію задачі')
  const copyLink = async () => { try { await navigator.clipboard.writeText(window.location.href) ; flash('Посилання скопійовано') } catch { flash(window.location.href) } setMenu(false) }

  const recon = (t.entity_type === 'reconciliation' ? t.entity_ref : null) || (t.description || '').match(/Звірка:\s*(\/inventory\/recon\?\S+)/)?.[1]
  const desc = (t.description || '').replace(/\n*Звірка:\s*\/inventory\/recon\?\S+\s*$/, '')
  const btn = (bg) => ({ height: 38, padding: '0 16px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' })
  const outline = { height: 38, padding: '0 14px', borderRadius: 8, border: '1px solid #d1d5db', background: 'var(--surface, #fff)', color: C.text, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }
  const due = dueLong(t)
  const idx = STEPS.indexOf(t.status)
  const comments = feed.filter(f => f.kind === 'comment').slice().reverse()       // старіші зверху, нові — над полем вводу
  const history = feed.filter(f => f.kind !== 'comment')
  const sendComment = () => cmt.trim() && run(() => addComment(t.id, cmt.trim())).then(ok => ok && setCmt(''))
  const propRow = { textAlign: 'left', borderRadius: 8, padding: '8px 10px', minHeight: 40, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text, boxSizing: 'border-box', position: 'relative' }
  const hiddenSelect = { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }
  const card = { background: 'var(--surface, #fff)', border: `1px solid ${C.line}`, borderRadius: 14 }

  // головна дія за статусом (верхня смуга)
  let primary = null, secondary = null
  if (t.status === 'new' && (isAssignee || isCreator)) primary = <button disabled={busy} style={btn('#2563eb')} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), 'Задачу взято в роботу')}>Взяти в роботу</button>
  if (t.status === 'in_progress' && (isAssignee || isCreator) && form !== 'result') primary = <button disabled={busy} style={btn('#111827')} onClick={() => { setForm('result'); setDraft(t.result_text || ''); setRtype(t.result_type || 'full') }}>Здати результат</button>
  if (t.status === 'review' && isCreator) {
    primary = <button disabled={busy} style={btn('#15803d')} onClick={() => run(() => updateTask(t.id, { status: 'done' }), 'Результат прийнято')}>Прийняти</button>
    secondary = <button disabled={busy} className="tk-ghost" style={outline} onClick={() => { setForm('return'); setDraft('') }}>Повернути</button>
  }
  if (['done', 'on_hold', 'cancelled'].includes(t.status) && canEdit) secondary = <button disabled={busy} className="tk-ghost" style={outline} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), t.status === 'done' ? 'Відкрито знову' : 'Відновлено')}>{t.status === 'done' ? 'Відкрити знову' : 'Відновити'}</button>

  return (
    <>
    <style>{`.task-full{position:fixed;top:0;right:0;bottom:0;left:240px;z-index:180;background:var(--bg, #f6f7f9);overflow-y:auto;animation:taskIn .16s ease;border-left:1px solid var(--border)}
      @keyframes taskIn{from{opacity:.4}to{opacity:1}}
      .tk-ghost:hover,.tk-prop:hover,.tk-menuitem:hover{background:var(--surface2, #f3f4f6)!important}
      .tk-sub:hover{background:var(--surface2, #fafafa)} .tk-step:hover{background:var(--surface2, #f3f4f6)} .tk-step:hover span:first-child{filter:brightness(.92)} .tk-sub:hover .tk-subx{opacity:1!important}
      .tk-body{padding:28px;display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start;max-width:1240px;width:100%;box-sizing:border-box}
      .tk-left{flex:999 1 520px;min-width:0;display:flex;flex-direction:column;gap:24px}
      .tk-right{flex:1 1 300px;max-width:360px;min-width:0;display:flex;flex-direction:column;gap:16px;position:sticky;top:76px}
      @media (max-width:768px){.task-full{left:0;border-left:none}.tk-body{padding:16px 16px 96px;gap:18px}.tk-right{max-width:none;position:static;order:-1}.tk-crumb{display:none!important}}`}</style>
    <div className="task-full" role="dialog" aria-label="Картка задачі">
      {/* верхня смуга */}
      <div style={{ height: 60, padding: '0 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: `1px solid ${C.line}`, background: 'var(--surface, #fff)', position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.muted, minWidth: 0 }}>
          <button className="tk-ghost" onClick={onClose} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', color: C.muted, fontSize: 13 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>Задачі</button>
          <span className="tk-crumb" aria-hidden="true">/</span>
          <span className="tk-crumb" style={{ color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          {primary}{secondary}
          <button aria-label="Більше дій" className="tk-ghost" onClick={() => setMenu(m => !m)} style={{ width: 38, height: 38, borderRadius: 8, border: `1px solid ${C.line}`, background: 'var(--surface, #fff)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          <button aria-label="Закрити задачу" className="tk-ghost" onClick={onClose} style={{ ...ghostBtn, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          {menu && <div role="menu" style={{ position: 'absolute', right: 46, top: 46, width: 230, background: 'var(--surface, #fff)', border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: '0 12px 32px rgba(17,24,39,0.12)', padding: 6, zIndex: 20, display: 'flex', flexDirection: 'column' }}>
            {canEdit && <button role="menuitem" className="tk-menuitem" style={{ ...ghostBtn, textAlign: 'left', padding: '10px 12px', fontSize: 13 }} onClick={() => { setMenu(false); onEdit() }}>Редагувати</button>}
            {t.status === 'new' && (isAssignee || isCreator) && <button role="menuitem" className="tk-menuitem" style={{ ...ghostBtn, textAlign: 'left', padding: '10px 12px', fontSize: 13 }} onClick={() => { setMenu(false); setForm('result'); setDraft(''); setRtype('full') }}>Здати результат одразу</button>}
            {ACTIVE(t) && t.status !== 'on_hold' && canEdit && <button role="menuitem" className="tk-menuitem" style={{ ...ghostBtn, textAlign: 'left', padding: '10px 12px', fontSize: 13 }} onClick={() => run(() => updateTask(t.id, { status: 'on_hold' }), 'Задачу відкладено')}>Відкласти</button>}
            <button role="menuitem" className="tk-menuitem" style={{ ...ghostBtn, textAlign: 'left', padding: '10px 12px', fontSize: 13 }} onClick={copyLink}>Скопіювати посилання</button>
            <button role="menuitem" className="tk-menuitem" style={{ ...ghostBtn, textAlign: 'left', padding: '10px 12px', fontSize: 13 }} onClick={duplicate}>Дублювати</button>
            {(isCreator || isAdmin) && <>
              <div style={{ height: 1, background: C.line, margin: '4px 0' }} />
              {ACTIVE(t) && <button role="menuitem" className="tk-menuitem" style={{ ...ghostBtn, textAlign: 'left', padding: '10px 12px', fontSize: 13, color: '#b91c1c' }} onClick={() => confirm('Скасувати задачу?') && run(() => updateTask(t.id, { status: 'cancelled' }), 'Задачу скасовано')}>Скасувати задачу</button>}
              <button role="menuitem" className="tk-menuitem" style={{ ...ghostBtn, textAlign: 'left', padding: '10px 12px', fontSize: 13, color: '#b91c1c' }} onClick={() => confirm('Видалити задачу назавжди? Краще «Скасувати» — тоді лишиться історія.') && run(async () => { await deleteTask(t.id); onClose() }, 'Задачу видалено')}>Видалити</button>
            </>}
          </div>}
        </div>
      </div>

      <div className="tk-body">
        {/* ── ліворуч ── */}
        <div className="tk-left">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.title}</h1>
            <div style={{ fontSize: 13, color: C.muted }}>Поставив {personName(P(t.created_by))} · {shortDate(String(t.created_at).slice(0, 10))}, {kyivTime(t.created_at)}{t.source === 'bot' ? ' · з Telegram' : ''}</div>
          </div>

          {/* етапи */}
          <div style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {STEPS.map((k, i) => {
                const passed = idx >= 0 && i <= idx, cur = i === idx
                return <li key={k}>
                  <button type="button" className={canEdit && !cur ? 'tk-step' : undefined} disabled={!canEdit || busy || cur} onClick={() => changeStatus(k)}
                    title={canEdit && !cur ? `Перевести в «${STATUS[k].label}»` : undefined} aria-current={cur ? 'step' : undefined}
                    style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, border: 'none', background: 'none', padding: '4px 2px', borderRadius: 8, textAlign: 'left', cursor: canEdit && !cur ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                    <span style={{ display: 'block', width: '100%', height: 6, borderRadius: 999, background: passed ? (t.status === 'done' ? '#16a34a' : '#2563eb') : '#e5e7eb' }} />
                    <span style={{ fontSize: 13, fontWeight: cur ? 700 : 400, color: cur ? C.text : passed ? 'var(--text2, #374151)' : C.muted }}>{STATUS[k].label}</span>
                  </button>
                </li>
              })}
            </ol>
            {t.status === 'review' && !isCreator && <div style={{ fontSize: 13, color: 'var(--text2, #4b5563)' }}>Чекає на перевірку: {personName(P(t.created_by))}</div>}
            {['on_hold', 'cancelled'].includes(t.status) && <div style={{ fontSize: 13, color: 'var(--text2, #4b5563)' }}>{STATUS[t.status].label}</div>}
          </div>

          {form && <section style={{ ...card, borderColor: '#c7d2fe', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 0 0 4px #eef2ff' }}>
            <label htmlFor="tk-res" style={{ fontWeight: 600, fontSize: 15 }}>{form === 'result' ? 'Результат виконання' : 'Що доопрацювати'}</label>
            <textarea id="tk-res" value={draft} onChange={e => setDraft(e.target.value)} rows={4} autoFocus
              placeholder={form === 'result' ? 'Що зроблено, з яким результатом, що залишилось' : 'Коментар для відповідального'}
              style={{ border: '1px solid #d1d5db', borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.5, resize: 'vertical', background: 'var(--surface, #fff)', color: C.text, fontFamily: 'inherit' }} />
            {form === 'result' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(RESULT).map(([k, l]) => <button key={k} onClick={() => setRtype(k)} aria-pressed={rtype === k} style={{ height: 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: `1px solid ${rtype === k ? '#111827' : '#d1d5db'}`, background: rtype === k ? '#111827' : 'var(--surface, #fff)', color: rtype === k ? '#fff' : 'var(--text2, #374151)' }}>{l}</button>)}
            </div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="tk-ghost" style={{ ...ghostBtn, height: 38, padding: '0 14px', fontSize: 13 }} onClick={() => setForm(null)}>Скасувати</button>
              <button disabled={busy} style={btn('#111827')} onClick={form === 'result' ? submit : giveBack}>
                {form === 'return' ? 'Повернути на доопрацювання' : t.requires_review && !isCreator ? 'Надіслати на перевірку' : 'Закрити задачу'}</button>
            </div>
          </section>}

          {t.result_text && form !== 'result' && <section style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6, color: '#14532d' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#166534' }}>Результат{t.result_type ? ` · ${RESULT[t.result_type]}` : ''} · {personName(P(t.result_by))}{t.result_at ? `, ${shortDate(String(t.result_at).slice(0, 10))} ${kyivTime(t.result_at)}` : ''}</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-line' }}>{t.result_text}</div>
          </section>}

          {/* опис */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.muted }}>Опис</h2>
              {canEdit && <button className="tk-ghost" onClick={onEdit} style={{ ...ghostBtn, fontSize: 13, color: 'var(--text2, #4b5563)', padding: '6px 8px' }}>Редагувати</button>}
            </div>
            {desc ? <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: C.text, whiteSpace: 'pre-line' }}>{desc}</p>
              : <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Опису немає.</p>}
          </section>

          <Subtasks t={t} people={people} canEdit={canEdit || (t.subAssignees || []).includes(me)} onChanged={onChanged} />

          {/* коментарі / історія */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div role="tablist" style={{ display: 'flex', gap: 18, borderBottom: '1px solid #e5e7eb' }}>
              {[['comments', `Коментарі${comments.length ? ` · ${comments.length}` : ''}`], ['history', 'Історія']].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ border: 'none', background: 'none', padding: '10px 2px', marginBottom: -1, cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', color: tab === k ? C.text : C.muted, borderBottom: `2px solid ${tab === k ? '#111827' : 'transparent'}` }}>{l}</button>
              ))}
            </div>
            {tab === 'comments' ? <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {comments.map(c => <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                <Avatar person={P(c.who)} id={c.who} size={32} />
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 13 }}><strong>{personName(P(c.who))}</strong> <span style={{ color: C.muted }}>· {shortDate(String(c.created_at).slice(0, 10))}, {kyivTime(c.created_at)}</span></div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 2, whiteSpace: 'pre-line' }}>{c.body}</div></div>
              </div>)}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Avatar person={P(me)} id={me} size={32} />
                <div style={{ flex: '1 1 auto', border: '1px solid #d1d5db', borderRadius: 12, background: 'var(--surface, #fff)', overflow: 'hidden' }}>
                  <textarea value={cmt} onChange={e => setCmt(e.target.value)} rows={2} placeholder="Напишіть коментар… @ — згадати колегу" aria-label="Коментар"
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComment() } }}
                    style={{ width: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', padding: '10px 12px', fontSize: 14, resize: 'none', background: 'transparent', color: C.text, fontFamily: 'inherit' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px 8px 12px' }}>
                    <span style={{ fontSize: 12, color: C.muted }}>Ctrl + Enter — надіслати</span>
                    <button onClick={sendComment} disabled={!cmt.trim() || busy} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: cmt.trim() ? 'pointer' : 'default', fontFamily: 'inherit', background: cmt.trim() ? '#111827' : '#f3f4f6', color: cmt.trim() ? '#fff' : '#6b7280' }}>Надіслати</button>
                  </div>
                </div>
              </div>
            </div> : <ol style={{ listStyle: 'none', margin: 0, padding: '0 0 0 4px', display: 'flex', flexDirection: 'column', gap: 12, borderLeft: `2px solid ${C.line}` }}>
              {history.map(h => <li key={h.id} style={{ paddingLeft: 14, fontSize: 13, color: 'var(--text2, #4b5563)' }}>
                <strong style={{ color: C.text }}>{h.who ? personName(P(h.who)) : 'Система'}</strong> {describeActivity(h, people)} <span style={{ color: C.muted }}>· {shortDate(String(h.created_at).slice(0, 10))}, {kyivTime(h.created_at)}</span></li>)}
              {!history.length && <li style={{ paddingLeft: 14, fontSize: 13, color: C.muted }}>Історії ще немає.</li>}
            </ol>}
          </section>
        </div>

        {/* ── праворуч: властивості ── */}
        <aside aria-label="Властивості задачі" className="tk-right">
          <div style={{ ...card, padding: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', alignItems: 'center', rowGap: 2, fontSize: 13 }}>
              <span style={{ color: C.muted, padding: '0 10px' }}>Статус</span>
              <label className="tk-prop" style={{ ...propRow, cursor: canEdit ? 'pointer' : 'default' }} title={canEdit ? 'Змінити статус' : undefined}>
                <span style={pill(s)}>{s.label}</span>{canEdit && <i className="ti ti-chevron-down" style={{ color: C.muted, fontSize: 14 }} />}
                {canEdit && <select aria-label="Статус" disabled={busy} value={t.status} style={hiddenSelect} onChange={e => changeStatus(e.target.value)}>
                  {Object.entries(STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>}
              </label>

              <span style={{ color: C.muted, padding: '0 10px' }}>Відповідальний</span>
              <label className="tk-prop" style={{ ...propRow, cursor: canEdit ? 'pointer' : 'default' }}>
                <Avatar person={P(t.assignee_id)} id={t.assignee_id} size={24} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{personName(P(t.assignee_id))}</span>
                {canEdit && <select aria-label="Відповідальний" disabled={busy} value={t.assignee_id || ''} style={hiddenSelect}
                  onChange={e => run(() => updateTask(t.id, { assignee_id: e.target.value || null }), `Призначено: ${personName(P(e.target.value))}`)}>
                  {!t.assignee_id && <option value="">—</option>}
                  {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
                </select>}
              </label>

              <span style={{ color: C.muted, padding: '0 10px' }}>Спостерігачі</span>
              <div className="tk-prop" style={{ ...propRow, flexWrap: 'wrap', gap: 4 }}>
                {t.watchers.map(w => <span key={w} title={personName(P(w))} style={{ display: 'inline-flex', alignItems: 'center' }}><Avatar person={P(w)} id={w} size={24} />
                  {canEdit && <button aria-label="Прибрати" onClick={() => run(() => removeWatcher(t.id, w))} style={{ ...ghostBtn, padding: '0 3px', color: C.muted, fontSize: 13 }}>×</button>}</span>)}
                {addW ? <select autoFocus onBlur={() => setAddW(false)} style={{ fontSize: 13, padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'var(--surface, #fff)', color: C.text }}
                    onChange={e => { setAddW(false); e.target.value && run(() => addWatcher(t.id, e.target.value)) }}>
                    <option value="">обрати…</option>
                    {people.filter(p => !t.watchers.includes(p.id)).map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
                  </select>
                  : <button onClick={() => setAddW(true)} style={{ ...ghostBtn, fontSize: 13, color: C.muted, padding: '2px 4px' }}>+ Додати</button>}
              </div>

              <span style={{ color: C.muted, padding: '0 10px' }}>Термін</span>
              <button className="tk-prop" onClick={canEdit ? onEdit : undefined} style={{ ...ghostBtn, ...propRow, cursor: canEdit ? 'pointer' : 'default' }} title={canEdit ? 'Змінити термін' : undefined}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                {due ? <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
                    <span style={{ color: due.late ? '#b91c1c' : C.text, fontWeight: due.late ? 600 : 400, whiteSpace: 'nowrap' }}>{due.main}</span>
                    {due.rel && <span style={{ fontSize: 12, color: due.late ? '#b91c1c' : C.muted }}>{due.rel}</span>}</span>
                  : <span style={{ color: C.muted }}>Без терміну</span>}
              </button>

              <span style={{ color: C.muted, padding: '0 10px' }}>Пріоритет</span>
              <label className="tk-prop" style={{ ...propRow, cursor: canEdit ? 'pointer' : 'default', color: ['high', 'urgent'].includes(t.priority) ? '#b91c1c' : C.text, fontWeight: ['high', 'urgent'].includes(t.priority) ? 600 : 400 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: t.priority === 'urgent' ? '#b91c1c' : t.priority === 'high' ? '#dc2626' : t.priority === 'low' ? '#9ca3af' : '#2563eb' }} />{PRIORITY[t.priority]?.label || 'Звичайний'}
                {canEdit && <select aria-label="Пріоритет" disabled={busy} value={t.priority || 'normal'} style={hiddenSelect} onChange={e => run(() => updateTask(t.id, { priority: e.target.value }))}>
                  {Object.entries(PRIORITY).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>}
              </label>

              <span style={{ color: C.muted, padding: '0 10px' }}>Перевірка</span>
              <label className="tk-prop" style={{ ...propRow, cursor: isCreator ? 'pointer' : 'default', gap: 10 }}>
                <input type="checkbox" checked={!!t.requires_review} disabled={!isCreator || busy} onChange={e => run(() => updateTask(t.id, { requires_review: e.target.checked }))} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
                <span style={{ position: 'relative', width: 34, height: 20, borderRadius: 999, flex: '0 0 auto', transition: 'background .15s', background: t.requires_review ? '#2563eb' : '#d1d5db', opacity: isCreator ? 1 : 0.6 }}>
                  <span style={{ position: 'absolute', top: 2, left: t.requires_review ? 16 : 2, width: 16, height: 16, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left .15s' }} /></span>
                <span style={{ fontSize: 13 }}>{t.requires_review ? `Перевіряє ${personName(P(t.created_by))}` : 'Без перевірки'}</span>
              </label>
            </div>

            {(t.entity_type === 'order' || t.entity_type === 'counterparty' || recon) && <div style={{ margin: '8px 2px 4px', padding: 12, borderRadius: 10, background: 'var(--surface2, #f8fafc)', border: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Привʼязано до</div>
              {[
                t.entity_type === 'order' && t.entity_id && { to: `/orders/${t.entity_id}`, icon: 'ti-shopping-cart', title: `Замовлення №${t.order?.order_number || t.entity_id.slice(0, 6)}`, sub: t.order?.contractors?.name },
                t.entity_type === 'counterparty' && t.entity_id && { to: `/contractors/${t.entity_id}`, icon: 'ti-users', title: t.counterparty?.name || 'Контрагент', sub: 'контрагент' },
                recon && { to: recon, icon: 'ti-arrows-exchange', title: 'Звірка видаткових', sub: 'відкрити проблемний рядок' },
              ].filter(Boolean).map(x => <Link key={x.to} to={x.to} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: C.text }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', color: '#4338ca' }}><i className={`ti ${x.icon}`} /></span>
                <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{x.title}</span>
                  {x.sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--text2, #4b5563)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.sub}</span>}</span>
              </Link>)}
            </div>}
          </div>

          {ACTIVE(t) && <Reminders t={t} canEdit={canEdit} busy={busy} run={run} />}
        </aside>
      </div>
    </div>
    </>
  )
}

// ── Нагадування (картка праворуч): за 24 год / за 1 год / у момент терміну + «Нагадати мені…» ──
function Reminders({ t, canEdit, busy, run }) {
  const offs = t.remind_offsets || [1440, 60]
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState('')
  const toggle = (m) => run(() => updateTask(t.id, { remind_offsets: offs.includes(m) ? offs.filter(x => x !== m) : [...offs, m].sort((a, b) => b - a) }),
    offs.includes(m) ? 'Нагадування вимкнено' : 'Нагадування увімкнено — прийде в додаток і Telegram')
  const chip = (on, clickable = true) => ({ height: 30, padding: '0 10px', borderRadius: 999, cursor: clickable ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
    border: `1px solid ${on ? '#bfdbfe' : '#e5e7eb'}`, background: on ? '#eff6ff' : 'var(--surface, #fff)', color: on ? '#1d4ed8' : '#6b7280' })
  return (
    <div style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #eceef1)', borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Нагадування</h2>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {[[1440, 'За 24 год'], [60, 'За 1 год']].map(([m, l]) => <button key={m} disabled={!canEdit || busy || !t.due_at} aria-pressed={offs.includes(m)} style={chip(offs.includes(m))} onClick={() => toggle(m)}>{l}</button>)}
        <span style={{ ...chip(!!t.due_at, false), display: 'inline-flex', alignItems: 'center' }} title="Завжди — відповідальному й постановнику">У момент терміну</span>
        {!open && <button className="tk-ghost" onClick={() => setOpen(true)} style={{ height: 30, padding: '0 10px', borderRadius: 999, border: '1px dashed #d1d5db', background: 'none', fontSize: 12, color: 'var(--text2, #374151)', cursor: 'pointer', fontFamily: 'inherit' }}>+ Нагадати мені…</button>}
      </div>
      {open && <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} autoFocus style={{ padding: '4px 8px', fontSize: 13, height: 32, border: '1px solid #d1d5db', borderRadius: 8, background: 'var(--surface, #fff)', color: 'var(--text)' }} />
        <button className="btn btn-sm" disabled={!at || busy} onClick={() => run(() => remindMe(t.id, at), 'Нагадаю в додатку та Telegram').then(ok => { if (ok) { setAt(''); setOpen(false) } })}>OK</button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>×</button>
      </div>}
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45 }}>{t.due_at ? 'У додаток і Telegram відповідальному. Якщо прострочено — щодня о 09:00.' : 'Задайте термін, щоб працювали нагадування до терміну.'}</div>
    </div>
  )
}

// ── Налаштування сповіщень і підключення Telegram (кожен — для себе) ──
function NotifySettings({ me, onClose }) {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => loadMyNotifySettings(me).then(setSt).catch(e => setErr(errText(e)))
  useEffect(() => { load() }, [me])
  const toggle = async (k) => {
    const prefs = { ...st.prefs, [k]: st.prefs[k] === false }
    setSt({ ...st, prefs })
    try { await saveNotifyPrefs(prefs) } catch (e) { setErr(errText(e)) }
  }
  const connect = async () => {
    setBusy(true); setErr(null)
    try { window.open(await telegramLinkUrl(), '_blank') } catch (e) { setErr(errText(e)) }
    setBusy(false)
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Сповіщення</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        {!st ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <i className="ti ti-brand-telegram" style={{ fontSize: 20, color: '#229ED9' }} />
              <b style={{ flex: 1 }}>Telegram {st.linked ? '— підключено' : '— не підключено'}</b>
              {st.linked
                ? <button className="btn btn-sm" disabled={busy} onClick={async () => { await telegramUnlink().catch(e => setErr(errText(e))); load() }}>Відключити</button>
                : <button className="btn btn-primary btn-sm" disabled={busy} onClick={connect}>{busy ? '…' : 'Підключити Telegram'}</button>}
            </div>
            {!st.linked && <div style={{ color: 'var(--text3)', marginTop: 6 }}>Відкриється бот — натисніть у ньому «Start». Посилання діє 15 хвилин. Потім оновіть це вікно.</div>}
            {st.linked && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={load}>Оновити</button>}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Що надсилати в Telegram</div>
            {NOTIFY_PREFS.map(([k, l]) => <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={st.prefs[k] !== false} onChange={() => toggle(k)} /> {l}</label>)}
            <div style={{ color: 'var(--text3)', marginTop: 6 }}>У додатку (дзвіночок) видно всі сповіщення. Тихі години 22:00–08:00 — Telegram-повідомлення приходять вранці.</div>
          </div>
          {err && <div style={{ color: 'var(--red)' }}>{err}</div>}
        </div>}
      </div>
    </div>
  )
}

// ── Підзадачі (редизайн): рядки з галочкою, терміном і виконавцем; «+ Додати підзадачу — Enter» ──
function Subtasks({ t, people, canEdit, onChanged }) {
  const [items, setItems] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [files, setFiles] = useState([])
  const [res, setRes] = useState(null)          // id підзадачі з відкритою формою результату
  const load = () => {
    loadTaskFiles(t.id).then(setFiles).catch(() => setFiles([]))
    return loadSubtasks(t.id).then(x => { setItems(x); setErr(null) }).catch(e => { setItems([]); setErr(errText(e)) })
  }
  useEffect(() => { load() }, [t.id])
  const act = async (fn) => {
    setBusy(true); setErr(null)
    let ok = false
    try { await fn(); ok = true; await load(); onChanged() } catch (e) { setErr(errText(e)) }
    setBusy(false)
    return ok
  }
  const addLines = (raw) => {
    const lines = String(raw).split('\n').map(x => x.trim()).filter(Boolean)
    if (!lines.length) return
    act(() => addSubtasks(t.id, lines, (items || []).length)).then(ok => ok && setText(''))
  }
  if (items == null) return null
  const done = items.filter(x => x.done).length
  const pct = items.length ? Math.round(done / items.length * 100) : 0
  const today = todayKyiv()
  const line = 'var(--border, #f3f4f6)'
  return (
    <section style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #eceef1)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Підзадачі</h2>
        <span style={{ fontSize: 13, color: '#6b7280' }}>{done} з {items.length}</span>
        <span style={{ flex: '1 1 auto', height: 6, background: 'var(--surface2, #f1f2f4)', borderRadius: 999, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: '#16a34a', borderRadius: 999 }} /></span>
      </div>
      {items.map(x => {
        const late = !x.done && x.due_date && x.due_date < today
        const who = people.find(p => p.id === x.assignee_id)
        return (
          <div key={x.id} style={{ borderTop: `1px solid ${line}` }}>
          <div className="tk-sub" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', minHeight: 44 }}>
            <input type="checkbox" aria-label="Виконано" checked={x.done} disabled={!canEdit || busy} onChange={() => act(() => updateSubtask(x.id, { done: !x.done }))}
              style={{ width: 18, height: 18, flex: '0 0 auto', accentColor: '#2563eb', cursor: canEdit ? 'pointer' : 'default' }} />
            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 14, lineHeight: 1.4, textDecoration: x.done ? 'line-through' : 'none', color: x.done ? '#9ca3af' : 'var(--text, #111827)' }}>{x.text}</span>
            {/* термін: клік відкриває календар (showPicker), × — прибрати термін */}
            <SubDue value={x.due_date} late={late} canEdit={canEdit} busy={busy} onChange={(v) => act(() => updateSubtask(x.id, { due_date: v }))} />
            {/* виконавець: аватар з прихованим списком */}
            <label title={who ? personName(who) : 'Призначити виконавця'} style={{ position: 'relative', flex: '0 0 auto', cursor: canEdit ? 'pointer' : 'default', display: 'inline-flex' }}>
              {who ? <Avatar person={who} id={who.id} size={26} />
                : <span style={{ width: 26, height: 26, borderRadius: 999, border: '1px dashed #d1d5db', color: '#9ca3af', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>+</span>}
              {canEdit && <select value={x.assignee_id || ''} disabled={busy} onChange={e => act(() => updateSubtask(x.id, { assignee_id: e.target.value || null }))}
                aria-label="Виконавець підзадачі" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}>
                <option value="">— без виконавця —</option>
                {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
              </select>}
            </label>
            {(() => { const n = files.filter(f => f.subtask_id === x.id).length, has = !!(x.result_text || '').trim() || n > 0
              return <button className="tk-ghost" title={has ? 'Результат підзадачі' : 'Додати результат: коментар і файли'} onClick={() => setRes(r => r === x.id ? null : x.id)}
                style={{ height: 28, padding: '0 6px', border: 'none', background: res === x.id ? 'var(--surface2, #f3f4f6)' : 'none', borderRadius: 6, cursor: 'pointer', color: has ? '#2563eb' : '#9ca3af', fontSize: 12, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
                <i className="ti ti-paperclip" style={{ fontSize: 15 }} />{n > 0 ? n : ''}</button> })()}
            {canEdit && <button className="tk-subx tk-ghost" aria-label="Видалити підзадачу" disabled={busy} onClick={() => confirm(`Видалити підзадачу «${x.text}»?`) && act(() => deleteSubtask(x.id))}
              style={{ opacity: 0.35, width: 28, height: 28, border: 'none', background: 'none', borderRadius: 6, cursor: 'pointer', color: '#6b7280', fontSize: 16 }}>×</button>}
          </div>
          {res !== x.id && ((x.result_text || '').trim() || files.some(f => f.subtask_id === x.id)) && <SubResultView x={x} files={files.filter(f => f.subtask_id === x.id)} people={people} onOpen={() => setRes(x.id)} />}
          {res === x.id && <SubResultForm x={x} t={t} files={files.filter(f => f.subtask_id === x.id)} canEdit={canEdit} people={people}
            onClose={() => setRes(null)} onSaved={async () => { await load(); onChanged() }} />}
          </div>
        )
      })}
      {canEdit && <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px 12px', borderTop: `1px solid ${line}` }}>
        <span style={{ color: '#9ca3af', fontSize: 18, width: 18, textAlign: 'center' }} aria-hidden="true">+</span>
        <input value={text} disabled={busy} onChange={e => setText(e.target.value)} aria-label="Нова підзадача"
          placeholder="Додати підзадачу — Enter. Можна вставити список."
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLines(text) } }}
          onPaste={e => { const v = e.clipboardData.getData('text'); if (v.includes('\n')) { e.preventDefault(); addLines(v) } }}
          style={{ flex: '1 1 auto', minWidth: 0, height: 36, border: 'none', outline: 'none', fontSize: 14, background: 'transparent', color: 'var(--text, #111827)', fontFamily: 'inherit' }} />
      </div>}
      {err && <div style={{ color: 'var(--red)', fontSize: 12.5, padding: '0 18px 12px' }}>{err}</div>}
    </section>
  )
}

// Термін підзадачі: ярлик «Без терміну» / «26 жов»; клік — календар браузера; × — очистити
function SubDue({ value, late, canEdit, busy, onChange }) {
  const ref = useRef(null)
  const open = () => {
    const el = ref.current
    if (!el || !canEdit || busy) return
    try { el.showPicker() } catch { el.focus(); el.click() }
  }
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto' }}>
      <button type="button" className="tk-ghost" onClick={open} disabled={!canEdit || busy} title={canEdit ? 'Встановити термін' : undefined}
        style={{ height: 28, padding: '0 8px', borderRadius: 6, border: 'none', background: 'none', fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap',
          color: late ? '#b91c1c' : value ? 'var(--text2, #374151)' : '#6b7280', fontWeight: late ? 600 : 400, cursor: canEdit ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <i className="ti ti-calendar" style={{ fontSize: 13 }} />{value ? shortDate(value) : 'Без терміну'}
      </button>
      {value && canEdit && <button type="button" aria-label="Прибрати термін" disabled={busy} onClick={() => onChange(null)}
        style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>×</button>}
      {/* саме поле дати — невидиме, під ярликом (для календаря) */}
      <input ref={ref} type="date" tabIndex={-1} aria-hidden="true" value={value || ''} onChange={e => onChange(e.target.value || null)}
        style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }} />
    </span>
  )
}

// результат підзадачі (перегляд): коментар і файли
function SubResultView({ x, files, people, onOpen }) {
  const who = people.find(p => p.id === x.result_by)
  return (
    <div onClick={onOpen} style={{ margin: '0 18px 10px 48px', padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, cursor: 'pointer', color: '#14532d' }}>
      {(x.result_text || '').trim() && <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{x.result_text}</div>}
      {files.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: x.result_text ? 6 : 0 }}>
        {files.map(f => <button key={f.id} onClick={e => { e.stopPropagation(); openTaskFile(f).catch(err => alert(err.message)) }}
          style={{ border: '1px solid #bbf7d0', background: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#166534' }}>
          <i className="ti ti-file" /> {f.name}</button>)}
      </div>}
      {x.result_at && <div style={{ fontSize: 11.5, color: '#4d7c0f', marginTop: 4 }}>{who ? personName(who) + ', ' : ''}{shortDate(String(x.result_at).slice(0, 10))} {kyivTime(x.result_at)}</div>}
    </div>
  )
}

// результат підзадачі (редагування): коментар + файли до 20 МБ; «Зберегти і позначити виконаною»
function SubResultForm({ x, t, files, canEdit, onClose, onSaved }) {
  const [text, setText] = useState(x.result_text || '')
  const [uploading, setUploading] = useState(null)   // назви файлів, що вантажаться
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // файл вантажиться одразу після вибору (не треба окремо «Зберегти»)
  const upload = async (list) => {
    if (!list.length) return
    setUploading(list.map(f => f.name).join(', ')); setErr(null)
    try { await uploadTaskFiles(t.id, x.id, list); await onSaved() } catch (e) { setErr(errText(e)) }
    setUploading(null)
  }
  const save = async (markDone) => {
    setBusy(true); setErr(null)
    try {
      const patch = {}
      if ((text || '') !== (x.result_text || '')) patch.result_text = text.trim() || null
      if (markDone && !x.done) patch.done = true
      if (Object.keys(patch).length) await updateSubtask(x.id, patch)
      await onSaved(); onClose()
    } catch (e) { setErr(errText(e)) }
    setBusy(false)
  }
  const del = async (f) => {
    if (!confirm(`Видалити файл «${f.name}»?`)) return
    setBusy(true)
    try { await deleteTaskFile(f); await onSaved() } catch (e) { setErr(errText(e)) }
    setBusy(false)
  }
  return (
    <div style={{ margin: '0 18px 12px 48px', padding: 12, border: '1px solid #c7d2fe', borderRadius: 10, background: 'var(--surface, #fff)', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 0 0 3px #eef2ff' }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Результат підзадачі</div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} disabled={!canEdit || busy} autoFocus placeholder="Коментар: що зроблено, номер документа, з ким домовились…"
        style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontSize: 13, lineHeight: 1.5, resize: 'vertical', background: 'var(--surface, #fff)', color: 'var(--text)' }} />
      {files.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {files.map(f => <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--border, #e5e7eb)', borderRadius: 6, padding: '2px 4px 2px 8px', fontSize: 12 }}>
          <button onClick={() => openTaskFile(f).catch(e => setErr(e.message))} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: '#1d4ed8', padding: 0 }}><i className="ti ti-file" /> {f.name}</button>
          {canEdit && <button aria-label="Видалити файл" disabled={busy} onClick={() => del(f)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af' }}>×</button>}
        </span>)}
      </div>}
      {canEdit && <label
        onDragOver={e => { e.preventDefault() }} onDrop={e => { e.preventDefault(); upload(Array.from(e.dataTransfer.files || [])) }}
        style={{ fontSize: 12.5, color: '#4b5563', border: '1px dashed #c7d2fe', borderRadius: 8, padding: 10, textAlign: 'center', cursor: uploading ? 'wait' : 'pointer', background: uploading ? '#eef2ff' : 'transparent' }}>
        <input type="file" multiple disabled={!!uploading} style={{ display: 'none' }} onChange={e => { const l = Array.from(e.target.files || []); e.target.value = ''; upload(l) }} />
        {uploading ? <>⏳ Завантажую: {uploading}…</> : <><i className="ti ti-upload" /> Перетягніть файли сюди або оберіть · PDF, фото, скани до {MAX_FILE_MB} МБ</>}
      </label>}
      {err && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={onClose} disabled={busy}>Закрити</button>
        {canEdit && <button className="btn btn-sm" onClick={() => save(false)} disabled={busy}>{busy ? '…' : 'Зберегти'}</button>}
        {canEdit && !x.done && <button className="btn btn-primary btn-sm" onClick={() => save(true)} disabled={busy}>Зберегти і позначити виконаною</button>}
      </div>
    </div>
  )
}

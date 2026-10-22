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
      <button onClick={() => pick(t.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: 'none', borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', background: on ? 'var(--blue-bg, #eff6ff)' : 'var(--surface)', boxShadow: on ? 'inset 3px 0 0 #2563eb' : 'none', color: 'var(--text)', font: 'inherit' }}>
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
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none', borderBottom: '1px solid var(--border)', background: n.read_at ? 'var(--surface)' : 'var(--blue-bg, #eff6ff)', cursor: 'pointer', font: 'inherit', color: 'var(--text)' }}>
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
                      ? <button onClick={() => setShowDone(v => !v)} aria-expanded={!folded} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13, background: 'var(--surface2)', color: color, border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
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
                      <button key={t.id} onClick={() => pick(t.id)} style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', background: 'var(--surface)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', color: 'var(--text)', font: 'inherit', border: t.id === selId ? '2px solid #2563eb' : '1px solid var(--border)' }}>
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
        {sel && <TaskPanel key={sel.id} task={sel} people={people} me={me} isAdmin={user?.role === 'admin'} onClose={() => pick(null)} onChanged={reload} flash={flash} onEdit={() => setEdit(sel)} />}
      </div>
      {settings && <NotifySettings me={me} onClose={() => setSettings(false)} />}
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
  const [feedTab, setFeedTab] = useState('comments')
  const loadF = () => loadFeed(t.id).then(setFeed).catch(() => setFeed([]))
  useEffect(() => { const h = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-bg')) onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
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
    const open = (t.subTotal || 0) - (t.subDone || 0)
    if (open > 0 && !confirm(`Невиконаних підзадач: ${open}. Все одно здати результат?`)) return
    const next = t.requires_review && !isCreator ? 'review' : 'done'
    run(() => updateTask(t.id, { result_text: draft.trim(), result_type: rtype, status: next }),
      next === 'review' ? `Передано на перевірку — ${personName(P(t.created_by))} прийме результат` : 'Задачу закрито з результатом').then(ok => { if (ok) { setForm(null); setDraft('') } })
  }
  const giveBack = () => {
    if (!draft.trim()) { flash('Напишіть, що доопрацювати'); return }
    run(async () => { await addComment(t.id, `Повернуто на доопрацювання: ${draft.trim()}`); await updateTask(t.id, { status: 'in_progress' }) }, 'Повернуто на доопрацювання')
      .then(ok => { if (ok) { setForm(null); setDraft('') } })
  }
  const recon = (t.entity_type === 'reconciliation' ? t.entity_ref : null) || (t.description || '').match(/Звірка:\s*(\/inventory\/recon\?\S+)/)?.[1]
  const desc = (t.description || '').replace(/\n*Звірка:\s*\/inventory\/recon\?\S+\s*$/, '')
  const btn = (bg, fg = '#fff', border = 'none') => ({ height: 38, padding: '0 14px', borderRadius: 8, border, background: bg, color: fg, fontWeight: 600, cursor: 'pointer', font: 'inherit' })

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
  const lbl = { fontSize: 11.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 4 }
  const selStyle = { padding: '6px 10px', fontSize: 13, lineHeight: 1.4, height: 38, width: '100%' }
  const comments = feed.filter(f => f.kind === 'comment')
  const shown = feedTab === 'comments' ? comments : feedTab === 'history' ? feed.filter(f => f.kind !== 'comment') : feed
  const sendComment = () => cmt.trim() && run(() => addComment(t.id, cmt.trim())).then(ok => ok && setCmt(''))

  return (
    <>
    {/* картка задачі на весь екран: ліворуч — задача, підзадачі, коментарі; праворуч — деталі (як у CRM) */}
    <style>{`.task-full{position:fixed;inset:0;z-index:180;background:var(--bg, #f5f6f8);overflow-y:auto;animation:taskIn .18s ease}
      @keyframes taskIn{from{opacity:.4;transform:translateY(8px)}to{opacity:1;transform:none}}
      .task-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;grid-template-areas:"head side" "body side";gap:20px 28px;max-width:1280px;margin:0 auto;padding:20px 28px 48px;align-items:start}
      .task-head{grid-area:head;display:flex;flex-direction:column;gap:14px;min-width:0}
      .task-body{grid-area:body;display:flex;flex-direction:column;gap:20px;min-width:0}
      .task-side{grid-area:side;display:flex;flex-direction:column;gap:14px;position:sticky;top:76px}
      @media (max-width:900px){.task-grid{grid-template-columns:minmax(0,1fr);grid-template-areas:"head" "side" "body";padding:14px 16px 90px}.task-side{position:static}}`}</style>
    <div className="task-full" role="dialog" aria-label="Картка задачі">
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-sm" onClick={onClose}><i className="ti ti-arrow-left" /> Задачі</button>
          <span style={pill(s)}>{s.label}</span>
          {t.priority !== 'normal' && <span style={prioStyle(t.priority)}>{PRIORITY[t.priority]?.label}</span>}
          <span style={{ ...d.style, fontSize: 13 }}><i className="ti ti-calendar" /> {d.label}</span>
          <span style={{ flex: 1 }} />
          {canEdit && <button className="btn btn-sm" onClick={onEdit} title="Редагувати назву, опис, термін"><i className="ti ti-pencil" /> Редагувати</button>}
          <button className="btn btn-sm" onClick={onClose} aria-label="Закрити картку"><i className="ti ti-x" /></button>
        </div>
      </div>

      <div className="task-grid">
        {/* ── задача ── */}
        <div className="task-head">
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.25 }}>{t.title}</h1>
          {desc && <div style={{ ...card, color: 'var(--text)', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{desc}</div>}
          {(recon || t.entity_type === 'order' || t.entity_type === 'counterparty') && <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
            {recon && <Link to={recon}><i className="ti ti-arrows-exchange" /> Відкрити в звірці</Link>}
            {t.entity_type === 'order' && t.entity_id && <Link to={`/orders/${t.entity_id}`}><i className="ti ti-shopping-cart" /> Замовлення №{t.order?.order_number || t.entity_id.slice(0, 6)}{t.order?.contractors?.name ? ` · ${t.order.contractors.name}` : ''}</Link>}
            {t.entity_type === 'counterparty' && t.entity_id && <Link to={`/contractors/${t.entity_id}`}><i className="ti ti-users" /> {t.counterparty?.name || 'Контрагент'}</Link>}
          </div>}

          {/* дії */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {t.status === 'new' && (isAssignee || isCreator) && <button disabled={busy} style={btn('#2563eb')} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), 'Взято в роботу')}>Взяти в роботу</button>}
            {['new', 'in_progress'].includes(t.status) && (isAssignee || isCreator) && <button disabled={busy} style={btn('#111827')} onClick={() => { setForm('result'); setDraft(t.result_text || ''); setRtype(t.result_type || 'full') }}>Здати результат</button>}
            {t.status === 'review' && isCreator && <>
              <button disabled={busy} style={btn('#15803d')} onClick={() => run(() => updateTask(t.id, { status: 'done' }), 'Результат прийнято')}>Прийняти</button>
              <button disabled={busy} style={btn('var(--surface)', 'var(--text)', '1px solid var(--border)')} onClick={() => { setForm('return'); setDraft('') }}>Повернути на доопрацювання</button>
            </>}
            {t.status === 'review' && !isCreator && <span style={{ fontSize: 13, color: '#92400e', background: '#fef3c7', padding: '9px 12px', borderRadius: 8 }}>Очікує перевірки: {personName(P(t.created_by))}</span>}
            {['done', 'cancelled'].includes(t.status) && canEdit && <button disabled={busy} style={btn('var(--surface)', 'var(--text)', '1px solid var(--border)')} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), 'Відкрито знову')}>Відкрити знову</button>}
            {t.status === 'on_hold' && canEdit && <button disabled={busy} style={btn('var(--surface)', 'var(--text)', '1px solid var(--border)')} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), 'Відновлено')}>Відновити</button>}
            {ACTIVE(t) && t.status !== 'on_hold' && canEdit && <button disabled={busy} style={btn('var(--surface)', 'var(--text2)', '1px solid var(--border)')} onClick={() => run(() => updateTask(t.id, { status: 'on_hold' }), 'Відкладено')}>Відкласти</button>}
            {ACTIVE(t) && (isCreator || isAdmin) && <button disabled={busy} style={btn('var(--surface)', 'var(--red)', '1px solid var(--border)')} onClick={() => confirm('Скасувати задачу?') && run(() => updateTask(t.id, { status: 'cancelled' }), 'Скасовано')}>Скасувати</button>}
          </div>

          {form && <div style={{ ...card, borderColor: '#c7d2fe', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontWeight: 600, fontSize: 13 }}>{form === 'result' ? 'Результат виконання *' : 'Що доопрацювати *'}</label>
            <textarea className="form-input" rows={4} value={draft} onChange={e => setDraft(e.target.value)} autoFocus
              placeholder={form === 'result' ? 'Що зроблено, з яким результатом, що залишилось' : 'Коментар для відповідального'} style={{ resize: 'vertical', height: 'auto' }} />
            {form === 'result' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(RESULT).map(([k, l]) => <button key={k} onClick={() => setRtype(k)} style={{ height: 30, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, font: 'inherit', border: `1px solid ${rtype === k ? '#111827' : 'var(--border)'}`, background: rtype === k ? '#111827' : 'var(--surface)', color: rtype === k ? '#fff' : 'var(--text)' }}>{l}</button>)}
            </div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} style={btn('#111827')} onClick={form === 'result' ? submit : giveBack}>
                {form === 'return' ? 'Повернути' : t.requires_review && !isCreator ? 'Надіслати на перевірку' : 'Закрити з результатом'}</button>
              <button className="btn" onClick={() => setForm(null)}>Скасувати</button>
            </div>
          </div>}

          {t.result_text && form !== 'result' && <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 12, padding: 14, color: '#14532d' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 600, color: '#166534' }}>
              <span>Результат{t.result_type ? ` · ${RESULT[t.result_type]}` : ''}</span>
              <span style={{ fontWeight: 500 }}>{personName(P(t.result_by))}{t.result_at ? `, ${shortDate(String(t.result_at).slice(0, 10))} ${kyivTime(t.result_at)}` : ''}</span>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, marginTop: 4, whiteSpace: 'pre-line' }}>{t.result_text}</div>
          </div>}
        </div>

        {/* ── підзадачі та коментарі (знизу) ── */}
        <div className="task-body">
          <div style={card}>
            <Subtasks t={t} people={people} canEdit={canEdit || (t.subAssignees || []).includes(me)} onChanged={onChanged} />
          </div>

          <div style={card}>
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
              {[['comments', `Коментарі${comments.length ? ` ${comments.length}` : ''}`], ['history', 'Історія'], ['all', 'Усе']].map(([k, l]) => (
                <button key={k} onClick={() => setFeedTab(k)} style={{ background: 'none', border: 0, borderBottom: `2px solid ${feedTab === k ? 'var(--text)' : 'transparent'}`, padding: '6px 12px', font: 'inherit', fontSize: 13, fontWeight: feedTab === k ? 700 : 500, color: feedTab === k ? 'var(--text)' : 'var(--text3)', cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            {feedTab !== 'history' && <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
              <Avatar person={P(me)} id={me} size={32} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea className="form-input" rows={2} value={cmt} onChange={e => setCmt(e.target.value)} placeholder="Написати коментар… (@ім'я — згадати колегу)"
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment() }} style={{ padding: '8px 10px', fontSize: 13, height: 'auto', resize: 'vertical' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Ctrl / ⌘ + Enter — надіслати</span>
                  <button className="btn btn-primary btn-sm" disabled={!cmt.trim() || busy} onClick={sendComment}>Надіслати</button>
                </div>
              </div>
            </div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {shown.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{feedTab === 'comments' ? 'Коментарів ще немає.' : 'Порожньо.'}</div>}
              {shown.map(f => f.kind === 'comment'
                ? <div key={'c' + f.id} style={{ display: 'flex', gap: 10 }}>
                    <Avatar person={P(f.who)} id={f.who} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}><b>{personName(P(f.who))}</b> <span style={{ color: 'var(--text3)' }}>{shortDate(String(f.created_at).slice(0, 10))} {kyivTime(f.created_at)}</span></div>
                      <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-line', marginTop: 2 }}>{f.body}</div>
                    </div>
                  </div>
                : <div key={'a' + f.id} style={{ fontSize: 12.5, color: 'var(--text2)', paddingLeft: 42 }}>
                    <b style={{ color: 'var(--text)' }}>{f.who ? personName(P(f.who)) : 'Система'}</b> {describeActivity(f, people)}
                    <span style={{ color: 'var(--text3)' }}> · {shortDate(String(f.created_at).slice(0, 10))} {kyivTime(f.created_at)}</span>
                  </div>)}
            </div>
          </div>
        </div>

        {/* ── деталі (праворуч) ── */}
        <aside className="task-side">
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Деталі</div>
            <div><div style={lbl}>Статус</div><span style={pill(s)}>{s.label}</span></div>
            <div><div style={lbl}>Відповідальний</div>
              <select className="form-input" disabled={!canEdit || busy} value={t.assignee_id || ''} style={selStyle}
                onChange={e => run(() => updateTask(t.id, { assignee_id: e.target.value || null }), `Призначено: ${personName(P(e.target.value))}`)}>
                {!t.assignee_id && <option value="">—</option>}
                {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
              </select></div>
            <div><div style={lbl}>Поставив</div><span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><Avatar person={P(t.created_by)} id={t.created_by} size={26} />{personName(P(t.created_by))}</span></div>
            <div><div style={lbl}>Спостерігачі</div>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {t.watchers.map(w => <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Avatar person={P(w)} id={w} size={26} />
                  {canEdit && <button className="btn btn-sm" title="Прибрати" style={{ padding: '0 4px', fontSize: 11 }} onClick={() => run(() => removeWatcher(t.id, w))}>×</button>}</span>)}
                {addW ? <select className="form-input" style={{ padding: '4px 8px', fontSize: 13, lineHeight: 1.4, height: 34, width: 180 }} autoFocus onBlur={() => setAddW(false)}
                    onChange={e => { setAddW(false); e.target.value && run(() => addWatcher(t.id, e.target.value)) }}>
                    <option value="">обрати…</option>
                    {people.filter(p => !t.watchers.includes(p.id)).map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
                  </select>
                  : <button className="btn btn-sm" style={{ borderStyle: 'dashed', borderRadius: 999 }} onClick={() => setAddW(true)}>+ додати</button>}
              </span></div>
            <div><div style={lbl}>Термін</div><span style={{ ...d.style, fontSize: 13 }}>{d.label}</span>{t.start_date && <div style={{ fontSize: 12, color: 'var(--text3)' }}>початок: {shortDate(t.start_date)}</div>}</div>
            <div><div style={lbl}>Пріоритет</div>
              <select className="form-input" disabled={!canEdit || busy} value={t.priority || 'normal'} style={selStyle}
                onChange={e => run(() => updateTask(t.id, { priority: e.target.value }))}>
                {Object.entries(PRIORITY).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select></div>
            <div><div style={lbl}>Перевірка результату</div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: isCreator ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={!!t.requires_review} disabled={!isCreator || busy} onChange={e => run(() => updateTask(t.id, { requires_review: e.target.checked }))} />
                {t.requires_review ? `потрібна — приймає ${personName(P(t.created_by))}` : 'не потрібна'}
              </label></div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Створено {shortDate(String(t.created_at).slice(0, 10))} {kyivTime(t.created_at)}{t.source === 'bot' ? ' · з Telegram' : t.entity_type === 'reconciliation' ? ' · зі звірки' : ''}</div>
          </div>
          {ACTIVE(t) && <div style={card}><Reminders t={t} canEdit={canEdit} busy={busy} run={run} flash={flash} /></div>}
          {(isCreator || isAdmin) && <button className="btn btn-sm" style={{ color: 'var(--red)', alignSelf: 'flex-start' }}
            onClick={() => confirm('Видалити задачу назавжди? Краще «Скасувати» — тоді лишиться історія.') && run(async () => { await deleteTask(t.id); onClose() }, 'Задачу видалено')}><i className="ti ti-trash" /> Видалити задачу</button>}
        </aside>
      </div>
    </div>
    </>
  )
}


// ── Нагадування в картці: за 24 год / за 1 год до терміну (відповідальному) + «Нагадати мені…» ──
function Reminders({ t, canEdit, busy, run, flash }) {
  const offs = t.remind_offsets || [1440, 60]
  const [at, setAt] = useState('')
  const toggle = (m) => run(() => updateTask(t.id, { remind_offsets: offs.includes(m) ? offs.filter(x => x !== m) : [...offs, m].sort((a, b) => b - a) }),
    offs.includes(m) ? 'Нагадування вимкнено' : 'Нагадування увімкнено — прийде в додаток і Telegram')
  const chip = (on) => ({ height: 30, padding: '0 12px', borderRadius: 999, cursor: canEdit ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, font: 'inherit',
    border: `1px solid ${on ? '#2563eb' : 'var(--border)'}`, background: on ? '#eff6ff' : 'var(--surface)', color: on ? '#1d4ed8' : 'var(--text2)' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Нагадування</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {[[1440, 'За 24 год'], [60, 'За 1 год']].map(([m, l]) => <button key={m} disabled={!canEdit || busy || !t.due_at} style={chip(offs.includes(m))} onClick={() => toggle(m)} aria-pressed={offs.includes(m)}>{l}</button>)}
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>+ у момент терміну; прострочені — щодня о 09:00</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>Нагадати мені</span>
        <input type="datetime-local" className="form-input" value={at} onChange={e => setAt(e.target.value)} style={{ padding: '4px 8px', fontSize: 13, height: 34, width: 200 }} />
        <button className="btn btn-sm" disabled={!at || busy} onClick={() => run(() => remindMe(t.id, at), 'Нагадаю в додатку та Telegram').then(ok => ok && setAt(''))}>OK</button>
      </div>
      {!t.due_at && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Задайте термін, щоб працювали нагадування до терміну.</div>}
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

// ── Підзадачі: пункти з галочкою, за потреби — виконавець і термін ──
function Subtasks({ t, people, canEdit, onChanged }) {
  const [items, setItems] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const load = () => loadSubtasks(t.id).then(x => { setItems(x); setErr(null) }).catch(e => { setItems([]); setErr(errText(e)) })
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
  const today = todayKyiv()
  const small = { padding: '2px 6px', fontSize: 12, height: 28, lineHeight: 1.2, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Підзадачі</span>
        {items.length > 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>{done}/{items.length}</span>}
        {items.length > 0 && <span style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 999, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${Math.round(done / items.length * 100)}%`, background: '#16a34a' }} /></span>}
      </div>
      {items.map(x => {
        const late = !x.done && x.due_date && x.due_date < today
        const who = people.find(p => p.id === x.assignee_id)
        return (
          <div key={x.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8, background: x.done ? 'var(--surface2)' : 'var(--surface)' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: canEdit ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={x.done} disabled={!canEdit || busy} onChange={() => act(() => updateSubtask(x.id, { done: !x.done }))} style={{ width: 17, height: 17, marginTop: 1, flex: '0 0 auto' }} />
              <span style={{ flex: 1, minWidth: 0, textDecoration: x.done ? 'line-through' : 'none', color: x.done ? 'var(--text3)' : 'var(--text)', lineHeight: 1.4 }}>{x.text}</span>
              {canEdit && <button className="btn btn-sm" disabled={busy} title="Видалити підзадачу" onClick={e => { e.preventDefault(); act(() => deleteSubtask(x.id)) }} style={{ padding: '0 6px', flex: '0 0 auto' }}>×</button>}
            </label>
            {canEdit ? <div style={{ display: 'flex', gap: 6, paddingLeft: 25, flexWrap: 'wrap' }}>
              <select value={x.assignee_id || ''} disabled={busy} title="Виконавець" onChange={e => act(() => updateSubtask(x.id, { assignee_id: e.target.value || null }))} style={{ ...small, maxWidth: 160 }}>
                <option value="">виконавець…</option>
                {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
              </select>
              <input type="date" value={x.due_date || ''} disabled={busy} title="Термін підзадачі" onChange={e => act(() => updateSubtask(x.id, { due_date: e.target.value || null }))}
                style={{ ...small, width: 130, color: late ? '#b91c1c' : 'var(--text)' }} />
            </div> : (who || x.due_date) && <div style={{ paddingLeft: 25, fontSize: 12, color: late ? '#b91c1c' : 'var(--text3)' }}>{who ? personName(who) : ''}{x.due_date ? ` · ${shortDate(x.due_date)}` : ''}</div>}
          </div>
        )
      })}
      {canEdit && <div style={{ position: 'relative' }}>
        <i className="ti ti-plus" style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text3)' }} />
        <input className="form-input" value={text} disabled={busy} onChange={e => setText(e.target.value)}
          placeholder="Додати підзадачу і натиснути Enter"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLines(text) } }}
          onPaste={e => { const v = e.clipboardData.getData('text'); if (v.includes('\n')) { e.preventDefault(); addLines(v) } }}
          style={{ padding: '8px 10px 8px 30px', fontSize: 13, height: 38, width: '100%' }} />
        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3 }}>Можна вставити список — кожен рядок стане підзадачею.</div>
      </div>}
      {err && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>{err}</div>}
    </div>
  )
}

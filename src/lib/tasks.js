// Планер задач (етап 1, міграція 092): статуси, групи за терміном, швидке додавання, дії з задачею.
// Правила (результат обов'язковий; «Виконано» з перевіркою — лише постановник) — у тригері бази, тут — підказки.
import { supabase } from './supabase'
import { todayKyiv, addDaysIso } from './dates'

export const STATUS = {
  new: { label: 'Нова', bg: '#f3f4f6', fg: '#374151', dot: '#9ca3af' },
  in_progress: { label: 'В роботі', bg: '#dbeafe', fg: '#1d4ed8', dot: '#2563eb' },
  review: { label: 'На перевірці', bg: '#fef3c7', fg: '#92400e', dot: '#d97706' },
  done: { label: 'Виконано', bg: '#dcfce7', fg: '#166534', dot: '#16a34a' },
  on_hold: { label: 'Відкладено', bg: '#f3f4f6', fg: '#6b7280', dot: '#a8a29e' },
  cancelled: { label: 'Скасовано', bg: '#f3f4f6', fg: '#6b7280', dot: '#9ca3af' },
}
export const PRIORITY = {
  low: { label: 'Низький', fg: '#4b5563', bg: '#f3f4f6' },
  normal: { label: 'Звичайний', fg: '#4b5563', bg: '#f3f4f6' },
  high: { label: 'Високий', fg: '#b91c1c', bg: '#fee2e2', bold: true },
  urgent: { label: 'Терміново', fg: '#fff', bg: '#dc2626', bold: true },
}
export const RESULT = { full: 'Виконано повністю', partial: 'Частково', failed: 'Не вдалося' }
export const ACTIVE = (t) => t.status !== 'done' && t.status !== 'cancelled'

// ── дата / час (Київ) ──
const fmtTime = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })
export const kyivTime = (ts) => ts ? fmtTime.format(new Date(ts)) : ''
export const dueAtFrom = (date, time) => date ? `${date} ${time || '18:00'}:00 Europe/Kyiv` : null
const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру']
export const shortDate = (iso) => iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : ''
export const isOverdue = (t, now = Date.now()) => ACTIVE(t) && t.status !== 'on_hold' && !!t.due_at && new Date(t.due_at).getTime() < now

// група «Мої задачі»: прострочені · сьогодні · цього тижня · пізніше · без терміну · відкладені · виконані
export function bucket(t, today = todayKyiv()) {
  if (!ACTIVE(t)) return 'done'
  if (t.status === 'on_hold') return 'hold'
  if (isOverdue(t)) return 'overdue'
  if (!t.due_date) return 'nodate'
  if (t.due_date === today) return 'today'
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7   // пн = 0
  if (t.due_date <= addDaysIso(today, 6 - dow)) return 'week'
  return 'later'
}
export const GROUPS = [
  ['overdue', 'Прострочені', '#b91c1c'], ['today', 'Сьогодні', '#c2410c'], ['week', 'Цього тижня', null],
  ['later', 'Пізніше', null], ['nodate', 'Без терміну', null], ['hold', 'Відкладені', '#6b7280'], ['done', 'Виконані та скасовані', '#166534'],
]

export const personName = (p) => p ? (p.full_name || p.email || '—') : '—'
export const initials = (p) => (personName(p).trim()[0] || '?').toUpperCase()
const COLORS = ['#1f2937', '#1d4ed8', '#9a3412', '#047857', '#7c3aed', '#be185d', '#0e7490']
export const avatarColor = (id) => COLORS[[...String(id || '')].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length]

// ── швидке додавання: «Надіслати акт ПРООН завтра 15:00 @Олена !високий» ──
export function parseQuick(raw, people, meId) {
  let text = ` ${raw} `
  let assignee = meId, due = null, time = null, priority = 'normal'
  for (const p of people) {
    const first = personName(p).split(/\s+/)[0]
    if (!first) continue
    const stem = first.length > 3 ? first.slice(0, -1) : first        // «@олені», «@Олено» → Олена
    const re = new RegExp(`\\s@${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\S*`, 'i')
    if (re.test(text)) { assignee = p.id; text = text.replace(re, ' ') }
  }
  const today = todayKyiv()
  const words = [[/\sсьогодні\s/i, 0], [/\sзавтра\s/i, 1], [/\sпіслязавтра\s/i, 2]]
  for (const [re, n] of words) if (re.test(text)) { due = addDaysIso(today, n); text = text.replace(re, ' ') }
  const dm = text.match(/\s(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s/)
  if (dm) { due = `${dm[3] || today.slice(0, 4)}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`; text = text.replace(dm[0], ' ') }
  const tm = text.match(/\s(\d{1,2}):(\d{2})\s/)
  if (tm) { time = `${tm[1].padStart(2, '0')}:${tm[2]}`; text = text.replace(tm[0], ' '); if (!due) due = today }
  const pr = [[/\s!термінов\S*/i, 'urgent'], [/\s!висок\S*/i, 'high'], [/\s!низьк\S*/i, 'low']]
  for (const [re, v] of pr) if (re.test(text)) { priority = v; text = text.replace(re, ' ') }
  let orderNo = null
  const om = text.match(/\s[№#]\s?([\w\-\/]+)/)
  if (om) { orderNo = om[1]; text = text.replace(om[0], ' ') }
  return { title: text.replace(/\s+/g, ' ').trim(), assignee, due, time, priority, orderNo }
}

// ── дані ──
export async function loadPeople() {
  const { data } = await supabase.from('profiles').select('id, full_name, email, role').order('full_name')
  return data || []
}
export async function loadTasks() {
  const { data, error } = await supabase.from('tasks').select('*').order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  const tasks = data || []
  const ids = tasks.map(t => t.id)
  const [w, c] = ids.length ? await Promise.all([
    supabase.from('task_watchers').select('task_id, user_id'),
    supabase.from('task_comments').select('task_id'),
  ]) : [{ data: [] }, { data: [] }]
  const watchers = {}, comments = {}
  ;(w.data || []).forEach(x => { (watchers[x.task_id] ||= []).push(x.user_id) })
  ;(c.data || []).forEach(x => { comments[x.task_id] = (comments[x.task_id] || 0) + 1 })
  // замовлення, до яких прив'язані задачі (№ і клієнт — для посилання)
  const orderIds = [...new Set(tasks.filter(t => t.entity_type === 'order' && t.entity_id).map(t => t.entity_id))]
  const orders = {}
  if (orderIds.length) {
    const { data: os } = await supabase.from('orders').select('id, order_number, contractors(name)').in('id', orderIds)
    ;(os || []).forEach(o => { orders[o.id] = o })
  }
  const cIds = [...new Set(tasks.filter(t => t.entity_type === 'counterparty' && t.entity_id).map(t => t.entity_id))]
  const cps = {}
  if (cIds.length) {
    const { data: cs } = await supabase.from('contractors').select('id, name').in('id', cIds)
    ;(cs || []).forEach(c => { cps[c.id] = c })
  }
  return tasks.map(t => ({ ...t, watchers: watchers[t.id] || [], comments: comments[t.id] || 0,
    order: t.entity_type === 'order' ? orders[t.entity_id] || null : null,
    counterparty: t.entity_type === 'counterparty' ? cps[t.entity_id] || null : null }))
}

export const errText = (e) => {
  const m = e?.message || String(e || '')
  if (/tasks_status_check|assignee_id|task_watchers|RESULT_REQUIRED|REVIEW_REQUIRED/.test(m)) return m.replace(/^[A-Z_]+:\s*/, '')
  if (/column .* does not exist|relation .*task_/.test(m)) return 'Застосуйте міграцію 092 (планер задач)'
  if (/notifications|telegram_link_code|set_notify_prefs|task_remind_me|schema cache/.test(m)) return 'Застосуйте міграцію 093 (нагадування)'
  return m
}

export async function updateTask(id, patch) {
  const { error } = await supabase.from('tasks').update(patch).eq('id', id)
  if (error) throw new Error(errText(error))
}
export async function createTask(row) {
  const { data, error } = await supabase.from('tasks').insert({ source: 'app', status: 'new', ...row }).select('id').single()
  if (error) throw new Error(errText(error))
  return data.id
}
export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw new Error(errText(error))
}
export async function addWatcher(taskId, userId) {
  const { error } = await supabase.from('task_watchers').insert({ task_id: taskId, user_id: userId })
  if (error && !/duplicate/.test(error.message)) throw new Error(errText(error))
}
export async function removeWatcher(taskId, userId) {
  const { error } = await supabase.from('task_watchers').delete().eq('task_id', taskId).eq('user_id', userId)
  if (error) throw new Error(errText(error))
}
export async function addComment(taskId, body) {
  const { error } = await supabase.from('task_comments').insert({ task_id: taskId, body })
  if (error) throw new Error(errText(error))
}

// стрічка «Коментарі та історія» (новіші зверху)
export async function loadFeed(taskId) {
  const [c, a] = await Promise.all([
    supabase.from('task_comments').select('id, author_id, body, created_at').eq('task_id', taskId),
    supabase.from('task_activity').select('id, actor_id, action, old_value, new_value, created_at').eq('task_id', taskId),
  ])
  return [...(c.data || []).map(x => ({ ...x, kind: 'comment', who: x.author_id })), ...(a.data || []).map(x => ({ ...x, kind: 'activity', who: x.actor_id }))]
    .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
}
export function describeActivity(a, people) {
  const name = (id) => personName(people.find(p => p.id === id))
  const nv = a.new_value, ov = a.old_value
  switch (a.action) {
    case 'created': return `створив(ла) задачу${nv?.assignee_id ? ` і призначив(ла): ${name(nv.assignee_id)}` : ''}`
    case 'status': {
      if (ov === 'review' && nv === 'in_progress') return 'повернув(ла) на доопрацювання'
      if (ov === 'review' && nv === 'done') return 'прийняв(ла) результат'
      if (nv === 'review') return 'здав(ла) результат на перевірку'
      if (nv === 'done') return 'закрив(ла) задачу з результатом'
      if (nv === 'in_progress' && ov === 'new') return 'взяв(ла) у роботу'
      return `статус: ${STATUS[ov]?.label || ov || '—'} → ${STATUS[nv]?.label || nv}`
    }
    case 'assignee': return `призначив(ла): ${name(nv)}`
    case 'due': return `термін: ${nv ? `${shortDate(String(nv).slice(0, 10))} ${kyivTime(nv)}` : 'без терміну'}`
    case 'priority': return `пріоритет: ${PRIORITY[nv]?.label || nv}`
    case 'review': return nv ? 'увімкнув(ла) перевірку результату' : 'вимкнув(ла) перевірку результату'
    case 'result': return `записав(ла) результат${nv?.type ? ` (${RESULT[nv.type]})` : ''}`
    default: return a.action
  }
}

// лічильник у меню: мої прострочені + на сьогодні
export async function myTaskBadge(userId) {
  if (!userId) return 0
  const { data, error } = await supabase.from('tasks').select('id, status, due_at, due_date').eq('assignee_id', userId).not('status', 'in', '(done,cancelled,on_hold)')
  if (error) return 0
  const today = todayKyiv()
  return (data || []).filter(t => isOverdue(t) || t.due_date === today).length
}

// ── сповіщення (етап 2, міграція 093) ──
export async function loadNotifications(userId) {
  if (!userId) return []
  const { data } = await supabase.from('notifications').select('id, task_id, kind, title, body, read_at, created_at').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(40)
  return data || []
}
export async function markNotificationsRead(userId, ids = null) {
  let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null)
  if (ids) q = q.in('id', ids)
  await q
}
// нові сповіщення одразу (Supabase Realtime); повертає функцію відписки
export function subscribeNotifications(userId, onNew) {
  if (!userId) return () => {}
  const ch = supabase.channel('notif-' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => onNew(p.new))
    .subscribe()
  return () => { supabase.removeChannel(ch) }
}
export const NOTIFY_PREFS = [
  ['assigned', 'Мені призначили задачу'], ['due', 'Термін наближається / настав'], ['overdue', 'Задачу прострочено (щодня о 09:00)'],
  ['review', 'Перевірка: здано / прийнято / повернуто'], ['comment', 'Коментарі та @згадки'], ['digest', 'Ранковий дайджест (робочі дні 08:30)'],
]
export async function loadMyNotifySettings(userId) {
  const { data } = await supabase.from('profiles').select('telegram_chat_id, notify_prefs').eq('id', userId).maybeSingle()
  return { linked: !!data?.telegram_chat_id, prefs: data?.notify_prefs || {} }
}
export async function saveNotifyPrefs(prefs) {
  const { error } = await supabase.rpc('set_notify_prefs', { p: prefs })
  if (error) throw new Error(errText(error))
}
// «Підключити Telegram»: одноразовий код (15 хв) → посилання на бота
export async function telegramLinkUrl() {
  const [{ data: code, error }, me] = await Promise.all([
    supabase.rpc('telegram_link_code'),
    fetch('/api/telegram?me=1').then(r => r.json()).catch(() => ({})),
  ])
  if (error) throw new Error(errText(error))
  if (!me?.username) throw new Error('Не вдалося визначити бота (перевірте TELEGRAM_BOT_TOKEN у Vercel)')
  return `https://t.me/${me.username}?start=${code}`
}
export async function telegramUnlink() {
  const { error } = await supabase.rpc('telegram_unlink')
  if (error) throw new Error(errText(error))
}
export async function remindMe(taskId, isoLocal) {
  const { error } = await supabase.rpc('task_remind_me', { p_task: taskId, p_at: new Date(isoLocal).toISOString(), p_kind: 'custom' })
  if (error) throw new Error(errText(error))
}

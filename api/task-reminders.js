// Нагадування й сповіщення по задачах у Telegram (планер, етап 2; міграція 093).
// Викликається:
//   • pg_cron щохвилини (лише коли є що надіслати) — Authorization: Bearer <app_secrets.task_notify>;
//   • pg_cron у робочі дні 08:30 (Київ) з {"digest": true} — ранковий дайджест;
//   • Vercel Cron (Authorization: Bearer <CRON_SECRET>) — запасний щоденний дайджест.
// Сповіщення створює база (тригери / process_task_reminders); тут — лише доставка в Telegram тим, хто прив'язав бота
// у «Задачі» → «Сповіщення», з урахуванням налаштувань і тихих годин (22:00–08:00 — переносяться на ранок).
import { getAdmin } from './_lib.js'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const OWNER = (process.env.TELEGRAM_OWNER_ID || '').trim()
const APP_URL = process.env.APP_URL || 'https://aim-skill.vercel.app'
const taskUrl = (id) => `${APP_URL}/#/tasks?task=${id}`
const kyiv = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', ...opts }).format(new Date())
const kyivHour = () => Number(kyiv({ hour: '2-digit', hour12: false }))
const kyivToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
const kyivWeekday = () => kyiv({ weekday: 'short' })      // Mon … Sun
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtDue = (ts) => ts ? new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : ''

const tg = (method, payload) => fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
}).then(r => r.json()).catch(e => ({ ok: false, description: e.message }))

// вид сповіщення → налаштування користувача (notify_prefs: false — вимкнено)
const PREF = { assigned: 'assigned', due_soon: 'due', due: 'due', overdue: 'overdue', review: 'review', accepted: 'review', returned: 'review', done: 'review', comment: 'comment', mention: 'comment' }
const ICON = { assigned: '📌', due_soon: '⏰', due: '⏰', overdue: '⚠️', review: '📨', accepted: '✅', returned: '↩️', done: '✅', comment: '💬', mention: '💬', reminder: '🔔' }

async function authorized(req, admin) {
  const auth = String(req.headers['authorization'] || '')
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  const { data } = await admin.from('app_secrets').select('value').eq('key', 'task_notify').maybeSingle()
  return !!data?.value && auth === `Bearer ${data.value}`
}

function taskButtons(t, userId) {
  const rows = [[{ text: '🔗 Відкрити', url: taskUrl(t.id) }]]
  if (t && ['new', 'in_progress'].includes(t.status) && (t.assignee_id === userId || t.created_by === userId)) {
    rows.push([{ text: '✅ Виконано', callback_data: `taskdone:${t.id}` }])
  }
  if (t && !['done', 'cancelled'].includes(t.status)) {
    rows.push([{ text: '⏰ Нагадати за 1 год', callback_data: `snooze1h:${t.id}` }, { text: '🌅 Завтра 09:00', callback_data: `snoozetm:${t.id}` }])
  }
  return { inline_keyboard: rows }
}

// ── черга сповіщень → Telegram ──
async function sendPending(admin) {
  const quiet = kyivHour() >= 22 || kyivHour() < 8
  const since = new Date(Date.now() - 2 * 864e5).toISOString()
  const { data: rows, error } = await admin.from('notifications')
    .select('id, user_id, task_id, kind, title, body, profiles!inner(telegram_chat_id, notify_prefs), tasks(id, title, status, due_at, assignee_id, created_by)')
    .is('tg_sent_at', null).eq('tg_skip', false).gte('created_at', since).order('created_at').limit(200)
  if (error) throw new Error(error.message)
  let sent = 0, skipped = 0, held = 0
  for (const n of rows || []) {
    const chat = n.profiles?.telegram_chat_id
    const prefs = n.profiles?.notify_prefs || {}
    if (!chat || prefs.telegram === false || (PREF[n.kind] && prefs[PREF[n.kind]] === false)) {
      await admin.from('notifications').update({ tg_skip: true }).eq('id', n.id); skipped++; continue
    }
    if (quiet && n.kind !== 'reminder') { held++; continue }     // тихі години — вранці
    const t = n.tasks
    const lines = [`${ICON[n.kind] || '🔔'} <b>${esc(n.title)}</b>`, n.body ? esc(n.body) : null, t?.due_at ? `📅 Термін: ${fmtDue(t.due_at)}` : null]
    const r = await tg('sendMessage', { chat_id: chat, text: lines.filter(Boolean).join('\n'), parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: t ? taskButtons(t, n.user_id) : undefined })
    if (r.ok) { await admin.from('notifications').update({ tg_sent_at: new Date().toISOString() }).eq('id', n.id); sent++ }
    else if (/blocked|chat not found|deactivated/i.test(r.description || '')) { await admin.from('notifications').update({ tg_skip: true }).eq('id', n.id); skipped++ }
  }
  return { sent, skipped, held }
}

// ── ранковий дайджест: сьогодні, прострочені, на перевірці ──
async function sendDigest(admin) {
  const h = kyivHour()
  if (h < 7 || h > 9 || ['Sat', 'Sun'].includes(kyivWeekday())) return { digest: 0, reason: 'не час' }
  const today = kyivToday()
  const now = Date.now()
  const { data: people } = await admin.from('profiles').select('id, full_name, telegram_chat_id, notify_prefs, digest_sent_on').not('telegram_chat_id', 'is', null)
  const { data: tasks } = await admin.from('tasks').select('id, title, status, due_at, due_date, assignee_id, created_by').in('status', ['new', 'in_progress', 'review'])
  let n = 0
  for (const p of people || []) {
    if ((p.notify_prefs || {}).digest === false || (p.digest_sent_on && p.digest_sent_on >= today)) continue
    const mine = (tasks || []).filter(t => t.assignee_id === p.id && t.status !== 'review')
    const overdue = mine.filter(t => t.due_at && new Date(t.due_at).getTime() < now)
    const todayT = mine.filter(t => t.due_date === today && !overdue.includes(t))
    const review = (tasks || []).filter(t => t.status === 'review' && t.created_by === p.id)
    await admin.from('profiles').update({ digest_sent_on: today }).eq('id', p.id)
    if (!overdue.length && !todayT.length && !review.length) continue
    const L = ['☀️ <b>Задачі на сьогодні</b>']
    if (overdue.length) { L.push('', '⚠️ <b>Прострочені:</b>'); overdue.slice(0, 15).forEach(t => L.push(`• ${esc(t.title)} <i>(${fmtDue(t.due_at)})</i>`)) }
    if (todayT.length) { L.push('', '📅 <b>Сьогодні:</b>'); todayT.slice(0, 15).forEach(t => L.push(`• ${esc(t.title)}`)) }
    if (review.length) { L.push('', '📨 <b>Чекають вашої перевірки:</b>'); review.slice(0, 15).forEach(t => L.push(`• ${esc(t.title)}`)) }
    await tg('sendMessage', { chat_id: p.telegram_chat_id, text: L.join('\n'), parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '📋 Мої задачі', callback_data: 'mytasks' }, { text: '🔗 Відкрити', url: `${APP_URL}/#/tasks` }]] } })
    n++
  }
  // власник бота без прив'язаного профілю — як раніше: усі прострочені й на сьогодні
  if (OWNER && !(people || []).some(p => String(p.telegram_chat_id) === OWNER)) {
    const all = (tasks || []).filter(t => t.status !== 'review' && (t.due_date === today || (t.due_at && new Date(t.due_at).getTime() < now)))
    if (all.length) {
      await tg('sendMessage', { chat_id: OWNER, parse_mode: 'HTML', text: ['🔔 <b>Задачі: прострочені й на сьогодні</b>', ...all.slice(0, 25).map(t => `• ${esc(t.title)}`)].join('\n'),
        reply_markup: { inline_keyboard: [[{ text: '📋 Задачі', callback_data: 'tasks:0' }]] } })
    }
  }
  return { digest: n }
}

export default async function handler(req, res) {
  if (!TOKEN) return res.status(200).json({ ok: false, error: 'no telegram config' })
  const admin = getAdmin()
  if (!(await authorized(req, admin))) return res.status(401).json({ error: 'unauthorized' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const isDigest = body.digest === true || req.method === 'GET'   // Vercel Cron шле GET
    const out = isDigest ? await sendDigest(admin) : await sendPending(admin)
    return res.status(200).json({ ok: true, ...out })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message })
  }
}

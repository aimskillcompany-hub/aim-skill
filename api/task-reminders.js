// Cron: щоденне нагадування власнику про задачі (прострочені + на сьогодні) у Telegram.
// Тригери: Vercel Cron (Authorization: Bearer <CRON_SECRET>) або ручний виклик із тим самим секретом.
import { getAdmin } from './_lib.js'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const OWNER = (process.env.TELEGRAM_OWNER_ID || '').trim()

const tg = (method, payload) => fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
})

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || ''
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' })
  if (!TOKEN || !OWNER) return res.status(200).json({ ok: false, error: 'no telegram config' })

  try {
    const admin = getAdmin()
    const today = new Date().toISOString().slice(0, 10)
    const { data: tasks } = await admin.from('tasks')
      .select('id, title, due_date, priority')
      .eq('status', 'open').not('due_date', 'is', null).lte('due_date', today)
      .or(`reminded_on.is.null,reminded_on.lt.${today}`)
      .order('due_date')
    if (!tasks?.length) return res.status(200).json({ ok: true, reminded: 0 })

    const overdue = tasks.filter(t => t.due_date < today)
    const dueToday = tasks.filter(t => t.due_date === today)
    const lines = ['🔔 <b>Нагадування по задачах</b>']
    if (overdue.length) { lines.push('', '⚠️ <b>Прострочено:</b>'); overdue.forEach(t => lines.push(`• ${t.title} <i>(${t.due_date})</i>`)) }
    if (dueToday.length) { lines.push('', '📅 <b>На сьогодні:</b>'); dueToday.forEach(t => lines.push(`• ${t.title}`)) }

    await tg('sendMessage', {
      chat_id: OWNER, text: lines.join('\n'), parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '📋 Мої задачі', callback_data: 'tasks:0' }]] },
    })
    await admin.from('tasks').update({ reminded_on: today }).in('id', tasks.map(t => t.id))
    return res.status(200).json({ ok: true, reminded: tasks.length })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message })
  }
}

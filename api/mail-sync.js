// Синхронізація пошти у розділ «Пошта»: вхідні (INBOX) + вихідні (Sent) за останні 10 днів.
// Кладе вкладення у Storage, пише рядки emails. Документів НЕ створює, листи прочитаними НЕ помічає.
// Тригери: кнопка «Синхронізувати» в UI (Bearer supabase-token) АБО Cron/пінгувач (Bearer CRON_SECRET).
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { getAdmin, verifyUser, mailConfig } from './_lib.js'

const DAYS = 10
const MAX_NEW = 40              // нових листів за один запуск (тримаємось у таймауті)
const MIN_IMG_BYTES = 10 * 1024

function keepAttachment(a) {
  if (a.contentDisposition === 'attachment') return true
  const isPdf = a.contentType === 'application/pdf' || /\.pdf$/i.test(a.filename || '')
  if (isPdf) return true
  const isImg = (a.contentType || '').startsWith('image/')
  return isImg && (a.size || a.content?.length || 0) >= MIN_IMG_BYTES
}

async function authorize(req) {
  const auth = req.headers['authorization'] || ''
  const secret = process.env.CRON_SECRET
  if (secret && auth === `Bearer ${secret}`) return true
  return !!(await verifyUser(req))
}

async function syncFolder(client, admin, path, direction, since, summary, budget) {
  let lock
  try {
    lock = await client.getMailboxLock(path)
  } catch { return } // папки немає (напр. Sent з іншою назвою)
  try {
    const uids = await client.search({ since }, { uid: true })
    // найновіші першими
    const ordered = (uids || []).slice().reverse()
    for (const uid of ordered) {
      if (budget.left <= 0) { summary.truncated = true; break }
      summary.checked++
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true })
        if (!msg?.source) continue
        const parsed = await simpleParser(msg.source)
        const messageId = parsed.messageId || `uid-${path}-${uid}`

        const { data: seen } = await admin.from('emails').select('id').eq('message_id', messageId).maybeSingle()
        if (seen) continue

        const atts = (parsed.attachments || []).filter(keepAttachment)
        const stored = []
        for (const a of atts) {
          const fname = (a.filename || `file_${uid}`).replace(/[^\w.\-]/g, '_')
          const sp = `email/${encodeURIComponent(messageId).slice(0, 80)}/${fname}`
          const { error: upErr } = await admin.storage.from('documents')
            .upload(sp, a.content, { contentType: a.contentType || 'application/octet-stream', upsert: true })
          if (!upErr || String(upErr.message).includes('exists')) {
            stored.push({ filename: a.filename || fname, contentType: a.contentType || null, size: a.size || a.content?.length || 0, storage_path: sp })
          }
        }

        const { error: insErr } = await admin.from('emails').insert({
          message_id: messageId, uid, folder: path, direction,
          from_addr: parsed.from?.value?.[0]?.address || parsed.from?.text || '',
          to_addr: parsed.to?.text || '',
          cc_addr: parsed.cc?.text || null,
          subject: parsed.subject || '(без теми)',
          body_text: parsed.text || null,
          body_html: parsed.html || null,
          email_date: parsed.date ? parsed.date.toISOString() : null,
          has_attachments: stored.length > 0,
          attachments: stored,
        })
        if (insErr) { summary.errors.push(`${messageId}: ${insErr.message}`); continue }
        summary.newEmails++; budget.left--
      } catch (e) {
        summary.errors.push(`${path} uid ${uid}: ${e.message}`)
      }
    }
  } finally {
    lock.release()
  }
}

// Знайти папку «Надіслані» (назва різниться між серверами)
async function findSentPath(client) {
  try {
    const boxes = await client.list()
    const bySpecial = boxes.find(b => (b.specialUse || '') === '\\Sent')
    if (bySpecial) return bySpecial.path
    const byName = boxes.find(b => /sent|надісл|отправл/i.test(b.path) || /sent|надісл|отправл/i.test(b.name || ''))
    return byName?.path || null
  } catch { return null }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!(await authorize(req))) return res.status(401).json({ error: 'Не авторизовано' })

  const cfg = mailConfig()
  if (!cfg.imap.auth.user || !cfg.imap.auth.pass) {
    return res.status(500).json({ error: 'Пошта не налаштована (MAIL_USER / MAIL_PASS)' })
  }

  const admin = getAdmin()
  const summary = { checked: 0, newEmails: 0, truncated: false, errors: [] }
  const budget = { left: MAX_NEW }
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)

  const client = new ImapFlow({ ...cfg.imap, logger: false })
  try {
    await client.connect()
    await syncFolder(client, admin, 'INBOX', 'in', since, summary, budget)
    const sent = await findSentPath(client)
    if (sent && budget.left > 0) await syncFolder(client, admin, sent, 'out', since, summary, budget)
    await client.logout()
  } catch (e) {
    try { await client.close() } catch {}
    return res.status(500).json({ error: 'IMAP помилка: ' + e.message, summary })
  }

  res.status(200).json({ ok: true, summary })
}

export const config = { maxDuration: 60 }

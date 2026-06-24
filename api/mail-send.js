// Вихідні листи: надсилання документа клієнту через SMTP (Hostinger).
// Виклик з браузера авторизованим користувачем (Authorization: Bearer <supabase access_token>).
import nodemailer from 'nodemailer'
import { getAdmin, verifyUser, mailConfig } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'Потрібна авторизація' })

  const cfg = mailConfig()
  if (!cfg.smtp.auth.user || !cfg.smtp.auth.pass) {
    return res.status(500).json({ error: 'Пошта не налаштована (MAIL_USER / MAIL_PASS)' })
  }

  try {
    const { to, cc, subject, text, html, documentId } = req.body || {}
    if (!to) return res.status(400).json({ error: 'Не вказано отримувача' })
    if (!subject) return res.status(400).json({ error: 'Не вказано тему' })

    const admin = getAdmin()
    const attachments = []
    const attMeta = []
    let contractorId = null

    if (documentId) {
      const { data: doc, error } = await admin.from('documents')
        .select('id, contractor_id, file_name, file_type, storage_path, file_path').eq('id', documentId).single()
      if (error) throw new Error('Документ не знайдено: ' + error.message)
      contractorId = doc.contractor_id || null
      const path = doc.storage_path || doc.file_path
      if (path) {
        const { data: blob, error: dlErr } = await admin.storage.from('documents').download(path)
        if (dlErr) throw new Error('Не вдалося завантажити файл: ' + dlErr.message)
        const buf = Buffer.from(await blob.arrayBuffer())
        attachments.push({ filename: doc.file_name || 'document', content: buf })
        attMeta.push({ filename: doc.file_name || 'document', contentType: doc.file_type || null, size: buf.length, storage_path: path })
      }
    }

    const transporter = nodemailer.createTransport({
      host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure,
      auth: { user: cfg.smtp.auth.user, pass: cfg.smtp.auth.pass },
    })

    const info = await transporter.sendMail({
      from: cfg.from, to, cc: cc || undefined, subject,
      text: text || undefined,
      html: html || (text ? undefined : `<p>${(subject || '').replace(/</g, '&lt;')}</p>`),
      attachments,
    })

    await admin.from('mail_log').insert({
      direction: 'out', to_addr: to, cc_addr: cc || null, subject,
      document_id: documentId || null, contractor_id: contractorId,
      status: 'sent', sent_by: user.id,
    })

    // Запис у «Пошту» (вихідний)
    await admin.from('emails').insert({
      message_id: info?.messageId || `out-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      folder: 'Sent', direction: 'out',
      from_addr: cfg.from, to_addr: to, cc_addr: cc || null, subject,
      body_text: text || null, body_html: html || null,
      email_date: new Date().toISOString(),
      has_attachments: attMeta.length > 0, attachments: attMeta, is_read: true,
    }).then(() => {}, () => {}) // не блокуємо відповідь, якщо таблиці emails ще немає

    res.status(200).json({ ok: true })
  } catch (err) {
    try {
      const admin = getAdmin()
      await admin.from('mail_log').insert({
        direction: 'out', to_addr: req.body?.to || null, subject: req.body?.subject || null,
        document_id: req.body?.documentId || null, status: 'error', error: String(err.message).slice(0, 500), sent_by: user.id,
      })
    } catch {}
    res.status(500).json({ error: err.message })
  }
}

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

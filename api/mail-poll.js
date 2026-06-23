// Вхідні листи: забирає вкладення (PDF/фото) з непрочитаних листів,
// кладе у Storage, створює рядки documents, best-effort серверний OCR.
// Тригери: кнопка в UI (Bearer supabase-token) АБО Vercel Cron / зовнішній пінгувач (Bearer CRON_SECRET).
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { getAdmin, verifyUser, mailConfig, ocrFromAttachments, typeFromOcr, dirFromRole, matchContractor } from './_lib.js'

const BATCH = 6            // листів за один запуск (тримаємось у межах таймауту Hobby)
const MAX_OCR_BYTES = 4.5 * 1024 * 1024
const MIN_IMG_BYTES = 10 * 1024 // ігноруємо дрібні зображення (лого в підписі)

function isDocAttachment(a) {
  const isPdf = a.contentType === 'application/pdf' || /\.pdf$/i.test(a.filename || '')
  const isImg = (a.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(a.filename || '')
  if (isPdf) return true
  if (isImg && a.contentDisposition === 'attachment' && (a.size || a.content?.length || 0) >= MIN_IMG_BYTES) return true
  return false
}

async function authorize(req) {
  const auth = req.headers['authorization'] || ''
  const secret = process.env.CRON_SECRET
  if (secret && auth === `Bearer ${secret}`) return true
  const user = await verifyUser(req)
  return !!user
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!(await authorize(req))) return res.status(401).json({ error: 'Не авторизовано' })

  const cfg = mailConfig()
  if (!cfg.imap.auth.user || !cfg.imap.auth.pass) {
    return res.status(500).json({ error: 'Пошта не налаштована (MAIL_USER / MAIL_PASS)' })
  }

  const admin = getAdmin()
  const summary = { checked: 0, newEmails: 0, docs: 0, ocrOk: 0, errors: [] }

  // Довідники для матчингу/OCR — один раз
  let articles = [], contractors = []
  try {
    const [{ data: arts }, { data: cons }] = await Promise.all([
      admin.from('articles').select('name, type'),
      admin.from('contractors').select('id, name, edrpou'),
    ])
    articles = arts || []; contractors = cons || []
  } catch {}

  const client = new ImapFlow({ ...cfg.imap, logger: false })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ seen: false }, { uid: true })
      // Найновіші першими: беремо останні BATCH UID (найбільші) і йдемо від нових до старих.
      // Так свіжі накладні ловляться одразу, а великий беклог старих листів не чіпається.
      const batch = (uids || []).slice(-BATCH).reverse()
      for (const uid of batch) {
        summary.checked++
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true })
          if (!msg?.source) continue
          const parsed = await simpleParser(msg.source)
          const messageId = parsed.messageId || `uid-${uid}-${parsed.date?.toISOString?.() || ''}`

          // Дедуплікація
          const { data: seen } = await admin.from('processed_emails').select('id').eq('message_id', messageId).maybeSingle()
          if (seen) { await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }); continue }

          const fromAddr = parsed.from?.value?.[0]?.address || parsed.from?.text || ''
          const subject = parsed.subject || ''
          const docAtts = (parsed.attachments || []).filter(isDocAttachment)

          let created = 0
          for (const a of docAtts) {
            const fname = (a.filename || `attachment_${Date.now()}`).replace(/[^\w.\-]/g, '_')
            const path = `email_${Date.now()}_${fname}`
            const { error: upErr } = await admin.storage.from('documents')
              .upload(path, a.content, { contentType: a.contentType || 'application/octet-stream', upsert: false })
            if (upErr && !String(upErr.message).includes('exists')) { summary.errors.push(`${fname}: ${upErr.message}`); continue }

            // Best-effort OCR
            let ocr = null, contractorId = null
            if ((a.content?.length || 0) <= MAX_OCR_BYTES) {
              try {
                ocr = await ocrFromAttachments([a], articles)
                const m = matchContractor(contractors, ocr.contractor, ocr.edrpou)
                contractorId = m?.id || null
                summary.ocrOk++
              } catch (e) { /* лишаємо на ручне «Розпізнати» */ }
            }

            const role = ocr?.docRole || 'incoming'
            const ins = {
              source: 'email',
              file_name: a.filename || fname,
              file_type: a.contentType || null,
              storage_path: path, file_path: path,
              doc_role: ocr ? role : 'incoming',
            }
            if (ocr) {
              ins.type = typeFromOcr(ocr.docType, role)
              ins.doc_number = ocr.docNumber || null
              ins.doc_date = ocr.date || null
              ins.contractor_id = contractorId
              ins.amount = ocr.totalAmount ?? (ocr.amountNoVat != null ? Number(ocr.amountNoVat) + Number(ocr.vatAmount || 0) : null)
              ins.vat_amount = ocr.vatAmount ?? 0
              ins.direction = dirFromRole(role)
              ins.ocr_data = ocr
            }
            const { error: insErr } = await admin.from('documents').insert(ins)
            if (insErr) { summary.errors.push(`${fname}: ${insErr.message}`); continue }
            created++
          }

          await admin.from('processed_emails').insert({
            message_id: messageId, uid, subject, from_addr: fromAddr, doc_count: created, status: 'ok',
          })
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
          summary.newEmails++
          summary.docs += created
        } catch (e) {
          summary.errors.push(`uid ${uid}: ${e.message}`)
        }
      }
    } finally {
      lock.release()
    }
    await client.logout()
  } catch (e) {
    try { await client.close() } catch {}
    return res.status(500).json({ error: 'IMAP помилка: ' + e.message, summary })
  }

  res.status(200).json({ ok: true, summary })
}

export const config = { maxDuration: 60 }

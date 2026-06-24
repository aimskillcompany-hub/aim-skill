// Створити заявку (замовлення) з листа: AI аналізує текст + вкладення,
// створює order, зберігає вкладення як документи замовлення (з OCR), прив'язує.
import { getAdmin, verifyUser, ocrFromAttachments, extractOrderFromEmail, typeFromOcr, dirFromRole, matchContractor } from './_lib.js'

const VALID_TYPES = ['trade', 'service', 'agent']
const MAX_OCR = 3                          // скільки вкладень розпізнавати OCR (решта — без метаданих)
const MAX_OCR_BYTES = 4.5 * 1024 * 1024

// Тип у order_documents (check: contract|spec|invoice|act|delivery_note) з типу документа
const odType = (t) => t === 'invoice' ? 'invoice' : t === 'serviceAct' ? 'act'
  : (t === 'waybill' || t === 'incomingWaybill') ? 'delivery_note' : null

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'Потрібна авторизація' })

  const { emailId } = req.body || {}
  if (!emailId) return res.status(400).json({ error: 'Не вказано лист' })

  const admin = getAdmin()
  try {
    const { data: email, error } = await admin.from('emails').select('*').eq('id', emailId).single()
    if (error) throw new Error('Лист не знайдено: ' + error.message)
    if (email.order_id) return res.status(200).json({ ok: true, orderId: email.order_id, already: true })

    // Довідники
    const [{ data: arts }, { data: cons }] = await Promise.all([
      admin.from('articles').select('name, type'),
      admin.from('contractors').select('id, name, edrpou'),
    ])
    const articles = arts || [], contractors = cons || []

    // Завантажуємо вкладення (для AI і для документів)
    const buffers = []
    for (const a of (email.attachments || [])) {
      try {
        const { data: blob, error: dlErr } = await admin.storage.from('documents').download(a.storage_path)
        if (dlErr) continue
        buffers.push({ ...a, content: Buffer.from(await blob.arrayBuffer()) })
      } catch {}
    }
    const docLike = buffers.filter(a => a.contentType === 'application/pdf' || (a.contentType || '').startsWith('image/'))

    // AI: заявка
    const order = await extractOrderFromEmail(
      { subject: email.subject, from: email.from_addr, bodyText: email.body_text || email.body_html?.replace(/<[^>]+>/g, ' ') },
      docLike.filter(a => a.content.length <= MAX_OCR_BYTES),
      articles,
    )

    const type = VALID_TYPES.includes(order.type) ? order.type : 'trade'

    // Контрагент: матч або створення
    let client = matchContractor(contractors, order.contractor, order.edrpou)
    let clientId = client?.id || null
    if (!clientId && order.contractor) {
      const { data: nc } = await admin.from('contractors')
        .insert({ name: order.contractor, edrpou: order.edrpou ? String(order.edrpou).replace(/\D/g, '') : null, is_client: true })
        .select('id').single()
      clientId = nc?.id || null
      const cemail = order.contractorEmail || email.from_addr
      if (clientId && cemail) {
        await admin.from('contractor_contacts').insert({ contractor_id: clientId, email: cemail, phone: order.contractorPhone || null })
      }
    }

    // Створюємо замовлення
    const { count } = await admin.from('orders').select('id', { count: 'exact', head: true })
    const order_number = String((count || 0) + 1).padStart(4, '0')
    const descr = order.description || email.subject || 'Заявка з листа'
    const { data: ord, error: ordErr } = await admin.from('orders').insert({
      order_number, type, status: 'new', client_id: clientId,
      total: Number(order.total) || 0,
      description: [descr, order.summary].filter(Boolean).join('\n\n').slice(0, 4000),
      created_by: user.id,
    }).select('id').single()
    if (ordErr) throw new Error('Не вдалося створити замовлення: ' + ordErr.message)

    // Вкладення → документи замовлення
    let docCount = 0, ocrCount = 0, i = 0
    for (const a of docLike) {
      i++
      let ocr = null
      if (i <= MAX_OCR && a.content.length <= MAX_OCR_BYTES) {
        try { ocr = await ocrFromAttachments([a], articles); ocrCount++ } catch {}
      }
      const role = ocr?.docRole || 'incoming'
      const ins = {
        source: 'email', file_name: a.filename, file_type: a.contentType || null,
        storage_path: a.storage_path, file_path: a.storage_path,
        contractor_id: clientId, doc_role: ocr ? role : 'incoming',
      }
      if (ocr) {
        ins.type = typeFromOcr(ocr.docType, role)
        ins.doc_number = ocr.docNumber || null
        ins.doc_date = ocr.date || null
        ins.amount = ocr.totalAmount ?? (ocr.amountNoVat != null ? Number(ocr.amountNoVat) + Number(ocr.vatAmount || 0) : null)
        ins.vat_amount = ocr.vatAmount ?? 0
        ins.direction = dirFromRole(role)
        ins.ocr_data = ocr
      }
      const { data: doc, error: dErr } = await admin.from('documents').insert(ins).select('id, type').single()
      if (dErr) continue
      docCount++
      await admin.from('order_documents').insert({ order_id: ord.id, document_id: doc.id, type: odType(doc.type) })
    }

    await admin.from('emails').update({ order_id: ord.id }).eq('id', emailId)

    res.status(200).json({ ok: true, orderId: ord.id, order_number, type, docs: docCount, ocr: ocrCount, contractor: order.contractor })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

export const config = { maxDuration: 60 }

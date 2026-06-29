// Зберегти PDF (base64 з браузера) у Storage через service-доступ + оновити storage_path.
// Обходить обмеження прав Storage для звичайного користувача.
// Body: { kind: 'proposal'|'generated', id, base64 }
import { getAdmin, verifyUser } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'Потрібна авторизація' })

  const { kind, id, base64 } = req.body || {}
  if (!id || !base64) return res.status(400).json({ error: 'id та base64 обовʼязкові' })

  const admin = getAdmin()
  try {
    const buf = Buffer.from(base64, 'base64')
    let path, table, col
    if (kind === 'proposal') { path = `proposals/${id}.pdf`; table = 'commercial_proposals'; col = 'id' }
    else if (kind === 'generated') { path = `generated/${id}.pdf`; table = 'documents'; col = 'generated_doc_id' }
    else return res.status(400).json({ error: 'Невідомий kind' })

    const { error: upErr } = await admin.storage.from('documents').upload(path, buf, { contentType: 'application/pdf', upsert: true })
    if (upErr) throw new Error('upload: ' + upErr.message)
    const { error: updErr } = await admin.from(table).update({ storage_path: path }).eq(col, id)
    if (updErr) throw new Error('update: ' + updErr.message)
    return res.json({ ok: true, path })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

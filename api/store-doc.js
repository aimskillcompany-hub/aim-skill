// Серверний рендер PDF (pdfmake PdfPrinter) з docDef, що надіслав браузер,
// + завантаження у Storage (service-доступ) + оновлення storage_path.
// Браузер лише будує docDef (sync, без зависання getBlob).
// Body: { kind: 'proposal'|'generated', id, docDef }
import { getAdmin, verifyUser } from './_lib.js'

let _printer
async function getPrinter() {
  if (_printer) return _printer
  const printerMod = await import('pdfmake/js/printer.js')
  const PdfPrinter = printerMod.default || printerMod
  const vfsMod = await import('pdfmake/build/vfs_fonts.js')
  const vfsImport = vfsMod.default || vfsMod
  const vfs = vfsImport?.pdfMake?.vfs || vfsImport?.vfs || vfsImport
  const fonts = {
    Roboto: {
      normal: Buffer.from(vfs['Roboto-Regular.ttf'], 'base64'),
      bold: Buffer.from(vfs['Roboto-Medium.ttf'], 'base64'),
      italics: Buffer.from(vfs['Roboto-Italic.ttf'], 'base64'),
      bolditalics: Buffer.from(vfs['Roboto-MediumItalic.ttf'], 'base64'),
    },
  }
  _printer = new PdfPrinter(fonts)
  return _printer
}

async function renderPdf(docDef) {
  const printer = await getPrinter()
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDef)
      const chunks = []
      doc.on('data', (c) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
      doc.end()
    } catch (e) { reject(e) }
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'Потрібна авторизація' })

  const { kind, id, docDef } = req.body || {}
  if (!id || !docDef) return res.status(400).json({ error: 'id та docDef обовʼязкові' })

  const admin = getAdmin()
  try {
    const buf = await renderPdf(docDef)
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

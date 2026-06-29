// ── PDF генерація через pdfmake ──
import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs || pdfFonts

export function downloadPdf(docDefinition, fileName) {
  pdfMake.createPdf(docDefinition).download(fileName)
}

export function openPdf(docDefinition) {
  pdfMake.createPdf(docDefinition).open()
}

export function getPdfBlob(docDefinition, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Таймаут генерації PDF')), timeoutMs)
    try {
      pdfMake.createPdf(docDefinition).getBlob((blob) => { clearTimeout(t); resolve(blob) })
    } catch (e) { clearTimeout(t); reject(e) }
  })
}

export function getPdfBase64(docDefinition, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Таймаут генерації PDF')), timeoutMs)
    try {
      pdfMake.createPdf(docDefinition).getBase64((b64) => { clearTimeout(t); resolve(b64) })
    } catch (e) { clearTimeout(t); reject(e) }
  })
}

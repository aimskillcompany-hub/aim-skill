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

export function getPdfBlob(docDefinition) {
  return new Promise((resolve) => pdfMake.createPdf(docDefinition).getBlob(resolve))
}

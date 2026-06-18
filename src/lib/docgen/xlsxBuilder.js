// ── Excel генерація через SheetJS ──
import * as XLSX from 'xlsx'

export function downloadXlsx(workbook, fileName) {
  XLSX.writeFile(workbook, fileName)
}

export function createWorkbook() {
  return XLSX.utils.book_new()
}

export function addSheet(workbook, data, sheetName) {
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(workbook, ws, sheetName)
  return ws
}

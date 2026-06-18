// ── Document Generation Public API ──
import { COMPANY } from '../companyConfig'
import { getDocType } from './templates/registry'
import { downloadPdf } from './pdfBuilder'
import { downloadXlsx } from './xlsxBuilder'
import { supabase } from '../supabase'

export { DOCUMENT_TYPES, getDocType, getDocLabel, STATUS_LABELS, STATUS_COLORS } from './templates/registry'
export { calcTotals, amountInWords, formatMoney, formatDate } from './formatUtils'

// Фільтрувати порожні позиції
function cleanItems(items) {
  return (items || []).filter(it => it.name?.trim())
}

// ── Генерація та завантаження PDF ──
export function generatePdf(docTypeKey, contractor, items, options) {
  const dt = getDocType(docTypeKey)
  if (!dt) throw new Error(`Невідомий тип документа: ${docTypeKey}`)
  const docDef = dt.template.pdf(COMPANY, contractor, cleanItems(items), options)
  const fileName = `${dt.label}_${options.docNumber}_${options.docDate}.pdf`
  downloadPdf(docDef, fileName)
}

// ── Генерація та завантаження Excel ──
export function generateXlsx(docTypeKey, contractor, items, options) {
  const dt = getDocType(docTypeKey)
  if (!dt) throw new Error(`Невідомий тип документа: ${docTypeKey}`)
  const wb = dt.template.xlsx(COMPANY, contractor, cleanItems(items), options)
  const fileName = `${dt.label}_${options.docNumber}_${options.docDate}.xlsx`
  downloadXlsx(wb, fileName)
}

// ── Авто-нумерація ──
export async function getNextDocNumber(docTypeKey) {
  const dt = getDocType(docTypeKey)
  if (!dt) return '0001'
  const prefix = dt.prefix

  const { data } = await supabase
    .from('generated_docs')
    .select('doc_number')
    .eq('doc_type', docTypeKey)
    .order('created_at', { ascending: false })
    .limit(1)

  if (!data?.length) return `${prefix}-0001`

  const last = data[0].doc_number
  const numMatch = last.match(/(\d+)$/)
  const nextNum = numMatch ? parseInt(numMatch[1]) + 1 : 1
  return `${prefix}-${String(nextNum).padStart(4, '0')}`
}

// ── Зберегти документ в БД ──
export async function saveDoc({ docType, docNumber, docDate, contractorId, contractorName, items, subtotal, vatAmount, total, notes, userId }) {
  const { data, error } = await supabase.from('generated_docs').insert({
    doc_type: docType,
    doc_number: docNumber,
    doc_date: docDate,
    contractor_id: contractorId,
    contractor_name: contractorName,
    items: JSON.stringify(cleanItems(items)),
    subtotal, vat_amount: vatAmount, total,
    notes: notes || null,
    created_by: userId,
  }).select('id').single()

  if (error) throw new Error(error.message)
  return data
}

// ── Оновити статус ──
export async function updateDocStatus(id, status, bankTransactionId) {
  const upd = { status }
  if (bankTransactionId) upd.bank_transaction_id = bankTransactionId
  const { error } = await supabase.from('generated_docs').update(upd).eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Завантажити документи контрагента ──
export async function loadContractorDocs(contractorId) {
  const { data } = await supabase
    .from('generated_docs')
    .select('*')
    .eq('contractor_id', contractorId)
    .order('doc_date', { ascending: false })
  return data || []
}

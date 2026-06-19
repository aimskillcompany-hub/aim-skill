// ── Document Generation Public API ──
import { getCompany } from '../companyConfig'
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
  // Для прихідних — сторони міняються (контрагент = постачальник, ми = покупець)
  const seller = dt.direction === 'incoming' ? contractor : getCompany()
  const buyer = dt.direction === 'incoming' ? getCompany() : contractor
  const docDef = dt.template.pdf(seller, buyer, cleanItems(items), options)
  const fileName = `${dt.label}_${options.docNumber}_${options.docDate}.pdf`
  downloadPdf(docDef, fileName)
}

// ── Генерація та завантаження Excel ──
export function generateXlsx(docTypeKey, contractor, items, options) {
  const dt = getDocType(docTypeKey)
  if (!dt) throw new Error(`Невідомий тип документа: ${docTypeKey}`)
  const seller = dt.direction === 'incoming' ? contractor : getCompany()
  const buyer = dt.direction === 'incoming' ? getCompany() : contractor
  const wb = dt.template.xlsx(seller, buyer, cleanItems(items), options)
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
export async function saveDoc({ docType, docNumber, docDate, contractorId, contractorName, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city, userId }) {
  const { data, error } = await supabase.from('generated_docs').insert({
    doc_type: docType,
    doc_number: docNumber,
    doc_date: docDate,
    contractor_id: contractorId,
    contractor_name: contractorName,
    items: JSON.stringify(cleanItems(items)),
    subtotal, vat_amount: vatAmount, total,
    notes: notes || null,
    contract_num: contractNum || null,
    contract_date: contractDate || null,
    payment_due: paymentDue || null,
    city: city || null,
    created_by: userId,
  }).select('id').single()

  if (error) throw new Error(error.message)

  // Автоматичні складські рухи тільки для прихідних (IN)
  // Для видаткових (OUT) — потрібне підтвердження користувача
  const dt = getDocType(docType)
  if (dt?.stockEffect === 'in' && data?.id) {
    await createStockFromDoc(data.id, docType, cleanItems(items), docDate, userId)
  }

  return data
}

// ── Створити складські рухи з документа ──
export async function createStockFromDoc(docId, docType, items, date, userId) {
  const dt = getDocType(docType)
  if (!dt?.stockEffect) return

  const { resolveProduct } = await import('../stockService')

  for (const item of items) {
    if (!item.name?.trim()) continue
    const qty = parseFloat(item.quantity) || 0
    if (qty <= 0) continue

    // Знайти або створити продукт
    const resolved = item.productId
      ? { productId: item.productId, isNew: false }
      : await resolveProduct(item.name, item.unit || 'шт', parseFloat(item.unitPrice) || null, userId)

    if (!resolved?.productId) continue

    // Перевірити product_type — послуги не потребують складського руху
    const { data: prodInfo } = await supabase.from('products')
      .select('product_type').eq('id', resolved.productId).maybeSingle()
    if (prodInfo?.product_type === 'service' || prodInfo?.product_type === 'expense') continue

    // Створити рух
    await supabase.from('stock_movements').insert({
      product_id: resolved.productId,
      type: dt.stockEffect, // 'in' або 'out'
      quantity: qty,
      price: parseFloat(item.unitPrice) || null,
      total: parseFloat(item.amount) || qty * (parseFloat(item.unitPrice) || 0),
      date: date || new Date().toISOString().split('T')[0],
      description: `${dt.label}: ${item.name}`,
      source: 'document',
      created_by: userId,
    })
  }
}

// ── Оновити документ ──
export async function updateDoc(id, { docNumber, docDate, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city }) {
  const { error } = await supabase.from('generated_docs').update({
    doc_number: docNumber,
    doc_date: docDate,
    items: JSON.stringify(cleanItems(items)),
    subtotal, vat_amount: vatAmount, total,
    notes: notes || null,
    contract_num: contractNum || null,
    contract_date: contractDate || null,
    payment_due: paymentDue || null,
    city: city || null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
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

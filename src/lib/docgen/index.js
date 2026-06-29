// ── Document Generation Public API ──
import { getCompany } from '../companyConfig'
import { getDocType } from './templates/registry'
import { downloadPdf, openPdf, getPdfBlob } from './pdfBuilder'
import { downloadXlsx } from './xlsxBuilder'
import { calcTotals } from './formatUtils'
import { supabase } from '../supabase'

export { DOCUMENT_TYPES, getDocType, getDocLabel, STATUS_LABELS, STATUS_COLORS } from './templates/registry'
export { calcTotals, amountInWords, formatMoney, formatDate } from './formatUtils'

// Фільтрувати порожні позиції
function cleanItems(items) {
  return (items || []).filter(it => it.name?.trim())
}

// ── Підтягнути підписанта з contractor_contacts ──
async function enrichContractorSigner(contractor) {
  if (!contractor?.id) return contractor
  const { data } = await supabase.from('contractor_contacts')
    .select('name, position')
    .eq('contractor_id', contractor.id)
    .eq('is_signer', true)
    .limit(1)
    .maybeSingle()
  if (data) {
    return { ...contractor, contact_person: data.name, contact_position: data.position || '' }
  }
  return contractor
}

// ── Генерація та завантаження PDF ──
export async function generatePdf(docTypeKey, contractor, items, options) {
  const dt = getDocType(docTypeKey)
  if (!dt) throw new Error(`Невідомий тип документа: ${docTypeKey}`)
  const enriched = await enrichContractorSigner(contractor)
  const company = await getCompany()
  const seller = dt.direction === 'incoming' ? enriched : company
  const buyer = dt.direction === 'incoming' ? company : enriched
  const docDef = dt.template.pdf(seller, buyer, cleanItems(items), options)
  const fileName = `${dt.label}_${options.docNumber}_${options.docDate}.pdf`
  downloadPdf(docDef, fileName)
}

// ── Згенерувати документ із замовлення: PDF → Storage → рядок у documents (order_id) + завантаження ──
export async function generateOrderDoc(docTypeKey, contractor, items, options, { orderId, contractorId }) {
  const dt = getDocType(docTypeKey)
  if (!dt) throw new Error(`Невідомий тип документа: ${docTypeKey}`)
  const enriched = await enrichContractorSigner(contractor)
  const company = await getCompany()
  const seller = dt.direction === 'incoming' ? enriched : company
  const buyer = dt.direction === 'incoming' ? company : enriched
  const clean = cleanItems(items)
  const docDef = dt.template.pdf(seller, buyer, clean, options)
  const { total, vatAmount } = calcTotals(clean)
  const fileName = `${dt.label}_${options.docNumber}_${options.docDate}.pdf`

  // 1) Завантажуємо PDF одразу (перевірений шлях) — користувач завжди отримує файл
  downloadPdf(docDef, fileName)

  // 2) Збереження в Документи — best-effort (не блокує отримання PDF)
  const blob = await getPdfBlob(docDef)
  const path = `orders/${orderId}/${Date.now()}_${docTypeKey}.pdf`
  const { error: upErr } = await supabase.storage.from('documents').upload(path, blob, { contentType: 'application/pdf', upsert: false })
  if (upErr) throw upErr
  await supabase.from('documents').delete().eq('order_id', orderId).eq('type', docTypeKey).eq('doc_number', options.docNumber)
  const { error: insErr } = await supabase.from('documents').insert({
    type: docTypeKey, order_id: orderId, contractor_id: contractorId || contractor?.id || null,
    doc_number: options.docNumber, doc_date: options.docDate, amount: total || null, vat_amount: vatAmount || null,
    file_name: fileName, storage_path: path, direction: dt.direction === 'incoming' ? 'payable' : 'receivable',
  })
  if (insErr) throw insErr
}

// ── Замовлення постачальнику (PDF): від компанії, постачальнику, для клієнта ──
export async function supplierOrderPdf(supplier, items, options, { download } = {}) {
  const supplierOrder = await import('./templates/supplierOrder')
  const company = await getCompany()
  const docDef = supplierOrder.pdf(company, supplier || {}, items || [], options)
  if (download) downloadPdf(docDef, `Замовлення постачальнику_${options.docNumber}.pdf`)
  else openPdf(docDef)
}

// ── Перегляд PDF у новій вкладці (без збереження) ──
export async function previewPdf(docTypeKey, contractor, items, options) {
  const dt = getDocType(docTypeKey)
  if (!dt) throw new Error(`Невідомий тип документа: ${docTypeKey}`)
  const enriched = await enrichContractorSigner(contractor)
  const company = await getCompany()
  const seller = dt.direction === 'incoming' ? enriched : company
  const buyer = dt.direction === 'incoming' ? company : enriched
  const docDef = dt.template.pdf(seller, buyer, cleanItems(items), options)
  openPdf(docDef)
}

// ── Генерація та завантаження Excel ──
export async function generateXlsx(docTypeKey, contractor, items, options) {
  const dt = getDocType(docTypeKey)
  if (!dt) throw new Error(`Невідомий тип документа: ${docTypeKey}`)
  const enriched = await enrichContractorSigner(contractor)
  const company = await getCompany()
  const seller = dt.direction === 'incoming' ? enriched : company
  const buyer = dt.direction === 'incoming' ? company : enriched
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
export async function saveDoc({ docType, docNumber, docDate, contractorId, contractorName, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city, parentDocId, contractId, orderId, userId }) {
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
    parent_doc_id: parentDocId || null,
    contract_id: contractId || null,
    order_id: orderId || null,
    created_by: userId,
  }).select('id').single()

  if (error) throw new Error(error.message)

  const dt = getDocType(docType)

  // Дзеркало в documents (канонічний список: Документи, картка контрагента, борги).
  // Створюється МИТТЄВО (без рендера PDF), щоб не блокувати збереження.
  if (data?.id) {
    await supabase.from('documents').insert({
      type: docType, doc_number: docNumber, doc_date: docDate,
      contractor_id: contractorId || null, order_id: orderId || null,
      amount: total ?? null, vat_amount: vatAmount ?? null,
      direction: dt.direction === 'incoming' ? 'payable' : 'receivable',
      doc_role: dt.direction === 'incoming' ? 'incoming' : 'outgoing',
      file_name: `${dt.label}_${docNumber}.pdf`, file_path: `generated/${data.id}.pdf`,
      source: 'generated', generated_doc_id: data.id,
    })
  }

  // Автоматичні складські рухи тільки для прихідних (IN)
  // Для видаткових (OUT) — потрібне підтвердження користувача
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
    const unitPrice = parseFloat(item.unitPrice) || null
    const total = parseFloat(item.amount) || qty * (unitPrice || 0)

    // Для OUT — FIFO cost, для IN — ціна закупки
    let costPrice = null
    if (dt.stockEffect === 'out') {
      const { getFifoCost } = await import('../stockService')
      costPrice = await getFifoCost(resolved.productId, qty)
    } else if (dt.stockEffect === 'in') {
      costPrice = unitPrice // для IN cost = ціна закупки
    }

    await supabase.from('stock_movements').insert({
      product_id: resolved.productId,
      type: dt.stockEffect,
      quantity: qty,
      price: unitPrice,
      total,
      cost_price: costPrice,
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
  // Синхронізувати дзеркальний рядок у documents (сума/номер/дата)
  await supabase.from('documents').update({ doc_number: docNumber, doc_date: docDate, amount: total ?? null, vat_amount: vatAmount ?? null }).eq('generated_doc_id', id)
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

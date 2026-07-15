// ── Document Generation Public API ──
import { getCompany } from '../companyConfig'
import { getDocType } from './templates/registry'
import { downloadPdf, openPdf, getPdfBlob, getPdfBase64 } from './pdfBuilder'
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
  // Повні реквізити контрагента з БД (адреса, IBAN, банк, директор, ІПН тощо) —
  // щоб шаблони мали все, навіть якщо переданий об'єкт неповний (напр. лише id/назва/ЄДРПОУ).
  const { data: full } = await supabase.from('contractors').select('*').eq('id', contractor.id).maybeSingle()
  let merged = full ? { ...contractor, ...full } : contractor
  const { data } = await supabase.from('contractor_contacts')
    .select('name, position')
    .eq('contractor_id', contractor.id)
    .eq('is_signer', true)
    .limit(1)
    .maybeSingle()
  if (data) merged = { ...merged, contact_person: data.name, contact_position: data.position || '' }
  return merged
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

// ── Інвестиційний розрахунок по замовленню (PDF): рентабельність, капітал, ROI ──
export async function investorReportPdf(order, items, { download } = {}) {
  const investorReport = await import('./templates/investorReport')
  const company = await getCompany()
  const docDef = investorReport.pdf(company, order, items || [], {})
  const fileName = `Інвест-розрахунок_${order?.order_number || (order?.id || '').slice(0, 6)}.pdf`
  if (download) downloadPdf(docDef, fileName)
  else openPdf(docDef)
}

// ── Замовлення постачальнику (PDF): від компанії, постачальнику, для клієнта ──
export async function supplierOrderPdf(supplier, items, options, { download } = {}) {
  const supplierOrder = await import('./templates/supplierOrder')
  const company = await getCompany()
  const docDef = supplierOrder.pdf(company, supplier || {}, items || [], options)
  if (download) downloadPdf(docDef, `Замовлення постачальнику_${options.docNumber}.pdf`)
  else openPdf(docDef)
}

// ── Зберегти PDF згенерованого документа у Storage (щоб був доступний з бота) ──
// Викликати після saveDoc (browser-side, getBlob у браузері). Best-effort.
export async function storeGeneratedPdf(generatedDocId, docTypeKey, contractor, items, options) {
  try {
    const dt = getDocType(docTypeKey)
    if (!dt || !generatedDocId) return
    const enriched = await enrichContractorSigner(contractor)
    const company = await getCompany()
    const seller = dt.direction === 'incoming' ? enriched : company
    const buyer = dt.direction === 'incoming' ? company : enriched
    const docDef = dt.template.pdf(seller, buyer, cleanItems(items), options)
    await uploadDocDefViaApi('generated', generatedDocId, docDef)
  } catch { /* best-effort */ }
}

// ── Зберегти PDF комерційної пропозиції у Storage (для перегляду з бота) ──
// Рендер PDF — на сервері (браузерний getBlob/getBase64 зависає в цьому збиранні).
// Браузер будує docDef (sync) і шле його на /api/store-doc.
async function uploadDocDefViaApi(kind, id, docDef) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token || ''
  const r = await fetch('/api/store-doc', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, id, docDef }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `store failed (${r.status})`)
  return j
}

export async function storeProposalPdf(proposalId, contractor, items, options) {
  if (!proposalId) return { ok: false, error: 'no id' }
  const cp = await import('./templates/commercialProposal')
  const company = await getCompany()
  const docDef = cp.pdf(company, contractor || {}, cleanItems(items), options)
  return uploadDocDefViaApi('proposal', proposalId, docDef)
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

// ── Blob згенерованого PDF (для прев'ю в модалці) ──
export async function generatedDocBlob(docTypeKey, contractor, items, options) {
  const dt = getDocType(docTypeKey)
  if (!dt) throw new Error(`Невідомий тип документа: ${docTypeKey}`)
  const enriched = await enrichContractorSigner(contractor)
  const company = await getCompany()
  const seller = dt.direction === 'incoming' ? enriched : company
  const buyer = dt.direction === 'incoming' ? company : enriched
  const docDef = dt.template.pdf(seller, buyer, cleanItems(items), options)
  return getPdfBlob(docDef)
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
// Беремо МАКСИМАЛЬНИЙ номер у форматі PREFIX-NNNN серед генерованих документів цього типу
// і додаємо 1. (Раніше брали номер ОСТАННЬОГО СТВОРЕНОГО — при ручних правках/видаленнях/
// беквдейті останній міг мати менший номер → колізія, напр. два ВН-0003.)
export async function getNextDocNumber(docTypeKey) {
  const dt = getDocType(docTypeKey)
  if (!dt) return '0001'
  const prefix = dt.prefix

  const { data } = await supabase
    .from('generated_docs')
    .select('doc_number')
    .eq('doc_type', docTypeKey)

  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`)
  let max = 0
  for (const row of (data || [])) {
    const m = (row.doc_number || '').match(re)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// Колонки-реквізити з міграції 027 можуть ще не існувати — на помилку про них
// повторюємо запит без них, щоб збереження не падало до застосування міграції.
function isMissingRefsColumn(msg = '') {
  return /invoice_ref|delivery_basis|delivery_address/.test(msg)
}

// ── Зберегти документ в БД ──
export async function saveDoc({ docType, docNumber, docDate, contractorId, contractorName, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress, parentDocId, contractId, orderId, userId }) {
  const base = {
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
  }
  const refs = {
    invoice_ref: invoiceRef || null,
    invoice_ref_date: invoiceRefDate || null,
    delivery_basis: deliveryBasis || null,
    delivery_address: deliveryAddress || null,
  }
  let { data, error } = await supabase.from('generated_docs').insert({ ...base, ...refs }).select('id').single()
  if (error && isMissingRefsColumn(error.message)) {
    ;({ data, error } = await supabase.from('generated_docs').insert(base).select('id').single())
  }

  if (error) throw new Error(error.message)

  const dt = getDocType(docType)

  // Дзеркало в documents (канонічний список: Документи, картка контрагента, борги).
  // Створюється МИТТЄВО (без рендера PDF). Пропускаємо, якщо документ з таким
  // же контрагентом+типом+номером уже існує (щоб не задвоювати борг).
  if (data?.id) {
    let dup = supabase.from('documents').select('id', { count: 'exact', head: true }).eq('type', docType).eq('doc_number', docNumber)
    dup = contractorId ? dup.eq('contractor_id', contractorId) : dup.is('contractor_id', null)
    const { count: existing } = await dup
    if (existing) return data // вже є такий документ — дзеркало не створюємо
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

  // docId — це generated_docs.id. Для прив'язки руху до розділу «Документи»
  // знаходимо дзеркальний рядок у documents (за generated_doc_id).
  let mirrorId = null
  if (docId) {
    const { data: mirror } = await supabase.from('documents').select('id').eq('generated_doc_id', docId).maybeSingle()
    mirrorId = mirror?.id || null
  }

  for (const item of items) {
    if (!item.name?.trim()) continue
    const qty = parseFloat(item.quantity) || 0
    if (qty <= 0) continue

    // Знайти або створити продукт
    const resolved = item.productId
      ? { productId: item.productId, isNew: false }
      : await resolveProduct(item.name, item.unit || 'шт', parseFloat(item.unitPrice) || null, userId, item.sku || null)

    if (!resolved?.productId) continue

    // Послуги/розхідники також ведуться рухами (in/out) — облік кількості/вартості, без залишку-балансу в розділі «Товари»

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
      document_id: mirrorId,
      date: date || new Date().toISOString().split('T')[0],
      description: `${dt.label}: ${item.name}`,
      source: 'document',
      created_by: userId,
    })
  }
}

// ── Оновити документ ──
export async function updateDoc(id, { docNumber, docDate, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress }) {
  const base = {
    doc_number: docNumber,
    doc_date: docDate,
    items: JSON.stringify(cleanItems(items)),
    subtotal, vat_amount: vatAmount, total,
    notes: notes || null,
    contract_num: contractNum || null,
    contract_date: contractDate || null,
    payment_due: paymentDue || null,
    city: city || null,
  }
  const refs = {
    invoice_ref: invoiceRef || null,
    invoice_ref_date: invoiceRefDate || null,
    delivery_basis: deliveryBasis || null,
    delivery_address: deliveryAddress || null,
  }
  let { error } = await supabase.from('generated_docs').update({ ...base, ...refs }).eq('id', id)
  if (error && isMissingRefsColumn(error.message)) {
    ;({ error } = await supabase.from('generated_docs').update(base).eq('id', id))
  }
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

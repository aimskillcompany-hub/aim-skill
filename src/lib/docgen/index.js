// ── Document Generation Public API ──
import { getCompany } from '../companyConfig'
import { getDocType } from './templates/registry'
import { downloadPdf, openPdf, getPdfBlob, getPdfBase64 } from './pdfBuilder'
import { downloadXlsx } from './xlsxBuilder'
import { calcTotals } from './formatUtils'
import { supabase } from '../supabase'
import { qc, withCompany } from '../companyScope'
import { todayKyiv } from '../dates'


// Типи, на які ПДВ не нараховується: позика (поворотна фінансова допомога) — не постачання (ТЗ 6.6, помилка 5)
export const noVatType = (t) => t === 'loanAgreement'
export { DOCUMENT_TYPES, getDocType, getDocLabel, STATUS_LABELS, STATUS_COLORS } from './templates/registry'
export { calcTotals, amountInWords, formatMoney, formatDate } from './formatUtils'

// Фільтрувати порожні позиції
function cleanItems(items) {
  return (items || []).filter(it => it.name?.trim())
}

// Опції для шаблону: ПДВ + бренд (тема документа за компанією).
// AiM-брендинг (лого/футер/лайм) — лише для ЕЙМ СКІЛ; решта — власне лого або без нього.
function docOptions(options, company) {
  return {
    ...(options || {}),
    vatPayer: company.isVatPayer !== false,
    brand: {
      theme: company.docTheme || (company.isAim ? 'aim' : 'clean'),
      companyLogo: company.logoBase64 || null,
      name: company.shortName || company.name || '',
      phone: company.phone || '',
      email: company.email || '',
    },
  }
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
  const docDef = dt.template.pdf(seller, buyer, cleanItems(items), docOptions(options, company))
  const fileName = `${dt.label}_${options.docNumber}${options.docDate ? '_' + options.docDate : ''}.pdf`
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
  const docDef = dt.template.pdf(seller, buyer, clean, docOptions(options, company))
  const { total, vatAmount } = calcTotals(clean)
  const fileName = `${dt.label}_${options.docNumber}${options.docDate ? '_' + options.docDate : ''}.pdf`

  // 1) Завантажуємо PDF одразу (перевірений шлях) — користувач завжди отримує файл
  downloadPdf(docDef, fileName)

  // 2) Збереження в Документи — best-effort (не блокує отримання PDF)
  const blob = await getPdfBlob(docDef)
  const path = `orders/${orderId}/${Date.now()}_${docTypeKey}.pdf`
  const { error: upErr } = await supabase.storage.from('documents').upload(path, blob, { contentType: 'application/pdf', upsert: false })
  if (upErr) throw upErr
  await qc('documents').delete().eq('order_id', orderId).eq('type', docTypeKey).eq('doc_number', options.docNumber)
  const { error: insErr } = await qc('documents').insert(withCompany({
    type: docTypeKey, order_id: orderId, contractor_id: contractorId || contractor?.id || null,
    doc_number: options.docNumber, doc_date: options.docDate || null, amount: total || null, vat_amount: noVatType(docTypeKey) ? 0 : (vatAmount || null),
    file_name: fileName, storage_path: path, direction: dt.direction === 'incoming' ? 'payable' : 'receivable',
  }))
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
  const docDef = supplierOrder.pdf(company, supplier || {}, items || [], docOptions(options, company))
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
    const docDef = dt.template.pdf(seller, buyer, cleanItems(items), docOptions(options, company))
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
  const docDef = cp.pdf(company, contractor || {}, cleanItems(items), docOptions(options, company))
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
  const docDef = dt.template.pdf(seller, buyer, cleanItems(items), docOptions(options, company))
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
  const docDef = dt.template.pdf(seller, buyer, cleanItems(items), docOptions(options, company))
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
  const wb = dt.template.xlsx(seller, buyer, cleanItems(items), docOptions(options, company))
  const fileName = `${dt.label}_${options.docNumber}${options.docDate ? '_' + options.docDate : ''}.xlsx`
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

  // Нумерація ОКРЕМА на кожну юрособу: qc() скоупить за активною компанією (company_id).
  // етап 3 об'єднання: усі документи — в documents (і згенеровані, і завантажені з тим самим префіксом)
  const { data } = await qc('documents')
    .select('doc_number')
    .eq('type', docTypeKey)

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

const cleanErr = (m) => /PERIOD_CLOSED/.test(m || '') ? String(m).replace(/^.*PERIOD_CLOSED:\s*/, '')
  : /DOC_NUMBER_TAKEN/.test(m || '') ? String(m).replace(/^.*DOC_NUMBER_TAKEN:\s*/, '').replace(/^номер/, 'Номер') + ' — змініть номер (міграція 097)'
  : String(m || '').replace(/^NO_RIGHTS:\s*/, '')

// ── Зберегти документ в БД ──
// Етап 3 об'єднання документів: документ — ОДИН рядок у documents (дані для PDF — items, print_data тощо).
export async function saveDoc({ docType, docNumber, docDate, contractorId, contractorName, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress, parentDocId, contractId, orderId, userId }) {
  const dt = getDocType(docType)
  // той самий тип + номер + контрагент уже є → не створюємо другий (раніше тихо створювався «зайвий» PDF)
  let dup = qc('documents').select('id').eq('type', docType).eq('doc_number', docNumber)
  dup = contractorId ? dup.eq('contractor_id', contractorId) : dup.is('contractor_id', null)
  const { data: existing } = await dup.limit(1)
  if (existing?.length) throw new Error(`${dt?.label || 'Документ'} № ${docNumber} для цього контрагента вже є — відкрийте його і відредагуйте, або змініть номер.`)
  const id = (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) || undefined
  const row = withCompany({
    ...(id ? { id, file_path: `generated/${id}.pdf` } : {}),
    type: docType, doc_number: docNumber, doc_date: docDate || null,
    contractor_id: contractorId || null, order_id: orderId || null,
    amount: total ?? null, vat_amount: noVatType(docType) ? 0 : (vatAmount ?? null), subtotal: subtotal ?? null,
    direction: dt?.direction === 'incoming' ? 'payable' : 'receivable',
    doc_role: dt?.direction === 'incoming' ? 'incoming' : 'outgoing',
    file_name: `${dt?.label || 'Документ'}_${docNumber}.pdf`,
    source: 'generated',
    items: cleanItems(items),
    parent_doc_id: parentDocId || null, contract_id: contractId || null,
    print_data: printDataOf({ contractorName, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress }),
  })
  const { data, error } = await qc('documents').insert(row).select('id').single()
  if (error) throw new Error('Документ не збережено: ' + (/items|print_data|subtotal/.test(error.message || '') ? 'спершу застосуйте міграцію 083' : cleanErr(error.message)))

  // Автоматичні складські рухи тільки для прихідних (IN); для видаткових (OUT) — підтвердження користувача
  if (dt?.stockEffect === 'in' && data?.id) {
    try {
      await createStockFromDoc(data.id, docType, cleanItems(items), docDate, userId)
    } catch (e) {
      await deleteGeneratedDoc(data.id).catch(() => {}) // прихідна без оприбуткування — відкат цілком
      throw new Error('Документ не збережено: ' + e.message)
    }
  }
  return data
}

// реквізити лише для друку (documents.print_data)
function printDataOf({ contractorName, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress }) {
  const o = { contractor_name: contractorName, notes, contract_num: contractNum, contract_date: contractDate, payment_due: paymentDue, city,
    invoice_ref: invoiceRef, invoice_ref_date: invoiceRefDate, delivery_basis: deliveryBasis, delivery_address: deliveryAddress }
  Object.keys(o).forEach(k => { if (o[k] == null || o[k] === '') delete o[k] })
  return o
}

// Документ за будь-яким його id: documents.id (нові), старий id згенерованого (legacy_generated_id / generated_doc_id)
export async function resolveDocRow(anyId, cols = '*') {
  if (!anyId) return null
  for (const col of ['id', 'legacy_generated_id', 'generated_doc_id']) {
    const { data, error } = await qc('documents').select(cols).eq(col, anyId).limit(1)
    if (error && col !== 'id') continue
    if (error) throw new Error(error.message)
    if (data?.length) return data[0]
  }
  return null
}

// Рядок documents → форма «згенерованого документа» для шаблонів PDF і редактора (ті самі назви полів, що були в generated_docs)
export function docRowToGen(d) {
  if (!d) return null
  const p = d.print_data || {}
  let items = d.items
  if (typeof items === 'string') { try { items = JSON.parse(items) } catch { items = [] } }
  return {
    id: d.id, documentId: d.id, doc_type: d.type, doc_number: d.doc_number, doc_date: d.doc_date,
    contractor_id: d.contractor_id, contractor_name: p.contractor_name || d.contractors?.name || '',
    items: Array.isArray(items) ? items : [], subtotal: d.subtotal, vat_amount: d.vat_amount, total: d.amount,
    notes: p.notes, contract_num: p.contract_num, contract_date: p.contract_date, payment_due: p.payment_due, city: p.city,
    invoice_ref: p.invoice_ref, invoice_ref_date: p.invoice_ref_date, delivery_basis: p.delivery_basis, delivery_address: p.delivery_address,
    status: d.gen_status, bank_transaction_id: d.gen_bank_transaction_id, parent_doc_id: d.parent_doc_id, contract_id: d.contract_id,
    order_id: d.order_id, to_sign: d.to_sign, to_sign_at: d.to_sign_at, created_at: d.created_at,
    storage_path: d.storage_path, file_path: d.file_path, source: d.source,
  }
}
export async function loadGenDoc(anyId) { return docRowToGen(await resolveDocRow(anyId)) }
// згенерований документ (без власного скану PDF будується з даних картки)
export const isGeneratedDoc = (d) => !!d && (d.source === 'generated' || !!d.generated_doc_id)

// ── Створити складські рухи з документа ──
export async function createStockFromDoc(docId, docType, items, date, userId) {
  const dt = getDocType(docType)
  if (!dt?.stockEffect) return

  const { resolveProduct } = await import('../stockService')

  // docId — documents.id (етап 3); старі виклики могли передати id згенерованого — шукаємо за будь-яким
  const mirror = docId ? await resolveDocRow(docId, 'id') : null
  const mirrorId = mirror?.id || null
  const created = [] // id створених рухів — щоб відкотити, якщо наступний не вдасться
  const rollback = async () => { if (created.length) await qc('stock_movements').delete().in('id', created) }

  for (const [idx, item] of items.entries()) {
    if (!item.name?.trim()) continue
    const qty = parseFloat(item.quantity) || 0
    if (qty <= 0) continue

    // Знайти або створити продукт
    const resolved = item.productId
      ? { productId: item.productId, isNew: false }
      : await resolveProduct(item.name, item.unit || 'шт', dt.stockEffect === 'in' ? (parseFloat(item.unitPrice) || null) : null, userId, item.sku || null) // ціна продажу ≠ закупівельна

    if (!resolved?.productId) continue

    // Послуги/розхідники також ведуться рухами (in/out) — облік кількості/вартості, без залишку-балансу в розділі «Товари»

    // Створити рух
    const unitPrice = parseFloat(item.unitPrice) || null
    const total = parseFloat(item.amount) || qty * (unitPrice || 0)

    // Для OUT — FIFO cost, для IN — ціна закупки
    let costPrice = null
    if (dt.stockEffect === 'out') {
      const { getLastPurchaseCost } = await import('../stockService')
      costPrice = await getLastPurchaseCost(resolved.productId, date || null) // остання закупівля (рішення №16)
    } else if (dt.stockEffect === 'in') {
      costPrice = unitPrice // для IN cost = ціна закупки
    }

    const row = withCompany({
      product_id: resolved.productId,
      type: dt.stockEffect,
      quantity: qty,
      price: unitPrice,
      total,
      cost_price: costPrice,
      document_id: mirrorId,
      date: date || todayKyiv(),
      description: `${dt.label}: ${item.name}`,
      source: 'document',
      created_by: userId,
      doc_line: idx + 1, // номер позиції документа (076) — для ручної прив'язки рядка
    })
    let { data: mv, error: sErr } = await qc('stock_movements').insert(row).select('id').single()
    if (sErr && /doc_line/.test(sErr.message || '')) { const { doc_line, ...rest } = row; ({ data: mv, error: sErr } = await qc('stock_movements').insert(rest).select('id').single()) }
    if (sErr) {
      await rollback()
      throw new Error('рух складу не створено (' + (item.name || '') + '): ' + cleanErr(sErr.message))
    }
    created.push(mv.id)
  }
  return created
}

// ── Синхронізувати складські рухи відредагованого документа (видаткова / прихідна) ──
// Рядок документа ↔ рух за номером рядка (doc_line); старі рухи без doc_line — по порядку позицій.
// Змінені к-сть / ціна / товар / дата → UPDATE руху (рух не перестворюється — прив'язки до партій лишаються),
// нові позиції → новий рух, вилучені позиції → рух видаляється. Повертає { updated, created, deleted }.
export async function syncStockForGenerated(genId, docType, items, date, userId) {
  const dt = getDocType(docType)
  if (!dt?.stockEffect || !genId) return { skipped: true }
  const mirror = await resolveDocRow(genId, 'id')
  if (!mirror) return { skipped: true }
  let existing
  {
    const r = await qc('stock_movements').select('id, product_id, quantity, price, date, doc_line, created_at, source').eq('document_id', mirror.id).neq('source', 'assembly')
    if (r.error && /doc_line/.test(r.error.message || '')) {
      const r2 = await qc('stock_movements').select('id, product_id, quantity, price, date, created_at, source').eq('document_id', mirror.id).neq('source', 'assembly')
      if (r2.error) throw new Error(r2.error.message)
      existing = r2.data || []
    } else if (r.error) throw new Error(r.error.message)
    else existing = r.data || []
  }
  if (!existing.length) return { skipped: true, noMovements: true }   // рухів не було (списання вимкнено) — нічого не створюємо самовільно
  const eligible = (items || []).map((it, idx) => ({ it, line: idx + 1, qty: parseFloat(it.quantity) || 0 })).filter(x => x.it?.name?.trim() && x.qty > 0)
  // відповідність рух ↔ рядок: спершу doc_line, решта (старі рухи) — по порядку
  const byLine = {}
  existing.filter(m => m.doc_line).forEach(m => { if (!byLine[m.doc_line]) byLine[m.doc_line] = m })
  const legacy = existing.filter(m => !m.doc_line || byLine[m.doc_line] !== m).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  eligible.forEach(x => { if (!byLine[x.line] && legacy.length) byLine[x.line] = legacy.shift() })
  const used = new Set()
  const { resolveProduct } = await import('../stockService')
  let updated = 0, created = 0, deleted = 0
  for (const x of eligible) {
    const it = x.it, mv = byLine[x.line]
    const unitPrice = parseFloat(it.unitPrice) || null
    const total = parseFloat(it.amount) || x.qty * (unitPrice || 0)
    let productId = it.productId || null
    if (!productId && mv) productId = mv.product_id   // назву могли підправити — товар лишаємо той самий
    if (!productId) {
      const resolved = await resolveProduct(it.name, it.unit || 'шт', dt.stockEffect === 'in' ? unitPrice : null, userId, it.sku || null)
      productId = resolved?.productId
    }
    if (!productId) continue
    if (mv) {
      used.add(mv.id)
      const patch = {}
      if (Math.abs((Number(mv.quantity) || 0) - x.qty) > 0.00001) patch.quantity = x.qty
      if (unitPrice != null && Math.abs((Number(mv.price) || 0) - unitPrice) > 0.004) { patch.price = unitPrice; patch.total = total; if (dt.stockEffect === 'in') patch.cost_price = unitPrice }
      if (mv.product_id !== productId) patch.product_id = productId
      if (date && mv.date !== date) patch.date = date
      if (mv.doc_line !== x.line && 'doc_line' in mv) patch.doc_line = x.line
      if (Object.keys(patch).length) {
        const { error } = await qc('stock_movements').update(patch).eq('id', mv.id)
        if (error) throw new Error('Рух складу «' + it.name + '» не оновлено: ' + cleanErr(error.message))
        updated++
      }
    } else {
      const row = withCompany({
        product_id: productId, type: dt.stockEffect, quantity: x.qty, price: unitPrice, total,
        cost_price: dt.stockEffect === 'in' ? unitPrice : null, document_id: mirror.id, date: date || todayKyiv(),
        description: `${dt.label}: ${it.name}`, source: 'document', created_by: userId, doc_line: x.line,
      })
      let { error } = await qc('stock_movements').insert(row)
      if (error && /doc_line/.test(error.message || '')) { const { doc_line, ...rest } = row; ({ error } = await qc('stock_movements').insert(rest)) }
      if (error) throw new Error('Рух складу «' + it.name + '» не створено: ' + cleanErr(error.message))
      created++
    }
  }
  for (const m of existing) {
    if (used.has(m.id)) continue
    const { error } = await qc('stock_movements').delete().eq('id', m.id)
    if (error) throw new Error('Рух складу вилученої позиції не видалено: ' + cleanErr(error.message))
    deleted++
  }
  return { updated, created, deleted }
}

// ── Оновити документ ── (етап 3: один рядок documents; id — будь-який id документа)
export async function updateDoc(id, { docNumber, docDate, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress }) {
  const d = await resolveDocRow(id, 'id, type, print_data, contractors(name)')
  if (!d) throw new Error('Документ не знайдено')
  const pd = { ...(d.print_data || {}), ...printDataOf({ contractorName: d.print_data?.contractor_name || d.contractors?.name, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress }) }
  ;['notes', 'contract_num', 'contract_date', 'payment_due', 'city', 'invoice_ref', 'invoice_ref_date', 'delivery_basis', 'delivery_address'].forEach(k => {
    const v = { notes, contract_num: contractNum, contract_date: contractDate, payment_due: paymentDue, city, invoice_ref: invoiceRef, invoice_ref_date: invoiceRefDate, delivery_basis: deliveryBasis, delivery_address: deliveryAddress }[k]
    if (v == null || v === '') delete pd[k]
  })
  const { error } = await qc('documents').update({
    doc_number: docNumber, doc_date: docDate || null, amount: total ?? null, vat_amount: noVatType(d.type) ? 0 : (vatAmount ?? null), subtotal: subtotal ?? null,
    items: cleanItems(items), print_data: pd,
  }).eq('id', d.id)
  if (error) throw new Error('Не збережено: ' + cleanErr(error.message))
}

// ── Видалити згенерований документ: рухи складу (крім збірок) → картка documents → його архівна версія ──
// Одна транзакція (RPC delete_document_full, міграція 086): закритий період / права — не видаляється нічого.
export async function deleteGeneratedDoc(anyId) {
  const d = await resolveDocRow(anyId, 'id, generated_doc_id')
  if (!d) {
    // лише старий згенерований без картки
    const { error } = await supabase.rpc('delete_generated_doc', { p_id: anyId })
    if (error) throw new Error(cleanErr(error.message))
    return
  }
  const { error } = await supabase.rpc('delete_document_full', { p_doc: d.id })
  if (!error) return
  if (!(error.code === 'PGRST202' || /delete_document_full/.test(error.message || ''))) throw new Error(cleanErr(error.message))
  // до 086 — покроково; якщо правила доступу «сховали» рухи (не видалились) — документ НЕ видаляємо (без рухів-сиріт)
  const { error: sErr } = await qc('stock_movements').delete().eq('document_id', d.id).neq('source', 'assembly')
  if (sErr) throw new Error(cleanErr(sErr.message))
  const { count: left } = await qc('stock_movements').select('id', { count: 'exact', head: true }).eq('document_id', d.id).neq('source', 'assembly')
  if (left > 0) throw new Error(`Недостатньо прав, щоб видалити складські рухи документа (${left}). Документ не видалено — видалити може адміністратор.`)
  const { error: dErr } = await qc('documents').delete().eq('id', d.id)
  if (dErr) throw new Error(cleanErr(dErr.message))
  if (d.generated_doc_id) await qc('generated_docs').delete().eq('id', d.generated_doc_id)
}
export const deleteDocument = deleteGeneratedDoc

// Що зникне / зміниться разом із документом — текст для підтвердження видалення (086: delete_document_preview).
// Без міграції або при помилці — порожній рядок (підтвердження без подробиць).
export async function describeDeletion(anyId) {
  try {
    const d = await resolveDocRow(anyId, 'id')
    if (!d) return ''
    const { data: p, error } = await supabase.rpc('delete_document_preview', { p_doc: d.id })
    if (error || !p) return ''
    const fmt = (n) => Number(n || 0).toLocaleString('uk-UA', { maximumFractionDigits: 2 })
    const lines = []
    if (p.movements) lines.push(`• складські рухи: ${p.movements} (склад відкотиться)`)
    if (p.payments?.count) lines.push(`• прив'язки оплат: ${p.payments.count} на ${fmt(p.payments.amount)} грн — платежі стануть «без прив'язки»`)
    if (Number(p.sold_from_batches?.qty) > 0) lines.push(`• з партій цієї прихідної вже продано ${fmt(p.sold_from_batches.qty)} шт (${(p.sold_from_batches.docs || []).join(', ')}) — собівартість цих продажів доведеться перерахувати (FIFO)`)
    if (p.manual) lines.push(`• ручні дані звірки (прив'язки партій, ручна собівартість, закриті партії): ${p.manual}`)
    if (p.recon_acks) lines.push(`• позначки «перевірено» у звірці: ${p.recon_acks}`)
    if (p.agent_commission) lines.push('• агентська комісія документа')
    if (p.children) lines.push(`• пов'язані («дочірні») документи: ${p.children} — посилання на цей документ буде прибрано`)
    return lines.length ? '\n\nРазом із документом зникне:\n' + lines.join('\n') : ''
  } catch { return '' }
}

// ── Оновити статус ──
export async function updateDocStatus(id, status, bankTransactionId) {
  const d = await resolveDocRow(id, 'id')
  if (!d) throw new Error('Документ не знайдено')
  const upd = { gen_status: status }
  if (bankTransactionId) upd.gen_bank_transaction_id = bankTransactionId
  const { error } = await qc('documents').update(upd).eq('id', d.id)
  if (error) throw new Error(error.message)
}

// ── Завантажити документи контрагента ──
export async function loadContractorDocs(contractorId) {
  const { data } = await qc('documents')
    .select('*')
    .eq('contractor_id', contractorId)
    .or('source.eq.generated,generated_doc_id.not.is.null')
    .order('doc_date', { ascending: false })
  return (data || []).map(docRowToGen)
}

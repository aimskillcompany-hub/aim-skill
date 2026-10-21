// ── Document Generation Public API ──
import { getCompany } from '../companyConfig'
import { getDocType } from './templates/registry'
import { downloadPdf, openPdf, getPdfBlob, getPdfBase64 } from './pdfBuilder'
import { downloadXlsx } from './xlsxBuilder'
import { calcTotals } from './formatUtils'
import { supabase } from '../supabase'
import { qc, withCompany } from '../companyScope'
import { todayKyiv } from '../dates'

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
    doc_number: options.docNumber, doc_date: options.docDate || null, amount: total || null, vat_amount: vatAmount || null,
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
  const { data } = await qc('generated_docs')
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

const cleanErr = (m) => /PERIOD_CLOSED/.test(m || '') ? String(m).replace(/^.*PERIOD_CLOSED:\s*/, '') : m

// ── Зберегти документ в БД ──
export async function saveDoc({ docType, docNumber, docDate, contractorId, contractorName, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress, parentDocId, contractId, orderId, userId }) {
  const base = {
    doc_type: docType,
    doc_number: docNumber,
    doc_date: docDate || null,
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
  let { data, error } = await qc('generated_docs').insert(withCompany({ ...base, ...refs })).select('id').single()
  if (error && isMissingRefsColumn(error.message)) {
    ;({ data, error } = await qc('generated_docs').insert(withCompany(base)).select('id').single())
  }

  if (error) throw new Error(error.message)

  const dt = getDocType(docType)

  // Дзеркало в documents (канонічний список: Документи, картка контрагента, борги).
  // Створюється МИТТЄВО (без рендера PDF). Пропускаємо, якщо документ з таким
  // же контрагентом+типом+номером уже існує (щоб не задвоювати борг).
  if (data?.id) {
    let dup = qc('documents').select('id', { count: 'exact', head: true }).eq('type', docType).eq('doc_number', docNumber)
    dup = contractorId ? dup.eq('contractor_id', contractorId) : dup.is('contractor_id', null)
    const { count: existing } = await dup
    if (existing) return data // вже є такий документ — дзеркало не створюємо
    const { error: mErr } = await qc('documents').insert(withCompany({
      type: docType, doc_number: docNumber, doc_date: docDate || null,
      contractor_id: contractorId || null, order_id: orderId || null,
      amount: total ?? null, vat_amount: vatAmount ?? null,
      direction: dt.direction === 'incoming' ? 'payable' : 'receivable',
      doc_role: dt.direction === 'incoming' ? 'incoming' : 'outgoing',
      file_name: `${dt.label}_${docNumber}.pdf`, file_path: `generated/${data.id}.pdf`,
      source: 'generated', generated_doc_id: data.id,
    }))
    if (mErr) {
      // без дзеркала документ не потрапив би в борги/Документи — відкочуємо, щоб не лишати «напівзбережене»
      await qc('generated_docs').delete().eq('id', data.id)
      throw new Error('Документ не збережено: ' + cleanErr(mErr.message))
    }
  }

  // Автоматичні складські рухи тільки для прихідних (IN)
  // Для видаткових (OUT) — потрібне підтвердження користувача
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

// ── Створити складські рухи з документа ──
export async function createStockFromDoc(docId, docType, items, date, userId) {
  const dt = getDocType(docType)
  if (!dt?.stockEffect) return

  const { resolveProduct } = await import('../stockService')

  // docId — це generated_docs.id. Для прив'язки руху до розділу «Документи»
  // знаходимо дзеркальний рядок у documents (за generated_doc_id).
  let mirrorId = null
  if (docId) {
    const { data: mirror, error: mErr } = await qc('documents').select('id').eq('generated_doc_id', docId).maybeSingle()
    if (mErr) throw new Error(mErr.message)
    mirrorId = mirror?.id || null
  }
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
  const { data: mirror, error: mErr } = await qc('documents').select('id').eq('generated_doc_id', genId).maybeSingle()
  if (mErr) throw new Error(mErr.message)
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

// ── Оновити документ ──
export async function updateDoc(id, { docNumber, docDate, items, subtotal, vatAmount, total, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress }) {
  const base = {
    doc_number: docNumber,
    doc_date: docDate || null,
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
  // Спершу дзеркало в documents (на ньому тригер закритого періоду), потім сам документ —
  // щоб не вийшло «документ змінено, а борг ні».
  const { data: prevMirror } = await qc('documents').select('id, doc_number, doc_date, amount, vat_amount').eq('generated_doc_id', id)
  const { error: mErr } = await qc('documents').update({ doc_number: docNumber, doc_date: docDate || null, amount: total ?? null, vat_amount: vatAmount ?? null }).eq('generated_doc_id', id)
  if (mErr) throw new Error('Не збережено: ' + cleanErr(mErr.message))
  let { error } = await qc('generated_docs').update({ ...base, ...refs }).eq('id', id)
  if (error && isMissingRefsColumn(error.message)) {
    ;({ error } = await qc('generated_docs').update(base).eq('id', id))
  }
  if (error) {
    for (const m of prevMirror || []) await qc('documents').update({ doc_number: m.doc_number, doc_date: m.doc_date, amount: m.amount, vat_amount: m.vat_amount }).eq('id', m.id)
    throw new Error(error.message)
  }
}

// ── Видалити згенерований документ разом із дзеркалом у documents і його рухами складу ──
// Одна транзакція (RPC delete_generated_doc, міграція 070): якщо щось заборонено (закритий період) —
// не видаляється нічого. До 070 — покроково з перевіркою помилок (рухи → дзеркало → документ).
export async function deleteGeneratedDoc(id) {
  const { error } = await supabase.rpc('delete_generated_doc', { p_id: id })
  if (!error) return
  if (!(error.code === 'PGRST202' || /delete_generated_doc/.test(error.message || ''))) throw new Error(cleanErr(error.message))
  const { data: mirrors, error: mErr } = await qc('documents').select('id').eq('generated_doc_id', id)
  if (mErr) throw new Error(mErr.message)
  const ids = (mirrors || []).map(m => m.id)
  if (ids.length) {
    const { error: sErr } = await qc('stock_movements').delete().in('document_id', ids).neq('source', 'assembly')
    if (sErr) throw new Error(cleanErr(sErr.message))
    const { error: dErr } = await qc('documents').delete().in('id', ids)
    if (dErr) throw new Error(cleanErr(dErr.message))
  }
  const { error: gErr } = await qc('generated_docs').delete().eq('id', id)
  if (gErr) throw new Error(cleanErr(gErr.message))
}

// ── Оновити статус ──
export async function updateDocStatus(id, status, bankTransactionId) {
  const upd = { status }
  if (bankTransactionId) upd.bank_transaction_id = bankTransactionId
  const { error } = await qc('generated_docs').update(upd).eq('id', id)
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

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { extractDocumentMulti } from '../lib/ai'
import { fetchArticles } from '../lib/articles'
import { getContractorMatcher } from '../lib/contractorMatch'
import { resolveProduct, createStockMovement } from '../lib/stockService'
import { DOCUMENT_TYPES, getDocType } from '../lib/docgen'
import { fmt } from '../lib/fmt'
import ContractorSelect from './ui/ContractorSelect'
import { kyivDateOfTs, todayKyiv } from '../lib/dates'
import { useNewUi } from '../lib/uiPrefs'
import { Button, Menu, Switch, Segmented, InfoTip } from './ui'
import { formatAmount } from '../utils/format'
import './DocEditNew.css'

export const dirFromType = (key) => {
  const t = getDocType(key)
  return t?.direction === 'incoming' ? 'payable' : 'receivable'
}

// Напрямок документа. Для ДВОНАПРЯМНИХ типів (акт/рахунок/інше — постачальник
// виставляє НАМ або ми клієнту) напрямок визначає doc_role, а не дефолт типу.
// Для однозначних (видаткова=outgoing, прихідна=incoming) — за типом.
const AMBIG_DIR = new Set(['serviceAct', 'invoice', 'other'])
export function resolveDocDir(type, docRole, contractor) {
  const td = getDocType(type)?.direction // 'incoming' | 'outgoing'
  if (AMBIG_DIR.has(type)) {
    // Найнадійніший сигнал — тип контрагента: чистий постачальник → вхідний (ми винні),
    // чистий клієнт → вихідний (нам винні). Інакше — за розпізнаним doc_role.
    if (contractor?.is_supplier && !contractor?.is_client) return { role: 'incoming', direction: 'payable' }
    if (contractor?.is_client && !contractor?.is_supplier) return { role: 'outgoing', direction: 'receivable' }
    const role = docRole || td || 'incoming'
    return { role, direction: role === 'incoming' ? 'payable' : 'receivable' }
  }
  const role = td || docRole || 'incoming'
  return { role, direction: role === 'incoming' ? 'payable' : 'receivable' }
}

// Тип документа з розпізнаного OCR (docType + напрям), а не лише з напряму
export const typeFromOcr = (docType, docRole) => {
  const t = (docType || '').trim().toLowerCase()
  if (t.startsWith('акт')) return 'serviceAct'            // «Акт …» (не плутати з «фАКТура»)
  if (t.includes('комерц') || t.includes('пропозиц')) return 'commercialProposal'
  if (t.includes('договір') || t.includes('договор') || t.includes('угода'))
    return (t.includes('фін') || t.includes('позик') || t.includes('поворотн')) ? 'loanAgreement' : 'supplyAgreement'
  if (t.includes('рахунок') || t.includes('фактура')) return 'invoice'   // рахунок / рахунок-фактура
  if (t.includes('накладна')) return docRole === 'outgoing' ? 'waybill' : 'incomingWaybill'
  if (t.includes('інше') || t.includes('інший')) return 'other'          // ТТН/довіреність тощо — без боргу/складу
  return docRole === 'outgoing' ? 'waybill' : 'incomingWaybill'
}

// Зрозуміла назва файлу з розпізнаних даних: «Тип №Номер Контрагент Дата.ext»
export function buildDocFileName({ type, docNumber, contractorName, date }, origName = '') {
  const label = getDocType(type)?.label || 'Документ'
  const num = docNumber ? `№${String(docNumber).trim()}` : ''
  const cn = (contractorName || '').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim()
  const base = [label, num, cn, date || ''].filter(Boolean).join(' ')
    .replace(/[\/\\:*?<>|]+/g, '-').replace(/\s+/g, ' ').trim()
  const ext = (origName.split('.').pop() || '').toLowerCase()
  const cleanExt = /^(pdf|jpe?g|png|webp|gif|heic|heif)$/.test(ext) ? ext : 'jpg'
  return base ? `${base}.${cleanExt}` : origName
}

// Порожня форма документа (для прикріплення файлу без OCR або фолбеку при помилці OCR)
const defaultForm = (fileName = '', posted = true) => ({
  type: 'supplyAgreement',
  file_name: fileName,
  doc_number: '',
  contractor_id: null, contractorName: '', edrpou: '',
  amount: '', vat_amount: 0,
  date: todayKyiv(),
  doc_role: 'incoming', items: [], posted,
})

// Універсальна модалка документа: завантаження+OCR (новий), розпізнавання (existingDoc+autoOcr),
// перегляд/редагування/видалення (existingDoc, autoOcr=false). Прев'ю файлу зліва, поля справа.
export default function DocModal({ user, existingDoc, autoOcr = true, orderId, onClose, onSaved }) {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewType, setPreviewType] = useState('image')
  const [stockOn, setStockOn] = useState(false)   // оприбуткувати/списати позиції на склад
  const [stockDir, setStockDir] = useState('in')  // 'in' = прихід, 'out' = видача (FIFO)
  const [verified, setVerified] = useState(!!existingDoc?.is_verified) // документ перевірено (звірка скан↔поля)
  const [signedSaved, setSignedSaved] = useState(false) // індикатор авто-збереження «Підписаний»
  const [docMovements, setDocMovements] = useState(null) // фактично створені складські рухи цього документа
  const [whDate, setWhDate] = useState(null) // дата оприбуткування прихідної (076; змінюється лише в «Звірці видаткових»)
  const navigate = useNavigate()
  const [stockMsg, setStockMsg] = useState(null) // результат ручного «Оприбуткувати на склад зараз»
  const newUi = useNewUi()
  const [linked, setLinked] = useState(null)   // новий інтерфейс: «Пов'язане» — замовлення й прив'язані оплати
  useEffect(() => {
    if (!newUi || !existingDoc?.id) return
    ;(async () => {
      const { data: d } = await qc('documents').select('order_id').eq('id', existingDoc.id).maybeSingle()
      const { data: o } = d?.order_id ? await qc('orders').select('id, order_number').eq('id', d.order_id).maybeSingle() : { data: null }
      const { data: td } = await supabase.from('transaction_documents').select('bank_transactions(id, date, amount, counterparty, description)').eq('document_id', existingDoc.id)
      setLinked({ order: o || null, pays: (td || []).map(x => x.bank_transactions).filter(Boolean) })
    })().catch(() => setLinked({ order: null, pays: [] }))
  }, [newUi, existingDoc?.id])

  useEffect(() => { if (existingDoc) recognizeExisting(autoOcr) }, [])

  // Завантажити фактичні складські рухи документа (цифровий аналог: що потрапило на склад)
  const loadMovements = async () => {
    if (!existingDoc?.id) return
    const { data: mv } = await qc('stock_movements')
      .select('id, type, quantity, price, cost_price, product_id, source, description, date')
      .eq('document_id', existingDoc.id).order('date')
    // дата оприбуткування (076) — якщо колонки ще немає, просто null
    const { data: wd, error: wdErr } = await qc('documents').select('warehouse_date').eq('id', existingDoc.id).maybeSingle()
    setWhDate(!wdErr ? wd?.warehouse_date || null : null)
    const pids = [...new Set((mv || []).map(m => m.product_id).filter(Boolean))]
    let pn = {}
    if (pids.length) {
      const { data: prods } = await supabase.from('products').select('id, name').in('id', pids)
      ;(prods || []).forEach(p => pn[p.id] = p.name)
    }
    setDocMovements((mv || []).map(m => ({ ...m, productName: pn[m.product_id] || null })))
  }
  useEffect(() => { loadMovements() }, [existingDoc?.id])

  // Позначити «Перевірено» / зняти позначку (звірено скан↔розпізнані поля/ПДВ/рухи)
  const toggleVerified = async () => {
    if (!existingDoc?.id) return
    setBusy(true); setError(null)
    const next = !verified
    const { error } = await qc('documents')
      .update({ is_verified: next, verified_at: next ? new Date().toISOString() : null, verified_by: next ? (user?.id || null) : null })
      .eq('id', existingDoc.id)
    setBusy(false)
    if (error) { setError(/is_verified/.test(error.message) ? 'Запусти міграцію 029 (поле «перевірено»).' : error.message); return }
    setVerified(next); onSaved?.()
  }

  // Галочка «Підписаний» — авто-збереження (без «Зберегти документ»). Для нового документа — лише у формі.
  const toggleSigned = async (checked) => {
    setForm(f => ({ ...f, is_signed: checked }))
    if (!existingDoc?.id) return
    const { error } = await qc('documents')
      .update({ is_signed: checked, signed_scan_url: checked ? (existingDoc.storage_path || existingDoc.file_path || null) : null })
      .eq('id', existingDoc.id)
    if (error) { setError('Не вдалося зберегти «Підписаний»: ' + error.message); setForm(f => ({ ...f, is_signed: !checked })) }
    else { setError(null); setSignedSaved(true); setTimeout(() => setSignedSaved(false), 1800) }
  }
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  // Дефолти складського руху: для накладних — увімкнено за типом; для актів/рахунків — напрям за роллю, вимкнено (opt-in)
  useEffect(() => {
    if (!form) return
    const dt = getDocType(form.type)
    const role = form.doc_role || existingDoc?.doc_role
    setStockDir(dt?.stockEffect || (role === 'incoming' ? 'in' : 'out'))
    setStockOn((form.items || []).length > 0 && !!dt?.stockEffect)
  }, [form?.type])

  const makePreview = (blob, name = '', type = '') => {
    const ext = (name.split('.').pop() || '').toLowerCase()
    setPreviewType(type.includes('pdf') || ext === 'pdf' ? 'pdf' : 'image')
    setPreviewUrl(URL.createObjectURL(blob))
  }

  const recognizeExisting = async (runAi = true) => {
    setBusy(true); setError(null)
    try {
      const path = existingDoc.storage_path || existingDoc.file_path
      if (!path) throw new Error('У документа немає файлу у сховищі')
      const { data: blob, error: dlErr } = await supabase.storage.from('documents').download(path)
      if (dlErr) throw dlErr
      if (runAi) {
        const file = new File([blob], existingDoc.file_name || 'document', { type: existingDoc.file_type || blob.type })
        await runOcr([file])
      } else {
        makePreview(blob, existingDoc.file_name, existingDoc.file_type || blob.type)
        const d = existingDoc
        setForm({
          type: d.type || (d.doc_role === 'outgoing' ? 'waybill' : 'incomingWaybill'),
          file_name: d.file_name || '',
          doc_number: d.doc_number || '',
          contractor_id: d.contractor_id || null,
          contractorName: d.contractors?.name || '',
          edrpou: '',
          amount: d.amount ?? '',
          vat_amount: d.vat_amount ?? 0,
          date: d.doc_date || kyivDateOfTs(d.created_at),
          is_signed: d.is_signed || false,
          doc_role: d.doc_role || null,
          items: d.ocr_data?.items || [],
          posted: d.posted !== false,
        })
        setBusy(false)
      }
    } catch (e) { setError('Не вдалося отримати файл зі сховища: ' + e.message); setBusy(false) }
  }

  const runOcr = async (fileList) => {
    const arr = Array.from(fileList)
    setFiles(arr); setBusy(true); setError(null)
    if (arr[0]) makePreview(arr[0], arr[0].name, arr[0].type)
    try {
      const articles = await fetchArticles()
      const data = await extractDocumentMulti(arr, articles)
      const matcher = await getContractorMatcher()
      const m = matcher({ counterparty: data.contractor, edrpou: data.edrpou, description: existingDoc?.file_name })
      const docRole = data.docRole || existingDoc?.doc_role || 'incoming'
      const defType = typeFromOcr(data.docType, docRole)
      const contractorName = m?.contractor.name || data.contractor || ''
      // Авто-нормалізація назви для нових завантажень: зрозуміла назва з розпізнаного
      // (для existingDoc лишаємо наявну — не перейменовуємо при повторному розпізнаванні).
      const autoName = buildDocFileName({ type: defType, docNumber: data.docNumber, contractorName, date: data.date }, arr[0]?.name || '')
      setForm({
        type: defType,
        file_name: existingDoc?.file_name || autoName || arr[0]?.name || '',
        doc_number: existingDoc?.doc_number || data.docNumber || '',
        contractor_id: m?.contractor.id || null,
        contractorName,
        edrpou: data.edrpou || '',
        // Повна сума З ПДВ (банк платить gross; борг = повна сума)
        amount: data.totalAmount ?? (data.amountNoVat != null ? Number(data.amountNoVat) + Number(data.vatAmount || 0) : (data.amount ?? '')),
        vat_amount: data.vatAmount ?? 0,
        date: data.date || existingDoc?.doc_date || todayKyiv(),
        is_signed: existingDoc?.is_signed || false,
        doc_role: docRole,
        items: data.items || [],
        posted: existingDoc ? (existingDoc.posted !== false) : !orderId,
      })
    } catch (e) {
      // OCR не спрацював — даємо форму заповнити вручну (не блокуємо збереження)
      setError('OCR не спрацював — заповніть поля вручну. ' + (e.message || ''))
      if (!existingDoc) setForm(f => f || defaultForm(arr[0]?.name || '', !orderId))
    }
    setBusy(false)
  }

  // Прикріпити файл БЕЗ OCR (договір/ТТН/акт тощо — тип задає користувач)
  const attachFile = (fileList) => {
    const arr = Array.from(fileList)
    if (!arr[0]) return
    setFiles(arr); setError(null)
    makePreview(arr[0], arr[0].name, arr[0].type)
    setForm(defaultForm(arr[0].name, !orderId))
  }

  // Ідемпотентно синхронізувати складські рухи документа (замінити ВСІ рухи цього документа,
  // крім збірок, і створити заново) — щоб перерозпізнавання не задвоювало склад.
  // ВАЖЛИВО: якщо «Рух на складі» вимкнено — НЕ чіпаємо наявні рухи. Раніше видаляли завжди,
  // тож просте збереження документа з порожніми позиціями стирало вже створений прихід/видаток.
  const syncDocStock = async (documentId, forceOn) => {
    const on = forceOn ?? stockOn
    if (!on) return 0
    await qc('stock_movements').delete().eq('document_id', documentId).neq('source', 'assembly')
    const failures = []
    const productIds = []
    let created = 0
    for (const [idx, it] of (form.items || []).entries()) {
      const qty = Number(it.quantity ?? it.qty) || 0
      if (!qty || !it.name) { if (it.name) failures.push(`«${it.name}»: немає кількості`); continue }
      const price = Number(it.unit_price ?? it.unitPrice ?? it.price) || null
      try {
        // закупівельну ціну в довідник — лише з прихідних (у видатковій це ціна продажу)
        const resolved = await resolveProduct(it.name, it.unit, stockDir === 'in' ? price : null, user?.id, it.sku ?? it.code ?? null)
        const productId = resolved?.productId
        if (!productId) { failures.push(`«${it.name}»: не вдалося знайти/створити товар`); continue }
        productIds.push(productId)
        await createStockMovement({
          productId, type: stockDir, quantity: qty, price,
          total: Number(it.amount) || (price ? qty * price : null),
          // прихід — на дату оприбуткування, якщо її виправлено (warehouse_date не скидається перезбереженням)
          documentId, date: stockDir === 'in' && whDate ? whDate : form.date, description: `${getDocType(form.type)?.label}: ${it.name}`.slice(0, 200), userId: user?.id,
          docLine: idx + 1,
        })
        created++
      } catch (e) {
        failures.push(`«${it.name}»: ${e.message}`)
      }
    }
    // Товар із рухом складу — фізичний товар. Якщо він був помилково «Розхідним» (expense) — переводимо
    // в «Товар» (goods). «Послуги» (service, напр. ліцензії/ПЗ) НЕ чіпаємо: вони теж ведуться рухами
    // (купівля/продаж для маржі), але це не фізичний склад — тож лишаються послугами.
    if (productIds.length) {
      await supabase.from('products').update({ product_type: 'goods' })
        .in('id', productIds).eq('product_type', 'expense')
    }
    // Якщо жодна позиція не провелась або є збої — показуємо причину (раніше мовчки нічого не створювалось)
    if (failures.length) {
      throw new Error(`Не проведено на склад ${failures.length} з ${(form.items || []).length} позицій:\n${failures.join('\n')}`)
    }
    return created
  }

  // Явне проведення на склад прямо зараз (незалежно від галочки й головного «Зберегти») — з видимим результатом
  const postStockNow = async () => {
    if (!existingDoc?.id) { setStockMsg({ err: 'Спершу збережіть документ, потім оприбуткуйте.' }); return }
    if (!(form.items || []).length) { setStockMsg({ err: 'Немає розпізнаних позицій.' }); return }
    setBusy(true); setStockMsg(null)
    try {
      const n = await syncDocStock(existingDoc.id, true)
      await loadMovements()
      setStockMsg({ ok: `Оприбутковано ${n} позицій на склад.` })
    } catch (e) {
      setStockMsg({ err: e.message })
    }
    setBusy(false)
  }

  // Дата рухів складу = дата документа (без перестворення рухів: товари, ціни й списання з партій лишаються)
  // Якщо в прихідної виправлено дату оприбуткування (warehouse_date), приходи лишаються на ній — не чіпаємо їх.
  const movTarget = (m) => (m.type === 'in' && whDate ? whDate : form.date)
  const syncMovementDates = async (date) => {
    if (!existingDoc?.id || !date) return 0
    let q = qc('stock_movements').update({ date }).eq('document_id', existingDoc.id).neq('source', 'assembly').neq('date', date)
    if (whDate) q = q.neq('type', 'in')
    const { data, error } = await q.select('id')
    let n = data?.length || 0
    if (!error && whDate) {
      const r = await qc('stock_movements').update({ date: whDate }).eq('document_id', existingDoc.id).eq('type', 'in').neq('source', 'assembly').neq('date', whDate).select('id')
      if (r.error) throw new Error(r.error.message)
      n += r.data?.length || 0
    }
    if (error) throw new Error(/PERIOD_CLOSED/.test(error.message || '') ? 'Місяць закрито — дату рухів змінити не можна: ' + String(error.message).replace(/^.*PERIOD_CLOSED:\s*/, '') : error.message)
    return n
  }
  const fixMovementDates = async () => {
    if (!window.confirm(whDate
      ? `Встановити складським рухам цього документа: приходам — дату оприбуткування ${whDate.split('-').reverse().join('.')}, решті — дату документа ${(form.date || '').split('-').reverse().join('.')}?\n\nТовари, кількості й ціни не змінюються.`
      : `Встановити всім складським рухам цього документа дату документа ${(form.date || '').split('-').reverse().join('.')}?\n\nТовари, кількості й ціни не змінюються. Для приходу це дата, з якої партія доступна для відвантажень (FIFO).`)) return
    setBusy(true); setStockMsg(null)
    try { const n = await syncMovementDates(form.date); await loadMovements(); setStockMsg({ ok: `Дату змінено в ${n} рухах.` }) } catch (e) { setStockMsg({ err: e.message }) }
    setBusy(false)
  }

  const save = async () => {
    setBusy(true); setError(null)
    try {
      // Тип контрагента (постачальник/клієнт) — надійний сигнал напряму для акта/рахунка
      let cflags = null
      if (['serviceAct', 'invoice', 'other'].includes(form.type) && form.contractor_id) {
        const { data: cf } = await supabase.from('contractors').select('is_supplier, is_client').eq('id', form.contractor_id).maybeSingle()
        cflags = cf
      }
      if (existingDoc) {
        const { role: resRole, direction: resDir } = resolveDocDir(form.type, form.doc_role || existingDoc.doc_role, cflags)
        const upd = {
          type: form.type,
          contractor_id: form.contractor_id || null,
          amount: Number(form.amount) || null,
          vat_amount: form.type === 'loanAgreement' ? 0 : (Number(form.vat_amount) || 0),   // позика ПДВ не обкладається
          direction: resDir,
          doc_role: resRole,
          is_signed: form.is_signed,
          file_name: form.file_name?.trim() || existingDoc.file_name,
          doc_number: form.doc_number?.trim() || null,
          doc_date: form.date || null,
          ocr_data: form,
          posted: form.posted !== false,
        }
        let { data, error } = await qc('documents').update(upd).eq('id', existingDoc.id).select('id')
        if (error && /posted/.test(error.message || '')) { const { posted, ...rest } = upd; ({ data, error } = await qc('documents').update(rest).eq('id', existingDoc.id).select('id')) }
        if (error) throw error
        if (!data?.length) throw new Error('Документ не оновлено (немає прав UPDATE). Запусти migrations/004 у Supabase.')
        // рухи перестворюються лише з галочкою «Рух на складі»; інакше — тільки переносимо їхню дату за документом
        if (stockOn) await syncDocStock(existingDoc.id)
        else if (form.date && form.date !== (existingDoc.doc_date || null)) await syncMovementDates(form.date)
        onSaved(); return
      }
      // Guard від дублів (лише для нового документа): той самий тип + № + контрагент
      // у межах активної компанії найімовірніше означає повторне завантаження.
      // Сума — додатковий сигнал у тексті. Дублі видаткових подвоюють борг і списання
      // зі складу, тому попереджаємо ПЕРЕД завантаженням файлу в Storage.
      {
        const num = form.doc_number?.trim()
        const amt = Number(form.amount) || null
        if (num || (form.contractor_id && amt != null)) {
          let dq = qc('documents').select('id, doc_number, amount, doc_date').eq('type', form.type)
          dq = form.contractor_id ? dq.eq('contractor_id', form.contractor_id) : dq.is('contractor_id', null)
          if (num) dq = dq.eq('doc_number', num)
          else dq = dq.eq('amount', amt)
          const { data: dups } = await dq.limit(1)
          if (dups?.length) {
            const d = dups[0]
            const lbl = getDocType(form.type)?.label || 'Документ'
            const ok = confirm(
              `Схоже, такий документ уже завантажено:\n` +
              `${lbl} №${d.doc_number || '—'}` +
              `${d.amount != null ? ` на ${d.amount} грн` : ''}` +
              `${d.doc_date ? ` від ${d.doc_date}` : ''}.\n\n` +
              `Зберегти все одно (створити дубль)?`
            )
            if (!ok) { setBusy(false); return }
          }
        }
      }
      let storage_path = null, file_name = null, file_type = null
      if (files[0]) {
        const f = files[0]
        const path = `${Date.now()}_${f.name}`.replace(/[^\w.\-/]/g, '_')
        const { error: upErr } = await supabase.storage.from('documents').upload(path, f, { upsert: false })
        if (upErr && !upErr.message.includes('exists')) throw upErr
        storage_path = path; file_name = form.file_name?.trim() || f.name; file_type = f.type
      }
      const ins = {
        type: form.type,
        doc_number: form.doc_number?.trim() || null,
        doc_date: form.date || null,
        contractor_id: form.contractor_id || null,
        amount: Number(form.amount) || null,
        vat_amount: form.type === 'loanAgreement' ? 0 : (Number(form.vat_amount) || 0),   // позика ПДВ не обкладається
        direction: resolveDocDir(form.type, form.doc_role, cflags).direction,
        is_signed: form.is_signed,
        signed_scan_url: form.is_signed ? storage_path : null,
        storage_path, file_name, file_type, file_path: storage_path,
        doc_role: resolveDocDir(form.type, form.doc_role, cflags).role,
        ocr_data: form, uploaded_by: user?.id || null,
        order_id: orderId || null,
        posted: form.posted !== false,
      }
      let { data: doc, error } = await qc('documents').insert(withCompany(ins)).select('id').single()
      if (error && /posted/.test(error.message || '')) { const { posted, ...rest } = ins; ({ data: doc, error } = await qc('documents').insert(withCompany(rest)).select('id').single()) }
      if (error) throw error

      await syncDocStock(doc.id)
      onSaved()
    } catch (e) { setError(/DOC_NUMBER_TAKEN/.test(e.message || '') ? String(e.message).replace(/^.*DOC_NUMBER_TAKEN:\s*/, 'Н').replace(/^Нномер/, 'Номер') + ' — змініть номер документа.' : e.message) }
    setBusy(false)
  }

  const del = async () => {
    const { deleteDocument, describeDeletion } = await import('../lib/docgen')
    const extra = await describeDeletion(existingDoc.id)
    if (!confirm(`Видалити цей документ? Будуть видалені й пов'язані складські рухи (склад відкотиться). Дію не можна скасувати.${extra}`)) return
    setBusy(true); setError(null)
    try {
      // одна транзакція (086): рухи (крім збірок) + картка; якщо рухи не видалились (права) — не видаляється нічого
      await deleteDocument(existingDoc.id)
      onSaved()
    } catch (e) {
      const msg = /PERIOD_CLOSED/.test(e.message) ? e.message.replace(/^.*PERIOD_CLOSED:\s*/, '') : e.message.replace(/^NO_RIGHTS:\s*/, '')
      setError('Не вдалося видалити: ' + msg)
    }
    setBusy(false)
  }

  // ── Новий інтерфейс (ТЗ 4.6; макети DocumentEdit / DocumentEditMobile): повноекранний редактор.
  // Стан, розпізнавання, збереження й склад — ті самі, що в модалці нижче; тут лише розкладка.
  function renderNew() {
    const t = form ? getDocType(form.type) : null
    const title = existingDoc || form ? `№ ${form?.doc_number || existingDoc?.doc_number || '—'}${form?.date ? ` від ${form.date.split('-').reverse().join('.')}` : ''}` : (autoOcr ? 'Завантажити документ' : 'Прикріпити файл')
    const gross = Number(form?.amount) || 0, vat = Number(form?.vat_amount) || 0, net = gross - vat
    const incoming = form && ((form.doc_role || existingDoc?.doc_role) === 'incoming' || t?.direction === 'incoming')
    const items = form?.items || []
    const itemsSum = items.reduce((a, it) => { const q = Number(it.quantity ?? it.qty) || 0, pr = Number(it.unit_price ?? it.unitPrice ?? it.price) || 0; return a + (Number(it.amount) || q * pr) }, 0)
    const sumOk = items.length > 0 && gross > 0 && Math.abs(itemsSum - gross) < 1
    const need = (v) => !String(v ?? '').trim()   // жовтим — порожні обов'язкові поля
    const n2 = (v) => formatAmount(v, { decimals: 2 })
    const mismatch = docMovements?.some(m => m.source !== 'assembly' && form?.date && (m.date || '').slice(0, 10) !== movTarget(m))
    const verifyBtn = existingDoc && <Button variant="secondary" onClick={toggleVerified} disabled={busy} className={verified ? 'den-ok' : ''} icon={verified ? 'ti-circle-check' : undefined}>{verified ? 'Перевірено' : <><span className="den-lg-t">Позначити перевіреним</span><span className="den-sm-t">Перевірено?</span></>}</Button>
    const saveBtn = form && <Button variant="brand" onClick={save} loading={busy} disabled={busy}>Зберегти документ</Button>
    return (
      <div className="den" role="dialog" aria-modal="true" aria-label={`Документ ${title}`}>
        <header className="den-top">
          <button type="button" className="den-back" onClick={onClose} aria-label="Закрити документ"><i className="ti ti-arrow-left" aria-hidden="true" /></button>
          <div className="den-title"><small>Документи{t ? ` / ${t.label}` : ''}</small>
            <h1>{title}{form && <>{form.posted !== false ? <span className="den-chip is-ok">Проведено</span> : <span className="den-chip">Чернетка</span>}
              {existingDoc && (verified ? <span className="den-chip is-ok">Перевірено</span> : <span className="den-chip is-warn">Не перевірено</span>)}</>}</h1></div>
          <div className="den-acts">
            {existingDoc && <Button variant="secondary" icon="ti-scan" onClick={() => { setForm(null); recognizeExisting(true) }} disabled={busy} className="den-lg">{autoOcr ? 'Розпізнати знову' : 'Розпізнати'}</Button>}
            {!existingDoc && form && <Button variant="secondary" onClick={() => setForm(null)} className="den-lg">Інший файл</Button>}
            {existingDoc && <Menu trigger={<Button variant="secondary" iconOnly icon="ti-dots" aria-label="Інші дії" />} items={[
              { label: autoOcr ? 'Розпізнати знову' : 'Розпізнати', icon: 'ti-scan', onClick: () => { setForm(null); recognizeExisting(true) } },
              ...(previewUrl ? [{ label: 'Відкрити файл у новій вкладці', icon: 'ti-external-link', onClick: () => window.open(previewUrl, '_blank') }] : []),
              { divider: true },
              { label: 'Видалити документ', icon: 'ti-trash', danger: true, onClick: del },
            ]} />}
            <span className="den-lg">{verifyBtn}</span>
            <span className="den-lg">{saveBtn}</span>
          </div>
        </header>

        {!form ? (
          <div className="den-empty">
            {!existingDoc ? (
              <label className="den-drop">
                <i className={`ti ${autoOcr ? 'ti-scan' : 'ti-upload'}`} aria-hidden="true" />
                <b>{busy ? 'Розпізнавання…' : (autoOcr ? 'Оберіть скан або фото' : 'Оберіть файл')}</b>
                <small>{autoOcr ? 'PDF, JPG, PNG — розпізнаємо тип, номер, суму й позиції' : 'Договір, ТТН, акт тощо · PDF, фото, DOCX'}</small>
                <input type="file" multiple={autoOcr} accept={autoOcr ? 'image/*,.pdf,.heic' : '.pdf,image/*,.doc,.docx,.xls,.xlsx'} hidden onChange={e => (autoOcr ? runOcr : attachFile)(e.target.files)} disabled={busy} />
              </label>
            ) : !error && <div className="den-loading"><i className="ti ti-loader-2" aria-hidden="true" />{autoOcr ? 'Завантаження файлу і розпізнавання…' : 'Завантаження документа…'}</div>}
            {error && <p className="den-err" role="alert">{error}</p>}
          </div>
        ) : (
          <div className="den-body">
            {previewUrl && (
              <details className="den-prev" open>
                <summary><span>Оригінал документа</span><a href={previewUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>Нова вкладка <i className="ti ti-arrow-up-right" aria-hidden="true" /></a></summary>
                <div className="den-sheet">{previewType === 'pdf'
                  ? <iframe src={previewUrl} title="Оригінал документа" />
                  : <img src={previewUrl} alt="Оригінал документа" />}</div>
              </details>
            )}

            <div className="den-side">
              {autoOcr && !error && <div className="den-ocr"><i className="ti ti-scan" aria-hidden="true" /><span><b>Розпізнано автоматично.</b> Перевірте поля, позначені жовтим, і збережіть.</span></div>}
              {error && <p className="den-err" role="alert">{error}</p>}

              <section className="den-card">
                <h2>Реквізити</h2>
                <div className="den-grid">
                  <label className={need(form.doc_number) ? 'is-need' : ''}><span>Номер документа</span><input className="form-input" value={form.doc_number || ''} onChange={e => setForm(f => ({ ...f, doc_number: e.target.value }))} /></label>
                  <label className={need(form.date) ? 'is-need' : ''}><span>Дата</span><input className="form-input" type="date" value={form.date || ''} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                    {whDate && <small className="den-hint">Оприбуткування: <b>{whDate.split('-').reverse().join('.')}</b><InfoTip label="Дата оприбуткування">Змінюється лише в «Склад → Звірка видаткових»; не скидається при перезбереженні.</InfoTip></small>}</label>
                  <label><span>Тип документа</span>
                    <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                      {DOCUMENT_TYPES.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select></label>
                  <div className={`den-f${!form.contractor_id ? ' is-need' : ''}`}><span>Контрагент{form.edrpou ? ` · ЄДРПОУ ${form.edrpou}` : ''}</span>
                    <ContractorSelect value={form.contractorName} placeholder="Контрагент"
                      onChange={(v) => setForm(f => ({ ...f, contractorName: v, contractor_id: null }))}
                      onContractorSelect={(c) => setForm(f => ({ ...f, contractor_id: c.id, contractorName: c.name }))} />
                    {form.contractor_id && <small className="den-found"><i className="ti ti-check" aria-hidden="true" /> є в довіднику</small>}</div>
                  {['serviceAct', 'invoice', 'other'].includes(form.type) && (
                    <div className="den-f is-wide"><span>Напрям</span>
                      <Segmented ariaLabel="Напрям документа" value={form.doc_role === 'outgoing' ? 'outgoing' : 'incoming'} onChange={v => setForm(f => ({ ...f, doc_role: v }))}
                        options={[{ value: 'incoming', label: 'Вхідний — ми винні' }, { value: 'outgoing', label: 'Вихідний — нам винні' }]} /></div>
                  )}
                  <label className="is-wide"><span>Назва файлу</span>
                    <span className="den-row"><input className="form-input" value={form.file_name || ''} onChange={e => setForm(f => ({ ...f, file_name: e.target.value }))} />
                      <Button variant="secondary" onClick={() => setForm(f => ({ ...f, file_name: buildDocFileName({ type: f.type, docNumber: f.doc_number, contractorName: f.contractorName, date: f.date }, f.file_name) }))}>Оновити за реквізитами</Button></span></label>
                </div>
              </section>

              <section className="den-card">
                <div className="den-card-h"><h2>Суми<InfoTip label="Суми">На склад іде ціна без ПДВ, борг і гроші — з ПДВ. {incoming ? 'Вхідний ПДВ — податковий кредит, зменшує ПДВ до сплати.' : 'ПДВ — податкове зобов’язання.'}</InfoTip></h2>
                  {items.length > 0 && gross > 0 && (sumOk ? <span className="den-okline"><i className="ti ti-check" aria-hidden="true" /> сума позицій = сума документа</span>
                    : <span className="den-badline">сума позицій {n2(itemsSum)} ≠ {n2(gross)}</span>)}</div>
                <div className="den-sums">
                  <label><span>Без ПДВ · собівартість</span><b>{n2(net)}</b></label>
                  <label><span>у т. ч. ПДВ{form.type === 'loanAgreement' ? ' · позика не обкладається' : ''}</span>
                    <input className="form-input den-num" inputMode="decimal" value={form.vat_amount} onChange={e => setForm(f => ({ ...f, vat_amount: e.target.value }))} /></label>
                  <label className={`is-dark${need(form.amount) ? ' is-need' : ''}`}><span>З ПДВ · {incoming ? 'до сплати' : 'до отримання'}</span>
                    <input className="form-input den-num" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></label>
                </div>
              </section>

              {items.length > 0 && (
                <section className="den-card">
                  <h2>Позиції · {items.length}</h2>
                  <ul className="den-items">{items.map((it, i) => {
                    const q = Number(it.quantity ?? it.qty) || 0, pr = Number(it.unit_price ?? it.unitPrice ?? it.price) || 0, amt = Number(it.amount) || q * pr
                    return (
                      <li key={i}><b>{it.name || '—'}</b>{(it.sku || it.brand) && <small>{[it.sku, it.brand].filter(Boolean).join(' · ')}</small>}
                        <span className="den-it-n"><span><small>К-сть</small>{q} {it.unit || 'шт'}</span><span><small>Ціна</small>{n2(pr)}</span><span><small>Сума</small><b>{n2(amt)}</b></span></span></li>)
                  })}</ul>
                </section>
              )}

              <section className="den-card">
                <h2>Проведення</h2>
                <div className={`den-tog${form.posted !== false ? ' is-on' : ''}`}>
                  <Switch checked={form.posted !== false} onChange={v => setForm(f => ({ ...f, posted: v }))} label="Провести по системі" />
                  <InfoTip label="Провести по системі">Увімкнено — документ з’явиться в розділі «Документи» й потрапить у звіти.<br />Вимкнено — лишається чернеткою в замовленні.</InfoTip></div>
                <div className={`den-tog${form.is_signed ? ' is-on' : ''}`}>
                  <Switch checked={!!form.is_signed} onChange={toggleSigned} label="Підписаний" />
                  {existingDoc && signedSaved && <small className="den-found"><i className="ti ti-check" aria-hidden="true" /> збережено</small>}</div>
                {items.length > 0 && (
                  <div className={`den-tog is-col${stockOn ? ' is-on' : ''}`}>
                    <Switch checked={stockOn} onChange={setStockOn} label={`Рух на складі · ${items.length} ${items.length === 1 ? 'позиція' : 'позицій'}`} />
                    {stockOn && <div className="den-row">
                      <select className="form-input" value={stockDir} onChange={e => setStockDir(e.target.value)} aria-label="Тип руху"><option value="in">Прихід (оприбуткування)</option><option value="out">Видача (списання за FIFO)</option></select>
                      <span className="den-hint">при збереженні</span></div>}
                  </div>
                )}
                {existingDoc && (
                  <div className="den-movs">
                    <div className="den-card-h"><b>Складські рухи{docMovements ? ` · ${docMovements.length}` : ''}</b>
                      <span className="den-row">
                        {mismatch && <Button size="sm" variant="secondary" icon="ti-calendar" onClick={fixMovementDates} disabled={busy}>Дата рухів = {(whDate || form.date || '').split('-').reverse().join('.')}</Button>}
                        {docMovements?.some(m => m.type === 'out') && <Button size="sm" variant="secondary" icon="ti-arrows-exchange" onClick={() => { onClose?.(); navigate(`/inventory/recon?doc=${existingDoc.id}`) }}>Звірка</Button>}
                        {items.length > 0 && t?.stockEffect && <Button size="sm" variant="secondary" icon="ti-package-import" onClick={postStockNow} disabled={busy}>{stockDir === 'out' ? 'Списати зараз' : 'Оприбуткувати зараз'}</Button>}
                      </span></div>
                    {stockMsg && <p className={stockMsg.err ? 'den-err' : 'den-okline'}>{stockMsg.err || stockMsg.ok}</p>}
                    {docMovements === null ? <p className="den-hint">Завантаження…</p>
                      : docMovements.length === 0 ? <p className="den-warn">Рухів на складі з цього документа немає.</p>
                      : <ul className="den-mlist">{docMovements.map(m => {
                          const md = (m.date || '').slice(0, 10), dd = (movTarget(m) || '').slice(0, 10)
                          return <li key={m.id}><span className={`den-mi ${m.type === 'in' ? 'is-in' : 'is-out'}`} aria-hidden="true"><i className={`ti ${m.type === 'in' ? 'ti-arrow-up' : 'ti-arrow-down'}`} /></span>
                            <span><b>{m.productName || 'товар не прив’язаний'}{m.source === 'assembly' ? ' · збірка' : ''}</b>
                              <small className={md && dd && md !== dd ? 'is-bad' : ''}>{m.type === 'in' ? '+' : '−'}{Number(m.quantity) || 0} × {n2(Number(m.price) || 0)} · {md ? md.split('-').reverse().join('.') : '—'}</small></span></li>
                        })}</ul>}
                  </div>
                )}
              </section>

              {existingDoc && linked && (linked.order || linked.pays.length > 0) && (
                <section className="den-card">
                  <h2>Пов’язане</h2>
                  {linked.pays.map(p => (
                    <div key={p.id} className="den-link is-paid"><i className="ti ti-check" aria-hidden="true" />
                      <span><b>Оплачено {String(p.date || '').split('-').reverse().join('.')}</b><small>{p.counterparty || p.description || 'Банк'}</small></span>
                      <b className="den-link-sum">{formatAmount(p.amount, { decimals: 0, sign: 'always' })} ₴</b></div>))}
                  {linked.order && <button type="button" className="den-link" onClick={() => { onClose?.(); navigate(`/orders/${linked.order.id}`) }}><i className="ti ti-clipboard-list" aria-hidden="true" />
                    <span><b>Замовлення №{linked.order.order_number}</b><small>відкрити картку</small></span><i className="ti ti-chevron-right" aria-hidden="true" /></button>}
                </section>
              )}
              {existingDoc && <button type="button" className="den-del" onClick={del} disabled={busy}>Видалити документ</button>}
            </div>
          </div>
        )}
        {form && <div className="den-sticky">{verifyBtn}{saveBtn}</div>}
      </div>
    )
  }

  if (newUi) return renderNew()

  return (
    <>
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: form ? 1080 : 600, width: '95vw' }}>
        <div className="modal-header"><h2>{existingDoc ? (autoOcr ? 'Розпізнати документ' : 'Документ') : (autoOcr ? 'Завантажити документ (OCR)' : 'Завантажити документ')}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>

        {existingDoc && (
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }} title={existingDoc.file_name}>
            <i className="ti ti-file" /> {existingDoc.file_name}
          </div>
        )}

        {!form && !existingDoc && (
          <label style={{ display: 'block', border: '2px dashed var(--border)', borderRadius: 12, padding: 32, textAlign: 'center', cursor: 'pointer' }}>
            <i className={`ti ${autoOcr ? 'ti-scan' : 'ti-upload'}`} style={{ fontSize: 40, color: 'var(--blue)', display: 'block', marginBottom: 10 }} />
            <div style={{ fontWeight: 600 }}>{busy ? 'Розпізнавання…' : (autoOcr ? 'Оберіть скан або фото' : 'Оберіть файл')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>{autoOcr ? 'PDF, JPG, PNG · Claude OCR' : 'Договір, ТТН, акт тощо · PDF, фото, DOCX'}</div>
            <input type="file" multiple={autoOcr} accept={autoOcr ? 'image/*,.pdf,.heic' : '.pdf,image/*,.doc,.docx,.xls,.xlsx'} style={{ display: 'none' }} onChange={e => (autoOcr ? runOcr : attachFile)(e.target.files)} disabled={busy} />
          </label>
        )}
        {!form && existingDoc && !error && (
          <div style={{ textAlign: 'center', padding: 28, color: 'var(--text2)' }}>
            <i className="ti ti-loader-2" style={{ fontSize: 32, color: 'var(--blue)' }} />
            <div style={{ marginTop: 10 }}>{autoOcr ? 'Завантаження файлу і розпізнавання…' : 'Завантаження документа…'}</div>
          </div>
        )}

        {!form && error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}

        {form && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {previewUrl && (
              <div style={{ flex: '1 1 400px', minWidth: 280 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Оригінал документа</div>
                {previewType === 'pdf'
                  ? <iframe src={previewUrl} title="Документ" style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 8 }} />
                  : <img src={previewUrl} alt="Документ" style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, display: 'block' }} />}
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--blue)', display: 'inline-block', marginTop: 6 }}>Відкрити в новій вкладці ↗</a>
              </div>
            )}

            <div style={{ flex: '1 1 360px', minWidth: 280 }}>
              <div className="form-grid">
                <div className="form-group full">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Назва файлу</span>
                    <button type="button" onClick={() => setForm(f => ({ ...f, file_name: buildDocFileName({ type: f.type, docNumber: f.doc_number, contractorName: f.contractorName, date: f.date }, f.file_name) }))}
                      style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                      title="Побудувати назву з типу/номера/контрагента/дати">
                      <i className="ti ti-refresh" style={{ fontSize: 12 }} /> оновити назву
                    </button>
                  </label>
                  <input className="form-input" value={form.file_name || ''} onChange={e => setForm(f => ({ ...f, file_name: e.target.value }))} />
                </div>
                <div className="form-group"><label>Номер документа</label><input className="form-input" value={form.doc_number || ''} onChange={e => setForm(f => ({ ...f, doc_number: e.target.value }))} /></div>
                <div className="form-group"><label>Тип документа</label>
                  <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    {DOCUMENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                {['serviceAct', 'invoice', 'other'].includes(form.type) && (
                  <div className="form-group"><label>Напрям</label>
                    <select className="form-input" value={form.doc_role === 'outgoing' ? 'outgoing' : 'incoming'} onChange={e => setForm(f => ({ ...f, doc_role: e.target.value }))}>
                      <option value="incoming">Вхідний — постачальник нам (ми винні)</option>
                      <option value="outgoing">Вихідний — ми клієнту (нам винні)</option>
                    </select>
                  </div>
                )}
                <div className="form-group full"><label>Контрагент {form.edrpou && `(ЄДРПОУ ${form.edrpou})`}</label>
                  <ContractorSelect value={form.contractorName} placeholder="Контрагент"
                    onChange={(v) => setForm(f => ({ ...f, contractorName: v }))}
                    onContractorSelect={(c) => setForm(f => ({ ...f, contractor_id: c.id, contractorName: c.name }))} />
                </div>
                <div className="form-group"><label>Сума (з ПДВ)</label><input className="form-input" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div className="form-group"><label>у т.ч. ПДВ</label><input className="form-input" type="number" value={form.vat_amount} onChange={e => setForm(f => ({ ...f, vat_amount: e.target.value }))} /></div>
                <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                  {whDate && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }} title="Змінюється лише в «Склад → Звірка видаткових» (дія «Виправити дату оприбуткування»); не скидається при перезбереженні">
                    <i className="ti ti-package-import" /> Оприбуткування: <b>{whDate.split('-').reverse().join('.')}</b> <span style={{ color: 'var(--text3)' }}>(змінюється у «Звірці видаткових»)</span>
                  </div>}
                </div>
                <div className="form-group"><label>Підписаний</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44 }}>
                    <input type="checkbox" checked={!!form.is_signed} onChange={e => toggleSigned(e.target.checked)} style={{ width: 18, height: 18 }} />
                    <span style={{ fontSize: 14, color: 'var(--text2)' }}>{form.is_signed ? 'Так' : 'Ні'}</span>
                    {existingDoc && signedSaved && <span style={{ fontSize: 12, color: 'var(--green)' }}><i className="ti ti-check" /> збережено</span>}
                  </div>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', background: form.posted !== false ? 'var(--green-bg, #e7f7ec)' : 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', marginTop: 12 }}>
                <input type="checkbox" checked={form.posted !== false} onChange={e => setForm(f => ({ ...f, posted: e.target.checked }))} style={{ width: 18, height: 18, marginTop: 1 }} />
                <span>
                  <b style={{ fontSize: 13.5 }}>Провести по системі</b>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Додати в загальний розділ «Документи». Без відмітки документ лишається чернеткою лише в цьому замовленні.</span>
                </span>
              </label>

              {(form.items || []).length > 0 && (
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 13, color: 'var(--text2)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={stockOn} onChange={e => setStockOn(e.target.checked)} style={{ width: 17, height: 17 }} />
                    <i className="ti ti-package" /> Рух на складі для {form.items.length} позицій
                  </label>
                  {stockOn && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <select className="form-input" value={stockDir} onChange={e => setStockDir(e.target.value)} style={{ flex: '1 1 220px', maxWidth: 280 }}>
                        <option value="in">Прихід (оприбуткування)</option>
                        <option value="out">Видача (списання за FIFO)</option>
                      </select>
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>при збереженні</span>
                    </div>
                  )}
                </div>
              )}

              {/* Цифровий аналог документа: розпізнані позиції */}
              {(form.items || []).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Розпізнані позиції ({form.items.length})
                  </div>
                  <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead><tr style={{ background: 'var(--surface2)' }}>
                        <th style={{ textAlign: 'left', padding: '5px 8px' }}>Назва</th>
                        <th style={{ padding: '5px 6px' }}>К-сть</th>
                        <th style={{ padding: '5px 6px', textAlign: 'right' }}>Ціна</th>
                        <th style={{ padding: '5px 6px', textAlign: 'right' }}>Сума</th>
                      </tr></thead>
                      <tbody>
                        {form.items.map((it, i) => {
                          const qty = Number(it.quantity ?? it.qty) || 0
                          const price = Number(it.unit_price ?? it.unitPrice ?? it.price) || 0
                          const amt = Number(it.amount) || qty * price
                          return (
                            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '5px 8px' }}>{it.name || '—'}{it.sku ? <span style={{ color: 'var(--text3)' }}> · {it.sku}</span> : ''}{it.brand ? <span style={{ color: 'var(--text3)' }}> · {it.brand}</span> : ''}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'center' }}>{qty} {it.unit || 'шт'}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(price)}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 500 }}>{fmt(amt)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Розклад ПДВ: куди що падає (ціни позицій/складу — нетто; ПДВ — окремо в кредит) */}
                  {(() => {
                    const gross = Number(form.amount) || 0
                    const vat = Number(form.vat_amount) || 0
                    const net = gross - vat
                    if (!gross) return null
                    const incoming = (form.doc_role || existingDoc?.doc_role) === 'incoming' || getDocType(form.type)?.direction === 'incoming'
                    return (
                      <div style={{ marginTop: 8, background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text2)' }}>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <span>Без ПДВ (склад/собівартість): <b>{fmt(net)}</b></span>
                          <span>ПДВ: <b style={{ color: incoming ? 'var(--green)' : 'var(--amber, #b45309)' }}>{fmt(vat)}</b></span>
                          <span>З ПДВ (гроші/борг): <b>{fmt(gross)}</b></span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                          Ціни позицій і складу — <b>без ПДВ</b> (нетто). ПДВ {fmt(vat)} → {incoming ? 'податковий кредит (зменшує ПДВ до сплати)' : 'податкове зобовʼязання'}. Борг/гроші — з ПДВ ({fmt(gross)}).
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Цифровий аналог: фактично створені складські рухи */}
              {existingDoc && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' }}>
                      Складські рухи {docMovements ? `(${docMovements.length})` : ''}
                    </div>
                    {docMovements?.some(m => m.source !== 'assembly' && form.date && (m.date || '').slice(0, 10) !== movTarget(m)) && (
                      <button type="button" className="btn" onClick={fixMovementDates} disabled={busy} style={{ fontSize: 12, padding: '4px 10px', color: 'var(--red)' }}
                        title={whDate ? 'Дата приходів не збігається з датою оприбуткування' : 'Дата рухів не збігається з датою документа'}>
                        <i className="ti ti-calendar" /> Дата рухів = {(whDate || form.date || '').split('-').reverse().join('.')}
                      </button>
                    )}
                    {existingDoc && docMovements?.some(m => m.type === 'out') && (
                      <button type="button" className="btn" onClick={() => { onClose?.(); navigate(`/inventory/recon?doc=${existingDoc.id}`) }} style={{ fontSize: 12, padding: '4px 10px' }}
                        title="Звідки собівартість кожної позиції: прихідна, з якої списано; прив'язка, дата оприбуткування">
                        <i className="ti ti-arrows-exchange" /> Звірка
                      </button>
                    )}
                    {(form.items || []).length > 0 && getDocType(form.type)?.stockEffect && (
                      <button type="button" className="btn" onClick={postStockNow} disabled={busy} style={{ fontSize: 12, padding: '4px 10px' }}>
                        <i className="ti ti-package-import" /> {stockDir === 'out' ? 'Списати зі складу зараз' : 'Оприбуткувати на склад зараз'}
                      </button>
                    )}
                  </div>
                  {stockMsg && (
                    <div style={{ fontSize: 12.5, borderRadius: 8, padding: '8px 12px', marginBottom: 8, whiteSpace: 'pre-wrap', background: 'var(--surface2)', color: stockMsg.err ? 'var(--red)' : 'var(--green)' }}>
                      <i className={`ti ${stockMsg.err ? 'ti-alert-circle' : 'ti-check'}`} style={{ marginRight: 4 }} />{stockMsg.err || stockMsg.ok}
                    </div>
                  )}
                  {docMovements === null ? (
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>Завантаження…</div>
                  ) : docMovements.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--amber, #b45309)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                      <i className="ti ti-alert-circle" /> Рухів на складі з цього документа немає{(form.items || []).length > 0 ? ' — натисни «Оприбуткувати на склад зараз» (кнопка вище).' : '.'}
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead><tr style={{ background: 'var(--surface2)' }}>
                          <th style={{ textAlign: 'left', padding: '5px 8px' }}>Товар</th>
                          <th style={{ padding: '5px 6px' }}>Дата руху</th>
                          <th style={{ padding: '5px 6px' }}>Напрям</th>
                          <th style={{ padding: '5px 6px' }}>К-сть</th>
                          <th style={{ padding: '5px 6px', textAlign: 'right' }}>Ціна</th>
                        </tr></thead>
                        <tbody>
                          {docMovements.map(m => {
                            const movDate = (m.date || '').slice(0, 10)
                            const docDate = (movTarget(m) || '').slice(0, 10)
                            const dateMismatch = movDate && docDate && movDate !== docDate
                            return (
                            <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '5px 8px' }}>
                                {m.productName || <span style={{ color: 'var(--red)' }}>⚠ товар не прив'язаний</span>}
                                {m.source === 'assembly' && <span style={{ color: 'var(--text3)' }}> · збірка</span>}
                              </td>
                              <td style={{ padding: '5px 6px', textAlign: 'center', color: dateMismatch ? 'var(--red)' : 'var(--text2)', whiteSpace: 'nowrap' }} title={dateMismatch ? `Не збігається з датою документа (${docDate})` : ''}>
                                {movDate || '—'}{dateMismatch && ' ⚠'}
                              </td>
                              <td style={{ padding: '5px 6px', textAlign: 'center', color: m.type === 'in' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{m.type === 'in' ? 'Прихід' : 'Видача'}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'center' }}>{Number(m.quantity) || 0}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(Number(m.price) || 0)}</td>
                            </tr>
                          )})}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {existingDoc && (
                    <button className="btn" onClick={toggleVerified} disabled={busy}
                      style={verified ? { background: 'var(--green)', color: '#fff', borderColor: 'var(--green)' } : { color: 'var(--green)' }}
                      title="Звірено скан ↔ розпізнані поля (ціни, ПДВ, рухи)">
                      <i className={`ti ${verified ? 'ti-checkbox' : 'ti-square'}`} /> {verified ? 'Перевірено' : 'Позначити перевіреним'}
                    </button>
                  )}
                  {existingDoc && <button className="btn" onClick={del} disabled={busy} style={{ color: 'var(--red)' }}><i className="ti ti-trash" /> Видалити</button>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {existingDoc
                    ? <button className="btn" onClick={() => { setForm(null); recognizeExisting(true) }} disabled={busy}><i className="ti ti-scan" /> {autoOcr ? 'Розпізнати знову' : 'Розпізнати'}</button>
                    : <button className="btn" onClick={() => setForm(null)}>Інший файл</button>}
                  <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Зберегти документ'}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  )
}

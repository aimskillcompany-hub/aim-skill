import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { extractDocumentMulti } from '../lib/ai'
import { fetchArticles } from '../lib/articles'
import { getContractorMatcher } from '../lib/contractorMatch'
import { resolveProduct, createStockMovement } from '../lib/stockService'
import { DOCUMENT_TYPES, getDocType } from '../lib/docgen'
import { fmt } from '../lib/fmt'
import ContractorSelect from './ui/ContractorSelect'
import MailSendModal from './MailSendModal'

export const dirFromType = (key) => {
  const t = getDocType(key)
  return t?.direction === 'incoming' ? 'payable' : 'receivable'
}

// Тип документа з розпізнаного OCR (docType + напрям), а не лише з напряму
export const typeFromOcr = (docType, docRole) => {
  const t = (docType || '').trim().toLowerCase()
  if (t.startsWith('акт')) return 'serviceAct'            // «Акт …» (не плутати з «фАКТура»)
  if (t.includes('рахунок')) return 'invoice'             // рахунок / рахунок-фактура
  if (t.includes('накладна')) return docRole === 'outgoing' ? 'waybill' : 'incomingWaybill'
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

// Універсальна модалка документа: завантаження+OCR (новий), розпізнавання (existingDoc+autoOcr),
// перегляд/редагування/видалення (existingDoc, autoOcr=false). Прев'ю файлу зліва, поля справа.
export default function DocModal({ user, existingDoc, autoOcr = true, onClose, onSaved }) {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewType, setPreviewType] = useState('image')
  const [showMail, setShowMail] = useState(false)
  const [stockOn, setStockOn] = useState(false)   // оприбуткувати/списати позиції на склад
  const [stockDir, setStockDir] = useState('in')  // 'in' = прихід, 'out' = видача (FIFO)
  const [verified, setVerified] = useState(!!existingDoc?.is_verified) // документ перевірено (звірка скан↔поля)
  const [signedSaved, setSignedSaved] = useState(false) // індикатор авто-збереження «Підписаний»
  const [docMovements, setDocMovements] = useState(null) // фактично створені складські рухи цього документа

  useEffect(() => { if (existingDoc) recognizeExisting(autoOcr) }, [])

  // Завантажити фактичні складські рухи документа (цифровий аналог: що потрапило на склад)
  useEffect(() => {
    if (!existingDoc?.id) return
    let cancelled = false
    ;(async () => {
      const { data: mv } = await supabase.from('stock_movements')
        .select('id, type, quantity, price, cost_price, product_id, source, description')
        .eq('document_id', existingDoc.id).order('date')
      const pids = [...new Set((mv || []).map(m => m.product_id).filter(Boolean))]
      let pn = {}
      if (pids.length) {
        const { data: prods } = await supabase.from('products').select('id, name').in('id', pids)
        ;(prods || []).forEach(p => pn[p.id] = p.name)
      }
      if (!cancelled) setDocMovements((mv || []).map(m => ({ ...m, productName: pn[m.product_id] || null })))
    })()
    return () => { cancelled = true }
  }, [existingDoc?.id])

  // Позначити «Перевірено» / зняти позначку (звірено скан↔розпізнані поля/ПДВ/рухи)
  const toggleVerified = async () => {
    if (!existingDoc?.id) return
    setBusy(true); setError(null)
    const next = !verified
    const { error } = await supabase.from('documents')
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
    const { error } = await supabase.from('documents')
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
          date: d.doc_date || (d.created_at || '').slice(0, 10),
          is_signed: d.is_signed || false,
          doc_role: d.doc_role || null,
          items: d.ocr_data?.items || [],
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
        date: data.date || existingDoc?.doc_date || new Date().toISOString().split('T')[0],
        is_signed: existingDoc?.is_signed || false,
        doc_role: docRole,
        items: data.items || [],
      })
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  // Ідемпотентно синхронізувати складські рухи документа (замінити ВСІ рухи цього документа,
  // крім збірок, і створити заново) — щоб перерозпізнавання не задвоювало склад.
  // ВАЖЛИВО: якщо «Рух на складі» вимкнено — НЕ чіпаємо наявні рухи. Раніше видаляли завжди,
  // тож просте збереження документа з порожніми позиціями стирало вже створений прихід/видаток.
  const syncDocStock = async (documentId) => {
    if (!stockOn) return
    await supabase.from('stock_movements').delete().eq('document_id', documentId).neq('source', 'assembly')
    for (const it of (form.items || [])) {
      const qty = Number(it.quantity ?? it.qty) || 0
      if (!qty || !it.name) continue
      const price = Number(it.unit_price ?? it.unitPrice ?? it.price) || null
      const resolved = await resolveProduct(it.name, it.unit, price, user?.id, it.sku ?? it.code ?? null)
      const productId = resolved?.productId
      if (!productId) continue
      await createStockMovement({
        productId, type: stockDir, quantity: qty, price,
        total: Number(it.amount) || (price ? qty * price : null),
        documentId, date: form.date, description: `${getDocType(form.type)?.label}: ${it.name}`.slice(0, 200), userId: user?.id,
      })
    }
  }

  const save = async () => {
    setBusy(true); setError(null)
    try {
      if (existingDoc) {
        const { data, error } = await supabase.from('documents').update({
          type: form.type,
          contractor_id: form.contractor_id || null,
          amount: Number(form.amount) || null,
          vat_amount: Number(form.vat_amount) || 0,
          direction: dirFromType(form.type),
          is_signed: form.is_signed,
          file_name: form.file_name?.trim() || existingDoc.file_name,
          doc_number: form.doc_number?.trim() || null,
          doc_date: form.date || null,
          ocr_data: form,
        }).eq('id', existingDoc.id).select('id')
        if (error) throw error
        if (!data?.length) throw new Error('Документ не оновлено (немає прав UPDATE). Запусти migrations/004 у Supabase.')
        await syncDocStock(existingDoc.id)
        onSaved(); return
      }
      let storage_path = null, file_name = null, file_type = null
      if (files[0]) {
        const f = files[0]
        const path = `${Date.now()}_${f.name}`.replace(/[^\w.\-/]/g, '_')
        const { error: upErr } = await supabase.storage.from('documents').upload(path, f, { upsert: false })
        if (upErr && !upErr.message.includes('exists')) throw upErr
        storage_path = path; file_name = form.file_name?.trim() || f.name; file_type = f.type
      }
      const { data: doc, error } = await supabase.from('documents').insert({
        type: form.type,
        doc_number: form.doc_number?.trim() || null,
        doc_date: form.date || null,
        contractor_id: form.contractor_id || null,
        amount: Number(form.amount) || null,
        vat_amount: Number(form.vat_amount) || 0,
        direction: dirFromType(form.type),
        is_signed: form.is_signed,
        signed_scan_url: form.is_signed ? storage_path : null,
        storage_path, file_name, file_type, file_path: storage_path,
        doc_role: getDocType(form.type)?.direction || 'incoming',
        ocr_data: form, uploaded_by: user?.id || null,
      }).select('id').single()
      if (error) throw error

      await syncDocStock(doc.id)
      onSaved()
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  const del = async () => {
    if (!confirm('Видалити цей документ? Будуть видалені й пов\'язані складські рухи (склад відкотиться). Дію не можна скасувати.')) return
    setBusy(true); setError(null)
    try {
      // Рухи цього документа треба зібрати ДО видалення: FK stock_movements.document_id = ON DELETE SET NULL,
      // тож після видалення документа рухи лишаються (осиротілі), а склад не відкочується. Прибираємо їх явно
      // (крім збірок — їх source='assembly'). Спершу видаляємо документ (перевірка прав/періоду), потім рухи.
      const { data: mvs } = await supabase.from('stock_movements').select('id').eq('document_id', existingDoc.id).neq('source', 'assembly')
      const { data, error } = await supabase.from('documents').delete().eq('id', existingDoc.id).select('id')
      if (error) throw error
      if (!data?.length) { setError('Документ не видалено (недостатньо прав). Видалення доступне ролям admin/accountant.'); setBusy(false); return }
      if (mvs?.length) await supabase.from('stock_movements').delete().in('id', mvs.map(m => m.id))
      onSaved()
    } catch (e) {
      const msg = /PERIOD_CLOSED/.test(e.message) ? e.message.replace(/^.*PERIOD_CLOSED:\s*/, '') : e.message
      setError('Не вдалося видалити: ' + msg)
    }
    setBusy(false)
  }

  return (
    <>
    {showMail && <MailSendModal document={{ ...existingDoc, type: form?.type || existingDoc?.type, doc_number: form?.doc_number ?? existingDoc?.doc_number }} onClose={() => setShowMail(false)} />}
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: form ? 1080 : 600, width: '95vw' }}>
        <div className="modal-header"><h2>{existingDoc ? (autoOcr ? 'Розпізнати документ' : 'Документ') : 'Завантажити документ (OCR)'}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>

        {existingDoc && (
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }} title={existingDoc.file_name}>
            <i className="ti ti-file" /> {existingDoc.file_name}
          </div>
        )}

        {!form && !existingDoc && (
          <label style={{ display: 'block', border: '2px dashed var(--border)', borderRadius: 12, padding: 32, textAlign: 'center', cursor: 'pointer' }}>
            <i className="ti ti-scan" style={{ fontSize: 40, color: 'var(--blue)', display: 'block', marginBottom: 10 }} />
            <div style={{ fontWeight: 600 }}>{busy ? 'Розпізнавання…' : 'Оберіть скан або фото'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>PDF, JPG, PNG · Claude OCR</div>
            <input type="file" multiple accept="image/*,.pdf,.heic" style={{ display: 'none' }} onChange={e => runOcr(e.target.files)} disabled={busy} />
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
                <div className="form-group full"><label>Контрагент {form.edrpou && `(ЄДРПОУ ${form.edrpou})`}</label>
                  <ContractorSelect value={form.contractorName} placeholder="Контрагент"
                    onChange={(v) => setForm(f => ({ ...f, contractorName: v }))}
                    onContractorSelect={(c) => setForm(f => ({ ...f, contractor_id: c.id, contractorName: c.name }))} />
                </div>
                <div className="form-group"><label>Сума (з ПДВ)</label><input className="form-input" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div className="form-group"><label>у т.ч. ПДВ</label><input className="form-input" type="number" value={form.vat_amount} onChange={e => setForm(f => ({ ...f, vat_amount: e.target.value }))} /></div>
                <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
                <div className="form-group"><label>Підписаний</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44 }}>
                    <input type="checkbox" checked={!!form.is_signed} onChange={e => toggleSigned(e.target.checked)} style={{ width: 18, height: 18 }} />
                    <span style={{ fontSize: 14, color: 'var(--text2)' }}>{form.is_signed ? 'Так' : 'Ні'}</span>
                    {existingDoc && signedSaved && <span style={{ fontSize: 12, color: 'var(--green)' }}><i className="ti ti-check" /> збережено</span>}
                  </div>
                </div>
              </div>

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
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Складські рухи {docMovements ? `(${docMovements.length})` : ''}
                  </div>
                  {docMovements === null ? (
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>Завантаження…</div>
                  ) : docMovements.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--amber, #b45309)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                      <i className="ti ti-alert-circle" /> Рухів на складі з цього документа немає{(form.items || []).length > 0 ? ' — хоча позиції розпізнані. Увімкни «Рух на складі» і збережи.' : '.'}
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead><tr style={{ background: 'var(--surface2)' }}>
                          <th style={{ textAlign: 'left', padding: '5px 8px' }}>Товар</th>
                          <th style={{ padding: '5px 6px' }}>Напрям</th>
                          <th style={{ padding: '5px 6px' }}>К-сть</th>
                          <th style={{ padding: '5px 6px', textAlign: 'right' }}>Ціна</th>
                        </tr></thead>
                        <tbody>
                          {docMovements.map(m => (
                            <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '5px 8px' }}>
                                {m.productName || <span style={{ color: 'var(--red)' }}>⚠ товар не прив'язаний</span>}
                                {m.source === 'assembly' && <span style={{ color: 'var(--text3)' }}> · збірка</span>}
                              </td>
                              <td style={{ padding: '5px 6px', textAlign: 'center', color: m.type === 'in' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{m.type === 'in' ? 'Прихід' : 'Видача'}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'center' }}>{Number(m.quantity) || 0}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(Number(m.price) || 0)}</td>
                            </tr>
                          ))}
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
                  {existingDoc && <button className="btn" onClick={() => setShowMail(true)} disabled={busy}><i className="ti ti-send" /> Надіслати email</button>}
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

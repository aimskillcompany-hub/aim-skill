import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { extractDocumentMulti } from '../lib/ai'
import { fetchArticles } from '../lib/articles'
import { getContractorMatcher } from '../lib/contractorMatch'
import { resolveProduct, createStockMovement } from '../lib/stockService'
import { DOCUMENT_TYPES, getDocType } from '../lib/docgen'
import ContractorSelect from './ui/ContractorSelect'

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

// Універсальна модалка документа: завантаження+OCR (новий), розпізнавання (existingDoc+autoOcr),
// перегляд/редагування/видалення (existingDoc, autoOcr=false). Прев'ю файлу зліва, поля справа.
export default function DocModal({ user, existingDoc, autoOcr = true, onClose, onSaved }) {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewType, setPreviewType] = useState('image')

  useEffect(() => { if (existingDoc) recognizeExisting(autoOcr) }, [])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

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
          date: (d.created_at || '').slice(0, 10),
          is_signed: d.is_signed || false,
          items: [],
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
      setForm({
        type: defType,
        file_name: existingDoc?.file_name || arr[0]?.name || '',
        doc_number: existingDoc?.doc_number || data.docNumber || '',
        contractor_id: m?.contractor.id || null,
        contractorName: m?.contractor.name || data.contractor || '',
        edrpou: data.edrpou || '',
        amount: data.amount ?? data.amountNoVat ?? '',
        vat_amount: data.vatAmount ?? 0,
        date: data.date || new Date().toISOString().split('T')[0],
        is_signed: existingDoc?.is_signed || false,
        items: data.items || [],
      })
    } catch (e) { setError(e.message) }
    setBusy(false)
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
          ocr_data: form,
        }).eq('id', existingDoc.id).select('id')
        if (error) throw error
        if (!data?.length) throw new Error('Документ не оновлено (немає прав UPDATE). Запусти migrations/004 у Supabase.')
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

      const stockEffect = getDocType(form.type)?.stockEffect
      if (stockEffect && (form.items || []).length) {
        for (const it of form.items) {
          const qty = Number(it.quantity ?? it.qty) || 0
          if (!qty || !it.name) continue
          const price = Number(it.unit_price ?? it.unitPrice ?? it.price) || null
          const productId = await resolveProduct(it.name, it.unit, price, user?.id)
          if (!productId) continue
          await createStockMovement({
            productId, type: stockEffect, quantity: qty, price,
            total: Number(it.amount) || (price ? qty * price : null),
            documentId: doc.id, date: form.date, description: `${getDocType(form.type)?.label}: ${it.name}`.slice(0, 200), userId: user?.id,
          })
        }
      }
      onSaved()
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  const del = async () => {
    if (!confirm('Видалити цей документ? Дію не можна скасувати.')) return
    setBusy(true); setError(null)
    const { data, error } = await supabase.from('documents').delete().eq('id', existingDoc.id).select('id')
    setBusy(false)
    if (error) { setError(error.message); return }
    if (!data?.length) { setError('Документ не видалено (недостатньо прав). Видалення доступне ролям admin/accountant.'); return }
    onSaved()
  }

  return (
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
                <div className="form-group full"><label>Назва файлу</label><input className="form-input" value={form.file_name || ''} onChange={e => setForm(f => ({ ...f, file_name: e.target.value }))} /></div>
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
                <div className="form-group"><label>Сума</label><input className="form-input" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div className="form-group"><label>ПДВ</label><input className="form-input" type="number" value={form.vat_amount} onChange={e => setForm(f => ({ ...f, vat_amount: e.target.value }))} /></div>
                <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
                <div className="form-group"><label>Підписаний</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44 }}>
                    <input type="checkbox" checked={form.is_signed} onChange={e => setForm(f => ({ ...f, is_signed: e.target.checked }))} style={{ width: 18, height: 18 }} />
                    <span style={{ fontSize: 14, color: 'var(--text2)' }}>{form.is_signed ? 'Так' : 'Ні'}</span>
                  </div>
                </div>
              </div>

              {getDocType(form.type)?.stockEffect && (form.items || []).length > 0 && (
                <div style={{ background: 'var(--blue-bg, #EFF4FF)', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 13, color: 'var(--text2)' }}>
                  <i className="ti ti-package" /> {form.items.length} позицій → {getDocType(form.type).stockEffect === 'in' ? 'оприбуткування на склад' : 'списання зі складу за FIFO'} при збереженні.
                </div>
              )}

              {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <div>
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
  )
}

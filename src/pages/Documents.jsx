import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import { extractDocumentMulti } from '../lib/ai'
import { fetchArticles } from '../lib/articles'
import { getContractorMatcher } from '../lib/contractorMatch'
import { resolveProduct, createStockMovement } from '../lib/stockService'
import { DOCUMENT_TYPES, getDocType } from '../lib/docgen'
import ContractorSelect from '../components/ui/ContractorSelect'
import DocGenModal from '../components/DocGenModal'

const dirFromType = (key) => {
  const t = getDocType(key)
  return t?.direction === 'incoming' ? 'payable' : 'receivable'
}

// Документ без метаданих — потребує розпізнавання
const isIncomplete = (d) => !d.type || d.amount == null || !d.contractor_id

export default function Documents() {
  const { user } = useUser()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [signedFilter, setSignedFilter] = useState('all')
  const [showOcr, setShowOcr] = useState(false)
  const [genContractor, setGenContractor] = useState(null)
  const [pickGen, setPickGen] = useState(false)
  const [recognizeDoc, setRecognizeDoc] = useState(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('documents')
      .select('id, type, doc_number, file_name, amount, vat_amount, is_signed, direction, created_at, contractor_id, storage_path, file_path, file_type, doc_role, contractors(name)')
      .order('created_at', { ascending: false }).limit(500)
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows.filter(d => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false
      if (signedFilter === 'signed' && !d.is_signed) return false
      if (signedFilter === 'unsigned' && d.is_signed) return false
      if (!term) return true
      return (d.file_name || '').toLowerCase().includes(term) || (d.contractors?.name || '').toLowerCase().includes(term)
    })
  }, [rows, q, typeFilter, signedFilter])

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1>Документи</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowOcr(true)}><i className="ti ti-scan" /> Завантажити скан (OCR)</button>
          <button className="btn btn-primary" onClick={() => setPickGen(true)}><i className="ti ti-file-plus" /> Згенерувати</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Пошук…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 220px', maxWidth: 320 }} />
        <select className="form-input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: 200 }}>
          <option value="all">Усі типи</option>
          {DOCUMENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="form-input" value={signedFilter} onChange={e => setSignedFilter(e.target.value)} style={{ width: 170 }}>
          <option value="all">Усі статуси</option>
          <option value="signed">Підписані</option>
          <option value="unsigned">Без підпису</option>
        </select>
      </div>

      <div className="card">
        {loading ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>Тип</th><th>№</th><th>Контрагент</th><th>Файл</th><th style={{ textAlign: 'right' }}>Сума</th><th>ПДВ</th><th>Підпис</th><th>Дата</th><th></th></tr></thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontSize: 13 }}>{getDocType(d.type)?.label || d.type || '—'}</td>
                    <td style={{ fontSize: 13, color: 'var(--text2)' }}>{d.doc_number || '—'}</td>
                    <td><div className="trunc">{d.contractors?.name || '—'}</div></td>
                    <td><div className="trunc" style={{ color: 'var(--text2)', fontSize: 12 }} title={d.file_name}>{d.file_name || '—'}</div></td>
                    <td style={{ textAlign: 'right' }}>{d.amount ? fmt(d.amount) : '—'}</td>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>{d.vat_amount ? fmt(d.vat_amount) : '—'}</td>
                    <td>{d.is_signed ? <span style={{ color: 'var(--green)' }}><i className="ti ti-check" /></span> : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{(d.created_at || '').slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isIncomplete(d) && (d.storage_path || d.file_path) && (
                        <button className="btn" onClick={() => setRecognizeDoc(d)} title="Розпізнати метадані з файлу через OCR" style={{ whiteSpace: 'nowrap' }}><i className="ti ti-scan" /> Розпізнати</button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Документів немає</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showOcr && <OcrModal user={user} onClose={() => setShowOcr(false)} onSaved={() => { setShowOcr(false); load() }} />}
      {recognizeDoc && <OcrModal user={user} existingDoc={recognizeDoc} onClose={() => setRecognizeDoc(null)} onSaved={() => { setRecognizeDoc(null); load() }} />}
      {pickGen && <PickContractorModal onClose={() => setPickGen(false)} onPick={(c) => { setPickGen(false); setGenContractor(c) }} />}
      {genContractor && <DocGenModal contractor={genContractor} userId={user?.id} onClose={() => setGenContractor(null)} onSaved={() => { setGenContractor(null); load() }} />}
    </div>
  )
}

// ───────── OCR завантаження / розпізнавання існуючого ─────────
function OcrModal({ user, existingDoc, onClose, onSaved }) {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null) // extracted
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewType, setPreviewType] = useState('image') // image | pdf

  // Існуючий документ — одразу качаємо файл зі Storage і розпізнаємо
  useEffect(() => { if (existingDoc) recognizeExisting() }, [])
  // Звільняємо blob-URL прев'ю
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const makePreview = (blob, name = '', type = '') => {
    const ext = (name.split('.').pop() || '').toLowerCase()
    setPreviewType(type.includes('pdf') || ext === 'pdf' ? 'pdf' : 'image')
    setPreviewUrl(URL.createObjectURL(blob))
  }

  const recognizeExisting = async () => {
    setBusy(true); setError(null)
    try {
      const path = existingDoc.storage_path || existingDoc.file_path
      if (!path) throw new Error('У документа немає файлу у сховищі')
      const { data: blob, error: dlErr } = await supabase.storage.from('documents').download(path)
      if (dlErr) throw dlErr
      const file = new File([blob], existingDoc.file_name || 'document', { type: existingDoc.file_type || blob.type })
      await runOcr([file])
    } catch (e) { setError('Не вдалося отримати файл зі сховища: ' + e.message); setBusy(false) }
  }

  const runOcr = async (fileList) => {
    const arr = Array.from(fileList)
    setFiles(arr); setBusy(true); setError(null)
    if (arr[0]) makePreview(arr[0], arr[0].name, arr[0].type)
    try {
      const articles = await fetchArticles()
      const data = await extractDocumentMulti(arr, articles)
      // авто-матч контрагента по ЄДРПОУ/назві з OCR + назви файлу
      const matcher = await getContractorMatcher()
      const m = matcher({ counterparty: data.contractor, edrpou: data.edrpou, description: existingDoc?.file_name })
      const defType = existingDoc?.type || (existingDoc?.doc_role === 'outgoing' ? 'waybill' : existingDoc ? 'incomingWaybill' : 'invoice')
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
      // Існуючий документ — лише оновлюємо метадані (без повторного завантаження
      // файлу і без створення складських рухів, щоб не дублювати).
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
      // Новий документ — завантажити оригінал у Storage
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

      // Документи → Склад: прихідна оприбутковує, видаткова списує за FIFO
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

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: form ? 1080 : 600, width: '95vw' }}>
        <div className="modal-header"><h2>{existingDoc ? 'Розпізнати документ' : 'Завантажити документ (OCR)'}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>

        {existingDoc && (
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }} title={existingDoc.file_name}>
            <i className="ti ti-file" /> {existingDoc.file_name}
          </div>
        )}

        {/* Новий документ: вибір файлу. Існуючий: показуємо стан розпізнавання. */}
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
            <div style={{ marginTop: 10 }}>Завантаження файлу і розпізнавання…</div>
          </div>
        )}

        {!form && error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}

        {form && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Прев'ю оригіналу — щоб звірити розпізнане */}
            {previewUrl && (
              <div style={{ flex: '1 1 400px', minWidth: 280 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Оригінал документа</div>
                {previewType === 'pdf'
                  ? <iframe src={previewUrl} title="Документ" style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 8 }} />
                  : <img src={previewUrl} alt="Документ" style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, display: 'block' }} />}
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--blue)', display: 'inline-block', marginTop: 6 }}>Відкрити в новій вкладці ↗</a>
              </div>
            )}

            {/* Розпізнані поля */}
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                {existingDoc
                  ? <button className="btn" onClick={() => { setForm(null); recognizeExisting() }} disabled={busy}>Розпізнати знову</button>
                  : <button className="btn" onClick={() => setForm(null)}>Інший файл</button>}
                <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Зберегти документ'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ───────── вибір контрагента для генерації ─────────
function PickContractorModal({ onClose, onPick }) {
  const [c, setC] = useState(null)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header"><h2>Оберіть контрагента</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div className="form-group"><label>Контрагент</label>
          <ContractorSelect placeholder="Почніть вводити назву…"
            onChange={() => {}} onContractorSelect={(x) => setC(x)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn btn-primary" onClick={() => c && onPick(c)} disabled={!c}>Далі</button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { extractTenderDoc } from '../lib/ai'

// Вкладка «Тендерна документація» — файли зберігаються ЛИШЕ в замовленні (не в загальних Документах),
// з прив'язкою до ідентифікатора закупівлі. Авто-нумерація: останні 6 цифр закупівлі/N.
// Доступна лише для тендерних замовлень.

const fmtDate = (s) => s ? s.slice(0, 10).split('-').reverse().join('.') : ''
// Останні 6 цифр ідентифікатора закупівлі (лише цифри)
const procBase = (pid) => {
  const digits = String(pid || '').replace(/\D/g, '')
  return digits ? digits.slice(-6) : ''
}

export default function TenderDocsTab({ o }) {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState({ name: '', out_number: '', doc_date: new Date().toISOString().slice(0, 10) })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [zipping, setZipping] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const fileRef = useRef(null)

  // Обрати файл → авто-розпізнати найменування/вих.номер/дату (не затираємо вручну введене)
  const onFile = async (f) => {
    setFile(f); setMsg(null)
    if (!f) return
    setRecognizing(true)
    try {
      const r = await extractTenderDoc(f)
      setForm(prev => ({
        ...prev,
        name: prev.name.trim() ? prev.name : (r.name || ''),
        out_number: prev.out_number.trim() ? prev.out_number : (r.outNumber || ''),
        doc_date: (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : prev.doc_date,
      }))
    } catch (e) {
      setMsg('Не вдалося розпізнати автоматично — заповніть вручну.')
    } finally { setRecognizing(false) }
  }

  const base = procBase(o.procurement_id)

  const load = () => supabase.from('tender_documents').select('*').eq('order_id', o.id).order('seq')
    .then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [o.id])

  const nextSeq = () => (rows || []).reduce((m, r) => Math.max(m, r.seq || 0), 0) + 1

  const upload = async () => {
    if (!file) { setMsg('Оберіть файл'); return }
    if (!form.name.trim()) { setMsg('Вкажіть найменування документа'); return }
    setBusy(true); setMsg(null)
    try {
      const seq = nextSeq()
      const docNumber = base ? `${base}/${seq}` : String(seq)
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
      const path = `tender/${o.id}/${Date.now()}_${seq}.${ext}`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw upErr
      const { error } = await supabase.from('tender_documents').insert({
        order_id: o.id, procurement_id: o.procurement_id || null, seq, doc_number: docNumber,
        name: form.name.trim(), out_number: form.out_number.trim() || null, doc_date: form.doc_date || null,
        file_name: file.name, storage_path: path, file_type: file.type || null, created_by: user?.id || null,
      })
      if (error) throw error
      setForm({ name: '', out_number: '', doc_date: new Date().toISOString().slice(0, 10) })
      setFile(null); if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (e) {
      setMsg('Помилка: ' + (/tender_documents/.test(e.message || '') ? 'запустіть міграцію 049' : e.message))
    } finally { setBusy(false) }
  }

  const open = async (r) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(r.storage_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const del = async (r) => {
    if (!confirm(`Видалити «${r.name}» (${r.doc_number})?`)) return
    await supabase.storage.from('documents').remove([r.storage_path]).catch(() => {})
    await supabase.from('tender_documents').delete().eq('id', r.id)
    load()
  }

  // Завантажити всі документи архівом (zip через fflate)
  const downloadZip = async () => {
    if (!rows?.length) return
    setZipping(true); setMsg(null)
    try {
      const { zipSync } = await import('fflate')
      const files = {}
      const used = {}
      for (const r of rows) {
        const { data, error } = await supabase.storage.from('documents').download(r.storage_path)
        if (error || !data) continue
        const buf = new Uint8Array(await data.arrayBuffer())
        const ext = (r.file_name?.split('.').pop() || r.storage_path.split('.').pop() || 'pdf').toLowerCase()
        // Ім'я у архіві: «Номер Найменування.ext» (безпечне)
        let nm = `${r.doc_number} ${r.name || ''}`.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
        nm = nm || `doc_${r.seq}`
        let file = `${nm}.${ext}`
        if (used[file]) { used[file]++; file = `${nm} (${used[file]}).${ext}` } else used[file] = 1
        files[file] = buf
      }
      if (!Object.keys(files).length) { setMsg('Не вдалося завантажити файли'); return }
      const zipped = zipSync(files)
      const blob = new Blob([zipped], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Тендерна документація ${o.order_number || ''}${base ? ' ' + base : ''}.zip`.trim()
      a.click(); URL.revokeObjectURL(url)
    } catch (e) {
      setMsg('Помилка архіву: ' + e.message)
    } finally { setZipping(false) }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Тендерна документація</div>
        {o.procurement_id
          ? <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>Закупівля: <b>{o.procurement_id}</b>{base && <> · нумерація <b>{base}/N</b></>}</span>
          : <span style={{ fontSize: 12.5, color: 'var(--amber, #b45309)' }}>Вкажіть «Ідентифікатор закупівлі» у вкладці «Деталі» — нумерація буде за ним.</span>}
        {rows?.length > 0 && (
          <button className="btn" onClick={downloadZip} disabled={zipping} style={{ marginLeft: 'auto' }}>
            <i className="ti ti-file-zip" /> {zipping ? 'Архівування…' : 'Завантажити архів (.zip)'}
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 14px' }}>Документи зберігаються лише в цьому замовленні й не потрапляють у загальні «Документи».</p>

      {/* Форма додавання */}
      <div style={{ background: 'var(--surface2)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div className="form-grid">
          <div className="form-group full"><label>Найменування документа</label>
            <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="напр. Тендерна пропозиція" />
          </div>
          <div className="form-group"><label>Вихідний номер</label>
            <input className="form-input" value={form.out_number} onChange={e => setForm(f => ({ ...f, out_number: e.target.value }))} placeholder="№ документа" />
          </div>
          <div className="form-group"><label>Дата документа</label>
            <input className="form-input" type="date" value={form.doc_date} onChange={e => setForm(f => ({ ...f, doc_date: e.target.value }))} />
          </div>
          <div className="form-group full"><label>Файл (скан){base && <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 11 }}> · буде № {base}/{nextSeq()}</span>}{recognizing && <span style={{ color: 'var(--blue)', fontWeight: 400, fontSize: 11 }}> · <i className="ti ti-loader-2" style={{ animation: 'spin 1s linear infinite' }} /> розпізнаю…</span>}</label>
            <input ref={fileRef} className="form-input" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={e => onFile(e.target.files?.[0] || null)} />
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Після вибору файлу система спробує сама заповнити найменування, вихідний номер і дату — перевірте.</span>
          </div>
        </div>
        {msg && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}><i className="ti ti-alert-circle" /> {msg}</div>}
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={upload} disabled={busy || recognizing}>{busy ? 'Завантаження…' : <><i className="ti ti-upload" /> Додати документ</>}</button>
        </div>
      </div>

      {/* Список */}
      {rows == null ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p>
        : rows.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Документів ще немає.</p>
        : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table><thead><tr>
              <th style={{ width: 90 }}>№</th><th>Найменування</th><th>Вих. №</th><th>Дата</th><th>Файл</th><th style={{ width: 80 }}></th>
            </tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.doc_number}</td>
                  <td>{r.name}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.out_number || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.doc_date)}</td>
                  <td><a onClick={() => open(r)} style={{ color: 'var(--blue)', cursor: 'pointer' }} className="trunc"><i className="ti ti-file" /> {r.file_name || 'відкрити'}</a></td>
                  <td style={{ textAlign: 'right' }}><button className="btn" onClick={() => del(r)} style={{ color: 'var(--red)', padding: '2px 8px' }}><i className="ti ti-trash" /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
    </div>
  )
}

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { extractDocument } from '../lib/ai'
import { fetchArticles } from '../lib/articles'
import { getContractorMatcher } from '../lib/contractorMatch'
import { DOCUMENT_TYPES, getDocType } from '../lib/docgen'
import { fmt } from '../lib/fmt'
import { dirFromType, typeFromOcr, buildDocFileName } from './DocModal'
import { todayKyiv } from '../lib/dates'

// Масове завантаження: КОЖЕН файл = окремий документ. Якщо такий документ уже є в системі (той самий тип і №;
// контрагент — якщо розпізнано), за замовчуванням файл ПРИКРІПЛЮЄТЬСЯ до нього як підписаний скан
// (documents.signed_scan_url, is_signed) — без нового документа. Інакше (на відміну від DocModal,
// де кілька файлів = сторінки одного документа). Кожен файл розпізнається окремо,
// далі — список-черга з полями + попередження про можливий дубль + чекбокс.
// Batch створює лише рядки в `documents` (без авто-рухів складу — їх вмикають
// окремо, відкривши картку документа: списання OUT задвоюється надто легко).
export default function BatchDocUploadModal({ user, onClose, onSaved }) {
  const [items, setItems] = useState([]) // { id, file, status, form, dup, include, error }
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('pick') // pick | review | saving | done
  const [progress, setProgress] = useState('')

  const mapOcr = (data, matcher) => {
    const m = matcher({ counterparty: data.contractor, edrpou: data.edrpou })
    const docRole = data.docRole || 'incoming'
    const type = typeFromOcr(data.docType, docRole)
    const contractorName = m?.contractor.name || data.contractor || ''
    const amount = data.totalAmount ?? (data.amountNoVat != null
      ? Number(data.amountNoVat) + Number(data.vatAmount || 0)
      : (data.amount ?? ''))
    return {
      type,
      doc_number: data.docNumber || '',
      contractor_id: m?.contractor.id || null,
      contractorName,
      edrpou: data.edrpou || '',
      amount, vat_amount: data.vatAmount ?? 0,
      date: data.date || todayKyiv(),
      doc_role: docRole,
      items: data.items || [],
      file_name: buildDocFileName({ type, docNumber: data.docNumber, contractorName, date: data.date }, data.origName || ''),
    }
  }

  // Наявний документ у БД: той самий тип + № + контрагент (сума як запасний ключ). Сформовані в системі
  // документи часто розпізнаються з іншим контрагентом (наша юрособа замість клієнта) — тоді шукаємо
  // за типом і № у тому самому році (без контрагента), якщо такий документ один.
  const COLS = 'id, doc_number, amount, doc_date, source, generated_doc_id, signed_scan_url, contractors(name)'
  const findDup = async (form) => {
    const num = (form.doc_number || '').trim()
    const amt = Number(form.amount) || null
    if (!num && !(form.contractor_id && amt != null)) return null
    let dq = qc('documents').select(COLS).eq('type', form.type)
    dq = form.contractor_id ? dq.eq('contractor_id', form.contractor_id) : dq.is('contractor_id', null)
    if (num) dq = dq.eq('doc_number', num); else dq = dq.eq('amount', amt)
    const { data } = await dq.limit(1)
    if (data?.[0]) return data[0]
    if (!num) return null
    const y = (form.date || '').slice(0, 4)
    let q2 = qc('documents').select(COLS).eq('type', form.type).eq('doc_number', num)
    if (y) q2 = q2.gte('doc_date', `${y}-01-01`).lte('doc_date', `${y}-12-31`)
    const { data: d2 } = await q2.limit(2)
    return d2?.length === 1 ? d2[0] : null
  }

  const onPick = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setPhase('review'); setBusy(true)
    const base = files.map((file, i) => ({ id: `${i}_${file.name}`, file, status: 'pending', form: null, dup: null, include: true, mode: 'new', error: null }))
    setItems(base)
    const articles = await fetchArticles().catch(() => [])
    const matcher = await getContractorMatcher()
    const seen = [] // ключі вже опрацьованих у цій пачці (для інтра-batch дублів)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setProgress(`Розпізнавання ${i + 1}/${files.length}: ${file.name}`)
      setItems(prev => prev.map((it, j) => j === i ? { ...it, status: 'ocr' } : it))
      try {
        const data = await extractDocument(file, articles)
        const form = mapOcr({ ...data, origName: file.name }, matcher)
        const dbDup = await findDup(form)
        const key = `${form.type}|${(form.doc_number || '').trim()}|${form.contractor_id || form.contractorName}`
        const inBatch = seen.includes(key) && (form.doc_number || form.contractor_id)
        seen.push(key)
        const dup = dbDup ? { ...dbDup, where: 'db' } : (inBatch ? { where: 'batch' } : null)
        // наявний у базі → прикріпити скан; дубль у цій пачці → пропустити
        setItems(prev => prev.map((it, j) => j === i ? { ...it, status: 'done', form, dup, mode: dup?.where === 'db' ? 'attach' : 'new', include: dup?.where !== 'batch' } : it))
      } catch (e) {
        setItems(prev => prev.map((it, j) => j === i ? { ...it, status: 'error', form: mapOcr({ origName: file.name }, matcher), error: e.message } : it))
      }
    }
    setProgress(''); setBusy(false)
  }

  const patch = (id, upd) => setItems(prev => prev.map(it => it.id === id ? { ...it, form: { ...it.form, ...upd } } : it))
  const toggle = (id) => setItems(prev => prev.map(it => it.id === id ? { ...it, include: !it.include } : it))

  const saveAll = async () => {
    setBusy(true); setPhase('saving')
    const toSave = items.filter(it => it.include && it.form)
    let ok = 0, fail = 0
    for (let i = 0; i < toSave.length; i++) {
      const it = toSave[i]
      setProgress(`Збереження ${i + 1}/${toSave.length}: ${it.form.file_name}`)
      try {
        const f = it.file
        const path = `${Date.now()}_${f.name}`.replace(/[^\w.\-/]/g, '_')
        const { error: upErr } = await supabase.storage.from('documents').upload(path, f, { upsert: false })
        if (upErr && !upErr.message.includes('exists')) throw upErr
        if (it.mode === 'attach' && it.dup?.id) {
          // скан до наявного документа: сформований PDF лишається, скан — у signed_scan_url
          const { error } = await qc('documents').update({ signed_scan_url: path, is_signed: true }).eq('id', it.dup.id)
          if (error) throw error
          ok++; continue
        }
        const num = (it.form.doc_number || '').trim()
        const ins = {
          type: it.form.type,
          doc_number: num || null,
          doc_date: it.form.date || null,
          contractor_id: it.form.contractor_id || null,
          amount: Number(it.form.amount) || null,
          vat_amount: Number(it.form.vat_amount) || 0,
          direction: dirFromType(it.form.type),
          storage_path: path, file_name: it.form.file_name || f.name, file_type: f.type, file_path: path,
          doc_role: getDocType(it.form.type)?.direction || 'incoming',
          ocr_data: it.form, uploaded_by: user?.id || null, posted: true,
        }
        let { error } = await qc('documents').insert(withCompany(ins))
        if (error && /posted/.test(error.message || '')) { const { posted, ...rest } = ins; ({ error } = await qc('documents').insert(withCompany(rest))) }
        if (error) throw error
        ok++
      } catch (e) {
        fail++
        setItems(prev => prev.map(x => x.id === it.id ? { ...x, error: e.message } : x))
      }
    }
    setProgress(`Збережено: ${ok}${fail ? ` · помилок: ${fail}` : ''}`)
    setBusy(false); setPhase('done')
    if (ok) onSaved?.()
  }

  const doneCount = items.filter(it => it.status === 'done' || it.status === 'error').length
  const selCount = items.filter(it => it.include).length
  const attachCount = items.filter(it => it.include && it.mode === 'attach').length

  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1000, width: '95%' }}>
        <div className="modal-header">
          <h2>Масове завантаження документів</h2>
          <button onClick={busy ? undefined : onClose} className="modal-close" disabled={busy}><i className="ti ti-x" /></button>
        </div>

        {phase === 'pick' && (
          <div>
            <p style={{ color: 'var(--text2)', marginTop: 0 }}>Оберіть кілька файлів — <b>кожен файл стане окремим документом</b>. Багатосторінковий документ вантажте одним PDF.</p>
            <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
              <i className="ti ti-upload" /> Обрати файли
              <input type="file" multiple accept="image/*,.pdf,.heic" style={{ display: 'none' }} onChange={e => onPick(e.target.files)} />
            </label>
          </div>
        )}

        {phase !== 'pick' && (
          <>
            {progress && <p style={{ color: 'var(--text2)', margin: '0 0 10px' }}><i className="ti ti-loader" /> {progress}</p>}
            {phase === 'review' && !busy && <p style={{ color: 'var(--text2)', margin: '0 0 10px' }}>Розпізнано {doneCount}/{items.length}. Якщо документ уже є в системі (наприклад, сформований), скан прикріпиться до нього — нового не буде. Перевірте поля, тоді «Зберегти обрані».</p>}
            <div className="tbl-wrap" style={{ maxHeight: '55vh', overflow: 'auto' }}>
              <table>
                <thead><tr>
                  <th style={{ width: 30 }}></th>
                  <th>Файл</th>
                  <th>Тип</th>
                  <th>№</th>
                  <th>Контрагент</th>
                  <th style={{ textAlign: 'right' }}>Сума</th>
                  <th>Дата</th>
                  <th>Статус</th>
                </tr></thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.id} style={{ opacity: it.include ? 1 : 0.5 }}>
                      <td><input type="checkbox" checked={it.include} disabled={busy || it.status !== 'done' && it.status !== 'error'} onChange={() => toggle(it.id)} /></td>
                      <td><div className="trunc" style={{ maxWidth: 160, fontSize: 12 }} title={it.file.name}>{it.file.name}</div></td>
                      <td>
                        {it.form ? (
                          <select className="form-input" style={{ fontSize: 12, padding: '2px 4px' }} value={it.form.type} disabled={busy} onChange={e => patch(it.id, { type: e.target.value })}>
                            {DOCUMENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                          </select>
                        ) : '—'}
                      </td>
                      <td>{it.form ? <input className="form-input" style={{ width: 80, fontSize: 12, padding: '2px 4px' }} value={it.form.doc_number} disabled={busy} onChange={e => patch(it.id, { doc_number: e.target.value })} /> : '—'}</td>
                      <td>
                        <div className="trunc" style={{ maxWidth: 180, fontSize: 12 }} title={it.form?.contractorName}>{it.form?.contractorName || '—'}</div>
                        {it.form && !it.form.contractor_id && it.form.contractorName && <span style={{ fontSize: 10, color: 'var(--amber, #b45309)' }}><i className="ti ti-alert-circle" /> не знайдено в базі</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{it.form ? <input className="form-input" style={{ width: 90, fontSize: 12, padding: '2px 4px', textAlign: 'right' }} value={it.form.amount} disabled={busy} onChange={e => patch(it.id, { amount: e.target.value })} /> : '—'}</td>
                      <td>{it.form ? <input type="date" className="form-input" style={{ fontSize: 11, padding: '2px 4px' }} value={it.form.date} disabled={busy} onChange={e => patch(it.id, { date: e.target.value })} /> : '—'}</td>
                      <td style={{ fontSize: 12 }}>
                        {it.status === 'pending' && <span style={{ color: 'var(--text3)' }}>очікує</span>}
                        {it.status === 'ocr' && <span style={{ color: 'var(--text2)' }}><i className="ti ti-loader" /> розпізнавання…</span>}
                        {it.status === 'done' && !it.dup && <span style={{ color: 'var(--green)' }}><i className="ti ti-check" /> готово</span>}
                        {it.status === 'done' && it.dup?.where === 'db' && <>
                          <select className="form-input" style={{ fontSize: 12, padding: '2px 4px' }} value={it.mode} disabled={busy} aria-label="Що зробити з файлом"
                            onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, mode: e.target.value } : x))}>
                            <option value="attach">Прикріпити скан до наявного</option>
                            <option value="new">Створити новий документ</option>
                          </select>
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>є: №{it.dup.doc_number || '—'}{it.dup.doc_date ? ` від ${it.dup.doc_date.split('-').reverse().join('.')}` : ''}{it.dup.amount != null ? ` · ${fmt(it.dup.amount)}` : ''}{it.dup.contractors?.name ? ` · ${it.dup.contractors.name}` : ''}{it.dup.signed_scan_url ? ' · скан уже є — замінимо' : ''}</div>
                        </>}
                        {it.status === 'done' && it.dup?.where === 'batch' && <span style={{ color: 'var(--amber, #b45309)' }} title="Дубль у цій пачці"><i className="ti ti-copy" /> дубль у пачці</span>}
                        {it.status === 'error' && <span style={{ color: 'var(--red, #dc2626)' }} title={it.error}><i className="ti ti-alert-triangle" /> OCR не вдалось</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <span style={{ color: 'var(--text2)', fontSize: 13 }}>Обрано до збереження: <b>{selCount}</b> з {items.length}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={onClose} disabled={busy}>{phase === 'done' ? 'Закрити' : 'Скасувати'}</button>
                {phase !== 'done' && <button className="btn btn-primary" onClick={saveAll} disabled={busy || !selCount || doneCount < items.length}><i className="ti ti-device-floppy" /> Зберегти обрані ({selCount}{attachCount ? `, з них скан до наявних: ${attachCount}` : ''})</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

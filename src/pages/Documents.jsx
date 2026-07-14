import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import { DOCUMENT_TYPES, getDocType } from '../lib/docgen'
import ContractorSelect from '../components/ui/ContractorSelect'
import DocGenModal from '../components/DocGenModal'
import DocModal from '../components/DocModal'
import GeneratedDocModal from '../components/GeneratedDocModal'
import { useSort, SortTh } from '../components/Sort'

// Документ без метаданих — потребує розпізнавання
const isIncomplete = (d) => !d.type || d.amount == null || !d.contractor_id

export default function Documents() {
  const { user } = useUser()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [signedFilter, setSignedFilter] = useState('all')
  const [verFilter, setVerFilter] = useState('all')
  const [showOcr, setShowOcr] = useState(false)
  const [genContractor, setGenContractor] = useState(null)
  const [pickGen, setPickGen] = useState(false)
  const [openDoc, setOpenDoc] = useState(null) // { doc, autoOcr }
  const [genDoc, setGenDoc] = useState(null)   // згенерований документ (перегляд)

  const openRow = (d) => {
    if (d.source === 'generated' && d.generated_doc_id) { setGenDoc(d); return }
    setOpenDoc({ doc: d, autoOcr: false })
  }

  const load = async () => {
    setLoading(true)
    const base = 'id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, direction, created_at, contractor_id, storage_path, file_path, file_type, doc_role, ocr_data, source, generated_doc_id, contractors(name)'
    // is_verified — міграція 029; якщо колонки ще нема, вантажимо без неї (сторінка не ламається)
    let { data, error } = await supabase.from('documents').select(base + ', is_verified')
      .order('created_at', { ascending: false }).limit(500)
    if (error) ({ data } = await supabase.from('documents').select(base).order('created_at', { ascending: false }).limit(500))
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
      if (verFilter === 'verified' && !d.is_verified) return false
      if (verFilter === 'unverified' && d.is_verified) return false
      if (!term) return true
      return (d.file_name || '').toLowerCase().includes(term) || (d.contractors?.name || '').toLowerCase().includes(term)
    })
  }, [rows, q, typeFilter, signedFilter, verFilter])

  const { sort, onSort, sorted } = useSort('date', 'desc')
  const view = sorted(filtered, {
    type: d => getDocType(d.type)?.label || d.type || '',
    contractor: d => d.contractors?.name || '',
    date: d => d.doc_date || d.created_at || '',
    amount: d => Number(d.amount) || 0,
    vat_amount: d => Number(d.vat_amount) || 0,
  })

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
        <select className="form-input" value={verFilter} onChange={e => setVerFilter(e.target.value)} style={{ width: 180 }}>
          <option value="all">Перевірка: усі</option>
          <option value="unverified">Неперевірені</option>
          <option value="verified">Перевірені</option>
        </select>
      </div>

      <div className="card">
        {loading ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <SortTh label="Тип" k="type" sort={sort} onSort={onSort} />
                <SortTh label="№" k="doc_number" sort={sort} onSort={onSort} />
                <SortTh label="Контрагент" k="contractor" sort={sort} onSort={onSort} />
                <SortTh label="Файл" k="file_name" sort={sort} onSort={onSort} />
                <SortTh label="Сума" k="amount" sort={sort} onSort={onSort} align="right" />
                <SortTh label="ПДВ" k="vat_amount" sort={sort} onSort={onSort} />
                <SortTh label="Підпис" k="is_signed" sort={sort} onSort={onSort} />
                <th>Перевірка</th>
                <SortTh label="Дата" k="date" sort={sort} onSort={onSort} />
                <th></th>
              </tr></thead>
              <tbody>
                {view.map(d => (
                  <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => openRow(d)}>
                    <td style={{ fontSize: 13 }}>{getDocType(d.type)?.label || d.type || '—'}</td>
                    <td style={{ fontSize: 13, color: 'var(--text2)' }}>{d.doc_number || '—'}</td>
                    <td><div className="trunc">{d.contractors?.name || '—'}</div></td>
                    <td><div className="trunc" style={{ color: 'var(--text2)', fontSize: 12 }} title={d.file_name}>{d.file_name || '—'}</div></td>
                    <td style={{ textAlign: 'right' }}>{d.amount ? fmt(d.amount) : '—'}</td>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>{d.vat_amount ? fmt(d.vat_amount) : '—'}</td>
                    <td>{d.is_signed ? <span style={{ color: 'var(--green)' }}><i className="ti ti-check" /></span> : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                    <td>{d.is_verified
                      ? <span style={{ color: 'var(--green)', fontSize: 12, fontWeight: 600 }}><i className="ti ti-checkbox" /> так</span>
                      : <span style={{ color: 'var(--amber, #b45309)', fontSize: 12 }}><i className="ti ti-alert-circle" /> ні</span>}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{(d.doc_date || d.created_at || '').slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isIncomplete(d) && (d.storage_path || d.file_path) && (
                        <button className="btn" onClick={(e) => { e.stopPropagation(); setOpenDoc({ doc: d, autoOcr: true }) }} title="Розпізнати метадані з файлу через OCR" style={{ whiteSpace: 'nowrap' }}><i className="ti ti-scan" /> Розпізнати</button>
                      )}
                    </td>
                  </tr>
                ))}
                {view.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Документів немає</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showOcr && <DocModal user={user} onClose={() => setShowOcr(false)} onSaved={() => { setShowOcr(false); load() }} />}
      {openDoc && <DocModal user={user} existingDoc={openDoc.doc} autoOcr={openDoc.autoOcr} onClose={() => setOpenDoc(null)} onSaved={() => { setOpenDoc(null); load() }} />}
      {genDoc && <GeneratedDocModal doc={genDoc} onClose={() => setGenDoc(null)} onDeleted={() => { setGenDoc(null); load() }} />}
      {pickGen && <PickContractorModal onClose={() => setPickGen(false)} onPick={(c) => { setPickGen(false); setGenContractor(c) }} />}
      {genContractor && <DocGenModal contractor={genContractor} userId={user?.id} onClose={() => setGenContractor(null)} onSaved={() => { setGenContractor(null); load() }} />}
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

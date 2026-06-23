import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmtInt } from '../lib/fmt'
import { normalizeName } from '../lib/contractors'

export default function Contractors() {
  const { user } = useUser()
  const navigate = useNavigate()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all') // all | client | supplier
  const [showNew, setShowNew] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('contractors')
      .select('id, name, short_name, edrpou, is_client, is_supplier, total_income, total_expense, operations_count, last_operation_date')
      .order('total_income', { ascending: false })
    setList(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return list.filter(c => {
      if (filter === 'client' && !c.is_client) return false
      if (filter === 'supplier' && !c.is_supplier) return false
      if (!term) return true
      return (c.name || '').toLowerCase().includes(term) || (c.edrpou || '').includes(term)
    })
  }, [list, q, filter])

  const counts = useMemo(() => ({
    all: list.length,
    client: list.filter(c => c.is_client).length,
    supplier: list.filter(c => c.is_supplier).length,
  }), [list])

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1>Контрагенти</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <i className="ti ti-plus" /> Новий
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          placeholder="Пошук за назвою або ЄДРПОУ…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ flex: '1 1 280px', maxWidth: 420 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {[['all', 'Всі'], ['client', 'Клієнти'], ['supplier', 'Постачальники']].map(([k, lbl]) => (
            <button key={k} onClick={() => setFilter(k)} className="btn"
              style={{ background: filter === k ? 'var(--blue)' : 'var(--surface)', color: filter === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>
              {lbl} <span style={{ opacity: .7 }}>{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Контрагент</th>
                  <th>ЄДРПОУ</th>
                  <th>Тип</th>
                  <th style={{ textAlign: 'right' }}>Дохід</th>
                  <th style={{ textAlign: 'right' }}>Витрати</th>
                  <th style={{ textAlign: 'right' }}>Операцій</th>
                  <th>Остання</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/contractors/${c.id}`)}>
                    <td><div className="trunc" style={{ fontWeight: 500 }}>{c.name}</div></td>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>{c.edrpou || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {c.is_client && <span style={tag('var(--green-bg)', 'var(--green)')}>клієнт</span>}
                        {c.is_supplier && <span style={tag('var(--red-bg)', 'var(--red)')}>постач.</span>}
                        {!c.is_client && !c.is_supplier && <span style={{ color: 'var(--text3)' }}>—</span>}
                      </div>
                    </td>
                    <td className="amt-pos" style={{ textAlign: 'right' }}>{fmtInt(c.total_income)}</td>
                    <td className="amt-neg" style={{ textAlign: 'right' }}>{fmtInt(c.total_expense)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{c.operations_count || 0}</td>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>{c.last_operation_date || '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Нічого не знайдено</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewContractorModal user={user} onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); navigate(`/contractors/${id}`) }} />}
    </div>
  )
}

const tag = (bg, color) => ({ background: bg, color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' })

function NewContractorModal({ user, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [edrpou, setEdrpou] = useState('')
  const [isClient, setIsClient] = useState(true)
  const [isSupplier, setIsSupplier] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    if (!name.trim()) { setError("Вкажіть назву"); return }
    setSaving(true); setError(null)
    const { data, error } = await supabase.from('contractors').insert({
      name: normalizeName(name),
      edrpou: edrpou.trim() || null,
      is_client: isClient,
      is_supplier: isSupplier,
      type: isClient ? 'client' : isSupplier ? 'supplier' : 'other',
      created_by: user?.id || null,
    }).select('id').single()
    setSaving(false)
    if (error) { setError(error.message); return }
    onCreated(data.id)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header"><h2>Новий контрагент</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 4 }}>
          <div className="form-group"><label>Назва *</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
          <div className="form-group"><label>ЄДРПОУ</label><input className="form-input" value={edrpou} onChange={e => setEdrpou(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><input type="checkbox" checked={isClient} onChange={e => setIsClient(e.target.checked)} /> Клієнт</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><input type="checkbox" checked={isSupplier} onChange={e => setIsSupplier(e.target.checked)} /> Постачальник</label>
          </div>
          {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button className="btn" onClick={onClose}>Скасувати</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '…' : 'Створити'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

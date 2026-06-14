import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import TransactionModal from './TransactionModal'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(n || 0))

const UA_MONTHS = ['січень','лютий','березень','квітень','травень','червень','липень','серпень','вересень','жовтень','листопад','грудень']

function shortContractor(name) {
  if (!name) return ''
  return name
    .replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/gi, '')
    .replace(/ФІЗИЧНА ОСОБА[-\s]ПІДПРИЄМЕЦЬ/gi, '')
    .replace(/АКЦІОНЕРНЕ ТОВАРИСТВО/gi, '')
    .replace(/^ТОВ\s+/gi, '')
    .replace(/^ФОП\s+/gi, '')
    .replace(/^АТ\s+/gi, '')
    .replace(/[«»"']/g, '')
    .trim()
    .substring(0, 25)
    .trim()
}

function generateProjectId(seqNum, contractor, date) {
  const num = String(seqNum).padStart(3, '0')
  const short = shortContractor(contractor)
  const d = new Date(date)
  const month = UA_MONTHS[d.getMonth()]
  const year = d.getFullYear()
  return `#${num} / ${short} / ${month} ${year}`
}

const DOC_TYPE_LABELS = {
  'incoming': 'Вхідні',
  'outgoing': 'Вихідні',
}

const TYPE_ICONS = {
  'рахунок-фактура': 'ti-receipt',
  'видаткова накладна': 'ti-truck-delivery',
  'акт наданих послуг': 'ti-file-check',
  'прибуткова накладна': 'ti-file-import',
  'інше': 'ti-file-text',
}

function getTypeIcon(docType) {
  if (!docType) return 'ti-file-text'
  const lower = docType.toLowerCase()
  for (const [key, icon] of Object.entries(TYPE_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return 'ti-file-text'
}

export default function Projects({ user }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selected, setSelected] = useState(null)
  const [projDocs, setProjDocs] = useState([])
  const [projTxs, setProjTxs] = useState([])
  const [docTab, setDocTab] = useState('incoming')

  const [form, setForm] = useState({ description: '', budget: '', contractor: '', edrpou: '', start_date: new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [editProj, setEditProj] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [selectedTx, setSelectedTx] = useState(null)

  // Preview generated ID
  const previewId = form.contractor && form.start_date
    ? generateProjectId('???', form.contractor, form.start_date)
    : null

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('*, transactions(amount, direction)')
      .order('created_at', { ascending: false })
    setProjects(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openProject = async (proj) => {
    setSelected(proj)
    setDocTab('incoming')

    // Load transactions for this project
    const { data: txs } = await supabase
      .from('transactions')
      .select('*, transaction_items(*)')
      .eq('project_id', proj.id)
      .order('date', { ascending: false })

    setProjTxs(txs || [])

    // Load documents — by project_id OR by transaction_id (для старих записів)
    const txIds = (txs || []).map(t => t.id)
    let docs = []

    const { data: byProject } = await supabase
      .from('documents')
      .select('*, transactions(doc_type, doc_number, contractor, date)')
      .eq('project_id', proj.id)

    if (byProject?.length > 0) {
      docs = byProject
    } else if (txIds.length > 0) {
      const { data: byTx } = await supabase
        .from('documents')
        .select('*, transactions(doc_type, doc_number, contractor, date)')
        .in('transaction_id', txIds)
      docs = byTx || []
    }

    setProjDocs(docs)
  }

  const downloadDoc = async (doc) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const downloadFiltered = async (role) => {
    const filtered = projDocs.filter(d => d.doc_role === role)
    for (const doc of filtered) await downloadDoc(doc)
  }

  const handleSave = async () => {
    if (!form.contractor) { setError('Введіть контрагента'); return }
    if (!form.start_date) { setError('Оберіть дату проєкту'); return }
    setSaving(true)

    // Get next seq number
    const { count } = await supabase.from('projects').select('*', { count: 'exact', head: true })
    const seqNum = (count || 0) + 1
    const projectIdDisplay = generateProjectId(seqNum, form.contractor, form.start_date)

    const { error } = await supabase.from('projects').insert({
      name: projectIdDisplay,
      description: form.description || null,
      budget: parseFloat(form.budget) || null,
      status: 'active',
      contractor: form.contractor,
      edrpou: form.edrpou || null,
      start_date: form.start_date,
      seq_number: seqNum,
      project_id_display: projectIdDisplay,
      created_by: user.id,
    })
    if (error) { setError(error.message); setSaving(false); return }
    setShowForm(false)
    setForm({ description: '', budget: '', contractor: '', edrpou: '', start_date: new Date().toISOString().split('T')[0] })
    setError(null)
    setSaving(false)
    load()
  }

  const openEdit = (e, proj) => {
    e.stopPropagation()
    setEditProj(proj)
    setEditForm({ name: proj.name, description: proj.description || '', budget: proj.budget?.toString() || '', status: proj.status || 'active' })
  }

  const handleEditSave = async () => {
    if (!editForm.name) return
    setEditSaving(true)
    const { error } = await supabase.from('projects').update({
      name: editForm.name,
      description: editForm.description || null,
      budget: parseFloat(editForm.budget) || null,
      status: editForm.status,
    }).eq('id', editProj.id)
    if (!error) {
      setProjects(ps => ps.map(p => p.id === editProj.id ? { ...p, ...editForm, budget: parseFloat(editForm.budget) || null } : p))
      setEditProj(null)
    }
    setEditSaving(false)
  }

  const handleDelete = async (e, proj) => {
    e.stopPropagation()
    const txCount = proj.transactions?.length || 0
    const msg = txCount > 0
      ? `Видалити проєкт "${proj.name}"?\n\nУ ньому ${txCount} операцій — вони НЕ видаляться, просто відвʼяжуться від проєкту.`
      : `Видалити проєкт "${proj.name}"?`
    if (!window.confirm(msg)) return
    const { error: delErr } = await supabase.from('projects').delete().eq('id', proj.id)
    if (delErr) {
      alert('Помилка видалення: ' + delErr.message)
      return
    }
    setProjects(ps => ps.filter(p => p.id !== proj.id))
  }

  const getStats = (proj) => {
    const txs = proj.transactions || []
    const revenue = txs.filter(t => t.direction === 'Доходи').reduce((s, t) => s + (t.amount || 0), 0)
    const expenses = txs.filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    return { revenue, expenses, gp: revenue - expenses }
  }

  // Group docs by type within a role
  const groupByType = (docs, role) => {
    const filtered = docs.filter(d => d.doc_role === role)
    const groups = {}
    filtered.forEach(doc => {
      const type = doc.transactions?.doc_type || 'інше'
      if (!groups[type]) groups[type] = []
      groups[type].push(doc)
    })
    return groups
  }

  const incomingDocs = projDocs.filter(d => d.doc_role === 'incoming')
  const outgoingDocs = projDocs.filter(d => d.doc_role === 'outgoing')

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Завантаження...</div>

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Проєкти</h1>
          <p>{projects.length} проєктів</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Новий проєкт</button>
      </div>

      {projects.length === 0 && (
        <div className="card">
          <div className="empty">
            <i className="ti ti-folder-open" style={{ fontSize: 48, color: 'var(--text3)', display: 'block', margin: '0 auto 12px' }} />
            <p>Немає проєктів.<br />Натисніть «Новий проєкт» щоб почати.</p>
          </div>
        </div>
      )}

      <div className="proj-grid">
        {projects.map(proj => {
          const { revenue, expenses, gp } = getStats(proj)
          return (
            <div key={proj.id} className="proj-card" style={{ cursor: 'pointer' }} onClick={() => openProject(proj)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, marginRight: 8 }}>
                <div className="proj-name">{proj.project_id_display || proj.name}</div>
                {proj.contractor && proj.project_id_display && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{proj.contractor}</div>
                )}
              </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                  <span className={`badge badge-${proj.status}`}>
                    {proj.status === 'active' ? 'Активний' : proj.status === 'completed' ? 'Завершено' : 'Архів'}
                  </span>
                  <button
                    style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', flexShrink: 0 }}
                    onClick={e => openEdit(e, proj)} title="Редагувати"
                  ><i className="ti ti-pencil" style={{ fontSize: 13 }} /></button>
                  <button
                    style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)', flexShrink: 0 }}
                    onClick={e => handleDelete(e, proj)} title="Видалити"
                  ><i className="ti ti-trash" style={{ fontSize: 13 }} /></button>
                </div>
              </div>
              {proj.description && <div className="proj-meta">{proj.description}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 4 }}>
                {[
                  { l: 'Виручка', v: fmt(revenue), c: 'var(--blue)' },
                  { l: 'Витрати', v: fmt(expenses), c: 'var(--red)' },
                  { l: 'Маржа', v: fmt(gp), c: gp >= 0 ? 'var(--green)' : 'var(--red)' },
                ].map(({ l, v, c }) => (
                  <div key={l}>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* New project modal */}
      {showForm && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2>Новий проєкт</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            {/* Preview ID */}
            {previewId && (
              <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', marginBottom:14, display:'flex', alignItems:'center', gap:10 }}>
                <i className="ti ti-id-badge" style={{ fontSize:18, color:'var(--blue)', flexShrink:0 }} />
                <div>
                  <div style={{ fontSize:11, color:'var(--text3)', marginBottom:2 }}>ID проєкту (генерується автоматично)</div>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>{previewId}</div>
                </div>
              </div>
            )}
            <div className="form-grid">
              <div className="form-group full">
                <label>Контрагент *</label>
                <input className="form-input" value={form.contractor} onChange={e => setForm(f => ({ ...f, contractor: e.target.value }))} placeholder="ТОВ Гігаклауд або ФОП Іванов" />
              </div>
              <div className="form-group">
                <label>ЄДРПОУ / ІПН</label>
                <input className="form-input" value={form.edrpou} onChange={e => setForm(f => ({ ...f, edrpou: e.target.value }))} placeholder="12345678" />
              </div>
              <div className="form-group">
                <label>Дата проєкту *</label>
                <input type="date" className="form-input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Бюджет, грн</label>
                <input type="number" className="form-input" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
              </div>
              <div className="form-group full">
                <label>Опис (необов'язково)</label>
                <textarea className="form-input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Збереження...' : 'Створити'}</button>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* Project detail modal */}
      {selected && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setSelected(null)}>
          <div className="modal" style={{ maxWidth: 820 }}>
            <div className="modal-header">
              <h2>{selected.project_id_display || selected.name}</h2>
              <button className="modal-close" onClick={() => setSelected(null)}>×</button>
            </div>

            {/* Contractor info */}
            {selected.contractor && (
              <div style={{ display:'flex', alignItems:'center', gap:10, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                <i className="ti ti-building" style={{ fontSize:18, color:'var(--blue)', flexShrink:0 }} />
                <div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{selected.contractor}</div>
                  {selected.edrpou && <div style={{ fontSize:12, color:'var(--text2)' }}>ЄДРПОУ: {selected.edrpou}</div>}
                </div>
                {selected.start_date && (
                  <div style={{ marginLeft:'auto', fontSize:12, color:'var(--text3)' }}>
                    <i className="ti ti-calendar" style={{ marginRight:4 }} />{selected.start_date}
                  </div>
                )}
              </div>
            )}

            {/* Stats */}
            {(() => {
              const { revenue, expenses, gp } = getStats(selected)
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
                  {[['Виручка', revenue, 'blue'], ['Витрати', expenses, 'red'], ['Маржа', gp, gp >= 0 ? 'green' : 'red']].map(([l, v, c]) => (
                    <div key={l} className="kpi">
                      <div className="kpi-label">{l}</div>
                      <div className={`kpi-value ${c}`}>{fmt(v)} грн</div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Documents section with tabs */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ti ti-paperclip" style={{ fontSize: 15, color: 'var(--blue)' }} />
                  Документи ({projDocs.length})
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {projDocs.length > 0 && (
                    <button className="btn btn-sm btn-secondary" onClick={() => downloadFiltered(docTab)}>
                      ⬇ Завантажити {docTab === 'incoming' ? 'вхідні' : 'вихідні'}
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
                {[
                  { key: 'incoming', label: `Вхідні (${incomingDocs.length})`, icon: 'ti-arrow-down-circle' },
                  { key: 'outgoing', label: `Вихідні (${outgoingDocs.length})`, icon: 'ti-arrow-up-circle' },
                ].map(tab => (
                  <div
                    key={tab.key}
                    onClick={() => setDocTab(tab.key)}
                    style={{
                      padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                      display: 'flex', alignItems: 'center', gap: 6,
                      borderBottom: docTab === tab.key ? '2px solid var(--blue)' : '2px solid transparent',
                      color: docTab === tab.key ? 'var(--blue)' : 'var(--text2)',
                    }}
                  >
                    <i className={`ti ${tab.icon}`} style={{ fontSize: 14 }} />
                    {tab.label}
                  </div>
                ))}
              </div>

              {/* Grouped by type */}
              {(() => {
                const groups = groupByType(projDocs, docTab)
                const entries = Object.entries(groups)
                if (entries.length === 0) return (
                  <p style={{ fontSize: 12, color: 'var(--text3)', padding: '12px 0' }}>
                    {docTab === 'incoming' ? 'Немає вхідних документів' : 'Немає вихідних документів'}
                  </p>
                )
                return entries.map(([type, docs]) => (
                  <div key={type} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i className={`ti ${getTypeIcon(type)}`} style={{ fontSize: 14, color: 'var(--blue)' }} />
                      <span style={{ textTransform: 'capitalize' }}>{type}</span>
                      <span style={{ fontWeight: 400, color: 'var(--text3)' }}>({docs.length})</span>
                    </div>
                    {docs.map(doc => (
                      <div key={doc.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        <i className={`ti ${getTypeIcon(doc.transactions?.doc_type)}`} style={{ fontSize: 18, color: 'var(--text3)', flexShrink: 0, marginTop: 1 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>
                            {doc.transactions?.doc_type && (
                              <span style={{ color: 'var(--blue)', marginRight: 6, textTransform: 'capitalize' }}>
                                {doc.transactions.doc_type}
                              </span>
                            )}
                            {doc.transactions?.doc_number && (
                              <span style={{ color: 'var(--text2)' }}>№{doc.transactions.doc_number}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 1 }}>
                            {doc.transactions?.contractor && <span>{doc.transactions.contractor.replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ /gi, 'ТОВ ').substring(0, 50)}</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {doc.transactions?.date && <span>{doc.transactions.date}</span>}
                            <span style={{ color: 'var(--border2)' }}>·</span>
                            <span>{doc.file_name}</span>
                            <span style={{ color: 'var(--border2)' }}>·</span>
                            <span>{(doc.file_size / 1024).toFixed(0)} KB</span>
                          </div>
                        </div>
                        <button className="btn btn-sm btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={() => downloadDoc(doc)}>
                          <i className="ti ti-download" style={{ fontSize: 13 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              })()}
            </div>

            {/* Transactions */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ti ti-list-details" style={{ fontSize: 15, color: 'var(--blue)' }} />
                Операції ({projTxs.length})</div>
              <div className="tbl-wrap" style={{ maxHeight: 260 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Контрагент</th>
                      <th>Сума</th>
                      <th>Стаття</th>
                      <th>Позицій</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projTxs.map(tx => (
                      <tr key={tx.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedTx(tx)}>
                        <td style={{ color: 'var(--text2)' }}>{tx.date}</td>
                        <td className="trunc">{tx.contractor}</td>
                        <td className={tx.amount >= 0 ? 'amt-pos' : 'amt-neg'}>{tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)}</td>
                        <td className="trunc" style={{ color: 'var(--text2)' }}>{tx.article || '—'}</td>
                        <td style={{ color: 'var(--text3)', fontSize: 12 }}>{tx.transaction_items?.length || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit project modal */}
      {editProj && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setEditProj(null)}>
          <div className="modal">
            <div className="modal-header">
              <h2>Редагувати проєкт</h2>
              <button className="modal-close" onClick={() => setEditProj(null)}>×</button>
            </div>
            <div className="form-grid">
              <div className="form-group full">
                <label>Назва проєкту *</label>
                <input className="form-input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group full">
                <label>Опис</label>
                <textarea className="form-input" rows={2} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Бюджет, грн</label>
                <input type="number" className="form-input" value={editForm.budget} onChange={e => setEditForm(f => ({ ...f, budget: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Статус</label>
                <select className="form-input" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="active">Активний</option>
                  <option value="completed">Завершено</option>
                  <option value="archived">Архів</option>
                </select>
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleEditSave} disabled={editSaving || !editForm.name}>
                {editSaving ? 'Збереження...' : 'Зберегти'}
              </button>
              <button className="btn btn-secondary" onClick={() => setEditProj(null)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
      {selectedTx && (
        <TransactionModal tx={selectedTx} onClose={() => setSelectedTx(null)} />
      )}
    </div>
  )
}

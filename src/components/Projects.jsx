import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import TransactionModal from './TransactionModal'
import ContractorSelect from './ui/ContractorSelect'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(n || 0))
const fmtInt = fmt

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
  const [allProducts, setAllProducts] = useState([])
  const [productSearch, setProductSearch] = useState('')
  const [linkingItemId, setLinkingItemId] = useState(null)

  const [form, setForm] = useState({ description: '', budget: '', contractor: '', edrpou: '', start_date: new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [editProj, setEditProj] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [selectedTx, setSelectedTx] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  // Preview generated ID
  const previewId = form.contractor && form.start_date
    ? generateProjectId('???', form.contractor, form.start_date)
    : null

  const load = async () => {
    setLoading(true)
    const [{ data: projs }, { data: items }] = await Promise.all([
      supabase.from('projects').select('*, bank_transactions(amount, direction)').order('created_at', { ascending: false }),
      supabase.from('transaction_items').select('project_id, amount').not('project_id', 'is', null),
    ])
    // Додати суми з transaction_items до проєктів
    const itemsByProject = {}
    ;(items || []).forEach(it => {
      if (!itemsByProject[it.project_id]) itemsByProject[it.project_id] = { total: 0 }
      itemsByProject[it.project_id].total += Math.abs(it.amount || 0)
    })
    setProjects((projs || []).map(p => ({ ...p, _itemsTotal: itemsByProject[p.id]?.total || 0 })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openProject = async (proj) => {
    setSelected(proj)
    setDocTab('incoming')

    // Load transactions: by bank_transactions.project_id OR by transaction_items.project_id
    const [{ data: txsByProject }, { data: itemsByProject }] = await Promise.all([
      supabase.from('bank_transactions').select('*, transaction_items(*)').eq('project_id', proj.id).eq('is_ignored', false).order('date', { ascending: false }),
      supabase.from('transaction_items').select('*, bank_transactions(id, date, amount, direction, counterparty, description)').eq('project_id', proj.id),
    ])

    // Merge: bank_transactions з project_id + bank_transactions де позиції мають project_id
    const txMap = {}
    ;(txsByProject || []).forEach(tx => { txMap[tx.id] = tx })
    ;(itemsByProject || []).forEach(it => {
      const bt = it.bank_transactions
      if (bt && !txMap[bt.id]) {
        txMap[bt.id] = { ...bt, transaction_items: [it], _fromItems: true }
      } else if (bt && txMap[bt.id] && txMap[bt.id]._fromItems) {
        txMap[bt.id].transaction_items.push(it)
      }
    })
    const allTxs = Object.values(txMap).sort((a, b) => b.date > a.date ? 1 : -1)
    setProjTxs(allTxs)

    // Load products for linking
    const { data: prods } = await supabase.from('products').select('id, name, current_stock, unit, buy_price').eq('status', 'active').order('name')
    setAllProducts(prods || [])

    // Load stock_movements для маржинальності (OUT рухи з cost_price)
    const allItemIds = allTxs.flatMap(tx => (tx.transaction_items || []).map(it => it.id)).filter(Boolean)
    if (allItemIds.length > 0) {
      const { data: movs } = await supabase.from('stock_movements')
        .select('id, product_id, type, quantity, price, cost_price, transaction_item_id')
        .in('transaction_item_id', allItemIds)
      // Прикріпити cost_price до items
      const movMap = {}
      ;(movs || []).forEach(m => { if (m.transaction_item_id) movMap[m.transaction_item_id] = m })
      allTxs.forEach(tx => {
        ;(tx.transaction_items || []).forEach(it => {
          const mov = movMap[it.id]
          if (mov) {
            it._costPrice = mov.cost_price
            it._movType = mov.type
          }
        })
      })
    }

    // Load documents
    const txIds = allTxs.map(t => t.id).filter(Boolean)
    let docs = []

    const { data: byProject } = await supabase
      .from('documents')
      .select('*, bank_transactions(doc_type, doc_number, counterparty, date)')
      .eq('project_id', proj.id)

    if (byProject?.length > 0) {
      docs = byProject
    } else if (txIds.length > 0) {
      const { data: byTx } = await supabase
        .from('documents')
        .select('*, bank_transactions(doc_type, doc_number, counterparty, date)')
        .in('bank_transaction_id', txIds)
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
    const txCount = proj.bank_transactions?.length || 0
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
    const txs = proj.bank_transactions || []
    const revenue = txs.filter(t => t.direction === 'Доходи').reduce((s, t) => s + (t.amount || 0), 0)
    const expenses = txs.filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    return { revenue, expenses, gp: revenue - expenses }
  }

  // Group docs by type within a role
  const groupByType = (docs, role) => {
    const filtered = docs.filter(d => d.doc_role === role)
    const groups = {}
    filtered.forEach(doc => {
      const type = doc.bank_transactions?.doc_type || 'інше'
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

      {/* Фільтри */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:'1 1 250px', maxWidth:350 }}>
          <i className="ti ti-search" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:15, color:'var(--text3)' }} />
          <input
            className="form-input"
            placeholder="Пошук по назві, контрагенту..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft:36 }}
          />
        </div>
        <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
          {[
            { id:'all', label:'Всі' },
            { id:'active', label:'Активні' },
            { id:'completed', label:'Завершені' },
            { id:'archived', label:'Архів' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilterStatus(f.id)} style={{
              padding:'7px 14px', border:'none', cursor:'pointer', fontSize:12.5, fontWeight:500,
              fontFamily:'inherit',
              background: filterStatus===f.id ? '#000' : 'var(--surface)',
              color: filterStatus===f.id ? '#fff' : 'var(--text2)',
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {(() => {
        const filtered = projects.filter(p => {
          if (filterStatus !== 'all' && p.status !== filterStatus) return false
          if (search) {
            const q = search.toLowerCase()
            const nameMatch = (p.name || '').toLowerCase().includes(q)
            const idMatch = (p.project_id_display || '').toLowerCase().includes(q)
            const contrMatch = (p.contractor || '').toLowerCase().includes(q)
            const descMatch = (p.description || '').toLowerCase().includes(q)
            if (!nameMatch && !idMatch && !contrMatch && !descMatch) return false
          }
          return true
        })

        if (filtered.length === 0) return (
          <div className="card">
            <div className="empty">
              <i className="ti ti-folder-open" style={{ fontSize: 48, color: 'var(--text3)', display: 'block', margin: '0 auto 12px' }} />
              <p>{search || filterStatus !== 'all' ? 'Нічого не знайдено' : 'Немає проєктів. Натисніть «Новий проєкт» щоб почати.'}</p>
            </div>
          </div>
        )

        return (
          <div className="proj-grid">
            {filtered.map(proj => {
              const { revenue, expenses, gp } = getStats(proj)
              const margin = revenue > 0 ? ((gp / revenue) * 100).toFixed(0) : null
              return (
                <div key={proj.id} className="proj-card" style={{ cursor: 'pointer' }} onClick={() => openProject(proj)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ flex: 1, marginRight: 8 }}>
                      <div className="proj-name">{proj.project_id_display || proj.name}</div>
                      {proj.contractor && (
                        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, display:'flex', alignItems:'center', gap:4 }}>
                          <i className="ti ti-building" style={{ fontSize:12, flexShrink:0 }} />
                          {shortContractor(proj.contractor)}
                        </div>
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
                        style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)', flexShrink: 0 }}
                        onClick={e => handleDelete(e, proj)} title="Видалити"
                      ><i className="ti ti-trash" style={{ fontSize: 13 }} /></button>
                    </div>
                  </div>

                  {/* Дата та опис */}
                  <div style={{ display:'flex', gap:12, fontSize:11, color:'var(--text3)', marginBottom:8 }}>
                    {proj.start_date && (
                      <span style={{ display:'flex', alignItems:'center', gap:3 }}>
                        <i className="ti ti-calendar" style={{ fontSize:12 }} />
                        {proj.start_date}
                      </span>
                    )}
                    {proj.budget > 0 && (
                      <span style={{ display:'flex', alignItems:'center', gap:3 }}>
                        <i className="ti ti-wallet" style={{ fontSize:12 }} />
                        Бюджет: {fmt(proj.budget)} грн
                      </span>
                    )}
                  </div>
                  {proj.description && <div className="proj-meta" style={{ marginBottom:8 }}>{proj.description}</div>}

                  {/* Фінанси */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, borderTop:'1px solid var(--border)', paddingTop:8 }}>
                    {[
                      { l: 'Виручка', v: fmt(revenue), c: 'var(--blue)' },
                      { l: 'Витрати', v: fmt(expenses), c: 'var(--red)' },
                      { l: 'Маржа', v: `${fmt(gp)}${margin ? ` (${margin}%)` : ''}`, c: gp >= 0 ? 'var(--green)' : 'var(--red)' },
                    ].map(({ l, v, c }) => (
                      <div key={l}>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{l}</div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: c }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

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
                <ContractorSelect
                  value={form.contractor}
                  onChange={v => setForm(f => ({ ...f, contractor: v }))}
                  onContractorSelect={c => {
                    if (c._new) return
                    if (c.edrpou) setForm(f => ({ ...f, edrpou: c.edrpou }))
                  }}
                />
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
          <div className="modal modal-xl">
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
                        <i className={`ti ${getTypeIcon(doc.bank_transactions?.doc_type)}`} style={{ fontSize: 18, color: 'var(--text3)', flexShrink: 0, marginTop: 1 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>
                            {doc.bank_transactions?.doc_type && (
                              <span style={{ color: 'var(--blue)', marginRight: 6, textTransform: 'capitalize' }}>
                                {doc.bank_transactions.doc_type}
                              </span>
                            )}
                            {doc.bank_transactions?.doc_number && (
                              <span style={{ color: 'var(--text2)' }}>№{doc.bank_transactions.doc_number}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 1 }}>
                            {doc.bank_transactions?.counterparty && <span>{doc.bank_transactions.counterparty.replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ /gi, 'ТОВ ').substring(0, 50)}</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {doc.bank_transactions?.date && <span>{doc.bank_transactions.date}</span>}
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

            {/* Items / Products */}
            {(() => {
              const allItems = projTxs.flatMap(tx => (tx.transaction_items || []).map(it => ({ ...it, _date: tx.date, _counterparty: tx.counterparty, _direction: tx.direction })))
              if (allItems.length === 0) return null
              const linked = allItems.filter(it => it.product_id).length

              // Calculate cost & revenue (FIFO cost_price з stock_movements)
              const itemsWithCost = allItems.map(it => {
                const product = it.product_id ? allProducts.find(p => p.id === it.product_id) : null
                const qty = parseFloat(it.quantity) || 0
                const sellPrice = parseFloat(it.unit_price) || 0
                // FIFO собівартість: _costPrice з stock_movement, fallback на product.buy_price
                const buyPrice = it._costPrice || product?.buy_price || 0
                const costTotal = qty * buyPrice
                const sellTotal = qty * sellPrice
                return { ...it, _product: product, _buyPrice: buyPrice, _costTotal: costTotal, _sellTotal: sellTotal }
              })
              const totalCost = itemsWithCost.reduce((s, it) => s + it._costTotal, 0)
              const totalRevenue = itemsWithCost.reduce((s, it) => s + it._sellTotal, 0)
              const totalMargin = totalRevenue - totalCost

              const handleLinkProduct = async (itemId, productId) => {
                await supabase.from('transaction_items').update({ product_id: productId }).eq('id', itemId)
                setProjTxs(prev => prev.map(tx => ({
                  ...tx,
                  transaction_items: (tx.transaction_items || []).map(it => it.id === itemId ? { ...it, product_id: productId } : it)
                })))
                setLinkingItemId(null)
                setProductSearch('')
              }

              return (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <i className="ti ti-package" style={{ fontSize: 15, color: 'var(--blue)' }} />
                    Товари / послуги ({allItems.length})
                    <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text3)', marginLeft: 8 }}>
                      {linked}/{allItems.length} на складі
                    </span>
                  </div>
                  {/* Cost / Revenue / Margin summary */}
                  {totalCost > 0 && (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 14px', flex: 1, minWidth: 120 }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Собівартість</div>
                        <div style={{ fontSize: 16, fontWeight: 500 }}>{fmtInt(totalCost)} грн</div>
                      </div>
                      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 14px', flex: 1, minWidth: 120 }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Реалізація</div>
                        <div style={{ fontSize: 16, fontWeight: 500 }}>{fmtInt(totalRevenue)} грн</div>
                      </div>
                      <div style={{ background: totalMargin >= 0 ? 'var(--green-bg)' : 'var(--red-bg)', borderRadius: 8, padding: '8px 14px', flex: 1, minWidth: 120 }}>
                        <div style={{ fontSize: 11, color: totalMargin >= 0 ? 'var(--green)' : 'var(--red)' }}>Маржа</div>
                        <div style={{ fontSize: 16, fontWeight: 500, color: totalMargin >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {totalMargin >= 0 ? '+' : '-'}{fmtInt(Math.abs(totalMargin))} грн
                          {totalCost > 0 && <span style={{ fontSize: 12, fontWeight: 400 }}> ({((totalMargin / totalCost) * 100).toFixed(0)}%)</span>}
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {itemsWithCost.map((it, i) => {
                      const product = it._product
                      const isLinking = linkingItemId === it.id
                      const searchResults = isLinking && productSearch.length >= 2
                        ? allProducts.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 8)
                        : []
                      const autoMatch = !it.product_id ? allProducts.find(p => p.name.trim().toLowerCase() === it.name?.trim().toLowerCase()) : null
                      const qty = parseFloat(it.quantity) || 0
                      const itemMargin = it._sellTotal - it._costTotal

                      return (
                        <div key={it.id || i} style={{
                          border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px',
                          background: product ? 'var(--surface)' : 'var(--surface2)',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, fontSize: 14, wordBreak: 'break-word' }}>{it.name}</div>
                              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                <span>{it._counterparty}</span>
                                <span>{it._date}</span>
                                <span>{qty || '—'} {it.unit || 'шт'}</span>
                              </div>
                              {/* Prices */}
                              <div style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                {it._buyPrice > 0 && <span>Собівартість: <strong>{fmtInt(it._buyPrice)}</strong> × {qty} = <strong>{fmtInt(it._costTotal)} грн</strong></span>}
                                {it._sellTotal > 0 && <span>Реалізація: <strong>{fmtInt(it.unit_price)}</strong> × {qty} = <strong>{fmtInt(it._sellTotal)} грн</strong></span>}
                                {it._buyPrice > 0 && it._sellTotal > 0 && (
                                  <span style={{ color: itemMargin >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
                                    Маржа: {itemMargin >= 0 ? '+' : '-'}{fmtInt(Math.abs(itemMargin))} грн ({((itemMargin / it._costTotal) * 100).toFixed(0)}%)
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ flexShrink: 0 }}>
                              {product ? (
                                <div style={{
                                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                                  background: 'var(--green-bg)', borderRadius: 6, fontSize: 12, color: 'var(--green)',
                                }}>
                                  <i className="ti ti-check" style={{ fontSize: 13 }} />
                                  {product.current_stock} {product.unit} на складі
                                </div>
                              ) : autoMatch ? (
                                <button onClick={() => handleLinkProduct(it.id, autoMatch.id)} style={{
                                  background: 'var(--green-bg)', border: '1px solid var(--border)', borderRadius: 6,
                                  padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--green)',
                                  display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
                                }}>
                                  <i className="ti ti-sparkles" style={{ fontSize: 12 }} />
                                  Привʼязати ({autoMatch.current_stock} {autoMatch.unit})
                                </button>
                              ) : (
                                <button onClick={() => { setLinkingItemId(isLinking ? null : it.id); setProductSearch('') }} style={{
                                  background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                                  padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--blue)',
                                  display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
                                }}>
                                  <i className="ti ti-link" style={{ fontSize: 12 }} />
                                  Привʼязати
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Link search dropdown */}
                          {isLinking && (
                            <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                              <input
                                className="form-input"
                                style={{ height: 36, fontSize: 13, marginBottom: 6 }}
                                placeholder="Пошук товару на складі..."
                                value={productSearch}
                                onChange={e => setProductSearch(e.target.value)}
                                autoFocus
                              />
                              {searchResults.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                                  {searchResults.map(p => (
                                    <div key={p.id} onClick={() => handleLinkProduct(it.id, p.id)} style={{
                                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                                      border: '1px solid var(--border)', background: 'var(--surface)',
                                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    }}
                                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                                    >
                                      <span style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</span>
                                      <span style={{ fontSize: 12, color: p.current_stock > 0 ? 'var(--green)' : 'var(--red)' }}>
                                        {p.current_stock} {p.unit}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {productSearch.length >= 2 && searchResults.length === 0 && (
                                <div style={{ padding: 12, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Не знайдено</div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

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
                        <td className="trunc">{tx.counterparty}</td>
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

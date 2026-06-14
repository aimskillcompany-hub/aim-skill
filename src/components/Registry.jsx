import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import { extractDocumentMulti } from '../lib/ai'

const DIRS = ['Витрати','Доходи','ПФД','Внутрішні перекази','Відсотки банку','Інше']
const PER_PAGE = 50
const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(n))
const fmt2 = n => n != null ? new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n) : '—'

const DIR_TO_ARTICLE_TYPE = {
  'Витрати': 'expense', 'Доходи': 'income', 'ПФД': 'transfer',
  'Внутрішні перекази': 'transfer', 'Відсотки банку': 'income', 'Інше': 'other',
}

function ArticleSelect({ value, onChange, articles, direction, style }) {
  const relevantType = DIR_TO_ARTICLE_TYPE[direction]
  const grouped = groupByType(articles)
  const primary = relevantType ? (grouped[relevantType] || []) : []
  const others = articles.filter(a => a.type !== relevantType)
  return (
    <select className="form-input" value={value} onChange={onChange} style={style}>
      <option value="">— оберіть статтю —</option>
      {primary.length > 0 && (
        <optgroup label={`${TYPE_LABELS[relevantType] || ''} (рекомендовані)`}>
          {primary.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Інші статті">
          {others.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </optgroup>
      )}
    </select>
  )
}

const DIR_COLORS = {
  'Доходи': { bg: '#dcfce7', color: '#15803d' },
  'Витрати': { bg: '#fee2e2', color: '#b91c1c' },
  'ПФД': { bg: '#dbeafe', color: '#1d4ed8' },
  'Відсотки банку': { bg: '#fef9c3', color: '#854d0e' },
  'Внутрішні перекази': { bg: '#f3f4f6', color: '#6b7280' },
  'Інше': { bg: '#f3f4f6', color: '#6b7280' },
}

function DirBadge({ dir }) {
  const s = DIR_COLORS[dir] || DIR_COLORS['Інше']
  return <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>{dir}</span>
}

export default function Registry({ user }) {
  const [transactions, setTransactions] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [projects, setProjects] = useState([])
  const [selected, setSelected] = useState(null)
  const [selectedDocs, setSelectedDocs] = useState([])
  const [selectedItems, setSelectedItems] = useState([])
  const [edit, setEdit] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [articles, setArticles] = useState([])

  // Recover items
  const [showRecover, setShowRecover] = useState(false)
  const [recoverList, setRecoverList] = useState([])   // txs without items but with docs
  const [recoverLoading, setRecoverLoading] = useState(false)
  const [recoverSelected, setRecoverSelected] = useState(new Set())
  const [recoverProgress, setRecoverProgress] = useState({})  // txId -> status

  // Duplicate check
  const [dupChecking, setDupChecking] = useState(false)
  const [dupResults, setDupResults] = useState([])  // [{tx1, tx2, rule}]
  const [showDupModal, setShowDupModal] = useState(false)
  const [mergingSingle, setMergingSingle] = useState(null)

  // Multi-select
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [bulkForm, setBulkForm] = useState({ article: '', project_id: '', direction: '', contractor: '' })
  const [bulkSaving, setBulkSaving] = useState(false)

  const [sort, setSort] = useState({ col: 'date', dir: 'desc' })

  const [filters, setFilters] = useState({
    dateFrom: '', dateTo: '', direction: '', project: '',
    article: '', search: '', amountMin: '', amountMax: '',
    noArticle: false, docStatus: '',
  })

  // File preview
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    supabase.from('projects').select('id, name').order('name').then(({ data }) => setProjects(data || []))
    fetchArticles().then(setArticles)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    // Map col name to DB field
    const COL_MAP = { date:'date', contractor:'contractor', amount:'amount', direction:'direction', article:'article' }
    const dbCol = COL_MAP[sort.col] || 'date'

    let q = supabase.from('transactions')
      .select('*, projects(name), documents(id), bank_transactions(id, date, amount)', { count: 'exact' })
      .order(dbCol, { ascending: sort.dir === 'asc' })
      .range((page - 1) * PER_PAGE, page * PER_PAGE - 1)

    if (filters.dateFrom) q = q.gte('date', filters.dateFrom)
    if (filters.dateTo) q = q.lte('date', filters.dateTo)
    if (filters.direction) q = q.eq('direction', filters.direction)
    if (filters.project) q = q.eq('project_id', filters.project)
    if (filters.article) q = q.eq('article', filters.article)
    if (filters.noArticle) q = q.is('article', null)
    if (filters.amountMin) q = q.gte('amount', parseFloat(filters.amountMin))
    if (filters.amountMax) q = q.lte('amount', parseFloat(filters.amountMax))
    if (filters.search) q = q.or(`contractor.ilike.%${filters.search}%,description.ilike.%${filters.search}%,edrpou.ilike.%${filters.search}%,doc_number.ilike.%${filters.search}%`)

    const { data, count } = await q
    // Client-side filter by doc status
    let filtered = data || []
    if (filters.docStatus === 'has_doc') filtered = filtered.filter(t => t.documents?.length > 0)
    if (filters.docStatus === 'no_doc') filtered = filtered.filter(t => !t.documents?.length)
    if (filters.docStatus === 'has_bank') filtered = filtered.filter(t => t.bank_transactions?.length > 0)
    if (filters.docStatus === 'no_bank') filtered = filtered.filter(t => !t.bank_transactions?.length)
    if (filters.docStatus === 'full') filtered = filtered.filter(t => t.documents?.length > 0 && t.bank_transactions?.length > 0)
    if (filters.docStatus === 'empty') filtered = filtered.filter(t => !t.documents?.length && !t.bank_transactions?.length)

    setTransactions(filtered)
    setTotal(filters.docStatus ? filtered.length : (count || 0))
    setLoading(false)
    setCheckedIds(new Set())
  }, [page, filters, sort])

  useEffect(() => { load() }, [load])

  // ── Duplicate check ─────────────────────────────────────────────────────────
  const runDupCheck = async () => {
    setDupChecking(true)
    setDupResults([])

    const { data: txs } = await supabase
      .from('transactions')
      .select('id, date, contractor, edrpou, amount, direction, article, doc_type, doc_number, description, documents(id)')
      .order('date', { ascending: false })
      .limit(1000)

    const pairs = []
    const seen = new Set()

    for (let i = 0; i < (txs||[]).length; i++) {
      for (let j = i + 1; j < txs.length; j++) {
        const a = txs[i], b = txs[j]
        const key = [a.id, b.id].sort().join('-')
        if (seen.has(key)) continue

        // Правило 1: дата ±10 днів + сума ±10 грн
        const dA = new Date(a.date), dB = new Date(b.date)
        const dayDiff = Math.abs((dA - dB) / 86400000)
        const amtDiff = Math.abs(Math.abs(a.amount) - Math.abs(b.amount))

        if (dayDiff <= 10 && amtDiff <= 10 && Math.abs(a.amount) > 0) {
          seen.add(key)
          pairs.push({ tx1: a, tx2: b, rule: 1, dayDiff: Math.round(dayDiff), amtDiff: Math.round(amtDiff) })
          continue
        }

        // Правило 2: ЄДРПОУ збігається + сума ±1000 грн
        if (a.edrpou && b.edrpou && a.edrpou.trim() === b.edrpou.trim() && amtDiff <= 1000) {
          seen.add(key)
          pairs.push({ tx1: a, tx2: b, rule: 2, dayDiff: Math.round(dayDiff), amtDiff: Math.round(amtDiff) })
        }
      }
    }

    setDupResults(pairs)
    setShowDupModal(true)
    setDupChecking(false)
  }

  const handleMerge = async (keepId, removeId) => {
    setMergingSingle(`${keepId}-${removeId}`)
    // Move documents from removeId to keepId
    await supabase.from('documents').update({ transaction_id: keepId }).eq('transaction_id', removeId)
    await supabase.from('transaction_items').update({ transaction_id: keepId }).eq('transaction_id', removeId)
    // Delete the duplicate
    await supabase.from('transactions').delete().eq('id', removeId)
    // Remove from results
    setDupResults(prev => prev.filter(p => p.tx1.id !== keepId && p.tx1.id !== removeId && p.tx2.id !== keepId && p.tx2.id !== removeId))
    setMergingSingle(null)
    load()
  }

  const handleDeleteDup = async (deleteId, keepId) => {
    await supabase.from('transactions').delete().eq('id', deleteId)
    setDupResults(prev => prev.filter(p => p.tx1.id !== deleteId && p.tx2.id !== deleteId))
    load()
  }

  const dismissPair = (tx1id, tx2id) => {
    setDupResults(prev => prev.filter(p => !(p.tx1.id === tx1id && p.tx2.id === tx2id)))
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Recover items ────────────────────────────────────────────────────────────
  const loadRecoverList = async () => {
    setRecoverLoading(true)
    // Find transactions that have documents but no items
    const { data: txsWithDocs } = await supabase
      .from('transactions')
      .select('id, date, contractor, edrpou, amount, direction, doc_type, doc_number, documents(id, file_path, file_name, file_type)')
      .order('date', { ascending: false })

    const withDocs = (txsWithDocs || []).filter(t => t.documents?.length > 0)

    // Check which have no items
    const txIds = withDocs.map(t => t.id)
    const { data: itemRows } = await supabase
      .from('transaction_items')
      .select('transaction_id')
      .in('transaction_id', txIds)

    const withItems = new Set((itemRows || []).map(r => r.transaction_id))
    const noItems = withDocs.filter(t => !withItems.has(t.id))

    setRecoverList(noItems)
    setRecoverLoading(false)
  }

  const toggleRecoverSelect = (id) => {
    setRecoverSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleRecoverAll = () => {
    if (recoverSelected.size === recoverList.length) {
      setRecoverSelected(new Set())
    } else {
      setRecoverSelected(new Set(recoverList.map(t => t.id)))
    }
  }

  const runRecover = async () => {
    const toProcess = recoverList.filter(t => recoverSelected.has(t.id))
    for (const tx of toProcess) {
      setRecoverProgress(prev => ({ ...prev, [tx.id]: 'loading' }))
      try {
        // Get signed URLs for documents
        const files = []
        for (const doc of tx.documents) {
          const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 120)
          if (urlData?.signedUrl) {
            const res = await fetch(urlData.signedUrl)
            const blob = await res.blob()
            files.push(new File([blob], doc.file_name || 'doc', { type: doc.file_type || 'application/pdf' }))
          }
        }
        if (files.length === 0) {
          setRecoverProgress(prev => ({ ...prev, [tx.id]: 'error' }))
          continue
        }
        // Extract items
        const extracted = await extractDocumentMulti(files)
        const items = (extracted.items || []).filter(it => it.name)
        if (items.length > 0) {
          await supabase.from('transaction_items').insert(
            items.map(it => ({
              transaction_id: tx.id,
              name: it.name,
              quantity: parseFloat(it.quantity) || null,
              unit: it.unit || null,
              unit_price: parseFloat(it.unitPrice) || null,
              amount: parseFloat(it.amount) || 0,
              vat_rate: parseFloat(it.vatRate) || 20,
            }))
          )
          setRecoverProgress(prev => ({ ...prev, [tx.id]: `done:${items.length}` }))
        } else {
          setRecoverProgress(prev => ({ ...prev, [tx.id]: 'no_items' }))
        }
      } catch(e) {
        setRecoverProgress(prev => ({ ...prev, [tx.id]: 'error' }))
      }
    }
    // Reload list
    await loadRecoverList()
    setRecoverSelected(new Set())
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const openPreview = async (doc) => {
    setPreviewLoading(true)
    setPreviewDoc(doc)
    setPreviewUrl(null)
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 300)
    setPreviewUrl(data?.signedUrl || null)
    setPreviewLoading(false)
  }

  const setF = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1) }
  const clearFilters = () => { setFilters({ dateFrom:'',dateTo:'',direction:'',project:'',article:'',search:'',amountMin:'',amountMax:'',noArticle:false,docStatus:'' }); setPage(1) }
  const activeFilterCount = Object.values(filters).filter(v => v === true || (v !== false && Boolean(v))).length

  const openDetail = async (tx) => {
    setSelected(tx)
    const [{ data: docs }, { data: items }] = await Promise.all([
      supabase.from('documents').select('*').eq('transaction_id', tx.id),
      supabase.from('transaction_items').select('*').eq('transaction_id', tx.id),
    ])
    setSelectedDocs(docs || [])
    setSelectedItems(items || [])
  }

  const downloadDoc = async (doc) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Видалити операцію?')) return
    await supabase.from('transactions').delete().eq('id', id)
    setTransactions(prev => prev.filter(t => t.id !== id))
    setTotal(prev => prev - 1)
  }

  const openEdit = (tx) => {
    setEditForm({ id:tx.id,date:tx.date,contractor:tx.contractor,edrpou:tx.edrpou||'',amount:tx.amount,direction:tx.direction,article:tx.article||'',project_id:tx.project_id||'',description:tx.description||'',doc_type:tx.doc_type||'',doc_number:tx.doc_number||'' })
    setEdit(tx)
  }

  const handleUpdate = async () => {
    setEditSaving(true)
    await supabase.from('transactions').update({
      date: editForm.date, contractor: editForm.contractor, edrpou: editForm.edrpou||null,
      amount: parseFloat(editForm.amount), direction: editForm.direction, article: editForm.article||null,
      project_id: editForm.project_id||null, description: editForm.description||null,
      doc_type: editForm.doc_type||null, doc_number: editForm.doc_number||null,
    }).eq('id', editForm.id)
    setTransactions(prev => prev.map(t => t.id === editForm.id ? { ...t, ...editForm, amount: parseFloat(editForm.amount) } : t))
    setEdit(null)
    setEditSaving(false)
  }

  // ── Multi-select ─────────────────────────────────────────────────────────────
  const toggleCheck = (id, e) => {
    e.stopPropagation()
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (checkedIds.size === transactions.length) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(transactions.map(t => t.id)))
    }
  }

  const handleBulkSave = async () => {
    if (!bulkForm.article && !bulkForm.project_id && !bulkForm.direction && !bulkForm.contractor) return
    setBulkSaving(true)
    const update = {}
    if (bulkForm.article) update.article = bulkForm.article
    if (bulkForm.project_id) update.project_id = bulkForm.project_id
    if (bulkForm.direction) update.direction = bulkForm.direction
    if (bulkForm.contractor) update.contractor = bulkForm.contractor

    await supabase.from('transactions').update(update).in('id', [...checkedIds])
    setCheckedIds(new Set())
    setShowBulkEdit(false)
    setBulkForm({ article: '', project_id: '', direction: '', contractor: '' })
    setBulkSaving(false)
    load()
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const inc = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const exp = transactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0)
  const totalPages = Math.ceil(total / PER_PAGE)
  const allChecked = transactions.length > 0 && checkedIds.size === transactions.length
  const someChecked = checkedIds.size > 0

  const toggleSort = (col) => {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' }
    )
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sort.col !== col) return <i className="ti ti-selector" style={{ fontSize:11, opacity:.35, marginLeft:3 }} />
    return <i className={`ti ti-sort-${sort.dir === 'asc' ? 'ascending' : 'descending'}`} style={{ fontSize:11, color:'var(--blue)', marginLeft:3 }} />
  }

  const thStyle = (col) => ({
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  })

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768

  return (
    <div className="reg-page" style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div className="page-header">
        <h1>Реєстр операцій</h1>
        <p>{total} операцій у базі</p>
      </div>

      {/* Action buttons */}
      <div className="reg-actions" style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <button
          className="btn btn-secondary"
          onClick={() => { setShowRecover(true); loadRecoverList() }}
        >
          <i className="ti ti-packages" style={{ fontSize:15 }} />
          Відновити позиції
        </button>
        <button
          className="btn btn-secondary"
          onClick={dupResults.length > 0 ? () => setShowDupModal(true) : runDupCheck}
          disabled={dupChecking}
        >
          <i className={`ti ${dupChecking ? 'ti-loader-2' : 'ti-copy-check'}`} style={{ fontSize:15 }} />
          {dupChecking ? 'Перевіряємо...' : dupResults.length > 0 ? `Дублікати (${dupResults.length})` : 'Перевірити дублікати'}
        </button>
      </div>

      {/* Search — full width */}
      <div style={{ position:'relative', marginBottom:10 }}>
        <i className="ti ti-search" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:16 }} />
        <input
          className="form-input"
          style={{ width:'100%', paddingLeft:38 }}
          placeholder="Пошук по контрагенту, ЄДРПОУ, № документу..."
          value={filters.search}
          onChange={e => setF('search', e.target.value)}
        />
      </div>

      {/* Quick filters row */}
      <div className="reg-quick-filters" style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
        <button
          className={`btn btn-sm ${filters.noArticle ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setF('noArticle', !filters.noArticle)}
          style={{ flex:'1 1 calc(50% - 4px)', minWidth:0 }}
        >
          <i className="ti ti-tag-off" style={{ fontSize:14 }} />
          Без статті
        </button>
        <select
          className="form-input"
          style={{ flex:'1 1 calc(50% - 4px)', minWidth:0 }}
          value={filters.docStatus}
          onChange={e => setF('docStatus', e.target.value)}
        >
          <option value="">Всі статуси</option>
          <option value="full">Документ + Банк</option>
          <option value="has_doc">Є документ</option>
          <option value="no_doc">Без документу</option>
          <option value="has_bank">Є банк</option>
          <option value="no_bank">Без банку</option>
          <option value="empty">Нічого немає</option>
        </select>
        <button
          className={`btn btn-sm ${activeFilterCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setShowFilters(f => !f)}
          style={{ flex:'1 1 100%' }}
        >
          <i className="ti ti-adjustments-horizontal" style={{ fontSize:14 }} />
          Фільтри
          {activeFilterCount > 0 && <span style={{ background:'#fff', color:'#000', borderRadius:'50%', width:20, height:20, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, marginLeft:4 }}>{activeFilterCount}</span>}
        </button>
      </div>

      {/* Extended filters panel */}
      {showFilters && (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px', marginBottom:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10 }}>
            <div className="form-group">
              <label>Дата від</label>
              <input type="date" className="form-input" value={filters.dateFrom} onChange={e => setF('dateFrom', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Дата до</label>
              <input type="date" className="form-input" value={filters.dateTo} onChange={e => setF('dateTo', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Напрям</label>
              <select className="form-input" value={filters.direction} onChange={e => setF('direction', e.target.value)}>
                <option value="">Всі</option>
                {DIRS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Проєкт</label>
              <select className="form-input" value={filters.project} onChange={e => setF('project', e.target.value)}>
                <option value="">Всі</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Стаття</label>
              <ArticleSelect value={filters.article} onChange={e => setF('article', e.target.value)} articles={articles} direction={filters.direction} />
            </div>
            <div className="form-group">
              <label>Сума від, грн</label>
              <input type="number" className="form-input" placeholder="0" value={filters.amountMin} onChange={e => setF('amountMin', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Сума до, грн</label>
              <input type="number" className="form-input" placeholder="999 999 999" value={filters.amountMax} onChange={e => setF('amountMax', e.target.value)} />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop:10 }} onClick={clearFilters}>
              <i className="ti ti-x" style={{ marginRight:4 }} />Скинути всі фільтри
            </button>
          )}
        </div>
      )}

      {/* Summary stats card */}
      <div style={{
        background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12,
        padding:16, marginBottom:12
      }}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:10 }}>{total} операцій</div>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          {inc > 0 && (
            <div style={{ flex:'1 1 calc(50% - 6px)', minWidth:0 }}>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:2 }}>Прихід</div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--green)' }}>+{fmt(inc)} грн</div>
            </div>
          )}
          {exp < 0 && (
            <div style={{ flex:'1 1 calc(50% - 6px)', minWidth:0 }}>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:2 }}>Витрата</div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--red)' }}>-{fmt(Math.abs(exp))} грн</div>
            </div>
          )}
        </div>
        <div style={{ borderTop:'1px solid var(--border)', marginTop:10, paddingTop:10 }}>
          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:2 }}>Сальдо</div>
          <div style={{ fontSize:18, fontWeight:700, color: inc+exp >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {inc+exp >= 0 ? '+' : ''}{fmt(inc+exp)} грн
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {someChecked && (
        <div style={{
          display:'flex', alignItems:'center', gap:12, padding:'10px 16px',
          background:'#1a1d23', borderRadius:10, marginBottom:10,
          border:'1px solid var(--border)',
        }}>
          <span style={{ fontSize:13, fontWeight:600, color:'#f9fafb' }}>
            Обрано: {checkedIds.size}
          </span>
          <button
            className="btn btn-primary"
            style={{ fontSize:13, display:'flex', alignItems:'center', gap:6 }}
            onClick={() => setShowBulkEdit(true)}
          >
            <i className="ti ti-edit" style={{ fontSize:14 }} />
            Масове редагування
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize:13 }}
            onClick={() => setCheckedIds(new Set())}
          >
            Скасувати вибір
          </button>
        </div>
      )}

      {/* Desktop table */}
      <div className="reg-desktop-table" style={{ flex:1 }}>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ padding:'8px 6px', width:36 }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll}
                    style={{ width:15, height:15, cursor:'pointer', accentColor:'var(--text)' }} />
                </th>
                <th style={thStyle('date')} onClick={() => toggleSort('date')}>Дата<SortIcon col="date" /></th>
                <th style={thStyle('contractor')} onClick={() => toggleSort('contractor')}>Контрагент<SortIcon col="contractor" /></th>
                <th style={{ ...thStyle('amount'), textAlign:'right' }} onClick={() => toggleSort('amount')}>Сума, грн<SortIcon col="amount" /></th>
                <th style={thStyle('direction')} onClick={() => toggleSort('direction')}>Напрям<SortIcon col="direction" /></th>
                <th style={thStyle('article')} onClick={() => toggleSort('article')}>Стаття<SortIcon col="article" /></th>
                <th>Проєкт</th>
                <th style={{ textAlign:'center' }}>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'var(--text2)' }}>Завантаження...</td></tr>}
              {!loading && transactions.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:32, color:'var(--text3)' }}>Операцій не знайдено</td></tr>}
              {transactions.map(tx => {
                const isChecked = checkedIds.has(tx.id)
                const noArticle = !tx.article
                return (
                  <tr key={tx.id}
                    style={{ cursor:'pointer', background: isChecked ? '#F0FDF4' : noArticle ? '#FFFBEB' : '' }}
                    onClick={() => openDetail(tx)}
                  >
                    <td style={{ padding:'8px 6px' }} onClick={e => toggleCheck(tx.id, e)}>
                      <input type="checkbox" checked={isChecked} onChange={() => {}}
                        style={{ width:15, height:15, cursor:'pointer', accentColor:'var(--text)' }} />
                    </td>
                    <td style={{ color:'var(--text2)', fontSize:13, whiteSpace:'nowrap' }}>{tx.date}</td>
                    <td style={{ minWidth:250 }}>
                      <div style={{ fontSize:14, fontWeight:500, whiteSpace:'normal', wordBreak:'break-word', lineHeight:'1.3' }}>{tx.contractor}</div>
                      {tx.description && <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12, color:'#6B6B6B', marginTop:2, maxWidth:300 }}>{tx.description}</div>}
                    </td>
                    <td style={{ textAlign:'right', fontWeight:600, fontVariantNumeric:'tabular-nums', color: tx.amount > 0 ? 'var(--green)' : tx.amount < 0 ? 'var(--red)' : 'var(--text3)', whiteSpace:'nowrap' }}>
                      {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
                    </td>
                    <td><DirBadge dir={tx.direction} /></td>
                    <td style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:13, color: noArticle ? 'var(--amber)' : 'var(--text2)', maxWidth:150 }} title={tx.article}>
                      {noArticle ? <span style={{ display:'flex', alignItems:'center', gap:4 }}><i className="ti ti-tag-off" style={{ fontSize:13 }} />без статті</span> : tx.article}
                    </td>
                    <td style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:13, color:'var(--text2)', maxWidth:100 }}>{tx.projects?.name || '—'}</td>
                    <td style={{ textAlign:'center' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:13 }}>
                        {tx.documents?.length > 0 && <span>📄{tx.documents.length > 1 ? tx.documents.length : ''}</span>}
                        {tx.bank_transactions?.length > 0 && <span>🏦</span>}
                        {!tx.documents?.length && !tx.bank_transactions?.length && <span style={{ color:'var(--text3)' }}>—</span>}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4 }}>
                        <button style={{ background:'none', border:'1px solid var(--border)', borderRadius:8, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text2)' }}
                          onClick={() => openEdit(tx)} title="Редагувати"><i className="ti ti-pencil" style={{ fontSize:14 }} /></button>
                        <button style={{ background:'none', border:'1px solid #FCA5A5', borderRadius:8, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--red)' }}
                          onClick={() => handleDelete(tx.id)} title="Видалити"><i className="ti ti-trash" style={{ fontSize:14 }} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile card list */}
      <div className="reg-mobile-list">
        {loading && <div style={{ textAlign:'center', padding:24, color:'var(--text2)' }}>Завантаження...</div>}
        {!loading && transactions.length === 0 && <div style={{ textAlign:'center', padding:32, color:'var(--text3)' }}>Операцій не знайдено</div>}
        {!loading && transactions.map(tx => (
          <div key={tx.id}
            onClick={() => openDetail(tx)}
            style={{
              display:'flex', alignItems:'center', gap:12,
              padding:'14px 0', borderBottom:'1px solid var(--border)',
              cursor:'pointer', minHeight:64,
            }}
          >
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8, marginBottom:4 }}>
                <span style={{ fontSize:13, color:'var(--text2)' }}>{tx.date}</span>
                <span style={{ fontSize:15, fontWeight:700, fontVariantNumeric:'tabular-nums', color: tx.amount > 0 ? 'var(--green)' : tx.amount < 0 ? 'var(--red)' : 'var(--text3)', whiteSpace:'nowrap', flexShrink:0 }}>
                  {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)} <span style={{ fontSize:12, fontWeight:500 }}>грн</span>
                </span>
              </div>
              <div style={{ fontSize:14, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>{tx.contractor}</div>
              <DirBadge dir={tx.direction} />
            </div>
            <i className="ti ti-chevron-right" style={{ fontSize:16, color:'var(--text3)', flexShrink:0 }} />
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4, marginTop:16, flexWrap:'wrap' }}>
          <button className="pg-btn" disabled={page<=1} onClick={() => setPage(p=>p-1)} style={{ width:40, height:40, borderRadius:8, padding:0 }}>
            <i className="ti ti-chevron-left" style={{ fontSize:16 }} />
          </button>
          {(() => {
            const pages = []
            const maxShow = 5
            let start = Math.max(1, page - 2)
            let end = Math.min(totalPages, start + maxShow - 1)
            if (end - start < maxShow - 1) start = Math.max(1, end - maxShow + 1)
            for (let p = start; p <= end; p++) pages.push(p)
            return pages.map(p => (
              <button key={p} className={`pg-btn ${p===page?'active':''}`} onClick={() => setPage(p)}
                style={{ width:40, height:40, borderRadius:8, padding:0 }}>{p}</button>
            ))
          })()}
          <button className="pg-btn" disabled={page>=totalPages} onClick={() => setPage(p=>p+1)} style={{ width:40, height:40, borderRadius:8, padding:0 }}>
            <i className="ti ti-chevron-right" style={{ fontSize:16 }} />
          </button>
        </div>
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowBulkEdit(false)}>
          <div className="modal" style={{ maxWidth:480 }}>
            <div className="modal-header">
              <h2>Масове редагування — {checkedIds.size} операцій</h2>
              <button className="modal-close" onClick={() => setShowBulkEdit(false)}>×</button>
            </div>
            <p style={{ fontSize:13, color:'var(--text2)', marginBottom:16 }}>
              Заповніть тільки поля які хочете змінити. Порожні поля залишаться без змін.
            </p>
            <div className="form-grid">
              <div className="form-group full">
                <label>Назва контрагента</label>
                <input
                  className="form-input"
                  value={bulkForm.contractor}
                  onChange={e => setBulkForm(f => ({...f, contractor: e.target.value}))}
                  placeholder="Введіть нову назву контрагента"
                  style={{ height:48, borderRadius:8 }}
                />
              </div>
              <div className="form-group full">
                <label>Стаття</label>
                <ArticleSelect
                  value={bulkForm.article}
                  onChange={e => setBulkForm(f => ({...f, article: e.target.value}))}
                  articles={articles}
                  direction={bulkForm.direction}
                />
              </div>
              <div className="form-group">
                <label>Напрям</label>
                <select className="form-input" value={bulkForm.direction} onChange={e => setBulkForm(f => ({...f, direction: e.target.value}))}>
                  <option value="">— не змінювати —</option>
                  {DIRS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Проєкт</label>
                <select className="form-input" value={bulkForm.project_id} onChange={e => setBulkForm(f => ({...f, project_id: e.target.value}))}>
                  <option value="">— не змінювати —</option>
                  <option value="null">Без проєкту</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <p style={{ fontSize:13, color:'var(--text2)', marginTop:12 }}>
              Буде змінено <strong>{checkedIds.size}</strong> записів
            </p>
            <div className="btn-row">
              <button
                className="btn btn-primary"
                onClick={handleBulkSave}
                disabled={bulkSaving || (!bulkForm.article && !bulkForm.project_id && !bulkForm.direction && !bulkForm.contractor)}
              >
                {bulkSaving ? 'Збереження...' : `Зберегти для ${checkedIds.size} операцій`}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowBulkEdit(false)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setSelected(null)}>
          <div className="modal" style={{ maxWidth:680 }}>
            <div className="modal-header">
              <h2 style={{ fontSize:15 }}>{selected.contractor}</h2>
              <button className="modal-close" onClick={() => setSelected(null)}>×</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16, fontSize:13 }}>
              {[
                ['Дата', selected.date],
                ['Сума', (selected.amount>0?'+':'')+fmt(selected.amount)+' грн'],
                ['ПДВ', fmt(selected.vat_amount)+' грн'],
                ['Без ПДВ', fmt(selected.amount_no_vat)+' грн'],
                ['ЄДРПОУ', selected.edrpou],
                ['Тип документу', selected.doc_type],
                ['Номер', selected.doc_number],
                ['Напрям', selected.direction],
                ['Стаття', selected.article],
                ['Проєкт', selected.projects?.name],
                ['Призначення', selected.description],
              ].filter(([,v]) => v).map(([l,v]) => (
                <div key={l}><div style={{ fontSize:11, color:'var(--text3)', marginBottom:1 }}>{l}</div><div style={{ fontWeight:500 }}>{v}</div></div>
              ))}
            </div>
            {selectedItems.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-package" style={{ fontSize:15, color:'var(--blue)' }} />
                  Позиції ({selectedItems.length})
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ background:'var(--surface2)' }}>
                        {['Назва','К-сть','Од.','Ціна','Сума'].map(h => (
                          <th key={h} style={{ padding:'6px 8px', textAlign:'left', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.map(it => (
                        <tr key={it.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                          <td style={{ padding:'6px 8px' }}>{it.name}</td>
                          <td style={{ padding:'6px 8px', textAlign:'right' }}>{fmt2(it.quantity)}</td>
                          <td style={{ padding:'6px 8px' }}>{it.unit||'—'}</td>
                          <td style={{ padding:'6px 8px', textAlign:'right' }}>{fmt2(it.unit_price)}</td>
                          <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:500 }}>{fmt2(it.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                <i className="ti ti-paperclip" style={{ fontSize:15, color:'var(--blue)' }} />
                Файли ({selectedDocs.length})
              </div>
              {selectedDocs.length===0 && <p style={{ fontSize:12, color:'var(--text3)' }}>Немає прикріплених файлів</p>}
              {selectedDocs.map(doc => (
                <div key={doc.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                  <i className="ti ti-file-text" style={{ fontSize:20, color:'var(--blue)', flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:500 }}>{doc.file_name}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>{doc.doc_role==='incoming'?'Вхідний':'Вихідний'} · {(doc.file_size/1024).toFixed(0)} KB</div>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button className="btn btn-sm btn-secondary" style={{ display:'flex', alignItems:'center', gap:4 }} onClick={() => openPreview(doc)}>
                      <i className="ti ti-eye" style={{ fontSize:13 }} />Перегляд
                    </button>
                    <button className="btn btn-sm btn-secondary" style={{ display:'flex', alignItems:'center', gap:4 }} onClick={() => downloadDoc(doc)}>
                      <i className="ti ti-download" style={{ fontSize:13 }} />Завантажити
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {edit && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setEdit(null)}>
          <div className="modal">
            <div className="modal-header">
              <h2>Редагувати операцію</h2>
              <button className="modal-close" onClick={() => setEdit(null)}>×</button>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Дата</label><input type="date" className="form-input" value={editForm.date} onChange={e => setEditForm(f=>({...f,date:e.target.value}))}/></div>
              <div className="form-group"><label>Контрагент</label><input className="form-input" value={editForm.contractor} onChange={e => setEditForm(f=>({...f,contractor:e.target.value}))}/></div>
              <div className="form-group"><label>Сума (зі знаком)</label><input type="number" className="form-input" value={editForm.amount} onChange={e => setEditForm(f=>({...f,amount:e.target.value}))}/></div>
              <div className="form-group"><label>ЄДРПОУ</label><input className="form-input" value={editForm.edrpou} onChange={e => setEditForm(f=>({...f,edrpou:e.target.value}))}/></div>
              <div className="form-group"><label>Тип документу</label><input className="form-input" value={editForm.doc_type} onChange={e => setEditForm(f=>({...f,doc_type:e.target.value}))} placeholder="рахунок-фактура..."/></div>
              <div className="form-group"><label>Номер документу</label><input className="form-input" value={editForm.doc_number} onChange={e => setEditForm(f=>({...f,doc_number:e.target.value}))}/></div>
              <div className="form-group"><label>Напрям</label><select className="form-input" value={editForm.direction} onChange={e => setEditForm(f=>({...f,direction:e.target.value}))}>{DIRS.map(d=><option key={d}>{d}</option>)}</select></div>
              <div className="form-group"><label>Стаття</label><ArticleSelect value={editForm.article} onChange={e => setEditForm(f=>({...f,article:e.target.value}))} articles={articles} direction={editForm.direction} /></div>
              <div className="form-group"><label>Проєкт</label><select className="form-input" value={editForm.project_id} onChange={e => setEditForm(f=>({...f,project_id:e.target.value}))}><option value="">— без проєкту —</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="form-group full"><label>Призначення</label><textarea className="form-input" rows={2} value={editForm.description} onChange={e => setEditForm(f=>({...f,description:e.target.value}))}/></div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleUpdate} disabled={editSaving}>{editSaving?'Збереження...':'Зберегти'}</button>
              <button className="btn btn-secondary" onClick={() => setEdit(null)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
      {/* File preview modal */}
      {previewDoc && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setPreviewDoc(null)} style={{ zIndex:1100 }}>
          <div style={{
            background:'var(--surface)', borderRadius:12, padding:0,
            width:'90vw', maxWidth:900, maxHeight:'90vh',
            display:'flex', flexDirection:'column', overflow:'hidden',
          }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', borderBottom:'1px solid var(--border)' }}>
              <i className="ti ti-file-text" style={{ fontSize:20, color:'var(--blue)' }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{previewDoc.file_name}</div>
                <div style={{ fontSize:12, color:'var(--text3)' }}>{previewDoc.doc_role === 'incoming' ? 'Вхідний' : 'Вихідний'} · {previewDoc.file_size ? (previewDoc.file_size/1024).toFixed(0)+' KB' : ''}</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {previewUrl && (
                  <a href={previewUrl} download={previewDoc.file_name} className="btn btn-secondary btn-sm" style={{ display:'flex', alignItems:'center', gap:4, textDecoration:'none' }}>
                    <i className="ti ti-download" style={{ fontSize:13 }} />Завантажити
                  </a>
                )}
                <button className="modal-close" onClick={() => setPreviewDoc(null)}>×</button>
              </div>
            </div>
            {/* Content */}
            <div style={{ flex:1, overflow:'auto', padding:0, background:'#f3f4f6', display:'flex', alignItems:'center', justifyContent:'center', minHeight:400 }}>
              {previewLoading ? (
                <div style={{ textAlign:'center', color:'var(--text2)' }}>
                  <div className="spinner" style={{ margin:'0 auto 12px' }} />
                  Завантаження...
                </div>
              ) : previewUrl ? (
                previewDoc.file_type === 'application/pdf' ? (
                  <iframe src={previewUrl} style={{ width:'100%', height:'75vh', border:'none' }} title={previewDoc.file_name} />
                ) : (
                  <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth:'100%', maxHeight:'75vh', objectFit:'contain', display:'block' }} />
                )
              ) : (
                <div style={{ textAlign:'center', color:'var(--text3)', padding:40 }}>
                  <i className="ti ti-file-x" style={{ fontSize:48, display:'block', margin:'0 auto 12px' }} />
                  Не вдалось завантажити файл
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recover items modal */}
      {showRecover && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowRecover(false)}>
          <div className="modal" style={{ maxWidth:700, maxHeight:'85vh', overflow:'auto' }}>
            <div className="modal-header" style={{ position:'sticky', top:0, background:'var(--surface)', zIndex:1 }}>
              <div>
                <h2>Відновити позиції документів</h2>
                <p style={{ fontSize:13, color:'var(--text2)', marginTop:2 }}>
                  Транзакції з документами але без позицій товарів — оберіть які розпізнати
                </p>
              </div>
              <button className="modal-close" onClick={() => setShowRecover(false)}>×</button>
            </div>

            {recoverLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'var(--text2)' }}>
                <div className="spinner" style={{ margin:'0 auto 12px' }} />
                Завантаження...
              </div>
            ) : recoverList.length === 0 ? (
              <div style={{ textAlign:'center', padding:40, color:'var(--text3)' }}>
                <i className="ti ti-circle-check" style={{ fontSize:48, display:'block', margin:'0 auto 12px', color:'var(--green)' }} />
                <div style={{ fontSize:15, fontWeight:500 }}>Всі документи вже мають позиції</div>
              </div>
            ) : (
              <>
                <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
                    <input type="checkbox"
                      checked={recoverSelected.size === recoverList.length && recoverList.length > 0}
                      onChange={toggleRecoverAll}
                      style={{ width:15, height:15, accentColor:'var(--blue)' }}
                    />
                    Вибрати всі ({recoverList.length})
                  </label>
                  {recoverSelected.size > 0 && (
                    <button
                      className="btn btn-primary"
                      onClick={runRecover}
                      style={{ display:'flex', alignItems:'center', gap:6 }}
                    >
                      <i className="ti ti-sparkles" style={{ fontSize:14 }} />
                      Розпізнати обрані ({recoverSelected.size})
                    </button>
                  )}
                </div>

                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {recoverList.map(tx => {
                    const status = recoverProgress[tx.id]
                    const isSelected = recoverSelected.has(tx.id)
                    const isDone = status?.startsWith('done')
                    const isLoading = status === 'loading'
                    const isError = status === 'error'
                    const isNoItems = status === 'no_items'
                    const itemCount = isDone ? parseInt(status.split(':')[1]) : 0

                    return (
                      <div key={tx.id} style={{
                        display:'flex', alignItems:'center', gap:12,
                        background: isDone ? '#f0fdf4' : isError ? '#fef2f2' : isSelected ? 'var(--blue-bg)' : 'var(--surface2)',
                        border: `1px solid ${isDone ? '#86efac' : isError ? '#fca5a5' : isSelected ? 'var(--blue)' : 'var(--border)'}`,
                        borderRadius:8, padding:'10px 14px',
                        opacity: isDone ? .8 : 1,
                      }}>
                        <input type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRecoverSelect(tx.id)}
                          disabled={isDone || isLoading}
                          style={{ width:15, height:15, accentColor:'var(--blue)', flexShrink:0 }}
                        />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.contractor}</div>
                          <div style={{ fontSize:12, color:'var(--text2)', display:'flex', gap:10, marginTop:2 }}>
                            <span>{tx.date}</span>
                            <span style={{ fontWeight:600, color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                              {tx.amount >= 0 ? '+' : ''}{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(tx.amount)))} грн
                            </span>
                            {tx.doc_type && <span style={{ color:'var(--text3)' }}>{tx.doc_type}{tx.doc_number ? ` №${tx.doc_number}` : ''}</span>}
                          </div>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                          <span style={{ fontSize:11, color:'var(--text3)' }}>
                            <i className="ti ti-paperclip" style={{ marginRight:3 }} />{tx.documents?.length} файл(ів)
                          </span>
                          {isLoading && <span style={{ fontSize:11, color:'var(--blue)', display:'flex', alignItems:'center', gap:4 }}><div className="spinner" style={{ width:14, height:14 }} />Читаємо...</span>}
                          {isDone && <span style={{ fontSize:11, color:'var(--green)', fontWeight:600 }}>✓ {itemCount} позицій</span>}
                          {isError && <span style={{ fontSize:11, color:'var(--red)' }}>✗ Помилка</span>}
                          {isNoItems && <span style={{ fontSize:11, color:'var(--amber)' }}>— позицій не знайдено</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Duplicate check modal */}
      {showDupModal && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowDupModal(false)}>
          <div className="modal" style={{ maxWidth:820, maxHeight:'85vh', overflow:'auto', padding:24, borderRadius:20 }}>
            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
              <div>
                <h2 style={{ fontSize:20, fontWeight:700, color:'#000', marginBottom:4 }}>Перевірка дублікатів</h2>
                <p style={{ fontSize:13, color:'#6B6B6B' }}>
                  {dupResults.length > 0
                    ? `Знайдено ${dupResults.length} можливих пар — перевірте кожну`
                    : 'Дублікатів не знайдено'}
                </p>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
                <button
                  onClick={runDupCheck} disabled={dupChecking}
                  style={{ height:36, padding:'0 14px', border:'1px solid #E8E8E4', background:'#fff', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500, fontFamily:'Inter,sans-serif', color:'#000', display:'flex', alignItems:'center', gap:6 }}
                >
                  <i className="ti ti-refresh" style={{ fontSize:14 }} />
                  Оновити
                </button>
                <button
                  onClick={() => setShowDupModal(false)}
                  style={{ width:32, height:32, background:'#F0F0EC', border:'none', borderRadius:8, cursor:'pointer', fontSize:15, color:'#6B6B6B', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Inter,sans-serif', flexShrink:0 }}
                >X</button>
              </div>
            </div>

            {/* Rule pills */}
            <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
              {[
                { label: 'Правило 1: дата ±10 днів + сума ±10 грн', rule: 1 },
                { label: 'Правило 2: ЄДРПОУ + сума ±1000 грн', rule: 2 },
              ].map(r => {
                const active = dupResults.some(p => p.rule === r.rule)
                return (
                  <span key={r.rule} style={{
                    fontSize:12, fontWeight:500, padding:'6px 14px', borderRadius:20,
                    background: active ? '#000' : '#F0F0EC',
                    color: active ? '#fff' : '#6B6B6B',
                  }}>{r.label}</span>
                )
              })}
            </div>

            {/* Empty state */}
            {dupResults.length === 0 && (
              <div style={{ textAlign:'center', padding:'48px 0', color:'#9A9A9A' }}>
                <i className="ti ti-circle-check" style={{ fontSize:48, display:'block', margin:'0 auto 12px', color:'var(--green)' }} />
                <div style={{ fontSize:16, fontWeight:500 }}>Дублікатів не знайдено</div>
              </div>
            )}

            {/* Duplicate pairs */}
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {dupResults.map((pair, i) => {
                const isMerging = mergingSingle === `${pair.tx1.id}-${pair.tx2.id}` || mergingSingle === `${pair.tx2.id}-${pair.tx1.id}`
                return (
                  <div key={i} style={{ border:'1px solid #E8E8E4', borderRadius:16, padding:16, background:'#FAFAF8' }}>
                    {/* Rule label + dismiss */}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                      <span style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:.5, color:'#6B6B6B' }}>
                        Правило {pair.rule} · різниця {pair.amtDiff} грн{pair.rule === 1 ? ` · ${pair.dayDiff} днів` : ''}
                      </span>
                      <button onClick={() => dismissPair(pair.tx1.id, pair.tx2.id)}
                        style={{ width:28, height:28, background:'#F0F0EC', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, color:'#6B6B6B', display:'flex', alignItems:'center', justifyContent:'center' }}
                        title="Не дублікат">X</button>
                    </div>

                    {/* Two entries grid */}
                    <div className="dup-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                      {[pair.tx1, pair.tx2].map((tx, ti) => (
                        <div key={tx.id} style={{
                          background:'#FFFFFF', border:'1px solid #E8E8E4', borderRadius:12, padding:16,
                          display:'flex', flexDirection:'column', height:'100%',
                        }}>
                          {/* Content area — flex:1 to push buttons down */}
                          <div style={{ flex:1 }}>
                            {/* Company name */}
                            <div style={{ fontSize:14, fontWeight:600, color:'#000', marginBottom:8 }}>{tx.contractor}</div>

                            {/* Date + Amount + Badge */}
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:6 }}>
                              <span style={{ fontSize:13, color:'#6B6B6B' }}>{tx.date}</span>
                              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <span style={{ fontSize:14, fontWeight:700, color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                  {tx.amount >= 0 ? '+' : ''}{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(tx.amount)))} грн
                                </span>
                                {tx.direction && (
                                  <span style={{
                                    fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:6,
                                    background: tx.direction==='Доходи' ? '#DCFCE7' : tx.direction==='Витрати' ? '#FFE4E4' : '#F0F0EC',
                                    color: tx.direction==='Доходи' ? '#16A34A' : tx.direction==='Витрати' ? '#DC2626' : '#6B6B6B',
                                  }}>{tx.direction}</span>
                                )}
                              </div>
                            </div>

                            {/* Details */}
                            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                              {tx.edrpou && <div style={{ fontSize:12, color:'#6B6B6B' }}>ЄДРПОУ: {tx.edrpou}</div>}
                              {(tx.doc_type || tx.doc_number) && <div style={{ fontSize:12, color:'#6B6B6B' }}>Документ: {tx.doc_type}{tx.doc_number ? ` №${tx.doc_number}` : ''}</div>}
                              {tx.article && <div style={{ fontSize:12, color:'#6B6B6B' }}>Стаття: {tx.article}</div>}
                              {tx.description && (
                                <div style={{ fontSize:12, color:'#6B6B6B', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', lineHeight:'1.4' }}>
                                  Опис: {tx.description}
                                </div>
                              )}
                              <div style={{ fontSize:12, color:'#6B6B6B' }}>Документів: {tx.documents?.length || 0}</div>
                            </div>
                          </div>

                          {/* Action buttons — pinned to bottom */}
                          <div style={{ display:'flex', gap:8, marginTop:14 }}>
                            <button
                              disabled={isMerging}
                              onClick={() => handleMerge(tx.id, ti === 0 ? pair.tx2.id : pair.tx1.id)}
                              style={{
                                flex:1, height:36, border:'none', borderRadius:8, cursor:'pointer',
                                background:'#000', color:'#fff', fontSize:13, fontWeight:600,
                                fontFamily:'Inter,sans-serif', opacity: isMerging ? .5 : 1,
                              }}
                            >Залишити цю</button>
                            <button
                              disabled={isMerging}
                              onClick={() => handleDeleteDup(tx.id, ti === 0 ? pair.tx2.id : pair.tx1.id)}
                              style={{
                                flex:1, height:36, border:'none', borderRadius:8, cursor:'pointer',
                                background:'#FFE4E4', color:'#DC2626', fontSize:13, fontWeight:600,
                                fontFamily:'Inter,sans-serif', opacity: isMerging ? .5 : 1,
                              }}
                            >Видалити</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {isMerging && (
                      <div style={{ textAlign:'center', padding:'8px 0', fontSize:13, color:'#6B6B6B', marginTop:8 }}>
                        Обʼєднуємо...
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

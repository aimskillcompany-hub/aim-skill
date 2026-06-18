import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import { extractDocumentMulti } from '../lib/ai'
import Badge from './ui/Badge'
import ContractorSelect from './ui/ContractorSelect'

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


export default function Registry({ user }) {
  const [transactions, setTransactions] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [allTxsData, setAllTxsData] = useState([])
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

  // Додати товар до операції
  const [addItemMode, setAddItemMode] = useState(false)
  const [addItemSearch, setAddItemSearch] = useState('')
  const [addItemProduct, setAddItemProduct] = useState(null)
  const [addItemQty, setAddItemQty] = useState('')
  const [addItemPrice, setAddItemPrice] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [manualItemMode, setManualItemMode] = useState(false)
  const [manualItem, setManualItem] = useState({ name:'', quantity:'1', unit:'шт', unit_price:'', vat_rate:'20' })
  const [pricesIncludeVat, setPricesIncludeVat] = useState(false)
  const [allProducts, setAllProducts] = useState([])
  const addItemResults = addItemSearch.length >= 2
    ? allProducts.filter(p => p.name.toLowerCase().includes(addItemSearch.toLowerCase())).slice(0, 8)
    : []

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

  // Quick new project
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectSaving, setNewProjectSaving] = useState(false)

  const UA_MONTHS = ['січень','лютий','березень','квітень','травень','червень','липень','серпень','вересень','жовтень','листопад','грудень']

  const handleCreateProject = async () => {
    // Беремо контрагента і дату з операції що редагується
    const contractor = editForm.contractor || edit?.counterparty || ''
    const txDate = edit?.date || new Date().toISOString().split('T')[0]
    if (!contractor) return

    setNewProjectSaving(true)
    // Генеруємо назву як в Projects.jsx
    const { count } = await supabase.from('projects').select('*', { count: 'exact', head: true })
    const seqNum = (count || 0) + 1
    const num = String(seqNum).padStart(3, '0')
    const short = contractor.replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/gi, '').replace(/ФІЗИЧНА ОСОБА[-\s]ПІДПРИЄМЕЦЬ/gi, '').replace(/^(ТОВ|ФОП|АТ|ПП)\s+/gi, '').replace(/[«»"']/g, '').trim().substring(0, 25).trim()
    const d = new Date(txDate)
    const month = UA_MONTHS[d.getMonth()]
    const year = d.getFullYear()
    const projectName = `#${num} / ${short} / ${month} ${year}`

    const { data, error } = await supabase.from('projects').insert({
      name: projectName,
      status: 'active',
      contractor: contractor,
      start_date: txDate,
      created_by: user?.id,
    }).select('id').single()

    if (!error && data) {
      const { data: allProjects } = await supabase.from('projects').select('id, name').order('name')
      setProjects(allProjects || [])
      setEditForm(f => ({ ...f, project_id: data.id }))
    }
    setNewProjectSaving(false)
    setShowNewProject(false)
  }

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
    supabase.from('product_stock').select('id, name, computed_stock, unit, product_type').eq('status', 'active').order('name').then(({ data }) => setAllProducts(data || []))
    fetchArticles().then(setArticles)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    // Map col name to DB field
    const COL_MAP = { date:'date', counterparty:'counterparty', amount:'amount', direction:'direction', article:'article' }
    const dbCol = COL_MAP[sort.col] || 'date'

    let q = supabase.from('bank_transactions')
      .select('*, documents(id), transaction_items(id)', { count: 'exact' })
      .eq('is_ignored', false)
      .order(dbCol, { ascending: sort.dir === 'asc' })
      .range((page - 1) * PER_PAGE, page * PER_PAGE - 1)

    if (filters.dateFrom) q = q.gte('date', filters.dateFrom)
    if (filters.dateTo) q = q.lte('date', filters.dateTo)
    if (filters.direction) q = q.eq('direction', filters.direction)
    if (filters.article) q = q.eq('article', filters.article)
    if (filters.noArticle) q = q.is('article', null)
    if (filters.amountMin) q = q.gte('amount', parseFloat(filters.amountMin))
    if (filters.amountMax) q = q.lte('amount', parseFloat(filters.amountMax))
    if (filters.search) q = q.or(`counterparty.ilike.%${filters.search}%,description.ilike.%${filters.search}%`)

    // Паралельно: дані сторінки + загальні суми (без пагінації)
    let qTotals = supabase.from('bank_transactions')
      .select('amount, direction').eq('is_ignored', false)
    if (filters.dateFrom) qTotals = qTotals.gte('date', filters.dateFrom)
    if (filters.dateTo) qTotals = qTotals.lte('date', filters.dateTo)
    if (filters.direction) qTotals = qTotals.eq('direction', filters.direction)
    if (filters.article) qTotals = qTotals.eq('article', filters.article)
    if (filters.noArticle) qTotals = qTotals.is('article', null)
    if (filters.amountMin) qTotals = qTotals.gte('amount', parseFloat(filters.amountMin))
    if (filters.amountMax) qTotals = qTotals.lte('amount', parseFloat(filters.amountMax))
    if (filters.search) qTotals = qTotals.or(`counterparty.ilike.%${filters.search}%,description.ilike.%${filters.search}%`)

    const [{ data, count }, { data: allTxsResult }] = await Promise.all([q, qTotals])
    setAllTxsData(allTxsResult || [])

    // Client-side filter by doc status
    let filtered = data || []
    if (filters.docStatus === 'has_doc') filtered = filtered.filter(t => t.documents?.length > 0)
    if (filters.docStatus === 'no_doc') filtered = filtered.filter(t => !t.documents?.length)

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
      .from('bank_transactions')
      .select('id, date, counterparty, amount, direction, article, description, documents(id)')
      .eq('is_ignored', false)
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

        // Правило 2: counterparty збігається + сума ±1000 грн
        if (a.counterparty && b.counterparty && a.counterparty.trim() === b.counterparty.trim() && amtDiff <= 1000) {
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
    await supabase.from('documents').update({ bank_transaction_id: keepId }).eq('bank_transaction_id', removeId)
    await supabase.from('transaction_items').update({ bank_transaction_id: keepId }).eq('bank_transaction_id', removeId)
    // Ignore the duplicate
    await supabase.from('bank_transactions').update({ is_ignored: true }).eq('id', removeId)
    // Remove from results
    setDupResults(prev => prev.filter(p => p.tx1.id !== keepId && p.tx1.id !== removeId && p.tx2.id !== keepId && p.tx2.id !== removeId))
    setMergingSingle(null)
    load()
  }

  const handleDeleteDup = async (deleteId, keepId) => {
    await supabase.from('bank_transactions').update({ is_ignored: true }).eq('id', deleteId)
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
      .from('bank_transactions')
      .select('id, date, counterparty, amount, direction, documents(id, file_path, file_name, file_type)')
      .eq('is_ignored', false)
      .order('date', { ascending: false })

    const withDocs = (txsWithDocs || []).filter(t => t.documents?.length > 0)

    // Check which have no items
    const txIds = withDocs.map(t => t.id)
    const { data: itemRows } = await supabase
      .from('transaction_items')
      .select('bank_transaction_id')
      .in('bank_transaction_id', txIds)

    const withItems = new Set((itemRows || []).map(r => r.bank_transaction_id))
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
        const extracted = await extractDocumentMulti(files, articles)
        const items = (extracted.items || []).filter(it => it.name)
        if (items.length > 0) {
          await supabase.from('transaction_items').insert(
            items.map(it => ({
              bank_transaction_id: tx.id,
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

  const [projectInfo, setProjectInfo] = useState({}) // projectId → { count, total, lastItems[] }
  const [itemProjectHints, setItemProjectHints] = useState({}) // itemName → projectId (де цей товар вже був)

  const [itemMovements, setItemMovements] = useState({}) // item.id → stock_movement

  const openDetail = async (tx) => {
    setSelected(tx)
    const [{ data: docs }, { data: items }, { data: allItems }] = await Promise.all([
      supabase.from('documents').select('*').eq('bank_transaction_id', tx.id),
      supabase.from('transaction_items').select('*').eq('bank_transaction_id', tx.id),
      supabase.from('transaction_items').select('name, amount, project_id').not('project_id', 'is', null),
    ])
    setSelectedDocs(docs || [])
    setSelectedItems(items || [])

    // Завантажити stock_movements для кожного item
    const itemIds = (items || []).map(i => i.id).filter(Boolean)
    if (itemIds.length > 0) {
      const { data: movs } = await supabase.from('stock_movements')
        .select('id, transaction_item_id, type, quantity, price, date, product_id')
        .in('transaction_item_id', itemIds)
      const movMap = {}
      ;(movs || []).forEach(m => { if (m.transaction_item_id) movMap[m.transaction_item_id] = m })
      setItemMovements(movMap)
    } else {
      setItemMovements({})
    }

    // Build project info: count, total, last items
    const pInfo = {}
    ;(allItems || []).forEach(it => {
      if (!pInfo[it.project_id]) pInfo[it.project_id] = { count:0, total:0, items: new Set() }
      pInfo[it.project_id].count++
      pInfo[it.project_id].total += Math.abs(it.amount || 0)
      if (pInfo[it.project_id].items.size < 3) pInfo[it.project_id].items.add(it.name?.substring(0, 30))
    })
    setProjectInfo(pInfo)

    // Build hints: if same item name exists in a project → suggest it
    const hints = {}
    ;(items || []).forEach(item => {
      if (!item.name) return
      const nameLower = item.name.trim().toLowerCase()
      const match = (allItems || []).find(a => a.name?.trim().toLowerCase() === nameLower && a.project_id)
      if (match) hints[item.id] = match.project_id
    })
    setItemProjectHints(hints)
  }

  const downloadDoc = async (doc) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Видалити операцію?')) return
    await supabase.from('bank_transactions').update({ is_ignored: true }).eq('id', id)
    setTransactions(prev => prev.filter(t => t.id !== id))
    setTotal(prev => prev - 1)
  }

  const openEdit = (tx) => {
    setEditForm({ id:tx.id,contractor:tx.counterparty,direction:tx.direction,article:tx.article||'',project_id:tx.project_id||'',description:tx.description||'' })
    setEdit(tx)
  }

  const handleUpdate = async () => {
    setEditSaving(true)
    await supabase.from('bank_transactions').update({
      direction: editForm.direction,
      article: editForm.article || null,
      project_id: editForm.project_id || null,
      description: editForm.description || null,
      counterparty: editForm.contractor,
    }).eq('id', editForm.id)
    setEdit(null)
    setEditSaving(false)
    load()
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
    if (bulkForm.contractor) {
      update.counterparty = bulkForm.contractor
      if (bulkForm._contractorId) update.contractor_id = bulkForm._contractorId
      if (bulkForm._edrpou) update.edrpou = bulkForm._edrpou
    }

    await supabase.from('bank_transactions').update(update).in('id', [...checkedIds])
    setCheckedIds(new Set())
    setShowBulkEdit(false)
    setBulkForm({ article: '', project_id: '', direction: '', contractor: '' })
    setBulkSaving(false)
    load()
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const inc = (allTxsData || []).filter(t => t.direction === 'Доходи').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const exp = (allTxsData || []).filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const bankBalance = (allTxsData || []).reduce((s, t) => s + (t.amount || 0), 0)
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
          placeholder="Пошук по контрагенту, опису..."
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
          <option value="has_doc">Є документ</option>
          <option value="no_doc">Без документу</option>
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
              <div style={{ fontSize:16, fontWeight:500, color:'var(--green)' }}>+{fmt(inc)} грн</div>
            </div>
          )}
          {exp > 0 && (
            <div style={{ flex:'1 1 calc(50% - 6px)', minWidth:0 }}>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:2 }}>Витрата</div>
              <div style={{ fontSize:16, fontWeight:500, color:'var(--red)' }}>-{fmt(exp)} грн</div>
            </div>
          )}
        </div>
        <div style={{ display:'flex', gap:12, borderTop:'1px solid var(--border)', marginTop:10, paddingTop:10, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:2 }}>Сальдо (доходи − витрати)</div>
            <div style={{ fontSize:18, fontWeight:500, color: inc-exp >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {inc-exp >= 0 ? '+' : ''}{fmt(inc-exp)} грн
            </div>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:2 }}>Банківський баланс (всі операції)</div>
            <div style={{ fontSize:18, fontWeight:500, color: bankBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {bankBalance >= 0 ? '+' : ''}{fmt(bankBalance)} грн
            </div>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {someChecked && (
        <div style={{
          display:'flex', alignItems:'center', gap:12, padding:'10px 16px',
          background:'var(--surface2)', borderRadius:12, marginBottom:10,
          border:'1px solid var(--border)',
        }}>
          <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>
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
                <th style={thStyle('counterparty')} onClick={() => toggleSort('counterparty')}>Контрагент<SortIcon col="counterparty" /></th>
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
                    style={{ cursor:'pointer', background: isChecked ? 'var(--green-bg)' : noArticle ? 'var(--surface2)' : '' }}
                    onClick={() => openDetail(tx)}
                  >
                    <td style={{ padding:'8px 6px' }} onClick={e => toggleCheck(tx.id, e)}>
                      <input type="checkbox" checked={isChecked} onChange={() => {}}
                        style={{ width:15, height:15, cursor:'pointer', accentColor:'var(--text)' }} />
                    </td>
                    <td style={{ color:'var(--text2)', fontSize:13, whiteSpace:'nowrap' }}>{tx.date}</td>
                    <td style={{ minWidth:250 }}>
                      <div style={{ fontSize:14, fontWeight:500, whiteSpace:'normal', wordBreak:'break-word', lineHeight:'1.3' }}>{tx.counterparty}</div>
                      {tx.description && <div style={{ fontSize:12, color:'var(--text2)', marginTop:2, whiteSpace:'normal', wordBreak:'break-word', lineHeight:'1.4' }}>{tx.description}</div>}
                    </td>
                    <td style={{ textAlign:'right', fontWeight:500, fontVariantNumeric:'tabular-nums', color: tx.direction === 'Доходи' ? 'var(--green)' : tx.direction === 'Витрати' ? 'var(--red)' : 'var(--text3)', whiteSpace:'nowrap' }}>
                      {tx.direction === 'Доходи' ? '+' : tx.direction === 'Витрати' ? '-' : ''}{fmt(Math.abs(tx.amount))}
                    </td>
                    <td><Badge type={tx.direction} /></td>
                    <td style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:13, color: noArticle ? 'var(--amber)' : 'var(--text2)', maxWidth:150 }} title={tx.article}>
                      {noArticle ? <span style={{ display:'flex', alignItems:'center', gap:4 }}><i className="ti ti-tag-off" style={{ fontSize:13 }} />без статті</span> : tx.article}
                    </td>
                    <td style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:13, color:'var(--text2)', maxWidth:100 }}>{tx.project_id ? (projects.find(p=>p.id===tx.project_id)?.name || '—') : '—'}</td>
                    <td style={{ textAlign:'center' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:13 }}>
                        {tx.is_verified && <i className="ti ti-circle-check-filled" style={{ fontSize:14, color:'var(--green)' }} title="Верифіковано" />}
                        {tx.documents?.length > 0 && <span>📄{tx.documents.length > 1 ? tx.documents.length : ''}</span>}
                        {tx.transaction_items?.length > 0 && <span>📦</span>}
                        {!tx.documents?.length && !tx.transaction_items?.length && !tx.is_verified && <span style={{ color:'var(--text3)' }}>—</span>}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4 }}>
                        <button style={{ background:'none', border: tx.is_verified ? '1px solid var(--green)' : '1px solid var(--border)', borderRadius:8, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color: tx.is_verified ? 'var(--green)' : 'var(--text3)' }}
                          onClick={async () => {
                            const newVal = !tx.is_verified
                            await supabase.from('bank_transactions').update({ is_verified: newVal }).eq('id', tx.id)
                            setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, is_verified: newVal } : t))
                          }} title={tx.is_verified ? 'Зняти верифікацію' : 'Верифікувати'}>
                          <i className={`ti ${tx.is_verified ? 'ti-circle-check-filled' : 'ti-circle-check'}`} style={{ fontSize:14 }} />
                        </button>
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
                <span style={{ fontSize:15, fontWeight:500, fontVariantNumeric:'tabular-nums', color: tx.direction === 'Доходи' ? 'var(--green)' : tx.direction === 'Витрати' ? 'var(--red)' : 'var(--text3)', whiteSpace:'nowrap', flexShrink:0 }}>
                  {tx.direction === 'Доходи' ? '+' : tx.direction === 'Витрати' ? '-' : ''}{fmt(Math.abs(tx.amount))} <span style={{ fontSize:12, fontWeight:500 }}>грн</span>
                </span>
              </div>
              <div style={{ fontSize:14, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>{tx.counterparty}</div>
              <Badge type={tx.direction} />
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
          <div className="modal">
            <div className="modal-header">
              <h2>Масове редагування — {checkedIds.size} операцій</h2>
              <button className="modal-close" onClick={() => setShowBulkEdit(false)}>×</button>
            </div>
            <p style={{ fontSize:13, color:'var(--text2)', marginBottom:16 }}>
              Заповніть тільки поля які хочете змінити. Порожні поля залишаться без змін.
            </p>
            <div className="form-grid">
              <div className="form-group full">
                <label>Контрагент</label>
                <ContractorSelect
                  value={bulkForm.contractor}
                  onChange={v => setBulkForm(f => ({...f, contractor: v}))}
                  onContractorSelect={c => {
                    if (c._new) return
                    setBulkForm(f => ({...f, contractor: c.name, _contractorId: c.id, _edrpou: c.edrpou}))
                  }}
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
              <button className="btn btn-secondary" style={{ display:'flex', alignItems:'center', gap:4 }}
                onClick={async () => {
                  setBulkSaving(true)
                  const ids = [...checkedIds]
                  for (let i = 0; i < ids.length; i += 50) {
                    await supabase.from('bank_transactions').update({ is_verified: true }).in('id', ids.slice(i, i + 50))
                  }
                  setTransactions(prev => prev.map(t => checkedIds.has(t.id) ? { ...t, is_verified: true } : t))
                  setBulkSaving(false); setCheckedIds(new Set()); setShowBulkEdit(false)
                }} disabled={bulkSaving}>
                <i className="ti ti-circle-check" style={{ fontSize:14 }} /> Верифікувати всі
              </button>
              <button className="btn btn-secondary" onClick={() => setShowBulkEdit(false)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setSelected(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2 style={{ fontSize:15 }}>{selected.counterparty}</h2>
              <button className="modal-close" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="modal-detail-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16, fontSize:13 }}>
              {(() => {
                const bankAbs = Math.abs(selected.amount || 0)
                const hasItems = selectedItems.length > 0
                // ПДВ рахуємо з позицій — кожна знає свою ставку
                const itemsNet = selectedItems.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0)
                const itemsVat = selectedItems.reduce((s, it) => {
                  const amt = parseFloat(it.amount) || 0
                  const rate = parseFloat(it.vat_rate) ?? 20
                  return s + amt * rate / 100
                }, 0)
                return [
                  ['Дата', selected.date],
                  ['Сума (банк)', (selected.direction === 'Доходи' ? '+' : selected.direction === 'Витрати' ? '-' : '') + fmt(bankAbs) + ' грн'],
                  hasItems ? ['Без ПДВ (з позицій)', fmt(itemsNet) + ' грн'] : null,
                  hasItems ? ['ПДВ (з позицій)', fmt(itemsVat) + ' грн'] : null,
                  ['Напрям', selected.direction],
                  ['Стаття', selected.article],
                  ['Призначення', selected.description],
                ].filter(Boolean).filter(([,v]) => v).map(([l,v]) => (
                  <div key={l}><div style={{ fontSize:11, color:'var(--text3)', marginBottom:1 }}>{l}</div><div style={{ fontWeight:500 }}>{v}</div></div>
                ))
              })()}
            </div>
            {selectedItems.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-package" style={{ fontSize:15, color:'var(--blue)' }} />
                  Позиції ({selectedItems.length})
                  <span style={{ fontSize:11, fontWeight:400, color:'var(--text3)', marginLeft:8 }}>Складський статус</span>
                  <button style={{
                    marginLeft:'auto', fontSize:11, padding:'3px 10px', borderRadius:6, cursor:'pointer', fontFamily:'inherit',
                    background: pricesIncludeVat ? 'var(--amber-bg)' : 'var(--surface2)',
                    color: pricesIncludeVat ? 'var(--amber)' : 'var(--text3)',
                    border: '1px solid var(--border)',
                  }} onClick={async () => {
                    const newVal = !pricesIncludeVat
                    setPricesIncludeVat(newVal)
                    if (newVal) {
                      // Перерахувати: ціни з ПДВ → без ПДВ
                      for (const it of selectedItems) {
                        const rate = parseFloat(it.vat_rate) || 20
                        const netPrice = (parseFloat(it.unit_price) || 0) / (1 + rate / 100)
                        const netAmount = netPrice * (parseFloat(it.quantity) || 1)
                        await supabase.from('transaction_items').update({ unit_price: Math.round(netPrice * 100) / 100, amount: Math.round(netAmount * 100) / 100 }).eq('id', it.id)
                      }
                      openDetail(selected)
                    }
                  }}>
                    {pricesIncludeVat ? '✓ Ціни з ПДВ → перераховано' : 'Ціни включають ПДВ?'}
                  </button>
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ background:'var(--surface2)' }}>
                        {['Назва','К-сть','Ціна','ПДВ%','Сума','Склад',''].map(h => (
                          <th key={h} style={{ padding:'6px 8px', textAlign: h==='К-сть'||h==='Ціна'||h==='Сума' ? 'right' : 'left', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.map(it => (
                        <tr key={it.id} style={{ borderBottom:'1px solid var(--bg)' }}>
                          <td style={{ padding:'6px 8px', maxWidth:200 }}>{it.name}</td>
                          <td style={{ padding:'6px 8px', whiteSpace:'nowrap', textAlign:'right' }}>{fmt2(it.quantity)} {it.unit||'шт'}</td>
                          <td style={{ padding:'4px 6px', textAlign:'right' }}>
                            <input type="number" style={{ width:80, border:'1px solid var(--border)', borderRadius:4, padding:'2px 6px', fontSize:12, textAlign:'right', fontFamily:'inherit' }}
                              defaultValue={it.unit_price ?? ''} onBlur={async (e) => {
                                const val = parseFloat(e.target.value) || 0
                                const qty = parseFloat(it.quantity) || 1
                                const newAmount = val * qty
                                await supabase.from('transaction_items').update({ unit_price: val, amount: newAmount }).eq('id', it.id)
                                setSelectedItems(prev => prev.map(item => item.id === it.id ? { ...item, unit_price: val, amount: newAmount } : item))
                              }} key={`price-${it.id}-${it.amount}`} />
                          </td>
                          <td style={{ padding:'6px 8px' }}>
                            <select style={{ border:'1px solid var(--border)', borderRadius:4, padding:'1px 4px', fontSize:11, fontFamily:'inherit', width:55 }}
                              value={it.vat_rate ?? 20}
                              onChange={async (e) => {
                                const rate = parseFloat(e.target.value)
                                await supabase.from('transaction_items').update({ vat_rate: rate }).eq('id', it.id)
                                setSelectedItems(prev => prev.map(item => item.id === it.id ? { ...item, vat_rate: rate } : item))
                              }}>
                              <option value={20}>20%</option>
                              <option value={7}>7%</option>
                              <option value={0}>0%</option>
                            </select>
                          </td>
                          <td style={{ padding:'4px 6px', textAlign:'right' }}>
                            <input type="number" style={{ width:90, border:'1px solid var(--border)', borderRadius:4, padding:'2px 6px', fontSize:12, textAlign:'right', fontFamily:'inherit', fontWeight:500 }}
                              defaultValue={it.amount ?? ''} onBlur={async (e) => {
                                const val = parseFloat(e.target.value) || 0
                                const qty = parseFloat(it.quantity) || 1
                                const newPrice = qty > 0 ? val / qty : val
                                await supabase.from('transaction_items').update({ amount: val, unit_price: newPrice }).eq('id', it.id)
                                setSelectedItems(prev => prev.map(item => item.id === it.id ? { ...item, amount: val, unit_price: newPrice } : item))
                              }} key={`amount-${it.id}-${it.unit_price}`} />
                          </td>
                          <td style={{ padding:'6px 8px' }}>
                            {(() => {
                              const mov = itemMovements[it.id]
                              if (mov) {
                                return (
                                  <span style={{ fontSize:11, background: mov.type === 'out' ? 'var(--red-bg)' : 'var(--green-bg)', color: mov.type === 'out' ? 'var(--red)' : 'var(--green)', padding:'2px 8px', borderRadius:4, display:'inline-flex', alignItems:'center', gap:3 }}>
                                    <i className={`ti ${mov.type === 'out' ? 'ti-arrow-up' : 'ti-arrow-down'}`} style={{ fontSize:11 }} />
                                    {mov.type === 'out' ? 'Списано' : 'Оприбутковано'} · {mov.date}
                                  </span>
                                )
                              }
                              // Не списано — можна списати
                              if (it.product_id) {
                                return (
                                  <button onClick={async (e) => {
                                    e.stopPropagation()
                                    const movType = selected.direction === 'Доходи' ? 'out' : 'in'
                                    const { getFifoCost } = await import('../lib/stockService')
                                    const costPrice = movType === 'out' ? await getFifoCost(it.product_id, it.quantity) : null
                                    await supabase.from('stock_movements').insert({
                                      product_id: it.product_id, type: movType,
                                      quantity: it.quantity, price: it.unit_price, total: it.amount,
                                      cost_price: costPrice, bank_transaction_id: selected.id,
                                      transaction_item_id: it.id, date: selected.date,
                                      description: it.name,
                                    })
                                    setItemMovements(prev => ({ ...prev, [it.id]: { type: movType, date: selected.date } }))
                                  }} style={{ fontSize:11, background:'none', border:'1px dashed var(--border)', borderRadius:4, padding:'2px 8px', cursor:'pointer', color:'var(--blue)', fontFamily:'inherit', display:'flex', alignItems:'center', gap:3 }}>
                                    <i className="ti ti-package-import" style={{ fontSize:11 }} />
                                    {selected.direction === 'Доходи' ? 'Списати' : 'Оприбуткувати'}
                                  </button>
                                )
                              }
                              // Не привʼязано — дати вибрати товар і списати
                              return (
                                <div>
                                  <input style={{ width:'100%', border:'1px solid var(--border)', borderRadius:4, padding:'3px 6px', fontSize:11, fontFamily:'inherit' }}
                                    placeholder="Пошук товару..."
                                    onChange={e => {
                                      const q = e.target.value.toLowerCase()
                                      if (q.length < 2) { e.target.dataset.results = ''; return }
                                      const found = allProducts.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5)
                                      // Зберігаємо в data attribute для простоти
                                      e.target.dataset.results = JSON.stringify(found)
                                      e.target.dispatchEvent(new Event('input', { bubbles: true }))
                                    }}
                                  />
                                  <div style={{ display:'flex', flexDirection:'column', gap:2, marginTop:4 }}>
                                    {allProducts.filter(p => p.name.toLowerCase().includes((it.name || '').toLowerCase().substring(0, 15))).slice(0, 3).map(p => (
                                      <button key={p.id} onClick={async (e) => {
                                        e.stopPropagation()
                                        // Привʼязати item до product
                                        await supabase.from('transaction_items').update({ product_id: p.id }).eq('id', it.id)
                                        // Створити stock_movement
                                        const movType = selected.direction === 'Доходи' ? 'out' : 'in'
                                        const { getFifoCost } = await import('../lib/stockService')
                                        const costPrice = movType === 'out' ? await getFifoCost(p.id, it.quantity) : null
                                        await supabase.from('stock_movements').insert({
                                          product_id: p.id, type: movType,
                                          quantity: it.quantity, price: it.unit_price, total: it.amount,
                                          cost_price: costPrice, bank_transaction_id: selected.id,
                                          transaction_item_id: it.id, date: selected.date, description: it.name,
                                        })
                                        setSelectedItems(prev => prev.map(item => item.id === it.id ? { ...item, product_id: p.id } : item))
                                        setItemMovements(prev => ({ ...prev, [it.id]: { type: movType, date: selected.date } }))
                                      }} style={{ fontSize:10, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:4, padding:'3px 6px', cursor:'pointer', textAlign:'left', fontFamily:'inherit', display:'flex', justifyContent:'space-between' }}>
                                        <span>{p.name.substring(0, 30)}</span>
                                        <span style={{ color:'var(--text3)', flexShrink:0, marginLeft:4 }}>{p.computed_stock} {p.unit}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )
                            })()}
                          </td>
                          <td style={{ padding:'4px 4px', textAlign:'center' }}>
                            <button onClick={async (e) => {
                              e.stopPropagation()
                              if (!confirm('Видалити позицію "' + (it.name || '').substring(0, 30) + '"?')) return
                              // Видалити stock_movement якщо є
                              await supabase.from('stock_movements').delete().eq('transaction_item_id', it.id)
                              // Видалити позицію
                              await supabase.from('transaction_items').delete().eq('id', it.id)
                              setSelectedItems(prev => prev.filter(item => item.id !== it.id))
                              setItemMovements(prev => { const n = { ...prev }; delete n[it.id]; return n })
                            }} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--red)', fontSize:14, padding:2 }} title="Видалити позицію">
                              <i className="ti ti-trash" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Додати товар/позицію вручну + розпізнати */}
            <div style={{ marginBottom:12, display:'flex', gap:8, flexWrap:'wrap' }}>
              <button className="btn btn-sm btn-secondary" style={{ display:'flex', alignItems:'center', gap:4 }}
                onClick={() => setAddItemMode(prev => !prev)}>
                <i className="ti ti-package-import" style={{ fontSize:13 }} />
                Додати товар зі складу
              </button>
              <button className="btn btn-sm btn-secondary" style={{ display:'flex', alignItems:'center', gap:4 }}
                onClick={() => setManualItemMode(prev => !prev)}>
                <i className="ti ti-pencil-plus" style={{ fontSize:13 }} />
                Додати позицію вручну
              </button>
              {selectedDocs.length > 0 && (
                <button className="btn btn-sm btn-secondary" style={{ display:'flex', alignItems:'center', gap:4 }}
                  disabled={recognizing}
                  onClick={async () => {
                    setRecognizing(true)
                    try {
                      const { extractDocumentMulti } = await import('../lib/ai')
                      const { matchProduct, processDocumentItems } = await import('../lib/stockService')
                      const arts = await (await import('../lib/articles')).fetchArticles()
                      // Існуючі назви позицій для перевірки дублікатів
                      const { data: existingItems } = await supabase.from('transaction_items')
                        .select('name, quantity, unit_price').eq('bank_transaction_id', selected.id)
                      // Дублікат = назва + кількість + ціна
                      const existingKeys = new Set((existingItems || []).map(e => `${(e.name||'').toLowerCase()}|${e.quantity}|${e.unit_price}`))
                      let totalAdded = 0

                      // Обробити ВСІ документи
                      for (const doc of selectedDocs) {
                        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 120)
                        if (!urlData?.signedUrl) continue
                        const res = await fetch(urlData.signedUrl)
                        const blob = await res.blob()
                        const file = new File([blob], doc.file_name || 'doc', { type: doc.file_type || 'application/pdf' })
                        const data = await extractDocumentMulti([file], arts)
                        const items = (data.items || []).filter(it => it.name)
                        if (items.length === 0) continue

                        // Match products
                        for (const it of items) {
                          const match = await matchProduct(it.name)
                          it._matchedProductId = match.productId || null
                          it._action = match.matchType !== 'none' ? 'auto' : 'new'
                        }

                        // Фільтрувати дублікати
                        const newItems = items.filter(it => {
                          const key = `${(it.name||'').toLowerCase()}|${parseFloat(it.quantity)||0}|${parseFloat(it.unitPrice)||0}`
                          return !existingKeys.has(key)
                        })
                        if (newItems.length === 0) continue

                        const { data: savedItems } = await supabase.from('transaction_items').insert(
                          newItems.map(it => ({
                            bank_transaction_id: selected.id, name: it.name,
                            quantity: parseFloat(it.quantity) || null, unit: it.unit || null,
                            unit_price: parseFloat(it.unitPrice) || null,
                            amount: parseFloat(it.amount) || 0, vat_rate: parseFloat(it.vatRate) || 20,
                          }))
                        ).select('id, name, quantity, unit, unit_price, amount')

                        if (savedItems?.length) {
                          const enriched = savedItems.map((si, idx) => ({
                            ...si, _matchedProductId: newItems[idx]?._matchedProductId || null, _action: newItems[idx]?._action || 'auto'
                          }))
                          await processDocumentItems(enriched, {
                            docType: data.docType, docRole: doc.doc_role || 'incoming',
                            bankTransactionId: selected.id, date: selected.date, userId: user?.id,
                          })
                          newItems.forEach(it => existingKeys.add(`${(it.name||'').toLowerCase()}|${parseFloat(it.quantity)||0}|${parseFloat(it.unitPrice)||0}`))
                          totalAdded += savedItems.length
                        }
                      }
                      if (totalAdded === 0) alert('Нових позицій не знайдено')
                      openDetail(selected)
                    } catch (e) {
                      alert('Помилка розпізнавання: ' + e.message)
                    }
                    setRecognizing(false)
                  }}>
                  <i className={`ti ${recognizing ? 'ti-loader-2' : 'ti-sparkles'}`} style={{ fontSize:13, animation: recognizing ? 'spin 1s linear infinite' : 'none' }} />
                  {recognizing ? 'Розпізнаємо...' : 'Розпізнати позиції'}
                </button>
              )}
              {addItemMode && (
                <div style={{ marginTop:8, border:'1px solid var(--border)', borderRadius:8, padding:12, background:'var(--bg)' }}>
                  <div style={{ position:'relative', marginBottom:8 }}>
                    <input className="form-input" style={{ height:36, fontSize:13 }}
                      placeholder="Пошук товару зі складу..."
                      value={addItemSearch}
                      onChange={e => setAddItemSearch(e.target.value)} />
                    {addItemSearch.length >= 2 && (
                      <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, zIndex:10, maxHeight:200, overflowY:'auto', boxShadow:'0 4px 12px rgba(0,0,0,.1)' }}>
                        {(addItemResults || []).map(p => (
                          <div key={p.id} onClick={() => { setAddItemProduct(p); setAddItemSearch(p.name) }}
                            style={{ padding:'8px 12px', cursor:'pointer', fontSize:13, display:'flex', justifyContent:'space-between', borderBottom:'1px solid var(--border)' }}
                            onMouseEnter={e => e.currentTarget.style.background='var(--bg)'}
                            onMouseLeave={e => e.currentTarget.style.background=''}>
                            <span>{p.name}</span>
                            <span style={{ fontSize:11, color: p.computed_stock > 0 ? 'var(--green)' : 'var(--red)' }}>{p.computed_stock} {p.unit}</span>
                          </div>
                        ))}
                        {addItemResults.length === 0 && <div style={{ padding:12, textAlign:'center', color:'var(--text3)', fontSize:12 }}>Не знайдено</div>}
                      </div>
                    )}
                  </div>
                  {addItemProduct && (
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                      <span style={{ fontSize:12, fontWeight:500 }}>{addItemProduct.name}</span>
                      <input type="number" className="form-input" style={{ width:80, height:32, fontSize:12 }}
                        placeholder="К-сть" value={addItemQty} onChange={e => setAddItemQty(e.target.value)} />
                      <input type="number" className="form-input" style={{ width:100, height:32, fontSize:12 }}
                        placeholder="Ціна" value={addItemPrice} onChange={e => setAddItemPrice(e.target.value)} />
                      <button className="btn btn-sm btn-primary" disabled={!addItemQty}
                        onClick={async () => {
                          const qty = parseFloat(addItemQty) || 0
                          const price = parseFloat(addItemPrice) || 0
                          if (qty <= 0) return
                          const movType = selected.direction === 'Доходи' ? 'out' : 'in'
                          // Створити transaction_item
                          await supabase.from('transaction_items').insert({
                            bank_transaction_id: selected.id, name: addItemProduct.name,
                            quantity: qty, unit: addItemProduct.unit || 'шт',
                            unit_price: price, amount: qty * price, product_id: addItemProduct.id,
                          })
                          // Створити stock_movement
                          if (addItemProduct.product_type === 'goods') {
                            const { getFifoCost } = await import('../lib/stockService')
                            const costPrice = movType === 'out' ? await getFifoCost(addItemProduct.id, qty) : null
                            await supabase.from('stock_movements').insert({
                              product_id: addItemProduct.id, type: movType,
                              quantity: qty, price, total: qty * price,
                              cost_price: costPrice, bank_transaction_id: selected.id,
                              date: selected.date, description: `${addItemProduct.name} — ${selected.counterparty}`,
                            })
                          }
                          // Оновити UI
                          setAddItemMode(false); setAddItemSearch(''); setAddItemProduct(null)
                          setAddItemQty(''); setAddItemPrice('')
                          openDetail(selected)
                        }}>
                        Додати
                      </button>
                    </div>
                  )}
                </div>
              )}
              {manualItemMode && (
                <div style={{ marginTop:8, border:'1px solid var(--border)', borderRadius:8, padding:12, background:'var(--bg)' }}>
                  <div style={{ fontSize:12, fontWeight:500, marginBottom:8, color:'var(--text2)' }}>Нова позиція</div>
                  <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr', gap:6, alignItems:'end' }}>
                    <div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginBottom:2 }}>Назва *</div>
                      <input className="form-input" style={{ height:32, fontSize:12 }} placeholder="Назва товару/послуги"
                        value={manualItem.name} onChange={e => setManualItem(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginBottom:2 }}>К-сть</div>
                      <input type="number" className="form-input" style={{ height:32, fontSize:12 }}
                        value={manualItem.quantity} onChange={e => setManualItem(f => ({ ...f, quantity: e.target.value }))} />
                    </div>
                    <div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginBottom:2 }}>Ціна (без ПДВ)</div>
                      <input type="number" className="form-input" style={{ height:32, fontSize:12 }} placeholder="0.00"
                        value={manualItem.unit_price} onChange={e => setManualItem(f => ({ ...f, unit_price: e.target.value }))} />
                    </div>
                    <div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginBottom:2 }}>ПДВ%</div>
                      <select className="form-input" style={{ height:32, fontSize:12, padding:'4px 6px' }}
                        value={manualItem.vat_rate} onChange={e => setManualItem(f => ({ ...f, vat_rate: e.target.value }))}>
                        <option value="20">20%</option>
                        <option value="7">7%</option>
                        <option value="0">0%</option>
                      </select>
                    </div>
                    <button className="btn btn-sm btn-primary" disabled={!manualItem.name.trim() || !manualItem.unit_price}
                      onClick={async () => {
                        const qty = parseFloat(manualItem.quantity) || 1
                        const price = parseFloat(manualItem.unit_price) || 0
                        const amount = qty * price
                        const vatRate = parseFloat(manualItem.vat_rate) || 20
                        await supabase.from('transaction_items').insert({
                          bank_transaction_id: selected.id, name: manualItem.name.trim(),
                          quantity: qty, unit: manualItem.unit || 'шт',
                          unit_price: price, amount, vat_rate: vatRate,
                        })
                        setManualItem({ name:'', quantity:'1', unit:'шт', unit_price:'', vat_rate:'20' })
                        openDetail(selected)
                      }} style={{ height:32 }}>Додати</button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-paperclip" style={{ fontSize:15, color:'var(--blue)' }} />
                  Файли ({selectedDocs.length})
                </div>
                <label style={{ fontSize:12, color:'var(--blue)', cursor:'pointer', display:'flex', alignItems:'center', gap:4, fontWeight:400 }}>
                  <i className="ti ti-upload" style={{ fontSize:13 }} /> Завантажити
                  <input type="file" accept=".pdf,image/*" multiple style={{ display:'none' }}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || [])
                      for (const f of files) {
                        const ext = f.name.split('.').pop()?.toLowerCase() || 'jpg'
                        const safePath = `${selected.id}/${Date.now()}.${ext}`
                        const { error } = await supabase.storage.from('documents').upload(safePath, f, { contentType: f.type })
                        if (!error) {
                          await supabase.from('documents').insert({
                            bank_transaction_id: selected.id,
                            file_name: f.name, file_path: safePath,
                            file_type: f.type, file_size: f.size,
                            doc_role: 'incoming', uploaded_by: user?.id,
                          })
                        }
                      }
                      openDetail(selected)
                      e.target.value = ''
                    }} />
                </label>
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
                      <i className="ti ti-download" style={{ fontSize:13 }} />
                    </button>
                    <button className="btn btn-sm" style={{ display:'flex', alignItems:'center', gap:4, color:'var(--red)', background:'none', border:'1px solid var(--border)' }}
                      onClick={async () => {
                        if (!confirm(`Видалити документ "${doc.file_name}"?`)) return
                        // Видалити файл зі storage
                        if (doc.file_path) {
                          await supabase.storage.from('documents').remove([doc.file_path])
                        }
                        // Видалити запис з БД
                        await supabase.from('documents').delete().eq('id', doc.id)
                        // Оновити список
                        setSelectedDocs(prev => prev.filter(d => d.id !== doc.id))
                      }}>
                      <i className="ti ti-trash" style={{ fontSize:13 }} />
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
              <div className="form-group"><label>Контрагент</label><ContractorSelect
  value={editForm.contractor}
  onChange={v => setEditForm(f => ({...f, contractor: v}))}
  onContractorSelect={c => {
    if (c._new) return
    if (c.default_direction) setEditForm(f => ({...f, direction: c.default_direction}))
    if (c.default_article) setEditForm(f => ({...f, article: c.default_article}))
  }}
/></div>
              <div className="form-group"><label>Напрям</label><select className="form-input" value={editForm.direction} onChange={e => setEditForm(f=>({...f,direction:e.target.value}))}>{DIRS.map(d=><option key={d}>{d}</option>)}</select></div>
              <div className="form-group"><label>Стаття</label><ArticleSelect value={editForm.article} onChange={e => setEditForm(f=>({...f,article:e.target.value}))} articles={articles} direction={editForm.direction} /></div>
              <div className="form-group"><label>Проєкт</label>
                <div style={{ display:'flex', gap:6 }}>
                  <select className="form-input" style={{ flex:1 }} value={editForm.project_id} onChange={e => setEditForm(f=>({...f,project_id:e.target.value}))}>
                    <option value="">— без проєкту —</option>
                    {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewProject(true)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:8, width:44, height:48, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--blue)', flexShrink:0 }} title="Створити новий проєкт">
                    <i className="ti ti-plus" style={{ fontSize:16 }} />
                  </button>
                </div>
              </div>
              <div className="form-group full"><label>Призначення</label><textarea className="form-input" rows={2} value={editForm.description} onChange={e => setEditForm(f=>({...f,description:e.target.value}))}/></div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleUpdate} disabled={editSaving}>{editSaving?'Збереження...':'Зберегти'}</button>
              <button className="btn btn-secondary" onClick={() => setEdit(null)}>Скасувати</button>
            </div>

            {/* New project mini-modal */}
            {showNewProject && (() => {
              const contractor = editForm.contractor || edit?.counterparty || ''
              const txDate = edit?.date || new Date().toISOString().split('T')[0]
              const short = contractor.replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/gi, '').replace(/ФІЗИЧНА ОСОБА[-\s]ПІДПРИЄМЕЦЬ/gi, '').replace(/^(ТОВ|ФОП|АТ|ПП)\s+/gi, '').replace(/[«»"']/g, '').trim().substring(0, 25).trim()
              const d = new Date(txDate)
              const month = UA_MONTHS[d.getMonth()]
              const year = d.getFullYear()
              const preview = `#??? / ${short} / ${month} ${year}`
              return (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.3)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={e => e.target===e.currentTarget && setShowNewProject(false)}>
                  <div style={{ background:'var(--surface)', borderRadius:16, padding:24, width:'100%', maxWidth:420 }}>
                    <h3 style={{ fontSize:16, fontWeight:600, marginBottom:16 }}>Створити проєкт</h3>
                    <div style={{ background:'var(--surface2)', borderRadius:8, padding:'14px 16px', marginBottom:16 }}>
                      <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>Назва проєкту (генерується автоматично)</div>
                      <div style={{ fontSize:16, fontWeight:600 }}>{preview}</div>
                      <div style={{ fontSize:12, color:'var(--text2)', marginTop:6 }}>Контрагент: {contractor || '—'}</div>
                      <div style={{ fontSize:12, color:'var(--text2)' }}>Дата: {txDate}</div>
                    </div>
                    <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                      <button className="btn btn-primary" onClick={handleCreateProject} disabled={newProjectSaving || !contractor} style={{ width:'auto' }}>
                        {newProjectSaving ? 'Створення...' : 'Створити проєкт'}
                      </button>
                      <button className="btn btn-secondary" onClick={() => setShowNewProject(false)} style={{ width:'auto' }}>Скасувати</button>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
      {/* File preview modal */}
      {previewDoc && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setPreviewDoc(null)} style={{ zIndex:1100 }}>
          <div className="modal modal-xl" style={{ padding:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
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
          <div className="modal modal-lg">
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
                        border: `1px solid ${isDone ? '#E2E8F0' : isError ? '#E2E8F0' : isSelected ? 'var(--blue)' : 'var(--border)'}`,
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
                          <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.counterparty}</div>
                          <div style={{ fontSize:12, color:'var(--text2)', display:'flex', gap:10, marginTop:2 }}>
                            <span>{tx.date}</span>
                            <span style={{ fontWeight:500, color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                              {tx.amount >= 0 ? '+' : ''}{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(tx.amount)))} грн
                            </span>
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
          <div className="modal modal-xl">
            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
              <div>
                <h2 style={{ fontSize:20, fontWeight:700, color:'#000', marginBottom:4 }}>Перевірка дублікатів</h2>
                <p style={{ fontSize:13, color:'var(--text2)' }}>
                  {dupResults.length > 0
                    ? `Знайдено ${dupResults.length} можливих пар — перевірте кожну`
                    : 'Дублікатів не знайдено'}
                </p>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
                <button
                  onClick={runDupCheck} disabled={dupChecking}
                  style={{ height:36, padding:'0 14px', border:'1px solid var(--border)', background:'#fff', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500, fontFamily:'Inter,sans-serif', color:'#000', display:'flex', alignItems:'center', gap:6 }}
                >
                  <i className="ti ti-refresh" style={{ fontSize:14 }} />
                  Оновити
                </button>
                <button
                  onClick={() => setShowDupModal(false)}
                  style={{ width:32, height:32, background:'var(--surface2)', border:'none', borderRadius:8, cursor:'pointer', fontSize:15, color:'var(--text2)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Inter,sans-serif', flexShrink:0 }}
                >X</button>
              </div>
            </div>

            {/* Rule pills */}
            <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
              {[
                { label: 'Правило 1: дата ±10 днів + сума ±10 грн', rule: 1 },
                { label: 'Правило 2: контрагент + сума ±1000 грн', rule: 2 },
              ].map(r => {
                const active = dupResults.some(p => p.rule === r.rule)
                return (
                  <span key={r.rule} style={{
                    fontSize:12, fontWeight:500, padding:'6px 14px', borderRadius:20,
                    background: active ? '#000' : 'var(--surface2)',
                    color: active ? '#fff' : 'var(--text2)',
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
                  <div key={i} style={{ border:'1px solid var(--border)', borderRadius:16, padding:16, background:'var(--bg)' }}>
                    {/* Rule label + dismiss */}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                      <span style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:.5, color:'var(--text2)' }}>
                        Правило {pair.rule} · різниця {pair.amtDiff} грн{pair.rule === 1 ? ` · ${pair.dayDiff} днів` : ''}
                      </span>
                      <button onClick={() => dismissPair(pair.tx1.id, pair.tx2.id)}
                        style={{ width:28, height:28, background:'var(--surface2)', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, color:'var(--text2)', display:'flex', alignItems:'center', justifyContent:'center' }}
                        title="Не дублікат">X</button>
                    </div>

                    {/* Two entries grid */}
                    <div className="dup-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                      {[pair.tx1, pair.tx2].map((tx, ti) => (
                        <div key={tx.id} style={{
                          background:'#FFFFFF', border:'1px solid var(--border)', borderRadius:12, padding:16,
                          display:'flex', flexDirection:'column', height:'100%',
                        }}>
                          {/* Content area — flex:1 to push buttons down */}
                          <div style={{ flex:1 }}>
                            {/* Company name */}
                            <div style={{ fontSize:14, fontWeight:600, color:'#000', marginBottom:8 }}>{tx.counterparty}</div>

                            {/* Date + Amount + Badge */}
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:6 }}>
                              <span style={{ fontSize:13, color:'var(--text2)' }}>{tx.date}</span>
                              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <span style={{ fontSize:14, fontWeight:500, color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                  {tx.amount >= 0 ? '+' : ''}{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(tx.amount)))} грн
                                </span>
                                {tx.direction && (
                                  <span style={{
                                    fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:6,
                                    background: tx.direction==='Доходи' ? 'var(--green-bg)' : tx.direction==='Витрати' ? 'var(--red-bg)' : 'var(--surface2)',
                                    color: tx.direction==='Доходи' ? 'var(--green)' : tx.direction==='Витрати' ? 'var(--red)' : 'var(--text2)',
                                  }}>{tx.direction}</span>
                                )}
                              </div>
                            </div>

                            {/* Details */}
                            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                              {tx.article && <div style={{ fontSize:12, color:'var(--text2)' }}>Стаття: {tx.article}</div>}
                              {tx.description && (
                                <div style={{ fontSize:12, color:'var(--text2)', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', lineHeight:'1.4' }}>
                                  Опис: {tx.description}
                                </div>
                              )}
                              <div style={{ fontSize:12, color:'var(--text2)' }}>Документів: {tx.documents?.length || 0}</div>
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
                                background:'var(--red-bg)', color:'var(--red)', fontSize:13, fontWeight:600,
                                fontFamily:'Inter,sans-serif', opacity: isMerging ? .5 : 1,
                              }}
                            >Видалити</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {isMerging && (
                      <div style={{ textAlign:'center', padding:'8px 0', fontSize:13, color:'var(--text2)', marginTop:8 }}>
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

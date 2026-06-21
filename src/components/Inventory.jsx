import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { processDocumentItems, migrateProductAliases, mergeProductDuplicates, backfillCostPrices } from '../lib/stockService'
import MovementFixer from './MovementFixer'
import ProductDetail from './ProductDetail'
import { fmt, fmtInt } from '../lib/fmt'

const EMPTY_PRODUCT = { name:'', sku:'', uktzed:'', manufacturer:'', category:'', unit:'шт', buy_price:'', sell_price:'', min_stock:'0', notes:'' }

export default function Inventory({ user }) {
  const [products, setProducts] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewDoc, setPreviewDoc] = useState(null)

  const openDocPreview = async (doc) => {
    if (!doc?.file_path) return
    setPreviewDoc(doc)
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 300)
    setPreviewUrl(data?.signedUrl || null)
  }
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterType, setFilterType] = useState('goods')
  const [showServiceMenu, setShowServiceMenu] = useState(false)
  const [showFixer, setShowFixer] = useState(false)
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)

  const toggleCheck = (id, e) => {
    e.stopPropagation()
    setCheckedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const bulkUpdate = async (updates) => {
    setBulkSaving(true)
    const ids = [...checkedIds]
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      await supabase.from('products').update(updates).in('id', chunk)
    }
    setBulkSaving(false)
    setCheckedIds(new Set())
    loadAll()
  }
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_PRODUCT)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  // Detail view
  const [detail, setDetail] = useState(null)
  const [detailMovements, setDetailMovements] = useState([])
  const [showMovement, setShowMovement] = useState(false)
  const [movForm, setMovForm] = useState({ type:'in', quantity:'', price:'', description:'', date:new Date().toISOString().split('T')[0] })

  // Merge
  const [showMerge, setShowMerge] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeTarget, setMergeTarget] = useState(null)

  // Пари для обʼєднання
  const [showPairs, setShowPairs] = useState(false)
  const [pairs, setPairs] = useState({ outOnly: [], inOnly: [] })
  const [pairsLoading, setPairsLoading] = useState(false)

  const findPairs = async () => {
    setPairsLoading(true)
    setShowPairs(true)
    // Всі рухи з датами і контрагентами
    const { data: allMovs } = await supabase.from('stock_movements')
      .select('product_id, type, date, quantity, price, bank_transaction_id')
    const hasIn = new Set(), hasOut = new Set()
    const movInfo = {} // product_id → { inDates, outDates, inQty, outQty, bankIds }
    ;(allMovs || []).forEach(m => {
      if (m.type === 'in') hasIn.add(m.product_id)
      if (m.type === 'out') hasOut.add(m.product_id)
      if (!movInfo[m.product_id]) movInfo[m.product_id] = { inDates: [], outDates: [], inQty: 0, outQty: 0, bankIds: new Set() }
      if (m.type === 'in') { movInfo[m.product_id].inDates.push(m.date); movInfo[m.product_id].inQty += parseFloat(m.quantity) || 0 }
      if (m.type === 'out') { movInfo[m.product_id].outDates.push(m.date); movInfo[m.product_id].outQty += parseFloat(m.quantity) || 0 }
      if (m.bank_transaction_id) movInfo[m.product_id].bankIds.add(m.bank_transaction_id)
    })
    const outOnlyIds = [...hasOut].filter(id => !hasIn.has(id))
    const inOnlyIds = [...hasIn].filter(id => !hasOut.has(id))

    // Підтягнути контрагентів з bank_transactions
    const allBankIds = new Set()
    ;[...outOnlyIds, ...inOnlyIds].forEach(pid => {
      (movInfo[pid]?.bankIds || new Set()).forEach(bid => allBankIds.add(bid))
    })
    const bankMap = {}
    if (allBankIds.size > 0) {
      const ids = [...allBankIds]
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await supabase.from('bank_transactions')
          .select('id, counterparty').in('id', ids.slice(i, i + 100))
        ;(data || []).forEach(b => { bankMap[b.id] = b.counterparty })
      }
    }

    // Додати інфо до продуктів
    const enrichProduct = (p) => {
      const info = movInfo[p.id] || {}
      const bankId = [...(info.bankIds || [])][0]
      return { ...p, _dates: [...(info.inDates || []), ...(info.outDates || [])].sort(), _inQty: info.inQty || 0, _outQty: info.outQty || 0, _counterparty: bankMap[bankId] || '' }
    }

    const { data: outProds } = outOnlyIds.length > 0
      ? await supabase.from('products').select('id, name').in('id', outOnlyIds).eq('status', 'active').order('name')
      : { data: [] }
    const { data: inProds } = inOnlyIds.length > 0
      ? await supabase.from('products').select('id, name').in('id', inOnlyIds).eq('status', 'active').order('name')
      : { data: [] }

    setPairs({
      outOnly: (outProds || []).map(enrichProduct),
      inOnly: (inProds || []).map(enrichProduct),
    })
    setPairsLoading(false)
  }

  const mergePair = async (outId, inId) => {
    // Перенести все з inId на outId
    await supabase.from('stock_movements').update({ product_id: outId }).eq('product_id', inId)
    await supabase.from('transaction_items').update({ product_id: outId }).eq('product_id', inId)
    await supabase.from('product_aliases').update({ product_id: outId }).eq('product_id', inId)
    await supabase.from('products').update({ status: 'archived' }).eq('id', inId)
    // Оновити списки
    setPairs(prev => ({
      outOnly: prev.outOnly.filter(p => p.id !== outId),
      inOnly: prev.inOnly.filter(p => p.id !== inId),
    }))
    loadAll()
  }

  useEffect(() => {
    loadAll().then(() => {
      const openId = sessionStorage.getItem('aim-open-product')
      if (openId) {
        sessionStorage.removeItem('aim-open-product')
        supabase.from('products').select('*').eq('id', openId).single().then(({ data }) => {
          if (data) openDetail(data)
        })
      }
    })
  }, [])

  const loadAll = async () => {
    setLoading(true)
    // Спочатку спробувати view product_stock, fallback на products
    let prods
    const { data: viewData, error: viewErr } = await supabase
      .from('product_stock')
      .select('*')
      .eq('status', 'active')
      .order('name')

    if (!viewErr && viewData) {
      prods = viewData
    } else {
      const { data: fallback } = await supabase.from('products').select('*').eq('status','active').order('name')
      prods = fallback || []
    }

    // Позначити збірки
    const { data: asmProducts } = await supabase.from('assemblies').select('result_product_id')
    const asmSet = new Set((asmProducts || []).map(a => a.result_product_id).filter(Boolean))
    prods = (prods || []).map(p => ({ ...p, _isAssembly: asmSet.has(p.id) }))

    setProducts(prods)
    setLoading(false)
  }

  const categories = [...new Set(products.map(p => p.category).filter(Boolean))]
  const manufacturers = [...new Set(products.map(p => p.manufacturer).filter(Boolean))].sort()
  const [filterMfr, setFilterMfr] = useState('')

  const filtered = products.filter(p => {
    if (filterType && filterType !== 'all') {
      const pt = p.product_type || 'goods'
      if (filterType === 'goods' && pt !== 'goods') return false
      if (filterType === 'other' && pt !== 'service' && pt !== 'expense') return false
    }
    if (filterCat && p.category !== filterCat) return false
    if (filterMfr && p.manufacturer !== filterMfr) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(p.name||'').toLowerCase().includes(q) && !(p.sku||'').toLowerCase().includes(q)) return false
    }
    return true
  })

  // Сортування
  const [sortCol, setSortCol] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sorted = [...filtered].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol]
    if (sortCol === 'computed_stock' || sortCol === 'buy_price') {
      va = parseFloat(va) || 0; vb = parseFloat(vb) || 0
    } else if (sortCol === 'value') {
      va = (a.computed_stock || 0) * (a.buy_price || 0); vb = (b.computed_stock || 0) * (b.buy_price || 0)
    } else {
      va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase()
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <i className="ti ti-selector" style={{ fontSize: 10, opacity: .3, marginLeft: 2 }} />
    return <i className={`ti ti-sort-${sortDir === 'asc' ? 'ascending' : 'descending'}`} style={{ fontSize: 10, color: 'var(--blue)', marginLeft: 2 }} />
  }

  const allChecked = sorted.length > 0 && checkedIds.size === sorted.length
  const someChecked = checkedIds.size > 0

  const kpi = {
    total: products.length,
    inStock: products.filter(p => p.computed_stock > 0).length,
    lowStock: products.filter(p => p.computed_stock > 0 && p.computed_stock <= (p.min_stock || 0)).length,
    outOfStock: products.filter(p => p.computed_stock <= 0).length,
    totalValue: products.reduce((s, p) => s + (p.computed_stock || 0) * (p.buy_price || 0), 0),
  }

  // CRUD
  const openAdd = () => { setForm(EMPTY_PRODUCT); setEditId(null); setShowForm(true) }
  const openEdit = (p) => {
    setForm({ name:p.name||'', sku:p.sku||'', uktzed:p.uktzed||'', manufacturer:p.manufacturer||'', category:p.category||'', unit:p.unit||'шт', buy_price:p.buy_price?.toString()||'', sell_price:p.sell_price?.toString()||'', min_stock:p.min_stock?.toString()||'0', notes:p.notes||'' })
    setEditId(p.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name) return
    setSaving(true)
    const payload = {
      name: form.name, sku: form.sku || null, uktzed: form.uktzed || null,
      manufacturer: form.manufacturer || null, category: form.category || null,
      unit: form.unit || 'шт', buy_price: parseFloat(form.buy_price) || null,
      sell_price: parseFloat(form.sell_price) || null, min_stock: parseFloat(form.min_stock) || 0,
      notes: form.notes || null, created_by: user?.id,
    }
    if (editId) {
      // Перевірити чи назва змінилась
      const oldProduct = products.find(p => p.id === editId)
      const nameChanged = oldProduct && oldProduct.name !== form.name
      await supabase.from('products').update(payload).eq('id', editId)
      if (nameChanged) {
        // Оновити transaction_items
        await supabase.from('transaction_items').update({ name: form.name }).eq('product_id', editId)
        // Оновити stock_movements description
        await supabase.from('stock_movements').update({ description: form.name }).eq('product_id', editId)
        // Додати новий alias
        const { normalizeName } = await import('../lib/stockService')
        const normalized = normalizeName(form.name)
        if (normalized) {
          await supabase.from('product_aliases').upsert({
            product_id: editId, alias: form.name.trim(), normalized,
          }, { onConflict: 'normalized', ignoreDuplicates: true })
        }
      }
    } else {
      await supabase.from('products').insert(payload)
    }
    setSaving(false); setShowForm(false)
    await loadAll()
    // Оновити detail view якщо відкритий
    if (editId && detail?.id === editId) {
      const { data: updated } = await supabase.from('product_stock').select('*').eq('id', editId).single()
      if (updated) {
        const p = { ...updated, computed_stock: updated.computed_stock ?? 0 }
        setDetail(p)
        openDetail(p)
      }
    }
  }

  // Merge: обʼєднати mergeTarget в detail (перенести рухи, позиції, aliases)
  const handleMerge = async () => {
    if (!detail || !mergeTarget || detail.id === mergeTarget.id) return
    setSaving(true)
    // Перенести stock_movements
    await supabase.from('stock_movements').update({ product_id: detail.id }).eq('product_id', mergeTarget.id)
    // Перенести transaction_items
    await supabase.from('transaction_items').update({ product_id: detail.id }).eq('product_id', mergeTarget.id)
    // Перенести aliases
    await supabase.from('product_aliases').update({ product_id: detail.id }).eq('product_id', mergeTarget.id)
    // Архівувати дублікат
    await supabase.from('products').update({ status: 'archived' }).eq('id', mergeTarget.id)
    // computed_stock обчислюється через VIEW — не потрібно перераховувати
    setSaving(false); setShowMerge(false); setMergeTarget(null)
    await loadAll()
    const updated = products.find(p => p.id === detail.id)
    openDetail(updated || detail)
  }

  const handleDelete = async (id) => {
    if (!confirm('Видалити товар?')) return
    await supabase.from('products').update({ status:'archived' }).eq('id', id)
    loadAll()
  }

  // ── Перерахувати склад з існуючих документів ──
  const [syncing, setSyncing] = useState(false)
  const [syncLog, setSyncLog] = useState(null)

  const syncStockFromDocs = async () => {
    if (!confirm('Перерахувати склад?\n\nСистема знайде всі товарні позиції без складського руху та створить відповідні рухи через stockService.\n\nІснуючі рухи НЕ будуть дублюватися.')) return
    setSyncing(true)
    setSyncLog(null)

    try {
      // 1. Завантажити всі transaction_items
      const { data: items } = await supabase.from('transaction_items')
        .select('id, name, quantity, unit, unit_price, amount, bank_transaction_id, product_id')
        .order('id')

      // 2. Завантажити існуючі stock_movements для перевірки
      const { data: existingMovs } = await supabase.from('stock_movements')
        .select('transaction_item_id')
      const movedItemIds = new Set((existingMovs || []).map(m => m.transaction_item_id).filter(Boolean))

      // 3. Завантажити дані з bank_transactions для визначення дати і docType
      const bankIds = [...new Set((items || []).map(i => i.bank_transaction_id).filter(Boolean))]
      const bankMap = {}
      for (let i = 0; i < bankIds.length; i += 50) {
        const chunk = bankIds.slice(i, i + 50)
        const { data: banks } = await supabase.from('bank_transactions')
          .select('id, date, doc_type, direction').in('id', chunk)
        ;(banks || []).forEach(b => { bankMap[b.id] = b })
      }

      // 4. Групувати items по bank_transaction для пакетної обробки
      const unprocessed = (items || []).filter(it => it.name && it.quantity && !movedItemIds.has(it.id))

      let totalProcessed = 0, totalCreated = 0, totalErrors = []

      // Обробляти по одному (processDocumentItems перевіряє дублікати)
      for (const item of unprocessed) {
        const bankTx = bankMap[item.bank_transaction_id]
        const result = await processDocumentItems([item], {
          docType: bankTx?.doc_type || null,
          docRole: bankTx?.direction === 'Доходи' ? 'outgoing' : 'incoming',
          bankTransactionId: item.bank_transaction_id,
          date: bankTx?.date || new Date().toISOString().split('T')[0],
          userId: user.id,
        })
        totalProcessed += result.processed
        totalCreated += result.created
        totalErrors.push(...result.errors)
      }

      setSyncLog({ total: unprocessed.length, created: totalCreated, linked: totalProcessed, errors: totalErrors.length })
    } catch (e) {
      setSyncLog({ error: e.message })
    }
    setSyncing(false)
    loadAll()
  }

  // ── Очистити дублікати продуктів ──
  const [cleaning, setCleaning] = useState(false)
  const [cleanLog, setCleanLog] = useState(null)

  const cleanDuplicates = async () => {
    if (!confirm('Очистити дублікати?\n\n1. Обʼєднає продукти з однаковими назвами\n2. Видалить дубльовані складські рухи\n3. Заповнить aliases для запобігання повторних дублікатів\n\nЦю дію не можна відмінити.')) return
    setCleaning(true)
    setCleanLog(null)

    try {
      // 1. Обʼєднати дублікати через stockService
      const mergeResult = await mergeProductDuplicates()

      // 2. Заповнити aliases
      const aliasResult = await migrateProductAliases()

      setCleanLog({
        mergedProducts: mergeResult.merged,
        removedMovements: mergeResult.removedMovements,
        aliases: aliasResult.added,
      })
    } catch (e) {
      setCleanLog({ error: e.message })
    }
    setCleaning(false)
    loadAll()
  }

  const [detailAliases, setDetailAliases] = useState([])
  const [movFilter, setMovFilter] = useState('all')

  // Detail
  const openDetail = async (p) => {
    setDetail(p)
    // Завантажити aliases (історичні назви)
    const { data: aliases } = await supabase.from('product_aliases')
      .select('alias').eq('product_id', p.id)
    setDetailAliases((aliases || []).map(a => a.alias).filter(a => a !== p.name))
    // Завантажити рухи
    const { data: movs, error } = await supabase.from('stock_movements')
      .select('*')
      .eq('product_id', p.id).order('date', { ascending: false }).limit(100)

    const movements = movs || []

    // Підтягнути bank_transactions і documents для кожного руху
    const bankIds = [...new Set(movements.map(m => m.bank_transaction_id).filter(Boolean))]
    if (bankIds.length > 0) {
      const { data: banks } = await supabase.from('bank_transactions')
        .select('id, counterparty, amount, direction')
        .in('id', bankIds)
      const { data: docs } = await supabase.from('documents')
        .select('id, file_name, file_path, file_type, bank_transaction_id')
        .in('bank_transaction_id', bankIds)

      const bankMap = {}
      ;(banks || []).forEach(b => { bankMap[b.id] = b })
      const docMap = {}
      ;(docs || []).forEach(d => {
        if (!docMap[d.bank_transaction_id]) docMap[d.bank_transaction_id] = []
        docMap[d.bank_transaction_id].push(d)
      })

      movements.forEach(m => {
        m.bank_transactions = bankMap[m.bank_transaction_id] || null
        m.documents = docMap[m.bank_transaction_id] || []
      })
    }

    setDetailMovements(movements)
  }

  const handleAddMovement = async () => {
    if (!movForm.quantity || !detail) return
    setSaving(true)
    const qty = parseFloat(movForm.quantity) || 0
    const price = parseFloat(movForm.price) || 0
    await supabase.from('stock_movements').insert({
      product_id: detail.id, type: movForm.type,
      quantity: qty, price: price || null,
      total: qty * price || null,
      date: movForm.date, description: movForm.description || null,
      created_by: user?.id,
    })
    // computed_stock обчислюється через VIEW — не оновлюємо вручну
    setSaving(false); setShowMovement(false)
    setMovForm({ type:'in', quantity:'', price:'', description:'', date:new Date().toISOString().split('T')[0] })
    await loadAll()
    // Перезавантажити detail з новим залишком
    const updated = products.find(p => p.id === detail.id)
    if (updated) openDetail(updated)
    else openDetail(detail)
  }

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'var(--text2)' }}>Завантаження...</div>

  // ═══ DETAIL VIEW ═══
  if (detail) {
    return (
      <ProductDetail
        detail={detail}
        detailMovements={detailMovements}
        detailAliases={detailAliases}
        products={products}
        onBack={() => setDetail(null)}
        onEdit={() => openEdit(detail)}
        onAddMovement={() => openDetail(detail)}
        onLoadAll={loadAll}
        renderForm={renderForm}
        showForm={showForm}
      />
    )
  }

  // ═══ LIST VIEW ═══
  function renderForm() {
    return (
      <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowForm(false)}>
        <div className="modal">
          <div className="modal-header">
            <h2>{editId ? 'Редагувати товар' : 'Новий товар'}</h2>
            <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
          </div>
          <div className="form-grid">
            <div className="form-group full"><label>Назва *</label><input className="form-input" value={form.name} onChange={setF('name')} placeholder="Назва товару або послуги" /></div>
            <div className="form-group"><label>SKU / Артикул</label><input className="form-input" value={form.sku} onChange={setF('sku')} placeholder="ART-001" /></div>
            <div className="form-group"><label>Код УКТЗЕД</label><input className="form-input" value={form.uktzed} onChange={setF('uktzed')} placeholder="8471300000" /></div>
            <div className="form-group"><label>Виробник</label><input className="form-input" value={form.manufacturer} onChange={setF('manufacturer')} placeholder="HP, Samsung, Ajax..." /></div>
            <div className="form-group"><label>Категорія</label><input className="form-input" value={form.category} onChange={setF('category')} placeholder="Електроніка" /></div>
            <div className="form-group"><label>Одиниця виміру</label><input className="form-input" value={form.unit} onChange={setF('unit')} placeholder="шт" /></div>
            <div className="form-group"><label>Мін. залишок</label><input type="number" className="form-input" value={form.min_stock} onChange={setF('min_stock')} /></div>
            <div className="form-group"><label>Ціна закупки, грн</label><input type="number" className="form-input" value={form.buy_price} onChange={setF('buy_price')} placeholder="0.00" /></div>
            <div className="form-group"><label>Ціна продажу, грн</label><input type="number" className="form-input" value={form.sell_price} onChange={setF('sell_price')} placeholder="0.00" /></div>
            <div className="form-group full"><label>Нотатки</label><textarea className="form-input" rows={2} value={form.notes} onChange={setF('notes')} /></div>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleSave} disabled={saving||!form.name} style={{ width:'auto' }}>{saving ? 'Збереження...' : editId ? 'Зберегти' : 'Додати'}</button>
            <button className="btn btn-secondary" onClick={() => setShowForm(false)} style={{ width:'auto' }}>Скасувати</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div><h1>Склад</h1><p>Залишки товарів та рух</p></div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <div style={{ position:'relative' }}>
            <button className="btn btn-secondary" onClick={() => setShowServiceMenu(v => !v)} style={{ width:'auto', display:'flex', alignItems:'center', gap:4 }}>
              <i className="ti ti-settings" style={{ fontSize:15 }} /> Сервіс <i className="ti ti-chevron-down" style={{ fontSize:12 }} />
            </button>
            {showServiceMenu && (
              <div style={{ position:'absolute', right:0, top:'100%', marginTop:4, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, boxShadow:'0 4px 16px rgba(0,0,0,.1)', zIndex:100, minWidth:220, padding:4 }}>
                {[
                  { label:'Знайти пари', icon:'ti-link', action: () => { setShowServiceMenu(false); findPairs() }, disabled: pairsLoading },
                  { label: cleaning ? 'Очищення...' : 'Очистити дублікати', icon: cleaning ? 'ti-loader-2' : 'ti-trash-x', action: () => { setShowServiceMenu(false); cleanDuplicates() }, disabled: cleaning || syncing },
                  { label: syncing ? 'Перерахунок...' : 'Перерахувати з документів', icon: syncing ? 'ti-loader-2' : 'ti-refresh', action: () => { setShowServiceMenu(false); syncStockFromDocs() }, disabled: syncing || cleaning },
                  { label:'Перерахувати собівартість', icon:'ti-calculator', action: async () => {
                    setShowServiceMenu(false)
                    if (!confirm('Перерахувати FIFO собівартість для всіх OUT рухів?')) return
                    setSyncing(true)
                    const result = await backfillCostPrices()
                    setSyncLog({ total: result.updated, linked: result.updated, created: 0, errors: result.errors, label: 'Собівартість' })
                    setSyncing(false)
                    loadAll()
                  }, disabled: syncing || cleaning },
                  { label:'Виправити невідповідності', icon:'ti-arrows-exchange', action: () => { setShowServiceMenu(false); setShowFixer(true) } },
                ].map((item, i) => (
                  <button key={i} onClick={item.action} disabled={item.disabled}
                    style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 12px', border:'none', background:'none', cursor: item.disabled ? 'default' : 'pointer', borderRadius:6, fontSize:13, fontFamily:'inherit', color: item.disabled ? 'var(--text3)' : 'var(--text)', opacity: item.disabled ? 0.5 : 1 }}
                    onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = 'var(--bg)' }}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <i className={`ti ${item.icon}`} style={{ fontSize:14, color:'var(--text2)' }} />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={openAdd} style={{ width:'auto' }}>
            <i className="ti ti-plus" style={{ fontSize:15 }} /> Додати товар
          </button>
        </div>
      </div>

      {/* Sync result */}
      {syncLog && (
        <div style={{ background: syncLog.error ? 'var(--red-bg)' : 'var(--green-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:13 }}>
            {syncLog.error ? (
              <span style={{ color:'var(--red)' }}>Помилка: {syncLog.error}</span>
            ) : (
              <>
                <strong style={{ color:'var(--green)' }}>Синхронізацію завершено.</strong>{' '}
                Оброблено: {syncLog.linked} позицій
                {syncLog.created > 0 && <span> · Створено нових товарів: {syncLog.created}</span>}
                {syncLog.errors > 0 && <span style={{ color:'var(--red)' }}> · Помилок: {syncLog.errors}</span>}
                {syncLog.total === 0 && <span> — всі позиції вже мають складські рухи</span>}
              </>
            )}
          </div>
          <button onClick={() => setSyncLog(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--text3)' }}>×</button>
        </div>
      )}

      {/* Clean result */}
      {cleanLog && (
        <div style={{ background: cleanLog.error ? 'var(--red-bg)' : 'var(--green-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:13 }}>
            {cleanLog.error ? (
              <span style={{ color:'var(--red)' }}>Помилка: {cleanLog.error}</span>
            ) : (
              <>
                <strong style={{ color:'var(--green)' }}>Очищення завершено.</strong>{' '}
                Обʼєднано дублікатів: {cleanLog.mergedProducts}
                {cleanLog.removedMovements > 0 && <span> · Видалено дубл. рухів: {cleanLog.removedMovements}</span>}
                {cleanLog.aliases > 0 && <span> · Створено aliases: {cleanLog.aliases}</span>}
              </>
            )}
          </div>
          <button onClick={() => setCleanLog(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--text3)' }}>×</button>
        </div>
      )}

      {/* KPI */}
      <div className="kpi-grid cols-5">
        <div className="kpi"><div className="kpi-label">Всього товарів</div><div className="kpi-value">{kpi.total}</div></div>
        <div className="kpi"><div className="kpi-label">В наявності</div><div className="kpi-value" style={{ color:'var(--green)' }}>{kpi.inStock}</div></div>
        <div className="kpi"><div className="kpi-label">Низький залишок</div><div className="kpi-value" style={{ color:'#D97706' }}>{kpi.lowStock}</div></div>
        <div className="kpi"><div className="kpi-label">Відсутні</div><div className="kpi-value" style={{ color:'var(--red)' }}>{kpi.outOfStock}</div></div>
        <div className="kpi"><div className="kpi-label">Вартість складу</div><div className="kpi-value">{fmtInt(kpi.totalValue)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>грн</span></div></div>
      </div>

      {/* Search + filter */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1, position:'relative', minWidth:200 }}>
          <i className="ti ti-search" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:16 }} />
          <input className="form-input" style={{ width:'100%', paddingLeft:38 }} placeholder="Пошук по назві або SKU..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
          {[
            { id:'goods', label:'Товари' },
            { id:'other', label:'Послуги' },
            { id:'all', label:'Всі' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilterType(f.id)} style={{
              padding:'7px 14px', border:'none', cursor:'pointer', fontSize:12.5, fontWeight:500, fontFamily:'inherit',
              background: filterType===f.id ? '#000' : 'var(--surface)', color: filterType===f.id ? '#fff' : 'var(--text2)',
            }}>{f.label}</button>
          ))}
        </div>
        {manufacturers.length > 0 && (
          <select className="form-input" style={{ width:'auto', height:36, fontSize:12.5, padding:'4px 10px' }}
            value={filterMfr} onChange={e => setFilterMfr(e.target.value)}>
            <option value="">Всі виробники</option>
            {manufacturers.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {categories.length > 0 && (
          <select className="form-input" style={{ width:'auto', height:36, fontSize:12.5, padding:'4px 10px' }}
            value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">Всі категорії</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Bulk actions */}
      {someChecked && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', background:'var(--blue-bg)', borderRadius:10, marginBottom:12, flexWrap:'wrap' }}>
          <span style={{ fontSize:13, fontWeight:500 }}>Обрано: {checkedIds.size}</span>
          <select style={{ fontSize:12, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', fontFamily:'inherit' }}
            onChange={e => { if (e.target.value) { bulkUpdate({ product_type: e.target.value }); e.target.value = '' } }}>
            <option value="">Змінити тип...</option>
            <option value="goods">Товар</option>
            <option value="service">Послуга</option>
            <option value="expense">Госп. витрата</option>
          </select>
          <input placeholder="Категорія..." style={{ fontSize:12, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', width:120, fontFamily:'inherit' }}
            onKeyDown={e => { if (e.key === 'Enter' && e.target.value) { bulkUpdate({ category: e.target.value }); e.target.value = '' } }} />
          <button className="btn btn-sm btn-secondary" disabled={bulkSaving}
            onClick={() => bulkUpdate({ is_verified: true })} style={{ fontSize:12 }}>
            <i className="ti ti-circle-check" style={{ fontSize:12 }} /> Верифікувати
          </button>
          <button className="btn btn-sm" disabled={bulkSaving}
            style={{ fontSize:12, color:'var(--red)', background:'none', border:'1px solid var(--border)' }}
            onClick={() => { if (confirm(`Архівувати ${checkedIds.size} товарів?`)) bulkUpdate({ status: 'archived' }) }}>
            <i className="ti ti-archive" style={{ fontSize:12 }} /> Архівувати
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setCheckedIds(new Set())} style={{ fontSize:12, marginLeft:'auto' }}>
            Скасувати
          </button>
        </div>
      )}

      {/* Table */}
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width:36 }}>
                <input type="checkbox" checked={allChecked} onChange={() => {
                  if (allChecked) setCheckedIds(new Set())
                  else setCheckedIds(new Set(sorted.map(p => p.id)))
                }} />
              </th>
              <th style={{ cursor:'pointer' }} onClick={() => toggleSort('name')}>Назва <SortIcon col="name" /></th>
              <th style={{ cursor:'pointer' }} onClick={() => toggleSort('manufacturer')}>Виробник <SortIcon col="manufacturer" /></th>
              <th style={{ cursor:'pointer' }} onClick={() => toggleSort('sku')}>SKU <SortIcon col="sku" /></th>
              <th style={{ cursor:'pointer' }} onClick={() => toggleSort('uktzed')}>УКТЗЕД <SortIcon col="uktzed" /></th>
              <th style={{ textAlign:'right', cursor:'pointer' }} onClick={() => toggleSort('computed_stock')}>Залишок <SortIcon col="computed_stock" /></th>
              <th style={{ textAlign:'right', cursor:'pointer' }} onClick={() => toggleSort('buy_price')}>Ціна закуп. <SortIcon col="buy_price" /></th>
              <th style={{ textAlign:'right', cursor:'pointer' }} onClick={() => toggleSort('value')}>Вартість <SortIcon col="value" /></th>
              <th style={{ width:80 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:32, color:'var(--text3)' }}>Немає товарів</td></tr>}
            {sorted.map(p => {
              const stockColor = p.computed_stock <= 0 ? 'var(--red)' : p.computed_stock <= (p.min_stock||0) ? '#D97706' : 'var(--green)'
              return (
                <tr key={p.id} style={{ cursor:'pointer', background: checkedIds.has(p.id) ? 'var(--blue-bg)' : '' }} onClick={() => openDetail(p)}>
                  <td onClick={e => toggleCheck(p.id, e)}>
                    <input type="checkbox" checked={checkedIds.has(p.id)} readOnly />
                  </td>
                  <td>
                    <div style={{ fontWeight:500, fontSize:14, display:'flex', alignItems:'center', gap:6 }}>
                      {p.name}
                      {p._isAssembly && (
                        <span style={{ fontSize:9, background:'#F0E6FF', color:'#7C3AED', padding:'1px 5px', borderRadius:3, flexShrink:0, display:'flex', alignItems:'center', gap:2 }}>
                          <i className="ti ti-assembly" style={{ fontSize:10 }} /> збірка
                        </span>
                      )}
                      {p.product_type && p.product_type !== 'goods' && (
                        <span style={{ fontSize:9, background: p.product_type === 'service' ? 'var(--blue-bg)' : 'var(--amber-bg)', color: p.product_type === 'service' ? 'var(--blue)' : 'var(--amber)', padding:'1px 4px', borderRadius:3, flexShrink:0 }}>
                          {p.product_type === 'service' ? 'послуга' : 'госп.'}
                        </span>
                      )}
                      {p.is_verified && <i className="ti ti-circle-check-filled" style={{ fontSize:13, color:'var(--green)', flexShrink:0 }} />}
                    </div>
                  </td>
                  <td style={{ fontSize:12, color:'var(--text2)' }}>{p.manufacturer || '—'}</td>
                  <td style={{ fontSize:12, color:'var(--text2)' }}>{p.sku || '—'}</td>
                  <td style={{ fontSize:11, color:'var(--text3)' }}>{p.uktzed || '—'}</td>
                  <td style={{ textAlign:'right', fontWeight:500, color: stockColor, fontVariantNumeric:'tabular-nums' }}>
                    {fmt(p.computed_stock)} {p.unit}
                  </td>
                  <td style={{ textAlign:'right', color:'var(--text2)', fontVariantNumeric:'tabular-nums' }}>{p.buy_price ? fmtInt(p.buy_price)+' грн' : '—'}</td>
                  <td style={{ textAlign:'right', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{p.buy_price ? fmtInt((p.computed_stock||0)*p.buy_price)+' грн' : '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display:'flex', gap:4 }}>
                      <button onClick={() => openEdit(p)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:8, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text2)' }}>
                        <i className="ti ti-pencil" style={{ fontSize:14 }} /></button>
                      <button onClick={() => handleDelete(p.id)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:8, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--red)' }}>
                        <i className="ti ti-trash" style={{ fontSize:14 }} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showForm && renderForm()}

      {/* ── Виправлення невідповідностей ── */}
      {showFixer && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowFixer(false); loadAll() } }}>
          <div style={{ background:'var(--surface)', borderRadius:16, width:'100%', maxWidth:800, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontWeight:600, fontSize:15 }}>Виправлення невідповідностей</span>
              <button onClick={() => { setShowFixer(false); loadAll() }} style={{ background:'none', border:'none', cursor:'pointer', fontSize:22, color:'var(--text3)' }}>×</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
              <MovementFixer />
            </div>
          </div>
        </div>
      )}

      {/* ── Модалка пар для обʼєднання ── */}
      {showPairs && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target === e.currentTarget) setShowPairs(false) }}>
          <div style={{ background:'var(--surface)', borderRadius:16, width:'100%', maxWidth:900, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:16 }}>Знайти пари для обʼєднання</div>
                <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
                  Зліва — продані без закупки ({pairs.outOnly.length}). Справа — закуплені без продажу ({pairs.inOnly.length}).
                </div>
              </div>
              <button onClick={() => setShowPairs(false)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:22, color:'var(--text3)' }}>×</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
              {pairs.outOnly.length === 0 ? (
                <div style={{ textAlign:'center', padding:40, color:'var(--text3)' }}>Всі товари мають і прихід і видачу</div>
              ) : (
                pairs.outOnly.map(outProd => {
                  // Знайти кандидатів серед inOnly — по спільних словах
                  const outWords = outProd.name.toLowerCase().split(/[\s,./()[\]{}\-]+/).filter(w => w.length > 2)
                  const candidates = pairs.inOnly
                    .map(inProd => {
                      const inWords = inProd.name.toLowerCase().split(/[\s,./()[\]{}\-]+/).filter(w => w.length > 2)
                      const common = outWords.filter(w => inWords.some(iw => iw.includes(w) || w.includes(iw)))
                      const score = common.length
                      return { ...inProd, score, common }
                    })
                    .filter(c => c.score >= 2)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 5)

                  return (
                    <div key={outProd.id} style={{ marginBottom:16, border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                        <i className="ti ti-arrow-up-circle" style={{ fontSize:16, color:'var(--red)' }} />
                        <div style={{ fontWeight:500, fontSize:13, color:'var(--red)' }}>Продано (без закупки):</div>
                      </div>
                      <div style={{ paddingLeft:24, marginBottom:10 }}>
                        <div style={{ fontWeight:600, fontSize:14 }}>{outProd.name}</div>
                        <div style={{ fontSize:11, color:'var(--text3)', marginTop:2, display:'flex', gap:12, flexWrap:'wrap' }}>
                          {outProd._counterparty && <span>Клієнт: {outProd._counterparty.substring(0, 40)}</span>}
                          <span>Продано: {outProd._outQty} шт</span>
                          {outProd._dates.length > 0 && <span>{outProd._dates[0]}</span>}
                        </div>
                      </div>

                      {candidates.length > 0 ? (
                        <div style={{ paddingLeft:24 }}>
                          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:6 }}>
                            <i className="ti ti-arrow-down-circle" style={{ fontSize:14, color:'var(--green)', marginRight:4 }} />
                            Можливі пари (закуплено):
                          </div>
                          {candidates.map(c => (
                            <div key={c.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 10px', borderRadius:6, border:'1px solid var(--border)', marginBottom:4, background:'var(--bg)' }}>
                              <div style={{ flex:1 }}>
                                <div style={{ fontSize:13 }}>{c.name}</div>
                                <div style={{ fontSize:10, color:'var(--text3)', display:'flex', gap:10, flexWrap:'wrap' }}>
                                  {c._counterparty && <span>Постач: {c._counterparty.substring(0, 35)}</span>}
                                  <span>Закупл: {c._inQty} шт</span>
                                  {c._dates?.length > 0 && <span>{c._dates[0]}</span>}
                                  <span>збіг: {c.common.join(', ')}</span>
                                </div>
                              </div>
                              <button className="btn btn-sm btn-primary" style={{ flexShrink:0, fontSize:12 }}
                                onClick={() => { if (confirm(`Обʼєднати?\n\n"${outProd.name}"\n← "${c.name}"\n\nВсі рухи та позиції будуть перенесені.`)) mergePair(outProd.id, c.id) }}>
                                Обʼєднати
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ paddingLeft:24, fontSize:12, color:'var(--text3)', fontStyle:'italic' }}>
                          Автоматичних кандидатів не знайдено — потрібно завантажити документ закупки
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n || 0)
const fmtInt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(n || 0))

const EMPTY_PRODUCT = { name:'', sku:'', category:'', unit:'шт', buy_price:'', sell_price:'', min_stock:'0', notes:'' }

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

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: prods }, { data: movs }] = await Promise.all([
      supabase.from('products').select('*').eq('status','active').order('name'),
      supabase.from('stock_movements').select('product_id, type, quantity').order('date', { ascending: false }),
    ])

    // Calculate current stock from movements
    const stockMap = {}
    ;(movs || []).forEach(m => {
      if (!stockMap[m.product_id]) stockMap[m.product_id] = 0
      if (m.type === 'in' || m.type === 'adjustment') stockMap[m.product_id] += (m.quantity || 0)
      else stockMap[m.product_id] -= (m.quantity || 0)
    })

    setProducts((prods || []).map(p => ({
      ...p,
      current_stock: stockMap[p.id] || p.current_stock || 0,
    })))
    setMovements(movs || [])
    setLoading(false)
  }

  const categories = [...new Set(products.map(p => p.category).filter(Boolean))]

  const filtered = products.filter(p => {
    if (filterCat && p.category !== filterCat) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(p.name||'').toLowerCase().includes(q) && !(p.sku||'').toLowerCase().includes(q)) return false
    }
    return true
  })

  const kpi = {
    total: products.length,
    inStock: products.filter(p => p.current_stock > 0).length,
    lowStock: products.filter(p => p.current_stock > 0 && p.current_stock <= (p.min_stock || 0)).length,
    outOfStock: products.filter(p => p.current_stock <= 0).length,
    totalValue: products.reduce((s, p) => s + (p.current_stock || 0) * (p.buy_price || 0), 0),
  }

  // CRUD
  const openAdd = () => { setForm(EMPTY_PRODUCT); setEditId(null); setShowForm(true) }
  const openEdit = (p) => {
    setForm({ name:p.name||'', sku:p.sku||'', category:p.category||'', unit:p.unit||'шт', buy_price:p.buy_price?.toString()||'', sell_price:p.sell_price?.toString()||'', min_stock:p.min_stock?.toString()||'0', notes:p.notes||'' })
    setEditId(p.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name) return
    setSaving(true)
    const payload = {
      name: form.name, sku: form.sku || null, category: form.category || null,
      unit: form.unit || 'шт', buy_price: parseFloat(form.buy_price) || null,
      sell_price: parseFloat(form.sell_price) || null, min_stock: parseFloat(form.min_stock) || 0,
      notes: form.notes || null, created_by: user?.id,
    }
    if (editId) await supabase.from('products').update(payload).eq('id', editId)
    else await supabase.from('products').insert(payload)
    setSaving(false); setShowForm(false); loadAll()
  }

  // Merge: объединить mergeTarget в detail (перенести рухи, позиції, видалити дублікат)
  const handleMerge = async () => {
    if (!detail || !mergeTarget || detail.id === mergeTarget.id) return
    setSaving(true)
    // Перенести stock_movements
    await supabase.from('stock_movements').update({ product_id: detail.id }).eq('product_id', mergeTarget.id)
    // Перенести transaction_items
    await supabase.from('transaction_items').update({ product_id: detail.id }).eq('product_id', mergeTarget.id)
    // Архівувати дублікат
    await supabase.from('products').update({ status: 'archived' }).eq('id', mergeTarget.id)
    // Перерахувати залишок
    const { data: movs } = await supabase.from('stock_movements').select('type, quantity').eq('product_id', detail.id)
    const newStock = (movs || []).reduce((s, m) => s + (m.type === 'in' || m.type === 'adjustment' ? m.quantity : -m.quantity), 0)
    await supabase.from('products').update({ current_stock: newStock }).eq('id', detail.id)
    setSaving(false); setShowMerge(false); setMergeTarget(null)
    openDetail({ ...detail, current_stock: newStock })
    loadAll()
  }

  const handleDelete = async (id) => {
    if (!confirm('Видалити товар?')) return
    await supabase.from('products').update({ status:'archived' }).eq('id', id)
    loadAll()
  }

  // Detail
  const openDetail = async (p) => {
    setDetail(p)
    const { data, error } = await supabase.from('stock_movements')
      .select('*, documents(id, file_name, file_path, file_type), bank_transactions(id, counterparty, amount, direction)')
      .eq('product_id', p.id).order('date', { ascending: false }).limit(100)
    if (error) {
      // Fallback without joins
      const { data: fallback } = await supabase.from('stock_movements')
        .select('*').eq('product_id', p.id).order('date', { ascending: false }).limit(100)
      setDetailMovements(fallback || [])
    } else {
      setDetailMovements(data || [])
    }
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
    // Update current_stock on product
    const newStock = movForm.type === 'out'
      ? (detail.current_stock || 0) - qty
      : (detail.current_stock || 0) + qty
    await supabase.from('products').update({ current_stock: newStock }).eq('id', detail.id)

    setSaving(false); setShowMovement(false)
    setMovForm({ type:'in', quantity:'', price:'', description:'', date:new Date().toISOString().split('T')[0] })
    openDetail({ ...detail, current_stock: newStock })
    loadAll()
  }

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'var(--text2)' }}>Завантаження...</div>

  // ═══ DETAIL VIEW ═══
  if (detail) {
    const totalIn = detailMovements.filter(m => m.type === 'in').reduce((s, m) => s + (m.quantity || 0), 0)
    const totalOut = detailMovements.filter(m => m.type === 'out').reduce((s, m) => s + (m.quantity || 0), 0)

    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24, flexWrap:'wrap' }}>
          <button onClick={() => setDetail(null)} className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className="ti ti-arrow-left" style={{ fontSize:16 }} /> Назад
          </button>
          <div style={{ flex:1 }}>
            <h1 style={{ fontSize:22, fontWeight:600, margin:0 }}>{detail.name}</h1>
            <div style={{ fontSize:13, color:'var(--text2)', marginTop:4 }}>
              {detail.sku && <span>SKU: {detail.sku} · </span>}
              {detail.category && <span>{detail.category} · </span>}
              {detail.unit}
            </div>
          </div>
          <button onClick={() => openEdit(detail)} className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className="ti ti-pencil" style={{ fontSize:14 }} /> Редагувати
          </button>
          <button onClick={() => { setShowMerge(true); setMergeSearch(''); setMergeTarget(null) }}
            className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className="ti ti-arrows-merge" style={{ fontSize:14 }} /> Об'єднати
          </button>
          <button onClick={() => { setShowMovement(true); setMovForm({ type:'in', quantity:'', price:'', description:'', date:new Date().toISOString().split('T')[0] }) }}
            className="btn btn-primary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className="ti ti-plus" style={{ fontSize:14 }} /> Рух товару
          </button>
        </div>

        {/* KPI */}
        {(() => {
          const purchases = detailMovements.filter(m => m.type === 'in')
          const sales = detailMovements.filter(m => m.type === 'out')
          const totalBought = purchases.reduce((s, m) => s + (m.total || (m.quantity * (m.price || 0)) || 0), 0)
          const totalSold = sales.reduce((s, m) => s + (m.total || (m.quantity * (m.price || 0)) || 0), 0)
          const margin = totalSold - totalBought
          return (
            <>
              <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(5,1fr)', marginBottom:20 }}>
                <div className="kpi">
                  <div className="kpi-label">Залишок</div>
                  <div className="kpi-value" style={{ color: detail.current_stock <= 0 ? 'var(--red)' : detail.current_stock <= (detail.min_stock||0) ? '#D97706' : 'var(--green)' }}>
                    {fmt(detail.current_stock)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>{detail.unit}</span>
                  </div>
                </div>
                <div className="kpi"><div className="kpi-label">Закуплено</div><div className="kpi-value" style={{ color:'var(--green)' }}>+{fmt(totalIn)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>{detail.unit}</span></div><div className="kpi-sub">{fmtInt(totalBought)} грн</div></div>
                <div className="kpi"><div className="kpi-label">Реалізовано</div><div className="kpi-value" style={{ color:'var(--red)' }}>-{fmt(totalOut)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>{detail.unit}</span></div><div className="kpi-sub">{fmtInt(totalSold)} грн</div></div>
                <div className="kpi"><div className="kpi-label">Маржа</div><div className="kpi-value" style={{ color: margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{margin >= 0 ? '+' : '-'}{fmtInt(Math.abs(margin))} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>грн</span></div>{totalBought > 0 && <div className="kpi-sub">{((margin / totalBought) * 100).toFixed(0)}%</div>}</div>
                <div className="kpi"><div className="kpi-label">Вартість залишку</div><div className="kpi-value">{fmtInt((detail.current_stock||0) * (detail.buy_price||0))} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>грн</span></div></div>
              </div>

              {/* Purchases */}
              {purchases.length > 0 && (
                <div className="card" style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight:600, fontSize:14, marginBottom:10, display:'flex', alignItems:'center', gap:6, color:'var(--green)' }}>
                    <i className="ti ti-arrow-down-circle" style={{ fontSize:16 }} />
                    Закупівлі ({purchases.length})
                  </div>
                  {purchases.map(m => (
                    <div key={m.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--bg)' }}>
                      <div>
                        <div style={{ fontWeight:500, fontSize:13 }}>{m.bank_transactions?.counterparty || m.description || '—'}</div>
                        <div style={{ fontSize:12, color:'var(--text2)' }}>{m.date}</div>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontWeight:500, color:'var(--green)' }}>{fmt(m.quantity)} {detail.unit} × {m.price ? fmt(m.price) + ' грн' : '—'}</div>
                        <div style={{ fontSize:12, color:'var(--text2)' }}>{m.total ? fmtInt(m.total) + ' грн' : '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sales */}
              {sales.length > 0 && (
                <div className="card" style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight:600, fontSize:14, marginBottom:10, display:'flex', alignItems:'center', gap:6, color:'var(--red)' }}>
                    <i className="ti ti-arrow-up-circle" style={{ fontSize:16 }} />
                    Реалізації ({sales.length})
                  </div>
                  {sales.map(m => (
                    <div key={m.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--bg)' }}>
                      <div>
                        <div style={{ fontWeight:500, fontSize:13 }}>{m.bank_transactions?.counterparty || m.description || '—'}</div>
                        <div style={{ fontSize:12, color:'var(--text2)' }}>{m.date}</div>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontWeight:500, color:'var(--red)' }}>{fmt(m.quantity)} {detail.unit} × {m.price ? fmt(m.price) + ' грн' : '—'}</div>
                        <div style={{ fontSize:12, color:'var(--text2)' }}>{m.total ? fmtInt(m.total) + ' грн' : '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        })()}

        {/* Full movement history */}
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'16px 20px', fontWeight:600, fontSize:14, borderBottom:'1px solid var(--border)' }}>
            Повна історія руху ({detailMovements.length})
          </div>
          {detailMovements.length === 0 ? (
            <div className="empty"><p>Немає руху товару</p></div>
          ) : (
            <div className="tbl-wrap" style={{ border:'none' }}>
              <table>
                <thead><tr><th>Дата</th><th>Тип</th><th>Контрагент</th><th style={{ textAlign:'right' }}>Кількість</th><th style={{ textAlign:'right' }}>Ціна</th><th style={{ textAlign:'right' }}>Сума</th><th>Документ</th></tr></thead>
                <tbody>
                  {detailMovements.map(m => (
                    <tr key={m.id}>
                      <td style={{ fontSize:13, color:'var(--text2)', whiteSpace:'nowrap' }}>{m.date}</td>
                      <td>
                        <span style={{
                          fontSize:12, fontWeight:500, padding:'2px 8px', borderRadius:6,
                          background: m.type==='in' ? 'var(--green-bg)' : m.type==='out' ? 'var(--red-bg)' : 'var(--surface2)',
                          color: m.type==='in' ? 'var(--green)' : m.type==='out' ? 'var(--red)' : 'var(--text2)',
                        }}>{m.type==='in' ? 'Прихід' : m.type==='out' ? 'Витрата' : 'Коригування'}</span>
                      </td>
                      <td style={{ fontSize:13, color:'var(--text2)', maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {m.bank_transactions?.counterparty || '—'}
                      </td>
                      <td style={{ textAlign:'right', fontWeight:500, color: m.type==='in' ? 'var(--green)' : 'var(--red)', fontVariantNumeric:'tabular-nums' }}>
                        {m.type==='in' ? '+' : '-'}{fmt(m.quantity)}
                      </td>
                      <td style={{ textAlign:'right', color:'var(--text2)', fontVariantNumeric:'tabular-nums' }}>{m.price ? fmt(m.price) + ' грн' : '—'}</td>
                      <td style={{ textAlign:'right', color:'var(--text2)', fontVariantNumeric:'tabular-nums' }}>{m.total ? fmtInt(m.total) + ' грн' : '—'}</td>
                      <td>
                        {m.documents ? (
                          <button onClick={() => openDocPreview(m.documents)} style={{
                            background:'none', border:'1px solid var(--border)', borderRadius:6,
                            padding:'4px 8px', cursor:'pointer', fontSize:12, color:'var(--blue)',
                            display:'flex', alignItems:'center', gap:4, fontFamily:'inherit',
                          }}>
                            <i className="ti ti-file-text" style={{ fontSize:13 }} />
                            {m.documents.file_name?.substring(0, 20) || 'Документ'}
                          </button>
                        ) : (
                          <span style={{ fontSize:12, color:'var(--text3)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add movement modal */}
        {/* Document preview */}
        {previewDoc && (
          <div className="modal-bg" onClick={e => e.target===e.currentTarget && setPreviewDoc(null)} style={{ zIndex:1100 }}>
            <div className="modal modal-xl" style={{ padding:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', borderBottom:'1px solid var(--border)' }}>
                <i className="ti ti-file-text" style={{ fontSize:20, color:'var(--blue)' }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{previewDoc.file_name}</div>
                </div>
                <button className="modal-close" onClick={() => setPreviewDoc(null)}>×</button>
              </div>
              <div style={{ flex:1, overflow:'auto', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', minHeight:400 }}>
                {previewUrl ? (
                  previewDoc.file_type === 'application/pdf' ? (
                    <iframe src={previewUrl} style={{ width:'100%', height:'75vh', border:'none' }} title={previewDoc.file_name} />
                  ) : (
                    <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth:'100%', maxHeight:'75vh', objectFit:'contain' }} />
                  )
                ) : (
                  <div style={{ color:'var(--text3)', padding:40 }}>Завантаження...</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Merge modal */}
        {showMerge && (
          <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowMerge(false)}>
            <div className="modal modal-lg">
              <div className="modal-header">
                <h2>Об'єднати з іншим товаром</h2>
                <button className="modal-close" onClick={() => setShowMerge(false)}>×</button>
              </div>
              <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 16px', marginBottom:16, fontSize:13 }}>
                <strong>Основний товар:</strong> {detail.name}
                <div style={{ color:'var(--text2)', marginTop:4 }}>Всі рухи та позиції з обраного товару будуть перенесені сюди. Дублікат буде архівовано.</div>
              </div>
              <div style={{ position:'relative', marginBottom:12 }}>
                <i className="ti ti-search" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:16 }} />
                <input className="form-input" style={{ width:'100%', paddingLeft:38 }}
                  placeholder="Знайти товар для об'єднання..."
                  value={mergeSearch} onChange={e => setMergeSearch(e.target.value)} />
              </div>
              {mergeSearch.length >= 2 && (
                <div style={{ maxHeight:300, overflowY:'auto', display:'flex', flexDirection:'column', gap:6 }}>
                  {products.filter(p => p.id !== detail.id && p.name.toLowerCase().includes(mergeSearch.toLowerCase())).map(p => (
                    <div key={p.id} onClick={() => setMergeTarget(p)} style={{
                      padding:'10px 14px', borderRadius:8, cursor:'pointer',
                      border: mergeTarget?.id === p.id ? '2px solid var(--blue)' : '1px solid var(--border)',
                      background: mergeTarget?.id === p.id ? 'var(--blue-bg)' : 'var(--surface)',
                    }}>
                      <div style={{ fontWeight:500, fontSize:14 }}>{p.name}</div>
                      <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>
                        Залишок: {fmt(p.current_stock)} {p.unit} · {p.sku || 'без SKU'}
                      </div>
                    </div>
                  ))}
                  {products.filter(p => p.id !== detail.id && p.name.toLowerCase().includes(mergeSearch.toLowerCase())).length === 0 && (
                    <div style={{ padding:20, textAlign:'center', color:'var(--text3)' }}>Не знайдено</div>
                  )}
                </div>
              )}
              {mergeTarget && (
                <div style={{ marginTop:12, padding:'12px 16px', background:'var(--red-bg)', borderRadius:8, fontSize:13, color:'var(--red)' }}>
                  <i className="ti ti-alert-triangle" style={{ marginRight:6 }} />
                  <strong>"{mergeTarget.name}"</strong> буде архівовано, всі його рухи перенесуться до <strong>"{detail.name}"</strong>
                </div>
              )}
              <div className="btn-row">
                <button className="btn btn-primary" onClick={handleMerge} disabled={saving || !mergeTarget} style={{ width:'auto' }}>
                  {saving ? 'Об\'єднання...' : 'Об\'єднати'}
                </button>
                <button className="btn btn-secondary" onClick={() => setShowMerge(false)} style={{ width:'auto' }}>Скасувати</button>
              </div>
            </div>
          </div>
        )}

        {showMovement && (
          <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowMovement(false)}>
            <div className="modal">
              <div className="modal-header">
                <h2>Рух товару: {detail.name}</h2>
                <button className="modal-close" onClick={() => setShowMovement(false)}>×</button>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Тип</label>
                  <select className="form-input" value={movForm.type} onChange={e => setMovForm(f=>({...f,type:e.target.value}))}>
                    <option value="in">Прихід</option>
                    <option value="out">Витрата</option>
                    <option value="adjustment">Коригування</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Дата</label>
                  <input type="date" className="form-input" value={movForm.date} onChange={e => setMovForm(f=>({...f,date:e.target.value}))} />
                </div>
                <div className="form-group">
                  <label>Кількість ({detail.unit}) *</label>
                  <input type="number" className="form-input" value={movForm.quantity} onChange={e => setMovForm(f=>({...f,quantity:e.target.value}))} placeholder="0" />
                </div>
                <div className="form-group">
                  <label>Ціна за одиницю, грн</label>
                  <input type="number" className="form-input" value={movForm.price} onChange={e => setMovForm(f=>({...f,price:e.target.value}))} placeholder="0.00" />
                </div>
                <div className="form-group full">
                  <label>Опис</label>
                  <input className="form-input" value={movForm.description} onChange={e => setMovForm(f=>({...f,description:e.target.value}))} placeholder="Прихідна накладна №..." />
                </div>
              </div>
              {movForm.quantity && movForm.price && (
                <div style={{ background:'var(--surface2)', borderRadius:8, padding:'10px 14px', marginTop:8, fontSize:13, color:'var(--text2)' }}>
                  Сума: <strong>{fmtInt(parseFloat(movForm.quantity) * parseFloat(movForm.price))} грн</strong>
                </div>
              )}
              <div className="btn-row">
                <button className="btn btn-primary" onClick={handleAddMovement} disabled={saving||!movForm.quantity} style={{ width:'auto' }}>
                  {saving ? 'Збереження...' : 'Зберегти'}
                </button>
                <button className="btn btn-secondary" onClick={() => setShowMovement(false)} style={{ width:'auto' }}>Скасувати</button>
              </div>
            </div>
          </div>
        )}

        {showForm && renderForm()}
      </div>
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
        <button className="btn btn-primary" onClick={openAdd} style={{ width:'auto' }}>
          <i className="ti ti-plus" style={{ fontSize:15 }} /> Додати товар
        </button>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(5,1fr)', marginBottom:20 }}>
        <div className="kpi"><div className="kpi-label">Всього товарів</div><div className="kpi-value">{kpi.total}</div></div>
        <div className="kpi"><div className="kpi-label">В наявності</div><div className="kpi-value" style={{ color:'var(--green)' }}>{kpi.inStock}</div></div>
        <div className="kpi"><div className="kpi-label">Низький залишок</div><div className="kpi-value" style={{ color:'#D97706' }}>{kpi.lowStock}</div></div>
        <div className="kpi"><div className="kpi-label">Відсутні</div><div className="kpi-value" style={{ color:'var(--red)' }}>{kpi.outOfStock}</div></div>
        <div className="kpi"><div className="kpi-label">Вартість складу</div><div className="kpi-value">{fmtInt(kpi.totalValue)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>грн</span></div></div>
      </div>

      {/* Search + filter */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ flex:1, position:'relative', minWidth:200 }}>
          <i className="ti ti-search" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:16 }} />
          <input className="form-input" style={{ width:'100%', paddingLeft:38 }} placeholder="Пошук по назві або SKU..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setFilterCat('')} className={`btn btn-sm ${!filterCat?'btn-primary':'btn-secondary'}`} style={{ width:'auto' }}>Всі</button>
        {categories.map(c => (
          <button key={c} onClick={() => setFilterCat(c)} className={`btn btn-sm ${filterCat===c?'btn-primary':'btn-secondary'}`} style={{ width:'auto' }}>{c}</button>
        ))}
      </div>

      {/* Table */}
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Назва</th>
              <th>SKU</th>
              <th>Категорія</th>
              <th style={{ textAlign:'right' }}>Залишок</th>
              <th style={{ textAlign:'right' }}>Ціна закуп.</th>
              <th style={{ textAlign:'right' }}>Вартість</th>
              <th style={{ width:80 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:32, color:'var(--text3)' }}>Немає товарів</td></tr>}
            {filtered.map(p => {
              const stockColor = p.current_stock <= 0 ? 'var(--red)' : p.current_stock <= (p.min_stock||0) ? '#D97706' : 'var(--green)'
              return (
                <tr key={p.id} style={{ cursor:'pointer' }} onClick={() => openDetail(p)}>
                  <td><div style={{ fontWeight:500, fontSize:14 }}>{p.name}</div></td>
                  <td style={{ fontSize:13, color:'var(--text2)' }}>{p.sku || '—'}</td>
                  <td style={{ fontSize:13, color:'var(--text2)' }}>{p.category || '—'}</td>
                  <td style={{ textAlign:'right', fontWeight:500, color: stockColor, fontVariantNumeric:'tabular-nums' }}>
                    {fmt(p.current_stock)} {p.unit}
                  </td>
                  <td style={{ textAlign:'right', color:'var(--text2)', fontVariantNumeric:'tabular-nums' }}>{p.buy_price ? fmtInt(p.buy_price)+' грн' : '—'}</td>
                  <td style={{ textAlign:'right', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{p.buy_price ? fmtInt((p.current_stock||0)*p.buy_price)+' грн' : '—'}</td>
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
    </div>
  )
}

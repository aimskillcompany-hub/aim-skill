import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtInt } from '../lib/fmt'

export default function ProductDetail({
  detail, detailMovements, detailAliases, products,
  onBack, onEdit, onMerge, onAddMovement, onLoadAll, renderForm, showForm
}) {
  const [movFilter, setMovFilter] = useState('all')
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [showMerge, setShowMerge] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeTarget, setMergeTarget] = useState(null)
  const [showMovement, setShowMovement] = useState(false)
  const [movForm, setMovForm] = useState({ type:'in', quantity:'', price:'', description:'', date:new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)

  const totalIn = detailMovements.filter(m => m.type === 'in').reduce((s, m) => s + (m.quantity || 0), 0)
  const totalOut = detailMovements.filter(m => m.type === 'out').reduce((s, m) => s + (m.quantity || 0), 0)
  const purchases = detailMovements.filter(m => m.type === 'in')
  const sales = detailMovements.filter(m => m.type === 'out')
  const totalBought = purchases.reduce((s, m) => s + (m.total || (m.quantity * (m.price || 0)) || 0), 0)
  const totalSold = sales.reduce((s, m) => s + (m.total || (m.quantity * (m.price || 0)) || 0), 0)
  const margin = totalSold - totalBought
  const lastPurchase = purchases[purchases.length - 1]
  const lastSale = sales[sales.length - 1]
  const avgBuyPrice = totalIn > 0 ? totalBought / totalIn : (lastPurchase?.price || detail.buy_price || 0)
  const avgSellPrice = totalOut > 0 ? totalSold / totalOut : (detail.sell_price || 0)
  const stockValue = (detail.computed_stock || 0) * (avgBuyPrice || detail.buy_price || 0)
  const isNegative = detail.computed_stock < 0
  const isLow = detail.computed_stock > 0 && detail.computed_stock <= (detail.min_stock || 0)
  const stockColor = isNegative ? 'var(--red)' : isLow ? '#D97706' : 'var(--green)'

  const infoField = (label, value) => value ? (
    <div style={{ display:'flex', gap:6, fontSize:13, marginBottom:4 }}>
      <span style={{ color:'var(--text3)', minWidth:80 }}>{label}</span>
      <span style={{ color:'var(--text)' }}>{value}</span>
    </div>
  ) : null

  const openDocPreview = async (doc) => {
    if (!doc?.file_path) return
    setPreviewDoc(doc)
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 300)
    setPreviewUrl(data?.signedUrl || null)
  }

  const handleMerge = async () => {
    if (!mergeTarget) return
    if (!confirm(`Об'єднати "${mergeTarget.name}" → "${detail.name}"?\n\nВсі рухи, позиції та аліаси будуть перенесені. Цю дію неможливо скасувати.`)) return
    setSaving(true)
    await supabase.from('stock_movements').update({ product_id: detail.id }).eq('product_id', mergeTarget.id)
    await supabase.from('transaction_items').update({ product_id: detail.id }).eq('product_id', mergeTarget.id)
    await supabase.from('product_aliases').update({ product_id: detail.id }).eq('product_id', mergeTarget.id)
    await supabase.from('products').update({ status: 'archived' }).eq('id', mergeTarget.id)
    // Перерахувати FIFO після об'єднання рухів
    const { recalcFifoForProduct } = await import('../lib/stockService')
    await recalcFifoForProduct(detail.id)
    setSaving(false); setShowMerge(false); onLoadAll?.()
  }

  const handleAddMovement = async () => {
    const qty = parseFloat(movForm.quantity) || 0
    if (qty <= 0) return
    setSaving(true)
    await supabase.from('stock_movements').insert({
      product_id: detail.id, type: movForm.type, quantity: qty,
      price: parseFloat(movForm.price) || null,
      total: qty * (parseFloat(movForm.price) || 0) || null,
      date: movForm.date, description: movForm.description || null,
      source: 'manual',
    })
    setSaving(false); setShowMovement(false); onAddMovement?.()
  }

  return (
    <div>
      {/* ШАПКА */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        <button onClick={onBack} className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
          <i className="ti ti-arrow-left" style={{ fontSize:16 }} /> Назад
        </button>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <h1 style={{ fontSize:22, fontWeight:600, margin:0 }}>{detail.name}</h1>
            {detail._isAssembly && <span style={{ fontSize:10, background:'#F0E6FF', color:'#7C3AED', padding:'2px 6px', borderRadius:4 }}>збірка</span>}
            {detail.product_type === 'service' && <span style={{ fontSize:10, background:'var(--blue-bg)', color:'var(--blue)', padding:'2px 6px', borderRadius:4 }}>послуга</span>}
            {detail.product_type === 'expense' && <span style={{ fontSize:10, background:'var(--amber-bg)', color:'var(--amber)', padding:'2px 6px', borderRadius:4 }}>госп.</span>}
            {detail.is_verified && <i className="ti ti-circle-check-filled" style={{ fontSize:16, color:'var(--green)' }} />}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={async () => {
            const v = !detail.is_verified
            await supabase.from('products').update({ is_verified: v }).eq('id', detail.id)
            onLoadAll?.()
          }} className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className={`ti ${detail.is_verified ? 'ti-circle-check-filled' : 'ti-circle-check'}`} style={{ fontSize:14, color: detail.is_verified ? 'var(--green)' : undefined }} />
          </button>
          <button onClick={onEdit} className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className="ti ti-pencil" style={{ fontSize:14 }} /> Редагувати
          </button>
          <button onClick={() => { setShowMerge(true); setMergeSearch(''); setMergeTarget(null) }}
            className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className="ti ti-arrows-merge" style={{ fontSize:14 }} /> Обʼєднати
          </button>
          <button onClick={() => setShowMovement(true)}
            className="btn btn-primary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className="ti ti-plus" style={{ fontSize:14 }} /> Рух
          </button>
        </div>
      </div>

      {/* ALERT */}
      {isNegative && (
        <div style={{ background:'var(--red-bg)', border:'1px solid var(--red)', borderRadius:10, padding:'10px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>
          <i className="ti ti-alert-triangle" style={{ fontSize:18, color:'var(--red)' }} />
          <div>
            <div style={{ fontWeight:600, color:'var(--red)', fontSize:13 }}>Негативний залишок: {fmt(detail.computed_stock)} {detail.unit}</div>
            <div style={{ fontSize:12, color:'var(--red)' }}>Відсутня закупка або неправильний рух. Потрібна корекція.</div>
          </div>
        </div>
      )}

      {/* ІНФОРМАЦІЯ + ЦІНИ */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10, display:'flex', alignItems:'center', gap:6, color:'var(--text2)' }}>
            <i className="ti ti-info-circle" style={{ fontSize:15 }} /> Інформація
          </div>
          {infoField('Виробник', detail.manufacturer)}
          {infoField('SKU', detail.sku)}
          {infoField('УКТЗЕД', detail.uktzed)}
          {infoField('Категорія', detail.category)}
          {infoField('Одиниця', detail.unit)}
          {infoField('Мін. залишок', detail.min_stock > 0 ? `${detail.min_stock} ${detail.unit}` : null)}
          {detailAliases.length > 0 && (
            <div style={{ marginTop:6 }}>
              <div style={{ fontSize:11, color:'var(--amber)', display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}
                onClick={e => { const el = e.currentTarget.nextSibling; if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none' }}>
                <i className="ti ti-alert-circle" style={{ fontSize:12 }} /> {detailAliases.length} альтернативних назв ▾
              </div>
              <div style={{ display:'none' }}>
                {detailAliases.map((a, i) => <div key={i} style={{ fontSize:10, color:'var(--text3)', paddingLeft:16, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:280 }} title={a}>{a}</div>)}
              </div>
            </div>
          )}
          {detail.notes && <div style={{ marginTop:8, fontSize:12, color:'var(--text2)', fontStyle:'italic' }}>{detail.notes}</div>}
        </div>

        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10, display:'flex', alignItems:'center', gap:6, color:'var(--text2)' }}>
            <i className="ti ti-currency-hryvnia" style={{ fontSize:15 }} /> Ціни
          </div>
          <div style={{ display:'grid', gridTemplateColumns: avgSellPrice > 0 ? '1fr 1fr' : '1fr', gap:10 }}>
            <div>
              <div style={{ fontSize:11, color:'var(--text3)' }}>Сер. закупка (без ПДВ)</div>
              <div style={{ fontSize:18, fontWeight:600 }}>{avgBuyPrice > 0 ? fmt(avgBuyPrice) + ' грн' : '—'}</div>
              {lastPurchase && <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>остання: {fmt(lastPurchase.price||0)} грн · {lastPurchase.date}</div>}
            </div>
            {avgSellPrice > 0 && <div>
              <div style={{ fontSize:11, color:'var(--text3)' }}>Сер. продаж (без ПДВ)</div>
              <div style={{ fontSize:18, fontWeight:600 }}>{fmt(avgSellPrice)} грн</div>
              {lastSale && <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>остання: {fmt(lastSale.price||0)} грн · {lastSale.date}</div>}
            </div>}
          </div>
          {avgBuyPrice > 0 && avgSellPrice > 0 && (
            <div style={{ marginTop:10, paddingTop:8, borderTop:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, color:'var(--text3)' }}>Маржа (без ПДВ)</div>
              <div style={{ fontSize:15, fontWeight:600, color: avgSellPrice > avgBuyPrice ? 'var(--green)' : 'var(--red)' }}>
                {avgSellPrice > avgBuyPrice ? '+' : ''}{fmtInt(avgSellPrice - avgBuyPrice)} грн ({((avgSellPrice - avgBuyPrice) / avgBuyPrice * 100).toFixed(0)}%)
              </div>
            </div>
          )}
          {stockValue > 0 && (
            <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, color:'var(--text3)' }}>Вартість залишку</div>
              <div style={{ fontSize:15, fontWeight:600 }}>{fmtInt(stockValue)} грн</div>
            </div>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(4,1fr)', marginBottom:16 }}>
        <div className="kpi" style={{ borderLeft: isNegative ? '3px solid var(--red)' : isLow ? '3px solid #D97706' : undefined }}>
          <div className="kpi-label">Залишок</div>
          <div className="kpi-value" style={{ color: stockColor }}>{fmt(detail.computed_stock)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>{detail.unit}</span></div>
        </div>
        <div className="kpi"><div className="kpi-label">Закуплено</div><div className="kpi-value" style={{ color:'var(--green)' }}>+{fmt(totalIn)}</div><div className="kpi-sub">{fmtInt(totalBought)} грн</div></div>
        <div className="kpi"><div className="kpi-label">Реалізовано</div><div className="kpi-value" style={{ color:'var(--red)' }}>-{fmt(totalOut)}</div><div className="kpi-sub">{fmtInt(totalSold)} грн</div></div>
        <div className="kpi"><div className="kpi-label">Маржа</div><div className="kpi-value" style={{ color: margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{margin >= 0 ? '+' : '-'}{fmtInt(Math.abs(margin))} грн</div>{totalBought > 0 && <div className="kpi-sub">{((margin / totalBought) * 100).toFixed(0)}%</div>}</div>
      </div>

      {/* ІСТОРІЯ РУХУ */}
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', fontWeight:600, fontSize:14, borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>Історія руху ({detailMovements.length})</span>
          <div style={{ display:'flex', gap:4 }}>
            {[{ id:'all', label:'Все' }, { id:'in', label:'Прихід', color:'var(--green)' }, { id:'out', label:'Витрата', color:'var(--red)' }].map(f => (
              <button key={f.id} onClick={() => setMovFilter(f.id)}
                style={{ fontSize:11, padding:'3px 10px', borderRadius:6, border:'1px solid var(--border)', cursor:'pointer', fontFamily:'inherit',
                  background: movFilter === f.id ? (f.color || 'var(--blue)') : 'var(--surface)',
                  color: movFilter === f.id ? '#fff' : 'var(--text2)',
                }}>{f.label}</button>
            ))}
          </div>
        </div>
        {detailMovements.length === 0 ? (
          <div className="empty"><p>Немає руху товару</p></div>
        ) : (
          <div className="tbl-wrap" style={{ border:'none' }}>
            <table>
              <thead><tr><th>Дата</th><th>Тип</th><th>Контрагент</th><th style={{ textAlign:'right' }}>Кількість</th><th style={{ textAlign:'right' }}>Ціна</th><th style={{ textAlign:'right' }}>Сума</th><th>Документ</th></tr></thead>
              <tbody>
                {detailMovements.filter(m => movFilter === 'all' || m.type === movFilter).map(m => (
                  <tr key={m.id}>
                    <td style={{ fontSize:13, color:'var(--text2)', whiteSpace:'nowrap' }}>{m.date}</td>
                    <td>
                      <span style={{ fontSize:12, fontWeight:500, padding:'2px 8px', borderRadius:6,
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
                      {m.documents?.length > 0 ? (
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                          {m.documents.map((doc, di) => (
                            <button key={di} onClick={() => openDocPreview(doc)} style={{
                              background:'none', border:'1px solid var(--border)', borderRadius:6,
                              padding:'4px 8px', cursor:'pointer', fontSize:12, color:'var(--blue)',
                              display:'flex', alignItems:'center', gap:4, fontFamily:'inherit',
                            }}>
                              <i className="ti ti-file-text" style={{ fontSize:13 }} />{m.documents.length > 1 ? `Док ${di+1}` : 'Документ'}
                            </button>
                          ))}
                        </div>
                      ) : <span style={{ fontSize:12, color:'var(--text3)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preview modal */}
      {previewDoc && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setPreviewDoc(null)} style={{ zIndex:1100 }}>
          <div className="modal modal-xl" style={{ padding:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ flex:1, fontWeight:600, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{previewDoc.file_name}</div>
              <button className="modal-close" onClick={() => setPreviewDoc(null)} aria-label="Закрити">×</button>
            </div>
            <div style={{ flex:1, overflow:'auto', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', minHeight:400 }}>
              {previewUrl ? (
                previewDoc.file_type === 'application/pdf'
                  ? <iframe src={previewUrl} style={{ width:'100%', height:'75vh', border:'none' }} title={previewDoc.file_name} />
                  : <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth:'100%', maxHeight:'75vh', objectFit:'contain' }} />
              ) : <div style={{ color:'var(--text3)', padding:40 }} aria-live="polite">Завантаження...</div>}
            </div>
          </div>
        </div>
      )}

      {/* Merge modal */}
      {showMerge && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowMerge(false)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2>Обʼєднати з іншим товаром</h2>
              <button className="modal-close" onClick={() => setShowMerge(false)} aria-label="Закрити">×</button>
            </div>
            <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 16px', marginBottom:16, fontSize:13 }}>
              <strong>Основний товар:</strong> {detail.name}
            </div>
            <input className="form-input" style={{ width:'100%', marginBottom:12 }}
              placeholder="Знайти товар для обʼєднання..." value={mergeSearch} onChange={e => setMergeSearch(e.target.value)} />
            {mergeSearch.length >= 2 && (
              <div style={{ maxHeight:300, overflowY:'auto', display:'flex', flexDirection:'column', gap:6 }}>
                {(products || []).filter(p => p.id !== detail.id && p.name.toLowerCase().includes(mergeSearch.toLowerCase())).map(p => (
                  <div key={p.id} onClick={() => setMergeTarget(p)} style={{
                    padding:'10px 14px', borderRadius:8, cursor:'pointer',
                    border: mergeTarget?.id === p.id ? '2px solid var(--blue)' : '1px solid var(--border)',
                  }}>
                    <div style={{ fontWeight:500 }}>{p.name}</div>
                    <div style={{ fontSize:12, color:'var(--text2)' }}>Залишок: {fmt(p.computed_stock)} {p.unit}</div>
                  </div>
                ))}
              </div>
            )}
            {mergeTarget && (
              <div style={{ marginTop:12, padding:'12px', background:'var(--red-bg)', borderRadius:8, fontSize:13, color:'var(--red)' }}>
                <strong>"{mergeTarget.name}"</strong> → архів, рухи → <strong>"{detail.name}"</strong>
              </div>
            )}
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleMerge} disabled={saving||!mergeTarget} style={{ width:'auto' }}>{saving ? '...' : 'Обʼєднати'}</button>
              <button className="btn btn-secondary" onClick={() => setShowMerge(false)} style={{ width:'auto' }}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* Movement modal */}
      {showMovement && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowMovement(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2>Рух товару</h2>
              <button className="modal-close" onClick={() => setShowMovement(false)} aria-label="Закрити">×</button>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Тип</label>
                <select className="form-input" value={movForm.type} onChange={e => setMovForm(f=>({...f,type:e.target.value}))}>
                  <option value="in">Прихід</option><option value="out">Витрата</option><option value="adjustment">Коригування</option>
                </select>
              </div>
              <div className="form-group"><label>Дата</label><input type="date" className="form-input" value={movForm.date} onChange={e => setMovForm(f=>({...f,date:e.target.value}))} /></div>
              <div className="form-group"><label>Кількість *</label><input type="number" className="form-input" value={movForm.quantity} onChange={e => setMovForm(f=>({...f,quantity:e.target.value}))} /></div>
              <div className="form-group"><label>Ціна, грн</label><input type="number" className="form-input" value={movForm.price} onChange={e => setMovForm(f=>({...f,price:e.target.value}))} /></div>
              <div className="form-group full"><label>Опис</label><input className="form-input" value={movForm.description} onChange={e => setMovForm(f=>({...f,description:e.target.value}))} /></div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleAddMovement} disabled={saving||!movForm.quantity} style={{ width:'auto' }}>{saving ? '...' : 'Зберегти'}</button>
              <button className="btn btn-secondary" onClick={() => setShowMovement(false)} style={{ width:'auto' }}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {showForm && renderForm?.()}
    </div>
  )
}

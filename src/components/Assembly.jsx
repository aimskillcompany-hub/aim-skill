import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { assembleProduct, getFifoCost } from '../lib/stockService'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(Math.round(Math.abs(n || 0)))
const fmtDate = d => d ? new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

export default function Assembly({ user }) {
  const [products, setProducts] = useState([])
  const [assemblies, setAssemblies] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // list | create | detail
  const [selectedId, setSelectedId] = useState(null)

  // Create form
  const [name, setName] = useState('')
  const [resultProductId, setResultProductId] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [components, setComponents] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Product search
  const [prodSearch, setProdSearch] = useState('')
  const [nameSearch, setNameSearch] = useState('')

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: prods }, { data: asms }] = await Promise.all([
      supabase.from('product_stock').select('id, name, computed_stock, unit, buy_price, product_type')
        .eq('status', 'active').eq('product_type', 'goods').order('name'),
      supabase.from('assemblies').select('*, assembly_items(*, products(name, unit))')
        .order('assembled_at', { ascending: false }).limit(50),
    ])
    setProducts(prods || [])
    setAssemblies(asms || [])
    setLoading(false)
  }

  const addComponent = async (product) => {
    if (components.find(c => c.productId === product.id)) return
    const costPrice = await getFifoCost(product.id, 1) || product.buy_price || 0
    setComponents(prev => [...prev, {
      productId: product.id,
      productName: product.name,
      qty: 1,
      stock: product.computed_stock || 0,
      unit: product.unit || 'шт',
      costPrice,
      total: costPrice,
    }])
    setProdSearch('')
  }

  const updateCompQty = async (idx, newQty) => {
    const q = parseFloat(newQty) || 0
    setComponents(prev => prev.map((c, i) => i === idx ? { ...c, qty: q, total: q * c.costPrice } : c))
  }

  const removeComp = (idx) => {
    setComponents(prev => prev.filter((_, i) => i !== idx))
  }

  const totalCost = components.reduce((s, c) => s + c.total * quantity, 0)

  // ── Скасувати збірку ──
  const handleDelete = async (assembly) => {
    if (!confirm(`Скасувати збірку "${assembly.name}"?\n\nКомпоненти повернуться на склад, готовий виріб буде списаний.`)) return
    setSaving(true)
    setError(null)

    try {
      // Видалити stock_movements повʼязані зі збіркою (description містить "Збірка:")
      const { data: movements } = await supabase.from('stock_movements')
        .select('id')
        .or(`description.ilike.%Збірка: ${assembly.name}%`)
        .eq('date', assembly.assembled_at)

      if (movements?.length) {
        await supabase.from('stock_movements').delete().in('id', movements.map(m => m.id))
      }

      // Видалити assembly_items
      await supabase.from('assembly_items').delete().eq('assembly_id', assembly.id)

      // Видалити assembly
      await supabase.from('assemblies').delete().eq('id', assembly.id)

      setSuccess(`Збірку "${assembly.name}" скасовано`)
      if (view === 'detail') setView('list')
      loadAll()
    } catch (e) {
      setError('Помилка: ' + e.message)
    }
    setSaving(false)
  }

  const handleAssemble = async () => {
    if (!name.trim()) { setError('Вкажіть назву виробу'); return }
    if (components.length === 0) { setError('Додайте компоненти'); return }
    setSaving(true)
    setError(null)
    setSuccess(null)

    const result = await assembleProduct({
      name: name.trim(), resultProductId, quantity,
      components, date, notes, userId: user.id,
    })

    if (result.error) {
      setError(result.error)
    } else {
      setSuccess(`Збірку "${name}" проведено. Собівартість: ${fmt(result.totalCost)} грн`)
      setName(''); setResultProductId(null); setQuantity(1); setNotes('')
      setComponents([]); setDate(new Date().toISOString().split('T')[0])
      loadAll()
    }
    setSaving(false)
  }

  const searchResults = prodSearch.length >= 2
    ? products.filter(p => p.name.toLowerCase().includes(prodSearch.toLowerCase()) && !components.find(c => c.productId === p.id)).slice(0, 8)
    : []

  const nameResults = nameSearch.length >= 2
    ? products.filter(p => p.name.toLowerCase().includes(nameSearch.toLowerCase())).slice(0, 5)
    : []

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Завантаження...</div>

  // ═══ CREATE VIEW ═══
  if (view === 'create') return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Нова збірка</h1>
          <p>Зберіть готовий виріб з компонентів зі складу</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setView('list')}>← Назад</button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div>}
      {success && <div className="alert alert-success" style={{ marginBottom: 14 }}>{success}</div>}

      {/* Блок 1 — Готовий виріб */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className="ti ti-package" style={{ fontSize: 16, color: 'var(--blue)' }} />
          Готовий виріб
        </div>
        <div className="form-grid">
          <div className="form-group" style={{ position: 'relative' }}>
            <label>Назва виробу *</label>
            <input className="form-input" value={name}
              onChange={e => { setName(e.target.value); setNameSearch(e.target.value); setResultProductId(null) }}
              placeholder="Наприклад: Процесорний блок для відеомонтажу" />
            {nameResults.length > 0 && !resultProductId && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 10, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
                {nameResults.map(p => (
                  <div key={p.id} onClick={() => { setName(p.name); setResultProductId(p.id); setNameSearch('') }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    {p.name}
                    <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>{p.computed_stock} {p.unit} на складі</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Кількість</label>
            <input type="number" className="form-input" value={quantity} onChange={e => setQuantity(parseFloat(e.target.value) || 1)} min={1} />
          </div>
          <div className="form-group">
            <label>Дата збірки</label>
            <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Нотатки</label>
            <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Опціонально" />
          </div>
        </div>
        {resultProductId && (
          <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 4 }}>
            <i className="ti ti-check" style={{ fontSize: 12 }} /> Існуючий товар на складі
          </div>
        )}
      </div>

      {/* Блок 2 — Компоненти */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className="ti ti-list-details" style={{ fontSize: 16, color: 'var(--blue)' }} />
          Компоненти ({components.length})
        </div>

        {/* Пошук */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <input className="form-input" value={prodSearch}
            onChange={e => setProdSearch(e.target.value)}
            placeholder="Пошук товару зі складу..." />
          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 10, maxHeight: 240, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
              {searchResults.map(p => (
                <div key={p.id} onClick={() => addComponent(p)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <span>{p.name}</span>
                  <span style={{ color: p.computed_stock > 0 ? 'var(--green)' : 'var(--red)', fontSize: 12 }}>{p.computed_stock} {p.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Таблиця компонентів */}
        {components.length > 0 && (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Компонент</th>
                  <th style={{ textAlign: 'right' }}>К-сть</th>
                  <th>Од.</th>
                  <th style={{ textAlign: 'right' }}>Залишок</th>
                  <th style={{ textAlign: 'right' }}>FIFO ціна</th>
                  <th style={{ textAlign: 'right' }}>Сума</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {components.map((c, i) => {
                  const warn = c.stock < c.qty * quantity
                  return (
                    <tr key={c.productId} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ fontSize: 13, fontWeight: 500 }}>{c.productName}</td>
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" className="form-input" value={c.qty}
                          onChange={e => updateCompQty(i, e.target.value)}
                          style={{ width: 70, textAlign: 'right', padding: '4px 8px' }} min={1} />
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>{c.unit}</td>
                      <td style={{ textAlign: 'right', color: warn ? 'var(--red)' : 'var(--green)', fontWeight: warn ? 600 : 400 }}>
                        {c.stock} {warn && <i className="ti ti-alert-triangle" style={{ fontSize: 12 }} />}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.costPrice)} грн</td>
                      <td style={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmt(c.total * quantity)} грн</td>
                      <td>
                        <button onClick={() => removeComp(i)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 16 }}>×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 600 }}>
                  <td colSpan={5}>Собівартість збірки</td>
                  <td style={{ textAlign: 'right' }}>{fmt(totalCost)} грн</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {components.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)', fontSize: 13 }}>
            Введіть назву товару в пошуку щоб додати компонент
          </div>
        )}
      </div>

      {/* Блок 3 — Підсумок */}
      {components.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Буде списано</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--red)' }}>
                {components.length} компонентів × {quantity} шт
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Буде оприбутковано</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--green)' }}>
                {name || '—'} × {quantity} шт
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Собівартість за од.</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {fmt(quantity > 0 ? totalCost / quantity : 0)} грн
              </div>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleAssemble} disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Проведення...' : `Провести збірку — ${fmt(totalCost)} грн`}
          </button>
        </div>
      )}
    </div>
  )

  // ═══ DETAIL VIEW ═══
  if (view === 'detail') {
    const a = assemblies.find(x => x.id === selectedId)
    if (!a) { setView('list'); return null }
    const items = a.assembly_items || []
    const unitCost = a.quantity > 0 ? a.total_cost / a.quantity : 0

    return (
      <div>
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>{a.name}</h1>
            <p>Збірка від {fmtDate(a.assembled_at)}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setView('list')}>← Назад</button>
            <button className="btn btn-secondary" style={{ color: 'var(--red)' }} onClick={() => handleDelete(a)} disabled={saving}>
              <i className="ti ti-trash" style={{ fontSize: 14 }} /> Скасувати збірку
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div>}
        {success && <div className="alert alert-success" style={{ marginBottom: 14 }}>{success}</div>}

        {/* Підсумок */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div className="card" style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Кількість</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{a.quantity} шт</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Собівартість за од.</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{fmt(unitCost)} грн</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Загальна собівартість</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--blue)' }}>{fmt(a.total_cost)} грн</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Компонентів</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{items.length}</div>
          </div>
        </div>

        {/* Компоненти */}
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ti ti-list-details" style={{ fontSize: 16, color: 'var(--blue)' }} />
            Компоненти збірки
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Компонент</th>
                  <th style={{ textAlign: 'right' }}>К-сть</th>
                  <th>Од.</th>
                  <th style={{ textAlign: 'right' }}>FIFO ціна</th>
                  <th style={{ textAlign: 'right' }}>Сума</th>
                </tr>
              </thead>
              <tbody>
                {items.map(ai => (
                  <tr key={ai.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ fontSize: 13, fontWeight: 500 }}>{ai.products?.name || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{ai.quantity}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{ai.products?.unit || 'шт'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(ai.cost_price)} грн</td>
                    <td style={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmt(ai.total)} грн</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 600 }}>
                  <td colSpan={4} style={{ padding: '10px 8px' }}>Разом</td>
                  <td style={{ textAlign: 'right', padding: '10px 8px' }}>{fmt(a.total_cost)} грн</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {a.notes && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text2)', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
              <strong>Нотатки:</strong> {a.notes}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ═══ LIST VIEW ═══
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Збірки</h1>
          <p>Складська збірка виробів з компонентів</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setView('create'); setError(null); setSuccess(null) }}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> Нова збірка
        </button>
      </div>

      {success && <div className="alert alert-success" style={{ marginBottom: 14 }}>{success}</div>}

      {assemblies.length === 0 ? (
        <div className="card">
          <div className="empty">
            <i className="ti ti-package-import" style={{ fontSize: 48, color: 'var(--text3)', display: 'block', margin: '0 auto 12px' }} />
            <p>Немає збірок. Натисніть «Нова збірка» щоб почати.</p>
          </div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Виріб</th>
                <th style={{ textAlign: 'right' }}>К-сть</th>
                <th style={{ textAlign: 'right' }}>Собівартість</th>
                <th style={{ textAlign: 'right' }}>За одиницю</th>
                <th>Компоненти</th>
                <th>Нотатки</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {assemblies.map(a => {
                const items = a.assembly_items || []
                const unitCost = a.quantity > 0 ? a.total_cost / a.quantity : 0
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => { setSelectedId(a.id); setView('detail'); setError(null); setSuccess(null) }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{fmtDate(a.assembled_at)}</td>
                    <td style={{ fontWeight: 500 }}>
                      {a.name}
                    </td>
                    <td style={{ textAlign: 'right' }}>{a.quantity}</td>
                    <td style={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(a.total_cost)} грн
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text2)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(unitCost)} грн
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                      <span style={{ background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
                        {items.length} комп.
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text3)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.notes || '—'}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleDelete(a)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, padding: '2px 4px' }}
                        title="Скасувати збірку">
                        <i className="ti ti-trash" style={{ fontSize: 15 }} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

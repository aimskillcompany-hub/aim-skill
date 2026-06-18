import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))

export default function ItemsTable({ items, onUpdateItem }) {
  const [products, setProducts] = useState([])
  useEffect(() => {
    supabase.from('product_stock').select('id, name, computed_stock, unit, product_type')
      .eq('status', 'active').order('name').then(({ data }) => setProducts(data || []))
  }, [])
  if (!items || items.length === 0) return null

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)', marginBottom: 6 }}>
        📦 Позиції ({items.length})
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px', minWidth: 160 }}>Назва</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', width: 60 }}>К-сть</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', width: 50 }}>Од.</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', width: 80 }}>Ціна</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', width: 80 }}>Сума</th>
              <th style={{ padding: '4px 8px', minWidth: 120 }}>Продукт</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id ?? i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 8px' }}>
                  {onUpdateItem ? (
                    <input style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontSize: 12, fontFamily: 'inherit' }}
                      value={it.name || ''} onChange={e => onUpdateItem(i, 'name', e.target.value)} />
                  ) : it.name}
                </td>
                <td style={{ textAlign: 'right', padding: '4px 8px' }}>
                  {onUpdateItem ? (
                    <input type="number" style={{ width: 55, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontSize: 12, textAlign: 'right', fontFamily: 'inherit' }}
                      value={it.quantity || ''} onChange={e => onUpdateItem(i, 'quantity', e.target.value)} />
                  ) : (it.quantity || '—')}
                </td>
                <td style={{ padding: '4px 8px', color: 'var(--text3)' }}>{it.unit || 'шт'}</td>
                <td style={{ textAlign: 'right', padding: '4px 8px' }}>
                  {onUpdateItem ? (
                    <input type="number" style={{ width: 70, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontSize: 12, textAlign: 'right', fontFamily: 'inherit' }}
                      value={it.unitPrice || ''} onChange={e => onUpdateItem(i, 'unitPrice', e.target.value)} />
                  ) : (it.unitPrice ? fmt(it.unitPrice) : '—')}
                </td>
                <td style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>{fmt(it.amount)}</td>
                <td style={{ padding: '4px 8px' }}>
                  <ProductBadge item={it} products={products}
                    onAction={onUpdateItem ? (action) => onUpdateItem(i, '_action', action) : null}
                    onLink={onUpdateItem ? (productId, productName) => {
                      onUpdateItem(i, '_matchedProductId', productId)
                      onUpdateItem(i, '_action', 'auto')
                      onUpdateItem(i, '_match', { productId, productName, matchType: 'exact' })
                    } : null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProductBadge({ item, products, onAction, onLink }) {
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState('')
  const m = item._match

  const searchResults = searching && search.length >= 2
    ? (products || []).filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 6)
    : []

  if (m === null || m === undefined) return <span style={{ fontSize: 10, color: 'var(--text3)' }}>...</span>

  if (m.matchType === 'exact' && !searching) {
    return (
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        <span style={{ fontSize: 10, background: 'var(--green-bg)', color: 'var(--green)', padding: '2px 5px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <i className="ti ti-check" style={{ fontSize: 10 }} />{(m.productName || '').substring(0, 20)}
        </span>
        {onLink && <button onClick={() => setSearching(true)} style={{ fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)' }} title="Змінити">✎</button>}
      </div>
    )
  }

  if (m.matchType === 'fuzzy' && !searching) {
    return (
      <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, background: 'var(--amber-bg)', color: 'var(--amber)', padding: '2px 4px', borderRadius: 4 }} title={m.productName}>
          {(m.productName || '').substring(0, 16)}?
        </span>
        {onAction && <button style={{ fontSize: 9, background: 'var(--green-bg)', border: 'none', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', color: 'var(--green)', fontFamily: 'inherit' }} onClick={() => onAction('auto')}>Так</button>}
        {onLink && <button style={{ fontSize: 9, background: 'none', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', color: 'var(--blue)', fontFamily: 'inherit' }} onClick={() => { setSearching(true); setSearch('') }}>Пошук</button>}
      </div>
    )
  }

  // none або searching
  if (searching) {
    return (
      <div style={{ position: 'relative' }}>
        <input style={{ width: '100%', border: '1px solid var(--blue)', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontFamily: 'inherit' }}
          value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук товару..."
          autoFocus onBlur={() => setTimeout(() => setSearching(false), 200)} />
        {searchResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 20, maxHeight: 160, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
            {searchResults.map(p => (
              <div key={p.id} onMouseDown={() => { onLink(p.id, p.name); setSearching(false); setSearch('') }}
                style={{ padding: '5px 8px', cursor: 'pointer', fontSize: 11, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <span>{p.name.substring(0, 35)}</span>
                <span style={{ color: 'var(--text3)', flexShrink: 0, marginLeft: 4 }}>{p.computed_stock} {p.unit}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // none, not searching
  if (!onAction) return <span style={{ fontSize: 10, color: 'var(--text3)' }}>Новий</span>
  return (
    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {['new', 'service', 'expense'].map(act => (
        <button key={act} style={{
          fontSize: 9, border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontFamily: 'inherit',
          background: item._action === act ? (act === 'new' ? 'var(--blue-bg)' : act === 'service' ? 'var(--green-bg)' : 'var(--amber-bg)') : 'none',
          color: item._action === act ? (act === 'new' ? 'var(--blue)' : act === 'service' ? 'var(--green)' : 'var(--amber)') : 'var(--text3)',
        }} onClick={() => onAction(act)}>
          {act === 'new' ? 'Товар' : act === 'service' ? 'Послуга' : 'Госп.'}
        </button>
      ))}
      {onLink && <button style={{ fontSize: 9, border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', color: 'var(--blue)', fontFamily: 'inherit' }}
        onClick={() => { setSearching(true); setSearch('') }}>🔍</button>}
    </div>
  )
}

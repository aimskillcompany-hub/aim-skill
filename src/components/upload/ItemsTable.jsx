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
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const m = item._match
  const isLinked = m?.matchType === 'exact'
  const isFuzzy = m?.matchType === 'fuzzy'

  const searchResults = search.length >= 1
    ? (products || []).filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : (products || []).slice(0, 8)

  if (m === null || m === undefined) return <span style={{ fontSize: 10, color: 'var(--text3)' }}>...</span>

  // Закритий стан — показати результат
  if (!open) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Статус привʼязки */}
        <div onClick={() => { if (onLink) { setOpen(true); setSearch('') } }}
          style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: onLink ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', gap: 4,
            background: isLinked ? 'var(--green-bg)' : isFuzzy ? 'var(--amber-bg)' : 'var(--surface2)',
            color: isLinked ? 'var(--green)' : isFuzzy ? 'var(--amber)' : 'var(--text3)',
            border: '1px solid transparent',
          }}
          title={isLinked ? m.productName : isFuzzy ? `Можливо: ${m.productName}` : 'Натисніть щоб привʼязати'}>
          {isLinked && <i className="ti ti-check" style={{ fontSize: 11 }} />}
          {isFuzzy && <i className="ti ti-help" style={{ fontSize: 11 }} />}
          {!isLinked && !isFuzzy && <i className="ti ti-plus" style={{ fontSize: 11 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
            {isLinked ? m.productName : isFuzzy ? m.productName : 'Привʼязати'}
          </span>
          {onLink && <i className="ti ti-chevron-down" style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }} />}
        </div>
        {/* Тип (для нових) */}
        {!isLinked && !isFuzzy && onAction && (
          <div style={{ display: 'flex', gap: 2 }}>
            {['new', 'service', 'expense'].map(act => (
              <button key={act} style={{
                fontSize: 9, border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontFamily: 'inherit',
                background: item._action === act ? (act === 'new' ? 'var(--blue-bg)' : act === 'service' ? 'var(--green-bg)' : 'var(--amber-bg)') : 'none',
                color: item._action === act ? (act === 'new' ? 'var(--blue)' : act === 'service' ? 'var(--green)' : 'var(--amber)') : 'var(--text3)',
              }} onClick={() => onAction(act)}>
                {act === 'new' ? 'Товар' : act === 'service' ? 'Послуга' : 'Госп.'}
              </button>
            ))}
          </div>
        )}
        {/* Підтвердження для fuzzy */}
        {isFuzzy && onAction && (
          <div style={{ display: 'flex', gap: 3 }}>
            <button style={{ fontSize: 10, background: 'var(--green-bg)', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', color: 'var(--green)', fontFamily: 'inherit' }}
              onClick={() => onAction('auto')}>✓ Так, це він</button>
            <button style={{ fontSize: 10, background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}
              onClick={() => onAction('new')}>Ні, новий</button>
          </div>
        )}
      </div>
    )
  }

  // Відкритий стан — пошук
  return (
    <div style={{ position: 'relative' }}>
      <input style={{ width: '100%', border: '2px solid var(--blue)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontFamily: 'inherit', outline: 'none' }}
        value={search} onChange={e => setSearch(e.target.value)} placeholder="Введіть назву товару..."
        autoFocus onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }} />
      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 50, maxHeight: 200, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.15)', marginTop: 2 }}>
        {searchResults.map(p => (
          <div key={p.id} onClick={() => { onLink(p.id, p.name); setOpen(false) }}
            style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
            onMouseLeave={e => e.currentTarget.style.background = ''}>
            <span style={{ fontWeight: 500 }}>{p.name}</span>
            <span style={{ fontSize: 10, color: p.computed_stock > 0 ? 'var(--green)' : 'var(--red)', flexShrink: 0, marginLeft: 8 }}>{p.computed_stock} {p.unit}</span>
          </div>
        ))}
        {searchResults.length === 0 && <div style={{ padding: 10, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>Не знайдено</div>}
        <div onClick={() => setOpen(false)}
          style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
          Скасувати
        </div>
      </div>
    </div>
  )
}

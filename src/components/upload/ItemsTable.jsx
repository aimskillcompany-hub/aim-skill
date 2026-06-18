import { useState } from 'react'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))

export default function ItemsTable({ items, onUpdateItem }) {
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
                  <ProductBadge item={it} onAction={onUpdateItem ? (action) => onUpdateItem(i, '_action', action) : null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProductBadge({ item, onAction }) {
  const m = item._match
  if (m === null || m === undefined) return <span style={{ fontSize: 10, color: 'var(--text3)' }}>...</span>

  if (m.matchType === 'exact') {
    return (
      <span style={{ fontSize: 10, background: 'var(--green-bg)', color: 'var(--green)', padding: '2px 5px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <i className="ti ti-check" style={{ fontSize: 10 }} />{(m.productName || '').substring(0, 22)}
      </span>
    )
  }

  if (m.matchType === 'fuzzy') {
    return (
      <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, background: 'var(--amber-bg)', color: 'var(--amber)', padding: '2px 4px', borderRadius: 4 }} title={m.productName}>
          {(m.productName || '').substring(0, 18)}?
        </span>
        {onAction && (
          <>
            <button style={{ fontSize: 9, background: 'var(--green-bg)', border: 'none', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', color: 'var(--green)', fontFamily: 'inherit' }}
              onClick={() => onAction('auto')}>Так</button>
            <button style={{ fontSize: 9, background: 'var(--red-bg)', border: 'none', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', color: 'var(--red)', fontFamily: 'inherit' }}
              onClick={() => { onAction('new') }}>Ні</button>
          </>
        )}
      </div>
    )
  }

  // none
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
    </div>
  )
}

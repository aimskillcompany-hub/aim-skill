import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

// Селектор товару з пошуком по довіднику products + можливістю ввести нову назву.
// onSelect(product) — для існуючого: { id, name, unit, sell_price }
//                     для нового (вільний текст): { _new: true, name }
export default function ProductSelect({ value, onChange, onSelect, placeholder }) {
  const [query, setQuery] = useState(value || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    const handleClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const search = (q) => {
    setQuery(q)
    onChange?.(q)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!q || q.length < 2) { setResults([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase.from('products')
        .select('id, name, sku, unit, sell_price')
        .eq('status', 'active')
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
        .limit(8)
      setResults(data || [])
      setOpen(true)
      setLoading(false)
    }, 300)
  }

  const select = (p) => {
    setQuery(p.name)
    onChange?.(p.name)
    onSelect?.(p)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="form-input"
        value={query}
        onChange={e => search(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        placeholder={placeholder || 'Назва товару або артикул'}
        style={{ width: '100%' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, marginTop: 4, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,.08)',
        }}>
          {loading && <div style={{ padding: 12, fontSize: 13, color: 'var(--text3)' }}>Пошук...</div>}
          {!loading && results.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--text3)' }}>Не знайдено</div>
          )}
          {results.map(p => (
            <div key={p.id} onClick={() => select(p)} style={{
              padding: '10px 14px', cursor: 'pointer', display: 'flex',
              alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bg)', fontSize: 14,
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }} title={p.name}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {p.sku ? `арт. ${p.sku} · ` : ''}{p.unit || 'шт'}{p.sell_price ? ` · ${p.sell_price} грн` : ''}
                </div>
              </div>
            </div>
          ))}
          {query.trim().length >= 2 && (
            <div onClick={() => { setOpen(false); onSelect?.({ _new: true, name: query.trim() }) }}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                color: 'var(--blue)', borderTop: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <i className="ti ti-plus" style={{ fontSize: 14 }} />
              Додати новий товар «{query.trim()}»
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const TYPE_LABELS = { client: 'Клієнт', supplier: 'Постачальник', other: 'Інше' }
const TYPE_COLORS = { client: { bg: '#EFF5EF', color: '#4A7C59' }, supplier: { bg: '#F5EDED', color: '#9B3A3A' }, other: { bg: '#F0F2F5', color: '#6B6B6B' } }

export default function ContractorSelect({ value, onChange, onContractorSelect, placeholder }) {
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
      const { data } = await supabase.from('contractors')
        .select('id, name, short_name, edrpou, type, default_article, default_direction')
        .or(`name.ilike.%${q}%,short_name.ilike.%${q}%,edrpou.ilike.%${q}%`)
        .limit(8)
      setResults(data || [])
      setOpen(true)
      setLoading(false)
    }, 300)
  }

  const select = (c) => {
    setQuery(c.name)
    onChange?.(c.name)
    onContractorSelect?.(c)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="form-input"
        value={query}
        onChange={e => search(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        placeholder={placeholder || 'Назва компанії або ЄДРПОУ'}
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
          {results.map(c => {
            const tc = TYPE_COLORS[c.type] || TYPE_COLORS.other
            return (
              <div key={c.id} onClick={() => select(c)} style={{
                padding: '10px 14px', cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bg)',
                fontSize: 14,
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.short_name || c.name}
                  </div>
                  {c.edrpou && <div style={{ fontSize: 12, color: 'var(--text3)' }}>ЄДРПОУ: {c.edrpou}</div>}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 500, padding: '2px 6px', borderRadius: 6,
                  background: tc.bg, color: tc.color, whiteSpace: 'nowrap',
                }}>{TYPE_LABELS[c.type]}</span>
              </div>
            )
          })}
          <div onClick={() => { setOpen(false); onContractorSelect?.({ _new: true, name: query }) }}
            style={{
              padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              color: 'var(--blue)', borderTop: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
            onMouseLeave={e => e.currentTarget.style.background = ''}
          >
            <i className="ti ti-plus" style={{ fontSize: 14 }} />
            Додати нового контрагента
          </div>
        </div>
      )}
    </div>
  )
}

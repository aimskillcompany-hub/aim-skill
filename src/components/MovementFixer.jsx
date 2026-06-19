import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))

export default function MovementFixer() {
  const [mismatches, setMismatches] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchFor, setSearchFor] = useState(null) // mov_id що шукаємо продукт
  const [search, setSearch] = useState('')
  const [fixed, setFixed] = useState(new Set())

  useEffect(() => { loadMismatches() }, [])

  const loadMismatches = async () => {
    setLoading(true)
    const { data: movs } = await supabase.from('stock_movements')
      .select('id, product_id, type, quantity, price, description, date')
      .not('description', 'is', null)
      .order('date')

    const { data: prods } = await supabase.from('product_stock')
      .select('id, name, status, product_type, computed_stock')
      .eq('status', 'active')

    setProducts(prods || [])

    const prodMap = {}
    ;(prods || []).forEach(p => { prodMap[p.id] = p })

    // Знайти невідповідності
    const results = []
    ;(movs || []).forEach(m => {
      if (!m.description || m.description.startsWith('Збірка')) return
      const prod = prodMap[m.product_id]
      if (!prod) return

      const descL = m.description.toLowerCase()
      const nameL = prod.name.toLowerCase()
      const desc15 = descL.substring(0, 15)
      const name15 = nameL.substring(0, 15)

      if (desc15 !== name15 && !nameL.includes(descL.substring(0, 20)) && !descL.includes(nameL.substring(0, 20))) {
        results.push({
          movId: m.id,
          type: m.type,
          qty: m.quantity,
          price: m.price,
          date: m.date,
          description: m.description,
          productId: m.product_id,
          productName: prod.name,
        })
      }
    })

    setMismatches(results)
    setLoading(false)
  }

  const fixMovement = async (movId, newProductId) => {
    await supabase.from('stock_movements').update({ product_id: newProductId }).eq('id', movId)
    setFixed(prev => new Set([...prev, movId]))
    setSearchFor(null)
    setSearch('')
  }

  const markOk = (movId) => {
    setFixed(prev => new Set([...prev, movId]))
  }

  const searchResults = search.length >= 2
    ? products.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : []

  const remaining = mismatches.filter(m => !fixed.has(m.movId))

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Завантаження...</div>

  return (
    <div>
      <div className="page-header">
        <h2>Виправлення невідповідностей рухів</h2>
        <p>Рухи де опис не збігається з назвою продукту. Всього: {mismatches.length}, залишилось: {remaining.length}</p>
      </div>

      {remaining.length === 0 && (
        <div className="card">
          <div className="empty">
            <i className="ti ti-check" style={{ fontSize: 48, color: 'var(--green)', display: 'block', margin: '0 auto 12px' }} />
            <p>Всі невідповідності виправлено!</p>
          </div>
        </div>
      )}

      {remaining.map(m => (
        <div key={m.movId} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 11, color: m.type === 'in' ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginBottom: 4 }}>
                {m.type === 'in' ? '↓ ПРИХІД' : '↑ ВИДАЧА'} · {m.date} · {m.qty} шт × {fmt(m.price)} грн
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                <span style={{ color: 'var(--text3)', fontSize: 11 }}>Опис руху: </span>
                {m.description}
              </div>
              <div style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--text3)', fontSize: 11 }}>На продукті: </span>
                <span style={{ color: 'var(--red)', fontWeight: 500 }}>{m.productName}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button className="btn btn-sm btn-secondary" style={{ fontSize: 12 }}
                onClick={() => markOk(m.movId)}>
                <i className="ti ti-check" style={{ fontSize: 12 }} /> Правильно
              </button>
              <button className="btn btn-sm btn-primary" style={{ fontSize: 12 }}
                onClick={() => { setSearchFor(m.movId); setSearch('') }}>
                <i className="ti ti-transfer" style={{ fontSize: 12 }} /> Перенести
              </button>
            </div>
          </div>

          {searchFor === m.movId && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <input className="form-input" style={{ height: 34, fontSize: 13, marginBottom: 6 }}
                placeholder="Пошук правильного продукту..."
                value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              {searchResults.map(p => (
                <div key={p.id} onClick={() => fixMovement(m.movId, p.id)}
                  style={{ padding: '6px 10px', cursor: 'pointer', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', marginBottom: 3, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--bg)'}>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{p.product_type}</span>
                </div>
              ))}
              {search.length >= 2 && searchResults.length === 0 && (
                <div style={{ padding: 8, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>Не знайдено</div>
              )}
              <button className="btn btn-sm btn-secondary" onClick={() => setSearchFor(null)} style={{ fontSize: 11, marginTop: 4 }}>
                Скасувати
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

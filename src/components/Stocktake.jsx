import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtInt as fmt } from '../lib/fmt'

export default function Stocktake({ onClose, userId }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all') // all, variance, missing
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => { loadProducts() }, [])

  const loadProducts = async () => {
    setLoading(true)
    const { data } = await supabase.from('product_stock')
      .select('id, name, sku, computed_stock, unit, buy_price, product_type')
      .eq('status', 'active').neq('product_type', 'service').neq('product_type', 'expense')
      .order('name')
    setProducts((data || []).map(p => ({
      ...p,
      actual: '',
      variance: null,
    })))
    setLoading(false)
  }

  const setActual = (id, val) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p
      const actual = val === '' ? '' : parseFloat(val)
      const variance = actual === '' ? null : actual - (p.computed_stock || 0)
      return { ...p, actual, variance }
    }))
  }

  const filled = products.filter(p => p.actual !== '')
  const withVariance = filled.filter(p => p.variance !== 0)
  const totalSystemValue = products.reduce((s, p) => s + (p.computed_stock || 0) * (p.buy_price || 0), 0)
  const totalActualValue = filled.reduce((s, p) => s + (parseFloat(p.actual) || 0) * (p.buy_price || 0), 0)
  const totalVarianceValue = filled.reduce((s, p) => s + (p.variance || 0) * (p.buy_price || 0), 0)

  const filtered = products.filter(p => {
    if (search) {
      const q = search.toLowerCase()
      if (!p.name.toLowerCase().includes(q) && !(p.sku || '').toLowerCase().includes(q)) return false
    }
    if (filter === 'variance') return p.variance !== null && p.variance !== 0
    if (filter === 'missing') return p.actual === ''
    return true
  })

  const applyAdjustments = async () => {
    if (!withVariance.length) return
    if (!confirm(`Застосувати ${withVariance.length} коригувань? Будуть створені складські рухи для вирівнювання залишків.`)) return
    setSaving(true)
    for (const p of withVariance) {
      const type = p.variance > 0 ? 'in' : 'out'
      const qty = Math.abs(p.variance)
      await supabase.from('stock_movements').insert({
        product_id: p.id,
        type,
        quantity: qty,
        price: p.buy_price || null,
        total: qty * (p.buy_price || 0),
        date: new Date().toISOString().split('T')[0],
        description: `Інвентаризація: ${type === 'in' ? 'надлишок' : 'нестача'} ${qty} ${p.unit}`,
        source: 'manual',
        created_by: userId,
      })
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose?.() }, 2000)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }} aria-live="polite">Завантаження товарів...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Інвентаризація</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '4px 0 0' }}>Введіть фактичну кількість товарів на складі</p>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text2)' }}>
          Перевірено: {filled.length} / {products.length} товарів
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <div className="kpi">
          <div className="kpi-label">Товарів</div>
          <div className="kpi-value">{products.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Перевірено</div>
          <div className="kpi-value" style={{ color: 'var(--green)' }}>{filled.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Розбіжностей</div>
          <div className="kpi-value" style={{ color: withVariance.length > 0 ? 'var(--red)' : 'var(--green)' }}>{withVariance.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Різниця, грн</div>
          <div className="kpi-value" style={{ color: totalVarianceValue !== 0 ? 'var(--red)' : 'var(--text2)' }}>
            {totalVarianceValue >= 0 ? '+' : ''}{fmt(totalVarianceValue)}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="form-input" style={{ flex: 1, minWidth: 200, height: 36, paddingLeft: 12 }}
          placeholder="Пошук товару..." value={search} onChange={e => setSearch(e.target.value)} />
        {['all', 'missing', 'variance'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
            background: filter === f ? 'var(--blue)' : 'var(--surface)', color: filter === f ? '#fff' : 'var(--text2)',
            fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
          }}>
            {f === 'all' ? `Все (${products.length})` : f === 'missing' ? `Не перевірено (${products.length - filled.length})` : `Розбіжності (${withVariance.length})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="tbl-wrap" style={{ maxHeight: 500, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Товар</th>
              <th style={{ textAlign: 'right', width: 80 }}>Система</th>
              <th style={{ textAlign: 'center', width: 100 }}>Факт</th>
              <th style={{ textAlign: 'right', width: 80 }}>Різниця</th>
              <th style={{ textAlign: 'right', width: 100 }}>Вартість різн.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} style={{
                borderBottom: '1px solid var(--border)',
                background: p.variance !== null && p.variance !== 0 ? 'var(--red-bg)' : p.actual !== '' ? 'var(--green-bg)' : '',
              }}>
                <td>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</div>
                  {p.sku && <div style={{ fontSize: 10, color: 'var(--text3)' }}>Арт: {p.sku}</div>}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>
                  {p.computed_stock} {p.unit}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="number" className="form-input" style={{ height: 32, width: 80, fontSize: 13, textAlign: 'center', padding: '4px 8px' }}
                    value={p.actual} onChange={e => setActual(p.id, e.target.value)}
                    placeholder="—" />
                </td>
                <td style={{
                  textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums',
                  color: p.variance === null ? 'var(--text3)' : p.variance === 0 ? 'var(--green)' : 'var(--red)',
                }}>
                  {p.variance === null ? '—' : p.variance > 0 ? `+${p.variance}` : p.variance}
                </td>
                <td style={{
                  textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums',
                  color: p.variance && p.variance !== 0 ? 'var(--red)' : 'var(--text3)',
                }}>
                  {p.variance !== null && p.variance !== 0 ? `${p.variance > 0 ? '+' : ''}${fmt(p.variance * (p.buy_price || 0))} грн` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end', alignItems: 'center' }}>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13, fontWeight: 500 }}>Коригування застосовано!</span>}
        <button className="btn btn-secondary" onClick={onClose}>Закрити</button>
        {withVariance.length > 0 && (
          <button className="btn btn-primary" onClick={applyAdjustments} disabled={saving}>
            {saving ? 'Збереження...' : `Застосувати ${withVariance.length} коригувань`}
          </button>
        )}
      </div>
    </div>
  )
}

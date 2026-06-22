import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtInt as fmt } from '../lib/fmt'
import { STATUS_LABELS, STATUS_COLORS, getDocLabel, DOCUMENT_TYPES } from '../lib/docgen'

const KANBAN_COLUMNS = [
  { id: 'draft', label: 'Чернетка', icon: 'ti-file-text' },
  { id: 'confirmed', label: 'Підтверджено', icon: 'ti-circle-check' },
  { id: 'in_progress', label: 'В роботі', icon: 'ti-loader' },
  { id: 'shipped', label: 'Відвантажено', icon: 'ti-truck' },
  { id: 'paid', label: 'Оплачено', icon: 'ti-cash' },
  { id: 'completed', label: 'Завершено', icon: 'ti-check' },
]

const ORDER_TYPES = DOCUMENT_TYPES.filter(t => t.isOrder)

export default function Orders({ user }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('kanban') // kanban | list
  const [filter, setFilter] = useState('active') // active | all | cancelled
  const [search, setSearch] = useState('')
  const [dragItem, setDragItem] = useState(null)

  useEffect(() => { loadOrders() }, [])

  const loadOrders = async () => {
    setLoading(true)
    const { data } = await supabase.from('generated_docs')
      .select('id, doc_type, doc_number, doc_date, total, status, contractor_id, contractor_name, items, notes, created_at')
      .in('doc_type', ORDER_TYPES.map(t => t.key))
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  const updateStatus = async (orderId, newStatus) => {
    await supabase.from('generated_docs').update({ status: newStatus }).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
  }

  const filtered = orders.filter(o => {
    if (search) {
      const q = search.toLowerCase()
      if (!(o.contractor_name || '').toLowerCase().includes(q) && !(o.doc_number || '').toLowerCase().includes(q)) return false
    }
    if (filter === 'active') return o.status !== 'cancelled' && o.status !== 'completed'
    if (filter === 'cancelled') return o.status === 'cancelled'
    return true
  })

  const totalActive = orders.filter(o => o.status !== 'cancelled' && o.status !== 'completed').length
  const totalValue = orders.filter(o => o.status !== 'cancelled' && o.status !== 'completed').reduce((s, o) => s + (parseFloat(o.total) || 0), 0)
  const totalPurchase = orders.filter(o => o.doc_type === 'purchaseOrder' && o.status !== 'cancelled' && o.status !== 'completed').reduce((s, o) => s + (parseFloat(o.total) || 0), 0)
  const totalSales = orders.filter(o => o.doc_type === 'salesOrder' && o.status !== 'cancelled' && o.status !== 'completed').reduce((s, o) => s + (parseFloat(o.total) || 0), 0)

  // Drag & Drop
  const handleDragStart = (e, order) => { setDragItem(order); e.dataTransfer.effectAllowed = 'move' }
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const handleDrop = (e, columnId) => {
    e.preventDefault()
    if (dragItem && dragItem.status !== columnId) {
      updateStatus(dragItem.id, columnId)
    }
    setDragItem(null)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }} aria-live="polite">Завантаження...</div>

  return (
    <div>
      <div className="page-header">
        <h1>Замовлення</h1>
        <p>Пайплайн закупок та продажів</p>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <div className="kpi">
          <div className="kpi-label">Активних</div>
          <div className="kpi-value">{totalActive}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Закупки</div>
          <div className="kpi-value" style={{ color: 'var(--red)' }}>{fmt(totalPurchase)} <span style={{ fontSize: 13, fontWeight: 400 }}>грн</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Продажі</div>
          <div className="kpi-value" style={{ color: 'var(--green)' }}>{fmt(totalSales)} <span style={{ fontSize: 13, fontWeight: 400 }}>грн</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Загальна вартість</div>
          <div className="kpi-value">{fmt(totalValue)} <span style={{ fontSize: 13, fontWeight: 400 }}>грн</span></div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" style={{ flex: 1, minWidth: 200, height: 36, paddingLeft: 12 }}
          placeholder="Пошук по контрагенту або номеру..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { id: 'active', label: `Активні (${totalActive})` },
            { id: 'all', label: 'Всі' },
            { id: 'cancelled', label: 'Скасовані' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
              background: filter === f.id ? 'var(--blue)' : 'var(--surface)', color: filter === f.id ? '#fff' : 'var(--text2)',
              fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
            }}>{f.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
          <button onClick={() => setView('kanban')} aria-label="Kanban" style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
            background: view === 'kanban' ? 'var(--text)' : 'var(--surface)', color: view === 'kanban' ? '#fff' : 'var(--text2)',
          }}><i className="ti ti-layout-columns" style={{ fontSize: 16 }} /></button>
          <button onClick={() => setView('list')} aria-label="Список" style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
            background: view === 'list' ? 'var(--text)' : 'var(--surface)', color: view === 'list' ? '#fff' : 'var(--text2)',
          }}><i className="ti ti-list" style={{ fontSize: 16 }} /></button>
        </div>
      </div>

      {/* Kanban View */}
      {view === 'kanban' && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
          {KANBAN_COLUMNS.map(col => {
            const colOrders = filtered.filter(o => (o.status || 'draft') === col.id)
            const colTotal = colOrders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0)
            return (
              <div key={col.id}
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, col.id)}
                style={{
                  minWidth: 240, flex: '1 0 240px',
                  background: 'var(--bg)', borderRadius: 12, padding: 12,
                  border: dragItem ? '2px dashed var(--border)' : '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column',
                }}>
                {/* Column header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className={`ti ${col.icon}`} style={{ fontSize: 14, color: STATUS_COLORS[col.id]?.color || 'var(--text3)' }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{col.label}</span>
                    <span style={{ fontSize: 11, background: 'var(--surface2)', borderRadius: 10, padding: '1px 7px', color: 'var(--text3)' }}>{colOrders.length}</span>
                  </div>
                  {colTotal > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{fmt(colTotal)} грн</span>}
                </div>

                {/* Cards */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {colOrders.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 12, borderRadius: 8, border: '1px dashed var(--border)' }}>
                      Порожньо
                    </div>
                  )}
                  {colOrders.map(order => {
                    const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
                    const isPurchase = order.doc_type === 'purchaseOrder'
                    return (
                      <div key={order.id}
                        draggable
                        onDragStart={e => handleDragStart(e, order)}
                        style={{
                          background: 'var(--surface)', borderRadius: 10, padding: '10px 12px',
                          border: '1px solid var(--border)', cursor: 'grab',
                          borderLeft: `3px solid ${isPurchase ? 'var(--red)' : 'var(--green)'}`,
                          transition: 'box-shadow .15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.08)'}
                        onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                        {/* Type badge */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                            background: isPurchase ? 'var(--red-bg)' : 'var(--green-bg)',
                            color: isPurchase ? 'var(--red)' : 'var(--green)',
                          }}>{isPurchase ? 'ЗАКУПКА' : 'ПРОДАЖ'}</span>
                          <span style={{ fontSize: 10, color: 'var(--text3)' }}>{order.doc_date}</span>
                        </div>
                        {/* Contractor */}
                        <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {order.contractor_name || '—'}
                        </div>
                        {/* Doc number */}
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
                          №{order.doc_number}
                        </div>
                        {/* Items preview */}
                        {items.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, lineHeight: 1.4 }}>
                            {items.slice(0, 2).map((it, i) => (
                              <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {it.name} × {it.quantity}
                              </div>
                            ))}
                            {items.length > 2 && <div>+{items.length - 2} ще...</div>}
                          </div>
                        )}
                        {/* Amount */}
                        <div style={{ fontWeight: 600, fontSize: 14, color: isPurchase ? 'var(--red)' : 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(order.total)} грн
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Контрагент</th>
                <th>Номер</th>
                <th style={{ textAlign: 'right' }}>Сума</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                  Немає замовлень. Створіть через модуль Контрагенти.
                </td></tr>
              )}
              {filtered.map(o => {
                const isPurchase = o.doc_type === 'purchaseOrder'
                const sc = STATUS_COLORS[o.status] || STATUS_COLORS.draft
                return (
                  <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{o.doc_date}</td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6,
                        background: isPurchase ? 'var(--red-bg)' : 'var(--green-bg)',
                        color: isPurchase ? 'var(--red)' : 'var(--green)',
                      }}>{isPurchase ? 'Закупка' : 'Продаж'}</span>
                    </td>
                    <td style={{ fontWeight: 500, fontSize: 13 }}>{o.contractor_name}</td>
                    <td style={{ fontSize: 13, color: 'var(--text2)' }}>{o.doc_number}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: isPurchase ? 'var(--red)' : 'var(--green)' }}>
                      {fmt(o.total)} грн
                    </td>
                    <td>
                      <select style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: sc.bg, color: sc.color, fontFamily: 'inherit', cursor: 'pointer' }}
                        value={o.status || 'draft'} onChange={e => updateStatus(o.id, e.target.value)}>
                        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
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

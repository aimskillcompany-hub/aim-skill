import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import {
  ORDER_TYPES, TYPE_COLORS, statusLabel, nextActionLabel, isOpen, needsAction,
  proposalOverdue, paymentOverdue,
} from '../lib/orders'
import Gantt from '../components/Gantt'
import { useSort, SortTh } from '../components/Sort'

export default function Orders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('table') // table | gantt
  const [showNew, setShowNew] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: ords }, { data: props }, { data: subs }] = await Promise.all([
      supabase.from('orders').select('*, contractors(name)').order('created_at', { ascending: false }),
      supabase.from('commercial_proposals').select('order_id, sent_at, status'),
      supabase.from('supplier_orders').select('order_id, payment_due_date, status'),
    ])
    const lastSent = {}
    ;(props || []).forEach(p => {
      if (p.sent_at && (!lastSent[p.order_id] || p.sent_at > lastSent[p.order_id])) lastSent[p.order_id] = p.sent_at
    })
    const subsByOrder = {}
    ;(subs || []).forEach(s => { (subsByOrder[s.order_id] ||= []).push(s) })

    const enriched = (ords || []).map(o => ({
      ...o,
      clientName: o.contractors?.name || '—',
      overdue: proposalOverdue(o, lastSent[o.id]) || paymentOverdue(subsByOrder[o.id]),
    }))
    setOrders(enriched)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return orders.filter(o => {
      if (filter === 'action' && !(isOpen(o) && needsAction(o))) return false
      if (filter === 'overdue' && !o.overdue) return false
      if (['trade', 'service', 'agent'].includes(filter) && o.type !== filter) return false
      if (!term) return true
      return o.clientName.toLowerCase().includes(term) || (o.order_number || '').toLowerCase().includes(term)
    })
  }, [orders, q, filter])

  const kpi = useMemo(() => {
    const open = orders.filter(isOpen)
    return {
      active: open.length,
      action: open.filter(needsAction).length,
      overdue: open.filter(o => o.overdue).length,
      sum: open.reduce((s, o) => s + (Number(o.total) || 0), 0),
    }
  }, [orders])

  const { sort, onSort, sorted } = useSort('order_number', 'asc')
  const sortedOrders = sorted(filtered, {
    order_number: o => o.order_number || '',
    client: o => o.clientName || '',
    type: o => ORDER_TYPES[o.type] || '',
    status: o => statusLabel(o),
    total: o => Number(o.total) || 0,
  })

  const FILTERS = [
    ['all', 'Всі'], ['action', 'Потребують дії'], ['overdue', 'Прострочено'],
    ['trade', 'Торгівля'], ['service', 'Послуги'], ['agent', 'Агент'],
  ]

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1>Замовлення</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><i className="ti ti-plus" /> Нове замовлення</button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <Kpi label="Активних" value={kpi.active} />
        <Kpi label="Потребують дії" value={kpi.action} accent={kpi.action > 0 ? 'var(--blue)' : undefined} />
        <Kpi label="Прострочено" value={kpi.overdue} accent={kpi.overdue > 0 ? 'var(--red)' : undefined} />
        <Kpi label="Сума в роботі" value={fmtInt(kpi.sum)} suffix="грн" />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" placeholder="Пошук за клієнтом або номером…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 240px', maxWidth: 360 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([k, lbl]) => (
            <button key={k} onClick={() => setFilter(k)} className="btn"
              style={{ background: filter === k ? 'var(--blue)' : 'var(--surface)', color: filter === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button className="btn" onClick={() => setView('table')} style={{ background: view === 'table' ? 'var(--surface2)' : 'var(--surface)' }} title="Таблиця"><i className="ti ti-list" /></button>
          <button className="btn" onClick={() => setView('gantt')} style={{ background: view === 'gantt' ? 'var(--surface2)' : 'var(--surface)' }} title="Діаграма Ганта"><i className="ti ti-timeline" /></button>
        </div>
      </div>

      {loading ? (
        <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
      ) : view === 'gantt' ? (
        <Gantt orders={filtered} onOpen={(id) => navigate(`/orders/${id}`)} />
      ) : (
        <div className="card">
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <SortTh label="№" k="order_number" sort={sort} onSort={onSort} />
                <SortTh label="Клієнт" k="client" sort={sort} onSort={onSort} />
                <SortTh label="Тип" k="type" sort={sort} onSort={onSort} />
                <SortTh label="Статус" k="status" sort={sort} onSort={onSort} />
                <th>Наступна дія</th>
                <SortTh label="Сума" k="total" sort={sort} onSort={onSort} align="right" />
              </tr></thead>
              <tbody>
                {sortedOrders.map(o => (
                  <tr key={o.id} style={{ cursor: 'pointer', background: o.overdue ? 'var(--red-bg)' : undefined }} onClick={() => navigate(`/orders/${o.id}`)}>
                    <td style={{ fontWeight: 500 }}>{o.order_number || o.id.slice(0, 6)}</td>
                    <td><div className="trunc">{o.clientName}</div></td>
                    <td><span style={{ color: TYPE_COLORS[o.type], fontSize: 12, fontWeight: 600 }}>{ORDER_TYPES[o.type]}</span></td>
                    <td style={{ fontSize: 13 }}>{statusLabel(o)}</td>
                    <td style={{ fontSize: 13, color: o.overdue ? 'var(--red)' : needsAction(o) ? 'var(--text)' : 'var(--text2)', fontWeight: needsAction(o) ? 600 : 400 }}>
                      {o.overdue && <i className="ti ti-alert-triangle" style={{ marginRight: 4 }} />}{isOpen(o) ? nextActionLabel(o) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmt(o.total)}</td>
                  </tr>
                ))}
                {sortedOrders.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 28 }}>Замовлень немає</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); navigate(`/orders/${id}`) }} />}
    </div>
  )
}

function Kpi({ label, value, suffix, accent }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: accent }}>{value}{suffix && <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text3)' }}> {suffix}</span>}</div>
    </div>
  )
}

function NewOrderModal({ onClose, onCreated }) {
  const { user } = useUser()
  const [type, setType] = useState('trade')
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [total, setTotal] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('contractors').select('id, name').eq('is_client', true).order('name').then(({ data }) => setClients(data || []))
  }, [])

  const save = async () => {
    if (!clientId) { setError('Оберіть клієнта'); return }
    setSaving(true); setError(null)
    const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true })
    const order_number = String((count || 0) + 1).padStart(4, '0')
    const { data, error } = await supabase.from('orders').insert({
      order_number, type, status: 'new', client_id: clientId,
      total: Number(total) || 0, description: description || null, created_by: user?.id || null,
    }).select('id').single()
    setSaving(false)
    if (error) { setError(error.message); return }
    onCreated(data.id)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header"><h2>Нове замовлення</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group"><label>Напрямок</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(ORDER_TYPES).map(([k, lbl]) => (
                <button key={k} className="btn" onClick={() => setType(k)} style={{ flex: 1, background: type === k ? TYPE_COLORS[k] : 'var(--surface)', color: type === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="form-group"><label>Клієнт *</label>
            <select className="form-input" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">— оберіть —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Сума (план)</label><input className="form-input" type="number" value={total} onChange={e => setTotal(e.target.value)} /></div>
          <div className="form-group"><label>Опис</label><input className="form-input" value={description} onChange={e => setDescription(e.target.value)} /></div>
          {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={onClose}>Скасувати</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '…' : 'Створити'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { nextOrderNumber } from '../lib/orderNumber'
import { fmt, fmtInt } from '../lib/fmt'
import {
  ORDER_TYPES, TYPE_COLORS, OUTCOME, statusLabel, statusAccent, isOpen,
  proposalOverdue, paymentOverdue,
} from '../lib/orders'
import Kanban from '../components/Kanban'
import OrderReport from '../components/OrderReport'
import { useSort, SortTh } from '../components/Sort'

export default function Orders() {
  const navigate = useNavigate()
  const { user } = useUser()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('table') // table | kanban
  const [showNew, setShowNew] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: ords }, { data: props }, { data: subs }, { data: profs }] = await Promise.all([
      qc('orders').select('*, contractors(name)').order('created_at', { ascending: false }),
      qc('commercial_proposals').select('order_id, sent_at, status'),
      qc('supplier_orders').select('order_id, payment_due_date, status'),
      supabase.from('profiles').select('id, full_name, email'),
    ])
    const lastSent = {}
    ;(props || []).forEach(p => {
      if (p.sent_at && (!lastSent[p.order_id] || p.sent_at > lastSent[p.order_id])) lastSent[p.order_id] = p.sent_at
    })
    const subsByOrder = {}
    ;(subs || []).forEach(s => { (subsByOrder[s.order_id] ||= []).push(s) })
    const userMap = {}
    ;(profs || []).forEach(p => { userMap[p.id] = p.full_name || p.email || '—' })

    const enriched = (ords || []).map(o => ({
      ...o,
      clientName: o.contractors?.name || '—',
      managerName: o.manager_id ? (userMap[o.manager_id] || '—') : '—',
      overdue: proposalOverdue(o, lastSent[o.id]) || paymentOverdue(subsByOrder[o.id]),
    }))
    setOrders(enriched)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Відмітка «комісійні сплачені» — перемикач прямо в реєстрі (без переходу в картку)
  const toggleCommission = async (o) => {
    const val = !o.commission_paid
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, commission_paid: val } : x))
    const { error } = await qc('orders').update({ commission_paid: val }).eq('id', o.id)
    if (error) {
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, commission_paid: !val } : x))
      alert('Не вдалося зберегти: ' + (/commission_paid/.test(error.message || '') ? 'запустіть міграцію 045' : error.message))
    }
  }

  // Відмітка «врахувати в розрахунку інвестора» — яскрава, перемикається в реєстрі
  const toggleInvestor = async (o) => {
    const val = !o.in_investor
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, in_investor: val } : x))
    const { error } = await qc('orders').update({ in_investor: val }).eq('id', o.id)
    if (error) {
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, in_investor: !val } : x))
      alert('Не вдалося зберегти: ' + (/in_investor/.test(error.message || '') ? 'запустіть міграцію 047' : error.message))
    }
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return orders.filter(o => {
      const archived = !!o.archived_at
      if (filter === 'archived') { if (!archived) return false }
      else if (archived) return false
      if (filter === 'overdue' && !o.overdue) return false
      if (filter === 'mine' && o.manager_id !== user?.id) return false
      if (['trade', 'service', 'agent'].includes(filter) && o.type !== filter) return false
      if (!term) return true
      return o.clientName.toLowerCase().includes(term) || (o.order_number || '').toLowerCase().includes(term)
    })
  }, [orders, q, filter])

  const kpi = useMemo(() => {
    const open = orders.filter(o => !o.archived_at && isOpen(o))
    return {
      active: open.length,
      overdue: open.filter(o => o.overdue).length,
      sum: open.reduce((s, o) => s + (Number(o.total) || 0), 0),
    }
  }, [orders])

  const { sort, onSort, sorted } = useSort('order_number', 'asc')
  const sortedOrders = sorted(filtered, {
    order_number: o => o.order_number || '',
    created: o => o.created_at || '',
    investor: o => o.in_investor ? 1 : 0,
    commission: o => o.commission_paid ? 1 : 0,
    client: o => o.clientName || '',
    manager: o => o.managerName || '',
    type: o => ORDER_TYPES[o.type] || '',
    status: o => statusLabel(o),
    total: o => Number(o.total) || 0,
  })

  const FILTERS = [
    ['all', 'Всі'], ['mine', 'Мої'], ['overdue', 'Прострочено'],
    ['trade', 'Торгівля'], ['service', 'Послуги'], ['agent', 'Агент'], ['archived', 'Архів'],
  ]

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1>Замовлення</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><i className="ti ti-plus" /> Нове замовлення</button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <Kpi label="Активних" value={kpi.active} />
        <Kpi label="Прострочено" value={kpi.overdue} accent={kpi.overdue > 0 ? 'var(--red)' : undefined} />
        <Kpi label="Сума в роботі" value={fmtInt(kpi.sum)} suffix="грн" />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {view !== 'report' && <>
          <input className="form-input" placeholder="Пошук за клієнтом або номером…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 240px', maxWidth: 360 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map(([k, lbl]) => (
              <button key={k} onClick={() => setFilter(k)} className="btn"
                style={{ background: filter === k ? 'var(--blue)' : 'var(--surface)', color: filter === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>{lbl}</button>
            ))}
          </div>
        </>}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button className="btn" onClick={() => setView('table')} style={{ background: view === 'table' ? 'var(--surface2)' : 'var(--surface)' }} title="Таблиця"><i className="ti ti-list" /></button>
          <button className="btn" onClick={() => setView('kanban')} style={{ background: view === 'kanban' ? 'var(--surface2)' : 'var(--surface)' }} title="Канбан"><i className="ti ti-layout-kanban" /></button>
          <button className="btn" onClick={() => setView('report')} style={{ background: view === 'report' ? 'var(--surface2)' : 'var(--surface)' }} title="Звіт"><i className="ti ti-report" /></button>
        </div>
      </div>

      {filter === 'archived' && !loading && (() => {
        const won = filtered.filter(o => o.outcome === 'won')
        const lost = filtered.filter(o => o.outcome === 'lost')
        const sum = arr => arr.reduce((s, o) => s + (Number(o.total) || 0), 0)
        if (!won.length && !lost.length) return null
        return (
          <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap', fontSize: 13 }}>
            <span style={{ color: OUTCOME.won.color, fontWeight: 600 }}><i className={`ti ${OUTCOME.won.icon}`} /> Виграно: {won.length} · {fmtInt(sum(won))} грн</span>
            <span style={{ color: OUTCOME.lost.color, fontWeight: 600 }}><i className={`ti ${OUTCOME.lost.icon}`} /> Програно: {lost.length} · {fmtInt(sum(lost))} грн</span>
            {won.length + lost.length > 0 && <span style={{ color: 'var(--text2)' }}>Win-rate: {Math.round(won.length / (won.length + lost.length) * 100)}%</span>}
          </div>
        )
      })()}

      {view === 'report' ? (
        <OrderReport />
      ) : loading ? (
        <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
      ) : view === 'kanban' ? (
        <Kanban orders={filtered} type={filter} onOpen={(id) => navigate(`/orders/${id}`)} />
      ) : (
        <div className="card">
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <SortTh label="№" k="order_number" sort={sort} onSort={onSort} />
                <SortTh label="Дата" k="created" sort={sort} onSort={onSort} />
                <SortTh label="Клієнт" k="client" sort={sort} onSort={onSort} />
                <SortTh label="Менеджер" k="manager" sort={sort} onSort={onSort} />
                <SortTh label="Тип" k="type" sort={sort} onSort={onSort} />
                <SortTh label="Статус" k="status" sort={sort} onSort={onSort} />
                <SortTh label="Сума з ПДВ" k="total" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Інвестор" k="investor" sort={sort} onSort={onSort} align="center" />
                <SortTh label="Комісія" k="commission" sort={sort} onSort={onSort} align="center" />
              </tr></thead>
              <tbody>
                {sortedOrders.map(o => (
                  <tr key={o.id} style={{ cursor: 'pointer', background: o.overdue ? 'var(--red-bg)' : undefined }} onClick={() => navigate(`/orders/${o.id}`)}>
                    <td style={{ fontWeight: 500 }}>{o.order_number || o.id.slice(0, 6)}</td>
                    <td style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{o.created_at ? o.created_at.slice(0, 10).split('-').reverse().join('.') : '—'}</td>
                    <td><div className="trunc">{o.clientName}</div></td>
                    <td style={{ fontSize: 13, color: o.managerName === '—' ? 'var(--text3)' : 'var(--text2)' }}><div className="trunc">{o.managerName}</div></td>
                    <td><span style={{ color: TYPE_COLORS[o.type], fontSize: 12, fontWeight: 600 }}>{ORDER_TYPES[o.type]}</span></td>
                    <td style={{ fontSize: 13 }}>
                      {statusAccent(o.status)
                        ? <span style={{ background: statusAccent(o.status), color: '#fff', borderRadius: 6, padding: '2px 9px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{statusLabel(o)}</span>
                        : statusLabel(o)}
                      {OUTCOME[o.outcome] && (
                        <span style={{ marginLeft: 6, color: OUTCOME[o.outcome].color, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                          <i className={`ti ${OUTCOME[o.outcome].icon}`} /> {OUTCOME[o.outcome].label}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmt(o.total)}</td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleInvestor(o)} title={o.in_investor ? 'Враховується в розрахунку інвестора' : 'Додати в розрахунок інвестора'}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
                        <i className="ti ti-diamond-filled" style={{ fontSize: 18, color: o.in_investor ? '#7C3AED' : 'var(--border)' }} />
                      </button>
                    </td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={!!o.commission_paid} onChange={() => toggleCommission(o)} style={{ width: 16, height: 16, cursor: 'pointer' }} title="Комісійні сплачені" />
                    </td>
                  </tr>
                ))}
                {sortedOrders.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 28 }}>Замовлень немає</td></tr>}
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
  const [managerId, setManagerId] = useState(user?.id || '')
  const [users, setUsers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('contractors').select('id, name').eq('is_client', true).order('name').then(({ data }) => setClients(data || []))
    supabase.from('profiles').select('id, full_name, email').order('full_name').then(({ data }) => setUsers(data || []))
  }, [])

  const save = async () => {
    if (!clientId) { setError('Оберіть клієнта'); return }
    setSaving(true); setError(null)
    const order_number = await nextOrderNumber(supabase)
    const base = { order_number, type, status: 'new', client_id: clientId, total: Number(total) || 0, description: description || null, created_by: user?.id || null }
    let { data, error } = await qc('orders').insert(withCompany({ ...base, manager_id: managerId || null })).select('id').single()
    // manager_id може ще не існувати (міграція 037) — тоді створюємо без нього
    if (error && /manager_id/.test(error.message || '')) {
      ;({ data, error } = await qc('orders').insert(withCompany(base)).select('id').single())
    }
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
          <div className="form-group"><label>Відповідальний менеджер</label>
            <select className="form-input" value={managerId} onChange={e => setManagerId(e.target.value)}>
              <option value="">— не призначено —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
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

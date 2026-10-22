import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { nextOrderNumber } from '../lib/orderNumber'
import { fmt } from '../lib/fmt'

const fmtDate = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''
import {
  ORDER_TYPES, OUTCOME, statusLabel, STATUS_ORDER,
  proposalOverdue, paymentOverdue,
} from '../lib/orders'
import { autoLinkPayment } from '../lib/orderPayments'
import Kanban from '../components/Kanban'
import OrderReport from '../components/OrderReport'
import { useSort, SortTh } from '../components/Sort'
import { PageHeader, Segmented, StatusPill, TableSkeleton, EmptyState, Modal, Button, useToast } from '../components/ui'
import { formatMoney, formatDate } from '../utils/format'
import './Orders.css'
import OrdersNew from './OrdersNew'
import { useNewUi } from '../lib/uiPrefs'

export default function Orders() {
  const navigate = useNavigate()
  const { user } = useUser()
  const toast = useToast()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('table') // table | kanban
  const [showNew, setShowNew] = useState(false)
  // новий інтерфейс: фільтр за менеджером і етапом (плитки) — лише відбір на клієнті
  const newUi = useNewUi()
  const [manager, setManager] = useState('')
  const [stage, setStage] = useState(null)

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

    // Прив'язані оплати клієнтів (статус «Оплачено клієнтом»)
    const payIds = [...new Set((ords || []).map(o => o.paid_transaction_id).filter(Boolean))]
    const payMap = {}
    if (payIds.length) {
      const { data: ptx } = await supabase.from('bank_transactions').select('id, date, amount').in('id', payIds)
      ;(ptx || []).forEach(t => { payMap[t.id] = t })
    }

    // невиконані задачі, прив'язані до замовлень (планер): кількість, прострочені, перша задача
    const tasksByOrder = {}
    {
      const { data: tk } = await supabase.from('tasks').select('id, title, entity_id, due_at, status')
        .eq('entity_type', 'order').in('status', ['new', 'in_progress', 'review', 'on_hold'])
      const now = Date.now()
      ;(tk || []).forEach(t => {
        const g = (tasksByOrder[t.entity_id] ||= { n: 0, late: 0, first: null })
        g.n++; if (t.status !== 'on_hold' && t.due_at && new Date(t.due_at).getTime() < now) g.late++
        if (!g.first || (t.due_at || '9') < (g.first.due_at || '9')) g.first = t
      })
    }
    const enriched = (ords || []).map(o => ({
      ...o,
      clientName: o.contractors?.name || '—',
      managerName: o.manager_id ? (userMap[o.manager_id] || '—') : '—',
      payment: o.paid_transaction_id ? (payMap[o.paid_transaction_id] || null) : null,
      tasks: tasksByOrder[o.id] || null,
      overdue: proposalOverdue(o, lastSent[o.id]) || paymentOverdue(subsByOrder[o.id]),
    }))
    setOrders(enriched)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Автопідбір оплат: лінкує замовлення до вхідних оплат з тим самим контрагентом і сумою.
  const [linking, setLinking] = useState(false)
  const autoLinkPayments = async () => {
    setLinking(true)
    let n = 0
    const targets = orders.filter(o => !o.paid_transaction_id && o.client_id && Number(o.total) > 0)
    for (const o of targets) {
      try { if (await autoLinkPayment(o)) n++ } catch { /* напр. міграція 056 ще не запущена */ }
    }
    setLinking(false)
    await load()
    toast(n ? `Прив'язано оплат: ${n}` : 'Нових однозначних збігів не знайдено')
  }

  // Відмітка «комісійні сплачені» — перемикач прямо в реєстрі (без переходу в картку)
  const toggleCommission = async (o) => {
    const val = !o.commission_paid
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, commission_paid: val } : x))
    const { error } = await qc('orders').update({ commission_paid: val }).eq('id', o.id)
    if (error) {
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, commission_paid: !val } : x))
      toast('Не вдалося зберегти: ' + (/commission_paid/.test(error.message || '') ? 'запустіть міграцію 045' : error.message), { type: 'error' })
    }
  }

  // Відмітка «врахувати в розрахунку інвестора» — яскрава, перемикається в реєстрі
  const toggleInvestor = async (o) => {
    const val = !o.in_investor
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, in_investor: val } : x))
    const { error } = await qc('orders').update({ in_investor: val }).eq('id', o.id)
    if (error) {
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, in_investor: !val } : x))
      toast('Не вдалося зберегти: ' + (/in_investor/.test(error.message || '') ? 'запустіть міграцію 047' : error.message), { type: 'error' })
    }
  }

  // Відмітка «додати в прогноз» (Інвестору → Прогноз)
  const toggleForecast = async (o) => {
    const val = !o.in_forecast
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, in_forecast: val } : x))
    const { error } = await qc('orders').update({ in_forecast: val }).eq('id', o.id)
    if (error) {
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, in_forecast: !val } : x))
      toast('Не вдалося зберегти: ' + (/in_forecast/.test(error.message || '') ? 'запустіть міграцію 061' : error.message), { type: 'error' })
    }
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return orders.filter(o => {
      const done = !!o.archived_at          // завершене (виконано/програно) — під капотом archived_at
      const lost = o.outcome === 'lost'
      if (filter === 'done') { if (!done || lost) return false }        // Виконані = завершені, крім програних
      else if (filter === 'lost') { if (!lost) return false }           // Програні
      else { if (done) return false }                                    // усі інші фільтри — лише в роботі
      if (filter === 'mine' && o.manager_id !== user?.id) return false
      if (manager && o.managerName !== manager) return false
      if (stage && (o.archived_at || o.status !== stage)) return false
      if (!term) return true
      return o.clientName.toLowerCase().includes(term) || (o.order_number || '').toLowerCase().includes(term)
    })
  }, [orders, q, filter, manager, stage])

  const { sort, onSort, sorted } = useSort('order_number', 'asc')
  const sortedOrders = sorted(filtered, {
    order_number: o => o.order_number || '',
    created: o => o.created_at || '',
    investor: o => o.in_investor ? 1 : 0,
    forecast: o => o.in_forecast ? 1 : 0,
    commission: o => o.commission_paid ? 1 : 0,
    client: o => o.clientName || '',
    manager: o => o.managerName || '',
    type: o => ORDER_TYPES[o.type] || '',
    status: o => statusLabel(o),
    stage: o => STATUS_ORDER.indexOf(o.status),
    total: o => Number(o.total) || 0,
  })

  // Лічильники для перемикача — ті самі правила, що й у filtered (без пошуку)
  const counts = useMemo(() => {
    const c = { all: 0, mine: 0, done: 0, lost: 0 }
    orders.forEach(o => {
      if (o.outcome === 'lost') c.lost++
      else if (o.archived_at) c.done++
      if (!o.archived_at) { c.all++; if (o.manager_id === user?.id) c.mine++ }
    })
    return c
  }, [orders, user?.id])

  const FILTERS = [
    { value: 'all', label: 'Усі', count: counts.all }, { value: 'mine', label: 'Мої', count: counts.mine },
    { value: 'done', label: 'Виконані', count: counts.done }, { value: 'lost', label: 'Програні', count: counts.lost },
  ]
  const VIEWS = [
    { value: 'table', label: 'Таблиця', icon: 'ti-list' },
    { value: 'kanban', label: 'Канбан', icon: 'ti-layout-kanban' },
    { value: 'report', label: 'Звіт', icon: 'ti-report' },
  ]

  if (newUi) return (
    <>
      <OrdersNew orders={orders} rows={sortedOrders} loading={loading} q={q} setQ={setQ} filter={filter} setFilter={setFilter} filters={FILTERS}
        view={view} setView={setView} views={VIEWS} manager={manager} setManager={setManager} stage={stage} setStage={setStage}
        linking={linking} autoLinkPayments={autoLinkPayments} onNew={() => setShowNew(true)} navigate={navigate}
        flags={{ toggleInvestor, toggleForecast, toggleCommission }} sort={sort} onSort={onSort}
        kanban={<Kanban orders={filtered} type={filter} onOpen={(id) => navigate(`/orders/${id}`)} />}
        report={<OrderReport />} />
      {showNew && <NewOrderModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); navigate(`/orders/${id}`) }} />}
    </>
  )

  return (
    <div>
      <PageHeader title="Замовлення"
        primary={{ label: 'Нове замовлення', icon: 'ti-plus', onClick: () => setShowNew(true) }}
        secondary={view !== 'report' ? { label: linking ? 'Підбір…' : 'Підтягнути оплати', icon: 'ti-cash', onClick: autoLinkPayments, loading: linking } : undefined} />

      <div className="orders-toolbar">
        {view !== 'report' && <>
          <input className="form-input orders-search" type="search" placeholder="Пошук за клієнтом або номером…" aria-label="Пошук замовлень" value={q} onChange={e => setQ(e.target.value)} />
          <Segmented ariaLabel="Фільтр замовлень" value={filter} onChange={setFilter} options={FILTERS} />
        </>}
        <div className="orders-views"><Segmented ariaLabel="Вигляд" value={view} onChange={setView} options={VIEWS} /></div>
      </div>

      {(filter === 'done' || filter === 'lost') && !loading && view !== 'report' && filtered.length > 0 && (
        <p className="orders-summary">
          {filter === 'done' ? 'Виконані' : 'Програні'}: {filtered.length} · {formatMoney(filtered.reduce((s, o) => s + (Number(o.total) || 0), 0))} грн
        </p>
      )}

      {view === 'report' ? (
        <OrderReport />
      ) : loading ? (
        <TableSkeleton rows={8} cols={7} label="Завантаження замовлень…" />
      ) : view === 'kanban' ? (
        <Kanban orders={filtered} type={filter} onOpen={(id) => navigate(`/orders/${id}`)} />
      ) : sortedOrders.length === 0 ? (
        <div className="card">
          {q.trim() || filter !== 'all'
            ? <EmptyState icon="ti-search" title="Нічого не знайдено" text="Змініть пошук або фільтр."
                action={{ label: 'Скинути фільтри', onClick: () => { setQ(''); setFilter('all') } }} />
            : <EmptyState icon="ti-clipboard-list" title="Замовлень ще немає" text="Створіть перше замовлення — далі його етапи, документи й оплати будуть тут."
                action={{ label: 'Нове замовлення', icon: 'ti-plus', onClick: () => setShowNew(true) }} />}
        </div>
      ) : (
        <div className="card">
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table className="orders-table">
              <thead><tr>
                <SortTh label="№" k="order_number" sort={sort} onSort={onSort} />
                <SortTh label="Дата" k="created" sort={sort} onSort={onSort} />
                <SortTh label="Клієнт" k="client" sort={sort} onSort={onSort} />
                <SortTh label="Менеджер" k="manager" sort={sort} onSort={onSort} />
                <SortTh label="Статус" k="status" sort={sort} onSort={onSort} />
                <SortTh label="Сума з ПДВ" k="total" sort={sort} onSort={onSort} align="right" />
                <th style={{ textAlign: 'center', width: 96 }} title="Інвестор · Прогноз · Комісію сплачено">Позначки</th>
              </tr></thead>
              <tbody>
                {sortedOrders.map(o => (
                  <tr key={o.id} className={o.overdue ? 'orders-row is-overdue' : 'orders-row'} onClick={() => navigate(`/orders/${o.id}`)}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{o.order_number || o.id.slice(0, 6)}
                      {o.tasks && <button type="button" className={`orders-task-badge${o.tasks.late ? ' is-late' : ''}`}
                        onClick={e => { e.stopPropagation(); navigate(o.tasks.n === 1 ? `/tasks?task=${o.tasks.first.id}` : `/orders/${o.id}?tab=tasks`) }}
                        title={o.tasks.n === 1 ? `Задача: ${o.tasks.first.title}` : `Невиконаних задач: ${o.tasks.n}${o.tasks.late ? `, прострочено: ${o.tasks.late}` : ''}`}
                        aria-label={`Невиконаних задач: ${o.tasks.n}${o.tasks.late ? `, прострочено: ${o.tasks.late}` : ''}`}>
                        <i className="ti ti-checklist" aria-hidden="true" />{o.tasks.n}</button>}
                    </td>
                    <td className="orders-muted" style={{ whiteSpace: 'nowrap' }} title={o.created_at ? fmtDate(o.created_at) : undefined}>{o.created_at ? formatDate(o.created_at) : '—'}</td>
                    <td><div className="trunc">{o.clientName}</div></td>
                    <td className="orders-muted"><div className="trunc">{o.managerName}</div></td>
                    <td>
                      <span className="orders-pills">
                        {OUTCOME[o.outcome]
                          ? <StatusPill status={o.outcome} kind="order" />
                          : <StatusPill status={o.status} kind="order" label={statusLabel(o)} />}
                        {o.paid_transaction_id && o.status !== 'paid' && (
                          <span title={o.payment ? `Оплата ${fmtDate(o.payment.date)} · ${fmt(Math.abs(o.payment.amount))} грн` : 'Оплачено клієнтом'}>
                            <StatusPill status="paid" kind="order" size="sm" label="Оплачено клієнтом" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(o.total)}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <span className="orders-flags">
                        <button type="button" onClick={() => toggleInvestor(o)} aria-pressed={!!o.in_investor} title={o.in_investor ? 'Інвестор: враховується в розрахунку' : 'Інвестор: додати в розрахунок'} aria-label="Інвестор">
                          <i className="ti ti-diamond-filled" aria-hidden="true" style={{ color: o.in_investor ? '#7C3AED' : undefined }} /></button>
                        <button type="button" onClick={() => toggleForecast(o)} aria-pressed={!!o.in_forecast} title={o.in_forecast ? 'Прогноз: у прогнозі' : 'Прогноз: додати'} aria-label="Прогноз">
                          <i className="ti ti-trending-up" aria-hidden="true" style={{ color: o.in_forecast ? 'var(--blue)' : undefined }} /></button>
                        <button type="button" onClick={() => toggleCommission(o)} aria-pressed={!!o.commission_paid} title={o.commission_paid ? 'Комісію сплачено' : 'Комісію не сплачено'} aria-label="Комісію сплачено">
                          <i className={`ti ${o.commission_paid ? 'ti-square-check-filled' : 'ti-square'}`} aria-hidden="true" style={{ color: o.commission_paid ? '#16a34a' : undefined }} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); navigate(`/orders/${id}`) }} />}
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
    <Modal open onClose={onClose} title="Нове замовлення"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Скасувати</Button>
        <Button variant="dark" onClick={save} loading={saving}>Створити</Button>
      </>}>
      <div className="form-group"><label className="form-label" id="new-order-type">Напрямок</label>
        <Segmented ariaLabel="Напрямок" value={type} onChange={setType} options={Object.entries(ORDER_TYPES).map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="form-group"><label className="form-label" htmlFor="new-order-client">Клієнт *</label>
        <select id="new-order-client" className="form-input" value={clientId} onChange={e => setClientId(e.target.value)} aria-invalid={error === 'Оберіть клієнта' || undefined}>
          <option value="">— оберіть —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="form-group"><label className="form-label" htmlFor="new-order-manager">Відповідальний менеджер</label>
        <select id="new-order-manager" className="form-input" value={managerId} onChange={e => setManagerId(e.target.value)}>
          <option value="">— не призначено —</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
        </select>
      </div>
      <div className="form-group"><label className="form-label" htmlFor="new-order-total">Сума (план), грн</label>
        <input id="new-order-total" className="form-input" type="number" inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></div>
      <div className="form-group"><label className="form-label" htmlFor="new-order-desc">Опис</label>
        <input id="new-order-desc" className="form-input" value={description} onChange={e => setDescription(e.target.value)} /></div>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
    </Modal>
  )
}

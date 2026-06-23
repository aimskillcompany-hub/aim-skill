import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import { getDocType } from '../lib/docgen'
import DocModal from '../components/DocModal'
import {
  ORDER_TYPES, TYPE_COLORS, flowFor, stepFor, statusLabel, nextActionLabel,
  nextStatus, isOpen, needsAction, proposalOverdue,
} from '../lib/orders'

const TABS = [
  { id: 'details', label: 'Деталі', icon: 'ti-info-circle' },
  { id: 'proposals', label: 'КП', icon: 'ti-file-text' },
  { id: 'documents', label: 'Документи', icon: 'ti-files' },
  { id: 'suppliers', label: 'Субзамовлення', icon: 'ti-truck-delivery' },
  { id: 'transactions', label: 'Транзакції', icon: 'ti-building-bank' },
  { id: 'stock', label: 'Склад', icon: 'ti-package' },
]

export default function OrderCard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [o, setO] = useState(null)
  const [lastSent, setLastSent] = useState(null)
  const [tab, setTab] = useState('details')

  const load = async () => {
    const { data } = await supabase.from('orders').select('*, contractors(name)').eq('id', id).single()
    setO(data)
    const { data: props } = await supabase.from('commercial_proposals').select('sent_at').eq('order_id', id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1)
    setLastSent(props?.[0]?.sent_at || null)
  }
  useEffect(() => { load() }, [id])

  if (!o) return <div className="page-header"><h1>Завантаження…</h1></div>

  const advance = async () => {
    const ns = nextStatus(o)
    const upd = { status: ns }
    if (ns === 'closed') upd.closed_at = new Date().toISOString()
    await supabase.from('orders').update(upd).eq('id', id)
    load()
  }

  const step = stepFor(o)
  const overdue = proposalOverdue(o, lastSent)

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => navigate('/orders')} style={{ marginBottom: 10 }}><i className="ti ti-arrow-left" /> До реєстру</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 6 }}>Замовлення {o.order_number || o.id.slice(0, 6)}</h1>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: TYPE_COLORS[o.type], fontWeight: 600, fontSize: 13 }}>{ORDER_TYPES[o.type]}</span>
              <span style={{ color: 'var(--text2)', fontSize: 13 }}>{o.contractors?.name}</span>
              <span style={{ background: 'var(--surface2)', borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{statusLabel(o)}</span>
              <span style={{ color: 'var(--text2)', fontSize: 13 }}>{fmt(o.total)} грн</span>
            </div>
          </div>
        </div>
      </div>

      {overdue && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-alert-triangle" /> Минуло понад 48 год від надсилання КП без відповіді клієнта.
        </div>
      )}

      {/* Велика кнопка «Наступна дія» */}
      {isOpen(o) && (
        <button onClick={advance} className="btn btn-primary" style={{
          width: '100%', padding: '16px', fontSize: 15, marginBottom: 18,
          background: needsAction(o) ? 'var(--blue)' : 'var(--surface2)',
          color: needsAction(o) ? '#fff' : 'var(--text2)', justifyContent: 'center',
        }}>
          <i className={`ti ${needsAction(o) ? 'ti-arrow-right' : 'ti-clock'}`} />
          {step.next}{step.act === 'wait' ? ' (позначити виконаним)' : ''}
        </button>
      )}

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
          }}><i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />{t.label}</button>
        ))}
      </div>

      {tab === 'details' && <DetailsTab o={o} onSaved={load} />}
      {tab === 'proposals' && <ProposalsTab o={o} onChange={load} />}
      {tab === 'documents' && <DocumentsTab o={o} />}
      {tab === 'suppliers' && <SuppliersTab o={o} />}
      {tab === 'transactions' && <TransactionsTab o={o} />}
      {tab === 'stock' && <StockTab o={o} />}
    </div>
  )
}

// ───────── Деталі ─────────
function DetailsTab({ o, onSaved }) {
  const [form, setForm] = useState({ total: o.total, description: o.description || '', status: o.status })
  const [saved, setSaved] = useState(false)
  const flow = flowFor(o.type)
  const save = async () => {
    const upd = { total: Number(form.total) || 0, description: form.description || null, status: form.status }
    if (form.status === 'closed' && !o.closed_at) upd.closed_at = new Date().toISOString()
    await supabase.from('orders').update(upd).eq('id', o.id)
    setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved()
  }
  return (
    <div className="card">
      <div className="form-grid">
        <div className="form-group"><label>Сума</label><input className="form-input" type="number" value={form.total} onChange={e => setForm(f => ({ ...f, total: e.target.value }))} /></div>
        <div className="form-group"><label>Статус (ручне керування)</label>
          <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {flow.map(s => <option key={s.s} value={s.s}>{s.label}</option>)}
          </select>
        </div>
        <div className="form-group full"><label>Опис</label><input className="form-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save}>Зберегти</button>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
      </div>
    </div>
  )
}

// ───────── КП ─────────
function ProposalsTab({ o, onChange }) {
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null) // new proposal draft
  const load = () => supabase.from('commercial_proposals').select('*').eq('order_id', o.id).order('version', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [o.id])

  const startNew = () => setEditing({ version: (rows[0]?.version || 0) + 1, items: [{ name: '', qty: 1, price: 0 }] })
  const itemsTotal = (items) => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0)

  const saveDraft = async () => {
    const total = itemsTotal(editing.items)
    await supabase.from('commercial_proposals').insert({ order_id: o.id, version: editing.version, items: editing.items, total, status: 'draft' })
    setEditing(null); load()
  }
  const send = async (p) => {
    await supabase.from('commercial_proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', p.id)
    if (o.type === 'trade' && o.status === 'new') await supabase.from('orders').update({ status: 'proposal_sent' }).eq('id', o.id)
    load(); onChange()
  }
  const setStatus = async (p, status) => { await supabase.from('commercial_proposals').update({ status }).eq('id', p.id); load() }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Комерційні пропозиції</div>
        {!editing && <button className="btn btn-primary" onClick={startNew}><i className="ti ti-plus" /> Нова версія</button>}
      </div>

      {editing && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Версія {editing.version}</div>
          {editing.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input className="form-input" placeholder="Найменування" value={it.name} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, name: e.target.value }; return { ...d, items } })} style={{ flex: 2 }} />
              <input className="form-input" type="number" placeholder="К-сть" value={it.qty} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, qty: e.target.value }; return { ...d, items } })} style={{ width: 80 }} />
              <input className="form-input" type="number" placeholder="Ціна" value={it.price} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, price: e.target.value }; return { ...d, items } })} style={{ width: 110 }} />
              <button className="btn" onClick={() => setEditing(d => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}><i className="ti ti-x" /></button>
            </div>
          ))}
          <button className="btn" onClick={() => setEditing(d => ({ ...d, items: [...d.items, { name: '', qty: 1, price: 0 }] }))} style={{ marginBottom: 10 }}><i className="ti ti-plus" /> Позиція</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600 }}>Разом: {fmt(itemsTotal(editing.items))} грн</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setEditing(null)}>Скасувати</button>
              <button className="btn btn-primary" onClick={saveDraft}>Зберегти чернетку</button>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && !editing && <p style={{ color: 'var(--text3)', fontSize: 13 }}>КП ще немає.</p>}
      {rows.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1 }}>
            <b>Версія {p.version}</b> · {fmt(p.total)} грн
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{(p.items || []).length} позицій{p.sent_at ? ` · надіслано ${p.sent_at.slice(0, 10)}` : ''}</div>
          </div>
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 6, background: 'var(--surface2)', color: 'var(--text2)' }}>{PROP_STATUS[p.status] || p.status}</span>
          {p.status === 'draft' && <button className="btn btn-primary" onClick={() => send(p)}>Надіслати</button>}
          {p.status === 'sent' && <>
            <button className="btn" onClick={() => setStatus(p, 'accepted')}>Прийнято</button>
            <button className="btn" onClick={() => setStatus(p, 'rejected')}>Відхилено</button>
          </>}
        </div>
      ))}
    </div>
  )
}
const PROP_STATUS = { draft: 'Чернетка', sent: 'Надіслано', accepted: 'Прийнято', rejected: 'Відхилено' }

// ───────── Документи ─────────
function DocumentsTab({ o }) {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [openDoc, setOpenDoc] = useState(null)
  const load = () => supabase.from('documents')
    .select('id, type, doc_number, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, contractors(name)')
    .eq('order_id', o.id).order('created_at', { ascending: false })
    .then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [o.id])
  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Документів до замовлення немає. Прив'язка/генерація — модуль Документів." />
  return (
    <>
      <Table head={['Тип', '№', 'Файл', 'Сума', 'Підписано', 'Дата']}>
        {rows.map(d => (
          <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setOpenDoc(d)}>
            <td>{getDocType(d.type)?.label || d.type || '—'}</td>
            <td style={{ color: 'var(--text2)', fontSize: 12 }}>{d.doc_number || '—'}</td>
            <td><div className="trunc">{d.file_name}</div></td>
            <td style={{ textAlign: 'right' }}>{d.amount ? fmt(d.amount) : '—'}</td>
            <td>{d.is_signed ? '✓' : '—'}</td><td>{(d.created_at || '').slice(0, 10)}</td>
          </tr>
        ))}
      </Table>
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => { setOpenDoc(null); load() }} />}
    </>
  )
}

// ───────── Субзамовлення ─────────
function SuppliersTab({ o }) {
  const [rows, setRows] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [add, setAdd] = useState(null)
  const load = () => supabase.from('supplier_orders').select('*, contractors(name)').eq('order_id', o.id).order('created_at').then(({ data }) => setRows(data || []))
  useEffect(() => {
    load()
    supabase.from('contractors').select('id, name').eq('is_supplier', true).order('name').then(({ data }) => setSuppliers(data || []))
  }, [o.id])

  const create = async () => {
    const delay = Number(add.delay) || 0
    const due = delay ? new Date(Date.now() + delay * 864e5).toISOString().split('T')[0] : null
    await supabase.from('supplier_orders').insert({ order_id: o.id, supplier_id: add.supplier_id || null, total: Number(add.total) || 0, payment_delay_days: delay, payment_due_date: due, status: 'new' })
    setAdd(null); load()
  }
  const setStatus = async (s, status) => { await supabase.from('supplier_orders').update({ status }).eq('id', s.id); load() }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Субзамовлення дистрибюторам</div>
        {!add && <button className="btn btn-primary" onClick={() => setAdd({ supplier_id: '', total: '', delay: '' })}><i className="ti ti-plus" /> Додати</button>}
      </div>
      {add && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: '1 1 180px' }}><label>Постачальник</label>
            <select className="form-input" value={add.supplier_id} onChange={e => setAdd(a => ({ ...a, supplier_id: e.target.value }))}>
              <option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ width: 120 }}><label>Сума</label><input className="form-input" type="number" value={add.total} onChange={e => setAdd(a => ({ ...a, total: e.target.value }))} /></div>
          <div className="form-group" style={{ width: 120 }}><label>Відстрочка, дн</label><input className="form-input" type="number" value={add.delay} onChange={e => setAdd(a => ({ ...a, delay: e.target.value }))} /></div>
          <button className="btn btn-primary" onClick={create}>Зберегти</button>
          <button className="btn" onClick={() => setAdd(null)}>Скасувати</button>
        </div>
      )}
      {rows.length === 0 && !add && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Субзамовлень немає.</p>}
      {rows.map(s => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1 }}><b>{s.contractors?.name || 'Постачальник'}</b> · {fmt(s.total)} грн
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{s.payment_due_date ? `оплата до ${s.payment_due_date}` : 'без відстрочки'}</div>
          </div>
          <select className="form-input" value={s.status} onChange={e => setStatus(s, e.target.value)} style={{ width: 150, padding: '4px 8px', fontSize: 12 }}>
            {['new', 'ordered', 'in_transit', 'received', 'paid'].map(st => <option key={st} value={st}>{st}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}

// ───────── Транзакції ─────────
function TransactionsTab({ o }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    (async () => {
      const { data: docs } = await supabase.from('documents').select('id').eq('order_id', o.id)
      const docIds = (docs || []).map(d => d.id)
      if (!docIds.length) { setRows([]); return }
      const { data } = await supabase.from('transaction_documents')
        .select('amount, bank_transactions(id, date, description, amount, direction)')
        .in('document_id', docIds)
      setRows(data || [])
    })()
  }, [o.id])
  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Прив'язаних транзакцій немає. Прив'язка робиться в модулі Банк/Каса (Фаза 5)." />
  return <Table head={['Дата', 'Опис', 'Покриття', 'Напрям']}>
    {rows.map((r, i) => { const t = r.bank_transactions || {}; return (
      <tr key={i}><td style={{ fontSize: 12 }}>{t.date}</td><td><div className="trunc">{t.description}</div></td>
        <td style={{ textAlign: 'right' }}>{fmt(r.amount || t.amount)}</td><td>{t.direction}</td></tr>
    )})}
  </Table>
}

// ───────── Склад ─────────
function StockTab({ o }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.from('stock_movements').select('id, type, quantity, cost_price, total, date, products(name)').eq('order_id', o.id).order('date', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [o.id])
  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Складських рухів за замовленням немає. Списання/оприбуткування — Фаза 6." />
  return <Table head={['Товар', 'Тип', 'К-сть', 'Собівартість', 'Дата']}>
    {rows.map(m => <tr key={m.id}><td><div className="trunc">{m.products?.name}</div></td><td>{m.type === 'in' ? 'Прихід' : 'Видаток'}</td><td style={{ textAlign: 'right' }}>{m.quantity}</td><td style={{ textAlign: 'right' }}>{fmt(m.cost_price || m.total)}</td><td>{m.date}</td></tr>)}
  </Table>
}

// ───────── helpers ─────────
const Loading = () => <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
const Empty = ({ text }) => <div className="card"><p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>{text}</p></div>
const Table = ({ head, children }) => (
  <div className="card"><div className="tbl-wrap" style={{ border: 'none' }}>
    <table><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
  </div></div>
)

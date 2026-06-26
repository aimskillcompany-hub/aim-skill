import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import { getDocType } from '../lib/docgen'
import { resolveProduct } from '../lib/stockService'
import DocModal from '../components/DocModal'
import ProductSelect from '../components/ui/ProductSelect'
import PricePickerModal from '../components/ui/PricePickerModal'
import {
  ORDER_TYPES, TYPE_COLORS, flowFor, stepFor, statusLabel, nextActionLabel,
  nextStatus, isOpen, needsAction, proposalOverdue,
} from '../lib/orders'

const TABS = [
  { id: 'details', label: 'Деталі', icon: 'ti-info-circle' },
  { id: 'items', label: 'Товари', icon: 'ti-list-details' },
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
  const [busy, setBusy] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [msg, setMsg] = useState(null)

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

  const toggleArchive = async () => {
    setBusy('archive'); setMsg(null)
    await supabase.from('orders').update({ archived_at: o.archived_at ? null : new Date().toISOString() }).eq('id', id)
    setBusy(''); load()
  }

  // Жорстке видалення дозволене лише за відсутності прив'язаних документів
  // (реальні облікові дані). Інакше — пропонуємо архівування.
  const del = async () => {
    setBusy('del'); setMsg(null)
    const { count } = await supabase.from('documents').select('id', { count: 'exact', head: true }).eq('order_id', id)
    if (count > 0) {
      setBusy(''); setConfirmDel(false)
      setMsg(`Не можна видалити: до замовлення прив'язано ${count} документ(ів). Заархівуйте його замість видалення.`)
      return
    }
    const { error } = await supabase.from('orders').delete().eq('id', id)
    setBusy('')
    if (error) { setMsg('Помилка видалення: ' + error.message); return }
    navigate('/orders')
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={toggleArchive} disabled={!!busy}>
              <i className={`ti ${o.archived_at ? 'ti-archive-off' : 'ti-archive'}`} /> {o.archived_at ? 'Відновити' : 'Архівувати'}
            </button>
            {!confirmDel ? (
              <button className="btn" onClick={() => { setMsg(null); setConfirmDel(true) }} disabled={!!busy} style={{ color: 'var(--red)' }}>
                <i className="ti ti-trash" /> Видалити
              </button>
            ) : (
              <>
                <button className="btn" onClick={del} disabled={busy === 'del'} style={{ background: 'var(--red)', color: '#fff' }}>{busy === 'del' ? '…' : 'Підтвердити видалення'}</button>
                <button className="btn" onClick={() => setConfirmDel(false)} disabled={busy === 'del'}>Скасувати</button>
              </>
            )}
          </div>
        </div>
      </div>

      {msg && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-alert-circle" /> {msg}
        </div>
      )}

      {o.archived_at && (
        <div style={{ background: 'var(--surface2)', color: 'var(--text2)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-archive" /> Замовлення в архіві (з {o.archived_at.slice(0, 10)}) — приховане з реєстру.
        </div>
      )}

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
      {tab === 'items' && <ItemsTab o={o} onChange={load} />}
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
  const [itemsSum, setItemsSum] = useState(null)
  const [hasItems, setHasItems] = useState(false)
  const [saved, setSaved] = useState(false)
  const flow = flowFor(o.type)

  useEffect(() => {
    supabase.from('order_items').select('qty, unit_price').eq('order_id', o.id).then(({ data }) => {
      setHasItems((data || []).length > 0)
      setItemsSum((data || []).reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unit_price) || 0), 0))
    })
  }, [o.id])

  const effectiveTotal = hasItems ? (itemsSum || 0) : (Number(form.total) || 0)
  const save = async () => {
    const upd = { total: effectiveTotal, description: form.description || null, status: form.status }
    if (form.status === 'closed' && !o.closed_at) upd.closed_at = new Date().toISOString()
    await supabase.from('orders').update(upd).eq('id', o.id)
    setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved()
  }
  return (
    <div className="card">
      <div className="form-grid">
        <div className="form-group"><label>Сума</label>
          {hasItems
            ? <><input className="form-input" value={`${fmt(itemsSum || 0)} грн`} disabled style={{ background: 'var(--surface2)' }} /><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Рахується з цін продажу товарів (вкладка «Товари»)</div></>
            : <input className="form-input" type="number" value={form.total} onChange={e => setForm(f => ({ ...f, total: e.target.value }))} />}
        </div>
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

// ───────── Товари ─────────
// Необов'язкові позиції замовлення. product_id прив'язує до довідника
// (переюз у КП/документах/складі); name — знімок назви.
function ItemsTab({ o, onChange }) {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  const load = () => supabase.from('order_items').select('*, contractors(name)').eq('order_id', o.id).order('created_at')
    .then(({ data }) => setRows((data || []).map(r => ({ ...r, supplier_name: r.contractors?.name || null }))))
  useEffect(() => { load() }, [o.id])

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, { product_id: null, name: '', unit: 'шт', qty: 1, cost_price: 0, unit_price: 0, supplier_id: null, supplier_name: null }])
  // Підстановка позиції з прайсу: закупівля = ціна прайсу, продаж = роздріб (редагована),
  // запам'ятовуємо постачальника (для авто-формування субзамовлень)
  const addFromPrice = (p) => {
    setShowPicker(false)
    setRows(rs => [...rs, {
      product_id: null, name: p.name, unit: p.unit || 'шт', qty: 1,
      cost_price: p.price || 0,
      unit_price: (p.retail_price > 0 ? p.retail_price : p.price) || 0,
      supplier_id: p.supplier_id || null, supplier_name: p.contractors?.name || null,
    }])
  }
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i))
  const rowTotal = (r) => (Number(r.qty) || 0) * (Number(r.unit_price) || 0)
  const rowMargin = (r) => ((Number(r.unit_price) || 0) - (Number(r.cost_price) || 0)) * (Number(r.qty) || 0)
  const marginPct = (r) => { const p = Number(r.unit_price) || 0; return p > 0 ? ((p - (Number(r.cost_price) || 0)) / p) * 100 : 0 }
  const sum = (rows || []).reduce((s, r) => s + rowTotal(r), 0)
  const marginSum = (rows || []).reduce((s, r) => s + rowMargin(r), 0)

  const save = async () => {
    setSaving(true)
    // Створити/знайти товари для рядків з вільною назвою без прив'язки
    const resolved = []
    for (const r of rows) {
      if (!r.name?.trim()) continue
      let product_id = r.product_id
      if (!product_id) {
        const res = await resolveProduct(r.name, r.unit, Number(r.unit_price) || null, user?.id)
        product_id = res?.productId || null
      }
      resolved.push({
        order_id: o.id, product_id, name: r.name.trim(), unit: r.unit || 'шт',
        qty: Number(r.qty) || 0, cost_price: Number(r.cost_price) || 0,
        unit_price: Number(r.unit_price) || 0, total: rowTotal(r), supplier_id: r.supplier_id || null,
      })
    }
    // Замінюємо повний набір позицій замовлення
    await supabase.from('order_items').delete().eq('order_id', o.id)
    if (resolved.length) await supabase.from('order_items').insert(resolved)
    // Сума замовлення = сума цін продажу товарів (синхронізуємо автоматично)
    if (resolved.length) await supabase.from('orders').update({ total: sum }).eq('id', o.id)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
    load(); onChange()
  }

  if (rows == null) return <Loading />

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Товари замовлення</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowPicker(true)}><i className="ti ti-tag" /> З прайсу</button>
          <button className="btn" onClick={addRow}><i className="ti ti-plus" /> Позиція</button>
        </div>
      </div>

      {rows.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Товарів немає. Додавайте їх, коли стане відомо, що саме входить у замовлення.</p>}

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
          <div style={{ flex: '2 1 220px', minWidth: 180 }}>Товар</div>
          <div style={{ width: 80 }}>К-сть</div>
          <div style={{ width: 70 }}>Од.</div>
          <div style={{ width: 110 }}>Закупівля</div>
          <div style={{ width: 110 }}>Ціна продажу</div>
          <div style={{ width: 120, textAlign: 'right' }}>Маржа</div>
          <div style={{ width: 110, textAlign: 'right' }}>Сума</div>
          <div style={{ width: 38 }} />
        </div>
      )}

      {rows.map((r, i) => {
        const m = rowMargin(r), mp = marginPct(r)
        const mColor = m > 0 ? 'var(--green)' : m < 0 ? 'var(--red)' : 'var(--text3)'
        return (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 220px', minWidth: 180 }}>
            <ProductSelect
              value={r.name}
              placeholder="Назва товару або артикул"
              onChange={(name) => setRow(i, { name, product_id: null })}
              onSelect={(p) => p._new
                ? setRow(i, { name: p.name, product_id: null })
                : setRow(i, { name: p.name, product_id: p.id, unit: p.unit || 'шт', cost_price: r.cost_price || p.buy_price || 0, unit_price: r.unit_price || p.sell_price || 0, supplier_id: null, supplier_name: null })}
            />
            {r.supplier_name
              ? <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 2 }}><i className="ti ti-tag" /> {r.supplier_name}</div>
              : r.product_id && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}><i className="ti ti-link" /> з довідника</div>}
          </div>
          <input className="form-input" type="number" placeholder="К-сть" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} style={{ width: 80 }} />
          <input className="form-input" placeholder="од." value={r.unit || ''} onChange={e => setRow(i, { unit: e.target.value })} style={{ width: 70 }} />
          <input className="form-input" type="number" placeholder="Закупівля" value={r.cost_price ?? ''} onChange={e => setRow(i, { cost_price: e.target.value })} style={{ width: 110 }} />
          <input className="form-input" type="number" placeholder="Ціна" value={r.unit_price} onChange={e => setRow(i, { unit_price: e.target.value })} style={{ width: 110 }} />
          <div style={{ width: 120, textAlign: 'right', padding: '8px 0', fontSize: 13, color: mColor }}>{fmt(m)}<div style={{ fontSize: 11 }}>{mp.toFixed(0)}%</div></div>
          <div style={{ width: 110, textAlign: 'right', padding: '8px 0', fontSize: 13, fontWeight: 500 }}>{fmt(rowTotal(r))}</div>
          <button className="btn" onClick={() => removeRow(i)} title="Прибрати"><i className="ti ti-x" /></button>
        </div>
        )
      })}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>Разом: {fmt(sum)} грн
          {marginSum !== 0 && <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 500, color: marginSum > 0 ? 'var(--green)' : 'var(--red)' }}>Маржа: {fmt(marginSum)} грн{sum > 0 ? ` (${((marginSum / sum) * 100).toFixed(0)}%)` : ''}</span>}
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginTop: 2 }}>Ця сума стає «Сумою» замовлення після збереження.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '…' : 'Зберегти'}</button>
        </div>
      </div>

      {showPicker && <PricePickerModal onPick={addFromPrice} onClose={() => setShowPicker(false)} />}
    </div>
  )
}

// ───────── КП ─────────
function ProposalsTab({ o, onChange }) {
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null) // new proposal draft
  const load = () => supabase.from('commercial_proposals').select('*').eq('order_id', o.id).order('version', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [o.id])

  // Нова версія КП префілиться позиціями товарів замовлення (якщо є)
  const startNew = async () => {
    const { data: items } = await supabase.from('order_items').select('name, qty, unit_price').eq('order_id', o.id).order('created_at')
    const seed = (items || []).length
      ? items.map(it => ({ name: it.name, qty: Number(it.qty) || 1, price: Number(it.unit_price) || 0 }))
      : [{ name: '', qty: 1, price: 0 }]
    setEditing({ version: (rows[0]?.version || 0) + 1, items: seed })
  }
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
    .select('id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, contractors(name)')
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
            <td>{d.is_signed ? '✓' : '—'}</td><td>{(d.doc_date || d.created_at || '').slice(0, 10)}</td>
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
  const [items, setItems] = useState({}) // supplier_order_id -> [items]
  const [suppliers, setSuppliers] = useState([])
  const [add, setAdd] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = async () => {
    const { data: so } = await supabase.from('supplier_orders').select('*, contractors(name)').eq('order_id', o.id).order('created_at')
    setRows(so || [])
    const ids = (so || []).map(s => s.id)
    if (ids.length) {
      const { data: soi } = await supabase.from('supplier_order_items').select('*').in('supplier_order_id', ids)
      const map = {}; (soi || []).forEach(it => { (map[it.supplier_order_id] ||= []).push(it) })
      setItems(map)
    } else setItems({})
  }
  useEffect(() => {
    load()
    supabase.from('contractors').select('id, name').eq('is_supplier', true).order('name').then(({ data }) => setSuppliers(data || []))
  }, [o.id])

  const create = async () => {
    const delay = Number(add.delay) || 0
    const due = delay ? new Date(Date.now() + delay * 864e5).toISOString().split('T')[0] : null
    await supabase.from('supplier_orders').insert({ order_id: o.id, supplier_id: add.supplier_id || null, total: Number(add.total) || 0, payment_delay_days: delay, payment_due_date: due, status: 'new', source: 'manual' })
    setAdd(null); load()
  }
  const setStatus = async (s, status) => { await supabase.from('supplier_orders').update({ status }).eq('id', s.id); load() }
  const del = async (s) => { await supabase.from('supplier_orders').delete().eq('id', s.id); load() }

  // Сформувати субзамовлення з товарів замовлення: групуємо за постачальником
  const generate = async () => {
    setBusy(true); setMsg(null)
    const { data: oi } = await supabase.from('order_items').select('supplier_id, product_id, name, unit, qty, cost_price').eq('order_id', o.id)
    const groups = {}
    for (const it of oi || []) {
      if (!(Number(it.qty) > 0)) continue
      const key = it.supplier_id || '__none__'
      ;(groups[key] ||= []).push(it)
    }
    if (!Object.keys(groups).length) { setBusy(false); setMsg('Немає товарів для формування (додайте позиції у вкладці «Товари»).'); return }
    // Заміщуємо лише авто-сформовані, ручні лишаємо
    await supabase.from('supplier_orders').delete().eq('order_id', o.id).eq('source', 'auto')
    for (const key of Object.keys(groups)) {
      const list = groups[key]
      const total = list.reduce((s, it) => s + (Number(it.cost_price) || 0) * (Number(it.qty) || 0), 0)
      const { data: so } = await supabase.from('supplier_orders').insert({
        order_id: o.id, supplier_id: key === '__none__' ? null : key, total, status: 'new', source: 'auto',
      }).select('id').single()
      if (so?.id) await supabase.from('supplier_order_items').insert(list.map(it => ({
        supplier_order_id: so.id, product_id: it.product_id || null, name: it.name, unit: it.unit, qty: Number(it.qty) || 0, cost_price: Number(it.cost_price) || 0,
      })))
    }
    setBusy(false); load()
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Субзамовлення дистрибюторам</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={generate} disabled={busy}><i className="ti ti-wand" /> {busy ? '…' : 'Сформувати з товарів'}</button>
          {!add && <button className="btn" onClick={() => setAdd({ supplier_id: '', total: '', delay: '' })}><i className="ti ti-plus" /> Вручну</button>}
        </div>
      </div>

      {msg && <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 10 }}>{msg}</div>}

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

      {rows.length === 0 && !add && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Субзамовлень немає. Натисніть «Сформувати з товарів», щоб згрупувати позиції за постачальником.</p>}

      {rows.map(s => (
        <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <b>{s.contractors?.name || 'Без постачальника'}</b> · {fmt(s.total)} грн
              {s.source === 'auto' && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--blue)' }}>авто</span>}
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{s.payment_due_date ? `оплата до ${s.payment_due_date}` : 'без відстрочки'}</div>
            </div>
            <select className="form-input" value={s.status} onChange={e => setStatus(s, e.target.value)} style={{ width: 150, padding: '4px 8px', fontSize: 12 }}>
              {['new', 'ordered', 'in_transit', 'received', 'paid'].map(st => <option key={st} value={st}>{st}</option>)}
            </select>
            <button className="btn" onClick={() => del(s)} title="Видалити" style={{ color: 'var(--red)' }}><i className="ti ti-x" /></button>
          </div>
          {(items[s.id] || []).length > 0 && (
            <div style={{ marginTop: 8, marginLeft: 8, borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
              {items[s.id].map(it => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', padding: '2px 0', gap: 8 }}>
                  <span className="trunc" title={it.name}>{it.name}</span>
                  <span style={{ whiteSpace: 'nowrap' }}>{it.qty} {it.unit || 'шт'} × {fmt(it.cost_price)} = {fmt((Number(it.qty) || 0) * (Number(it.cost_price) || 0))}</span>
                </div>
              ))}
            </div>
          )}
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

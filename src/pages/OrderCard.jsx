import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import { getDocType, previewPdf, generatePdf, supplierOrderPdf, investorReportPdf } from '../lib/docgen'
import { resolveProduct } from '../lib/stockService'
import DocModal from '../components/DocModal'
import DocGenModal from '../components/DocGenModal'
import ProductSelect from '../components/ui/ProductSelect'
import PricePickerModal from '../components/ui/PricePickerModal'
import ContractorSelect from '../components/ui/ContractorSelect'
import {
  ORDER_TYPES, TYPE_COLORS, OUTCOME, flowFor, stepFor, statusLabel, nextActionLabel,
  nextStatus, isOpen, needsAction, proposalOverdue,
} from '../lib/orders'

const VAT_RATES = [0, 20]

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
  const { user } = useUser()
  const navigate = useNavigate()
  const [o, setO] = useState(null)
  const [lastSent, setLastSent] = useState(null)
  const [tab, setTab] = useState('details')
  const [busy, setBusy] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [archiveMenu, setArchiveMenu] = useState(false)
  const [msg, setMsg] = useState(null)
  const [itemsDirty, setItemsDirty] = useState(false)

  const UNSAVED_MSG = 'У вкладці «Товари» є незбережені зміни. Якщо піти — вони втратяться. Продовжити?'
  const guardLeave = () => !itemsDirty || window.confirm(UNSAVED_MSG)
  const switchTab = (id) => { if (id !== 'items' && tab === 'items' && !guardLeave()) return; if (id !== 'items') setItemsDirty(false); setTab(id) }
  const goBack = () => { if (!guardLeave()) return; setItemsDirty(false); navigate('/orders') }

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

  // Архівувати з результатом (won/lost/null). Відновлення — archive(false).
  const archive = async (outcome) => {
    setBusy('archive'); setMsg(null); setArchiveMenu(false)
    const upd = { archived_at: new Date().toISOString(), outcome: outcome || null }
    let { error } = await supabase.from('orders').update(upd).eq('id', id)
    // Колонка outcome може ще не існувати (міграція 028) — тоді архівуємо без неї
    if (error && /outcome/.test(error.message || '')) {
      ;({ error } = await supabase.from('orders').update({ archived_at: upd.archived_at }).eq('id', id))
    }
    setBusy('')
    if (error) { setMsg('Помилка архівування: ' + error.message); return }
    load()
  }

  const unarchive = async () => {
    setBusy('archive'); setMsg(null)
    await supabase.from('orders').update({ archived_at: null }).eq('id', id)
    setBusy(''); load()
  }

  // Змінити/проставити результат без зміни статусу архіву
  const setOutcome = async (outcome) => {
    setMsg(null)
    const { error } = await supabase.from('orders').update({ outcome: outcome || null }).eq('id', id)
    if (error) { setMsg('Помилка: ' + error.message); return }
    load()
  }

  // Копіювати замовлення разом з товарами
  const copyOrder = async () => {
    setBusy('copy'); setMsg(null)
    try {
      const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true })
      const order_number = String((count || 0) + 1).padStart(4, '0')
      const { data: no, error } = await supabase.from('orders').insert({
        order_number, type: o.type, status: 'new', client_id: o.client_id,
        description: o.description || null, procurement_type: o.procurement_type || null,
        total: o.total || 0, created_by: user?.id || null,
      }).select('id').single()
      if (error) throw error
      const { data: items } = await supabase.from('order_items').select('*').eq('order_id', id)
      if (items?.length) {
        const copies = items.map(({ id: _i, order_id: _o, created_at: _c, ...rest }) => ({ ...rest, order_id: no.id }))
        const { error: iErr } = await supabase.from('order_items').insert(copies)
        if (iErr) throw iErr
      }
      navigate(`/orders/${no.id}`)
    } catch (e) { setMsg('Помилка копіювання: ' + e.message) }
    setBusy('')
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
        <button className="btn" onClick={goBack} style={{ marginBottom: 10 }}><i className="ti ti-arrow-left" /> До реєстру</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 6 }}>Замовлення {o.order_number || o.id.slice(0, 6)}</h1>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: TYPE_COLORS[o.type], fontWeight: 600, fontSize: 13 }}>{ORDER_TYPES[o.type]}</span>
              <span style={{ color: 'var(--text2)', fontSize: 13 }}>{o.contractors?.name}</span>
              <span style={{ background: 'var(--surface2)', borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{statusLabel(o)}</span>
              <span style={{ color: 'var(--text2)', fontSize: 13 }}>{fmt(o.total)} грн</span>
              {OUTCOME[o.outcome] && (
                <span style={{ background: OUTCOME[o.outcome].bg, color: OUTCOME[o.outcome].color, borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <i className={`ti ${OUTCOME[o.outcome].icon}`} /> {OUTCOME[o.outcome].label}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={copyOrder} disabled={!!busy} title="Створити копію замовлення з тими самими товарами">
              <i className="ti ti-copy" /> {busy === 'copy' ? '…' : 'Копіювати'}
            </button>
            {o.archived_at ? (
              <button className="btn" onClick={unarchive} disabled={!!busy}>
                <i className="ti ti-archive-off" /> {busy === 'archive' ? '…' : 'Відновити'}
              </button>
            ) : !archiveMenu ? (
              <button className="btn" onClick={() => { setMsg(null); setArchiveMenu(true) }} disabled={!!busy}>
                <i className="ti ti-archive" /> Архівувати
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => archive('won')} disabled={busy === 'archive'} style={{ color: 'var(--green)' }} title="Замовлення виграно (тендер/конкурс)">
                  <i className="ti ti-trophy" /> Виграно
                </button>
                <button className="btn" onClick={() => archive('lost')} disabled={busy === 'archive'} style={{ color: 'var(--red)' }} title="Замовлення програно">
                  <i className="ti ti-mood-sad" /> Програно
                </button>
                <button className="btn" onClick={() => archive(null)} disabled={busy === 'archive'} title="Заархівувати без результату">
                  <i className="ti ti-archive" /> Без результату
                </button>
                <button className="btn" onClick={() => setArchiveMenu(false)} disabled={busy === 'archive'}>Скасувати</button>
              </>
            )}
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
        <div style={{ background: 'var(--surface2)', color: 'var(--text2)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span><i className="ti ti-archive" /> Замовлення в архіві (з {o.archived_at.slice(0, 10)}) — приховане з реєстру.</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            Результат:
            {['won', 'lost', null].map((v, i) => (
              <button key={i} className="btn" onClick={() => setOutcome(v)} disabled={(o.outcome || null) === v}
                style={{ fontSize: 12, padding: '3px 10px', color: v ? OUTCOME[v].color : 'var(--text2)', fontWeight: (o.outcome || null) === v ? 700 : 400, opacity: (o.outcome || null) === v ? 1 : 0.75 }}>
                {v ? <><i className={`ti ${OUTCOME[v].icon}`} /> {OUTCOME[v].label}</> : 'Без результату'}
              </button>
            ))}
          </span>
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
          <button key={t.id} onClick={() => switchTab(t.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
          }}><i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />{t.label}</button>
        ))}
      </div>

      {tab === 'details' && <DetailsTab o={o} onSaved={load} />}
      {tab === 'items' && <ItemsTab o={o} onChange={load} onDirty={setItemsDirty} />}
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
  const [form, setForm] = useState({ total: o.total, description: o.description || '', status: o.status, procurement_type: o.procurement_type || 'direct', client_id: o.client_id || null, clientName: o.contractors?.name || '' })
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
    const upd = { total: effectiveTotal, description: form.description || null, status: form.status, procurement_type: form.procurement_type, client_id: form.client_id || null }
    if (form.status === 'closed' && !o.closed_at) upd.closed_at = new Date().toISOString()
    await supabase.from('orders').update(upd).eq('id', o.id)
    setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved()
  }
  return (
    <div className="card">
      <div className="form-grid">
        <div className="form-group full"><label>Клієнт{!form.client_id && <span style={{ color: 'var(--red)', marginLeft: 6, fontSize: 12 }}>не призначений</span>}</label>
          <ContractorSelect value={form.clientName} placeholder="Оберіть клієнта або введіть назву"
            onChange={(name) => setForm(f => ({ ...f, clientName: name }))}
            onContractorSelect={async (c) => {
              if (c._new) {
                const { data } = await supabase.from('contractors').insert({ name: c.name, is_client: true }).select('id').single()
                setForm(f => ({ ...f, client_id: data?.id || null, clientName: c.name }))
              } else {
                setForm(f => ({ ...f, client_id: c.id, clientName: c.name }))
              }
            }} />
        </div>
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
        <div className="form-group"><label>Тип закупівлі</label>
          <select className="form-input" value={form.procurement_type} onChange={e => setForm(f => ({ ...f, procurement_type: e.target.value }))}>
            <option value="direct">Пряма закупівля</option>
            <option value="tender">Тендер</option>
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
function ItemsTab({ o, onChange, onDirty }) {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [dirty, setDirty] = useState(false)
  const markDirty = () => { setDirty(true); onDirty?.(true) }

  const load = () => supabase.from('order_items').select('*, contractors(name)').eq('order_id', o.id).order('created_at')
    .then(({ data }) => { setRows((data || []).map(r => ({ ...r, supplier_name: r.contractors?.name || null }))); setDirty(false); onDirty?.(false) })
  useEffect(() => { load() }, [o.id])

  // Попередження про незбережені зміни при оновленні/закритті сторінки
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const setRow = (i, patch) => { markDirty(); setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r)) }
  const addRow = () => { markDirty(); setRows(rs => [...rs, { product_id: null, name: '', sku: '', unit: 'шт', qty: 1, cost_price: 0, unit_price: 0, vat_rate: 20, price_includes_vat: false, supplier_id: null, supplier_name: null }]) }
  // Підстановка позиції з прайсу: закупівля = ціна прайсу, продаж = роздріб (редагована),
  // запам'ятовуємо постачальника (для авто-формування субзамовлень)
  const addFromPrice = (p) => {
    setShowPicker(false)
    markDirty()
    setRows(rs => [...rs, {
      product_id: null, name: p.name, sku: p.sku || '', unit: p.unit || 'шт', qty: 1,
      cost_price: p.price || 0,
      unit_price: (p.retail_price > 0 ? p.retail_price : p.price) || 0,
      vat_rate: p.vat_rate != null ? Number(p.vat_rate) : 20,
      price_includes_vat: true, // ціна з прайсу вже містить ПДВ
      supplier_id: p.supplier_id || null, supplier_name: p.contractors?.name || null,
    }])
  }
  const removeRow = (i) => { markDirty(); setRows(rs => rs.filter((_, j) => j !== i)) }
  // unit_price трактується залежно від price_includes_vat:
  //   true  → ціна вже з ПДВ (прайс); false → ціна без ПДВ, ПДВ зверху (склад)
  const rate = (r) => Number(r.vat_rate) || 0
  const grossUnit = (r) => { const p = Number(r.unit_price) || 0; const v = rate(r); return r.price_includes_vat ? p : p * (1 + v / 100) }
  const netUnit = (r) => { const p = Number(r.unit_price) || 0; const v = rate(r); return r.price_includes_vat ? (v > 0 ? p / (1 + v / 100) : p) : p }
  const rowTotal = (r) => grossUnit(r) * (Number(r.qty) || 0)            // з ПДВ
  const rowNet = (r) => netUnit(r) * (Number(r.qty) || 0)               // без ПДВ
  const rowMargin = (r) => ((Number(r.unit_price) || 0) - (Number(r.cost_price) || 0)) * (Number(r.qty) || 0)
  const marginPct = (r) => { const p = Number(r.unit_price) || 0; return p > 0 ? ((p - (Number(r.cost_price) || 0)) / p) * 100 : 0 }
  const sum = (rows || []).reduce((s, r) => s + rowTotal(r), 0)         // всього з ПДВ
  const netSum = (rows || []).reduce((s, r) => s + rowNet(r), 0)         // без ПДВ
  const vatSum = sum - netSum                                            // ПДВ
  const marginSum = (rows || []).reduce((s, r) => s + rowMargin(r), 0)

  const save = async () => {
    setSaving(true)
    // Створити/знайти товари для рядків з вільною назвою без прив'язки
    const resolved = []
    for (const r of rows) {
      if (!r.name?.trim()) continue
      let product_id = r.product_id
      if (!product_id) {
        const res = await resolveProduct(r.name, r.unit, Number(r.unit_price) || null, user?.id, r.sku || null)
        product_id = res?.productId || null
      }
      resolved.push({
        order_id: o.id, product_id, name: r.name.trim(), sku: r.sku || null, unit: r.unit || 'шт',
        qty: Number(r.qty) || 0, cost_price: Number(r.cost_price) || 0,
        unit_price: Number(r.unit_price) || 0, vat_rate: Number(r.vat_rate) || 0, price_includes_vat: !!r.price_includes_vat, total: rowTotal(r), supplier_id: r.supplier_id || null,
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
          <div style={{ width: 100 }}>Код</div>
          <div style={{ width: 80 }}>К-сть</div>
          <div style={{ width: 70 }}>Од.</div>
          <div style={{ width: 110 }}>Закупівля</div>
          <div style={{ width: 110 }}>Ціна продажу</div>
          <div style={{ width: 72 }}>ПДВ %</div>
          <div style={{ width: 110 }}>Тип ціни</div>
          <div style={{ width: 120, textAlign: 'right' }}>Маржа</div>
          <div style={{ width: 110, textAlign: 'right' }}>Сума з ПДВ</div>
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
                : setRow(i, { name: p.name, product_id: p.id, sku: p.sku || r.sku || '', unit: p.unit || 'шт', cost_price: r.cost_price || p.buy_price || 0, unit_price: r.unit_price || p.sell_price || 0, price_includes_vat: false, supplier_id: null, supplier_name: null })}
            />
            {r.supplier_name
              ? <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 2 }}><i className="ti ti-tag" /> {r.supplier_name}</div>
              : r.product_id && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}><i className="ti ti-link" /> з довідника</div>}
          </div>
          <input className="form-input" placeholder="Код" value={r.sku || ''} onChange={e => setRow(i, { sku: e.target.value })} style={{ width: 100 }} />
          <input className="form-input" type="number" placeholder="К-сть" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} style={{ width: 80 }} />
          <input className="form-input" placeholder="од." value={r.unit || ''} onChange={e => setRow(i, { unit: e.target.value })} style={{ width: 70 }} />
          <input className="form-input" type="number" placeholder="Закупівля" value={r.cost_price ?? ''} onChange={e => setRow(i, { cost_price: e.target.value })} style={{ width: 110 }} />
          <input className="form-input" type="number" placeholder="Ціна" value={r.unit_price} onChange={e => setRow(i, { unit_price: e.target.value })} style={{ width: 110 }} />
          <select className="form-input" value={Number(r.vat_rate) || 0} onChange={e => setRow(i, { vat_rate: Number(e.target.value) })} style={{ width: 72, padding: '8px 6px' }}>
            {VAT_RATES.map(v => <option key={v} value={v}>{v}%</option>)}
          </select>
          <select className="form-input" value={r.price_includes_vat ? '1' : '0'} onChange={e => setRow(i, { price_includes_vat: e.target.value === '1' })} style={{ width: 110, padding: '8px 6px' }} title="Чи ціна вже містить ПДВ">
            <option value="0">+ПДВ зверху</option>
            <option value="1">ціна з ПДВ</option>
          </select>
          <div style={{ width: 120, textAlign: 'right', padding: '8px 0', fontSize: 13, color: mColor }}>{fmt(m)}<div style={{ fontSize: 11 }}>{mp.toFixed(0)}%</div></div>
          <div style={{ width: 110, textAlign: 'right', padding: '8px 0', fontSize: 13, fontWeight: 500 }}>{fmt(rowTotal(r))}</div>
          <button className="btn" onClick={() => removeRow(i)} title="Прибрати"><i className="ti ti-x" /></button>
        </div>
        )
      })}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>
          <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--text2)' }}>Без ПДВ: {fmt(netSum)} грн · ПДВ: {fmt(vatSum)} грн</div>
          Всього з ПДВ: {fmt(sum)} грн
          {marginSum !== 0 && <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 500, color: marginSum > 0 ? 'var(--green)' : 'var(--red)' }}>Маржа: {fmt(marginSum)} грн{sum > 0 ? ` (${((marginSum / sum) * 100).toFixed(0)}%)` : ''}</span>}
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginTop: 2 }}>Ціна продажу — з ПДВ. «Сума» замовлення = всього з ПДВ.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
          {rows.length > 0 && (
            <button className="btn" onClick={() => investorReportPdf(o, rows)} title="PDF-розрахунок рентабельності для інвестора">
              <i className="ti ti-chart-pie" /> Розрахунок для інвестора
            </button>
          )}
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
  const [stampCP, setStampCP] = useState(false) // печатка на КП
  const load = () => supabase.from('commercial_proposals').select('*').eq('order_id', o.id).order('version', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [o.id])

  // Нова версія КП префілиться позиціями товарів замовлення (якщо є)
  const startNew = async () => {
    const { data: items } = await supabase.from('order_items').select('name, qty, unit_price, vat_rate, price_includes_vat').eq('order_id', o.id).order('created_at')
    const seed = (items || []).length
      ? items.map(it => ({ name: it.name, qty: Number(it.qty) || 1, price: Number(it.unit_price) || 0, vat: Number(it.vat_rate) || 0, incl: !!it.price_includes_vat }))
      : [{ name: '', qty: 1, price: 0, vat: 20, incl: false }]
    setEditing({ version: (rows[0]?.version || 0) + 1, items: seed })
  }
  // price трактується за i.incl (з прайсу = з ПДВ; вручну/склад = без ПДВ, ПДВ зверху)
  const lineGross = (i) => { const p = (Number(i.qty) || 0) * (Number(i.price) || 0); const v = Number(i.vat) || 0; return i.incl ? p : p * (1 + v / 100) }
  const lineNet = (i) => { const p = (Number(i.qty) || 0) * (Number(i.price) || 0); const v = Number(i.vat) || 0; return i.incl ? (v > 0 ? p / (1 + v / 100) : p) : p }
  const itemsTotal = (items) => items.reduce((s, i) => s + lineGross(i), 0)
  const itemsNet = (items) => items.reduce((s, i) => s + lineNet(i), 0)

  const saveDraft = async () => {
    const total = itemsTotal(editing.items)
    await supabase.from('commercial_proposals')
      .insert({ order_id: o.id, version: editing.version, items: editing.items, total, status: 'draft' })
    setEditing(null); load()
  }
  const send = async (p) => {
    await supabase.from('commercial_proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', p.id)
    if (o.type === 'trade' && o.status === 'new') await supabase.from('orders').update({ status: 'proposal_sent' }).eq('id', o.id)
    load(); onChange()
  }
  const setStatus = async (p, status) => { await supabase.from('commercial_proposals').update({ status }).eq('id', p.id); load() }
  const delProposal = async (p) => { await supabase.from('commercial_proposals').delete().eq('id', p.id); load() }

  // Переглянути КП у новій вкладці (не зберігається в Документи).
  // price у позиції — з ПДВ; для документа рахуємо ціну без ПДВ за ставкою позиції.
  const [genId, setGenId] = useState(null)
  const previewProposal = async (p) => {
    setGenId(p.id)
    try {
      const { data: c } = await supabase.from('contractors').select('*').eq('id', o.client_id).single()
      const items = (p.items || []).map(it => {
        const price = Number(it.price) || 0, vr = Number(it.vat) || 0
        // КП-шаблон чекає ціну БЕЗ ПДВ: якщо ціна вже з ПДВ — ділимо, якщо ні — лишаємо
        const net = it.incl ? (vr > 0 ? price / (1 + vr / 100) : price) : price
        return { name: it.name, quantity: Number(it.qty) || 0, unit: 'шт', unitPrice: net, vatRate: vr }
      })
      const today = new Date().toISOString().slice(0, 10)
      const opts = { docNumber: `КП-${o.order_number || o.id.slice(0, 6)}-v${p.version}`, docDate: today, withStamp: stampCP }
      await previewPdf('commercialProposal', c || { name: o.contractors?.name }, items, opts)
    } catch (e) { alert('Помилка формування: ' + e.message) }
    setGenId(null)
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Комерційні пропозиції</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: stampCP ? 'var(--green)' : 'var(--text2)', userSelect: 'none' }} title="Накласти печатку при перегляді КП">
            <input type="checkbox" checked={stampCP} onChange={e => setStampCP(e.target.checked)} />
            <i className="ti ti-rubber-stamp" style={{ fontSize: 16 }} /> З печаткою
          </label>
          {!editing && <button className="btn btn-primary" onClick={startNew}><i className="ti ti-plus" /> Нова версія</button>}
        </div>
      </div>

      {editing && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Версія {editing.version}</div>
          {editing.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input className="form-input" placeholder="Найменування" value={it.name} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, name: e.target.value }; return { ...d, items } })} style={{ flex: 2 }} />
              <input className="form-input" type="number" placeholder="К-сть" value={it.qty} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, qty: e.target.value }; return { ...d, items } })} style={{ width: 80 }} />
              <input className="form-input" type="number" placeholder="Ціна з ПДВ" value={it.price} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, price: e.target.value }; return { ...d, items } })} style={{ width: 110 }} />
              <select className="form-input" value={Number(it.vat) || 0} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, vat: Number(e.target.value) }; return { ...d, items } })} style={{ width: 72, padding: '8px 6px' }}>
                {VAT_RATES.map(v => <option key={v} value={v}>{v}%</option>)}
              </select>
              <select className="form-input" value={it.incl ? '1' : '0'} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, incl: e.target.value === '1' }; return { ...d, items } })} style={{ width: 116, padding: '8px 6px' }}>
                <option value="0">+ПДВ зверху</option>
                <option value="1">ціна з ПДВ</option>
              </select>
              <button className="btn" onClick={() => setEditing(d => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}><i className="ti ti-x" /></button>
            </div>
          ))}
          <button className="btn" onClick={() => setEditing(d => ({ ...d, items: [...d.items, { name: '', qty: 1, price: 0, vat: 20, incl: false }] }))} style={{ marginBottom: 10 }}><i className="ti ti-plus" /> Позиція</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600 }}>Без ПДВ: {fmt(itemsNet(editing.items))} · ПДВ: {fmt(itemsTotal(editing.items) - itemsNet(editing.items))} · Всього з ПДВ: {fmt(itemsTotal(editing.items))} грн</div>
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
          <button className="btn" onClick={() => previewProposal(p)} disabled={genId === p.id} title="Переглянути КП у новій вкладці"><i className="ti ti-eye" /> {genId === p.id ? '…' : 'Переглянути'}</button>
          {p.status === 'draft' && <button className="btn btn-primary" onClick={() => send(p)}>Надіслати</button>}
          {p.status === 'sent' && <>
            <button className="btn" onClick={() => setStatus(p, 'accepted')}>Прийнято</button>
            <button className="btn" onClick={() => setStatus(p, 'rejected')}>Відхилено</button>
          </>}
          <button className="btn" onClick={() => delProposal(p)} title="Видалити КП" style={{ color: 'var(--red)' }}><i className="ti ti-trash" /></button>
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
  const [genDocs, setGenDocs] = useState([])
  const [openDoc, setOpenDoc] = useState(null)
  const [showAttach, setShowAttach] = useState(false)
  const [gen, setGen] = useState(null) // { contractor, editDoc }
  const load = () => supabase.from('documents')
    .select('id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, source, contractors(name)')
    .eq('order_id', o.id).order('created_at', { ascending: false })
    .then(({ data }) => setRows((data || []).filter(d => d.source !== 'generated'))) // згенеровані показані окремою секцією
  const loadGen = () => supabase.from('generated_docs').select('*').eq('order_id', o.id).order('created_at', { ascending: false }).then(({ data }) => setGenDocs(data || []))
  useEffect(() => { load(); loadGen() }, [o.id])
  const unlink = async (d) => { await supabase.from('documents').update({ order_id: null }).eq('id', d.id); load() }
  const delGen = async (d) => { await supabase.from('generated_docs').delete().eq('id', d.id); loadGen() }

  // Перегляд / завантаження вже згенерованого документа (регенерація з даних generated_docs)
  const genItems = (d) => (typeof d.items === 'string' ? JSON.parse(d.items || '[]') : (d.items || []))
  const genOptions = (d) => ({ docNumber: d.doc_number, docDate: d.doc_date, notes: d.notes, contractNum: d.contract_num, contractDate: d.contract_date, paymentDue: d.payment_due, city: d.city, invoiceRef: d.invoice_ref, invoiceRefDate: d.invoice_ref_date, deliveryBasis: d.delivery_basis, deliveryAddress: d.delivery_address })
  const withContractor = async (d, fn) => {
    const { data: c } = await supabase.from('contractors').select('*').eq('id', d.contractor_id).single()
    try { await fn(d.doc_type, c || { name: d.contractor_name }, genItems(d), genOptions(d)) } catch (e) { alert('Помилка: ' + e.message) }
  }
  const viewGen = (d) => withContractor(d, previewPdf)
  const downloadGen = (d) => withContractor(d, generatePdf)

  // Згенерувати документ із товарів замовлення (той самий DocGenModal)
  const openGen = async (docType) => {
    const [{ data: c }, { data: oi }] = await Promise.all([
      supabase.from('contractors').select('*').eq('id', o.client_id).single(),
      supabase.from('order_items').select('*').eq('order_id', o.id).order('created_at'),
    ])
    const items = (oi || []).map(it => {
      const v = Number(it.vat_rate) || 0
      const net = it.price_includes_vat ? (v > 0 ? Number(it.unit_price) / (1 + v / 100) : Number(it.unit_price)) : Number(it.unit_price)
      return { name: it.name, quantity: Number(it.qty) || 0, unit: it.unit || 'шт', unitPrice: Math.round((net || 0) * 100) / 100, vatRate: v, amount: '', productId: it.product_id || null }
    })
    setGen({ contractor: c || { id: o.client_id, name: o.contractors?.name }, editDoc: { doc_type: docType, items } })
  }

  if (rows == null) return <Loading />
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Документи замовлення</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => openGen('invoice')}><i className="ti ti-file-invoice" /> Рахунок</button>
          <button className="btn" onClick={() => openGen('waybill')}><i className="ti ti-truck-delivery" /> Видаткова</button>
          <button className="btn" onClick={() => setShowAttach(true)}><i className="ti ti-link" /> Прив'язати</button>
        </div>
      </div>

      {genDocs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>ЗГЕНЕРОВАНІ</div>
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>Тип</th><th>№</th><th style={{ textAlign: 'right' }}>Сума</th><th>Дата</th><th /></tr></thead>
              <tbody>
                {genDocs.map(d => (
                  <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => viewGen(d)}>
                    <td>{getDocType(d.doc_type)?.label || d.doc_type}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{d.doc_number}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(d.total)}</td>
                    <td style={{ fontSize: 12 }}>{(d.doc_date || d.created_at || '').slice(0, 10)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn" title="Переглянути" onClick={e => { e.stopPropagation(); viewGen(d) }}><i className="ti ti-eye" /></button>
                      <button className="btn" title="Завантажити PDF" onClick={e => { e.stopPropagation(); downloadGen(d) }} style={{ marginLeft: 4 }}><i className="ti ti-file-download" /></button>
                      <button className="btn" title="Редагувати" onClick={e => { e.stopPropagation(); setGen({ contractor: { id: d.contractor_id, name: d.contractor_name }, editDoc: d }) }} style={{ marginLeft: 4 }}><i className="ti ti-pencil" /></button>
                      <button className="btn" title="Видалити" onClick={e => { e.stopPropagation(); delGen(d) }} style={{ marginLeft: 4, color: 'var(--red)' }}><i className="ti ti-trash" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {genDocs.length > 0 && rows.length > 0 && <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>ПРИВ'ЯЗАНІ</div>}

      {rows.length === 0 ? (
        genDocs.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Документів немає. Згенеруйте «Рахунок»/«Видаткова» з товарів замовлення або «Прив'яжіть» наявний.</p>
      ) : (
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead><tr><th>Тип</th><th>№</th><th>Файл</th><th style={{ textAlign: 'right' }}>Сума</th><th>Підписано</th><th>Дата</th><th /></tr></thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setOpenDoc(d)}>
                  <td>{getDocType(d.type)?.label || d.type || '—'}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{d.doc_number || '—'}</td>
                  <td><div className="trunc">{d.file_name}</div></td>
                  <td style={{ textAlign: 'right' }}>{d.amount ? fmt(d.amount) : '—'}</td>
                  <td>{d.is_signed ? '✓' : '—'}</td><td>{(d.doc_date || d.created_at || '').slice(0, 10)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn" title="Відв'язати" onClick={e => { e.stopPropagation(); unlink(d) }}><i className="ti ti-unlink" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => { setOpenDoc(null); load() }} />}
      {showAttach && <AttachDocsModal o={o} onClose={() => setShowAttach(false)} onAttached={() => { setShowAttach(false); load() }} />}
      {gen && <DocGenModal contractor={gen.contractor} userId={user?.id} orderId={o.id} editDoc={gen.editDoc} onClose={() => setGen(null)} onSaved={() => { setGen(null); loadGen() }} />}
    </div>
  )
}

// Прив'язка наявного документа до замовлення (виставляє documents.order_id)
function AttachDocsModal({ o, onClose, onAttached }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const timerRef = useRef(null)

  const search = async (term) => {
    let query = supabase.from('documents')
      .select('id, type, doc_number, file_name, amount, doc_date, created_at, order_id, contractor_id, contractors(name)')
      .order('created_at', { ascending: false }).limit(40)
    const t = term.trim()
    if (t) query = query.or(`doc_number.ilike.%${t}%,file_name.ilike.%${t}%`)
    else if (o.client_id) query = query.eq('contractor_id', o.client_id) // за замовч. — документи клієнта
    const { data } = await query
    setRows((data || []).filter(d => d.order_id !== o.id))
  }
  useEffect(() => { search('') }, []) // eslint-disable-line
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(q), 300)
    return () => clearTimeout(timerRef.current)
  }, [q]) // eslint-disable-line

  const attach = async (d) => { await supabase.from('documents').update({ order_id: o.id }).eq('id', d.id); onAttached() }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Прив'язати документ</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <input className="form-input" autoFocus placeholder="Пошук за № або назвою файлу… (порожньо — документи клієнта)" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 12 }} />
        <div className="tbl-wrap" style={{ border: 'none', maxHeight: 420, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Тип</th><th>№</th><th>Контрагент</th><th style={{ textAlign: 'right' }}>Сума</th><th>Дата</th><th /></tr></thead>
            <tbody>
              {rows == null && <tr><td colSpan={6} style={{ color: 'var(--text3)', padding: 14 }}>Завантаження…</td></tr>}
              {rows && rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text3)', textAlign: 'center', padding: 14 }}>Нічого не знайдено.</td></tr>}
              {rows && rows.map(d => (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => attach(d)}>
                  <td>{getDocType(d.type)?.label || d.type || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{d.doc_number || '—'}</td>
                  <td style={{ fontSize: 12 }}><div className="trunc">{d.contractors?.name || '—'}</div></td>
                  <td style={{ textAlign: 'right' }}>{d.amount ? fmt(d.amount) : '—'}</td>
                  <td style={{ fontSize: 12 }}>{(d.doc_date || d.created_at || '').slice(0, 10)}</td>
                  <td style={{ textAlign: 'right' }}>{d.order_id ? <span style={{ fontSize: 11, color: 'var(--amber)' }}>в ін. замов.</span> : <i className="ti ti-plus" style={{ color: 'var(--blue)' }} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Клік по документу прив'язує його до цього замовлення. Документ «в ін. замов.» буде перепризначено.</p>
      </div>
    </div>
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
  const setSupplier = async (s, supplier_id) => { await supabase.from('supplier_orders').update({ supplier_id: supplier_id || null }).eq('id', s.id); load() }
  const del = async (s) => { await supabase.from('supplier_orders').delete().eq('id', s.id); load() }

  // Помітка «замовлено» на позиції субзамовлення
  const toggleOrdered = async (soId, it, val) => {
    await supabase.from('supplier_order_items').update({ ordered: val }).eq('id', it.id)
    setItems(prev => ({ ...prev, [soId]: (prev[soId] || []).map(x => x.id === it.id ? { ...x, ordered: val } : x) }))
  }
  const toggleAllOrdered = async (s, val) => {
    const list = items[s.id] || []
    const ids = list.map(x => x.id)
    if (ids.length) await supabase.from('supplier_order_items').update({ ordered: val }).in('id', ids)
    setItems(prev => ({ ...prev, [s.id]: (prev[s.id] || []).map(x => ({ ...x, ordered: val })) }))
    if (val && s.status === 'new') await setStatus(s, 'ordered')
  }

  // PDF «Замовлення постачальнику» для конкретного субзамовлення
  const genPdf = async (s, download) => {
    const list = (items[s.id] || []).map(it => ({ name: it.name, sku: it.sku, quantity: Number(it.qty) || 0, unit: it.unit || 'шт', price: Number(it.cost_price) || 0 }))
    if (!list.length) { setMsg('У субзамовленні немає позицій.'); return }
    let supplier = { name: s.contractors?.name || 'Постачальник' }
    if (s.supplier_id) { const { data } = await supabase.from('contractors').select('*').eq('id', s.supplier_id).single(); if (data) supplier = data }
    let client = { name: o.contractors?.name }
    if (o.client_id) { const { data } = await supabase.from('contractors').select('name, short_name, edrpou, legal_address, address').eq('id', o.client_id).single(); if (data) client = data }
    const today = new Date().toISOString().slice(0, 10)
    try {
      await supplierOrderPdf(supplier, list, {
        docNumber: `ЗП-${o.order_number || o.id.slice(0, 6)}-${s.id.slice(0, 4)}`,
        docDate: today, client, procurementType: o.procurement_type,
      }, { download })
    } catch (e) { setMsg('Помилка формування: ' + e.message) }
  }

  // Сформувати субзамовлення з товарів замовлення: групуємо за постачальником
  const generate = async () => {
    setBusy(true); setMsg(null)
    const { data: oi } = await supabase.from('order_items').select('supplier_id, product_id, name, sku, unit, qty, cost_price').eq('order_id', o.id)
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
        supplier_order_id: so.id, product_id: it.product_id || null, name: it.name, sku: it.sku || null, unit: it.unit, qty: Number(it.qty) || 0, cost_price: Number(it.cost_price) || 0,
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map(s => {
          const noSupplier = !s.supplier_id
          return (
          <div key={s.id} style={{ border: '1px solid var(--border)', borderLeft: `3px solid ${noSupplier ? 'var(--text3)' : 'var(--blue)'}`, borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <select className="form-input" value={s.supplier_id || ''} onChange={e => setSupplier(s, e.target.value)} style={{ flex: '1 1 200px', fontWeight: 600 }}>
                <option value="">Без постачальника — оберіть…</option>
                {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
              </select>
              {s.source === 'auto' && <span style={{ fontSize: 11, color: 'var(--blue)', background: 'var(--surface2)', borderRadius: 6, padding: '2px 8px' }}>авто</span>}
              <select className="form-input" value={s.status} onChange={e => setStatus(s, e.target.value)} style={{ width: 150, padding: '4px 8px', fontSize: 12 }}>
                {Object.entries(SUB_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button className="btn" onClick={() => genPdf(s, false)} title="Переглянути замовлення постачальнику (PDF)"><i className="ti ti-eye" /></button>
              <button className="btn" onClick={() => genPdf(s, true)} title="Завантажити PDF"><i className="ti ti-file-download" /></button>
              <button className="btn" onClick={() => del(s)} title="Видалити" style={{ color: 'var(--red)' }}><i className="ti ti-trash" /></button>
            </div>

            {(items[s.id] || []).length > 0 && (() => {
              const list = items[s.id]
              const allOrdered = list.length > 0 && list.every(x => x.ordered)
              const orderedCnt = list.filter(x => x.ordered).length
              return (
              <div className="tbl-wrap" style={{ border: 'none', marginTop: 10 }}>
                <table>
                  <thead><tr>
                    <th style={{ width: 32, textAlign: 'center' }} title="Замовлено">
                      <input type="checkbox" checked={allOrdered} onChange={e => toggleAllOrdered(s, e.target.checked)} />
                    </th>
                    <th style={{ width: 110 }}>Код</th>
                    <th>Найменування</th>
                    <th style={{ textAlign: 'right' }}>К-сть</th>
                    <th style={{ textAlign: 'right' }}>Закупівля</th>
                    <th style={{ textAlign: 'right' }}>Сума</th>
                  </tr></thead>
                  <tbody>
                    {list.map(it => (
                      <tr key={it.id} style={it.ordered ? { background: 'var(--surface2)' } : undefined}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!it.ordered} onChange={e => toggleOrdered(s.id, it, e.target.checked)} title="Замовлено" />
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{it.sku || '—'}</td>
                        <td style={{ textDecoration: it.ordered ? 'line-through' : 'none', color: it.ordered ? 'var(--text3)' : undefined }}><div className="trunc" title={it.name}>{it.name}</div></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{it.qty} {it.unit || 'шт'}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(it.cost_price)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt((Number(it.qty) || 0) * (Number(it.cost_price) || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>Замовлено {orderedCnt} з {list.length}</div>
              </div>
              )
            })()}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--text3)' }}>{s.payment_due_date ? `оплата до ${s.payment_due_date}` : 'без відстрочки'}</span>
              <span style={{ fontWeight: 600 }}>Разом закупівля: {fmt(s.total)} грн</span>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
const SUB_STATUS = { new: 'Новий', ordered: 'Замовлено', in_transit: 'В дорозі', received: 'Отримано', paid: 'Оплачено' }

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

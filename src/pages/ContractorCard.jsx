import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { getContractorBalance } from '../lib/debts'
import { fetchByEdrpou, isVkursiConfigured } from '../lib/vkursi'
import { extractCompanyExtract } from '../lib/ai'
import { getDocType } from '../lib/docgen'
import { ORDER_TYPES, TYPE_COLORS, statusLabel } from '../lib/orders'
import DocModal from '../components/DocModal'
import GeneratedDocModal from '../components/GeneratedDocModal'

const TABS = [
  { id: 'details', label: 'Реквізити', icon: 'ti-id-badge-2' },
  { id: 'orders', label: 'Замовлення', icon: 'ti-shopping-cart' },
  { id: 'documents', label: 'Документи', icon: 'ti-files' },
  { id: 'transactions', label: 'Транзакції', icon: 'ti-building-bank' },
  { id: 'products', label: 'Товари', icon: 'ti-package' },
  { id: 'notes', label: 'Комунікація', icon: 'ti-message' },
]

export default function ContractorCard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [c, setC] = useState(null)
  const [bal, setBal] = useState(null)
  const [tab, setTab] = useState('details')

  useEffect(() => {
    supabase.from('contractors').select('*').eq('id', id).single().then(({ data }) => setC(data))
    getContractorBalance(id).then(setBal)
  }, [id])

  if (!c) return <div className="page-header"><h1>Завантаження…</h1></div>

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => navigate('/contractors')} style={{ marginBottom: 10 }}>
          <i className="ti ti-arrow-left" /> До списку
        </button>
        <h1 style={{ marginBottom: 6 }}>{c.name}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {c.edrpou && <span style={{ color: 'var(--text2)', fontSize: 13 }}>ЄДРПОУ {c.edrpou}</span>}
          {c.is_client && <span style={tag('var(--green-bg)', 'var(--green)')}>клієнт</span>}
          {c.is_supplier && <span style={tag('var(--red-bg)', 'var(--red)')}>постачальник</span>}
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Дебіторка (нам винні)" value={bal ? bal.receivable : null} positive />
        <Kpi label="Кредиторка (ми винні)" value={bal ? bal.payable : null} negative />
        <Kpi label="Оборот за рік" value={bal ? bal.turnoverYear : null} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && <DetailsTab c={c} onSaved={setC} />}
      {tab === 'orders' && <OrdersTab id={id} />}
      {tab === 'documents' && <DocumentsTab id={id} />}
      {tab === 'transactions' && <TransactionsTab id={id} />}
      {tab === 'products' && <ProductsTab id={id} />}
      {tab === 'notes' && <NotesTab id={id} />}
    </div>
  )
}

const tag = (bg, color) => ({ background: bg, color, borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 600 })

function Kpi({ label, value, positive, negative }) {
  const color = value == null ? 'var(--text3)' : positive && value > 0 ? 'var(--green)' : negative && value > 0 ? 'var(--red)' : 'var(--text)'
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>
        {value == null ? '…' : fmtInt(value)} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text3)' }}>грн</span>
      </div>
    </div>
  )
}

// ───────────────────────── Реквізити ─────────────────────────
const FIELD_GROUPS = [
  { title: 'Основне', fields: [
    ['name', 'Повна назва', 'full'], ['short_name', 'Коротка назва'], ['edrpou', 'ЄДРПОУ'], ['ipn', 'ІПН'],
    ['legal_form', 'Орг.-правова форма'], ['tax_system', 'Система оподаткування'],
  ]},
  { title: 'Банк', fields: [['iban', 'IBAN', 'full'], ['bank_name', 'Банк'], ['mfo', 'МФО']] },
  { title: 'Адреса і контакти', fields: [
    ['legal_address', 'Юридична адреса', 'full'], ['city', 'Місто'], ['region', 'Область'],
    ['postal_code', 'Індекс'], ['email', 'Email'], ['phone', 'Телефон'], ['website', 'Сайт'],
    ['director', 'Директор (ПІБ)'], ['director_position', 'Посада директора'],
  ]},
  { title: 'Умови роботи', fields: [
    ['payment_delay_days', 'Відстрочка (днів)', null, 'number'],
    ['price_type', 'Тип ціни (net/gross)'],
    ['contract_valid_until', 'Договір дійсний до', null, 'date'],
    ['default_article', 'Стаття за замовч.'],
  ]},
]

function DetailsTab({ c, onSaved }) {
  const [form, setForm] = useState(c)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [vk, setVk] = useState({ loading: false, msg: null, err: null })
  const [edr, setEdr] = useState({ loading: false, msg: null, err: null })
  const fileRef = useRef(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const onExtractFile = async (e) => {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setEdr({ loading: true, err: null, msg: null })
    try {
      const info = await extractCompanyExtract([file])
      // зберегти файл у Storage
      const path = `edr/${c.id}/${Date.now()}_${file.name}`.replace(/[^\w.\-/]/g, '_')
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: false })
      if (upErr && !upErr.message.includes('exists')) throw upErr
      // заповнити поля
      const merged = { ...form }
      for (const [k, v] of Object.entries(info)) {
        if (v == null || v === '') continue
        if (k === 'is_vat_payer') { merged.is_vat_payer = !!v; continue }
        const key = k === 'kved' ? 'primary_kved' : k // AI віддає kved, колонка — primary_kved
        if (key in form) merged[key] = v
      }
      merged.edr_extract_path = path
      merged.edr_extract_name = file.name
      setForm(merged)
      setEdr({ loading: false, err: null, msg: 'Витяг розпізнано і збережено. Перевірте поля і натисніть «Зберегти».' })
    } catch (err) { setEdr({ loading: false, err: err.message, msg: null }) }
  }

  const openExtract = async () => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(form.edr_extract_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // Перерозпізнати вже збережений витяг (без повторного завантаження файлу)
  const reRecognize = async () => {
    if (!form.edr_extract_path) return
    setEdr({ loading: true, err: null, msg: null })
    try {
      const { data: blob, error } = await supabase.storage.from('documents').download(form.edr_extract_path)
      if (error) throw error
      const file = new File([blob], form.edr_extract_name || 'edr.pdf', { type: blob.type || 'application/pdf' })
      const info = await extractCompanyExtract([file])
      const merged = { ...form }
      for (const [k, v] of Object.entries(info)) {
        if (v == null || v === '') continue
        if (k === 'is_vat_payer') { merged.is_vat_payer = !!v; continue }
        const key = k === 'kved' ? 'primary_kved' : k
        if (key in form) merged[key] = v
      }
      setForm(merged)
      setEdr({ loading: false, err: null, msg: 'Витяг перерозпізнано. Перевірте поля і натисніть «Зберегти».' })
    } catch (err) { setEdr({ loading: false, err: err.message, msg: null }) }
  }

  const save = async () => {
    setSaving(true); setSaved(false); setEdr(s => ({ ...s, err: null }))
    const upd = { ...form }
    delete upd.id; delete upd.created_at; delete upd.created_by
    if (form.payment_delay_days === '') upd.payment_delay_days = 0
    let { error } = await supabase.from('contractors').update(upd).eq('id', c.id)
    // Колонки витягу (edr_extract_*) можуть ще не існувати в БД (міграція 024) —
    // тоді зберігаємо реквізити без них, щоб розпізнані дані не губились.
    if (error && /edr_extract/.test(error.message || '')) {
      delete upd.edr_extract_path; delete upd.edr_extract_name
      ;({ error } = await supabase.from('contractors').update(upd).eq('id', c.id))
    }
    setSaving(false)
    if (error) { setEdr({ loading: false, msg: null, err: 'Помилка збереження: ' + error.message }); return }
    setSaved(true); onSaved({ ...c, ...form }); setTimeout(() => setSaved(false), 2500)
  }

  const pullVkursi = async () => {
    if (!form.edrpou?.trim()) { setVk({ loading: false, err: 'Вкажіть ЄДРПОУ', msg: null }); return }
    setVk({ loading: true, err: null, msg: null })
    try {
      const info = await fetchByEdrpou(form.edrpou)
      const merged = { ...form }
      for (const [k, v] of Object.entries(info)) {
        if (k.startsWith('_')) continue
        if (v != null && v !== '' && k in form) merged[k] = typeof v === 'object' ? form[k] : v
      }
      setForm(merged)
      setVk({ loading: false, err: null, msg: `Дані отримано (${info._source || 'vkursi'})` })
    } catch (e) {
      setVk({ loading: false, err: e.message, msg: null })
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 16, fontSize: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!form.is_client} onChange={e => set('is_client', e.target.checked)} /> Клієнт</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!form.is_supplier} onChange={e => set('is_supplier', e.target.checked)} /> Постачальник</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!form.is_vat_payer} onChange={e => set('is_vat_payer', e.target.checked)} /> Платник ПДВ</label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={pullVkursi} disabled={vk.loading} title={isVkursiConfigured() ? 'Vkursi' : 'Безкоштовний ЄДР (Vkursi не налаштовано)'}>
            <i className="ti ti-download" /> {vk.loading ? '…' : 'Заповнити за ЄДРПОУ'}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={edr.loading} title="Завантажити витяг з ЄДР — AI розпізнає й заповнить реквізити">
            <i className="ti ti-file-upload" /> {edr.loading ? 'Розпізнавання…' : 'Витяг з ЄДР (AI)'}
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf,.heic" style={{ display: 'none' }} onChange={onExtractFile} />
        </div>
      </div>
      {vk.err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{vk.err}</div>}
      {vk.msg && <div style={{ color: 'var(--green)', fontSize: 12, marginBottom: 10 }}>{vk.msg}</div>}
      {edr.err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{edr.err}</div>}
      {edr.msg && <div style={{ color: 'var(--green)', fontSize: 12, marginBottom: 10 }}>{edr.msg}</div>}
      {form.edr_extract_path && (
        <div style={{ fontSize: 12.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span><i className="ti ti-file-check" style={{ color: 'var(--green)' }} /> Витяг з ЄДР: <a onClick={openExtract} style={{ color: 'var(--blue)', cursor: 'pointer' }}>{form.edr_extract_name || 'переглянути'}</a></span>
          <button className="btn" onClick={reRecognize} disabled={edr.loading} style={{ fontSize: 12, padding: '3px 10px' }} title="Розпізнати реквізити зі збереженого витягу (без повторного завантаження)">
            <i className="ti ti-robot" /> {edr.loading ? 'Розпізнавання…' : 'Розпізнати ще раз'}
          </button>
        </div>
      )}

      {FIELD_GROUPS.map(g => (
        <div key={g.title} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>{g.title}</div>
          <div className="form-grid">
            {g.fields.map(([key, label, full, type]) => (
              <div className={`form-group ${full === 'full' ? 'full' : ''}`} key={key}>
                <label>{label}</label>
                <input className="form-input" type={type || 'text'}
                  value={form[key] ?? ''} onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      <Contacts contractorId={c.id} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '…' : 'Зберегти'}</button>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
      </div>
    </div>
  )
}

function Contacts({ contractorId }) {
  const [rows, setRows] = useState([])
  const [add, setAdd] = useState({ name: '', role: '', phone: '', email: '' })
  const load = () => supabase.from('contractor_contacts').select('*').eq('contractor_id', contractorId).order('created_at').then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [contractorId])

  const create = async () => {
    if (!add.name.trim()) return
    await supabase.from('contractor_contacts').insert({ ...add, contractor_id: contractorId })
    setAdd({ name: '', role: '', phone: '', email: '' }); load()
  }
  const remove = async (cid) => { await supabase.from('contractor_contacts').delete().eq('id', cid); load() }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Контактні особи</div>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
          <div style={{ flex: 1 }}><b>{r.name}</b>{r.role && <span style={{ color: 'var(--text2)' }}> · {r.role}</span>}</div>
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>{r.phone}</div>
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>{r.email}</div>
          <button className="btn" onClick={() => remove(r.id)} style={{ padding: '2px 8px' }}><i className="ti ti-trash" /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Ім'я" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} style={{ flex: '1 1 140px' }} />
        <input className="form-input" placeholder="Роль" value={add.role} onChange={e => setAdd(a => ({ ...a, role: e.target.value }))} style={{ flex: '1 1 120px' }} />
        <input className="form-input" placeholder="Телефон" value={add.phone} onChange={e => setAdd(a => ({ ...a, phone: e.target.value }))} style={{ flex: '1 1 120px' }} />
        <input className="form-input" placeholder="Email" value={add.email} onChange={e => setAdd(a => ({ ...a, email: e.target.value }))} style={{ flex: '1 1 140px' }} />
        <button className="btn" onClick={create}><i className="ti ti-plus" /> Додати</button>
      </div>
    </div>
  )
}

// ───────────────────────── Замовлення ─────────────────────────
function OrdersTab({ id }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.from('orders').select('id, order_number, type, status, total, created_at').eq('client_id', id).order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [id])
  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Замовлень ще немає." />
  return (
    <Table head={['Номер', 'Тип', 'Статус', 'Сума', 'Створено']}>
      {rows.map(o => (
        <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
          <td style={{ fontWeight: 500 }}>{o.order_number || o.id.slice(0, 8)}</td>
          <td><span style={{ color: TYPE_COLORS[o.type], fontWeight: 600, fontSize: 12 }}>{ORDER_TYPES[o.type] || o.type}</span></td>
          <td style={{ fontSize: 13 }}>{statusLabel(o)}</td>
          <td style={{ textAlign: 'right' }}>{fmt(o.total)}</td><td>{(o.created_at || '').slice(0, 10)}</td></tr>
      ))}
    </Table>
  )
}

// ───────────────────────── Документи ─────────────────────────
function DocumentsTab({ id }) {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [openDoc, setOpenDoc] = useState(null)
  const [genDoc, setGenDoc] = useState(null)
  const load = () => supabase.from('documents')
    .select('id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, ocr_data, source, generated_doc_id, contractors(name)')
    .eq('contractor_id', id).order('created_at', { ascending: false })
    .then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [id])

  const openRow = (d) => {
    if (d.source === 'generated' && d.generated_doc_id) { setGenDoc(d); return }
    setOpenDoc(d)
  }

  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Документів немає." />
  return (
    <>
      <Table head={['Тип', '№', 'Файл', 'Сума', 'Підписано', 'Дата']}>
        {rows.map(d => (
          <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => openRow(d)}>
            <td>{getDocType(d.type)?.label || d.type || '—'}</td>
            <td style={{ color: 'var(--text2)', fontSize: 12 }}>{d.doc_number || '—'}</td>
            <td><div className="trunc">{d.file_name || '—'}</div></td>
            <td style={{ textAlign: 'right' }}>{d.amount ? fmt(d.amount) : '—'}</td>
            <td>{d.is_signed ? '✓' : '—'}</td><td>{(d.doc_date || d.created_at || '').slice(0, 10)}</td>
          </tr>
        ))}
      </Table>
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => { setOpenDoc(null); load() }} />}
      {genDoc && <GeneratedDocModal doc={genDoc} onClose={() => setGenDoc(null)} />}
    </>
  )
}

// ───────────────────────── Транзакції ─────────────────────────
function TransactionsTab({ id }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.from('bank_transactions').select('id, date, description, counterparty, amount, direction, article')
      .eq('contractor_id', id).eq('is_ignored', false).order('date', { ascending: false }).limit(200)
      .then(({ data }) => setRows(data || []))
  }, [id])
  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Транзакцій немає." />
  return (
    <Table head={['Дата', 'Опис', 'Сума', 'Напрям', 'Стаття']}>
      {rows.map(t => (
        <tr key={t.id}><td style={{ fontSize: 12, color: 'var(--text2)' }}>{t.date}</td>
          <td><div className="trunc">{t.description || t.counterparty}</div></td>
          <td className={t.direction === 'Доходи' ? 'amt-pos' : 'amt-neg'} style={{ textAlign: 'right' }}>{fmt(t.amount)}</td>
          <td>{t.direction}</td><td style={{ color: 'var(--text2)', fontSize: 12 }}>{t.article || '—'}</td></tr>
      ))}
    </Table>
  )
}

// ───────────────────────── Товари ─────────────────────────
function ProductsTab({ id }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.from('transaction_items')
      .select('id, name, quantity, unit, unit_price, amount, bank_transactions!inner(contractor_id, date, direction)')
      .eq('bank_transactions.contractor_id', id).order('id', { ascending: false }).limit(300)
      .then(({ data }) => setRows(data || []))
  }, [id])
  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Товарних позицій немає." />
  return (
    <Table head={['Товар', 'К-сть', 'Ціна', 'Сума', 'Напрям', 'Дата']}>
      {rows.map(r => (
        <tr key={r.id}><td><div className="trunc">{r.name}</div></td>
          <td style={{ textAlign: 'right' }}>{r.quantity} {r.unit}</td>
          <td style={{ textAlign: 'right' }}>{fmt(r.unit_price)}</td>
          <td style={{ textAlign: 'right' }}>{fmt(r.amount)}</td>
          <td>{r.bank_transactions?.direction}</td>
          <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.bank_transactions?.date}</td></tr>
      ))}
    </Table>
  )
}

// ───────────────────────── Комунікація ─────────────────────────
function NotesTab({ id }) {
  const { user } = useUser()
  const [rows, setRows] = useState([])
  const [text, setText] = useState('')
  const load = () => supabase.from('notes').select('*').eq('entity_type', 'contractor').eq('entity_id', id).order('created_at', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [id])
  const add = async () => {
    if (!text.trim()) return
    await supabase.from('notes').insert({ entity_type: 'contractor', entity_id: id, text: text.trim(), user_id: user?.id || null })
    setText(''); load()
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <textarea className="form-input" placeholder="Додати нотатку…" value={text} onChange={e => setText(e.target.value)} rows={2} style={{ flex: 1, resize: 'vertical' }} />
        <button className="btn btn-primary" onClick={add}>Додати</button>
      </div>
      {rows.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Нотаток ще немає.</p>}
      {rows.map(n => (
        <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{n.text}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{new Date(n.created_at).toLocaleString('uk-UA')}</div>
        </div>
      ))}
    </div>
  )
}

// ───────────────────────── helpers ─────────────────────────
const Loading = () => <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
const Empty = ({ text }) => <div className="card"><p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>{text}</p></div>
const Table = ({ head, children }) => (
  <div className="card"><div className="tbl-wrap" style={{ border: 'none' }}>
    <table><thead><tr>{head.map((h, i) => <th key={i} style={i >= 2 && i <= 3 ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody></table>
  </div></div>
)

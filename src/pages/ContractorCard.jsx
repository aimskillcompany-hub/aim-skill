import PortalList from '../components/PortalList'
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { qc } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { getContractorBalance } from '../lib/debts'
import { useCompany } from '../lib/company'
import { fetchByEdrpou, isVkursiConfigured } from '../lib/vkursi'
import { extractCompanyExtract } from '../lib/ai'
import { getDocType } from '../lib/docgen'
import { ORDER_TYPES, TYPE_COLORS, statusLabel } from '../lib/orders'
import DocModal from '../components/DocModal'
import GeneratedDocModal from '../components/GeneratedDocModal'
import { useNewUi } from '../lib/uiPrefs'
import { Tabs, Button, KpiTile, Menu, useToast, InfoTip } from '../components/ui'
import { formatAmount } from '../utils/format'
import { initials } from '../components/AppShell'
import { NewOrderModal } from './Orders'
import TaskForm from '../components/TaskForm'
import './ContractorCardNew.css'

const TABS = [
  { id: 'details', label: 'Реквізити', icon: 'ti-id-badge-2' },
  { id: 'orders', label: 'Замовлення', icon: 'ti-shopping-cart' },
  { id: 'documents', label: 'Документи', icon: 'ti-files' },
  { id: 'transactions', label: 'Транзакції', icon: 'ti-building-bank' },
  { id: 'products', label: 'Товари', icon: 'ti-package' },
  { id: 'notes', label: 'Комунікація', icon: 'ti-message' },
]

// Новий інтерфейс (макет Contractor): + «Договори»; на телефоні «Реквізити» — не першою (макет ContractorMobile)
const TABS_NEW = [TABS[0], { id: 'contracts', label: 'Договори' }, ...TABS.slice(1), { id: 'portals', label: 'Портали' }]
const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches

export default function ContractorCard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [c, setC] = useState(null)
  const [bal, setBal] = useState(null)
  const { companies } = useCompany()
  const [tab, setTab] = useState('details')
  const newUi = useNewUi()
  const { user } = useUser()
  const [orders, setOrders] = useState(null)       // замовлення клієнта в роботі (новий інтерфейс)
  const [newOrder, setNewOrder] = useState(false)
  const [newTask, setNewTask] = useState(false)
  const [counts, setCounts] = useState({})        // лічильники на вкладках (новий інтерфейс)
  const [editSignal, setEditSignal] = useState(0) // «Редагувати» в шапці відкриває форму реквізитів

  useEffect(() => {
    supabase.from('contractors').select('*').eq('id', id).single().then(({ data }) => setC(data))
    getContractorBalance(id, companies.map(x => x.id)).then(setBal)
  }, [id, companies])
  useEffect(() => {
    if (!newUi) return
    qc('orders').select('id, status, archived_at').eq('client_id', id).is('archived_at', null)
      .then(({ data }) => setOrders(data || []))
    const cnt = (q) => q.then(({ count, error }) => (error ? undefined : count))
    Promise.all([
      cnt(supabase.from('contractor_contracts').select('id', { count: 'exact', head: true }).eq('contractor_id', id)),
      cnt(qc('orders').select('id', { count: 'exact', head: true }).eq('client_id', id)),
      cnt(qc('documents').select('id', { count: 'exact', head: true }).eq('contractor_id', id).not('posted', 'is', false)),
      cnt(qc('bank_transactions').select('id', { count: 'exact', head: true }).eq('contractor_id', id).eq('is_ignored', false)),
    ]).then(([contracts, ords, documents, transactions]) => setCounts({ contracts, orders: ords, documents, transactions })).catch(() => {})
  }, [id, newUi])
  // телефон: відкриваємо з «Замовлень» (клієнт) або «Транзакцій»
  useEffect(() => { if (newUi && c && isPhone()) setTab(t => t === 'details' ? (c.is_client ? 'orders' : 'transactions') : t) }, [newUi, c?.id])

  if (!c) return <div className="page-header"><h1>Завантаження…</h1></div>

  if (newUi) {
    const type = c.is_client && c.is_supplier ? 'Клієнт і постачальник' : c.is_client ? 'Клієнт' : c.is_supplier ? 'Постачальник' : null
    const waitPay = (orders || []).filter(o => o.status === 'needs_payment').length
    const waitContract = (orders || []).filter(o => o.status === 'needs_contract').length
    const copy = async () => { try { await navigator.clipboard.writeText(c.edrpou) } catch {} }
    return (
      <div className="ccn">
        <button type="button" className="ccn-back" onClick={() => navigate('/contractors')}><i className="ti ti-chevron-left" aria-hidden="true" />Контрагенти</button>
        <div className="ccn-topbar">
          <button type="button" className="ccn-tb-btn is-plain" onClick={() => navigate('/contractors')} aria-label="До контрагентів"><i className="ti ti-arrow-left" aria-hidden="true" /></button>
          <span className="ccn-tb-sp" />
          {c.phone && <a className="ccn-tb-btn" href={`tel:${String(c.phone).replace(/[^\d+]/g, '')}`} aria-label={`Подзвонити ${c.phone}`}><i className="ti ti-phone" aria-hidden="true" /></a>}
          <Menu trigger={<button type="button" className="ccn-tb-btn" aria-label="Інші дії"><i className="ti ti-dots" aria-hidden="true" /></button>}
            items={[{ label: 'Редагувати реквізити', icon: 'ti-pencil', onClick: () => { setTab('details'); setEditSignal(n => n + 1) } }]} />
        </div>
        <section className="ccn-head">
          <span className="ccn-av" aria-hidden="true">{initials(c.short_name || c.name)}</span>
          <div className="ccn-head-main">
            <h1 className="ccn-h1">{c.name}</h1>
            <div className="ccn-meta">
              {type ? <span className={`ccn-chip${c.is_client ? ' is-client' : ' is-supplier'}`}>{type}</span> : <span className="ccn-chip is-none">Тип не вказано</span>}
              {c.edrpou && <span className="ccn-edr">ЄДРПОУ {c.edrpou}<button type="button" className="ccn-copy" onClick={copy} aria-label="Скопіювати ЄДРПОУ" title="Скопіювати"><i className="ti ti-copy" aria-hidden="true" /></button></span>}
              {c.city && <span>{c.city}</span>}
              <span>Відстрочка {Number(c.payment_delay_days) || 0} дн.</span>
            </div>
          </div>
          <div className="ccn-actions">
            <Button variant="secondary" icon="ti-plus" onClick={() => setNewTask(true)} className="ccn-act-task">Задача</Button>
            <Button variant="secondary" onClick={() => { setTab('details'); setEditSignal(n => n + 1) }} className="ccn-act-edit">Редагувати</Button>
            {c.is_client && <Button variant="brand" icon="ti-plus" onClick={() => setNewOrder(true)} className="ccn-act-order"><span className="ccn-lg">Нове замовлення</span><span className="ccn-sm">Замовлення</span></Button>}
          </div>
        </section>

        <div className="ccn-kpis">
          {(() => {
            // темна плитка — головний борг: для постачальника (не клієнта) — «Ми винні», інакше — «Нам винні»
            const supplierOnly = c.is_supplier && !c.is_client
            const main = supplierOnly
              ? { label: 'Ми винні', value: bal?.payable, extra: bal?.unlinkedOut, extraText: "наших оплат без прив'язки до документа — не враховані" }
              : { label: 'Нам винні', value: bal?.receivable, extra: bal?.unlinkedIn, extraText: "оплат без прив'язки до документа — не враховані" }
            const other = supplierOnly
              ? { label: 'Нам винні', value: bal?.receivable, hint: bal?.unlinkedIn > 0.5 ? `+ ${formatAmount(bal.unlinkedIn, { decimals: 0 })} ₴ оплат без прив'язки` : 'за документами клієнту' }
              : { label: 'Ми винні', value: bal?.payable, hint: bal?.unlinkedOut > 0.5 ? `+ ${formatAmount(bal.unlinkedOut, { decimals: 0 })} ₴ наших оплат без прив'язки` : 'за документами постачальника' }
            return <>
              <section className={`ccn-owed${supplierOnly ? ' is-payable' : ''}`}>
                <span className="ccn-owed-label">{main.label}</span>
                <b className="ccn-owed-value">{bal ? `${formatAmount(main.value, { decimals: 0 })} ₴` : '…'}</b>
                {main.extra > 0.5 && <span className="ccn-owed-note">+ <b>{formatAmount(main.extra, { decimals: 0 })} ₴</b> {main.extraText}</span>}
                {main.extra > 0.5 && <button type="button" className="ccn-owed-link" onClick={() => navigate('/bank')}>Прив'язати в «Банку» →</button>}
                <span className="ccn-owed-sub">
                  <span><small>{other.label}</small><b>{bal ? `${formatAmount(other.value, { decimals: 0 })} ₴` : '…'}</b></span>
                  <span><small>Оборот за рік</small><b>{bal ? `${formatAmount(bal.turnoverYear, { decimals: 0 })} ₴` : '…'}</b></span>
                </span>
              </section>
              <KpiTile className="ccn-kpi-lg" label={other.label} value={bal ? `${formatAmount(other.value, { decimals: 0 })} ₴` : '…'} hint={other.hint} />
            </>
          })()}
          <KpiTile className="ccn-kpi-lg" label="Оборот за рік" value={bal ? `${formatAmount(bal.turnoverYear, { decimals: 0 })} ₴` : '…'}
            hint={bal ? `надійшло ${formatAmount(bal.income, { decimals: 0 })} · сплачено ${formatAmount(bal.expense, { decimals: 0 })}` : null} />
          {c.is_client
            ? <KpiTile className="ccn-kpi-lg" label="Замовлення в роботі" value={orders ? orders.length : '…'} onClick={() => setTab('orders')}
                tone={waitPay || waitContract ? 'warn' : 'neutral'}
                hint={orders && (waitPay || waitContract) ? [waitPay && `${waitPay} чекають оплату`, waitContract && `${waitContract} — договір`].filter(Boolean).join(' · ') : 'відкрити список'} />
            : bal?.loans?.count > 0 && <KpiTile className="ccn-kpi-lg" label="Позики: нам винні − ми винні" value={`${formatAmount(bal.loans.theyOwe - bal.loans.weOwe, { decimals: 0 })} ₴`}
                hint={`нам винні ${formatAmount(bal.loans.theyOwe, { decimals: 0 })} · ми винні ${formatAmount(bal.loans.weOwe, { decimals: 0 })}`} />}
        </div>
        {c.is_client && bal?.loans?.count > 0 && (
          <p className="ccn-loans">Позики (ПФД) з цим контрагентом: нам винні {formatAmount(bal.loans.theyOwe, { decimals: 0 })} ₴ · ми винні {formatAmount(bal.loans.weOwe, { decimals: 0 })} ₴ — деталі в «Поворотній фін. допомозі».</p>
        )}

        <section className="ccn-body">
          <Tabs ariaLabel="Розділи контрагента" idPrefix="ccn-tab" value={tab} onChange={setTab}
            tabs={(isPhone() ? [...TABS_NEW.slice(2), ...TABS_NEW.slice(0, 2)] : TABS_NEW).map(t => ({ id: t.id, label: t.label, count: counts[t.id] || undefined }))} />
          <div className="ccn-panel" role="tabpanel" aria-labelledby={`ccn-tab-${tab}`}>
            {tab === 'details' && <DetailsTab c={c} onSaved={setC} newUi editSignal={editSignal} />}
            {tab === 'contracts' && <div className="ccn-contracts"><Contracts contractorId={c.id} newUi /></div>}
            {tab === 'orders' && <OrdersTab id={id} newUi />}
            {tab === 'documents' && <DocumentsTab id={id} />}
            {tab === 'transactions' && <TransactionsTab id={id} />}
            {tab === 'products' && <ProductsTab id={id} />}
            {tab === 'notes' && <NotesTab id={id} />}
            {tab === 'portals' && <PortalList contractorId={c.id} contractorName={c.name} />}
          </div>
        </section>
        {newOrder && <NewOrderModal presetClientId={c.id} onClose={() => setNewOrder(false)} onCreated={(oid) => { setNewOrder(false); navigate(`/orders/${oid}`) }} />}
        {newTask && <TaskForm task={{ priority: 'normal', assignee_id: user?.id, entity_type: 'counterparty', entity_id: c.id, entity_ref: `/contractors/${c.id}` }} me={user?.id}
          onClose={() => setNewTask(false)} onSaved={() => setNewTask(false)} />}
      </div>
    )
  }

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
        {/* Те саме правило, що й звіт «Дебіторка»: документ − прив'язані до нього оплати; оплати без документа — окремо */}
        <Kpi label="Дебіторка (нам винні)" value={bal ? bal.receivable : null} positive
          note={bal?.unlinkedIn > 0.5 ? `+ оплати від клієнта без прив'язки до документа: ${fmtInt(bal.unlinkedIn)} грн — у боргу не враховані (аванс або прив'яжіть у «Банк»)` : null} />
        <Kpi label="Кредиторка (ми винні)" value={bal ? bal.payable : null} negative
          note={bal?.unlinkedOut > 0.5 ? `+ наші оплати без прив'язки до документа: ${fmtInt(bal.unlinkedOut)} грн` : null} />
        <Kpi label="Оборот за рік" value={bal ? bal.turnoverYear : null} />
        {bal?.loans?.count > 0 && <Kpi label="Позики (ПФД): нам винні − ми винні" value={bal.loans.theyOwe - bal.loans.weOwe}
          note={`нам винні ${fmtInt(bal.loans.theyOwe)} · ми винні ${fmtInt(bal.loans.weOwe)}${bal.loans.unclassified > 0.5 ? ` · без статті ПФД ${fmtInt(bal.loans.unclassified)}` : ''} — деталі в розділі «Позики»`} />}
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

function Kpi({ label, value, positive, negative, note }) {
  const color = value == null ? 'var(--text3)' : positive && value > 0 ? 'var(--green)' : negative && value > 0 ? 'var(--red)' : 'var(--text)'
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>
        {value == null ? '…' : fmtInt(value)} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text3)' }}>грн</span>
      </div>
      {note && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4, lineHeight: 1.35 }}>{note}</div>}
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

function DetailsTab({ c, onSaved, newUi, editSignal }) {
  const [form, setForm] = useState(c)
  const [editing, setEditing] = useState(!!editSignal)
  useEffect(() => { if (editSignal) setEditing(true) }, [editSignal])
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
    if (error && /(edr_extract|dealer_code)/.test(error.message || '')) {
      delete upd.edr_extract_path; delete upd.edr_extract_name; delete upd.dealer_code
      ;({ error } = await supabase.from('contractors').update(upd).eq('id', c.id))
    }
    setSaving(false)
    if (error) { setEdr({ loading: false, msg: null, err: 'Помилка збереження: ' + error.message }); return }
    setSaved(true); onSaved({ ...c, ...form }); setEditing(false); setTimeout(() => setSaved(false), 2500)
  }

  const cancel = () => { setForm(c); setEditing(false); setVk({ loading: false, msg: null, err: null }); setEdr({ loading: false, msg: null, err: null }) }

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

  // ─── Новий інтерфейс: перегляд — 4 картки (макет Contractor: Юрособа, Адреса, Контактні особи, Банківські рахунки) ───
  if (!editing && newUi) return <DetailsCards form={form} c={c} onEdit={() => setEditing(true)} openExtract={openExtract} />

  // ─── Режим ПЕРЕГЛЯДУ (за замовчуванням) — компактно, лише заповнені поля ───
  if (!editing) {
    const badges = [
      form.is_client && ['Клієнт', 'var(--blue-bg)', 'var(--blue)'],
      form.is_supplier && ['Постачальник', 'var(--surface2)', 'var(--text2)'],
      form.is_vat_payer && ['Платник ПДВ', 'var(--green-bg, #e7f7ec)', 'var(--green)'],
    ].filter(Boolean)
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{form.short_name || form.name || 'Без назви'}</div>
            {form.name && form.name !== form.short_name && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{form.name}</div>}
            <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {form.edrpou && <span>ЄДРПОУ: <b style={{ color: 'var(--text2)' }}>{form.edrpou}</b></span>}
              {form.ipn && <span>ІПН: <b style={{ color: 'var(--text2)' }}>{form.ipn}</b></span>}
              {form.legal_form && <span>{form.legal_form}</span>}
            </div>
            {badges.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {badges.map(([t, bg, col]) => <span key={t} style={tag(bg, col)}>{t}</span>)}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => setEditing(true)}><i className="ti ti-pencil" /> Редагувати</button>
        </div>

        {form.edr_extract_path && (
          <div style={{ fontSize: 12.5, marginBottom: 12 }}>
            <i className="ti ti-file-check" style={{ color: 'var(--green)' }} /> Витяг з ЄДР: <a onClick={openExtract} style={{ color: 'var(--blue)', cursor: 'pointer' }}>{form.edr_extract_name || 'переглянути'}</a>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px 24px' }}>
          {FIELD_GROUPS.flatMap(g => g.fields)
            .filter(([key]) => { const v = form[key]; return v != null && v !== '' })
            .map(([key, label]) => (
              <div key={key} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 1 }}>{label}</div>
                <div style={{ fontSize: 13.5, wordBreak: 'break-word' }}>{String(form[key])}</div>
              </div>
            ))}
          {form.is_supplier && form.dealer_code && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 1 }}>Код компанії у дилера</div>
              <div style={{ fontSize: 13.5, wordBreak: 'break-word' }}>{form.dealer_code}</div>
            </div>
          )}
        </div>

        <Contacts contractorId={c.id} readOnly />
        <Contracts contractorId={c.id} readOnly />
      </div>
    )
  }

  // ─── Режим РЕДАГУВАННЯ (за кнопкою) ───
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

      {form.is_supplier && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Дилер / дистриб'ютор</div>
          <div className="form-grid">
            <div className="form-group">
              <label>Код компанії у дилера</label>
              <input className="form-input" value={form.dealer_code ?? ''} onChange={e => set('dealer_code', e.target.value)} placeholder="напр. 501684" />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Наш дилерський код у цього постачальника — підтягнеться у форму реєстрації проекту.</span>
            </div>
          </div>
        </div>
      )}

      <Contacts contractorId={c.id} />

      <Contracts contractorId={c.id} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '…' : 'Зберегти'}</button>
        <button className="btn" onClick={cancel} disabled={saving}>Скасувати</button>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
      </div>
    </div>
  )
}

const Field = ({ label, v, wide }) => (v == null || v === '') ? null : (
  <div className={`ccd-f${wide ? ' is-wide' : ''}`}><span>{label}</span><b>{String(v)}</b></div>
)
function DetailsCards({ form, c, onEdit, openExtract }) {
  const [contacts, setContacts] = useState(null)
  useEffect(() => {
    supabase.from('contractor_contacts').select('*').eq('contractor_id', c.id).order('created_at').then(({ data }) => setContacts(data || []))
  }, [c.id])
  const type = [form.is_client && 'Клієнт', form.is_supplier && 'Постачальник'].filter(Boolean).join(' і ') || 'не вказано'
  const hasAddr = form.legal_address || form.city || form.postal_code || form.region
  const hasBank = form.iban || form.bank_name || form.mfo
  const edit = <button type="button" className="ccd-edit" onClick={onEdit}>Змінити</button>
  return (
    <div className="ccd">
      <section className="ccd-card">
        <div className="ccd-h"><b>Юридична особа</b>{edit}</div>
        <div className="ccd-grid">
          <Field label="Повна назва" v={form.name} wide />
          <Field label="Коротка назва" v={form.short_name} />
          <Field label="ЄДРПОУ" v={form.edrpou} />
          <Field label="ІПН" v={form.ipn} />
          <Field label="Орг.-правова форма" v={form.legal_form} />
          <Field label="Тип" v={type} />
          <Field label="Відстрочка оплати" v={`${Number(form.payment_delay_days) || 0} днів`} />
          <Field label="Система оподаткування" v={form.tax_system || (form.is_vat_payer ? 'платник ПДВ' : null)} />
          <Field label="Директор" v={[form.director, form.director_position].filter(Boolean).join(', ')} wide />
          {form.is_supplier && <Field label="Код компанії у дилера" v={form.dealer_code} />}
        </div>
        {form.edr_extract_path && <button type="button" className="ccd-link" onClick={openExtract}><i className="ti ti-file-check" aria-hidden="true" />Витяг з ЄДР: {form.edr_extract_name || 'переглянути'}</button>}
      </section>
      <section className={`ccd-card${hasAddr ? '' : ' is-empty'}`}>
        <div className="ccd-h"><b>Адреса{!hasAddr && <InfoTip label="Адреса">Юридична адреса потрапить у рахунки й договори.</InfoTip>}</b>{hasAddr && edit}</div>
        {hasAddr ? <div className="ccd-grid">
          <Field label="Юридична адреса" v={form.legal_address} wide />
          <Field label="Місто" v={form.city} />
          <Field label="Індекс" v={form.postal_code} />
          <Field label="Область" v={form.region} />
          <Field label="Телефон" v={form.phone} />
          <Field label="Email" v={form.email} />
          <Field label="Сайт" v={form.website} />
        </div> : <>
          <button type="button" className="ccd-add" onClick={onEdit}>+ Адреса</button></>}
      </section>
      <section className={`ccd-card${contacts?.length ? '' : ' is-empty'}`}>
        <div className="ccd-h"><b>Контактні особи<InfoTip label="Контактні особи">Відповідальну особу замовника підставимо в КП і листи.</InfoTip></b>{contacts?.length > 0 && edit}</div>
        {contacts == null ? <p className="ccd-hint">Завантаження…</p>
          : contacts.length ? <ul className="ccd-people">{contacts.map(r => (
              <li key={r.id}><b>{r.name}</b>{r.role && <span>{r.role}</span>}
                {(r.phone || r.email) && <small>{[r.phone, r.email].filter(Boolean).join(' · ')}</small>}</li>))}</ul>
          : <>
            <button type="button" className="ccd-add" onClick={onEdit}>+ Контакт</button></>}
      </section>
      <section className={`ccd-card${hasBank ? '' : ' is-empty'}`}>
        <div className="ccd-h"><b>Банківські рахунки<InfoTip label="Банківські рахунки">IBAN контрагента підставимо в рахунки й платіжки.</InfoTip></b>{hasBank && edit}</div>
        {hasBank ? <div className="ccd-grid">
          <Field label="IBAN" v={form.iban} wide />
          <Field label="Банк" v={form.bank_name} />
          <Field label="МФО" v={form.mfo} />
        </div> : <>
          <button type="button" className="ccd-add" onClick={onEdit}>+ Рахунок</button></>}
      </section>
    </div>
  )
}

function Contacts({ contractorId, readOnly }) {
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

  if (readOnly && rows.length === 0) return null

  return (
    <div style={{ marginTop: readOnly ? 20 : 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Контактні особи</div>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
          <div style={{ flex: 1 }}><b>{r.name}</b>{r.role && <span style={{ color: 'var(--text2)' }}> · {r.role}</span>}</div>
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>{r.phone}</div>
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>{r.email}</div>
          {!readOnly && <button className="btn" onClick={() => remove(r.id)} style={{ padding: '2px 8px' }}><i className="ti ti-trash" /></button>}
        </div>
      ))}
      {!readOnly && <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Ім'я" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} style={{ flex: '1 1 140px' }} />
        <input className="form-input" placeholder="Роль" value={add.role} onChange={e => setAdd(a => ({ ...a, role: e.target.value }))} style={{ flex: '1 1 120px' }} />
        <input className="form-input" placeholder="Телефон" value={add.phone} onChange={e => setAdd(a => ({ ...a, phone: e.target.value }))} style={{ flex: '1 1 120px' }} />
        <input className="form-input" placeholder="Email" value={add.email} onChange={e => setAdd(a => ({ ...a, email: e.target.value }))} style={{ flex: '1 1 140px' }} />
        <button className="btn" onClick={create}><i className="ti ti-plus" /> Додати</button>
      </div>}
    </div>
  )
}

// ───────────────────────── Договори ─────────────────────────
function Contracts({ contractorId, readOnly, newUi }) {
  const [rows, setRows] = useState([])
  const [add, setAdd] = useState({ number: '', date: '', subject: '' })
  const load = () => supabase.from('contractor_contracts').select('*').eq('contractor_id', contractorId).order('date', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [contractorId])

  const create = async () => {
    if (!add.number.trim()) return
    await supabase.from('contractor_contracts').insert({
      contractor_id: contractorId, number: add.number.trim(), date: add.date || null, subject: add.subject || null, status: 'active',
    })
    setAdd({ number: '', date: '', subject: '' }); load()
  }
  const remove = async (cid) => { await supabase.from('contractor_contracts').delete().eq('id', cid); load() }

  if (readOnly && rows.length === 0) return null

  return (
    <div style={{ marginTop: newUi ? 0 : 20 }}>
      {!newUi && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Договори</div>}
      {!readOnly && rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>Договорів ще немає. Додаються тут або автоматично при генерації документа з номером договору.</div>}
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
          <div style={{ flex: 1 }}><b>№{r.number}</b>{r.date && <span style={{ color: 'var(--text2)' }}> від {r.date}</span>}{r.subject && <span style={{ color: 'var(--text2)' }}> · {r.subject}</span>}</div>
          {r.status && r.status !== 'active' && <span style={{ fontSize: 12, color: 'var(--text3)' }}>{r.status}</span>}
          {!readOnly && <button className="btn" onClick={() => remove(r.id)} style={{ padding: '2px 8px' }}><i className="ti ti-trash" /></button>}
        </div>
      ))}
      {!readOnly && <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Номер договору" value={add.number} onChange={e => setAdd(a => ({ ...a, number: e.target.value }))} style={{ flex: '1 1 140px' }} />
        <input className="form-input" type="date" placeholder="Дата" value={add.date} onChange={e => setAdd(a => ({ ...a, date: e.target.value }))} style={{ flex: '1 1 130px' }} />
        <input className="form-input" placeholder="Предмет" value={add.subject} onChange={e => setAdd(a => ({ ...a, subject: e.target.value }))} style={{ flex: '1 1 160px' }} />
        <button className="btn" onClick={create}><i className="ti ti-plus" /> Додати</button>
      </div>}
    </div>
  )
}

// ───────────────────────── Замовлення ─────────────────────────
function OrdersTab({ id, newUi }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    qc('orders').select('id, order_number, type, status, total, created_at').eq('client_id', id).order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [id])
  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Замовлень ще немає." />
  const list = newUi && (
    <ul className="ccn-olist">{rows.map(o => (
      <li key={o.id}><button type="button" onClick={() => navigate(`/orders/${o.id}`)}>
        <span className="ccn-o-main"><b>№ {o.order_number || o.id.slice(0, 8)}</b><small>{(o.created_at || '').slice(0, 10).split('-').reverse().slice(0, 2).join('.')}</small></span>
        <span className="ccn-o-st">{statusLabel(o)}</span>
        <b className="ccn-o-sum">{formatAmount(o.total, { decimals: 2 })} ₴</b>
      </button></li>))}</ul>
  )
  return (<>{list}<div className={newUi ? 'ccn-otable' : undefined}>
    <Table head={['Номер', 'Тип', 'Статус', 'Сума', 'Створено']}>
      {rows.map(o => (
        <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
          <td style={{ fontWeight: 500 }}>{o.order_number || o.id.slice(0, 8)}</td>
          <td><span style={{ color: TYPE_COLORS[o.type], fontWeight: 600, fontSize: 12 }}>{ORDER_TYPES[o.type] || o.type}</span></td>
          <td style={{ fontSize: 13 }}>{statusLabel(o)}</td>
          <td style={{ textAlign: 'right' }}>{fmt(o.total)}</td><td>{(o.created_at || '').slice(0, 10)}</td></tr>
      ))}
    </Table></div></>
  )
}

// ───────────────────────── Документи ─────────────────────────
function DocumentsTab({ id }) {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [openDoc, setOpenDoc] = useState(null)
  const [genDoc, setGenDoc] = useState(null)
  const cols = 'id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, ocr_data, source, generated_doc_id, contractors(name)'
  const load = async () => {
    // posted=false — чернетка в замовленні; у картці контрагента не показуємо
    let { data, error } = await qc('documents').select(cols).eq('contractor_id', id).not('posted', 'is', false).order('created_at', { ascending: false })
    if (error) ({ data } = await qc('documents').select(cols).eq('contractor_id', id).order('created_at', { ascending: false })) // фолбек, якщо колонки posted ще нема
    setRows(data || [])
  }
  useEffect(() => { load() }, [id])

  const openRow = (d) => {
    if (d.source === 'generated' || d.generated_doc_id) { setGenDoc(d); return }
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
    qc('bank_transactions').select('id, date, description, counterparty, amount, direction, article')
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

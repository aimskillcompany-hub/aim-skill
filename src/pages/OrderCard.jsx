import { Fragment, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { useCompany } from '../lib/company'
import { useUser } from '../lib/auth'
import { nextOrderNumber } from '../lib/orderNumber'
import { fmt } from '../lib/fmt'
import { getDocType, previewPdf, generatePdf, supplierOrderPdf, investorReportPdf } from '../lib/docgen'
import { resolveProduct } from '../lib/stockService'
import { extractOrderItems } from '../lib/ai'
import DocModal from '../components/DocModal'
import DocGenModal from '../components/DocGenModal'
import ProductSelect from '../components/ui/ProductSelect'
import AutoTextarea from '../components/ui/AutoTextarea'
import PricePickerModal from '../components/ui/PricePickerModal'
import ContractorSelect from '../components/ui/ContractorSelect'
import VendorRegTab from '../components/VendorRegTab'
import {
  ORDER_TYPES, TYPE_COLORS, OUTCOME, flowFor, proposalOverdue,
} from '../lib/orders'

const VAT_RATES = [0, 20]

const TABS = [
  { id: 'details', label: 'Деталі', icon: 'ti-info-circle' },
  { id: 'items', label: 'Товари', icon: 'ti-list-details' },
  { id: 'proposals', label: 'КП', icon: 'ti-file-text' },
  { id: 'documents', label: 'Документи', icon: 'ti-files' },
  { id: 'suppliers', label: 'Субзамовлення', icon: 'ti-truck-delivery' },
  { id: 'vendorreg', label: 'Реєстрація у вендора', icon: 'ti-clipboard-check' },
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
  const [msg, setMsg] = useState(null)
  const [itemsDirty, setItemsDirty] = useState(false)

  const UNSAVED_MSG = 'У вкладці «Товари» є незбережені зміни. Якщо піти — вони втратяться. Продовжити?'
  const guardLeave = () => !itemsDirty || window.confirm(UNSAVED_MSG)
  const switchTab = (id) => { if (id !== 'items' && tab === 'items' && !guardLeave()) return; if (id !== 'items') setItemsDirty(false); setTab(id) }
  const goBack = () => { if (!guardLeave()) return; setItemsDirty(false); navigate('/orders') }

  const load = async () => {
    const { data } = await qc('orders').select('*, contractors(name)').eq('id', id).single()
    setO(data)
    const { data: props } = await qc('commercial_proposals').select('sent_at').eq('order_id', id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1)
    setLastSent(props?.[0]?.sent_at || null)
  }
  useEffect(() => { load() }, [id])

  if (!o) return <div className="page-header"><h1>Завантаження…</h1></div>

  // Завершити замовлення з результатом (won=виконано / lost=програно). Повернути в роботу — unarchive.
  const archive = async (outcome) => {
    setBusy('archive'); setMsg(null)
    const upd = { archived_at: new Date().toISOString(), outcome: outcome || null }
    let { error } = await qc('orders').update(upd).eq('id', id)
    // Колонка outcome може ще не існувати (міграція 028) — тоді архівуємо без неї
    if (error && /outcome/.test(error.message || '')) {
      ;({ error } = await qc('orders').update({ archived_at: upd.archived_at }).eq('id', id))
    }
    setBusy('')
    if (error) { setMsg('Помилка архівування: ' + error.message); return }
    load()
  }

  const unarchive = async () => {
    setBusy('archive'); setMsg(null)
    await qc('orders').update({ archived_at: null }).eq('id', id)
    setBusy(''); load()
  }

  // Зміна статусу зі степера в шапці (єдиний контрол стану)
  const setStatus = async (s) => {
    const upd = { status: s }
    if (s === 'closed') upd.closed_at = o.closed_at || new Date().toISOString()
    else if (o.status === 'closed') upd.closed_at = null // вихід із «Закрито» → скидаємо дату закриття
    await qc('orders').update(upd).eq('id', id)
    load()
  }

  // Змінити/проставити результат без зміни статусу архіву
  const setOutcome = async (outcome) => {
    setMsg(null)
    const { error } = await qc('orders').update({ outcome: outcome || null }).eq('id', id)
    if (error) { setMsg('Помилка: ' + error.message); return }
    load()
  }

  // Копіювати замовлення разом з товарами
  const copyOrder = async () => {
    setBusy('copy'); setMsg(null)
    try {
      const order_number = await nextOrderNumber(supabase)
      const { data: no, error } = await qc('orders').insert(withCompany({
        order_number, type: o.type, status: 'new', client_id: o.client_id,
        description: o.description || null, procurement_type: o.procurement_type || null,
        total: o.total || 0, created_by: user?.id || null,
      })).select('id').single()
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
    const { count } = await qc('documents').select('id', { count: 'exact', head: true }).eq('order_id', id)
    if (count > 0) {
      setBusy(''); setConfirmDel(false)
      setMsg(`Не можна видалити: до замовлення прив'язано ${count} документ(ів). Заархівуйте його замість видалення.`)
      return
    }
    const { error } = await qc('orders').delete().eq('id', id)
    setBusy('')
    if (error) { setMsg('Помилка видалення: ' + error.message); return }
    navigate('/orders')
  }

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
                <i className="ti ti-rotate-2" /> {busy === 'archive' ? '…' : 'Повернути в роботу'}
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => archive('won')} disabled={busy === 'archive'} style={{ color: 'var(--green)' }} title="Замовлення виконано">
                  <i className="ti ti-circle-check" /> Виконано
                </button>
                <button className="btn" onClick={() => archive('lost')} disabled={busy === 'archive'} style={{ color: 'var(--red)' }} title="Замовлення програно">
                  <i className="ti ti-mood-sad" /> Програно
                </button>
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

      <StatusStepper o={o} onChange={setStatus} />

      {msg && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-alert-circle" /> {msg}
        </div>
      )}

      {o.archived_at && (() => {
        const lost = o.outcome === 'lost'
        return (
        <div style={{ background: lost ? 'var(--red-bg)' : 'var(--green-bg, #e7f7ec)', color: lost ? 'var(--red)' : 'var(--green)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}><i className={`ti ${lost ? 'ti-mood-sad' : 'ti-circle-check'}`} /> {lost ? 'Програно' : 'Виконано'} (з {o.archived_at.slice(0, 10)})</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <button className="btn" onClick={() => setOutcome('won')} disabled={o.outcome === 'won' || o.outcome == null} style={{ fontSize: 12, padding: '3px 10px', color: 'var(--green)' }}><i className="ti ti-circle-check" /> Виконано</button>
            <button className="btn" onClick={() => setOutcome('lost')} disabled={o.outcome === 'lost'} style={{ fontSize: 12, padding: '3px 10px', color: 'var(--red)' }}><i className="ti ti-mood-sad" /> Програно</button>
            <button className="btn" onClick={unarchive} style={{ fontSize: 12, padding: '3px 10px' }}><i className="ti ti-rotate-2" /> В роботу</button>
          </span>
        </div>
        )
      })()}

      {overdue && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-alert-triangle" /> Минуло понад 48 год від надсилання КП без відповіді клієнта.
        </div>
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

      {tab === 'details' && <DetailsTab key={`${o.status}|${o.closed_at || ''}`} o={o} onSaved={load} />}
      {tab === 'items' && <ItemsTab o={o} onChange={load} onDirty={setItemsDirty} />}
      {tab === 'proposals' && <ProposalsTab o={o} onChange={load} />}
      {tab === 'documents' && <DocumentsTab o={o} />}
      {tab === 'suppliers' && <SuppliersTab o={o} />}
      {tab === 'vendorreg' && <VendorRegTab o={o} />}
      {tab === 'transactions' && <TransactionsTab o={o} />}
      {tab === 'stock' && <StockTab o={o} />}
    </div>
  )
}

// ───────── Степер статусів (у шапці, єдиний контрол стану) ─────────
function StatusStepper({ o, onChange }) {
  const steps = flowFor(o.type)
  let cur = steps.findIndex(x => x.s === o.status)
  if (cur < 0) cur = 0
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', marginBottom: 16, padding: '4px 2px' }}>
      {steps.map((st, i) => {
        const done = i < cur, active = i === cur
        const accent = st.accent // яскравий статус (напр. «Потребує оплати»)
        const activeBg = accent || 'var(--blue)'
        const labelColor = active ? activeBg : accent ? accent : done ? 'var(--text)' : 'var(--text3)'
        return (
          <Fragment key={st.s}>
            {i > 0 && <div style={{ flex: '1 1 16px', minWidth: 12, height: 2, background: i <= cur ? 'var(--green)' : 'var(--border)', marginTop: 14 }} />}
            <button onClick={() => onChange(st.s)} title={`Перевести в «${st.label}»`}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, flex: '0 0 auto' }}>
              <span style={{
                width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
                background: active ? activeBg : done ? 'var(--green)' : accent ? accent : 'var(--surface2)',
                color: active || done || accent ? '#fff' : 'var(--text3)',
                boxShadow: accent && !done ? `0 0 0 3px ${accent}33` : 'none',
              }}>{done ? <i className="ti ti-check" /> : i + 1}</span>
              <span style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.2, maxWidth: 92,
                color: labelColor, fontWeight: active || accent ? 600 : 400 }}>{st.label}</span>
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}

// ───────── Деталі ─────────
function DetailsTab({ o, onSaved }) {
  const { companies, activeId, setActiveCompany } = useCompany()
  const [form, setForm] = useState({
    description: o.description || '',
    procurement_type: o.procurement_type || 'direct',
    procurement_id: o.procurement_id || '',
    client_id: o.client_id || null,
    clientName: o.contractors?.name || '',
    closed_at: o.closed_at ? o.closed_at.slice(0, 10) : '',
    manager_id: o.manager_id || '',
    contract_id: o.contract_id || '',
    company_id: o.company_id || activeId || '',
    agent_commission_pct: o.agent_commission_pct != null ? String(Math.round(o.agent_commission_pct * 10000) / 100) : '',
    in_investor: !!o.in_investor,
  })
  const [saved, setSaved] = useState(false)
  const [users, setUsers] = useState([])
  const [contracts, setContracts] = useState([])
  useEffect(() => {
    supabase.from('profiles').select('id, full_name, email, role').order('full_name').then(({ data }) => setUsers(data || []))
  }, [])
  // Договори клієнта — для випадайки «Договір».
  useEffect(() => {
    if (!form.client_id) { setContracts([]); return }
    supabase.from('contractor_contracts').select('id, number, date').eq('contractor_id', form.client_id)
      .order('date', { ascending: false }).then(({ data }) => setContracts(data || []))
  }, [form.client_id])
  const userName = (u) => u.full_name || u.email || '—'
  const contractLabel = (c) => `№${c.number}${c.date ? ` від ${c.date.slice(0, 10).split('-').reverse().join('.')}` : ''}`

  // Перенести замовлення в іншу юрособу: сам order + пов'язані scoped-записи.
  const moveCompany = async (cid) => {
    await qc('orders').update({ company_id: cid }).eq('id', o.id)
    // Пов'язані записи (щоб не осиротіли в старій компанії). Best-effort:
    // документи/рухи в закритому періоді можуть блокуватися тригером — не валимо весь перенос.
    for (const t of ['commercial_proposals', 'supplier_orders', 'documents', 'generated_docs', 'stock_movements']) {
      try { await qc(t).update({ company_id: cid }).eq('order_id', o.id) } catch {}
    }
  }

  const save = async () => {
    const upd = {
      description: form.description || null,
      procurement_type: form.procurement_type,
      procurement_id: form.procurement_type === 'tender' ? (form.procurement_id || null) : null,
      client_id: form.client_id || null,
      closed_at: form.closed_at ? new Date(form.closed_at).toISOString() : null,
      manager_id: form.manager_id || null,
      contract_id: form.contract_id || null,
      agent_commission_pct: Math.max(0, (Number(form.agent_commission_pct) || 0)) / 100,
      in_investor: !!form.in_investor,
    }
    let { error } = await qc('orders').update(upd).eq('id', o.id)
    // Колонки можуть ще не існувати (міграції 033/037/040/046/047) — тоді зберігаємо без них
    if (error && /(procurement_id|manager_id|contract_id|agent_commission_pct|in_investor)/.test(error.message || '')) {
      const { procurement_id, manager_id, contract_id, agent_commission_pct, in_investor, ...rest } = upd
      ;({ error } = await qc('orders').update(rest).eq('id', o.id))
    }
    if (error) { alert('Помилка збереження: ' + error.message); return }
    // Зміна компанії — перенос + слідування (перемкнути активну компанію, щоб замовлення лишилось видимим)
    const newCid = form.company_id || null
    if (newCid && newCid !== (o.company_id || null)) {
      await moveCompany(newCid)
      if (newCid !== activeId) { setActiveCompany(newCid); return } // remount покаже замовлення в новій компанії
    }
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
                setForm(f => ({ ...f, client_id: data?.id || null, clientName: c.name, contract_id: '' }))
              } else {
                setForm(f => ({ ...f, client_id: c.id, clientName: c.name, contract_id: '' }))
              }
            }} />
        </div>
        {companies.length > 1 && (
          <div className="form-group"><label>Компанія (юрособа)</label>
            <select className="form-input" value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}
            </select>
            {form.company_id && form.company_id !== (o.company_id || activeId) && (
              <span style={{ fontSize: 11, color: 'var(--amber, #b45309)' }}>Замовлення (з КП/субзамовленнями/документами) буде перенесено; система перемкнеться на цю компанію</span>
            )}
          </div>
        )}
        <div className="form-group"><label>Відповідальний менеджер</label>
          <select className="form-input" value={form.manager_id} onChange={e => setForm(f => ({ ...f, manager_id: e.target.value }))}>
            <option value="">— не призначено —</option>
            {users.map(u => <option key={u.id} value={u.id}>{userName(u)}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Договір</label>
          <select className="form-input" value={form.contract_id} onChange={e => setForm(f => ({ ...f, contract_id: e.target.value }))} disabled={!form.client_id}>
            <option value="">— без договору —</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{contractLabel(c)}</option>)}
          </select>
          {form.client_id && contracts.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>У клієнта немає договорів — додайте в картці контрагента</span>}
        </div>
        <div className="form-group"><label>Тип закупівлі</label>
          <select className="form-input" value={form.procurement_type} onChange={e => setForm(f => ({ ...f, procurement_type: e.target.value }))}>
            <option value="direct">Пряма закупівля</option>
            <option value="tender">Тендер</option>
          </select>
        </div>
        <div className="form-group"><label>% агентських (від чистого прибутку)</label>
          <input className="form-input" type="number" placeholder="напр. 10" value={form.agent_commission_pct} onChange={e => setForm(f => ({ ...f, agent_commission_pct: e.target.value }))} />
        </div>
        <div className="form-group full">
          <label>Розрахунок інвестора</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 12px', borderRadius: 10, border: `1px solid ${form.in_investor ? '#7C3AED' : 'var(--border)'}`, background: form.in_investor ? 'rgba(124,58,237,.08)' : 'var(--surface)' }}>
            <input type="checkbox" checked={form.in_investor} onChange={e => setForm(f => ({ ...f, in_investor: e.target.checked }))} style={{ width: 18, height: 18 }} />
            <i className="ti ti-diamond-filled" style={{ fontSize: 18, color: form.in_investor ? '#7C3AED' : 'var(--text3)' }} />
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>Врахувати це замовлення в розрахунку «Інвестору» (реальне/підтверджене)</span>
          </label>
        </div>
        {form.procurement_type === 'tender' && (
          <div className="form-group"><label>Ідентифікатор закупівлі</label>
            <input className="form-input" placeholder="напр. UA-2026-01-000000-a" value={form.procurement_id} onChange={e => setForm(f => ({ ...f, procurement_id: e.target.value }))} />
          </div>
        )}
        <div className="form-group"><label>Дата створення заявки</label>
          <input className="form-input" value={o.created_at ? o.created_at.slice(0, 10) : '—'} disabled style={{ background: 'var(--surface2)' }} />
        </div>
        <div className="form-group"><label>Дата закриття заявки</label>
          <input className="form-input" type="date" value={form.closed_at} onChange={e => setForm(f => ({ ...f, closed_at: e.target.value }))} />
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

// ── Зіставлення позицій замовлення з рядками рахунку постачальника (для AI-собівартості) ──
const _normName = s => (s || '').toString().toLowerCase().replace(/[«»"'`]/g, '').replace(/[^0-9a-zа-яіїєґ]+/gi, ' ').replace(/\s+/g, ' ').trim()
const _normSku = s => (s || '').toString().toLowerCase().replace(/[^0-9a-zа-яіїєґ]+/gi, '')
const _tokens = s => { const set = new Set(); _normName(s).split(' ').forEach(t => { if (t.length >= 2) set.add(t) }); return set }
const _jaccard = (a, b) => { if (!a.size || !b.size) return 0; let inter = 0; a.forEach(t => { if (b.has(t)) inter++ }); return inter / (a.size + b.size - inter) }
// Собівартість зберігається в тій самій базі ПДВ, що й ціна рядка (price_includes_vat).
// Ціна з рахунку постачальника може бути в іншій базі — конвертуємо.
const _toCostBasis = (price, supInclVat, rowInclVat, vatRate) => {
  let c = Number(price) || 0; const v = Number(vatRate) || 0
  if (supInclVat && !rowInclVat && v > 0) c = c / (1 + v / 100)        // з ПДВ → без ПДВ
  else if (!supInclVat && rowInclVat && v > 0) c = c * (1 + v / 100)   // без ПДВ → з ПДВ
  return Math.round(c * 100) / 100
}

// ───────── Товари ─────────
// Необов'язкові позиції замовлення. product_id прив'язує до довідника
// (переюз у КП/документах/складі); name — знімок назви.
function ItemsTab({ o, onChange, onDirty }) {
  const { user } = useUser()
  const { active } = useCompany()
  const vatOn = active?.is_vat_payer !== false   // неплатник ПДВ → увесь ПДВ-функціонал вимкнено
  const defVat = vatOn ? 20 : 0
  const [rows, setRows] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiMsg, setAiMsg] = useState(null)
  const [bulkMarkup, setBulkMarkup] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [suppliers, setSuppliers] = useState([])
  const specRef = useRef(null)
  const costRef = useRef(null)
  const tableRef = useRef(null)
  const actionsRef = useRef(null)
  const markDirty = () => { setDirty(true); onDirty?.(true) }

  // Закриття меню «Дії» при кліку поза ним
  useEffect(() => {
    const h = (e) => { if (actionsRef.current && !actionsRef.current.contains(e.target)) setActionsOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // AI-імпорт специфікації (.docx / PDF / фото) → позиції замовлення
  const importSpec = async (files) => {
    if (!files?.length) { setAiMsg('Файл не обрано.'); return }
    setAiLoading(true); setAiMsg(`⏳ Аналізую «${files[0]?.name || 'документ'}»… це може зайняти 10–30 секунд.`)
    try {
      const { priceIncludesVat, items } = await extractOrderItems(Array.from(files))
      if (!items.length) { setAiMsg('Не знайдено товарних позицій у документі. Спробуй інший файл або додай вручну.'); setAiLoading(false); return }
      markDirty()
      setRows(rs => [...(rs || []), ...items.map(it => ({
        product_id: null, name: it.name || '', sku: it.sku || '', unit: it.unit || 'шт',
        qty: Number(it.quantity) || 1, cost_price: 0,
        unit_price: Number(it.unitPrice) || 0,
        vat_rate: vatOn ? (it.vatRate != null ? Number(it.vatRate) : 20) : 0,
        price_includes_vat: !!priceIncludesVat,
        supplier_id: null, supplier_name: null,
      }))])
      setAiMsg(`✅ Додано позицій: ${items.length}. Перевірте ціни й собівартість (напр. «З прайсу»), тоді «Зберегти».`)
    } catch (e) { setAiMsg('⚠️ ' + (e.message || 'Не вдалося розпізнати. Спробуй ще раз.')) }
    setAiLoading(false)
  }

  // AI-собівартість: завантажити рахунок/накладну постачальника → заповнити закупівлю позицій.
  // Зіставляє рядки рахунку з наявними позиціями (за кодом, тоді за назвою) і проставляє cost_price.
  // НЕ додає нових позицій: рахунок може покривати кілька замовлень, тож зайві рядки ігноруються
  // (заповнюємо лише те, що вже є в цьому замовленні).
  const importCosts = async (files) => {
    if (!files?.length) { setAiMsg('Файл не обрано.'); return }
    if (!(rows || []).length) { setAiMsg('Спершу додайте позиції замовлення (вручну, «З прайсу» або «Специфікація (AI)») — тоді рахунок заповнить їхню собівартість.'); return }
    setAiLoading(true); setAiMsg(`⏳ Читаю рахунок постачальника «${files[0]?.name || 'документ'}»… 10–30 секунд.`)
    try {
      const { priceIncludesVat, items } = await extractOrderItems(Array.from(files))
      if (!items.length) { setAiMsg('Не знайдено позицій у рахунку. Спробуйте інший файл.'); setAiLoading(false); return }
      const sup = items.map((it, idx) => ({ ...it, _idx: idx, _sku: _normSku(it.sku), _tok: _tokens(it.name) }))
      const used = new Set()
      const pickBest = (r) => {
        const rsku = _normSku(r.sku)
        if (rsku.length >= 3) { const m = sup.find(s => !used.has(s._idx) && s._sku.length >= 3 && s._sku === rsku); if (m) return m }
        const rtok = _tokens(r.name)
        let best = null, score = 0
        for (const s of sup) { if (used.has(s._idx)) continue; const sc = _jaccard(rtok, s._tok); if (sc > score) { score = sc; best = s } }
        return score >= 0.4 ? best : null
      }
      const cur = rows || []
      let filled = 0
      const nextRows = cur.map(r => {
        const b = pickBest(r); if (!b) return r
        used.add(b._idx); filled++
        return { ...r, cost_price: _toCostBasis(b.unitPrice, priceIncludesVat, !!r.price_includes_vat, Number(r.vat_rate) || Number(b.vatRate) || 20) }
      })
      markDirty()
      setRows(nextRows)
      const notMatched = cur.length - filled
      const extraLines = sup.length - used.size
      setAiMsg(`✅ Рахунок оброблено — заповнено собівартість: ${filled} з ${cur.length}.` +
        (notMatched > 0 ? ` Не знайдено відповідника у рахунку для ${notMatched} позицій.` : '') +
        (extraLines > 0 ? ` Рядків рахунку без пари (можливо, з інших замовлень): ${extraLines} — не додані.` : '') +
        ` Перевірте й «Зберегти».`)
    } catch (e) { setAiMsg('⚠️ ' + (e.message || 'Не вдалося розпізнати рахунок. Спробуй ще раз.')) }
    setAiLoading(false)
  }

  // Імпорт позицій із таблиці Excel/CSV: назва + к-сть (+ опц. код, ціна, од.).
  // Розпізнає заголовки колонок; система додає рядки, ціни/собівартість заповнюються далі.
  const importTable = async (files) => {
    const file = files?.[0]
    if (!file) { setAiMsg('Файл не обрано.'); return }
    setAiMsg(`⏳ Читаю таблицю «${file.name}»…`)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 1251, cellText: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      const norm = s => String(s || '').toLowerCase().trim()
      // рядок заголовків — перший, де є і «назва», і «кількість»
      const hi = aoa.findIndex(row => row.some(c => /назв|наймен|товар|name|product|опис/.test(norm(c))) && row.some(c => /к-?с|кільк|кол-?|qty|quantity/.test(norm(c))))
      const headerRow = hi >= 0 ? aoa[hi] : (aoa[0] || [])
      const idx = { name: -1, qty: -1, sku: -1, price: -1, unit: -1 }
      headerRow.forEach((c, j) => {
        const t = norm(c)
        if (idx.name < 0 && /назв|наймен|товар|name|product|опис/.test(t)) idx.name = j
        else if (idx.qty < 0 && /(к-?с|кільк|кол-?|qty|quantity)/.test(t)) idx.qty = j
        else if (idx.sku < 0 && /(код|артик|sku|part)/.test(t)) idx.sku = j
        else if (idx.price < 0 && /(ціна|price|варт)/.test(t)) idx.price = j
        else if (idx.unit < 0 && /(^од|одиниц|unit|вим)/.test(t)) idx.unit = j
      })
      if (idx.name < 0) idx.name = 0            // фолбек: назва — перша колонка
      const dataStart = hi >= 0 ? hi + 1 : 0
      const pn = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n }
      const items = []
      for (let r = dataStart; r < aoa.length; r++) {
        const row = aoa[r] || []
        const name = String(row[idx.name] || '').trim()
        if (!name || /^(назв|наймен|товар|разом|всього|итого|total)/i.test(name)) continue
        const qty = idx.qty >= 0 ? (pn(row[idx.qty]) || 1) : 1
        items.push({
          product_id: null, name, sku: idx.sku >= 0 ? String(row[idx.sku] || '').trim() : '',
          unit: idx.unit >= 0 ? (String(row[idx.unit] || '').trim() || 'шт') : 'шт',
          qty, cost_price: 0, unit_price: idx.price >= 0 ? pn(row[idx.price]) : 0,
          vat_rate: defVat, price_includes_vat: false, supplier_id: null, supplier_name: null,
        })
      }
      if (!items.length) { setAiMsg('У таблиці не знайдено рядків. Потрібні колонки «Назва» і «К-сть» (перший аркуш).'); return }
      markDirty()
      setRows(rs => [...(rs || []), ...items])
      setAiMsg(`✅ Додано з таблиці: ${items.length}. Заповніть ціни/собівартість («З прайсу», «Собівартість (AI)» або вручну) і «Зберегти».`)
    } catch (e) { setAiMsg('⚠️ Не вдалося прочитати таблицю: ' + (e.message || 'формат не підтримується')) }
  }

  const load = () => supabase.from('order_items').select('*, contractors(name)').eq('order_id', o.id).order('created_at')
    .then(({ data }) => { setRows((data || []).map(r => ({ ...r, supplier_name: r.contractors?.name || null }))); setDirty(false); onDirty?.(false) })
  useEffect(() => { load() }, [o.id])
  useEffect(() => { supabase.from('contractors').select('id, name').eq('is_supplier', true).order('name').then(({ data }) => setSuppliers(data || [])) }, [])
  // Обрати наявного постачальника або створити нового (колонка «Постачальник»)
  const chooseSupplier = async (i, v) => {
    if (v === '__new__') {
      const name = (window.prompt('Назва нового постачальника') || '').trim()
      if (!name) return
      const { data, error } = await supabase.from('contractors').insert({ name, is_supplier: true }).select('id, name').single()
      if (error || !data) { alert('Не вдалося створити постачальника: ' + (error?.message || '')); return }
      setSuppliers(s => [...s, data].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk')))
      setRow(i, { supplier_id: data.id, supplier_name: data.name })
    } else {
      const sup = suppliers.find(s => s.id === v)
      setRow(i, { supplier_id: v || null, supplier_name: sup?.name || null })
    }
  }

  // Попередження про незбережені зміни при оновленні/закритті сторінки
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const setRow = (i, patch) => { markDirty(); setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r)) }
  const addRow = () => { markDirty(); setRows(rs => [...rs, { product_id: null, name: '', sku: '', unit: 'шт', qty: 1, cost_price: 0, unit_price: 0, vat_rate: defVat, price_includes_vat: false, supplier_id: null, supplier_name: null }]) }
  // Підстановка позиції з прайсу: закупівля = ціна прайсу, продаж = роздріб (редагована),
  // запам'ятовуємо постачальника (для авто-формування субзамовлень)
  const addFromPrice = (p) => {
    setShowPicker(false)
    markDirty()
    setRows(rs => [...rs, {
      product_id: null, name: p.name, sku: p.sku || '', unit: p.unit || 'шт', qty: 1,
      cost_price: p.price || 0,
      unit_price: (p.retail_price > 0 ? p.retail_price : p.price) || 0,
      vat_rate: vatOn ? (p.vat_rate != null ? Number(p.vat_rate) : 20) : 0,
      price_includes_vat: vatOn, // ціна з прайсу вже містить ПДВ (для неплатника — без ПДВ)
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
  // Маржа — net-to-net. «Тип ціни = ціна з ПДВ» стосується І продажу, І закупівлі:
  // тоді ПДВ віднімається з обох (собівартість теж введена з ПДВ). Інакше обидві вже net.
  const netCost = (r) => { const c = Number(r.cost_price) || 0; const v = rate(r); return r.price_includes_vat ? (v > 0 ? c / (1 + v / 100) : c) : c }
  const grossCost = (r) => { const c = Number(r.cost_price) || 0; const v = rate(r); return r.price_includes_vat ? c : c * (1 + v / 100) }
  const rowMargin = (r) => (netUnit(r) - netCost(r)) * (Number(r.qty) || 0)
  const marginPct = (r) => { const n = netUnit(r); return n > 0 ? ((n - netCost(r)) / n) * 100 : 0 }
  // Націнка (markup) = (ціна − закупівля) / закупівля. Рахуємо на введених значеннях —
  // співвідношення однакове і для net, і для gross (обидві ціни в тому самому базисі).
  const markupPct = (r) => { const c = Number(r.cost_price) || 0, p = Number(r.unit_price) || 0; return (c > 0 && p > 0) ? ((p - c) / c) * 100 : null }
  const fmtMarkup = (r) => { const v = markupPct(r); if (v == null) return ''; return Math.abs(v % 1) < 0.05 ? String(Math.round(v)) : v.toFixed(1) }
  // Задати ціну продажу з націнки над закупівлею: ціна = закупівля × (1 + %/100)
  const priceFromMarkup = (cost, pct) => Math.round((Number(cost) || 0) * (1 + (Number(pct) || 0) / 100) * 100) / 100
  // Зворотній розрахунок: закупівля = ціна ÷ (1 + %/100)
  const costFromMarkup = (price, pct) => { const d = 1 + (Number(pct) || 0) / 100; return d > 0 ? Math.round((Number(price) || 0) / d * 100) / 100 : 0 }
  // Двобічно: якщо задана закупівля — націнка рахує ціну продажу; якщо задана лише
  // ціна реалізації — націнка рахує закупівлю. (Закупівля має пріоритет, коли є обидві.)
  const setMarkup = (i, val) => {
    const r = rows[i] || {}
    const c = Number(r.cost_price) || 0, p = Number(r.unit_price) || 0
    if (c > 0) setRow(i, { unit_price: priceFromMarkup(c, val) })
    else if (p > 0) setRow(i, { cost_price: costFromMarkup(p, val) })
  }
  const applyBulkMarkup = () => {
    const pct = Number(bulkMarkup)
    if (bulkMarkup === '' || isNaN(pct)) return
    markDirty()
    setRows(rs => rs.map(r => {
      const c = Number(r.cost_price) || 0, p = Number(r.unit_price) || 0
      if (c > 0) return { ...r, unit_price: priceFromMarkup(c, pct) }
      if (p > 0) return { ...r, cost_price: costFromMarkup(p, pct) }
      return r
    }))
  }
  const sum = (rows || []).reduce((s, r) => s + rowTotal(r), 0)         // всього з ПДВ
  const netSum = (rows || []).reduce((s, r) => s + rowNet(r), 0)         // без ПДВ
  const vatSum = sum - netSum                                            // ПДВ
  const marginSum = (rows || []).reduce((s, r) => s + rowMargin(r), 0)
  const costSum = netSum - marginSum                                     // собівартість без ПДВ
  const marginPctTotal = netSum > 0 ? (marginSum / netSum) * 100 : 0

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
    if (resolved.length) await qc('orders').update({ total: sum }).eq('id', o.id)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
    load(); onChange()
  }

  if (rows == null) return <Loading />

  const GRID = vatOn
    ? 'minmax(0,1fr) 52px 88px 88px 58px 86px 96px 104px 150px 28px'
    : 'minmax(0,1fr) 52px 88px 88px 58px 96px 104px 150px 28px'  // без колонки «Тип ціни»
  const HeadCell = ({ children, right }) => <span style={{ textAlign: right ? 'right' : 'left' }}>{children}</span>

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
      {/* Шапка */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid var(--border)', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Позиції</span>
          <span style={{ color: 'var(--text3)', fontSize: 12 }}>{rows.length} шт</span>
          {aiLoading && <span style={{ fontSize: 12, color: 'var(--text3)' }}><i className="ti ti-loader-2" style={{ animation: 'spin 1s linear infinite' }} /> Розпізнаю…</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Націнка на всі позиції">
            <i className="ti ti-percentage" style={{ color: 'var(--text3)', fontSize: 14 }} />
            <input className="form-input" type="number" placeholder="%" value={bulkMarkup} onChange={e => setBulkMarkup(e.target.value)} style={{ width: 54, height: 30, padding: '4px 8px', fontSize: 13 }} />
            <button className="btn" onClick={applyBulkMarkup} style={{ minHeight: 30, padding: '4px 10px', fontSize: 12 }}>на всі</button>
          </div>
          <div style={{ position: 'relative' }} ref={actionsRef}>
            <button className="btn" onClick={() => setActionsOpen(v => !v)} style={{ minHeight: 30, padding: '4px 10px', fontSize: 12 }}><i className="ti ti-dots" /> Дії</button>
            {actionsOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 14px rgba(0,0,0,.1)', zIndex: 50, minWidth: 210, overflow: 'hidden' }}>
                <MenuItem icon="ti-table" label="З таблиці (Excel/CSV)" hint="колонки: Назва, К-сть" onClick={() => { setActionsOpen(false); tableRef.current?.click() }} />
                <MenuItem icon="ti-tag" label="З прайсу" onClick={() => { setActionsOpen(false); setShowPicker(true) }} />
                <MenuItem icon="ti-file-import" label="Специфікація (AI)" hint="договір/специфікація → товари" onClick={() => { setActionsOpen(false); specRef.current?.click() }} />
                <MenuItem icon="ti-receipt-tax" label="Собівартість (AI)" hint="рахунок постачальника → закупівля" onClick={() => { setActionsOpen(false); costRef.current?.click() }} />
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={addRow} style={{ minHeight: 30, padding: '4px 12px', fontSize: 12 }}><i className="ti ti-plus" /> позиція</button>
          <input ref={specRef} type="file" accept=".docx,.pdf,image/*" multiple style={{ display: 'none' }} disabled={aiLoading}
            onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; importSpec(fs) }} />
          <input ref={costRef} type="file" accept=".docx,.pdf,image/*" multiple style={{ display: 'none' }} disabled={aiLoading}
            onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; importCosts(fs) }} />
          <input ref={tableRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; importTable(fs) }} />
        </div>
      </div>

      {aiMsg && <div style={{ fontSize: 12.5, color: 'var(--text2)', background: 'var(--surface2)', padding: '8px 14px', borderBottom: '1px solid var(--border)' }}><i className="ti ti-sparkles" style={{ color: 'var(--blue)' }} /> {aiMsg}</div>}

      {rows.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13, padding: '20px 14px', margin: 0 }}>Позицій немає. Додайте: «+ позиція», «Дії → З прайсу» або AI-імпорт.</p>}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1040 }}>
            {/* Заголовок колонок */}
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '0 8px', padding: '7px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)' }}>
              <HeadCell>Назва / код</HeadCell>
              <HeadCell right>К-сть</HeadCell>
              <HeadCell right>Закупка</HeadCell>
              <HeadCell right>Ціна</HeadCell>
              <HeadCell right>Націнка</HeadCell>
              {vatOn && <HeadCell>Тип ціни</HeadCell>}
              <HeadCell right>Сума</HeadCell>
              <HeadCell right>Маржа</HeadCell>
              <HeadCell>Постачальник</HeadCell>
              <span />
            </div>

            {rows.map((r, i) => {
              const m = rowMargin(r), mp = marginPct(r)
              const mColor = m > 0 ? 'var(--green)' : m < 0 ? 'var(--red)' : 'var(--text3)'
              const noMarkup = !(Number(r.cost_price) > 0 || Number(r.unit_price) > 0)
              const open = !!expanded[i]
              return (
              <div key={i} style={{ borderBottom: '1px solid var(--border)', background: open ? 'var(--surface2)' : undefined }}>
                <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '0 8px', alignItems: 'center', padding: '7px 14px' }}>
                  {/* Назва + код */}
                  <div style={{ minWidth: 0 }}>
                    <ProductSelect className="cell-name" value={r.name} placeholder="Назва товару або артикул"
                      onChange={(name) => setRow(i, { name, product_id: null })}
                      onSelect={(p) => p._new
                        ? setRow(i, { name: p.name, product_id: null })
                        : setRow(i, { name: p.name, product_id: p.id, sku: p.sku || r.sku || '', unit: p.unit || 'шт', cost_price: r.cost_price || p.buy_price || 0, unit_price: r.unit_price || p.sell_price || 0, price_includes_vat: false, supplier_id: null, supplier_name: null })}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 6 }}>
                      <input className="cell-input" value={r.sku || ''} onChange={e => setRow(i, { sku: e.target.value })} placeholder="код" style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)', maxWidth: 170 }} />
                      {r.product_id && <span style={{ fontSize: 10, color: 'var(--green)', whiteSpace: 'nowrap' }}><i className="ti ti-link" /> довідник</span>}
                    </div>
                  </div>
                  <input className="cell-input" type="number" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} />
                  <input className="cell-input" type="number" value={r.cost_price ?? ''} onChange={e => setRow(i, { cost_price: e.target.value })} style={{ color: 'var(--text2)' }} />
                  <input className="cell-input" type="number" value={r.unit_price} onChange={e => setRow(i, { unit_price: e.target.value })} />
                  <input className="cell-input" type="number" placeholder="%" value={fmtMarkup(r)} onChange={e => setMarkup(i, e.target.value)} disabled={noMarkup} title="Націнка над закупівлею" />
                  {vatOn && <select className="cell-input" value={r.price_includes_vat ? '1' : '0'} onChange={e => setRow(i, { price_includes_vat: e.target.value === '1' })} style={{ textAlign: 'left' }} title="«з ПДВ» — ціна вже містить ПДВ; «+ ПДВ» — ПДВ додається зверху">
                    <option value="1">з ПДВ</option><option value="0">+ ПДВ</option>
                  </select>}
                  <span style={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{fmt(rowTotal(r))}</span>
                  <span style={{ textAlign: 'right', color: mColor, fontVariantNumeric: 'tabular-nums', fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmt(m)} · {mp.toFixed(0)}%</span>
                  <select className="cell-input" value={r.supplier_id || ''} onChange={e => chooseSupplier(i, e.target.value)} style={{ textAlign: 'left' }} title="Постачальник позиції (для субзамовлень)">
                    <option value="">— постачальник —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    {r.supplier_id && !suppliers.some(s => s.id === r.supplier_id) && <option value={r.supplier_id}>{r.supplier_name || '—'}</option>}
                    <option value="__new__">＋ новий…</option>
                  </select>
                  <button onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))} title="Деталі позиції" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 0, textAlign: 'right' }}>
                    <i className={`ti ${open ? 'ti-chevron-up' : 'ti-dots'}`} style={{ fontSize: 16 }} />
                  </button>
                </div>
                {/* Розкриті рідкісні поля */}
                {open && (
                  <div style={{ display: 'flex', gap: 14, padding: '0 14px 10px', fontSize: 12, color: 'var(--text2)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>Од.
                      <input className="form-input" value={r.unit || ''} onChange={e => setRow(i, { unit: e.target.value })} style={{ width: 60, height: 30, padding: '4px 8px', fontSize: 12 }} /></label>
                    {vatOn && <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>ПДВ
                      <select className="form-input" value={Number(r.vat_rate) || 0} onChange={e => setRow(i, { vat_rate: Number(e.target.value) })} style={{ width: 66, height: 30, padding: '4px 6px', fontSize: 12 }}>{VAT_RATES.map(v => <option key={v} value={v}>{v}%</option>)}</select></label>}
                    {vatOn && <span>Без ПДВ <b style={{ color: 'var(--text)' }}>{fmt(rowNet(r))}</b></span>}
                    <button onClick={() => removeRow(i)} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12 }}><i className="ti ti-trash" /> прибрати</button>
                  </div>
                )}
              </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Підсумок */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--surface2)', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Metric label="Собівартість" value={fmt(costSum)} />
          {vatOn && <Metric label="Виручка без ПДВ" value={fmt(netSum)} />}
          {vatOn && <Metric label="ПДВ" value={fmt(vatSum)} />}
          <Metric label="Маржа" value={`${fmt(marginSum)} · ${marginPctTotal.toFixed(0)}%`} color={marginSum > 0 ? 'var(--green)' : marginSum < 0 ? 'var(--red)' : 'var(--text3)'} />
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{vatOn ? 'Всього з ПДВ' : 'Всього'}</div>
            <div style={{ fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(sum)} ₴</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
          {rows.length > 0 && (
            <button className="btn" onClick={() => investorReportPdf(o, rows)} title="PDF-розрахунок рентабельності для інвестора">
              <i className="ti ti-chart-pie" /> Розрахунок
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
  const load = () => qc('commercial_proposals').select('*').eq('order_id', o.id).order('version', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [o.id])

  // Нова версія КП префілиться позиціями товарів замовлення (якщо є)
  const startNew = async () => {
    const { data: items } = await supabase.from('order_items').select('name, unit, qty, unit_price, vat_rate, price_includes_vat').eq('order_id', o.id).order('created_at')
    const seed = (items || []).length
      ? items.map(it => ({ name: it.name, unit: it.unit || 'шт', qty: Number(it.qty) || 1, price: Number(it.unit_price) || 0, vat: Number(it.vat_rate) || 0, incl: !!it.price_includes_vat }))
      : [{ name: '', unit: 'шт', qty: 1, price: 0, vat: 20, incl: false }]
    setEditing({ version: (rows[0]?.version || 0) + 1, items: seed })
  }
  // price трактується за i.incl (з прайсу = з ПДВ; вручну/склад = без ПДВ, ПДВ зверху)
  const lineGross = (i) => { const p = (Number(i.qty) || 0) * (Number(i.price) || 0); const v = Number(i.vat) || 0; return i.incl ? p : p * (1 + v / 100) }
  const lineNet = (i) => { const p = (Number(i.qty) || 0) * (Number(i.price) || 0); const v = Number(i.vat) || 0; return i.incl ? (v > 0 ? p / (1 + v / 100) : p) : p }
  const itemsTotal = (items) => items.reduce((s, i) => s + lineGross(i), 0)
  const itemsNet = (items) => items.reduce((s, i) => s + lineNet(i), 0)

  const saveDraft = async () => {
    const total = itemsTotal(editing.items)
    await qc('commercial_proposals')
      .insert(withCompany({ order_id: o.id, version: editing.version, items: editing.items, total, status: 'draft' }))
    setEditing(null); load()
  }
  const send = async (p) => {
    await qc('commercial_proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', p.id)
    if (o.status === 'new') await qc('orders').update({ status: 'processing' }).eq('id', o.id)
    load(); onChange()
  }
  const setStatus = async (p, status) => { await qc('commercial_proposals').update({ status }).eq('id', p.id); load() }
  const delProposal = async (p) => { await qc('commercial_proposals').delete().eq('id', p.id); load() }

  // Переглянути КП у новій вкладці (не зберігається в Документи).
  // price у позиції — з ПДВ; для документа рахуємо ціну без ПДВ за ставкою позиції.
  const [genId, setGenId] = useState(null)
  const previewProposal = async (p) => {
    setGenId(p.id)
    try {
      const { data: c } = await supabase.from('contractors').select('*').eq('id', o.client_id).single()
      // Фолбек одиниці для старих КП, збережених без unit — за назвою з позицій замовлення
      let unitByName = {}
      if ((p.items || []).some(it => !it.unit)) {
        const { data: oi } = await supabase.from('order_items').select('name, unit').eq('order_id', o.id)
        unitByName = Object.fromEntries((oi || []).map(r => [r.name, r.unit]).filter(([, u]) => u))
      }
      const items = (p.items || []).map(it => {
        const price = Number(it.price) || 0, vr = Number(it.vat) || 0
        // КП-шаблон чекає ціну БЕЗ ПДВ: якщо ціна вже з ПДВ — ділимо, якщо ні — лишаємо
        const net = it.incl ? (vr > 0 ? price / (1 + vr / 100) : price) : price
        return { name: it.name, quantity: Number(it.qty) || 0, unit: it.unit || unitByName[it.name] || 'шт', unitPrice: net, vatRate: vr }
      })
      const today = new Date().toISOString().slice(0, 10)
      const opts = { docNumber: `КП-${o.order_number || o.id.slice(0, 6)}`, docDate: today, withStamp: stampCP }
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
              <input className="form-input" placeholder="Од." value={it.unit || ''} onChange={e => setEditing(d => { const items = [...d.items]; items[i] = { ...it, unit: e.target.value }; return { ...d, items } })} style={{ width: 64 }} />
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
          <button className="btn" onClick={() => setEditing(d => ({ ...d, items: [...d.items, { name: '', unit: 'шт', qty: 1, price: 0, vat: 20, incl: false }] }))} style={{ marginBottom: 10 }}><i className="ti ti-plus" /> Позиція</button>
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
  const [showUpload, setShowUpload] = useState(false)
  const [gen, setGen] = useState(null) // { contractor, editDoc }
  const load = async () => {
    const cols = 'id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, source, posted, contractors(name)'
    let { data, error } = await qc('documents').select(cols).eq('order_id', o.id).order('created_at', { ascending: false })
    if (error) ({ data } = await qc('documents').select(cols.replace(', posted', '')).eq('order_id', o.id).order('created_at', { ascending: false })) // фолбек, якщо колонки posted ще нема
    setRows((data || []).filter(d => d.source !== 'generated')) // згенеровані показані окремою секцією
  }
  // Провести / зняти з проведення (додати/прибрати з розділу «Документи»)
  const setPosted = async (d, val) => {
    const { data, error } = await qc('documents').update({ posted: val }).eq('id', d.id).select('id')
    if (error || !data?.length) { alert('Не вдалося: ' + (error?.message || 'запустіть міграцію 038')); return }
    load()
  }
  const loadGen = () => qc('generated_docs').select('*').eq('order_id', o.id).order('created_at', { ascending: false }).then(({ data }) => setGenDocs(data || []))
  useEffect(() => { load(); loadGen() }, [o.id])
  const unlink = async (d) => { await qc('documents').update({ order_id: null }).eq('id', d.id); load() }
  const delGen = async (d) => {
    // Спершу прибрати складські рухи дзеркального документа (FK = SET NULL, тож каскад їх не видалить),
    // потім сам згенерований — каскад (міграція 017) прибере дзеркало в documents.
    const { data: mirror } = await qc('documents').select('id').eq('generated_doc_id', d.id).maybeSingle()
    if (mirror?.id) await qc('stock_movements').delete().eq('document_id', mirror.id).neq('source', 'assembly')
    await qc('generated_docs').delete().eq('id', d.id)
    loadGen()
  }

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
          <button className="btn btn-primary" onClick={() => setShowUpload(true)} title="Завантажити файл (договір, ТТН, акт тощо) у це замовлення"><i className="ti ti-upload" /> Завантажити</button>
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
            <thead><tr><th>Тип</th><th>№</th><th>Файл</th><th style={{ textAlign: 'right' }}>Сума</th><th>Статус</th><th>Дата</th><th /></tr></thead>
            <tbody>
              {rows.map(d => { const draft = d.posted === false; return (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setOpenDoc(d)}>
                  <td>{getDocType(d.type)?.label || d.type || '—'}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{d.doc_number || '—'}</td>
                  <td><div className="trunc">{d.file_name}</div></td>
                  <td style={{ textAlign: 'right' }}>{d.amount ? fmt(d.amount) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {draft
                      ? <button className="btn" title="Провести — додати в розділ «Документи»" onClick={e => { e.stopPropagation(); setPosted(d, true) }} style={{ fontSize: 12, padding: '3px 10px', color: 'var(--amber)' }}><i className="ti ti-file-off" /> Чернетка</button>
                      : <span title="Проведено — у розділі «Документи»" style={{ fontSize: 12, color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={e => { e.stopPropagation(); setPosted(d, false) }}><i className="ti ti-circle-check" /> Проведено</span>}
                  </td>
                  <td>{(d.doc_date || d.created_at || '').slice(0, 10)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn" title="Відв'язати" onClick={e => { e.stopPropagation(); unlink(d) }}><i className="ti ti-unlink" /></button></td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}

      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => { setOpenDoc(null); load() }} />}
      {showUpload && <DocModal user={user} orderId={o.id} autoOcr={false} onClose={() => setShowUpload(false)} onSaved={() => { setShowUpload(false); load() }} />}
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
    let query = qc('documents')
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

  const attach = async (d) => { await qc('documents').update({ order_id: o.id }).eq('id', d.id); onAttached() }

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
    const { data: so } = await qc('supplier_orders').select('*, contractors(name)').eq('order_id', o.id).order('created_at')
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
    await qc('supplier_orders').insert(withCompany({ order_id: o.id, supplier_id: add.supplier_id || null, total: Number(add.total) || 0, payment_delay_days: delay, payment_due_date: due, status: 'new', source: 'manual' }))
    setAdd(null); load()
  }
  const setStatus = async (s, status) => { await qc('supplier_orders').update({ status }).eq('id', s.id); load() }
  const setSupplier = async (s, supplier_id) => { await qc('supplier_orders').update({ supplier_id: supplier_id || null }).eq('id', s.id); load() }
  const del = async (s) => { await qc('supplier_orders').delete().eq('id', s.id); load() }

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
    await qc('supplier_orders').delete().eq('order_id', o.id).eq('source', 'auto')
    for (const key of Object.keys(groups)) {
      const list = groups[key]
      const total = list.reduce((s, it) => s + (Number(it.cost_price) || 0) * (Number(it.qty) || 0), 0)
      const { data: so } = await qc('supplier_orders').insert(withCompany({
        order_id: o.id, supplier_id: key === '__none__' ? null : key, total, status: 'new', source: 'auto',
      })).select('id').single()
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
      const { data: docs } = await qc('documents').select('id').eq('order_id', o.id)
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
    qc('stock_movements').select('id, type, quantity, cost_price, total, date, products(name)').eq('order_id', o.id).order('date', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [o.id])
  if (rows == null) return <Loading />
  if (!rows.length) return <Empty text="Складських рухів за замовленням немає. Списання/оприбуткування — Фаза 6." />
  return <Table head={['Товар', 'Тип', 'К-сть', 'Собівартість', 'Дата']}>
    {rows.map(m => <tr key={m.id}><td><div className="trunc">{m.products?.name}</div></td><td>{m.type === 'in' ? 'Прихід' : 'Видаток'}</td><td style={{ textAlign: 'right' }}>{m.quantity}</td><td style={{ textAlign: 'right' }}>{fmt(m.cost_price || m.total)}</td><td>{m.date}</td></tr>)}
  </Table>
}

// ───────── helpers ─────────
const MenuItem = ({ icon, label, hint, onClick }) => (
  <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, color: 'var(--text)' }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
    <i className={`ti ${icon}`} style={{ fontSize: 16, color: 'var(--text2)' }} />
    <span>{label}{hint && <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)' }}>{hint}</span>}</span>
  </button>
)
const Field = ({ label, width, children }) => (
  <div style={{ width }}>
    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>{label}</div>
    {children}
  </div>
)
const Metric = ({ label, value, strong, color }) => (
  <div>
    <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{label}</div>
    <div style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? 700 : 500, whiteSpace: 'nowrap', color: color || 'var(--text)' }}>{value}</div>
  </div>
)
const Loading = () => <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
const Empty = ({ text }) => <div className="card"><p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>{text}</p></div>
const Table = ({ head, children }) => (
  <div className="card"><div className="tbl-wrap" style={{ border: 'none' }}>
    <table><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
  </div></div>
)

// Портали постачальників: список із кнопкою «Відкрити портал», копіюванням логіна й пароля, формою додавання / зміни.
// Використовується на сторінці «Портали постачальників» (усі) і у вкладці «Портали» картки контрагента (contractorId).
import { useEffect, useState } from 'react'
import { useUser } from '../lib/auth'
import { loadPortals, savePortal, deletePortal, getPortalPassword } from '../lib/portals'
import { Button, Modal, Callout, EmptyState, Menu, useToast } from './ui'
import ContractorSelect from './ui/ContractorSelect'
import './PortalList.css'

const host = (u) => { try { return new URL(u).host.replace(/^www\./, '') } catch { return u } }

export default function PortalList({ contractorId = null, contractorName = '' }) {
  const { user } = useUser()
  const toast = useToast()
  const viewer = user?.role === 'viewer'
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState({})      // id → пароль (показаний)
  const [form, setForm] = useState(null)
  const load = () => { setErr(null); loadPortals(contractorId).then(setRows).catch(e => { setErr(e.message); setRows([]) }) }
  useEffect(load, [contractorId])

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} скопійовано`) }
    catch { toast('Не вдалося скопіювати — виділіть і скопіюйте вручну', { type: 'error' }) }
  }
  const reveal = async (p) => {
    if (shown[p.id] != null) { setShown(s => { const n = { ...s }; delete n[p.id]; return n }); return }
    try { const pw = await getPortalPassword(p.id); setShown(s => ({ ...s, [p.id]: pw })); setTimeout(() => setShown(s => { const n = { ...s }; delete n[p.id]; return n }), 30000) }
    catch (e) { toast(e.message, { type: 'error' }) }
  }
  const copyPw = async (p) => {
    try { const pw = shown[p.id] ?? await getPortalPassword(p.id); await copy(pw, 'Пароль') }
    catch (e) { toast(e.message, { type: 'error' }) }
  }
  const remove = async (p) => { try { await deletePortal(p.id); toast('Портал видалено'); load() } catch (e) { toast(e.message, { type: 'error' }) } }

  const list = (rows || []).filter(p => !q.trim() || `${p.title} ${p.url} ${p.login || ''} ${p.contractors?.name || ''}`.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="ptl">
      <div className="ptl-bar">
        {!contractorId && <input className="form-input" type="search" placeholder="Пошук: назва, сайт, логін, постачальник" aria-label="Пошук порталу" value={q} onChange={e => setQ(e.target.value)} />}
        {!viewer && <Button variant="brand" icon="ti-plus" onClick={() => setForm({ contractor_id: contractorId, cname: contractorName, title: '', url: '', login: '', note: '' })}>Додати портал</Button>}
      </div>
      {err && <Callout tone="danger" title="Не вдалося завантажити." text={err} />}
      {rows == null ? <p className="ptl-muted">Завантаження…</p> : list.length === 0 ? (
        <EmptyState icon="ti-key" title={q ? 'Нічого не знайдено' : 'Порталів ще немає'} text="Додайте посилання, логін і пароль до порталу постачальника — тоді звідси можна перейти на портал однією кнопкою." />
      ) : (
        <ul className="ptl-list">{list.map(p => (
          <li key={p.id} className="ptl-item">
            <div className="ptl-main">
              <b>{p.title}</b>
              <small>{!contractorId && p.contractors?.name ? `${p.contractors.name} · ` : ''}{host(p.url)}</small>
              {p.note && <small className="ptl-note">{p.note}</small>}
            </div>
            <div className="ptl-cred">
              <span className="ptl-k">Логін</span>
              {p.login ? <span className="ptl-v"><code>{p.login}</code><button type="button" className="ptl-ic" onClick={() => copy(p.login, 'Логін')} aria-label={`Скопіювати логін ${p.title}`}><i className="ti ti-copy" aria-hidden="true" /></button></span> : <span className="ptl-muted">—</span>}
              <span className="ptl-k">Пароль</span>
              {p.has_password ? <span className="ptl-v">
                <code>{shown[p.id] != null ? shown[p.id] : '••••••••'}</code>
                {!viewer && <><button type="button" className="ptl-ic" onClick={() => reveal(p)} aria-label={shown[p.id] != null ? 'Сховати пароль' : 'Показати пароль'}><i className={`ti ti-eye${shown[p.id] != null ? '-off' : ''}`} aria-hidden="true" /></button>
                  <button type="button" className="ptl-ic" onClick={() => copyPw(p)} aria-label={`Скопіювати пароль ${p.title}`}><i className="ti ti-copy" aria-hidden="true" /></button></>}
              </span> : <span className="ptl-muted">не задано</span>}
            </div>
            <div className="ptl-acts">
              <a className="btn btn-primary btn-sm" href={p.url} target="_blank" rel="noopener noreferrer"><i className="ti ti-external-link" aria-hidden="true" />Відкрити портал</a>
              {!viewer && <Menu trigger={<Button variant="ghost" size="sm" iconOnly icon="ti-dots" aria-label="Дії з порталом" />} items={[
                { label: 'Змінити', icon: 'ti-pencil', onClick: () => setForm({ ...p, cname: p.contractors?.name || '' }) },
                { label: 'Видалити', icon: 'ti-trash', danger: true, confirm: { title: `Видалити портал «${p.title}»?`, text: 'Посилання, логін і пароль буде видалено.', confirmLabel: 'Видалити' }, onClick: () => remove(p) },
              ]} />}
            </div>
          </li>
        ))}</ul>
      )}
      {form && <PortalForm init={form} lockContractor={!!contractorId} userId={user?.id} onClose={() => setForm(null)} onSaved={() => { setForm(null); load() }} />}
    </div>
  )
}

function PortalForm({ init, lockContractor, userId, onClose, onSaved }) {
  const [f, setF] = useState({ ...init, password: '' })
  const [clear, setClear] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [showPw, setShowPw] = useState(false)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = async () => {
    if (!f.title?.trim()) return setErr('Вкажіть назву')
    if (!f.url?.trim()) return setErr('Вкажіть посилання на портал')
    setBusy(true); setErr(null)
    try {
      const pw = clear ? '' : f.password ? f.password : undefined   // undefined — пароль не змінюємо
      await savePortal(f, pw, userId); onSaved()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={init.id ? 'Портал постачальника' : 'Новий портал'}
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button variant="brand" loading={busy} onClick={save}>Зберегти</Button></>}>
      <div className="ptl-form">
        <label className="ptl-f"><span>Назва</span><input className="form-input" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Напр. ELKO B2B" autoFocus /></label>
        <label className="ptl-f"><span>Посилання на портал</span><input className="form-input" value={f.url} onChange={e => set('url', e.target.value)} placeholder="https://…" inputMode="url" /></label>
        <label className="ptl-f"><span>Постачальник (необов’язково)</span>
          {lockContractor ? <input className="form-input" value={f.cname || ''} disabled />
            : <ContractorSelect value={f.cname || ''} placeholder="Почніть вводити назву" onChange={v => setF(s => ({ ...s, cname: v, contractor_id: null }))} onContractorSelect={c => setF(s => ({ ...s, cname: c.name, contractor_id: c.id }))} />}</label>
        <label className="ptl-f"><span>Логін</span><input className="form-input" value={f.login || ''} onChange={e => set('login', e.target.value)} autoComplete="off" /></label>
        <label className="ptl-f"><span>{init.id && init.has_password ? 'Новий пароль (порожньо — без змін)' : 'Пароль'}</span>
          <span className="ptl-pw"><input className="form-input" type={showPw ? 'text' : 'password'} value={f.password} onChange={e => { set('password', e.target.value); setClear(false) }} autoComplete="new-password" disabled={clear} />
            <button type="button" className="ptl-ic" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Сховати' : 'Показати'}><i className={`ti ti-eye${showPw ? '-off' : ''}`} aria-hidden="true" /></button></span></label>
        {init.id && init.has_password && <label className="ptl-chk"><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} /> Прибрати пароль</label>}
        <label className="ptl-f"><span>Примітка</span><textarea className="form-input" rows={2} value={f.note || ''} onChange={e => set('note', e.target.value)} placeholder="Напр.: двофакторна — код приходить на пошту office@…" /></label>
        <p className="ptl-muted">Пароль зберігається зашифрованим. Бачать і копіюють його всі, крім ролі «перегляд»; кожен перегляд записується в журнал.</p>
        {err && <p className="ptl-err">{err}</p>}
      </div>
    </Modal>
  )
}

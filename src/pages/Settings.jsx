import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { clearCompanyCache } from '../lib/companyConfig'
import { useCompany } from '../lib/company'
import { invalidateCache, PL_ORDER, PL_LABELS } from '../lib/articles'
import { ROLES, ROLE_LABELS, ROLE_HINTS } from '../lib/permissions'

const TABS = [
  { id: 'company', label: 'Реквізити', icon: 'ti-building' },
  { id: 'articles', label: 'Статті P&L', icon: 'ti-tags' },
  { id: 'accounts', label: 'Рахунки', icon: 'ti-wallet' },
  { id: 'users', label: 'Користувачі', icon: 'ti-users' },
]

export default function Settings() {
  const [tab, setTab] = useState('company')
  return (
    <div>
      <div className="page-header"><h1>Налаштування</h1></div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent', color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
          }}><i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />{t.label}</button>
        ))}
      </div>
      {tab === 'company' && <CompanyTab />}
      {tab === 'articles' && <ArticlesTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'users' && <UsersTab />}
    </div>
  )
}

// ───────── Реквізити компанії (активної) ─────────
const CO_FIELDS = [
  { key: 'name', label: 'Повна назва', full: true },
  { key: 'short_name', label: 'Коротка назва (для перемикача)' },
  { key: 'edrpou', label: 'ЄДРПОУ (ТОВ)' },
  { key: 'ipn', label: 'ІПН / РНОКПП' },
  { key: 'address', label: 'Адреса', full: true },
  { key: 'iban', label: 'IBAN', full: true },
  { key: 'bank_name', label: 'Банк' },
  { key: 'mfo', label: 'МФО' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
  { key: 'director', label: 'Директор / ФОП (ПІБ)' },
  { key: 'director_position', label: 'Посада підписанта' },
]
const TAX_GROUPS = [
  ['tov_vat', 'ТОВ — платник ПДВ'], ['tov_single_5', 'ТОВ — 3 група (5%)'],
  ['fop_group2', 'ФОП — 2 група'], ['fop_group3', 'ФОП — 3 група'], ['other', 'Інше'],
]

// Зображення → зменшений PNG dataURL (для лого в документах, pdfmake приймає dataURL)
function fileToLogoDataUrl(file, maxDim = 320) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png')) // PNG зберігає прозорість
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function CompanyTab() {
  const { active, activeId, reload } = useCompany()
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!activeId) { setForm(null); return }
    supabase.from('companies').select('*').eq('id', activeId).maybeSingle().then(({ data }) => setForm(data || null))
  }, [activeId])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const save = async () => {
    if (!form) return
    setBusy(true)
    const { id, created_at, ...upd } = form
    let { error } = await supabase.from('companies').update(upd).eq('id', activeId)
    // logo_base64 може ще не існувати (міграція 043) — зберегти без нього
    if (error && /logo_base64/.test(error.message || '')) {
      const { logo_base64, ...rest } = upd
      ;({ error } = await supabase.from('companies').update(rest).eq('id', activeId))
      if (!error) alert('Реквізити збережено, але лого — запустіть міграцію 043.')
    }
    setBusy(false)
    if (error) { alert('Помилка збереження: ' + error.message); return }
    clearCompanyCache(); reload()
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }
  if (!activeId) return <div className="card"><p style={{ color: 'var(--text3)' }}>Оберіть компанію в перемикачі у шапці.</p></div>
  if (!form) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  return (
    <div className="card">
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        Реквізити компанії <b>{active?.short_name || active?.name}</b> — використовуються при генерації документів.
        Щоб редагувати іншу юрособу, перемкни її в шапці.
      </p>
      <div className="form-grid">
        {CO_FIELDS.map(f => (
          <div className={`form-group ${f.full ? 'full' : ''}`} key={f.key}>
            <label>{f.label}</label>
            <input className="form-input" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
          </div>
        ))}
        <div className="form-group full">
          <label>Логотип для документів</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {form.logo_base64
              ? <img src={form.logo_base64} alt="лого" style={{ height: 48, maxWidth: 200, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, padding: 4, background: '#fff' }} />
              : <span style={{ fontSize: 13, color: 'var(--text3)' }}>Лого не завантажено</span>}
            <label className="btn" style={{ cursor: 'pointer' }}>
              <i className="ti ti-upload" /> Завантажити
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }}
                onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) { try { set('logo_base64', await fileToLogoDataUrl(file)) } catch { alert('Не вдалося зчитати зображення') } } }} />
            </label>
            {form.logo_base64 && <button className="btn" onClick={() => set('logo_base64', null)} style={{ color: 'var(--red)' }}><i className="ti ti-trash" /> Прибрати</button>}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            {active?.edrpou === '45505924'
              ? 'ЕЙМ СКІЛ друкує фірмове лого AiM (це поле для неї не застосовується).'
              : 'Зʼявиться у шапці/футері згенерованих документів цієї юрособи (замість брендингу AiM).'}
          </span>
        </div>
        <div className="form-group">
          <label>Група оподаткування</label>
          <select className="form-input" value={form.tax_group || 'tov_vat'} onChange={e => set('tax_group', e.target.value)}>
            {TAX_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Платник ПДВ</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44 }}>
            <input type="checkbox" checked={!!form.is_vat_payer} onChange={e => set('is_vat_payer', e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 14, color: 'var(--text2)' }}>{form.is_vat_payer ? 'Так' : 'Ні'}</span>
          </div>
        </div>
        <div className="form-group">
          <label>ФОП</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44 }}>
            <input type="checkbox" checked={!!form.is_fop} onChange={e => set('is_fop', e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 14, color: 'var(--text2)' }}>{form.is_fop ? 'Так (без «Директора», підпис ФОП)' : 'Ні'}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Збереження…' : 'Зберегти'}</button>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
      </div>
    </div>
  )
}

// ───────── Статті P&L ─────────
const DIRECTIONS = [['trade', 'Торгівля'], ['service', 'Послуги'], ['agent', 'Агент'], ['general', 'Загальне']]
const PL_LEVELS = PL_ORDER.filter(k => !k.startsWith('_'))

function ArticlesTab() {
  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState({})
  const [saved, setSaved] = useState(false)
  const [adding, setAdding] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('articles').select('*').order('type').order('sort_order')
    setRows(data || []); setDirty({})
  }
  useEffect(() => { load() }, [])

  const edit = (id, field, value) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
    setDirty(d => ({ ...d, [id]: true }))
  }
  const saveAll = async () => {
    for (const r of rows.filter(r => dirty[r.id])) {
      await supabase.from('articles').update({ name: r.name, direction: r.direction, pl_level: r.pl_level, sort_order: Number(r.sort_order) || 0 }).eq('id', r.id)
    }
    invalidateCache(); setSaved(true); setTimeout(() => setSaved(false), 2500); load()
  }
  const del = async (id) => { if (!confirm('Видалити статтю?')) return; await supabase.from('articles').delete().eq('id', id); invalidateCache(); load() }
  const create = async () => {
    if (!adding.name.trim()) return
    await supabase.from('articles').insert({ name: adding.name.trim(), type: adding.type, direction: adding.direction, pl_level: adding.pl_level, sort_order: 999 })
    invalidateCache(); setAdding(null); load()
  }

  const Section = ({ type, label }) => {
    const list = rows.filter(r => r.type === type)
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{label}</div>
          <button className="btn" onClick={() => setAdding({ type, name: '', direction: 'general', pl_level: type === 'income' ? 'revenue' : 'opex' })}><i className="ti ti-plus" /> Додати</button>
        </div>
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead><tr><th>Назва</th><th>Напрямок</th><th>Рівень P&L</th><th style={{ width: 70 }}>Порядок</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id}>
                  <td><input className="form-input" value={r.name || ''} onChange={e => edit(r.id, 'name', e.target.value)} style={{ minWidth: 180 }} /></td>
                  <td><select className="form-input" value={r.direction || 'general'} onChange={e => edit(r.id, 'direction', e.target.value)}>{DIRECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                  <td><select className="form-input" value={r.pl_level || ''} onChange={e => edit(r.id, 'pl_level', e.target.value)}><option value="">—</option>{PL_LEVELS.map(l => <option key={l} value={l}>{PL_LABELS[l]}</option>)}</select></td>
                  <td><input className="form-input" type="number" value={r.sort_order ?? 0} onChange={e => edit(r.id, 'sort_order', e.target.value)} style={{ width: 64 }} /></td>
                  <td><button className="btn" onClick={() => del(r.id)} style={{ padding: '2px 8px' }}><i className="ti ti-trash" /></button></td>
                </tr>
              ))}
              {adding?.type === type && (
                <tr>
                  <td><input className="form-input" autoFocus placeholder="Нова стаття" value={adding.name} onChange={e => setAdding(a => ({ ...a, name: e.target.value }))} /></td>
                  <td><select className="form-input" value={adding.direction} onChange={e => setAdding(a => ({ ...a, direction: e.target.value }))}>{DIRECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                  <td><select className="form-input" value={adding.pl_level} onChange={e => setAdding(a => ({ ...a, pl_level: e.target.value }))}>{PL_LEVELS.map(l => <option key={l} value={l}>{PL_LABELS[l]}</option>)}</select></td>
                  <td colSpan={2}><button className="btn btn-primary" onClick={create}>OK</button> <button className="btn" onClick={() => setAdding(null)}>×</button></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
        <button className="btn btn-primary" onClick={saveAll} disabled={!Object.keys(dirty).length}>Зберегти зміни</button>
      </div>
      <Section type="income" label="Доходи" />
      <Section type="expense" label="Витрати" />
    </div>
  )
}

// ───────── Рахунки ─────────
function AccountsTab() {
  const [rows, setRows] = useState([])
  const [add, setAdd] = useState(null)
  const [edits, setEdits] = useState({}) // id → { opening_balance, opening_balance_date }
  const [savedId, setSavedId] = useState(null)
  const load = () => qc('accounts').select('*').order('sort_order').then(({ data }) => { setRows(data || []); setEdits({}) })
  useEffect(() => { load() }, [])
  const toggle = async (a) => { await qc('accounts').update({ is_active: !a.is_active }).eq('id', a.id); load() }
  const create = async () => {
    if (!add.name.trim()) return
    await qc('accounts').insert(withCompany({ name: add.name.trim(), type: add.type, bank_name: add.bank_name || null, sort_order: rows.length + 1 }))
    setAdd(null); load()
  }
  const setEdit = (id, field, value) => setEdits(e => ({ ...e, [id]: { ...e[id], [field]: value } }))
  const saveOpening = async (a) => {
    const e = edits[a.id] || {}
    await qc('accounts').update({
      opening_balance: Number(e.opening_balance ?? a.opening_balance) || 0,
      opening_balance_date: (e.opening_balance_date ?? a.opening_balance_date) || null,
    }).eq('id', a.id)
    setSavedId(a.id); setTimeout(() => setSavedId(null), 2000); load()
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Рахунки (банк + каса)</div>
        {!add && <button className="btn btn-primary" onClick={() => setAdd({ name: '', type: 'bank', bank_name: '' })}><i className="ti ti-plus" /> Додати</button>}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>Початковий залишок — стартова сума на рахунку станом на вказану дату. Реальний залишок = початковий + рухи від цієї дати.</p>
      {add && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: '1 1 160px' }}><label>Назва</label><input className="form-input" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} /></div>
          <div className="form-group" style={{ width: 120 }}><label>Тип</label><select className="form-input" value={add.type} onChange={e => setAdd(a => ({ ...a, type: e.target.value }))}><option value="bank">Банк</option><option value="cash">Каса</option></select></div>
          <div className="form-group" style={{ flex: '1 1 140px' }}><label>Банк</label><input className="form-input" value={add.bank_name} onChange={e => setAdd(a => ({ ...a, bank_name: e.target.value }))} /></div>
          <button className="btn btn-primary" onClick={create}>Зберегти</button>
          <button className="btn" onClick={() => setAdd(null)}>×</button>
        </div>
      )}
      <div className="tbl-wrap" style={{ border: 'none' }}>
        <table><thead><tr><th>Назва</th><th>Тип</th><th>Початк. залишок</th><th>Станом на</th><th>Статус</th><th></th></tr></thead>
          <tbody>{rows.map(a => (
            <tr key={a.id}>
              <td style={{ fontWeight: 500 }}>{a.name}</td>
              <td>{a.type === 'cash' ? 'Каса' : 'Банк'}</td>
              <td><input className="form-input" type="number" value={edits[a.id]?.opening_balance ?? a.opening_balance ?? 0} onChange={e => setEdit(a.id, 'opening_balance', e.target.value)} style={{ width: 130, textAlign: 'right' }} /></td>
              <td><input className="form-input" type="date" value={edits[a.id]?.opening_balance_date ?? a.opening_balance_date ?? ''} onChange={e => setEdit(a.id, 'opening_balance_date', e.target.value)} style={{ width: 150 }} /></td>
              <td><button className="btn" onClick={() => toggle(a)} style={{ color: a.is_active ? 'var(--green)' : 'var(--text3)' }}>{a.is_active ? 'Активний' : 'Вимкнено'}</button></td>
              <td><button className="btn btn-primary" onClick={() => saveOpening(a)} style={{ padding: '4px 10px' }}>{savedId === a.id ? '✓' : 'Зберегти'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

// ───────── Користувачі ─────────
function UsersTab() {
  const { user } = useUser()
  const [rows, setRows] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'manager' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const isAdmin = (user?.role === 'admin')
  const load = () => supabase.from('profiles').select('*').then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  const setRole = async (id, role) => {
    const { data, error } = await supabase.from('profiles').update({ role }).eq('id', id).select('id')
    if (error || !data?.length) { alert('Не вдалося змінити роль' + (error ? ': ' + error.message : '. Немає прав (RLS) — запустіть міграцію 035.')); load(); return }
    setRows(rs => rs.map(r => r.id === id ? { ...r, role } : r))
  }
  const createUser = async () => {
    setMsg(null)
    if (!form.email || !form.password) { setMsg('Вкажіть email і пароль'); return }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(form),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Помилка створення')
      setAdding(false); setForm({ email: '', password: '', full_name: '', role: 'manager' })
      load()
    } catch (e) { setMsg(e.message) }
    setBusy(false)
  }
  return (
    <div className="card">
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Користувачі</div>
          {!adding && <button className="btn btn-primary" onClick={() => { setMsg(null); setAdding(true) }}><i className="ti ti-user-plus" /> Додати користувача</button>}
        </div>
      )}

      {adding && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div className="form-grid">
            <div className="form-group"><label>Email *</label><input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="person@company.com" /></div>
            <div className="form-group"><label>Пароль * (мін. 6)</label><input className="form-input" type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="тимчасовий пароль" /></div>
            <div className="form-group"><label>Ім'я</label><input className="form-input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Іван Іванов" /></div>
            <div className="form-group"><label>Роль</label>
              <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
          </div>
          {msg && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={createUser} disabled={busy}>{busy ? '…' : 'Створити'}</button>
            <button className="btn" onClick={() => { setAdding(false); setMsg(null) }} disabled={busy}>Скасувати</button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>Акаунт створюється одразу (без листа-підтвердження). Передайте користувачу email і пароль — він зможе увійти й змінити пароль.</p>
        </div>
      )}

      <div className="tbl-wrap" style={{ border: 'none' }}>
        <table><thead><tr><th>Email</th><th>Ім'я</th><th>Роль</th><th>Доступ</th></tr></thead>
          <tbody>{rows.map(u => (
            <tr key={u.id}><td>{u.email}</td><td>{u.full_name || '—'}</td>
              <td><select className="form-input" value={u.role || 'viewer'} onChange={e => setRole(u.id, e.target.value)} disabled={u.id === user?.id} style={{ width: 180, padding: '4px 8px', fontSize: 13 }}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select></td>
              <td style={{ fontSize: 12, color: 'var(--text3)' }}>{ROLE_HINTS[u.role || 'viewer']}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 12, lineHeight: 1.6 }}>
        <b style={{ color: 'var(--text2)' }}>Ролі й доступ до розділів:</b>
        {ROLES.map(r => <div key={r}><b>{ROLE_LABELS[r]}</b> — {ROLE_HINTS[r]}</div>)}
        <div style={{ marginTop: 6 }}>Самореєстрація вимкнена — акаунти створює лише адміністратор («Додати користувача»). Свою роль змінити не можна.</div>
      </div>
    </div>
  )
}

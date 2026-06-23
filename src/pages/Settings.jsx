import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { COMPANY_FIELDS, getCompany, saveCompany } from '../lib/companyConfig'
import { invalidateCache, PL_ORDER, PL_LABELS } from '../lib/articles'

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

// ───────── Реквізити ─────────
function CompanyTab() {
  const [form, setForm] = useState({})
  const [saved, setSaved] = useState(false)
  useEffect(() => { getCompany().then(setForm) }, [])
  const save = async () => { await saveCompany(form); setSaved(true); setTimeout(() => setSaved(false), 2500) }
  return (
    <div className="card">
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>Реквізити компанії-продавця — використовуються при генерації документів.</p>
      <div className="form-grid">
        {COMPANY_FIELDS.map(f => (
          <div className={`form-group ${f.full ? 'full' : ''}`} key={f.key}>
            <label>{f.label}</label>
            <input className="form-input" value={form[f.key] || ''} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))} />
          </div>
        ))}
        <div className="form-group">
          <label>Платник ПДВ</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44 }}>
            <input type="checkbox" checked={form.isVatPayer || false} onChange={e => setForm(s => ({ ...s, isVatPayer: e.target.checked }))} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 14, color: 'var(--text2)' }}>{form.isVatPayer ? 'Так' : 'Ні'}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save}>Зберегти</button>
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
  const load = () => supabase.from('accounts').select('*').order('sort_order').then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  const toggle = async (a) => { await supabase.from('accounts').update({ is_active: !a.is_active }).eq('id', a.id); load() }
  const create = async () => {
    if (!add.name.trim()) return
    await supabase.from('accounts').insert({ name: add.name.trim(), type: add.type, bank_name: add.bank_name || null, sort_order: rows.length + 1 })
    setAdd(null); load()
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Рахунки (банк + каса)</div>
        {!add && <button className="btn btn-primary" onClick={() => setAdd({ name: '', type: 'bank', bank_name: '' })}><i className="ti ti-plus" /> Додати</button>}
      </div>
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
        <table><thead><tr><th>Назва</th><th>Тип</th><th>Банк</th><th>Статус</th></tr></thead>
          <tbody>{rows.map(a => (
            <tr key={a.id}><td style={{ fontWeight: 500 }}>{a.name}</td><td>{a.type === 'cash' ? 'Каса' : 'Банк'}</td><td style={{ color: 'var(--text2)' }}>{a.bank_name || '—'}</td>
              <td><button className="btn" onClick={() => toggle(a)} style={{ color: a.is_active ? 'var(--green)' : 'var(--text3)' }}>{a.is_active ? 'Активний' : 'Вимкнено'}</button></td></tr>
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
  const load = () => supabase.from('profiles').select('*').then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  const setRole = async (id, role) => { await supabase.from('profiles').update({ role }).eq('id', id); setRows(rs => rs.map(r => r.id === id ? { ...r, role } : r)) }
  return (
    <div className="card">
      <div className="tbl-wrap" style={{ border: 'none' }}>
        <table><thead><tr><th>Email</th><th>Ім'я</th><th>Роль</th></tr></thead>
          <tbody>{rows.map(u => (
            <tr key={u.id}><td>{u.email}</td><td>{u.full_name || '—'}</td>
              <td><select className="form-input" value={u.role || 'viewer'} onChange={e => setRole(u.id, e.target.value)} disabled={u.id === user?.id} style={{ width: 150, padding: '4px 8px', fontSize: 13 }}>
                {['admin', 'accountant', 'manager', 'viewer'].map(r => <option key={r} value={r}>{r}</option>)}
              </select></td></tr>
          ))}</tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>Усі ролі (admin/accountant/manager) мають повний доступ до модулів (per ТЗ).</p>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { clearCompanyCache } from '../lib/companyConfig'
import { useCompany } from '../lib/company'
import { invalidateCache, PL_ORDER, PL_LABELS } from '../lib/articles'
import { ROLES, ROLE_LABELS, ROLE_HINTS } from '../lib/permissions'
import { useNewUi } from '../lib/uiPrefs'
import SettingsNew from './SettingsNew'
import { InfoTip } from '../components/ui'

const TABS = [
  { id: 'company', label: 'Реквізити', icon: 'ti-building' },
  { id: 'articles', label: 'Статті P&L', icon: 'ti-tags' },
  { id: 'accounts', label: 'Рахунки', icon: 'ti-wallet' },
  { id: 'users', label: 'Користувачі', icon: 'ti-users' },
]

export default function Settings() {
  const [tab, setTab] = useState('company')
  const newUi = useNewUi()
  if (newUi) return <SettingsNew CompanyTab={CompanyTab} UsersTab={UsersTab} />
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
// Дизайн (тема) згенерованих документів
const DOC_THEMES = [
  ['', 'Авто (за компанією)'],
  ['clean', 'Класичний лист (реквізити внизу)'],
  ['bit', 'BIT Group (індиго, tech)'],
  ['aim', 'AiM (фірмовий зелений)'],
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

function CompanyTab({ newUi = false } = {}) {
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
    // logo_base64 / doc_theme можуть ще не існувати (міграції 043/044) — зберегти без них
    if (error && /(logo_base64|doc_theme)/.test(error.message || '')) {
      const { logo_base64, doc_theme, ...rest } = upd
      ;({ error } = await supabase.from('companies').update(rest).eq('id', activeId))
      if (!error) alert('Реквізити збережено, але лого/дизайн — запустіть міграції 043/044.')
    }
    setBusy(false)
    if (error) { alert('Помилка збереження: ' + error.message); return }
    clearCompanyCache(); reload()
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }
  if (!activeId) return <div className="card"><p style={{ color: 'var(--text3)' }}>Оберіть компанію в перемикачі у шапці.</p></div>
  if (!form) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  // Новий інтерфейс (макет Settings, ТЗ 5.6): картки; податки — чипи груп, «платник ПДВ» і «ФОП» визначаються з групи
  if (newUi) {
    const inp = (key, label, cls = '') => (
      <div className={`form-group ${cls}`} key={key}><label htmlFor={`co-${key}`}>{label}</label>
        <input id={`co-${key}`} className="form-input" value={form[key] || ''} onChange={e => set(key, e.target.value)} /></div>
    )
    const TAX_HINT = { tov_vat: '20% ПДВ', tov_single_5: '5% від доходу', fop_group2: 'фікс. податок', fop_group3: '5% від доходу', other: 'вручну' }
    const TAX_FLAGS = { tov_vat: [true, false], tov_single_5: [false, false], fop_group2: [false, true], fop_group3: [false, true] }
    const pickTax = (g) => setForm(f => ({ ...f, tax_group: g, ...(TAX_FLAGS[g] ? { is_vat_payer: TAX_FLAGS[g][0], is_fop: TAX_FLAGS[g][1] } : {}) }))
    const tg = form.tax_group || 'tov_vat'
    const THEME_TONE = { '': 'auto', clean: 'clean', bit: 'bit', aim: 'aim' }
    return (
      <div className="stn-co-form">
        <section className="cfn-card">
          <div className="stn-card-h"><h2>Юридичні дані<InfoTip label="Юридичні дані">Потрапляють у шапку накладних, актів і рахунків цієї юрособи. Іншу юрособу оберіть карткою вгорі.</InfoTip></h2></div>
          <div className="stn-grid">
            {inp('name', 'Повна назва', 'is-full')}
            {inp('short_name', 'Коротка назва')}{inp('edrpou', 'ЄДРПОУ')}{inp('ipn', 'ІПН / РНОКПП')}
            {inp('address', 'Адреса', 'is-full')}
            {inp('director', form.is_fop ? 'ФОП (ПІБ)' : 'Директор / підписант')}{inp('director_position', 'Посада')}{inp('phone', 'Телефон')}
            {inp('email', 'Email')}
          </div>
        </section>
        <section className="cfn-card">
          <div className="stn-card-h"><h2>Банк для документів</h2></div>
          <div className="stn-grid is-bank">{inp('iban', 'IBAN')}{inp('bank_name', 'Банк')}{inp('mfo', 'МФО')}</div>
        </section>
        <section className="cfn-card">
          <div className="stn-card-h"><h2>Податки<InfoTip label="Податки">Платник ПДВ: ціни в документах з ПДВ 20%, а вхідний ПДВ від платників іде в кредит. ФОП: у документах підпис ФОП, без «Директора». Окремі перемикачі «Платник ПДВ» і «ФОП» не потрібні — система визначає це з групи.</InfoTip></h2></div>
          <div className="stn-tax" role="radiogroup" aria-label="Група оподаткування">
            {TAX_GROUPS.map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={tg === v} onClick={() => pickTax(v)}>
                <b>{l.replace(' — ', ' · ').replace(' (5%)', '')}</b><small>{TAX_HINT[v]}</small></button>))}
          </div>
          {TAX_FLAGS[tg] && (!!form.is_vat_payer !== TAX_FLAGS[tg][0] || !!form.is_fop !== TAX_FLAGS[tg][1]) && (
            <p className="stn-warn">Група й позначки не збігаються: зараз {form.is_vat_payer ? 'платник ПДВ' : 'не платник ПДВ'}{form.is_fop ? ', ФОП' : ''}. Натисніть потрібну групу — позначки узгодяться, потім «Зберегти».</p>)}
          {tg === 'other'
            ? <div className="stn-tax-flags">
                <label><input type="checkbox" checked={!!form.is_vat_payer} onChange={e => set('is_vat_payer', e.target.checked)} /> Платник ПДВ</label>
                <label><input type="checkbox" checked={!!form.is_fop} onChange={e => set('is_fop', e.target.checked)} /> ФОП (без «Директора», підпис ФОП)</label>
              </div>
            : null}
        </section>
        <section className="cfn-card">
          <div className="stn-card-h"><h2>Вигляд документів<InfoTip label="Вигляд документів">{active?.edrpou === '45505924' ? 'Ейм Скіл друкує фірмове лого AiM — поле «Лого» для неї не застосовується.' : 'Лого з’явиться у шапці згенерованих документів цієї юрособи.'}</InfoTip></h2></div>
          <div className="stn-themes" role="radiogroup" aria-label="Дизайн документів">
            {DOC_THEMES.map(([v, l]) => (
              <button key={v || 'auto'} type="button" role="radio" aria-checked={(form.doc_theme || '') === v} className={`is-${THEME_TONE[v]}`} onClick={() => set('doc_theme', v || null)}>
                <span className="stn-sheet" aria-hidden="true"><i /><em /><em /><em /><u /></span><b>{l.replace(/ \(.*\)$/, '')}</b></button>))}
          </div>
          <div className="stn-logo">
            {form.logo_base64 ? <img src={form.logo_base64} alt="Лого для документів" /> : <span className="rpt-muted">Лого не завантажено</span>}
            <label className="btn btn-secondary btn-sm"><i className="ti ti-upload" aria-hidden="true" /> Завантажити лого
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden
                onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) { try { set('logo_base64', await fileToLogoDataUrl(file)) } catch { alert('Не вдалося зчитати зображення') } } }} /></label>
            {form.logo_base64 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('logo_base64', null)}>Прибрати</button>}
          </div>
        </section>
        <div className="stn-save">{saved && <span className="stn-ok">Збережено</span>}<button type="button" className="btn btn-brand" onClick={save} disabled={busy}>{busy ? 'Збереження…' : 'Зберегти'}</button></div>
      </div>
    )
  }
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
          <label>Дизайн документів</label>
          <select className="form-input" value={form.doc_theme || ''} onChange={e => set('doc_theme', e.target.value || null)}>
            {DOC_THEMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
          <button className="btn" onClick={() => setAdding({ type, name: '', direction: 'general', pl_level: type === 'income' ? 'revenue' : type === 'expense' ? 'opex' : '' })}><i className="ti ti-plus" /> Додати</button>
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
                  <td><select className="form-input" value={adding.pl_level} onChange={e => setAdding(a => ({ ...a, pl_level: e.target.value }))}><option value="">—</option>{PL_LEVELS.map(l => <option key={l} value={l}>{PL_LABELS[l]}</option>)}</select></td>
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
      <Section type="transfer" label="Перекази / ПФД" />
      <Section type="other" label="Інше" />
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
function UsersTab({ newUi = false } = {}) {
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
  const addForm = adding && (
    <div className="stn-add">
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
      {msg && <div className="stn-err">{msg}</div>}
      <div className="stn-add-acts">
        <button className="btn btn-primary" onClick={createUser} disabled={busy}>{busy ? '…' : 'Створити'}</button>
        <button className="btn" onClick={() => { setAdding(false); setMsg(null) }} disabled={busy}>Скасувати</button>
      </div>

    </div>
  )
  // Новий інтерфейс (макет SettingsUsers): «Команда» — аватар, ім'я, «це ви», email, роль
  if (newUi) {
    const ini = (u) => (u.full_name || u.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()
    return <>
      <section className="cfn-card stn-team-head">
        <div><h2>Команда · {rows.length} {rows.length === 1 ? 'людина' : rows.length < 5 ? 'людини' : 'людей'}<InfoTip label="Команда">Самореєстрація вимкнена: акаунти створює лише адміністратор — одразу, без листа-підтвердження; передайте людині email і пароль. Свою роль змінити не можна.</InfoTip></h2>
          </div>
        {isAdmin && !adding && <button type="button" className="btn btn-primary" onClick={() => { setMsg(null); setAdding(true) }}><i className="ti ti-plus" aria-hidden="true" /> Запросити</button>}
      </section>
      {addForm && <section className="cfn-card">{addForm}</section>}
      <section className="cfn-card stn-team">
        <ul>{rows.map(u => (
          <li key={u.id}>
            <span className={`stn-av${u.role === 'admin' ? ' is-admin' : ''}`} aria-hidden="true">{ini(u)}</span>
            <span className="stn-who"><b>{u.full_name || u.email}{u.id === user?.id && <small> · це ви</small>}</b><span>{u.email}</span></span>
            <select className="stn-role" aria-label={`Роль: ${u.full_name || u.email}`} value={u.role || 'viewer'} onChange={e => setRole(u.id, e.target.value)} disabled={u.id === user?.id} title={ROLE_HINTS[u.role || 'viewer']}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </li>))}</ul>
      </section>
    </>
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

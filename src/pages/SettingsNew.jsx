// «Налаштування» — новий інтерфейс (ТЗ редизайну 5.6; макети Settings*). Збереження — ті самі запити, що й раніше.
// Статті: групи за рівнем P&L, порядок перетягуванням (або ↑/↓), правка в «⋯», «Об'єднати» (merge_articles, міграція 101:
// пробний запуск → підтвердження; закриті місяці не чіпає; лише адміністратор/бухгалтер — перевіряє сервер).
// Поле «Напрямок» прибрано з інтерфейсу (помилка 11, рішення власника); дані в БД лишаються.
// Матриця «розділ × роль» — лише перегляд (права поки не змінюємо).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { useCompany } from '../lib/company'
import { useUser } from '../lib/auth'
import { invalidateCache, PL_ORDER, PL_LABELS } from '../lib/articles'
import { ROLES, ROLE_LABELS, ROLE_SECTIONS } from '../lib/permissions'
import { getAccountBalances } from '../lib/accounts'
import { formatAmount, plural } from '../utils/format'
import { Button, Modal, Menu, Callout, TableSkeleton, useToast, useTabParam } from '../components/ui'
import './Reports.css'
import './AnalyticsNew.css'
import './SettingsNew.css'

const n0 = (v) => formatAmount(v, { decimals: 0 })
const dmy = (s) => s ? s.split('-').reverse().join('.') : '—'
const SECTIONS = [
  { id: 'company', label: 'Компанії групи', hint: 'Юрособи, реквізити, податки, вигляд документів', icon: 'ti-building' },
  { id: 'articles', label: 'Статті P&L', hint: 'Групи, порядок, об\'єднання дублів', icon: 'ti-tags' },
  { id: 'accounts', label: 'Рахунки', hint: 'Банки й каса, початкові залишки', icon: 'ti-wallet' },
  { id: 'users', label: 'Користувачі', hint: 'Ролі й доступ до розділів', icon: 'ti-users' },
]

export default function SettingsNew({ CompanyTab, UsersTab }) {
  const [tab, setTab] = useTabParam('company', SECTIONS.map(s => s.id))
  return (
    <div className="rpt-page stn">
      <div><h1 className="rpt-h1">Налаштування</h1></div>
      <div className="stn-body">
        <nav className="stn-nav" aria-label="Розділи налаштувань">
          {SECTIONS.map(s => (
            <button key={s.id} type="button" aria-current={tab === s.id ? 'page' : undefined} onClick={() => setTab(s.id)}>
              <i className={`ti ${s.icon}`} aria-hidden="true" /><span><b>{s.label}</b><small>{s.hint}</small></span>
            </button>
          ))}
        </nav>
        <div className="stn-main">
          {tab === 'company' && <CompaniesSection CompanyTab={CompanyTab} />}
          {tab === 'articles' && <ArticlesSection />}
          {tab === 'accounts' && <AccountsSection />}
          {tab === 'users' && <><UsersTab /><RoleMatrix /></>}
        </div>
      </div>
    </div>
  )
}

// ── Компанії групи: картки юросіб (вибір тут), нижче — реквізити обраної ──
function CompaniesSection({ CompanyTab }) {
  const { companies, activeId, setActiveCompany } = useCompany()
  return (
    <div className="stn-col">
      <div className="stn-cos">
        {(companies || []).map(c => (
          <button key={c.id} type="button" className="stn-co" aria-pressed={c.id === activeId} onClick={() => setActiveCompany(c.id)}>
            <span className="stn-co-av" aria-hidden="true">{(c.short_name || c.name || '?').replace(/[«»"ТОВФОП ]/g, '').slice(0, 2).toUpperCase()}</span>
            <span><b>{c.short_name || c.name}</b><small>{c.edrpou ? `ЄДРПОУ ${c.edrpou}` : c.ipn ? `ІПН ${c.ipn}` : '—'}{c.is_vat_payer ? ' · платник ПДВ' : ''}</small></span>
          </button>
        ))}
      </div>
      <CompanyTab />
    </div>
  )
}

// ── Статті P&L ──
const GROUPS = [...PL_ORDER.filter(k => !k.startsWith('_')), '_none']
const groupOf = (a) => a.pl_level && PL_ORDER.includes(a.pl_level) ? a.pl_level : '_none'
const TYPE_LABEL = { income: 'дохід', expense: 'витрата', transfer: 'переказ / ПФД', other: 'інше' }

function ArticlesSection() {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [drag, setDrag] = useState(null)
  const [edit, setEdit] = useState(null)
  const [merge, setMerge] = useState(null)
  const load = async () => { const { data } = await supabase.from('articles').select('*').order('sort_order'); setRows(data || []) }
  useEffect(() => { load() }, [])
  const byGroup = useMemo(() => Object.fromEntries(GROUPS.map(g => [g, (rows || []).filter(a => groupOf(a) === g).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))])), [rows])

  // новий порядок у групі → sort_order 10, 20, 30… (зберігаємо лише змінені)
  const reorder = async (g, list) => {
    const upd = list.map((a, i) => ({ id: a.id, sort_order: (i + 1) * 10 })).filter(u => (rows.find(r => r.id === u.id)?.sort_order) !== u.sort_order)
    setRows(rs => rs.map(r => { const u = upd.find(x => x.id === r.id); return u ? { ...r, sort_order: u.sort_order } : r }))
    for (const u of upd) { const { error } = await supabase.from('articles').update({ sort_order: u.sort_order }).eq('id', u.id); if (error) { toast(error.message, { type: 'error' }); load(); return } }
    invalidateCache()
  }
  const move = (g, id, dir) => { const l = [...byGroup[g]]; const i = l.findIndex(a => a.id === id), j = i + dir; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; reorder(g, l) }
  const drop = (g, targetId) => {
    if (!drag || drag.g !== g || drag.id === targetId) return setDrag(null)
    const l = byGroup[g].filter(a => a.id !== drag.id); const i = l.findIndex(a => a.id === targetId)
    l.splice(i, 0, byGroup[g].find(a => a.id === drag.id)); setDrag(null); reorder(g, l)
  }
  const del = async (a) => {
    const { count } = await supabase.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('article_id', a.id)
    if (count) return toast(`У статті «${a.name}» є ${count} ${plural(count, ['операція', 'операції', 'операцій'])} — спершу об'єднайте її з іншою.`, { type: 'error' })
    const { error } = await supabase.from('articles').delete().eq('id', a.id)
    if (error) return toast(error.message, { type: 'error' })
    invalidateCache(); toast(`Статтю «${a.name}» видалено`); load()
  }

  if (!rows) return <TableSkeleton rows={10} cols={3} label="Завантаження статей…" />
  return (
    <div className="stn-col">
      <div className="stn-bar"><p className="rpt-sub">Порядок у групі — перетягуванням (або стрілками). Правка, об'єднання й видалення — у меню «⋯».</p>
        <Button variant="primary" icon="ti-plus" onClick={() => setEdit({ name: '', type: 'expense', pl_level: 'opex' })}>Нова стаття</Button></div>
      {GROUPS.map(g => byGroup[g].length > 0 && (
        <section key={g} className="cfn-card stn-group" aria-label={g === '_none' ? 'Поза P&L' : PL_LABELS[g]}>
          <h2>{g === '_none' ? 'Поза P&L' : PL_LABELS[g]} <small>{byGroup[g].length}</small></h2>
          <ul>
            {byGroup[g].map((a, i) => (
              <li key={a.id} draggable onDragStart={() => setDrag({ g, id: a.id })} onDragOver={e => e.preventDefault()} onDrop={() => drop(g, a.id)}
                className={drag?.id === a.id ? 'is-drag' : ''}>
                <i className="ti ti-grip-vertical stn-grip" aria-hidden="true" />
                <span className="stn-a-name">{a.name}<small>{TYPE_LABEL[a.type] || a.type}</small></span>
                <span className="stn-arrows">
                  <Button variant="ghost" size="sm" iconOnly icon="ti-arrow-up" aria-label={`Вище: ${a.name}`} disabled={i === 0} onClick={() => move(g, a.id, -1)} />
                  <Button variant="ghost" size="sm" iconOnly icon="ti-arrow-down" aria-label={`Нижче: ${a.name}`} disabled={i === byGroup[g].length - 1} onClick={() => move(g, a.id, 1)} />
                </span>
                <Menu trigger={<Button variant="ghost" size="sm" iconOnly icon="ti-dots" aria-label={`Дії: ${a.name}`} />} items={[
                  { label: 'Змінити', icon: 'ti-pencil', onClick: () => setEdit({ ...a }) },
                  { label: 'Об\'єднати з іншою…', icon: 'ti-arrows-join', onClick: () => setMerge({ from: a }) },
                  { divider: true },
                  { label: 'Видалити', icon: 'ti-trash', danger: true, confirm: { title: `Видалити статтю «${a.name}»?`, text: 'Можна лише якщо в ній немає операцій.', confirmLabel: 'Видалити' }, onClick: () => del(a) },
                ]} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {edit && <ArticleForm init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); invalidateCache(); load() }} />}
      {merge && <MergeDialog from={merge.from} articles={rows} onClose={() => setMerge(null)} onDone={() => { setMerge(null); invalidateCache(); load() }} />}
    </div>
  )
}

function ArticleForm({ init, onClose, onSaved }) {
  const [f, setF] = useState(init)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!f.name?.trim()) return setErr('Вкажіть назву')
    setBusy(true)
    const row = { name: f.name.trim(), type: f.type, pl_level: f.pl_level || null }
    const { error } = f.id ? await supabase.from('articles').update(row).eq('id', f.id) : await supabase.from('articles').insert({ ...row, direction: 'general', sort_order: 999 })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }
  return (
    <Modal open title={f.id ? 'Стаття' : 'Нова стаття'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button variant="primary" icon="ti-check" loading={busy} onClick={save}>Зберегти</Button></>}>
      <div className="form-grid">
        <div className="form-group full"><label>Назва *</label><input className="form-input" value={f.name || ''} onChange={e => setF(s => ({ ...s, name: e.target.value }))} autoFocus /></div>
        <div className="form-group"><label>Тип</label><select className="form-input" value={f.type} onChange={e => setF(s => ({ ...s, type: e.target.value }))} disabled={!!f.id}>{Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="form-group"><label>Рівень P&L</label><select className="form-input" value={f.pl_level || ''} onChange={e => setF(s => ({ ...s, pl_level: e.target.value }))}><option value="">Поза P&L</option>{PL_ORDER.filter(k => !k.startsWith('_')).map(l => <option key={l} value={l}>{PL_LABELS[l]}</option>)}</select></div>
      </div>
      {f.id && <p className="rpt-muted rpt-note">Нова назва підставиться в усі операції, плани й контрагентів (так працює база з міграції 090).</p>}
      {err && <p className="rpt-late">{err}</p>}
    </Modal>
  )
}

function MergeDialog({ from, articles, onClose, onDone }) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [dry, setDry] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const options = articles.filter(a => a.id !== from.id && a.type === from.type).sort((a, b) => a.name.localeCompare(b.name, 'uk'))
  const run = async (apply) => {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('merge_articles', { p_from: from.id, p_to: to, p_apply: apply })
    setBusy(false)
    if (error) return setErr(/merge_articles/.test(error.message) && /function|exist/i.test(error.message) ? 'Потрібна міграція 101.' : error.message.replace(/^ARTICLE_MERGE_\w+:\s*/, ''))
    if (!apply) return setDry(data)
    toast(`Перенесено ${data.move} ${plural(data.move, ['операцію', 'операції', 'операцій'])} у «${data.to}»`)
    onDone()
  }
  return (
    <Modal open title={`Об'єднати «${from.name}»`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button>
        {!dry ? <Button variant="primary" icon="ti-eye" disabled={!to} loading={busy} onClick={() => run(false)}>Показати, що зміниться</Button>
          : <Button variant="primary" icon="ti-arrows-join" disabled={!dry.move && !dry.contractors} loading={busy} onClick={() => run(true)}>Перенести</Button>}</>}>
      <div className="form-group"><label>Перенести операції в статтю</label>
        <select className="form-input" value={to} onChange={e => { setTo(e.target.value); setDry(null) }}><option value="">— оберіть —</option>{options.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      {dry && (
        <div className="stn-dry">
          <p><b>{dry.move} {plural(dry.move, ['операція', 'операції', 'операцій'])}</b> на {n0(dry.move_sum)} ₴ переїде з «{dry.from}» у «{dry.to}»{dry.contractors ? `; у ${dry.contractors} ${plural(dry.contractors, ['контрагента', 'контрагентів', 'контрагентів'])} зміниться стаття за замовчуванням` : ''}.</p>
          {dry.left_in_closed > 0 && <Callout tone="warn" title={`${dry.left_in_closed} ${plural(dry.left_in_closed, ['операція', 'операції', 'операцій'])} у закритих місяцях лишаться як є`} text="— звіти закритих місяців не змінюються. Стаття-джерело залишиться, доки в ній є такі операції." />}
          {dry.months?.length > 0 && <ul className="stn-months">{dry.months.map(m => <li key={m.month}><span>{m.month.split('-').reverse().join('.')}{m.closed ? ' · закритий' : ''}</span><b>{m.n} · {n0(m.sum)} ₴</b></li>)}</ul>}
        </div>
      )}
      {err && <p className="rpt-late">{err}</p>}
    </Modal>
  )
}

// ── Рахунки: картки з початковим залишком і датою старту; попередження, коли дати старту розходяться (помилка 6) ──
function AccountsSection() {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [bal, setBal] = useState({})
  const [edit, setEdit] = useState(null)
  const load = () => {
    qc('accounts').select('*').order('sort_order').then(({ data }) => setRows(data || []))
    getAccountBalances().then(l => setBal(Object.fromEntries(l.map(a => [a.id, a.balance])))).catch(() => {})
  }
  useEffect(load, [])
  if (!rows) return <TableSkeleton rows={4} cols={3} label="Завантаження рахунків…" />
  const dates = rows.filter(a => a.is_active !== false && a.opening_balance_date).map(a => a.opening_balance_date).sort()
  const spread = dates.length > 1 ? Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000) : 0
  const late = rows.filter(a => a.is_active !== false && a.opening_balance_date && a.opening_balance_date > dates[0])
  const save = async () => {
    const { error } = edit.id
      ? await qc('accounts').update({ name: edit.name, bank_name: edit.bank_name || null, opening_balance: Number(edit.opening_balance) || 0, opening_balance_date: edit.opening_balance_date || null }).eq('id', edit.id)
      : await qc('accounts').insert(withCompany({ name: edit.name.trim(), type: edit.type, bank_name: edit.bank_name || null, opening_balance: Number(edit.opening_balance) || 0, opening_balance_date: edit.opening_balance_date || null, sort_order: rows.length + 1 }))
    if (error) return toast(error.message, { type: 'error' })
    setEdit(null); load()
  }
  return (
    <div className="stn-col">
      <div className="stn-bar"><p className="rpt-sub">Залишок = початковий + рухи від дати старту.</p><Button variant="primary" icon="ti-plus" onClick={() => setEdit({ name: '', type: 'bank', bank_name: '', opening_balance: 0, opening_balance_date: '' })}>Додати рахунок</Button></div>
      {spread > 60 && <Callout tone="warn" title="Дати старту рахунків сильно розходяться."
        text={`${late.map(a => `«${a.name}» стартує ${dmy(a.opening_balance_date)}`).join(', ')}, а найраніший рахунок — ${dmy(dates[0])} (різниця ${spread} дн.). Рухи до дати старту не враховуються, тож залишок групи на ранні місяці неповний. Звірте початкові залишки.`} />}
      <div className="stn-accs">
        {rows.map(a => (
          <div key={a.id} className={`cfn-card stn-acc${a.is_active === false ? ' is-off' : ''}`}>
            <div className="stn-acc-h"><i className={`ti ${a.type === 'cash' ? 'ti-cash' : 'ti-building-bank'}`} aria-hidden="true" /><b>{a.name}</b>
              <Menu trigger={<Button variant="ghost" size="sm" iconOnly icon="ti-dots" aria-label={`Дії: ${a.name}`} />} items={[
                { label: 'Змінити', icon: 'ti-pencil', onClick: () => setEdit({ ...a }) },
                { label: a.is_active === false ? 'Увімкнути' : 'Вимкнути', icon: a.is_active === false ? 'ti-eye' : 'ti-eye-off', onClick: () => qc('accounts').update({ is_active: a.is_active === false }).eq('id', a.id).then(load) },
              ]} /></div>
            <span className="rpt-muted">{a.type === 'cash' ? 'Каса' : a.bank_name || 'Банк'}{a.is_active === false ? ' · вимкнено' : ''}</span>
            <div className="stn-acc-b"><small>Зараз</small><b className={bal[a.id] < 0 ? 'rpt-late' : ''}>{bal[a.id] == null ? '…' : `${n0(bal[a.id])} ₴`}</b></div>
            <div className={`stn-acc-s${late.includes(a) && spread > 60 ? ' is-warn' : ''}`}>Старт {dmy(a.opening_balance_date)} · {n0(a.opening_balance || 0)} ₴</div>
          </div>
        ))}
      </div>
      {edit && (
        <Modal open title={edit.id ? edit.name : 'Новий рахунок'} onClose={() => setEdit(null)}
          footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Скасувати</Button><Button variant="primary" icon="ti-check" disabled={!edit.name?.trim()} onClick={save}>Зберегти</Button></>}>
          <div className="form-grid">
            <div className="form-group"><label>Назва *</label><input className="form-input" value={edit.name} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} /></div>
            {!edit.id && <div className="form-group"><label>Тип</label><select className="form-input" value={edit.type} onChange={e => setEdit(s => ({ ...s, type: e.target.value }))}><option value="bank">Банк</option><option value="cash">Каса</option></select></div>}
            <div className="form-group"><label>Банк</label><input className="form-input" value={edit.bank_name || ''} onChange={e => setEdit(s => ({ ...s, bank_name: e.target.value }))} /></div>
            <div className="form-group"><label>Початковий залишок, ₴</label><input className="form-input" inputMode="decimal" value={edit.opening_balance ?? 0} onChange={e => setEdit(s => ({ ...s, opening_balance: e.target.value }))} /></div>
            <div className="form-group"><label>Станом на</label><input className="form-input" type="date" value={edit.opening_balance_date || ''} onChange={e => setEdit(s => ({ ...s, opening_balance_date: e.target.value }))} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Матриця «розділ × роль» — лише перегляд ──
const SECTION_LABELS = { orders: 'Замовлення', tasks: 'Задачі', contractors: 'Контрагенти', bank: 'Банк / Каса', inventory: 'Склад', prices: 'Прайси', documents: 'Документи',
  analytics: 'Аналітика', investor: 'Інвестору', finance: 'Фінрезультат проєкту', loans: 'Поворотна фін. допомога', forecast: 'Прогноз', receivables: 'Звіти: дебіторка',
  cashflow: 'Звіт по статтях', accountant: 'Звіти: для бухгалтера', profitability: 'Звіти: прибутковість', 'period-close': 'Закриття періоду', settings: 'Налаштування' }
function RoleMatrix() {
  return (
    <section className="cfn-card stn-matrix" aria-label="Доступ до розділів">
      <h2>Доступ до розділів</h2>
      <p className="rpt-muted rpt-note">Поки лише перегляд — змінювати доступи будемо окремо.</p>
      <div className="tbl-wrap rpt-table"><table>
        <thead><tr><th>Розділ</th>{ROLES.map(r => <th key={r} className="c">{ROLE_LABELS[r]}</th>)}</tr></thead>
        <tbody>{Object.keys(SECTION_LABELS).map(k => (
          <tr key={k}><td>{SECTION_LABELS[k]}</td>{ROLES.map(r => { const on = (ROLE_SECTIONS[r] || []).includes(k); return <td key={r} className="c">{on ? <i className="ti ti-check stn-yes" aria-label="є доступ" /> : <span className="stn-no" aria-label="немає">—</span>}</td> })}</tr>
        ))}</tbody>
      </table></div>
    </section>
  )
}

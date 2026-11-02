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
import { Button, Modal, Menu, Callout, TableSkeleton, useToast, useTabParam, InfoTip } from '../components/ui'
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
  const [mOpen, setMOpen] = useState(() => /[?&]tab=/.test(window.location.hash))   // телефон: спершу список розділів (макет SettingsMobile), потім розділ
  const cur = SECTIONS.find(s => s.id === tab)
  return (
    <div className="rpt-page stn">
      <div className="stn-top">
        {mOpen && <button type="button" className="stn-back" onClick={() => setMOpen(false)} aria-label="До розділів налаштувань"><i className="ti ti-arrow-left" aria-hidden="true" /></button>}
        <h1 className="rpt-h1">{mOpen ? <span className="stn-h-sm">{cur?.label}</span> : null}<span className={mOpen ? 'stn-h-lg' : ''}>Налаштування</span></h1>
      </div>
      <div className={`stn-body${mOpen ? ' is-open' : ''}`}>
        <nav className="stn-nav" aria-label="Розділи налаштувань">
          {SECTIONS.map(s => (
            <button key={s.id} type="button" aria-current={tab === s.id ? 'page' : undefined} onClick={() => { setTab(s.id); setMOpen(true) }}>
              <i className={`ti ${s.icon}`} aria-hidden="true" /><span><b>{s.label}</b><small>{s.hint}</small></span><i className="ti ti-chevron-right stn-chev" aria-hidden="true" />
            </button>
          ))}
        </nav>
        <div className="stn-main">
          {tab === 'company' && <CompaniesSection CompanyTab={CompanyTab} />}
          {tab === 'articles' && <ArticlesSection />}
          {tab === 'accounts' && <AccountsSection />}
          {tab === 'users' && <><UsersTab newUi /><RoleMatrix /></>}
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
            <span><b>{c.short_name || c.name}</b><small>{c.edrpou ? `ЄДРПОУ ${c.edrpou}` : c.ipn ? `ІПН ${c.ipn}` : '—'}{c.is_vat_payer ? ' · платник ПДВ' : ''}</small>
              {/* «заповнено» — є все, що потрапляє в шапку документів */}
              {(() => { const ok = c.name && (c.edrpou || c.ipn) && c.address && c.iban && c.director; return <em className={`stn-co-st${ok ? ' is-ok' : ''}`}>{ok ? 'заповнено' : 'перевірити'}</em> })()}</span>
          </button>
        ))}
      </div>
      <CompanyTab newUi />
    </div>
  )
}

// ── Статті P&L ──
const GROUPS = [...PL_ORDER.filter(k => !k.startsWith('_')), '_none']
const groupOf = (a) => a.pl_level && PL_ORDER.includes(a.pl_level) ? a.pl_level : '_none'
// «Схожі статті» (макет SettingsArticles): у межах групи назви збігаються за змістовним словом
// або одна містить іншу (без «інші / інше»). Лише підказка — об'єднання вручну через «⋯ → Об'єднати».
const GENERIC = new Set(['інші', 'інше', 'інших', 'виручка', 'податки', 'пфд', 'витрати', 'доходи', 'оплата', 'послуги', 'товари', 'за', 'з', 'на', 'та', 'і', 'нами', 'повернено', 'надано', 'отримано', 'для'])
const words = (n) => String(n || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9 ]+/gi, ' ').split(/\s+/).filter(w => w.length > 1)
function similarIds(list) {
  const out = new Map()
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = words(list[i].name).filter(w => !['інші', 'інше', 'інших'].includes(w)), b = words(list[j].name).filter(w => !['інші', 'інше', 'інших'].includes(w))
    const sub = a.length && b.length && (a.every(w => b.includes(w)) || b.every(w => a.includes(w)))
    const share = a.some(w => !GENERIC.has(w) && b.includes(w))
    if (sub || share) { out.set(list[i].id, list[i]); out.set(list[j].id, list[j]) }
  }
  return out
}
const GROUP_NOTE = { revenue: 'перший рядок P&L', cogs: 'прямі витрати на замовлення', opex: 'витрати компанії', other_income: 'не від основної діяльності', below_line: 'податки й обов’язкові платежі', _none: 'рух грошей без впливу на прибуток: у Cash Flow і Балансі' }
const plain = (l) => String(l || '').replace(/\s*\([^)]*\)\s*$/, '')
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

  const similar = useMemo(() => new Map(GROUPS.flatMap(g => [...similarIds(byGroup[g] || [])])), [byGroup])
  const simGroups = useMemo(() => GROUPS.map(g => (byGroup[g] || []).filter(a => similar.has(a.id))).filter(l => l.length > 1), [byGroup, similar])
  if (!rows) return <TableSkeleton rows={10} cols={3} label="Завантаження статей…" />
  return (
    <div className="stn-col">
      <section className="cfn-card stn-plan">
        <h2>План статей<InfoTip label="План статей">Згруповано так, як статті складаються в P&L: зверху вниз від виручки до податків. Порядок у групі — перетягуванням або стрілками; правка, об’єднання й видалення — у меню «⋯».</InfoTip></h2>
        <Button variant="primary" icon="ti-plus" onClick={() => setEdit({ name: '', type: 'expense', pl_level: 'opex' })}>Нова стаття</Button>
      </section>
      {simGroups.length > 0 && (
        <div className="stn-similar" role="note"><i className="ti ti-alert-triangle" aria-hidden="true" />
          <span><b>Схожі статті:</b> {simGroups.map(l => l.map(a => `«${a.name}»`).join(', ')).join('; а також ')}. Через це однакові витрати розносяться по різних статтях. Можна об'єднати через «⋯ → Об'єднати з іншою» — транзакції перейдуть на одну статтю.</span></div>
      )}
      {GROUPS.map(g => byGroup[g].length > 0 && (
        <section key={g} className="cfn-card stn-group" aria-label={g === '_none' ? 'Поза P&L' : PL_LABELS[g]}>
          <h2><i className={`stn-gdot is-${g.replace('_', '')}`} aria-hidden="true" />{g === '_none' ? 'Поза P&L' : plain(PL_LABELS[g])}<InfoTip label={g === '_none' ? 'Поза P&L' : plain(PL_LABELS[g])}>{GROUP_NOTE[g][0].toUpperCase() + GROUP_NOTE[g].slice(1)}.</InfoTip><span className="stn-gcount">{byGroup[g].length} {plural(byGroup[g].length, ['стаття', 'статті', 'статей'])}</span></h2>
          <ul>
            {byGroup[g].map((a, i) => (
              <li key={a.id} draggable onDragStart={() => setDrag({ g, id: a.id })} onDragOver={e => e.preventDefault()} onDrop={() => drop(g, a.id)}
                className={drag?.id === a.id ? 'is-drag' : ''}>
                <i className="ti ti-grip-vertical stn-grip" aria-hidden="true" />
                <span className="stn-a-name">{a.name}<small>{TYPE_LABEL[a.type] || a.type}</small></span>
                {similar.has(a.id) && <span className="stn-sim">схожа</span>}
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
  const [ob, setOb] = useState({})   // правки початкового залишку прямо в картці: id → { opening_balance, opening_balance_date }
  const { active } = useCompany()
  const load = () => {
    setOb({})
    qc('accounts').select('*').order('sort_order').then(({ data }) => setRows(data || []))
    getAccountBalances().then(l => setBal(Object.fromEntries(l.map(a => [a.id, a.balance])))).catch(() => {})
  }
  useEffect(load, [])
  if (!rows) return <TableSkeleton rows={4} cols={3} label="Завантаження рахунків…" />
  const dates = rows.filter(a => a.is_active !== false && a.opening_balance_date).map(a => a.opening_balance_date).sort()
  const spread = dates.length > 1 ? Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000) : 0
  const late = rows.filter(a => a.is_active !== false && a.opening_balance_date && a.opening_balance_date > dates[0])
  const save = async () => {
    const iban = String(edit.iban || '').replace(/\s/g, '').toUpperCase() || null
    if (iban && !/^UA\d{27}$/.test(iban)) return toast('IBAN має бути у форматі UA + 27 цифр', { type: 'error' })
    const base = { name: edit.name.trim(), bank_name: edit.bank_name || null, opening_balance: Number(edit.opening_balance) || 0, opening_balance_date: edit.opening_balance_date || null }
    const run = (row) => edit.id ? qc('accounts').update(row).eq('id', edit.id) : qc('accounts').insert(withCompany({ ...row, type: edit.type, sort_order: rows.length + 1 }))
    let { error } = await run({ ...base, iban })
    if (error && /iban/.test(error.message || '')) {   // до міграції 108
      if (iban) return toast('Щоб зберегти IBAN, запустіть міграцію 108', { type: 'error' })
      ;({ error } = await run(base))
    }
    if (error) return toast(error.message, { type: 'error' })
    setEdit(null); load()
  }
  return (
    <div className="stn-col">
      <section className="cfn-card stn-team-head">
        <div><h2>Рахунки {active?.short_name || active?.name || ''}<InfoTip label="Рахунки">Залишок зараз = початковий залишок + усі рухи після дати старту.</InfoTip></h2></div>
        <Button variant="primary" icon="ti-plus" onClick={() => setEdit({ name: '', type: 'bank', bank_name: '', opening_balance: 0, opening_balance_date: '' })}>Рахунок або каса</Button>
      </section>
      <MonoCard companyId={active?.id} accounts={rows} onSynced={load} />
      {spread > 60 && <Callout tone="warn" title="Дати старту рахунків сильно розходяться."
        text={`${late.map(a => `«${a.name}» стартує ${dmy(a.opening_balance_date)}`).join(', ')}, а найраніший рахунок — ${dmy(dates[0])} (різниця ${spread} дн.). Рухи до дати старту не враховуються, тож залишок групи на ранні місяці неповний. Звірте початкові залишки.`} />}
      <div className="stn-accs">
        {rows.map(a => (
          <div key={a.id} className={`cfn-card stn-acc${a.is_active === false ? ' is-off' : ''}`}>
            <div className="stn-acc-h">
              <span className={`stn-acc-av${a.type === 'cash' ? ' is-cash' : ''}`} aria-hidden="true">{a.type === 'cash' ? '₴' : (a.name || '?').replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ]/g, '').slice(0, 2).toUpperCase()}</span>
              <span className="stn-acc-t"><b>{a.name}</b><small>{a.type === 'cash' ? 'Каса' : `Банк${a.bank_name ? ' · ' + a.bank_name : ''}${a.iban ? ' · …' + a.iban.slice(-6) : ''}`}</small></span>
              <em className={`stn-co-st${a.is_active === false ? '' : ' is-ok'}`}>{a.is_active === false ? 'вимкнено' : 'активний'}</em>
              <Menu trigger={<Button variant="ghost" size="sm" iconOnly icon="ti-dots" aria-label={`Дії: ${a.name}`} />} items={[
                { label: 'Змінити', icon: 'ti-pencil', onClick: () => setEdit({ ...a }) },
                { label: a.is_active === false ? 'Увімкнути' : 'Вимкнути', icon: a.is_active === false ? 'ti-eye' : 'ti-eye-off', onClick: () => qc('accounts').update({ is_active: a.is_active === false }).eq('id', a.id).then(load) },
              ]} /></div>
            <div className="stn-acc-b"><small>Зараз</small><b className={bal[a.id] < 0 ? 'rpt-late' : ''}>{bal[a.id] == null ? '…' : `${n0(bal[a.id])} ₴`}</b></div>
            <div className="stn-acc-ob">
              <label><span>Початковий залишок<InfoTip label="Початковий залишок">Стартова сума на рахунку станом на вказану дату. Реальний залишок = початковий + рухи від цієї дати.</InfoTip></span><input className="form-input" inputMode="decimal" value={ob[a.id]?.opening_balance ?? a.opening_balance ?? 0}
                onChange={e => setOb(o => ({ ...o, [a.id]: { ...o[a.id], opening_balance: e.target.value } }))} /></label>
              <label><span>Станом на</span><input className="form-input" type="date" value={ob[a.id]?.opening_balance_date ?? a.opening_balance_date ?? ''}
                onChange={e => setOb(o => ({ ...o, [a.id]: { ...o[a.id], opening_balance_date: e.target.value } }))} /></label>
            </div>
            {ob[a.id] && <div className="stn-acc-save">
              <Button size="sm" variant="secondary" onClick={() => setOb(o => { const n = { ...o }; delete n[a.id]; return n })}>Скасувати</Button>
              <Button size="sm" variant="brand" icon="ti-check" onClick={async () => {
                const e = ob[a.id]
                const { error } = await qc('accounts').update({ opening_balance: Number(String(e.opening_balance ?? a.opening_balance ?? 0).replace(/\s/g, '').replace(',', '.')) || 0, opening_balance_date: (e.opening_balance_date ?? a.opening_balance_date) || null }).eq('id', a.id)
                if (error) return toast(error.message, { type: 'error' })
                toast('Початковий залишок збережено'); load()
              }}>Зберегти</Button></div>}
            {late.includes(a) && spread > 60 && <div className="stn-acc-s is-warn">Дата старту {dmy(a.opening_balance_date)} пізніша, ніж у найранішого рахунку ({dmy(dates[0])}) — рухи до неї в залишок не потрапляють.</div>}
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
            {(edit.type || 'bank') === 'bank' && <div className="form-group full"><label>IBAN<InfoTip label="IBAN">Потрібен для автоматичної виписки monobank: операції потрапляють на рахунок із тим самим IBAN.</InfoTip></label><input className="form-input" value={edit.iban || ''} placeholder="UA…" onChange={e => setEdit(s => ({ ...s, iban: e.target.value }))} /></div>}
            <div className="form-group"><label>Початковий залишок, ₴</label><input className="form-input" inputMode="decimal" value={edit.opening_balance ?? 0} onChange={e => setEdit(s => ({ ...s, opening_balance: e.target.value }))} /></div>
            <div className="form-group"><label>Станом на</label><input className="form-input" type="date" value={edit.opening_balance_date || ''} onChange={e => setEdit(s => ({ ...s, opening_balance_date: e.target.value }))} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── monobank: автоматична виписка (міграція 108, api/mono-sync) ──
function MonoCard({ companyId, accounts, onSynced }) {
  const { user } = useUser()
  const toast = useToast()
  const canEdit = ['admin', 'accountant'].includes(user?.role)
  const [has, setHas] = useState(null)       // токен задано?
  const [missing, setMissing] = useState(false)
  const [tok, setTok] = useState('')
  const [edit, setEdit] = useState(false)
  const [from, setFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [last, setLast] = useState(null)
  const load = () => {
    if (!companyId) return
    supabase.rpc('mono_token_set', { p_company: companyId }).then(({ data, error }) => { if (error) { setMissing(true); setHas(false) } else setHas(!!data) })
    supabase.from('bank_sync_log').select('at, added, skipped, error, account_id').eq('company_id', companyId).order('at', { ascending: false }).limit(6).then(({ data }) => setLog(data || []))
  }
  useEffect(load, [companyId])
  const saveTok = async (value) => {
    const { error } = await supabase.rpc('set_mono_token', { p_company: companyId, p_token: value })
    if (error) return toast(/MONO_FORBIDDEN/.test(error.message) ? 'Лише адміністратор або бухгалтер' : error.message, { type: 'error' })
    setTok(''); setEdit(false); toast(value ? 'Токен monobank збережено' : 'Токен прибрано'); load()
  }
  const sync = async () => {
    setBusy(true); setLast(null)
    try {
      const { data: s } = await supabase.auth.getSession()
      const r = await fetch('/api/mono-sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.session?.access_token || ''}` }, body: JSON.stringify({ company_id: companyId, from: from || undefined }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Помилка ${r.status}`)
      const rep = j.results?.[0] || {}
      if (rep.error) throw new Error(rep.error)
      setLast(rep); toast(`Додано операцій: ${rep.added || 0}${rep.skipped ? `, пропущено (вже є): ${rep.skipped}` : ''}`)
      onSynced?.(); load()
    } catch (e) { toast('monobank: ' + e.message, { type: 'error' }) }
    setBusy(false)
  }
  const monoAccs = (accounts || []).filter(a => a.type !== 'cash' && /mono/i.test(a.bank_name || ''))
  const withIban = (accounts || []).filter(a => a.iban)
  const accName = (id) => (accounts || []).find(a => a.id === id)?.name || '—'
  return (
    <section className="cfn-card stn-mono" aria-label="Автоматична виписка monobank">
      <div className="stn-mono-h">
        <div><h2>monobank — автоматична виписка<InfoTip label="monobank API">Операції з рахунків юрособи в monobank підтягуються щогодини (і кнопкою «Синхронізувати зараз») у «Банк» — непідтвердженими, як після імпорту файлу. Дублі пропускаються. Рахунки зіставляються за IBAN.<br />Токен створюється у web.monobank.ua → «Токени» для цієї компанії. Він зберігається лише на сервері.</InfoTip></h2>
          <small className="stn-mono-st">{missing ? 'Потрібна міграція 108' : has == null ? '…' : has ? '● Токен задано' : '○ Токен не задано'}{withIban.length ? ` · рахунків з IBAN: ${withIban.length}` : ''}</small></div>
        {canEdit && !missing && (has && !edit
          ? <div className="stn-mono-acts"><Button size="sm" variant="secondary" onClick={() => setEdit(true)}>Змінити токен</Button><Button size="sm" variant="ghost" onClick={() => saveTok('')}>Прибрати</Button></div>
          : <div className="stn-mono-tok"><input className="form-input" type="password" autoComplete="off" placeholder="Токен API monobank" aria-label="Токен API monobank" value={tok} onChange={e => setTok(e.target.value)} />
              <Button size="sm" variant="brand" disabled={!tok.trim()} onClick={() => saveTok(tok.trim())}>Зберегти</Button>{edit && <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Скасувати</Button>}</div>)}
      </div>
      {has && monoAccs.some(a => !a.iban) && <Callout tone="warn" title="Вкажіть IBAN рахунків monobank." text={`${monoAccs.filter(a => !a.iban).map(a => `«${a.name}»`).join(', ')} — без IBAN операції не потраплять на рахунок. «⋯ → Змінити» у картці рахунку.`} />}
      {has && <div className="stn-mono-sync">
        <label><span>Завантажити з дати (необов’язково)</span><input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        {canEdit && <Button variant="primary" icon="ti-refresh" loading={busy} onClick={sync}>Синхронізувати зараз</Button>}
        <small className="stn-mono-st">Без дати — з останньої синхронізації (перший раз — за 30 днів).</small>
      </div>}
      {last?.accounts?.length > 0 && <ul className="stn-mono-res">{last.accounts.map((a, i) => <li key={i}><b>{a.account || a.iban}</b> — {a.skipped && typeof a.skipped === 'string' ? a.skipped : `додано ${a.added}, вже були ${a.skipped}${a.error ? ` · помилка: ${a.error}` : ''}`}</li>)}</ul>}
      {log.length > 0 && <details className="stn-mono-log"><summary>Останні синхронізації</summary><ul>{log.map((l, i) => <li key={i}>{new Date(l.at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })} · {accName(l.account_id)} · {l.error ? <span className="rpt-late">{l.error}</span> : `+${l.added}, пропущено ${l.skipped}`}</li>)}</ul></details>}
    </section>
  )
}

// ── Матриця «розділ × роль» — лише перегляд ──
const SECTION_LABELS = { orders: 'Замовлення', tasks: 'Задачі', contractors: 'Контрагенти', bank: 'Банк / Каса', inventory: 'Склад', prices: 'Прайси', documents: 'Документи',
  analytics: 'Аналітика', investor: 'Інвестору', finance: 'Фінрезультат проєкту', loans: 'Поворотна фін. допомога', forecast: 'Прогноз', receivables: 'Звіти: дебіторка',
  cashflow: 'Звіт по статтях', accountant: 'Звіти: для бухгалтера', profitability: 'Звіти: прибутковість', 'period-close': 'Закриття періоду', settings: 'Налаштування' }
function RoleMatrix() {
  return (
    <section className="cfn-card stn-matrix" aria-label="Доступ до розділів">
      <div className="stn-mx-h"><h2>Хто що бачить<InfoTip label="Хто що бачить">Поки лише перегляд — змінювати доступи будемо окремо. «Інвестору» бачить лише адміністратор.</InfoTip></h2><span className="rpt-muted rpt-note"><i className="stn-dot" aria-hidden="true" /> є доступ</span></div>
      <div className="tbl-wrap rpt-table"><table>
        <thead><tr><th>Розділ</th>{ROLES.map(r => <th key={r} className="c">{ROLE_LABELS[r]}</th>)}</tr></thead>
        <tbody>{Object.keys(SECTION_LABELS).map(k => (
          <tr key={k}><td>{SECTION_LABELS[k]}</td>{ROLES.map(r => { const on = (ROLE_SECTIONS[r] || []).includes(k); return <td key={r} className="c">{on ? <i className="stn-dot" role="img" aria-label="є доступ" /> : <span className="stn-no" aria-label="немає">—</span>}</td> })}</tr>
        ))}</tbody>
      </table></div>
    </section>
  )
}

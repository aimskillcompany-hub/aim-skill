// «Прогноз → Платіжний календар» (ТЗ 04; макет PayCalendar). Залишок грошей по днях, найглибший касовий розрив і що з ним робити.
// Рядки — ті самі, що в «Угодах в роботі» (loadForecast); стартовий залишок — currentCashByCompany. Розрахунки — lib/payCalendar.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUser } from '../lib/auth'
import { useCompany } from '../lib/company'
import { loadForecast, currentCashByCompany } from '../lib/forecast'
import { buildCalendar, findPossiblyPaid, linkPaidPair, pairKey, GROUPS, addDaysIso } from '../lib/payCalendar'
import { createTask } from '../lib/tasks'
import { findSupplierDocPays, linkSupplierDocPay } from '../lib/supplierDocPays'
import { todayKyiv } from '../lib/dates'
import { formatAmount, plural } from '../utils/format'
import { Button, Modal, Segmented, Callout, TableSkeleton, InfoTip, useToast } from './ui'
import './PayCalendar.css'

const n0 = (v) => formatAmount(v, { decimals: 0 })
const sg = (v) => formatAmount(v, { decimals: 0, sign: 'always' })
const MG = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']
const MS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру']
const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const pd = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return { y, m: m - 1, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() } }
const dLong = (s) => { const x = pd(s); return `${x.d} ${MG[x.m]}` }
const dShort = (s) => { const x = pd(s); return `${x.d} ${MS[x.m]}` }
const dmy = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const nums = (list) => list.map(n => '№' + n).join(', ')

export function usePayCalendarCo() {
  const [qs, setQs] = useSearchParams()
  const co = qs.get('co') || 'all'
  const setCo = (v) => setQs(p => { const n = new URLSearchParams(p); if (v === 'all') n.delete('co'); else n.set('co', v); return n }, { replace: true })
  return [co, setCo]
}

export default function PayCalendar({ co, onMeta }) {
  const { user } = useUser()
  const toast = useToast()
  const [qs, setQs] = useSearchParams()
  const exclude = qs.get('exclude') || null
  const setExclude = (v) => setQs(p => { const n = new URLSearchParams(p); if (v) n.set('exclude', v); else n.delete('exclude'); return n }, { replace: true })
  const [data, setData] = useState(null)
  const [cash, setCash] = useState({})
  const [err, setErr] = useState(null)
  const [pairs, setPairs] = useState([])
  const [linking, setLinking] = useState(false)
  const [docPays, setDocPays] = useState([])
  const [docLinking, setDocLinking] = useState(false)
  const [onlyEst, setOnlyEst] = useState(false)
  const [open, setOpen] = useState({ supplier: true })
  const tableRef = useRef(null)
  const today = todayKyiv()

  const reload = () => {
    setErr(null)
    Promise.all([loadForecast(), currentCashByCompany().catch(() => ({}))])
      .then(([f, c]) => { setData(f); setCash(c) }).catch(e => setErr(e.message))
  }
  useEffect(reload, [])

  const startCash = useMemo(() => Object.entries(cash || {}).reduce((s, [cid, v]) => s + (co === 'all' || cid === co ? v : 0), 0), [cash, co])
  const cal = useMemo(() => data ? buildCalendar({ orders: data.orders, manual: data.manual, startCash, today, co, exclude }) : null, [data, startCash, co, exclude, today])

  // автопошук уже сплачених (2.6) — при відкритті й після змін
  useEffect(() => {
    if (!cal) return
    let alive = true
    findPossiblyPaid(cal.rows, today).then(p => { if (alive) setPairs(p) }).catch(() => { if (alive) setPairs([]) })
    const ids = [...new Set(cal.rows.filter(r => r.orderId && r.type === 'supplier').map(r => r.orderId))]
    findSupplierDocPays(ids).then(p => { if (alive) setDocPays(p) }).catch(() => { if (alive) setDocPays([]) })
    return () => { alive = false }
  }, [cal, today])

  useEffect(() => {
    if (cal && onMeta) onMeta({ from: today, to: cal.totals.lastDate, orders: cal.orderCount })
  }, [cal, today, onMeta])

  if (err) return <Callout tone="danger" title="Не вдалося побудувати календар." text={err} />
  if (!cal) return <TableSkeleton rows={8} cols={6} label="Рахую платіжний календар…" />

  const { gap, cause, totals, days, rows } = cal
  const supOver = rows.filter(r => r.type === 'supplier' && r.overdue)
  const cliOver = rows.filter(r => r.type === 'client' && r.overdue)
  const estRows = rows.filter(r => r.estimated)
  const byOrder = {}
  rows.filter(r => r.orderId).forEach(r => { const o = (byOrder[r.orderId] ||= { orderId: r.orderId, number: r.number, inc: 0, out: 0, rows: [] }); if (r.amount > 0) o.inc += r.amount; else o.out -= r.amount; o.rows.push(r) })
  const minusOrders = Object.values(byOrder).filter(o => o.inc > 0 && o.inc - o.out < -0.5).sort((a, b) => (a.inc - a.out) - (b.inc - b.out))
  const sum = (list) => list.reduce((s, r) => s + r.amount, 0)
  const uniq = (list) => [...new Set(list.map(r => r.number).filter(Boolean))].sort()
  const showCause = cause && !cal.excluded
  const gapCause = cause && !cal.excluded && cause
  const hasFixed = (data.manual || []).some(m => m.kind === 'expense')

  const openTable = (patch) => { setOpen(o => ({ ...o, ...patch })); setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }
  const remind = async () => {
    const list = uniq(cliOver)
    try {
      for (const num of list) {
        const r = cliOver.find(x => x.number === num)
        const amt = cliOver.filter(x => x.number === num).reduce((s, x) => s + x.amount, 0)
        await createTask({
          title: `Нагадати ${r.client || 'клієнту'} про оплату №${num}`,
          description: `Прострочено надходження ${n0(amt)} ₴ (планова дата ${dmy(r.origDate)}). Створено з платіжного календаря.`,
          assignee_id: r.managerId || user?.id || null, created_by: user?.id || null, priority: 'normal',
          due_date: addDaysIso(today, 1), entity_type: 'order', entity_id: r.orderId, entity_ref: `/orders/${r.orderId}`,
        })
      }
      toast(`Створено ${list.length} ${plural(list.length, ['задачу', 'задачі', 'задач'])} менеджерам`)
    } catch (e) { toast(e.message, { type: 'error' }) }
  }

  const actions = []
  if (gap) actions.push({
    tone: 'danger', title: `Потрібно ${n0(Math.abs(gap.value))} ₴ на ${dLong(gap.date)}`,
    text: `Передоплата від клієнта, відстрочка постачальнику або кредитна лінія. Без них рахунки в мінусі з ${gap.from === today ? 'сьогодні' : dShort(gap.from)} ${gap.to ? 'до ' + dShort(gap.to) : 'до кінця прогнозу'}.`,
    amount: gap.value,
    btn: gapCause ? <Link className="btn btn-secondary btn-sm" to={`/orders/${gapCause.orderId}?tab=finance`}>Відкрити №{gapCause.number}</Link>
      : <Button size="sm" variant="secondary" onClick={() => openTable({ supplier: true })}>Переглянути</Button>,
  })
  // платіж, що вже пропонується через прихідну, не дублюємо в «Можливо, вже оплачено»
  const docTx = new Set(docPays.map(p => p.txId))
  const pairsF = pairs.filter(p => !docTx.has(p.tx.id))
  const fullP = pairsF.filter(p => !p.partial), partP = pairsF.filter(p => p.partial)
  if (pairsF.length) actions.push({
    tone: 'info', title: 'Можливо, вже оплачено',
    text: [fullP.length ? `${fullP.length} ${plural(fullP.length, ['«прострочена» оплата', '«прострочені» оплати', '«прострочених» оплат'])} постачальникам є у виписці: ${fullP.map(p => `№${p.line.number} — ${n0(p.amount)} ₴ ${dmy(p.tx.date).slice(0, 5)}`).join(', ')}.` : '',
      partP.length ? `Часткові оплати, ще не прив'язані: ${[...new Set(partP.map(p => '№' + p.line.number))].join(', ')} — разом ${n0(partP.reduce((s, p) => s + p.amount, 0))} ₴.` : '',
      'Прив\'яжіть — і сьогоднішній мінус зменшиться.'].filter(Boolean).join(' '),
    amount: pairsF.reduce((s, p) => s + p.amount, 0), amountTone: 'info',
    btn: <Button size="sm" variant="secondary" onClick={() => setLinking(true)}>Прив'язати</Button>,
  })
  if (docPays.length) {
    const numOf = (id) => rows.find(r => r.orderId === id)?.number
    actions.push({
      tone: 'info', title: 'Оплати через прихідні накладні',
      text: `${docPays.length} ${plural(docPays.length, ['оплата', 'оплати', 'оплат'])} постачальникам прив'язані до прихідних, товар з яких пішов у замовлення ${[...new Set(docPays.map(p => numOf(p.orderId)).filter(Boolean))].map(n => '№' + n).join(', ')}, але не до самих замовлень.`,
      amount: docPays.reduce((s2, p) => s2 + p.amount, 0), amountTone: 'info',
      btn: <Button size="sm" variant="secondary" onClick={() => setDocLinking(true)}>Прив'язати</Button>,
    })
  }
  if (supOver.length) actions.push({
    tone: 'warn', title: 'Прострочено постачальникам',
    text: `${nums(uniq(supOver))} — сплатити або оновити дату в замовленні`, amount: sum(supOver),
    btn: <Button size="sm" variant="secondary" onClick={() => { setOnlyEst(false); openTable({ supplier: true }) }}>Переглянути</Button>,
  })
  minusOrders.slice(0, 3).forEach(o => actions.push({
    tone: 'danger', title: `№${o.number} у мінусі`,
    text: `Постачальникам ${n0(o.out)} ₴, від клієнта очікуємо лише ${n0(o.inc)} ₴. Перевірте суми в замовленні.`, amount: o.inc - o.out,
    btn: <Link className="btn btn-secondary btn-sm" to={`/orders/${o.orderId}?tab=finance`}>Відкрити</Link>,
  }))
  if (cliOver.length) actions.push({
    tone: 'amber', title: 'Прострочено клієнтами', text: `${nums(uniq(cliOver))} — нагадати про оплату`, amount: sum(cliOver),
    btn: <Button size="sm" variant="secondary" onClick={remind}>Нагадати</Button>,
  })
  if (estRows.length) actions.push({
    tone: 'muted', title: `${estRows.length} ${plural(estRows.length, ['дата орієнтовна', 'дати орієнтовні', 'дат орієнтовні'])}`,
    text: 'Уточніть з клієнтами й постачальниками, щоб календар був точним', amount: null,
    btn: <Button size="sm" variant="secondary" onClick={() => { setOnlyEst(true); openTable({ client: true, supplier: true, vat: true, agent: true, manual: true }) }}>Уточнити</Button>,
  })

  return (
    <div className="pc">
      {/* ── Шапка ── */}
      <section className="pc-hero" aria-label="Касовий розрив">
        <div className="pc-hero-top">
          <div className="pc-gap">
            <span className="pc-lbl">Найглибший касовий розрив<InfoTip tone="onDark" label="Найглибший касовий розрив">Найнижчий залишок на кінець дня за весь період. Рахується по днях: у місячному звіті платежі одного місяця гасяться й розрив не видно.</InfoTip></span>
            {gap ? <>
              <b className="pc-gap-v is-neg">{n0(gap.value)} ₴</b>
              <small>{dLong(gap.date)}, {WD[pd(gap.date).wd]} · у мінусі з {gap.from === today ? 'сьогодні' : dShort(gap.from)} {gap.to ? `до ${dShort(gap.to)} — ${gap.duration} дн.` : '— до кінця прогнозу'}</small>
            </> : <b className="pc-gap-v is-ok">Розриву немає</b>}
          </div>
          <dl className="pc-kpis">
            <div><dt>Зараз на рахунках</dt><dd>{n0(totals.start)}</dd></div>
            <div><dt>Прийде</dt><dd className="is-pos">{sg(totals.inc)}</dd></div>
            <div><dt>Піде</dt><dd className="is-neg">{n0(totals.out)}</dd></div>
            <div><dt>У кінці · {dShort(totals.lastDate)}</dt><dd>{n0(totals.end)}</dd></div>
          </dl>
        </div>
        {showCause && (
          <p className="pc-cause">{Math.min(100, Math.round(cause.share * 100))}% розриву — замовлення №{cause.number}: {dLong(gap.date)} платимо постачальникам {n0(cause.paid)} ₴{cause.clientDate ? `, а ${cause.client} платить ${dLong(cause.clientDate)}` : ''}.{cause.withoutMin != null && ` Без нього найнижча точка була б ${n0(cause.withoutMin)} ₴.`}</p>
        )}
      </section>

      {/* ── Що зробити ── */}
      {actions.length > 0 && (
        <section className="pc-card" aria-label="Що зробити">
          <h2>Що зробити</h2>
          <ul className="pc-acts">{actions.map((a, i) => (
            <li key={i}>
              <span className={`pc-dot is-${a.tone}`} aria-hidden="true" />
              <div className="pc-act-t"><b>{a.title}</b><span>{a.text}</span></div>
              {a.amount != null && <b className={`pc-act-sum ${a.amountTone === 'info' ? 'is-info' : a.amount < 0 ? 'is-neg' : 'is-pos'}`}>{a.amountTone === 'info' ? n0(Math.abs(a.amount)) : sg(a.amount)}</b>}
              <div className="pc-act-btn">{a.btn}</div>
            </li>
          ))}</ul>
        </section>
      )}

      {/* ── Графік ── */}
      <section className="pc-card" aria-label="Залишок на кінець дня">
        <div className="pc-card-h">
          <h2>Залишок на кінець дня</h2>
          <div className="pc-legend">
            <span><i className="pc-sw is-in" />прийде</span><span><i className="pc-sw is-out" />піде</span><span><i className="pc-sw is-line" />залишок</span>
            {(cause || cal.excluded) && (
              <label className="pc-ex"><input type="checkbox" checked={!!cal.excluded} onChange={e => setExclude(e.target.checked ? cause?.number || cal.excluded : null)} />Без №{cal.excluded || cause.number}</label>
            )}
          </div>
        </div>
        <BalanceChart days={days} gap={gap} today={today} />
      </section>

      {/* ── Таблиця ── */}
      <section className="pc-card pc-tbl-card" ref={tableRef} aria-label="Рух грошей по датах">
        <div className="pc-card-h">
          <h2>Рух грошей по датах</h2>
          <div className="pc-legend">
            {onlyEst && <button type="button" className="pc-filter" onClick={() => setOnlyEst(false)}>лише орієнтовні ✕</button>}
            <span className="pc-tag is-est">орієнт.</span><span className="pc-tag is-late">простр.</span>
            <InfoTip label="Позначки">«простр.» — планова дата вже минула, рядок перенесено на сьогодні. «орієнт.» — дата розрахована за правилами (немає дати відвантаження чи оплати), її варто уточнити.</InfoTip>
          </div>
        </div>
        <CashTable days={days} rows={onlyEst ? rows.filter(r => r.estimated) : rows} open={open} setOpen={setOpen} today={today} />
        <DayList days={days} rows={onlyEst ? rows.filter(r => r.estimated) : rows} today={today} />
      </section>

      {!hasFixed && (
        <p className="pc-foot"><span className="pc-dot is-amber" aria-hidden="true" />Оренда, зарплата й податки, крім ПДВ, ще не внесені, тож реальний розрив може бути глибшим. <Link to="/forecast?tab=deals">Додати постійні витрати</Link></p>
      )}

      {docLinking && <DocPaysModal pays={docPays} numOf={(id) => rows.find(r => r.orderId === id)?.number} userId={user?.id} onClose={() => setDocLinking(false)} onDone={() => { setDocLinking(false); reload() }} />}
      {linking && <LinkModal pairs={pairsF} userId={user?.id} onClose={() => setLinking(false)} onDone={() => { setLinking(false); reload() }} />}
    </div>
  )
}

// ── Графік «Залишок на кінець дня» (3.3) ──
function BalanceChart({ days, gap, today }) {
  const box = useRef(null)
  const [w, setW] = useState(800)
  const [hover, setHover] = useState(null)
  useLayoutEffect(() => {
    const el = box.current; if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth || 800)); ro.observe(el); setW(el.clientWidth || 800)
    return () => ro.disconnect()
  }, [])
  const mobile = w < 600
  const step = Math.max(mobile ? 40 : 24, (w - 70) / Math.max(1, days.length))
  const W = Math.max(w, 70 + step * days.length), H = 280, top = 16, bottom = 30, left = 56
  const vals = days.flatMap(d => [d.end, d.inc, d.out, 0])
  let max = Math.max(...vals), min = Math.min(...vals)
  if (max - min < 1) { max += 1; min -= 1 }
  const pad = (max - min) * 0.08; max += pad; min -= pad
  const y = (v) => top + (max - v) / (max - min) * (H - top - bottom)
  const x = (i) => left + step * i + step / 2
  const mln = (v) => Math.abs(max - min) >= 2e6
  const tickStep = (() => { const raw = (max - min) / 4; const p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map(k => k * p).find(s => s >= raw) })()
  const ticks = []; for (let t = Math.ceil(min / tickStep) * tickStep; t <= max; t += tickStep) ticks.push(t)
  const tl = (t) => mln() ? `${Math.round(t / 1e6 * 10) / 10} млн` : `${Math.round(t / 1e3)} тис`
  const bw = Math.min(18, step * 0.35)
  const gi = gap ? days.findIndex(d => d.date === gap.date) : -1
  const pts = days.map((d, i) => `${x(i)},${y(d.end)}`).join(' ')
  const h = hover != null ? days[hover] : null
  return (
    <div className="pc-chart" ref={box}>
      <div className="pc-chart-scroll">
        <svg width={W} height={H} role="img" aria-label="Графік залишку грошей на кінець дня">
          <rect x={left} y={y(0)} width={W - left} height={Math.max(0, y(min) - y(0))} className="pc-neg-zone" />
          {ticks.map(t => <g key={t}><line x1={left} x2={W} y1={y(t)} y2={y(t)} className={Math.abs(t) < 1e-6 ? 'pc-zero' : 'pc-grid'} /><text x={left - 8} y={y(t) + 4} className="pc-ytick">{tl(t)}</text></g>)}
          {days.map((d, i) => (
            <g key={d.date}>
              {d.inc > 0 && <rect x={x(i) - bw - 1} y={y(d.inc)} width={bw} height={Math.max(1, y(0) - y(d.inc))} rx="2" className="pc-bar-in" />}
              {d.out < 0 && <rect x={x(i) + 1} y={y(0)} width={bw} height={Math.max(1, y(d.out) - y(0))} rx="2" className="pc-bar-out" />}
            </g>
          ))}
          <polyline points={pts} className="pc-line" />
          {days.map((d, i) => <circle key={d.date} cx={x(i)} cy={y(d.end)} r={i === gi ? 6 : 3.5} className={d.end < 0 ? 'pc-pt is-neg' : 'pc-pt'} />)}
          {gi >= 0 && <text x={x(gi) + (x(gi) < W / 2 ? 10 : -10)} y={y(days[gi].end) + (y(days[gi].end) < top + 20 ? 18 : -10)} className="pc-gap-l" textAnchor={x(gi) < W / 2 ? 'start' : 'end'}>{n0(days[gi].end)} ₴ · {dShort(days[gi].date)}</text>}
          {days.map((d, i) => (i % 2 === 0 || i === gi) && <text key={'l' + d.date} x={x(i)} y={H - 8} className="pc-xtick" textAnchor="middle">{d.date === today ? 'сьогодні' : dShort(d.date)}</text>)}
          {days.map((d, i) => <rect key={'h' + d.date} x={left + step * i} y={0} width={step} height={H - bottom} fill="transparent"
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => setHover(i)} />)}
          {h && <line x1={x(hover)} x2={x(hover)} y1={top} y2={H - bottom} className="pc-hover-l" />}
        </svg>
      </div>
      {h && (
        <div className="pc-tip" role="status" style={{ left: Math.min(Math.max(8, x(hover) - (box.current?.querySelector('.pc-chart-scroll')?.scrollLeft || 0) - 90), (w || 300) - 190) }}>
          <b>{dLong(h.date)}, {WD[pd(h.date).wd]}</b>
          <span>Залишок <b className={h.end < 0 ? 'is-neg' : ''}>{n0(h.end)} ₴</b></span>
          <span>Прийде <b className="is-pos">{sg(h.inc)}</b></span>
          <span>Піде <b className="is-neg">{n0(h.out)}</b></span>
        </div>
      )}
    </div>
  )
}

// групи → рядки за замовленням (№ зліва, контрагент справа); у замовленні з кількома постачальниками — рядок на кожного
const subName = (r) => r.type === 'supplier' || r.type === 'manual' ? (r.counterparty || '—') : (r.client || r.counterparty || '—')
function groupRows(rows) {
  return GROUPS.map(g => {
    const list = rows.filter(r => r.type === g.id)
    if (!list.length) return null
    const by = {}
    list.forEach(r => { const k = (r.orderId || '') + '|' + subName(r); (by[k] ||= { key: k, orderId: r.orderId, number: r.number, name: subName(r), rows: [] }).rows.push(r) })
    const subs = Object.values(by).sort((a, b) => String(a.number || '~').localeCompare(String(b.number || '~')) || a.name.localeCompare(b.name, 'uk'))
    return { ...g, list, subs }
  }).filter(Boolean)
}
const sumOn = (list, date) => list.filter(r => r.date === date).reduce((s, r) => s + r.amount, 0)
const cell = (v) => Math.abs(v) < 0.5 ? '–' : n0(v)

// ── Таблиця «Рух грошей по датах» (3.5) — комп'ютер ──
function CashTable({ days, rows, open, setOpen, today }) {
  const groups = groupRows(rows)
  const total = (list) => list.reduce((s, r) => s + r.amount, 0)
  const dayCls = (d) => d.date === today ? ' is-today' : ''
  return (
    <div className="pc-tbl-wrap">
      <table className="pc-tbl">
        <thead><tr>
          <th className="pc-sticky">Стаття</th>
          {days.map(d => <th key={d.date} className={'is-num' + dayCls(d)}>{d.date === today ? <>Сьогодні<small>з простроченим</small></> : <>{dShort(d.date)}<small>{WD[pd(d.date).wd]}</small></>}</th>)}
          <th className="is-num">Разом</th>
        </tr></thead>
        <tbody>
          <tr className="pc-row-bal"><th className="pc-sticky">Залишок на початок дня</th>{days.map(d => <td key={d.date} className={'is-num' + dayCls(d)}>{n0(d.start)}</td>)}<td /></tr>
          {groups.map(g => (
            <Fragment key={g.id}>
              <tr className="pc-row-g">
                <th className="pc-sticky"><button type="button" aria-expanded={!!open[g.id]} onClick={() => setOpen(o => ({ ...o, [g.id]: !o[g.id] }))}><i className={`ti ti-chevron-${open[g.id] ? 'down' : 'right'}`} aria-hidden="true" />{g.label}</button></th>
                {days.map(d => { const v = sumOn(g.list, d.date); return <td key={d.date} className={'is-num' + dayCls(d) + (v < -0.5 ? ' is-neg' : v > 0.5 ? ' is-pos' : '')}>{cell(v)}</td> })}
                <td className="is-num"><b>{cell(total(g.list))}</b></td>
              </tr>
              {open[g.id] && g.subs.map(s => (
                <tr key={s.key} className="pc-row-s">
                  <th className="pc-sticky"><span className="pc-sub-row">
                    <span className="pc-ord">{s.orderId ? <Link to={`/orders/${s.orderId}?tab=finance`}>№{s.number}</Link> : '—'}</span>
                    <span className="pc-cp">{s.name}
                      {s.rows.some(r => r.overdue) && <span className="pc-tag is-late">простр.</span>}
                      {s.rows.some(r => r.estimated) && <span className="pc-tag is-est">орієнт.</span>}</span>
                  </span></th>
                  {days.map(d => { const v = sumOn(s.rows, d.date); return <td key={d.date} className={'is-num' + dayCls(d)}>{cell(v)}</td> })}
                  <td className="is-num">{cell(total(s.rows))}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className="pc-row-net"><th className="pc-sticky">Чистий потік дня</th>{days.map(d => <td key={d.date} className={'is-num' + dayCls(d)}>{Math.abs(d.net) < 0.5 ? '–' : sg(d.net)}</td>)}<td className="is-num">{sg(total(rows))}</td></tr>
          <tr className="pc-row-end"><th className="pc-sticky">Залишок на кінець дня</th>{days.map(d => <td key={d.date} className={'is-num' + dayCls(d) + (d.end < 0 ? ' is-neg-bg' : '')}>{n0(d.end)}</td>)}<td /></tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Телефон: список днів (4) ──
function DayList({ days, rows, today }) {
  const [openD, setOpenD] = useState(null)
  return (
    <ul className="pc-days">{days.map(d => {
      const list = rows.filter(r => r.date === d.date)
      const isOpen = openD === d.date
      return (
        <li key={d.date} className={d.end < 0 ? 'is-neg' : ''}>
          <button type="button" aria-expanded={isOpen} onClick={() => setOpenD(isOpen ? null : d.date)}>
            <span><b>{d.date === today ? 'Сьогодні' : dLong(d.date)}</b><small>{d.date === today ? 'з простроченим' : WD[pd(d.date).wd]} · потік {sg(d.net)}</small></span>
            <b className="pc-day-end">{n0(d.end)}</b><i className={`ti ti-chevron-${isOpen ? 'up' : 'down'}`} aria-hidden="true" />
          </button>
          {isOpen && <ul className="pc-day-rows">{list.length ? list.map((r, i) => (
            <li key={i}><span>{r.number && <small><Link to={`/orders/${r.orderId}?tab=finance`}>№{r.number}</Link> </small>}{subName(r)}{r.overdue && <span className="pc-tag is-late">простр.</span>}{r.estimated && <span className="pc-tag is-est">орієнт.</span>}</span><b className={r.amount < 0 ? 'is-neg' : 'is-pos'}>{sg(r.amount)}</b></li>
          )) : <li><span>Руху немає</span></li>}</ul>}
        </li>
      )
    })}</ul>
  )
}

// ── «Прив'язати»: пари на підтвердження по одній або всі (2.6) ──
function LinkModal({ pairs, userId, onClose, onDone }) {
  const toast = useToast()
  const [left, setLeft] = useState(pairs)
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState(0)
  const link = async (list) => {
    setBusy(list.length > 1 ? 'all' : pairKey(list[0]))
    try {
      for (const p of list) { await linkPaidPair(p, userId); setLeft(l => l.filter(x => pairKey(x) !== pairKey(p))); setDone(n => n + 1) }
    } catch (e) { toast('Не вдалося прив\'язати: ' + e.message, { type: 'error' }) }
    setBusy(null)
  }
  useEffect(() => { if (!left.length && done) onDone() }, [left, done])
  return (
    <Modal open onClose={done ? onDone : onClose} size="lg" title="Можливо, вже оплачено"
      footer={<><Button variant="secondary" onClick={done ? onDone : onClose}>Готово</Button><Button variant="dark" loading={busy === 'all'} disabled={!left.length || !!busy} onClick={() => link(left)}>Прив'язати всі ({left.length})</Button></>}>
      <p className="pc-modal-p">Ці оплати є у виписці, але не прив'язані до замовлень (або розподілені не повністю). <b>Повна</b> — той самий постачальник, сума збігається (±1% або ±50 ₴). <b>Часткова</b> — вільний залишок платежу цього постачальника, розкладений на його прострочені замовлення від найстаріших. Після прив'язки рядок прогнозу закривається або зменшується.</p>
      <ul className="pc-pairs">{left.map(p => (
        <li key={pairKey(p)}>
          <div><b><Link to={`/orders/${p.line.orderId}?tab=finance`}>№{p.line.number}</Link> · {p.line.counterparty}</b><small>план {dmy(p.line.origDate)} · до оплати {n0(Math.abs(p.line.amount))} ₴</small></div>
          <div><b>{n0(p.amount)} ₴{p.partial && <span className="pc-tag is-part">частково</span>}</b><small>виписка {dmy(p.tx.date)} · платіж {n0(Math.abs(p.tx.amount))} ₴</small></div>
          <Button size="sm" variant="secondary" loading={busy === pairKey(p)} disabled={!!busy} onClick={() => link([p])}>Прив'язати</Button>
        </li>
      ))}</ul>
      {!left.length && <p className="pc-modal-p">Усе прив'язано.</p>}
    </Modal>
  )
}

// ── «Оплати через прихідні накладні»: оплата прихідної → частка замовлення (supplierDocPays) ──
function DocPaysModal({ pays, numOf, userId, onClose, onDone }) {
  const toast = useToast()
  const key = (p) => p.txId + '|' + p.orderId + '|' + p.docId
  const [left, setLeft] = useState(pays)
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState(0)
  const link = async (list) => {
    setBusy(list.length > 1 ? 'all' : key(list[0]))
    try { for (const p of list) { await linkSupplierDocPay(p, userId); setLeft(l => l.filter(x => key(x) !== key(p))); setDone(n => n + 1) } }
    catch (e) { toast('Не вдалося прив\'язати: ' + e.message, { type: 'error' }) }
    setBusy(null)
  }
  useEffect(() => { if (!left.length && done) onDone() }, [left, done])
  return (
    <Modal open onClose={done ? onDone : onClose} size="lg" title="Оплати через прихідні накладні"
      footer={<><Button variant="secondary" onClick={done ? onDone : onClose}>Готово</Button><Button variant="dark" loading={busy === 'all'} disabled={!left.length || !!busy} onClick={() => link(left)}>Прив'язати всі ({left.length})</Button></>}>
      <p className="pc-modal-p">Оплата у виписці прив'язана до прихідної накладної, а товар із цієї накладної списано в замовлення. Сума — частка замовлення у вартості накладної × оплата. Після прив'язки оплата постачальнику в замовленні й у календарі закривається.</p>
      <ul className="pc-pairs">{left.map(p => (
        <li key={key(p)}>
          <div><b><Link to={`/orders/${p.orderId}?tab=finance`}>№{numOf(p.orderId) || '—'}</Link> · {p.doc?.contractors?.name || p.tx?.counterparty || 'Постачальник'}</b><small>прихідна {p.doc?.doc_number || '—'}{p.doc?.doc_date ? ' від ' + dmy(p.doc.doc_date) : ''}</small></div>
          <div><b>{n0(p.amount)} ₴{p.share < 0.999 && <span className="pc-tag is-part">{Math.round(p.share * 100)}%</span>}</b><small>оплата {dmy(p.tx?.date)} · {n0(Math.abs(p.tx?.amount || 0))} ₴</small></div>
          <Button size="sm" variant="secondary" loading={busy === key(p)} disabled={!!busy} onClick={() => link([p])}>Прив'язати</Button>
        </li>
      ))}</ul>
      {!left.length && <p className="pc-modal-p">Усе прив'язано.</p>}
    </Modal>
  )
}

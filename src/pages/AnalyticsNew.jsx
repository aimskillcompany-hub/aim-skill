// Аналітика — новий інтерфейс (ТЗ редизайну 5.1; макети Desktop / Main / Breakdown).
// Лише відображення: цифри — ті самі computeCashFlow / computeAging, що й у старому вигляді; розкриття клітинок —
// той самий CashFlowDrillModal (передається через openDrill).
import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatAmount } from '../utils/format'
import { Button, Switch, Sheet, TableSkeleton } from '../components/ui'
import './AnalyticsNew.css'

export const MONTHS_SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const NOW = new Date()
const signed = (v) => formatAmount(v, { decimals: 0, sign: 'always' })
const plain = (v) => formatAmount(Math.abs(v), { decimals: 0 })

// Рік + місяці чипами (майбутні місяці поточного року — неактивні)
export function PeriodChips({ year, setYear, month, setMonth, years, noYear = false }) {
  const lastMonth = year === NOW.getFullYear() ? NOW.getMonth() + 1 : 12
  return (
    <div className="an-period">
      {!noYear && <select className="form-input an-year" value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Рік">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>}
      <div className="an-chips" role="group" aria-label="Місяць">
        <button type="button" className="an-chip" aria-pressed={!month} onClick={() => setMonth(0)}>Весь рік</button>
        {MONTHS_SHORT.map((m, i) => (
          <button key={m} type="button" className="an-chip" aria-pressed={month === i + 1} disabled={i + 1 > lastMonth} onClick={() => setMonth(i + 1)}>{m}</button>
        ))}
      </div>
    </div>
  )
}

// Підпис періоду: «2026, січ–жов» / «жовтень 2026»
const MONTHS_FULL = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']
function periodLabel(year, month) {
  if (month) return `${MONTHS_FULL[month - 1]} ${year}`
  const last = year === NOW.getFullYear() ? NOW.getMonth() : 11
  return last === 0 ? `${year}, січ` : `${year}, січ–${MONTHS_SHORT[last].toLowerCase()}`
}

export function CashFlowNew({ d, debt, year, month, setMonth, openDrill }) {
  const navigate = useNavigate()
  const [heat, setHeat] = useState(true)
  const [closed, setClosed] = useState(() => new Set())
  const [sheet, setSheet] = useState(false)

  // Для поточного року майбутні місяці не показуємо (у них ще немає руху)
  const cols = useMemo(() => {
    if (!d) return []
    if (month || year !== NOW.getFullYear()) return d.cols
    return d.cols.filter(c => Number(c.key) <= NOW.getMonth() + 1)
  }, [d, year, month])

  if (!d) return <TableSkeleton rows={8} cols={6} label="Рахую рух грошей…" />

  const noArt = d.outflow.rows.concat(d.inflow.rows).filter(r => r.article === 'Без статті').reduce((a, r) => a + r.total, 0)
  const barMax = Math.max(1, ...cols.map(c => Math.max(d.inflow.totalByCol[c.key] || 0, d.outflow.totalByCol[c.key] || 0)))
  const change = d.openingCash ? (d.closingCash - d.openingCash) / Math.abs(d.openingCash) : null
  const recv = debt?.receivable?.total || 0, pay = debt?.payable?.total || 0

  // лінія залишку: старт + кінець кожного стовпця
  const pts = [d.openingCash, ...cols.map(c => d.closingByCol[c.key])]
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1
  const W = 300, H = 110
  const xy = pts.map((v, i) => [(i / Math.max(1, pts.length - 1)) * W, 8 + (1 - (v - lo) / span) * (H - 16)])
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`

  const toggle = (k) => setClosed(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const secMax = (sec) => Math.max(1, ...sec.rows.flatMap(r => cols.map(c => r.cells[c.key] || 0)))
  const heatStyle = (v, max) => heat && v ? { '--heat': `${Math.round(8 + 52 * Math.min(1, v / max))}%` } : undefined
  const pick = (c) => { if (!month) setMonth(Number(c.key)) }

  const section = (k, label, sec, sign) => {
    const max = secMax(sec), open = !closed.has(k)
    return (
      <Fragment key={k}>
        <tr className={`cfn-sec is-${k}`}>
          <th scope="row"><button type="button" aria-expanded={open} onClick={() => toggle(k)}><i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />{label}</button></th>
          {cols.map(c => <Num key={c.key} v={sec.totalByCol[c.key]} onClick={() => openDrill(null, c.key, sign, label, c.label)} />)}
          <Num v={sec.total} onClick={() => openDrill(null, 'total', sign, label, 'Разом')} />
        </tr>
        {open && sec.rows.map(r => (
          <tr key={r.article} className={`is-${k}`}>
            <th scope="row" className="cfn-art">{r.article}{r.article === 'Без статті' && <span className="cfn-dot" aria-label="потребує статті" />}</th>
            {cols.map(c => <Num key={c.key} v={r.cells[c.key]} style={heatStyle(r.cells[c.key], max)} heat onClick={() => openDrill(r.article, c.key, sign, r.article, c.label)} />)}
            <Num v={r.total} strong onClick={() => openDrill(r.article, 'total', sign, r.article, 'Разом')} />
          </tr>
        ))}
      </Fragment>
    )
  }

  return (
    <div className="cfn">
      <div className="cfn-top">
        <section className="cfn-hero" aria-label="Чистий потік">
          <div className="cfn-hero-head">
            <div>
              <div className="cfn-hero-label">Чистий потік · {periodLabel(year, month)}</div>
              <div className={`cfn-hero-value${d.netTotal < 0 ? ' is-neg' : ''}`}>{signed(d.netTotal)} <small>₴</small></div>
            </div>
            <dl className="cfn-legend">
              <div><dt><i className="is-in" />Надходження</dt><dd>{signed(d.inflow.total)}</dd></div>
              <div><dt><i className="is-out" />Витрати</dt><dd>{signed(-d.outflow.total)}</dd></div>
            </dl>
          </div>
          <div className="cfn-bars" role="list">
            {cols.map(c => {
              const i = d.inflow.totalByCol[c.key] || 0, o = d.outflow.totalByCol[c.key] || 0
              return (
                <button key={c.key} type="button" role="listitem" className="cfn-bar" disabled={!!month}
                  title={`${c.label}: +${plain(i)} / −${plain(o)}`} aria-label={`${c.label}: надходження ${plain(i)}, витрати ${plain(o)}`} onClick={() => pick(c)}>
                  <span className="cfn-bar-pair">
                    <span className="is-in" style={{ height: `${(i / barMax) * 100}%` }} />
                    <span className="is-out" style={{ height: `${(o / barMax) * 100}%` }} />
                  </span>
                  <span className="cfn-bar-lbl">{c.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="cfn-card cfn-bal" aria-label="Залишок на рахунках">
          <div className="cfn-bal-head">
            <span className="cfn-muted">Залишок на рахунках</span>
            {change != null && Math.abs(change) >= 0.001 && <span className={`cfn-pill ${change < 0 ? 'is-neg' : 'is-pos'}`}>{change < 0 ? '−' : '+'}{Math.abs(change * 100).toFixed(1).replace('.', ',')}% за період</span>}
          </div>
          <div className={`cfn-bal-value${d.closingCash < 0 ? ' is-neg' : ''}`}>{formatAmount(d.closingCash, { decimals: 0 })} <small>₴</small></div>
          <div className="cfn-muted cfn-sm">на кінець: {periodLabel(year, month)}</div>
          <svg className="cfn-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={area} className="cfn-spark-area" /><path d={line} className="cfn-spark-line" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="cfn-muted cfn-sm">Старт періоду: {formatAmount(d.openingCash, { decimals: 0 })} ₴</div>
        </section>

        <div className="cfn-side">
          <button type="button" className="cfn-card cfn-debt" onClick={() => navigate('/reports?tab=receivables')}>
            <span className="cfn-ico is-in"><i className="ti ti-arrow-up-right" aria-hidden="true" /></span>
            <span><span className="cfn-muted cfn-sm">Нам винні · дебіторка</span><b>{debt ? `${plain(recv)} ₴` : '…'}</b></span>
            <i className="ti ti-chevron-right cfn-chev" aria-hidden="true" />
          </button>
          <button type="button" className="cfn-card cfn-debt" onClick={() => navigate('/reports?tab=payables')}>
            <span className="cfn-ico is-out"><i className="ti ti-arrow-down-left" aria-hidden="true" /></span>
            <span><span className="cfn-muted cfn-sm">Ми винні · кредиторка</span><b>{debt ? `${plain(pay)} ₴` : '…'}</b></span>
            <i className="ti ti-chevron-right cfn-chev" aria-hidden="true" />
          </button>
          {recv > 0 && (
            <div className="cfn-card cfn-with">
              <span className="cfn-with-t">З урахуванням дебіторки</span>
              <b>{signed(d.netTotal + recv)} ₴</b>
              <span className="cfn-sm">гроші вже зароблені за видатковими й актами — просто ще не надійшли на рахунок</span>
            </div>
          )}
        </div>
      </div>

      {noArt > 0 && (
        <div className="cfn-card cfn-noart">
          <div><b>{plain(noArt)} ₴ без статті</b><span className="cfn-muted cfn-sm">Розподіліть, щоб звіт був точним.</span></div>
          <Button variant="primary" onClick={() => navigate('/bank?article=__none__')}>Розподілити</Button>
        </div>
      )}

      <button type="button" className="cfn-card cfn-open-sheet" onClick={() => setSheet(true)}>
        <span><b>Статті руху коштів</b><span className="cfn-muted cfn-sm">{d.inflow.rows.length} надходжень · {d.outflow.rows.length} витрат</span></span>
        <i className="ti ti-chevron-right" aria-hidden="true" />
      </button>

      <section className="cfn-card cfn-report" aria-label="Звіт по статтях">
        <div className="cfn-report-head">
          <div><h2>Звіт по статтях</h2><p className="cfn-muted cfn-sm">Стаття × {month ? 'день' : 'місяць'} · прямий метод · натисніть на цифру, щоб відкрити транзакції</p></div>
          <div className="cfn-report-tools">
            {noArt > 0 && <button type="button" className="cfn-pill is-neg cfn-pill-btn" onClick={() => navigate('/bank?article=__none__')}>{plain(noArt)} ₴ без статті · <u>розподілити</u></button>}
            <Switch checked={heat} onChange={setHeat} label="Теплова карта" />
          </div>
        </div>
        <div className="cfn-tbl">
          <table>
            <thead><tr><th scope="col">Стаття</th>{cols.map(c => <th key={c.key} scope="col">{c.label}</th>)}<th scope="col">Разом</th></tr></thead>
            <tbody>
              {section('in', 'Надходження', d.inflow, 'in')}
              {section('out', 'Витрати', d.outflow, 'out')}
            </tbody>
            <tfoot>
              <tr className="cfn-net"><th scope="row">Чистий грошовий потік</th>
                {cols.map(c => <Num key={c.key} v={d.netByCol[c.key]} sign onClick={() => openDrill(null, c.key, null, 'Чистий потік', c.label)} />)}
                <Num v={d.netTotal} sign onClick={() => openDrill(null, 'total', null, 'Чистий потік', 'Разом')} /></tr>
              <tr className="cfn-close"><th scope="row">Залишок на кінець</th>
                {cols.map(c => <td key={c.key} className={d.closingByCol[c.key] < 0 ? 'is-neg' : ''}>{formatAmount(d.closingByCol[c.key], { decimals: 0 })}</td>)}
                <td className={d.closingCash < 0 ? 'is-neg' : ''}>{formatAmount(d.closingCash, { decimals: 0 })}</td></tr>
            </tfoot>
          </table>
        </div>
        <p className="cfn-muted cfn-sm cfn-foot">Залишок на початок періоду: {formatAmount(d.openingCash, { decimals: 0 })} ₴. Прямий метод: усі фактичні рухи коштів (валідовані й ні), на відміну від P&L. «Залишок на кінець» — накопичувально.</p>
      </section>

      <p className="cfn-muted cfn-sm cfn-mob-note">Прямий метод: усі фактичні рухи коштів. Натисніть на місяць на графіку, щоб побачити деталі.</p>

      <Sheet open={sheet} title="Статті руху коштів" onClose={() => setSheet(false)}>
          {[['in', 'Надходження', d.inflow], ['out', 'Витрати', d.outflow]].map(([k, label, sec]) => (
            <Fragment key={k}>
              <div className={`cfn-sheet-h is-${k}`}><span>{label}</span><b>{k === 'in' ? '+' : '−'}{plain(sec.total)}</b></div>
              <ul className="cfn-sheet-list">
                {sec.rows.map(r => (
                  <li key={r.article}><button type="button" onClick={() => { setSheet(false); openDrill(r.article, 'total', k, r.article, 'Разом') }}>
                    <span>{r.article}</span><b>{plain(r.total)}</b></button></li>
                ))}
              </ul>
            </Fragment>
          ))}
      </Sheet>
    </div>
  )
}

// Клітинка суми; клік відкриває транзакції. sign — показувати знак (чистий потік).
function Num({ v, onClick, sign, strong, heat, style }) {
  const n = Number(v) || 0
  if (!n) return <td className="cfn-zero">–</td>
  return (
    <td className={`${heat ? 'cfn-heat' : ''}${sign ? (n < 0 ? ' is-neg' : ' is-pos') : ''}${strong ? ' is-strong' : ''}`} style={style}>
      <button type="button" onClick={onClick}>{sign ? signed(n) : plain(n)}</button>
    </td>
  )
}

// ───────── P&L (ТЗ 5.1; макет PnL) ─────────
// Рядки bd — ті самі, що в старому вигляді (computeAccrualPL / computePLBreakdown): витрати (cogs, opex, below_line)
// там додатні — для показу ставимо «−». Підсумки йдуть у порядку: валовий, EBIT, до податків, чистий.
const COST_LEVELS = new Set(['cogs', 'opex', 'below_line'])
const dispSign = (r) => (r.type !== 'subtotal' && COST_LEVELS.has(r.level) ? -1 : 1)
const short = (v) => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(1).replace('.', ',') + ' млн' : a >= 1e3 ? Math.round(a / 1e3) + 'к' : String(Math.round(a)); return (v < 0 ? '−' : '') + s }

function plSummary(bd) {
  const head = (lvl) => bd.rows.find(r => r.type === 'header' && r.level === lvl)
  const subs = bd.rows.filter(r => r.type === 'subtotal')
  const t = (r) => r?.total || 0
  return { rev: t(head('revenue')), cogs: t(head('cogs')), gp: t(subs[0]), opex: t(head('opex')), ebit: t(subs[1]), oth: t(head('other_income')), np: t(subs[2]), below: t(head('below_line')), net: t(subs[3]), subs }
}

export function PLNew({ bd, acc, recon, plErr, year, month, setMonth, accrual, mode, planRows, setDrill, forecast, children }) {
  const [open, setOpen] = useState(() => new Set(['revenue']))
  const [mCol, setMCol] = useState('total')   // телефон: яку колонку показати в списку (чипи місяців)
  const cols = useMemo(() => {
    if (!bd) return []
    if (month || year !== NOW.getFullYear()) return bd.cols
    return bd.cols.filter(c => Number(c.key) <= NOW.getMonth() + 1)
  }, [bd, year, month])
  if (plErr) return <div className="cfn-card cfn-err">Не вдалося порахувати P&L: {plErr}</div>
  if (mode !== 'fact' && !accrual) return <PlanTable rows={planRows} mode={mode} />
  if (!bd) return <TableSkeleton rows={10} cols={6} label="Рахую прибуток…" />

  const s = plSummary(bd)
  const steps = [
    ['Виручка', 0, s.rev, 'total'], ['Собівартість', s.gp, s.rev, 'cost', -s.cogs], ['Валовий прибуток', 0, s.gp, 'total'],
    ['Операційні витрати', s.ebit, s.gp, 'cost', -s.opex], ['Операційний прибуток', 0, s.ebit, 'total'],
    ['Інші доходи / витрати', s.ebit, s.np, s.oth >= 0 ? 'gain' : 'cost', s.oth], ['Податки', s.net, s.np, 'cost', -s.below], ['Чистий прибуток', 0, s.net, 'net'],
  ].filter(x => x[3] === 'total' || x[3] === 'net' || Math.abs(x[4]) >= 1)
  const ends = steps.flatMap(x => [x[1], x[2]]), lo = Math.min(0, ...ends), hi = Math.max(1, ...ends), span = hi - lo || 1
  const pos = (a, b) => ({ left: `${((Math.min(a, b) - lo) / span) * 100}%`, width: `${Math.max(0.4, (Math.abs(b - a) / span) * 100)}%` })
  const pct = (v) => s.rev ? `${((v / s.rev) * 100).toFixed(1).replace('.', ',')}%` : '—'

  const monthly = !month && cols.length > 1
  const revRow = bd.rows.find(r => r.type === 'header' && r.level === 'revenue')
  const mMax = Math.max(1, ...cols.map(c => Math.max(revRow?.cells[c.key] || 0, s.subs[0]?.cells[c.key] || 0)))

  // таблиця: заголовки груп згортаються
  const vis = []; let cur = null
  bd.rows.forEach(r => { if (r.type === 'header') cur = r.level; else if (r.type === 'subtotal') cur = null; if (r.type === 'row' && !open.has(cur)) return; vis.push(r) })
  const toggle = (lvl) => setOpen(o => { const n = new Set(o); n.has(lvl) ? n.delete(lvl) : n.add(lvl); return n })
  const drill = (r, key, label) => r.articles && setDrill({ articles: r.articles, bucketKey: key, title: `${r.label} · ${label}`, validated: true })

  return (
    <div className="pln">
      <div className="pln-top">
        <section className="cfn-card pln-wf" aria-label="Від виручки до чистого прибутку">
          <div className="pln-wf-head">
            <div><span className="cfn-muted cfn-sm">Чистий прибуток · {periodLabel(year, month)}</span>
              <div className={`pln-big${s.net < 0 ? ' is-neg' : ''}`}>{formatAmount(s.net, { decimals: 0 })} <small>₴</small></div></div>
            <dl className="pln-marg"><div><dt>Валова маржа</dt><dd>{pct(s.gp)}</dd></div><div><dt>Чиста маржа</dt><dd>{pct(s.net)}</dd></div></dl>
          </div>
          <h3 className="pln-wf-title">Від виручки до прибутку</h3>
          <ul className="pln-wf-list">
            {steps.map(([label, a, b, kind, shown]) => (
              <li key={label} className={`is-${kind}`}>
                <span className="pln-wf-l">{label}</span>
                <span className="pln-wf-track"><span className="pln-wf-bar" style={pos(a, b)} /></span>
                <span className={`pln-wf-v${(shown ?? b) < 0 ? ' is-neg' : ''}`}>{formatAmount(shown ?? b, { decimals: 0 })}</span>
              </li>
            ))}
          </ul>
        </section>
        <div className="pln-side">
          {forecast}
          {accrual && acc?.missing?.length > 0 && (() => { const n = acc.missing.reduce((a, m) => a + m.items.length, 0); return (
            <button type="button" className="cfn-card pln-warn" onClick={() => {
              // HashRouter: «#якір» змінив би маршрут — прокручуємо до переліку й розгортаємо його
              const h = document.querySelector('#pl-missing [data-toggle]')
              if (h?.getAttribute('aria-expanded') === 'false') h.click()
              document.getElementById('pl-missing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}>
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <span><b>{n} {n === 1 ? 'позиція' : n < 5 ? 'позиції' : 'позицій'} без собівартості</b>
                <span className="cfn-sm">у {acc.missing.length} док. — прибуток завищено. Відкрити й виправити →</span></span>
            </button>) })()}
        </div>
      </div>

      {monthly && (
        <section className="cfn-card pln-months" aria-label="По місяцях">
          <div className="pln-months-head"><h2>По місяцях</h2>
            <div className="pln-legend"><span><i className="is-rev" />Виручка</span><span><i className="is-gp" />Валовий прибуток</span><span><i className="is-net" />Чистий прибуток</span></div></div>
          <div className="pln-mbars">
            {cols.map(c => {
              const rv = revRow?.cells[c.key] || 0, gp = s.subs[0]?.cells[c.key] || 0, nt = s.subs[3]?.cells[c.key] || 0
              return (
                <button key={c.key} type="button" className="pln-mbar" onClick={() => setMonth(Number(c.key))} aria-label={`${c.label}: виручка ${plain(rv)}, валовий ${formatAmount(gp, { decimals: 0 })}, чистий ${formatAmount(nt, { decimals: 0 })}`}>
                  <span className="pln-mbar-area">
                    {(rv || nt) ? <span className={`pln-mbar-net${nt < 0 ? ' is-neg' : ''}`}>{short(nt)}</span> : null}
                    <span className="pln-mbar-rev" style={{ height: `${(Math.max(0, rv) / mMax) * 100}%` }}>
                      <span className="pln-mbar-gp" style={{ height: rv > 0 ? `${Math.max(0, Math.min(1, gp / rv)) * 100}%` : 0 }} />
                    </span>
                  </span>
                  <span className="pln-mbar-lbl">{c.label}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="cfn-card cfn-report" aria-label="Звіт про прибутки та збитки">
        <div className="cfn-report-head"><h2>Звіт про прибутки та збитки</h2><span className="cfn-muted cfn-sm">від'ємні значення — зі знаком «−» · натисніть на цифру, щоб побачити операції</span></div>
        {cols.length > 1 && <div className="pln-mchips" role="group" aria-label="Період у списку">
          {[{ key: 'total', label: 'Разом' }, ...cols].map(c => <button key={c.key} type="button" aria-pressed={mCol === c.key} onClick={() => setMCol(c.key)}>{c.label}</button>)}
        </div>}
        <div className="cfn-tbl pln-tbl">
          <table>
            <thead><tr><th scope="col">Стаття</th>{cols.map(c => <th key={c.key} scope="col">{c.label}</th>)}<th scope="col">Разом</th></tr></thead>
            <tbody>
              {vis.map((r, i) => {
                const k = dispSign(r), last = r.type === 'subtotal' && r === s.subs[3]
                return (
                  <tr key={i} className={`pln-${r.type}${last ? ' is-net' : ''}`}>
                    <th scope="row">{r.type === 'header' && bd.rows.some(x => x.type === 'row' && x.level === r.level)
                      ? <button type="button" aria-expanded={open.has(r.level)} onClick={() => toggle(r.level)}><i className={`ti ${open.has(r.level) ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />{r.label}</button>
                      : r.label}</th>
                    {cols.map(c => <PlNum key={c.key} m={mCol === c.key} v={k * (r.cells[c.key] || 0)} onClick={r.articles ? () => drill(r, c.key, `${c.label} ${year}`) : null} />)}
                    <PlNum v={k * r.total} m={mCol === 'total' || cols.length <= 1} strong onClick={r.articles ? () => drill(r, 'total', `Разом ${year}`) : null} />
                  </tr>
                )
              })}
              {bd.rows.length === 0 && <tr><td colSpan={cols.length + 2} className="pln-empty">Немає даних за період</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="cfn-muted cfn-sm cfn-foot">{accrual
          ? <>Нарахування: виручка — видаткові й акти за датою документа, без ПДВ; собівартість — відвантажених позицій. Закупівлі до відвантаження — запас, не витрата. Операційні витрати — підтверджені оплати за датою оплати{acc?.excludedVat?.length ? `; ПДВ (${acc.excludedVat.map(x => `${x.label} ${plain(x.total)} ₴`).join(', ')}) — не витрата` : ''}.</>
          : <>Касовий: лише підтверджені транзакції за датою оплати.</>}</p>
      </section>

      {accrual && <ReconBridge recon={recon} />}
      {children}
    </div>
  )
}

function PlNum({ v, onClick, strong, m }) {
  if (!v) return <td className={`cfn-zero${m ? ' is-m' : ''}`}>–</td>
  const txt = formatAmount(v, { decimals: 0 })
  return <td className={`${v < 0 ? 'is-neg' : ''}${strong ? ' is-strong' : ''}${m ? ' is-m' : ''}`}>{onClick ? <button type="button" onClick={onClick}>{txt}</button> : txt}</td>
}

// План / порівняння (касовий режим) — та сама логіка, що раніше
function PlanTable({ rows, mode }) {
  if (!rows) return <TableSkeleton rows={10} cols={4} label="Рахую план…" />
  return (
    <section className="cfn-card cfn-report">
      <div className="cfn-tbl pln-tbl"><table>
        <thead><tr><th scope="col">Стаття</th>{mode === 'compare' && <th scope="col">Факт</th>}<th scope="col">План</th>{mode === 'compare' && <><th scope="col">Відхилення</th><th scope="col">%</th></>}</tr></thead>
        <tbody>{rows.map((r, i) => {
          // витрати (sign < 0) показуємо з «−»; відхилення — «краще / гірше плану» для прибутку
          const k = !r.subtotal && r.sign < 0 ? -1 : 1
          const dev = k * ((r.fact || 0) - (r.plan || 0)), pct = r.plan ? Math.round((r.fact / r.plan) * 100) : null
          return (
            <tr key={i} className={r.subtotal ? 'pln-subtotal' : r.header ? 'pln-header' : 'pln-row'}>
              <th scope="row">{r.label}</th>
              {mode === 'compare' && <PlNum v={k * (r.fact || 0)} />}
              <PlNum v={k * (r.plan || 0)} />
              {mode === 'compare' && <><td className={dev < 0 ? 'is-neg' : 'is-pos'}>{formatAmount(dev, { decimals: 0, sign: 'always' })}</td><td className="cfn-muted">{pct == null ? '—' : `${pct}%`}</td></>}
            </tr>
          )
        })}
        {rows.length === 0 && <tr><td colSpan={5} className="pln-empty">Немає даних за період</td></tr>}</tbody>
      </table></div>
    </section>
  )
}

// «Чому прибуток X, а грошей Y» — той самий розрахунок accrualReconciliation, що в старій «Звірці»
function ReconBridge({ recon: r }) {
  // телефон: згорнутий акордеон (макет PnLMobile)
  const [shut, setShut] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 767px)').matches)
  if (!r) return <TableSkeleton rows={6} cols={2} label="Звіряю з грошима…" />
  const ex = r.explained
  const known = ex.loans + ex.fixedAssets + ex.vat + ex.withdrawals + ex.other + ex.noArticle + ex.unvalidated + (ex.vatInDocs || 0)
  const lines = [
    ['Прибуток за нарахуванням', r.netProfit, 'total'],
    ['− дебіторка: виписано, ще не оплачено', -r.dAR], ['+ кредиторка: отримано, ще не оплачено', r.dAP], ['− запаси: куплено, ще не продано', -r.dInv],
    ['= Розрахунковий грошовий потік', r.estimated, 'total'],
    ['ПДВ у документах (у боргах, не в прибутку)', ex.vatInDocs || 0], ['ПДВ, сплачений до бюджету', ex.vat], ['Позики (ПФД)', ex.loans], ['Основні засоби', ex.fixedAssets],
    ['Вивід коштів', ex.withdrawals], ['Інше поза P&L', ex.other], ['Без статті', ex.noArticle], ['Непідтверджені транзакції', ex.unvalidated],
    ['Решта: оцінка складу, оплати без документів, аванси', r.diff - known],
    ['= Фактичний грошовий потік (банк + каса)', r.cashFlow, 'final'],
  ].filter(([, v, k]) => k || Math.abs(v) >= 1)
  const max = Math.max(1, ...lines.map(l => Math.abs(l[1])))
  return (
    <section className={`cfn-card pln-bridge${shut ? ' is-shut' : ''}`} aria-label="Звірка прибутку з грошима">
      <button type="button" className="pln-br-head" aria-expanded={!shut} onClick={() => setShut(x => !x)}>
        <span><h2>Чому прибуток {short(r.netProfit)}, а грошей {short(r.cashFlow)}</h2>
          <span className="cfn-muted cfn-sm">Звірка прибутку за нарахуванням із фактичним рухом грошей</span></span>
        <i className={`ti ti-chevron-${shut ? 'down' : 'up'}`} aria-hidden="true" /></button>
      {!shut && <>
      <ul>
        {lines.map(([label, v, k]) => (
          <li key={label} className={k ? `is-${k}` : ''}>
            <span className="pln-br-l">{label}</span>
            <span className="pln-br-track"><span className={`pln-br-bar${v < 0 ? ' is-neg' : ''}`} style={{ width: `${(Math.abs(v) / max) * 50}%` }} /></span>
            <span className={`pln-br-v${v < 0 ? ' is-neg' : k ? '' : ' is-pos'}`}>{formatAmount(v, { decimals: 0, sign: k ? 'auto' : 'always' })}</span>
          </li>
        ))}
      </ul>
      {r.opening && <p className="cfn-muted cfn-sm">На початок ({r.opening.date.split('-').reverse().join('.')}): дебіторка {plain(r.opening.receivable)}, кредиторка {plain(r.opening.payable)}, запаси {plain(r.opening.inventory)} ₴. Борги — з ПДВ, прибуток — без ПДВ, тому різниця на суму ПДВ очікувана.</p>}
      </>}
    </section>
  )
}

// Темна картка «Очікуваний результат» (дані — computeForecast, як у старій ForecastCard)
export function ForecastHero({ f0, accrualNet }) {
  if (!f0 || accrualNet === undefined) return <div className="pln-fc is-loading" aria-hidden="true" />
  const isAcc = accrualNet !== null
  const fact = isAcc ? accrualNet : f0.factNet, recv = isAcc ? 0 : f0.receivable
  const expected = isAcc ? accrualNet + (f0.pipelineMargin || 0) : f0.expected
  return (
    <section className="pln-fc" aria-label="Очікуваний результат">
      <span className="pln-fc-t">Очікуваний результат · оцінка</span>
      <b className={`pln-fc-v${expected < 0 ? ' is-neg' : ''}`}>≈ {formatAmount(expected, { decimals: 0 })} ₴</b>
      <dl>
        <div><dt>Фактичний результат{isAcc ? ' (нарахування)' : ''}</dt><dd>{formatAmount(fact, { decimals: 0 })}</dd></div>
        {!isAcc && <div><dt>+ дебіторка, чекає оплати</dt><dd className="is-warn">{formatAmount(recv, { decimals: 0, sign: 'always' })}</dd></div>}
        <div><dt>+ маржа {f0.pipelineCount} відкритих замовлень</dt><dd className="is-pos">{formatAmount(f0.pipelineMargin || 0, { decimals: 0, sign: 'always' })}</dd></div>
      </dl>
      <span className="pln-fc-note">Не факт: {isAcc ? 'додано' : 'додано виписані, але не оплачені документи й'} очікувану маржу замовлень без видаткової.{f0.pipelineNoItems > 0 ? ` У ${f0.pipelineNoItems} зам. немає позицій — їхня маржа не врахована.` : ''}</span>
    </section>
  )
}

// ───────── Баланс (ТЗ 5.1; макет Balance) ─────────
// Цифри — computeSnapshot / computeBalanceTrend, як і раніше. Майбутні місяці не показуються (ТЗ 6.6, помилка 7).
const monthName = (r) => `${MONTHS_FULL[r.m - 1]} ${r.y}`
const dmyEnd = (r) => `${String(new Date(r.y, r.m, 0).getDate()).padStart(2, '0')}.${String(r.m).padStart(2, '0')}.${r.y}`

export function BalanceSnapshotNew({ s, asOf, onDrill }) {
  if (!s) return <TableSkeleton rows={8} cols={2} label="Рахую баланс…" />
  const cash = s.cashBankTotal || 0, stock = s.stock?.totalValue || 0, recv = s.receivable || 0, pay = s.payable || 0
  const loans = s.loansNet || 0, fa = s.fixedAssets || 0
  const assets = cash + stock + recv + fa + (loans < 0 ? -loans : 0)
  const liab = pay + (loans > 0 ? loans : 0)
  const equity = cash + stock + recv + fa - pay - loans
  const accounts = (s.balances || []).filter(b => Math.abs(b.balance) > 0.005)
  const Line = ({ label, v, drill, sub }) => (
    <li className={sub ? 'is-sub' : ''}>
      {drill ? <button type="button" onClick={() => onDrill(drill)}>{label}<i className="ti ti-chevron-right" aria-hidden="true" /></button> : <span>{label}</span>}
      <b className={v < 0 ? 'is-neg' : ''}>{formatAmount(v, { decimals: 0 })}</b>
    </li>
  )
  return (
    <div className="bln">
      <section className="bln-hero" aria-label="Рівняння балансу">
        <div><span>Активи</span><b>{formatAmount(assets, { decimals: 0 })}</b></div>
        <i aria-hidden="true">−</i>
        <div><span>Зобов'язання</span><b>{formatAmount(liab, { decimals: 0 })}</b></div>
        <i aria-hidden="true">=</i>
        <div className="is-eq"><span>Власний капітал · {asOf}</span><b className={equity < 0 ? 'is-neg' : ''}>{formatAmount(equity, { decimals: 0 })} ₴</b></div>
      </section>
      <div className="bln-cols">
        <section className="cfn-card bln-list" aria-label="Активи">
          <h2>Активи <span>{formatAmount(assets, { decimals: 0 })} ₴</span></h2>
          <ul>
            <Line label="Гроші на рахунках і в касі" v={cash} />
            {accounts.map(a => <Line key={a.id} label={a.name} v={a.balance} sub />)}
            <Line label="Склад (за собівартістю)" v={stock} drill={stock ? { type: 'stock' } : null} />
            {fa !== 0 && <Line label="Основні засоби" v={fa} drill={{ type: 'fa' }} />}
            <Line label="Дебіторка — нам винні" v={recv} drill={recv ? { type: 'recv' } : null} />
            {loans < 0 && <Line label="Позики видані (ПФД) — нам повернуть" v={-loans} drill={{ type: 'loans' }} />}
          </ul>
        </section>
        <section className="cfn-card bln-list" aria-label="Зобов'язання">
          <h2>Зобов'язання <span>{formatAmount(liab, { decimals: 0 })} ₴</span></h2>
          <ul>
            <Line label="Кредиторка — ми винні" v={pay} drill={pay ? { type: 'pay' } : null} />
            {loans > 0 && <Line label="Позики отримані (ПФД) — до повернення" v={loans} drill={{ type: 'loans' }} />}
          </ul>
          <div className="bln-eq"><span>Власний капітал = активи − зобов'язання</span><b className={equity < 0 ? 'is-neg' : ''}>{formatAmount(equity, { decimals: 0 })} ₴</b></div>
        </section>
      </div>
      <p className="cfn-muted cfn-sm">Управлінський баланс: склад — товари за собівартістю; основні засоби — за вартістю купівлі, без амортизації; борги — неоплачені документи з ПДВ. Натисніть на рядок зі стрілкою — побачите склад суми.</p>
    </div>
  )
}

export function BalanceTrendNew({ trend, range, onCell, busyCell }) {
  const [pick, setPick] = useState(null)
  if (!trend) return <TableSkeleton rows={10} cols={8} label="Рахую динаміку…" />
  const all = trend.rows || []
  if (all.length < 1) return <div className="cfn-card cfn-muted">Немає даних за період</div>
  const base = all[0], rows = all.slice(1).length ? all.slice(1) : all
  const last = rows[rows.length - 1]
  const delta = last.equity - base.equity
  const pct = base.equity ? (delta / Math.abs(base.equity)) * 100 : null
  const parts = (a, b) => [
    ['Гроші', b.cash - a.cash], ['Склад', b.stock - a.stock], ['Основні засоби', (b.fixedAssets || 0) - (a.fixedAssets || 0)],
    ['Дебіторка', b.receivable - a.receivable], ['Кредиторка', -(b.payable - a.payable)], ['Позики (ПФД)', -(b.loans - a.loans)],
  ].filter(p => Math.abs(p[1]) > 0.5).sort((x, y) => x[1] - y[1])
  const sel = pick ? rows.find(r => r.label === pick) : null
  const selPrev = sel ? all[all.indexOf(sel) - 1] : null
  const contrib = sel && selPrev ? parts(selPrev, sel) : parts(base, last)
  const cMax = Math.max(1, Math.abs(sel ? sel.dEquity : delta), ...contrib.map(c => Math.abs(c[1])))
  const withD = rows.map((r, i) => ({ r, d: r.equity - (i ? rows[i - 1] : base).equity }))
  const best = withD.reduce((a, x) => (x.d > a.d ? x : a), withD[0]), worst = withD.reduce((a, x) => (x.d < a.d ? x : a), withD[0])

  // стек-стовпці: активи вгору, зобов'язання вниз
  const up = (r) => [['cash', Math.max(0, r.cash)], ['stock', Math.max(0, r.stock)], ['fa', Math.max(0, r.fixedAssets || 0)], ['recv', Math.max(0, r.receivable)], ['loanOut', Math.max(0, -r.loans)]]
  const down = (r) => [['pay', Math.max(0, r.payable)], ['loans', Math.max(0, r.loans)], ['cashNeg', Math.max(0, -r.cash)]]
  const sum = (xs) => xs.reduce((a, x) => a + x[1], 0)
  const maxUp = Math.max(1, ...rows.map(r => sum(up(r)))), maxDown = Math.max(1, ...rows.map(r => sum(down(r))))
  const upH = 100 * maxUp / (maxUp + maxDown)

  const cell = (r, v, type, neg) => {
    const busy = busyCell === `${r.label}:${type}`
    if (!v) return <td className="cfn-zero">·</td>
    return <td className={neg ? 'is-neg' : ''}><button type="button" disabled={busy} onClick={() => onCell(r, type)}>{formatAmount(v, { decimals: 0 })}{busy ? '…' : ''}</button></td>
  }

  return (
    <div className="bln">
      <section className="bln-hero is-trend" aria-label="Зміна капіталу">
        <div><span>Власний капітал · {dmyEnd(base)}</span><b className="is-sm">{formatAmount(base.equity, { decimals: 0 })} ₴</b></div>
        <i className="ti ti-arrow-right" aria-hidden="true" />
        <div><span>Власний капітал · {dmyEnd(last)}</span><b>{formatAmount(last.equity, { decimals: 0 })} ₴</b></div>
        <div className="bln-hero-d"><span>Зміна за період</span><b className={delta < 0 ? 'is-neg' : ''}>{formatAmount(delta, { decimals: 0, sign: 'always' })}</b>
          {pct != null && <small>{formatAmount(pct, { decimals: 0, sign: 'always' })}% за період</small>}</div>
      </section>

      <section className="cfn-card" aria-label="Структура балансу по місяцях">
        <div className="pln-months-head"><h2>Структура балансу по місяцях</h2>
          <div className="pln-legend bln-legend">{[['cash', 'Гроші'], ['stock', 'Склад'], ['fa', 'Основні засоби'], ['recv', 'Дебіторка'], ['pay', 'Кредиторка'], ['loans', 'Позики (ПФД)']].map(([k, l]) => <span key={k}><i className={`bln-c-${k}`} />{l}</span>)}<span><i className="bln-c-eq" />Капітал</span></div></div>
        <div className="bln-scroll">
          <div className="bln-bars" style={{ '--up': `${upH}%` }}>
            {rows.map(r => (
              <button key={r.label} type="button" className="bln-bar" aria-pressed={pick === r.label} onClick={() => setPick(p => p === r.label ? null : r.label)}
                aria-label={`${monthName(r)}: капітал ${formatAmount(r.equity, { decimals: 0 })}`}>
                <span className={`bln-eqlbl${r.equity < 0 ? ' is-neg' : ''}`}>{short(r.equity)}</span>
                <span className="bln-up">{up(r).map(([k, v]) => v > 0 && <span key={k} className={`bln-c-${k}`} style={{ height: `${(v / maxUp) * 100}%` }} />)}</span>
                <span className="bln-down">{down(r).map(([k, v]) => v > 0 && <span key={k} className={`bln-c-${k}`} style={{ height: `${(v / maxDown) * 100}%` }} />)}</span>
                <span className="bln-mlbl">{String(r.m).padStart(2, '0')}{rows.some(x => x.y !== r.y) && r.m === 1 ? `.${String(r.y).slice(2)}` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="bln-mid">
        <section className="cfn-card pln-bridge" aria-label="Що змінило капітал">
          <h2>{sel ? `Що змінило капітал: ${monthName(sel)}` : `Що змінило капітал ${range === 'ytd' ? 'з початку року' : 'з початку діяльності'}`}</h2>
          <p className="cfn-muted cfn-sm">Ріст активу або зменшення боргу збільшує капітал, і навпаки{sel ? ' · натисніть місяць ще раз, щоб повернутися до всього періоду' : ' · натисніть на місяць на графіку — покаже саме його'}</p>
          <ul>
            {contrib.map(([k, v]) => (
              <li key={k}><span className="pln-br-l">{k}</span><span className="pln-br-track"><span className={`pln-br-bar${v < 0 ? ' is-neg' : ''}`} style={{ width: `${(Math.abs(v) / cMax) * 50}%` }} /></span>
                <span className={`pln-br-v ${v < 0 ? 'is-neg' : 'is-pos'}`}>{formatAmount(v, { decimals: 0, sign: 'always' })}</span></li>
            ))}
            {(() => { const v = sel ? sel.equity - selPrev.equity : delta; return (
              <li className="is-total"><span className="pln-br-l">Зміна капіталу</span><span className="pln-br-track"><span className={`pln-br-bar${v < 0 ? ' is-neg' : ''}`} style={{ width: `${(Math.abs(v) / cMax) * 50}%` }} /></span>
                <span className={`pln-br-v ${v < 0 ? 'is-neg' : 'is-pos'}`}>{formatAmount(v, { decimals: 0, sign: 'always' })}</span></li>) })()}
          </ul>
        </section>
        {rows.length > 1 && (
          <div className="bln-bw">
            <div className="cfn-card bln-best"><span>Найкращий місяць</span><b>{formatAmount(best.d, { decimals: 0, sign: 'always' })}</b><small>{monthName(best.r)}</small></div>
            <div className="cfn-card bln-worst"><span>Найбільше просідання</span><b>{formatAmount(worst.d, { decimals: 0, sign: 'always' })}</b><small>{monthName(worst.r)}</small></div>
          </div>
        )}
      </div>

      <section className="cfn-card cfn-report" aria-label="Баланс по місяцях">
        <div className="cfn-tbl bln-tbl">
          <table>
            <thead><tr><th scope="col">Місяць</th><th scope="col">Гроші</th><th scope="col">Склад</th><th scope="col">ОЗ</th><th scope="col">Дебіторка</th><th scope="col">Кредиторка</th><th scope="col">ПФД</th><th scope="col">Капітал</th><th scope="col">Зміна</th></tr></thead>
            <tbody>
              {[...withD].reverse().map(({ r, d }) => (
                <tr key={r.label} className={pick === r.label ? 'is-picked' : ''}>
                  <th scope="row"><button type="button" onClick={() => setPick(p => p === r.label ? null : r.label)}>{monthName(r)}</button></th>
                  {cell(r, r.cash, 'cash', r.cash < 0)}{cell(r, r.stock, 'stock')}{cell(r, r.fixedAssets, 'fa')}{cell(r, r.receivable, 'recv')}
                  {cell(r, r.payable, 'pay', true)}{cell(r, r.loans, 'loans', r.loans > 0)}
                  <td className="is-strong">{formatAmount(r.equity, { decimals: 0 })}</td>
                  <td>{Math.round(d) ? <span className={`cfn-pill ${d < 0 ? 'is-neg' : 'is-pos'}`}>{formatAmount(d, { decimals: 0, sign: 'always' })}</span> : <span className="cfn-zero">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cfn-muted cfn-sm cfn-foot">Кожен рядок — стан на кінець місяця. Капітал = гроші + склад + ОЗ + дебіторка − кредиторка − ПФД. Натисніть на цифру — побачите, з чого вона складається; на місяць — що змінило капітал. Майбутні місяці не показуються.</p>
      </section>
    </div>
  )
}

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
export function PeriodChips({ year, setYear, month, setMonth, years }) {
  const lastMonth = year === NOW.getFullYear() ? NOW.getMonth() + 1 : 12
  return (
    <div className="an-period">
      <select className="form-input an-year" value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Рік">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
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

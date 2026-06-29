import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { fmt, fmtInt } from '../lib/fmt'
import { PL_ORDER, PL_LABELS } from '../lib/articles'
import { computePL, computePLBreakdown, computeAging, dashboardStats, plDrill } from '../lib/pl'

const NOW = new Date()
const YEARS = [NOW.getFullYear(), NOW.getFullYear() - 1, NOW.getFullYear() - 2]
const MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']

// Доходи зеленуваті, витрати червонуваті
const GREEN = '#15803D', RED = '#DC2626', AMBER = '#B45309'
const INCOME_LEVELS = new Set(['revenue', 'other_income'])
function plColor(r, v) {
  if (!v) return 'var(--text3)'
  if (r.type === 'subtotal') return v >= 0 ? GREEN : RED
  return INCOME_LEVELS.has(r.level) ? GREEN : RED
}

// Клітинка матриці: основне (підтверджене) число + дрібне превʼю непідтверджених
function Cell({ r, v, pv, bucketKey, colLabel, setDrill, showPending, bold }) {
  const clickable = r.articles && v
  return (
    <>
      <span
        onClick={clickable ? () => setDrill({ articles: r.articles, bucketKey, title: `${r.label} · ${colLabel}`, validated: true }) : undefined}
        style={{ color: plColor(r, v), fontWeight: bold ? 700 : undefined, cursor: clickable ? 'pointer' : 'default', textDecoration: clickable ? 'underline dotted' : 'none', textUnderlineOffset: 3 }}>
        {v ? fmtInt(v) : '·'}
      </span>
      {showPending && pv ? (
        <div title="Непідтверджені (не входять у підсумок)"
          onClick={r.articles ? () => setDrill({ articles: r.articles, bucketKey, title: `${r.label} · ${colLabel} (непідтверджені)`, validated: false }) : undefined}
          style={{ fontSize: 10, color: AMBER, cursor: r.articles ? 'pointer' : 'default', marginTop: 1 }}>
          ~{fmtInt(pv)}
        </div>
      ) : null}
    </>
  )
}

export default function Analytics() {
  const [tab, setTab] = useState('overview')
  return (
    <div>
      <div className="page-header"><h1>Аналітика</h1></div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {[['overview', 'Огляд', 'ti-dashboard'], ['pl', 'P&L', 'ti-report-money'], ['aging', 'Борги', 'ti-clock-dollar']].map(([id, lbl, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}><i className={`ti ${icon}`} style={{ fontSize: 15 }} />{lbl}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'pl' && <PLView />}
      {tab === 'aging' && <AgingView />}
    </div>
  )
}
const tabStyle = (active) => ({
  padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
  fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
  borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent', color: active ? 'var(--blue)' : 'var(--text2)',
})

// ───────── Огляд (Dashboard) ─────────
function Overview() {
  const navigate = useNavigate()
  const [s, setS] = useState(null)
  useEffect(() => { dashboardStats(NOW.getFullYear()).then(setS) }, [])
  if (!s) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>

  const chartData = s.series.map((r, i) => ({ ...r, month: MONTHS[i] }))
  return (
    <div>
      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <Kpi label="Виручка (місяць)" value={s.revenue} color="var(--green)" />
        <Kpi label="Витрати (місяць)" value={s.expenses} color="var(--red)" />
        <Kpi label="Прибуток (місяць)" value={s.profit} color={s.profit >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Kpi label="Дебіторка" value={s.receivable} color="var(--green)" onClick={() => {}} />
        <Kpi label="Кредиторка" value={s.payable} color="var(--red)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        {s.accounts.map(a => (
          <div className="kpi" key={a.name}>
            <div className="kpi-label">{a.name}</div>
            <div className="kpi-value" style={{ fontSize: 20, color: a.balance >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtInt(a.balance)} <span style={{ fontSize: 12, color: 'var(--text3)' }}>грн</span></div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Доходи / Витрати по місяцях ({NOW.getFullYear()})</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtInt(v / 1000) + 'k'} width={48} />
            <Tooltip formatter={v => fmtInt(v) + ' грн'} />
            <Legend />
            <Bar dataKey="Доходи" fill="#16A34A" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Витрати" fill="#DC2626" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="card-title">Топ клієнтів за доходом ({NOW.getFullYear()})</div>
        {s.topClients.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Немає даних</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table><thead><tr><th>Клієнт</th><th style={{ textAlign: 'right' }}>Дохід</th></tr></thead>
              <tbody>{s.topClients.map((c, i) => <tr key={i}><td><div className="trunc">{c.name}</div></td><td className="amt-pos" style={{ textAlign: 'right' }}>{fmtInt(c.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, color, onClick }) {
  return (
    <div className="kpi" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{fmtInt(value)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div>
    </div>
  )
}

// ───────── P&L ─────────
function PLView() {
  const [year, setYear] = useState(NOW.getFullYear())
  const [month, setMonth] = useState(0) // 0 = весь рік
  const [mode, setMode] = useState('fact') // fact | plan | compare
  const [data, setData] = useState(null)
  const [bd, setBd] = useState(null) // матриця Факт по періодах
  const [drill, setDrill] = useState(null) // { articles, bucketKey, title, validated }
  const [showPending, setShowPending] = useState(false) // превʼю непідтверджених

  useEffect(() => {
    setData(null); setBd(null)
    if (mode === 'fact') computePLBreakdown(year, month || null, { includePending: showPending }).then(setBd)
    else computePL(year, month || null).then(setData)
  }, [year, month, mode, showPending])

  const rows = useMemo(() => {
    if (!data) return []
    const out = []
    const t = data.totals
    PL_ORDER.forEach(key => {
      if (key.startsWith('_')) {
        const map = { _gp: 'gp', _ebit: 'ebit', _np: 'np', _net: 'net' }
        out.push({ subtotal: true, label: PL_LABELS[key], fact: t.fact[map[key]], plan: t.plan[map[key]] })
      } else {
        const sec = data.sections.find(s => s.level === key)
        if (!sec) return
        out.push({ header: true, label: sec.label, fact: sec.factSum, plan: sec.planSum, sign: sec.sign })
        sec.rows.forEach(r => out.push({ label: r.name, fact: r.fact, plan: r.plan, sign: sec.sign }))
      }
    })
    return out
  }, [data])

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-input" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 110 }}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <select className="form-input" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 130 }}>
          <option value={0}>Весь рік</option>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        {mode === 'fact' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: AMBER, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={showPending} onChange={e => setShowPending(e.target.checked)} />
            + непідтверджені (превʼю)
          </label>
        )}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {[['fact', 'Факт'], ['plan', 'План'], ['compare', 'Порівняння']].map(([k, lbl]) => (
            <button key={k} onClick={() => setMode(k)} className="btn" style={{ background: mode === k ? 'var(--blue)' : 'var(--surface)', color: mode === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>{lbl}</button>
          ))}
        </div>
      </div>

      <div className="card">
        {mode === 'fact' ? (
          !bd ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : (
            <div className="tbl-wrap" style={{ border: 'none' }}>
              <table>
                <thead><tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>Стаття</th>
                  {bd.cols.map(c => <th key={c.key} style={{ textAlign: 'right' }}>{c.label}</th>)}
                  <th style={{ textAlign: 'right' }}>Разом</th>
                </tr></thead>
                <tbody>
                  {bd.rows.map((r, i) => {
                    const style = r.type === 'subtotal' ? { fontWeight: 700, background: 'var(--surface2)' } : r.type === 'header' ? { fontWeight: 600 } : {}
                    const stickyBg = r.type === 'subtotal' ? 'var(--surface2)' : 'var(--surface)'
                    return (
                      <tr key={i} style={style}>
                        <td style={{ paddingLeft: r.type === 'row' ? 24 : 12, position: 'sticky', left: 0, background: stickyBg, whiteSpace: 'nowrap', zIndex: 1 }}>{r.label}</td>
                        {bd.cols.map(c => (
                          <td key={c.key} style={{ textAlign: 'right' }}>
                            <Cell r={r} v={r.cells[c.key] || 0} pv={(r.pending || {})[c.key] || 0} bucketKey={c.key}
                              colLabel={`${c.label} ${month ? MONTHS[month - 1] : ''} ${year}`} setDrill={setDrill} showPending={showPending} />
                          </td>
                        ))}
                        <td style={{ textAlign: 'right' }}>
                          <Cell r={r} v={r.total} pv={r.pendingTotal || 0} bucketKey="total" bold
                            colLabel={`Разом ${year}`} setDrill={setDrill} showPending={showPending} />
                        </td>
                      </tr>
                    )
                  })}
                  {bd.rows.length === 0 && <tr><td colSpan={bd.cols.length + 2} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Немає валідованих даних за період</td></tr>}
                </tbody>
              </table>
            </div>
          )
        ) : !data ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <th>Стаття</th>
                {(mode === 'fact' || mode === 'compare') && <th style={{ textAlign: 'right' }}>Факт</th>}
                {(mode === 'plan' || mode === 'compare') && <th style={{ textAlign: 'right' }}>План</th>}
                {mode === 'compare' && <th style={{ textAlign: 'right' }}>Відхил.</th>}
                {mode === 'compare' && <th style={{ textAlign: 'right' }}>%</th>}
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const dev = (r.fact || 0) - (r.plan || 0)
                  const pct = r.plan ? Math.round((r.fact / r.plan) * 100) : null
                  const style = r.subtotal ? { fontWeight: 700, background: 'var(--surface2)' } : r.header ? { fontWeight: 600 } : {}
                  const factColor = !r.fact ? undefined : r.subtotal ? (r.fact >= 0 ? GREEN : RED) : r.sign > 0 ? GREEN : r.sign < 0 ? RED : undefined
                  return (
                    <tr key={i} style={style}>
                      <td style={{ paddingLeft: r.header || r.subtotal ? 12 : 28 }}>{r.label}</td>
                      {(mode === 'fact' || mode === 'compare') && <td style={{ textAlign: 'right', color: factColor }}>{fmtInt(r.fact)}</td>}
                      {(mode === 'plan' || mode === 'compare') && <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{fmtInt(r.plan)}</td>}
                      {mode === 'compare' && <td style={{ textAlign: 'right', color: dev >= 0 ? 'var(--green)' : 'var(--red)' }}>{dev >= 0 ? '+' : ''}{fmtInt(dev)}</td>}
                      {mode === 'compare' && <td style={{ textAlign: 'right', color: 'var(--text3)', fontSize: 12 }}>{pct == null ? '—' : pct + '%'}</td>}
                    </tr>
                  )
                })}
                {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Немає валідованих даних за період</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>У P&L враховуються лише підтверджені (is_validated) транзакції. Натисніть на цифру, щоб побачити операції.</p>
      </div>
      {drill && <DrillModal drill={drill} year={year} month={month || null} onClose={() => setDrill(null)} />}
    </div>
  )
}

// ───────── Drill-down: операції за клітинкою P&L ─────────
function DrillModal({ drill, year, month, onClose }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { plDrill(year, month, drill.bucketKey, drill.articles, { validated: drill.validated }).then(setRows) }, [drill])
  const total = (rows || []).reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', zIndex: 1000, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 700, boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{drill.title}</div>
          <button className="btn" onClick={onClose} style={{ flexShrink: 0 }}><i className="ti ti-x" /></button>
        </div>
        {!rows ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : rows.length === 0 ? <p style={{ color: 'var(--text3)' }}>Немає транзакцій</p> : (
          <div className="tbl-wrap" style={{ border: 'none', maxHeight: '62vh', overflow: 'auto' }}>
            <table>
              <thead><tr><th>Дата</th><th>Контрагент</th><th>Стаття</th><th style={{ textAlign: 'right' }}>Сума</th></tr></thead>
              <tbody>
                {rows.map(t => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                    <td><div className="trunc" title={t.counterparty || ''}>{t.counterparty || '—'}</div>{t.description && <div className="trunc" style={{ fontSize: 11, color: 'var(--text3)' }}>{t.description}</div>}</td>
                    <td><div className="trunc">{t.article}</div></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: t.direction === 'Доходи' ? GREEN : RED }}>{fmtInt(Math.abs(Number(t.amount) || 0))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={3}>Разом ({rows.length})</td><td style={{ textAlign: 'right' }}>{fmtInt(total)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ───────── Борги (Aging) ─────────
function AgingView() {
  const [data, setData] = useState(null)
  useEffect(() => { computeAging().then(setData) }, [])
  if (!data) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <AgingBlock title="Дебіторка — клієнти винні нам" data={data.receivable} keys={data.bucketKeys} color="var(--green)" />
      <AgingBlock title="Кредиторка — ми винні постачальникам" data={data.payable} keys={data.bucketKeys} color="var(--red)" />
      {data.receivable.total === 0 && data.payable.total === 0 && (
        <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center' }}>Боргів немає. (Суми наповнюються з документів — додавайте суми документів через OCR/генерацію та прив'язуйте оплати.)</p>
      )}
    </div>
  )
}

function AgingBlock({ title, data, keys, color }) {
  if (data.total === 0) return null
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{title}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color }}>{fmtInt(data.total)} грн</div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {keys.map(k => (
          <div key={k} style={{ flex: '1 1 100px', background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{k} дн</div>
            <div style={{ fontWeight: 600 }}>{fmtInt(data.buckets[k])}</div>
          </div>
        ))}
      </div>
      <div className="tbl-wrap" style={{ border: 'none' }}>
        <table><thead><tr><th>Контрагент</th><th style={{ textAlign: 'right' }}>Сума</th></tr></thead>
          <tbody>{data.top.slice(0, 15).map((c, i) => <tr key={i}><td><div className="trunc">{c.name}</div></td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtInt(c.amount)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

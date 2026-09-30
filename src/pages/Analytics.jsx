import { useEffect, useMemo, useState } from 'react'
import { qc } from '../lib/companyScope'
import { fmtInt } from '../lib/fmt'
import { PL_ORDER, PL_LABELS, fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import * as XLSX from 'xlsx'
import { computePL, computePLBreakdown, computeForecast, plDrill, computeAging } from '../lib/pl'
import { computeCashFlow, cashFlowDrill } from '../lib/cashflow'
import { computeSnapshot } from '../lib/periodClose'

const DIRECTIONS = ['Доходи', 'Витрати', 'Інше', 'ПФД']

const NOW = new Date()
const YEARS = [NOW.getFullYear(), NOW.getFullYear() - 1, NOW.getFullYear() - 2]
const MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']

const GREEN = '#15803D', RED = '#DC2626', AMBER = '#B45309'
const si = (v) => (v < 0 ? '−' : '') + fmtInt(v)          // ціле зі знаком (fmtInt віддає abs)
const signColor = (v) => (v >= 0 ? GREEN : RED)

const INCOME_LEVELS = new Set(['revenue', 'other_income'])
function plColor(r, v) {
  if (!v) return 'var(--text3)'
  if (r.type === 'subtotal') return v >= 0 ? GREEN : RED
  return INCOME_LEVELS.has(r.level) ? GREEN : RED
}

// ───────── Каркас ─────────
export default function Analytics() {
  const [tab, setTab] = useState('cashflow')
  return (
    <div>
      <div className="page-header"><h1>Аналітика</h1></div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {[['cashflow', 'Cash Flow', 'ti-arrows-exchange'], ['pl', 'P&L', 'ti-report-money'], ['balance', 'Баланс', 'ti-scale']].map(([id, lbl, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}><i className={`ti ${icon}`} style={{ fontSize: 15 }} />{lbl}</button>
        ))}
      </div>
      {tab === 'cashflow' && <CashFlowView />}
      {tab === 'pl' && <PLView />}
      {tab === 'balance' && <BalanceView />}
    </div>
  )
}
const tabStyle = (active) => ({
  padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
  fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
  borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent', color: active ? 'var(--blue)' : 'var(--text2)',
})

// Спільний вибір періоду (рік + місяць)
function PeriodPicker({ year, setYear, month, setMonth }) {
  return (
    <>
      <select className="form-input" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 110 }}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
      <select className="form-input" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 130 }}>
        <option value={0}>Весь рік</option>
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
    </>
  )
}

// ───────── Cash Flow (рух грошей, прямий метод) ─────────
function CashFlowView() {
  const [year, setYear] = useState(NOW.getFullYear())
  const [month, setMonth] = useState(0)
  const [d, setD] = useState(null)
  const [debt, setDebt] = useState(null)   // дебіторка/кредиторка (нам винні / ми винні)
  const [drill, setDrill] = useState(null)

  const reload = () => { setD(null); computeCashFlow(year, month || null).then(setD) }
  useEffect(() => { reload() }, [year, month])
  useEffect(() => { computeAging().then(setDebt) }, [])

  // Відкрити перелік транзакцій за клітинкою (стаття × період × напрям руху)
  const openDrill = (article, bucketKey, sign, name, colLabel) =>
    setDrill({ year, month: month || null, article, bucketKey, sign, title: `${name} · ${colLabel}` })

  const exportXlsx = () => {
    if (!d) return
    const head = ['Стаття', ...d.cols.map(c => c.label), 'Разом']
    const aoa = [head]
    const secToAoa = (title, sec, sign) => {
      aoa.push([title, ...d.cols.map(c => sec.totalByCol[c.key] ? sign * sec.totalByCol[c.key] : ''), sign * sec.total])
      sec.rows.forEach(r => aoa.push([r.article, ...d.cols.map(c => r.cells[c.key] ? sign * r.cells[c.key] : ''), sign * r.total]))
    }
    secToAoa('НАДХОДЖЕННЯ', d.inflow, 1)
    secToAoa('ВИТРАТИ', d.outflow, -1)
    aoa.push(['Чистий грошовий потік', ...d.cols.map(c => d.netByCol[c.key] || ''), d.netTotal])
    aoa.push(['Залишок на початок', ...d.cols.map(() => ''), d.openingCash])
    aoa.push(['Залишок на кінець', ...d.cols.map(c => d.closingByCol[c.key]), d.closingCash])
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Cash Flow')
    XLSX.writeFile(wb, `CashFlow_${year}${month ? '-' + String(month).padStart(2, '0') : ''}.xlsx`)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} />
        <button className="btn" onClick={exportXlsx} disabled={!d} style={{ marginLeft: 'auto' }}><i className="ti ti-file-spreadsheet" /> Експорт Excel</button>
      </div>

      {!d ? <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div> : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <div className="kpi"><div className="kpi-label">Надходження</div><div className="kpi-value" style={{ color: GREEN }}>{fmtInt(d.inflow.total)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div></div>
            <div className="kpi"><div className="kpi-label">Витрати</div><div className="kpi-value" style={{ color: RED }}>{fmtInt(d.outflow.total)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div></div>
            <div className="kpi"><div className="kpi-label">Чистий потік</div><div className="kpi-value" style={{ color: signColor(d.netTotal) }}>{si(d.netTotal)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div></div>
            {debt && debt.receivable.total > 0 && (
              <div className="kpi" style={{ borderLeft: `3px solid ${AMBER}`, background: '#FFFBEB' }}>
                <div className="kpi-label" style={{ color: AMBER }}>Нам винні (дебіторка)</div>
                <div className="kpi-value" style={{ color: AMBER }}>{fmtInt(debt.receivable.total)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div>
              </div>
            )}
            <div className="kpi"><div className="kpi-label">Залишок на кінець</div><div className="kpi-value" style={{ color: signColor(d.closingCash) }}>{si(d.closingCash)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div></div>
          </div>
          {debt && debt.receivable.total > 0 && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#FFFBEB', border: `1px solid ${AMBER}33`, borderRadius: 8, fontSize: 13, color: 'var(--text2)' }}>
              <i className="ti ti-cash" style={{ color: AMBER }} /> З урахуванням дебіторки чистий потік був би <b style={{ color: AMBER }}>{si(d.netTotal + debt.receivable.total)} грн</b>
              <span style={{ color: 'var(--text3)' }}> — це вже зароблені гроші за виписаними видатковими/актами, які ще не надійшли на рахунок.</span>
            </div>
          )}

          <div className="card">
            <div className="tbl-wrap" style={{ border: 'none' }}>
              <table>
                <thead><tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>Стаття</th>
                  {d.cols.map(c => <th key={c.key} style={{ textAlign: 'right' }}>{c.label}</th>)}
                  <th style={{ textAlign: 'right' }}>Разом</th>
                </tr></thead>
                <tbody>
                  <CfHeader label="Надходження" sec={d.inflow} cols={d.cols} color={GREEN} sign="in" openDrill={openDrill} />
                  {d.inflow.rows.map((r, i) => <CfRow key={'i' + i} r={r} cols={d.cols} color={GREEN} sign="in" openDrill={openDrill} />)}
                  <CfHeader label="Витрати" sec={d.outflow} cols={d.cols} color={RED} sign="out" openDrill={openDrill} />
                  {d.outflow.rows.map((r, i) => <CfRow key={'o' + i} r={r} cols={d.cols} color={RED} sign="out" openDrill={openDrill} />)}
                  <tr style={{ fontWeight: 700, background: 'var(--surface2)' }}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--surface2)', whiteSpace: 'nowrap' }}>Чистий грошовий потік</td>
                    {d.cols.map(c => <DrillCell key={c.key} value={d.netByCol[c.key]} signed color={signColor(d.netByCol[c.key] || 0)} onClick={() => openDrill(null, c.key, null, 'Чистий потік', c.label)} />)}
                    <DrillCell value={d.netTotal} signed color={signColor(d.netTotal)} bold onClick={() => openDrill(null, 'total', null, 'Чистий потік', 'Разом')} />
                  </tr>
                  <tr style={{ color: 'var(--text2)' }}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', whiteSpace: 'nowrap' }}>Залишок на кінець</td>
                    {d.cols.map(c => <td key={c.key} style={{ textAlign: 'right' }}>{si(d.closingByCol[c.key])}</td>)}
                    <td style={{ textAlign: 'right', fontWeight: 700, color: signColor(d.closingCash) }}>{si(d.closingCash)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>Залишок на початок періоду: <b>{si(d.openingCash)} грн</b>. Прямий метод: усі фактичні рухи коштів (валідовані й ні), на відміну від P&L (лише підтверджені). Натисніть на цифру — побачите й зможете відредагувати транзакції. «Залишок на кінець» — накопичувально.</p>
          </div>
        </>
      )}
      {drill && <CashFlowDrillModal drill={drill} onClose={() => setDrill(null)} onSaved={() => { setDrill(null); reload() }} />}
    </div>
  )
}
// Клітинка-число з drill-down по кліку (якщо є значення)
function DrillCell({ value, color, bold, signed, onClick }) {
  const v = Number(value) || 0
  const text = v ? (signed ? si(v) : fmtInt(Math.abs(v))) : '·'
  const clickable = !!v && onClick
  return (
    <td style={{ textAlign: 'right', color, fontWeight: bold ? 700 : undefined }}>
      <span onClick={clickable ? onClick : undefined} style={{ cursor: clickable ? 'pointer' : 'default', textDecoration: clickable ? 'underline dotted' : 'none', textUnderlineOffset: 3 }}>{text}</span>
    </td>
  )
}
function CfHeader({ label, sec, cols, color, sign, openDrill }) {
  return (
    <tr style={{ fontWeight: 600, background: 'var(--surface2)' }}>
      <td style={{ position: 'sticky', left: 0, background: 'var(--surface2)', whiteSpace: 'nowrap', color }}>{label}</td>
      {cols.map(c => <DrillCell key={c.key} value={sec.totalByCol[c.key]} color={color} onClick={() => openDrill(null, c.key, sign, label, c.label)} />)}
      <DrillCell value={sec.total} color={color} bold onClick={() => openDrill(null, 'total', sign, label, 'Разом')} />
    </tr>
  )
}
function CfRow({ r, cols, color, sign, openDrill }) {
  return (
    <tr>
      <td style={{ paddingLeft: 24, position: 'sticky', left: 0, background: 'var(--surface)', whiteSpace: 'nowrap' }}>{r.article}</td>
      {cols.map(c => <DrillCell key={c.key} value={r.cells[c.key]} onClick={() => openDrill(r.article, c.key, sign, r.article, c.label)} />)}
      <DrillCell value={r.total} color={color} bold onClick={() => openDrill(r.article, 'total', sign, r.article, 'Разом')} />
    </tr>
  )
}

// Перелік транзакцій за клітинкою Cash Flow + інлайн-редагування напряму/статті
function CashFlowDrillModal({ drill, onClose, onSaved }) {
  const [rows, setRows] = useState(null)
  const [articles, setArticles] = useState([])
  const [edits, setEdits] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetchArticles().then(setArticles) }, [])
  useEffect(() => { setRows(null); setEdits({}); cashFlowDrill(drill.year, drill.month, drill).then(setRows) }, [drill])
  const grouped = useMemo(() => groupByType(articles), [articles])
  const setEdit = (id, patch) => setEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }))
  const val = (t, f) => (edits[t.id]?.[f] !== undefined ? edits[t.id][f] : (t[f] || ''))
  const dirty = Object.keys(edits).filter(id => { const e = edits[id]; return e && (e.direction !== undefined || e.article !== undefined) }).length

  const save = async () => {
    setBusy(true)
    for (const [id, patch] of Object.entries(edits)) {
      const upd = {}
      if (patch.direction !== undefined) upd.direction = patch.direction || null
      if (patch.article !== undefined) { upd.article = patch.article || null; upd.article_id = articles.find(a => a.name === patch.article)?.id || null }
      if (Object.keys(upd).length) await qc('bank_transactions').update(upd).eq('id', id)
    }
    setBusy(false); onSaved()
  }
  const total = (rows || []).reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', zIndex: 1000, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 860, boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{drill.title}</div>
          <button className="btn" onClick={onClose} style={{ flexShrink: 0 }}><i className="ti ti-x" /></button>
        </div>
        {!rows ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : rows.length === 0 ? <p style={{ color: 'var(--text3)' }}>Немає транзакцій</p> : (
          <div className="tbl-wrap" style={{ border: 'none', maxHeight: '60vh', overflow: 'auto' }}>
            <table>
              <thead><tr><th>Дата</th><th>Контрагент</th><th style={{ textAlign: 'right' }}>Сума</th><th>Напрям</th><th>Стаття</th></tr></thead>
              <tbody>
                {rows.map(t => {
                  const changed = edits[t.id] && (edits[t.id].direction !== undefined || edits[t.id].article !== undefined)
                  return (
                    <tr key={t.id} style={{ background: changed ? 'var(--surface2)' : undefined }}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text2)' }}>{t.date}</td>
                      <td><div className="trunc" title={t.counterparty || ''}>{t.counterparty || '—'}</div>{t.description && <div className="trunc" style={{ fontSize: 11, color: 'var(--text3)' }}>{t.description}</div>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: Number(t.amount) >= 0 ? GREEN : RED, fontWeight: 600 }}>{Number(t.amount) >= 0 ? '+' : '−'}{fmtInt(Math.abs(Number(t.amount) || 0))}</td>
                      <td>
                        <select className="form-input" style={{ fontSize: 12, padding: '3px 6px', minWidth: 110 }} value={val(t, 'direction')} onChange={e => setEdit(t.id, { direction: e.target.value })}>
                          <option value="">—</option>{DIRECTIONS.map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="form-input" style={{ fontSize: 12, padding: '3px 6px', minWidth: 160 }} value={val(t, 'article')} onChange={e => setEdit(t.id, { article: e.target.value })}>
                          <option value="">—</option>
                          {Object.entries(grouped).map(([type, arts]) => (
                            <optgroup key={type} label={TYPE_LABELS[type] || type}>
                              {arts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={2}>Разом ({rows.length})</td><td style={{ textAlign: 'right' }}>{fmtInt(total)}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, alignItems: 'center' }}>
          {dirty > 0 && <span style={{ fontSize: 12, color: 'var(--text3)', marginRight: 'auto' }}>Змінено: {dirty}</span>}
          <button className="btn" onClick={onClose}>Закрити</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || dirty === 0}><i className="ti ti-check" /> {busy ? 'Збереження…' : 'Зберегти зміни'}</button>
        </div>
      </div>
    </div>
  )
}

// ───────── P&L ─────────
function PLView() {
  const [year, setYear] = useState(NOW.getFullYear())
  const [month, setMonth] = useState(0)
  const [mode, setMode] = useState('fact') // fact | plan | compare
  const [data, setData] = useState(null)
  const [bd, setBd] = useState(null)
  const [drill, setDrill] = useState(null)
  const [showPending, setShowPending] = useState(false)

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
        <PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} />
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

      <ForecastCard year={year} month={month || null} />

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

// Клітинка матриці Факт: основне (підтверджене) число + дрібне превʼю непідтверджених
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

function ForecastCard({ year, month }) {
  const [f, setF] = useState(null)
  useEffect(() => { setF(null); computeForecast(year, month).then(setF) }, [year, month])
  if (!f) return null
  const line = (label, val, hint, color) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
      <span style={{ color: 'var(--text2)', fontSize: 13 }}>{label}{hint && <span style={{ color: 'var(--text3)', fontSize: 11, marginLeft: 6 }}>{hint}</span>}</span>
      <span style={{ fontWeight: 600, color: color || signColor(val), fontVariantNumeric: 'tabular-nums' }}>{val >= 0 ? '+' : ''}{fmtInt(val)}</span>
    </div>
  )
  return (
    <div className="card" style={{ marginBottom: 16, background: 'var(--surface2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Очікуваний результат <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text3)' }}>(з урахуванням майбутніх операцій)</span></div>
      </div>
      <div style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
          <span style={{ color: 'var(--text2)', fontSize: 13 }}>Фактичний результат (Net)</span>
          <span style={{ fontWeight: 600, color: signColor(f.factNet), fontVariantNumeric: 'tabular-nums' }}>{fmtInt(f.factNet)}</span>
        </div>
        {line('Дебіторка — виписано, чекає оплати', f.receivable, null, AMBER)}
        {line('Очікувана маржа з відкритих замовлень', f.pipelineMargin, `${f.pipelineCount} зам.`)}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 700 }}>≈ Очікуваний результат</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: signColor(f.expected), fontVariantNumeric: 'tabular-nums' }}>{fmtInt(f.expected)} грн</span>
        </div>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 10, marginBottom: 0 }}>
        Оцінка, а не факт. Фактичний P&L — лише підтверджені гроші; сюди додано дебіторку (виписані видаткові/акти, ще не оплачені) та очікувану маржу з відкритих замовлень (без виданої видаткової — щоб не рахувати двічі).
        {f.pipelineNoItems > 0 && ` У ${f.pipelineNoItems} відкритих зам. немає позицій — їхня маржа не врахована.`}
      </p>
    </div>
  )
}

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

// ───────── Управлінський баланс ─────────
function BalanceView() {
  const [year, setYear] = useState(NOW.getFullYear())
  const [month, setMonth] = useState(0)
  const [s, setS] = useState(null)

  useEffect(() => { setS(null); computeSnapshot(year, month || null).then(setS) }, [year, month])

  if (!s) return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}><PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} /></div>
      <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
    </div>
  )

  const cash = s.cashBankTotal || 0
  const stock = s.stock?.totalValue || 0
  const recv = s.receivable || 0
  const pay = s.payable || 0
  const assets = cash + stock + recv
  const equity = assets - pay
  const accounts = (s.balances || []).filter(b => Math.abs(b.balance) > 0.005)

  const Row = ({ label, value, indent, bold, color, sub }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: sub ? 'none' : '1px solid var(--border)', paddingLeft: indent ? 18 : 0 }}>
      <span style={{ fontWeight: bold ? 700 : 400, color: sub ? 'var(--text2)' : 'var(--text)', fontSize: sub ? 12.5 : 14 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums', fontSize: bold ? 15 : 13.5 }}>{si(value)}</span>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} />
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>станом на кінець періоду</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="card-title" style={{ color: GREEN }}>Активи</div>
          <Row label="Гроші (рахунки/каса)" value={cash} bold color={signColor(cash)} />
          {accounts.map(a => <Row key={a.id} label={a.name} value={a.balance} indent sub color={signColor(a.balance)} />)}
          <Row label="Склад (товари за собівартістю)" value={stock} bold />
          <Row label="Дебіторка (нам винні)" value={recv} bold color={AMBER} />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Усього активів</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: signColor(assets), fontVariantNumeric: 'tabular-nums' }}>{si(assets)} грн</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ color: RED }}>Пасиви та капітал</div>
          <Row label="Кредиторка (ми винні)" value={pay} bold color={RED} />
          <Row label="Власний капітал (активи − зобов'язання)" value={equity} bold color={signColor(equity)} />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Усього пасивів</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: signColor(pay + equity), fontVariantNumeric: 'tabular-nums' }}>{si(pay + equity)} грн</span>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 14 }}>
        Управлінський баланс: <b>Активи</b> = гроші на рахунках + оцінка складу (товари × собівартість, лише goods) + дебіторка (неоплачені видаткові/акти). <b>Пасиви</b> = кредиторка (неоплачені прихідні). <b>Капітал</b> = Активи − Зобов'язання (балансуюча величина; позики/ОЗ поки не враховуються). Дебіторка/кредиторка — неоплачені документи-борги станом на кінець періоду.
      </p>
    </div>
  )
}

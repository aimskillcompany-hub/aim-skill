import { Fragment, useEffect, useMemo, useState } from 'react'
import { qc } from '../lib/companyScope'
import { fmtInt } from '../lib/fmt'
import { PL_ORDER, PL_LABELS, fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import * as XLSX from 'xlsx'
import { computePL, computePLBreakdown, computeForecast, plDrill, computeAging } from '../lib/pl'
import { computeCashFlow, cashFlowDrill } from '../lib/cashflow'
import { computeSnapshot, computeBalanceTrend } from '../lib/periodClose'
import { getDocType } from '../lib/docgen'
import { supabase } from '../lib/supabase'
import DocModal from '../components/DocModal'
import { useUser } from '../lib/auth'

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
// fixedYear/fixedMonth — коли задані (напр. у «Закритті періоду»), період фіксований і селектор ховається.
export function CashFlowView({ fixedYear = null, fixedMonth = null } = {}) {
  const locked = fixedYear != null
  const [year, setYear] = useState(fixedYear ?? NOW.getFullYear())
  const [month, setMonth] = useState(fixedMonth ?? 0)
  useEffect(() => { if (locked) { setYear(fixedYear); setMonth(fixedMonth) } }, [fixedYear, fixedMonth])
  const [d, setD] = useState(null)
  const [debt, setDebt] = useState(null)   // дебіторка/кредиторка (нам винні / ми винні)
  const [drill, setDrill] = useState(null)
  const [aging, setAging] = useState(null) // { title, data, color } для модалки боргів

  const reload = () => { setD(null); computeCashFlow(year, month || null).then(setD) }
  useEffect(() => { reload() }, [year, month])
  // Дебіторка/кредиторка (computeAging) — поточний борг по всій історії, НЕ прив'язаний до періоду.
  // У режимі закриття (locked) не показуємо — правильний борг станом на кінець періоду є у звіті «Баланс».
  useEffect(() => { if (!locked) computeAging().then(setDebt) }, [locked])

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
        {!locked && <PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} />}
        <button className="btn" onClick={exportXlsx} disabled={!d} style={{ marginLeft: 'auto' }}><i className="ti ti-file-spreadsheet" /> Експорт Excel</button>
      </div>

      {!d ? <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div> : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <div className="kpi"><div className="kpi-label">Надходження</div><div className="kpi-value" style={{ color: GREEN }}>{fmtInt(d.inflow.total)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div></div>
            <div className="kpi"><div className="kpi-label">Витрати</div><div className="kpi-value" style={{ color: RED }}>{fmtInt(d.outflow.total)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div></div>
            <div className="kpi"><div className="kpi-label">Чистий потік</div><div className="kpi-value" style={{ color: signColor(d.netTotal) }}>{si(d.netTotal)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div></div>
            {debt && debt.receivable.total > 0 && (
              <div className="kpi" onClick={() => setAging({ title: 'Дебіторка — нам винні', data: debt.receivable, color: AMBER })}
                style={{ borderLeft: `3px solid ${AMBER}`, background: '#FFFBEB', cursor: 'pointer' }} title="Показати неоплачені видаткові/акти по контрагентах">
                <div className="kpi-label" style={{ color: AMBER }}>Нам винні (дебіторка) <i className="ti ti-chevron-right" style={{ fontSize: 12 }} /></div>
                <div className="kpi-value" style={{ color: AMBER }}>{fmtInt(debt.receivable.total)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div>
              </div>
            )}
            {debt && debt.payable.total > 0 && (
              <div className="kpi" onClick={() => setAging({ title: 'Кредиторка — ми винні', data: debt.payable, color: RED })}
                style={{ borderLeft: `3px solid ${RED}`, background: '#FEF2F2', cursor: 'pointer' }} title="Показати неоплачені прихідні по контрагентах">
                <div className="kpi-label" style={{ color: RED }}>Ми винні (кредиторка) <i className="ti ti-chevron-right" style={{ fontSize: 12 }} /></div>
                <div className="kpi-value" style={{ color: RED }}>{fmtInt(debt.payable.total)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>грн</span></div>
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
      {aging && <AgingModal title={aging.title} data={aging.data} color={aging.color} onClose={() => setAging(null)} />}
    </div>
  )
}

// Список неоплачених боргів, згрупований по контрагентах (дебіторка/кредиторка)
function AgingModal({ title, data, color, onClose }) {
  const groups = useMemo(() => {
    const byC = {}
    ;(data.docs || []).forEach(d => {
      const g = (byC[d.contractor_id] ||= { name: d.contractorName, rows: [], total: 0 })
      g.rows.push(d); g.total += d.outstanding
    })
    return Object.values(byC).sort((a, b) => b.total - a.total)
  }, [data])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', zIndex: 1000, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 760, boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <button className="btn" onClick={onClose} style={{ flexShrink: 0 }}><i className="ti ti-x" /></button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>Разом <b style={{ color }}>{fmtInt(data.total)} грн</b> · {groups.length} контрагент(ів). Неоплачені видаткові/акти (рахунки/замовлення не рахуються).</div>
        <div className="tbl-wrap" style={{ border: 'none', maxHeight: '62vh', overflow: 'auto' }}>
          <table>
            <tbody>
              {groups.map((g, gi) => (
                <Fragment key={gi}>
                  <tr style={{ background: 'var(--surface2)', fontWeight: 700 }}>
                    <td colSpan={2}>{g.name}</td>
                    <td style={{ textAlign: 'right', color, whiteSpace: 'nowrap' }}>{fmtInt(g.total)} грн</td>
                  </tr>
                  {g.rows.sort((a, b) => b.ageDays - a.ageDays).map(r => (
                    <tr key={r.id}>
                      <td style={{ paddingLeft: 18, fontSize: 12.5 }}>{getDocType(r.type)?.label || r.type} №{r.doc_number || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.doc_date} <span style={{ color: r.ageDays > 30 ? RED : 'var(--text3)' }}>· {r.ageDays} дн</span></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtInt(r.outstanding)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {groups.length === 0 && <tr><td style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Немає неоплачених боргів</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
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
// Клітинка «Документ»: показує прив'язані до транзакції документи; клік відкриває для звірки.
function LinkedDocCell({ docs }) {
  const { user } = useUser()
  const [openDoc, setOpenDoc] = useState(null)
  const [busy, setBusy] = useState(false)
  const open = async (id) => {
    if (!id || busy) return
    setBusy(true)
    const { data } = await qc('documents').select('*').eq('id', id).maybeSingle()
    setBusy(false)
    if (data) setOpenDoc(data)
  }
  if (!docs || docs.length === 0) return <span style={{ color: 'var(--text3)', fontSize: 11.5 }}>не прив'язано</span>
  return (
    <>
      {docs.map((d, i) => (
        <span key={d.id || i} onClick={() => open(d.id)}
          style={{ display: 'block', cursor: 'pointer', color: 'var(--blue)', fontSize: 11.5, textDecoration: 'underline dotted', textUnderlineOffset: 2, whiteSpace: 'nowrap' }}
          title="Відкрити документ для звірки">
          <i className="ti ti-paperclip" style={{ marginRight: 3 }} />{getDocType(d.type)?.label || d.type || 'документ'}{d.doc_number ? ` №${d.doc_number}` : ''}
        </span>
      ))}
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => setOpenDoc(null)} />}
    </>
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
              <thead><tr><th>Дата</th><th>Контрагент</th><th style={{ textAlign: 'right' }}>Сума</th><th>Напрям</th><th>Стаття</th><th>Документ</th></tr></thead>
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
                      <td><LinkedDocCell docs={t.docs} /></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={2}>Разом ({rows.length})</td><td style={{ textAlign: 'right' }}>{fmtInt(total)}</td><td colSpan={3} /></tr></tfoot>
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
export function PLView({ fixedYear = null, fixedMonth = null } = {}) {
  const locked = fixedYear != null
  const [year, setYear] = useState(fixedYear ?? NOW.getFullYear())
  const [month, setMonth] = useState(fixedMonth ?? 0)
  useEffect(() => { if (locked) { setYear(fixedYear); setMonth(fixedMonth) } }, [fixedYear, fixedMonth])
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
        {!locked && <PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} />}
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

      {/* Прогноз (факт + дебіторка + маржа відкритих замовлень) — майбутнє, не прив'язане до місяця.
          У режимі закриття (locked) ховаємо: там потрібен лише об'єктивний факт періоду. */}
      {!locked && <ForecastCard year={year} month={month || null} />}

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
              <thead><tr><th>Дата</th><th>Контрагент</th><th>Стаття</th><th style={{ textAlign: 'right' }}>Сума</th><th>Документ</th></tr></thead>
              <tbody>
                {rows.map(t => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                    <td><div className="trunc" title={t.counterparty || ''}>{t.counterparty || '—'}</div>{t.description && <div className="trunc" style={{ fontSize: 11, color: 'var(--text3)' }}>{t.description}</div>}</td>
                    <td><div className="trunc">{t.article}</div></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: t.direction === 'Доходи' ? GREEN : RED }}>{fmtInt(Math.abs(Number(t.amount) || 0))}</td>
                    <td><LinkedDocCell docs={t.docs} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={3}>Разом ({rows.length})</td><td style={{ textAlign: 'right' }}>{fmtInt(total)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ───────── Управлінський баланс ─────────
export function BalanceView({ fixedYear = null, fixedMonth = null } = {}) {
  const locked = fixedYear != null
  const [year, setYear] = useState(fixedYear ?? NOW.getFullYear())
  const [month, setMonth] = useState(fixedMonth ?? 0)
  useEffect(() => { if (locked) { setYear(fixedYear); setMonth(fixedMonth) } }, [fixedYear, fixedMonth])
  const [s, setS] = useState(null)
  const [drill, setDrill] = useState(null) // розшифровка рядка балансу
  const [view, setView] = useState('snapshot') // snapshot | trend
  const [trend, setTrend] = useState(null)

  useEffect(() => { setS(null); computeSnapshot(year, month || null).then(setS) }, [year, month])
  useEffect(() => {
    if (view !== 'trend') return
    setTrend(null)
    computeBalanceTrend(year, month || 12, { fromY: 2025, fromM: 1 }).then(setTrend)
  }, [year, month, view])

  const toggle = (
    <div style={{ display: 'flex', gap: 4, marginLeft: locked ? 0 : 'auto' }}>
      {[['snapshot', 'Поточний стан'], ['trend', 'Динаміка з початку']].map(([k, lbl]) => (
        <button key={k} onClick={() => setView(k)} className="btn" style={{ background: view === k ? 'var(--blue)' : 'var(--surface)', color: view === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>{lbl}</button>
      ))}
    </div>
  )

  if (view === 'trend') {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {!locked && <PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} />}
          {toggle}
        </div>
        {!trend ? <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження динаміки…</p></div> : <BalanceTrend trend={trend} />}
      </div>
    )
  }

  if (!s) return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {!locked && <PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} />}
        {toggle}
      </div>
      <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
    </div>
  )

  const cash = s.cashBankTotal || 0
  const stock = s.stock?.totalValue || 0
  const recv = s.receivable || 0
  const pay = s.payable || 0
  const loans = s.loansNet || 0 // сальдо ПФД: >0 — ми винні повернути
  const assets = cash + stock + recv
  const equity = assets - pay - loans
  const accounts = (s.balances || []).filter(b => Math.abs(b.balance) > 0.005)

  const Row = ({ label, value, indent, bold, color, sub, onClick }) => (
    <div onClick={onClick} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: sub ? 'none' : '1px solid var(--border)', paddingLeft: indent ? 18 : 0, cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ fontWeight: bold ? 700 : 400, color: sub ? 'var(--text2)' : 'var(--text)', fontSize: sub ? 12.5 : 14 }}>
        {label}{onClick && <i className="ti ti-chevron-right" style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 4 }} />}
      </span>
      <span style={{ fontWeight: bold ? 700 : 500, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums', fontSize: bold ? 15 : 13.5, textDecoration: onClick ? 'underline dotted' : 'none', textUnderlineOffset: 3 }}>{si(value)}</span>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {!locked && <PeriodPicker year={year} setYear={setYear} month={month} setMonth={setMonth} />}
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>станом на кінець періоду</span>
        {toggle}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="card-title" style={{ color: GREEN }}>Активи</div>
          <Row label="Гроші (рахунки/каса)" value={cash} bold color={signColor(cash)} />
          {accounts.map(a => <Row key={a.id} label={a.name} value={a.balance} indent sub color={signColor(a.balance)} />)}
          <Row label="Склад (товари за собівартістю)" value={stock} bold onClick={stock ? () => setDrill({ type: 'stock' }) : null} />
          <Row label="Дебіторка (нам винні)" value={recv} bold color={AMBER} onClick={recv ? () => setDrill({ type: 'recv' }) : null} />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Усього активів</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: signColor(assets), fontVariantNumeric: 'tabular-nums' }}>{si(assets)} грн</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ color: RED }}>Пасиви та капітал</div>
          <Row label="Кредиторка (ми винні)" value={pay} bold color={RED} onClick={pay ? () => setDrill({ type: 'pay' }) : null} />
          {loans !== 0 && <Row label={loans >= 0 ? 'Поворотна фін. допомога (до повернення)' : 'Поворотна фін. допомога (нам повернуть)'} value={loans} bold color={loans >= 0 ? RED : GREEN} onClick={() => setDrill({ type: 'loans' })} />}
          <Row label="Власний капітал (активи − зобов'язання)" value={equity} bold color={signColor(equity)} />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Усього пасивів</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: signColor(pay + loans + equity), fontVariantNumeric: 'tabular-nums' }}>{si(pay + loans + equity)} грн</span>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 14 }}>
        Управлінський баланс: <b>Активи</b> = гроші на рахунках + оцінка складу (товари × собівартість, лише goods) + дебіторка (неоплачені видаткові/акти). <b>Пасиви</b> = кредиторка (неоплачені прихідні) + сальдо поворотної фін. допомоги (отримані позики до повернення). <b>Капітал</b> = Активи − Зобов'язання (балансуюча величина; ОЗ поки не враховуються). ПФД винесена окремо, щоб отримання/повернення позики не спотворювало капітал. Дебіторка/кредиторка — неоплачені документи-борги станом на кінець періоду. Натисніть на цифру — побачите склад суми.
      </p>
      {drill && <BalanceDrillModal drill={drill} snap={s} onClose={() => setDrill(null)} />}
    </div>
  )
}

// Динаміка балансу по місяцях: тренд капіталу + внески складових + таблиця
function BalanceTrend({ trend }) {
  const rows = trend.rows || []
  if (!rows.length) return <div className="card"><p style={{ color: 'var(--text3)' }}>Немає даних за період</p></div>
  const first = rows[0], last = rows[rows.length - 1]
  const totalDelta = last.equity - first.equity
  const contrib = [
    { k: 'Гроші', v: last.cash - first.cash },
    { k: 'Склад', v: last.stock - first.stock },
    { k: 'Дебіторка (нам винні)', v: last.receivable - first.receivable },
    { k: 'Кредиторка (ми винні)', v: -(last.payable - first.payable) },
    { k: 'Поворотна фін. допомога', v: -(last.loans - first.loans) },
  ].filter(c => Math.abs(c.v) > 0.5).sort((a, b) => a.v - b.v)

  const eqs = rows.map(r => r.equity)
  const mn = Math.min(...eqs), mx = Math.max(...eqs), rng = mx - mn || 1
  const W = 600, H = 80
  const pts = eqs.map((v, i) => `${(i / Math.max(1, eqs.length - 1)) * W},${(H - 4) - ((v - mn) / rng) * (H - 8) + 4}`).join(' ')
  const td = { textAlign: 'right', whiteSpace: 'nowrap', padding: '4px 8px' }

  return (
    <div className="card">
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
        Власний капітал: <b>{si(first.equity)}</b> ({first.label}) → <b>{si(last.equity)}</b> ({last.label}) ·
        <b style={{ color: totalDelta >= 0 ? GREEN : RED, marginLeft: 6 }}>{totalDelta >= 0 ? '+' : '−'}{fmtInt(Math.abs(totalDelta))} грн</b> за період
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 80, marginBottom: 16, background: 'var(--surface2)', borderRadius: 8 }}>
        <polyline points={pts} fill="none" stroke={totalDelta >= 0 ? GREEN : RED} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>

      {contrib.length > 0 && (
        <div style={{ marginBottom: 16, fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Що змінило капітал (з {first.label} по {last.label}):</div>
          {contrib.map(c => (
            <div key={c.k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{c.k}</span>
              <b style={{ color: c.v >= 0 ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>{c.v >= 0 ? '+' : '−'}{fmtInt(Math.abs(c.v))}</b>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>Додатнє — збільшує капітал, від'ємне — зменшує (зростання кредиторки чи ПФД зменшує капітал). Найбільше просідання — зверху.</div>
        </div>
      )}

      <div className="tbl-wrap" style={{ border: 'none', overflowX: 'auto' }}>
        <table>
          <thead><tr style={{ color: 'var(--text3)' }}>
            <th style={{ textAlign: 'left' }}>Місяць</th>
            <th style={{ textAlign: 'right' }}>Гроші</th>
            <th style={{ textAlign: 'right' }}>Склад</th>
            <th style={{ textAlign: 'right' }}>Дебіторка</th>
            <th style={{ textAlign: 'right' }}>Кредиторка</th>
            <th style={{ textAlign: 'right' }}>ПФД</th>
            <th style={{ textAlign: 'right' }}>Капітал</th>
            <th style={{ textAlign: 'right' }}>Δ Капітал</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ textAlign: 'left', padding: '4px 8px', whiteSpace: 'nowrap' }}>{r.label}</td>
                <td style={td}>{fmtInt(r.cash)}</td>
                <td style={td}>{fmtInt(r.stock)}</td>
                <td style={td}>{fmtInt(r.receivable)}</td>
                <td style={td}>{fmtInt(r.payable)}</td>
                <td style={td}>{fmtInt(r.loans)}</td>
                <td style={{ ...td, fontWeight: 700, color: signColor(r.equity) }}>{si(r.equity)}</td>
                <td style={{ ...td, color: i === 0 ? 'var(--text3)' : r.dEquity >= 0 ? GREEN : RED }}>{i === 0 ? '—' : (r.dEquity >= 0 ? '+' : '−') + fmtInt(Math.abs(r.dEquity))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 10 }}>Кожен рядок — стан на кінець місяця. Капітал = Гроші + Склад + Дебіторка − Кредиторка − ПФД. Δ — зміна капіталу від попереднього місяця.</p>
    </div>
  )
}

// Розшифровка рядка балансу: склад (товари) або борг (дебіторка/кредиторка по контрагентах, з відкриттям документа)
function BalanceDrillModal({ drill, snap, onClose }) {
  const { user } = useUser()
  const [openDoc, setOpenDoc] = useState(null)
  const openById = async (id) => { if (!id) return; const { data } = await qc('documents').select('*').eq('id', id).maybeSingle(); if (data) setOpenDoc(data) }

  let title, color, content
  if (drill.type === 'stock') {
    title = 'Склад — залишки за собівартістю'; color = 'var(--text)'
    const items = snap.stock?.items || []
    content = (
      <table>
        <thead><tr style={{ color: 'var(--text3)', textAlign: 'right' }}>
          <th style={{ textAlign: 'left' }}>Товар</th><th>К-сть</th><th>Собів/од</th><th>Вартість</th></tr></thead>
        <tbody>
          {items.map(it => (
            <tr key={it.product_id} style={{ textAlign: 'right' }}>
              <td style={{ textAlign: 'left' }}>{it.name?.slice(0, 50)}</td>
              <td style={{ color: it.qty < 0 ? RED : 'inherit' }}>{fmtInt(it.qty)}</td>
              <td>{fmtInt(it.unit_cost)}</td><td>{fmtInt(it.value)}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>Немає залишків</td></tr>}
        </tbody>
      </table>
    )
  } else if (drill.type === 'loans') {
    title = 'Поворотна фінансова допомога — рухи'; color = 'var(--text)'
    const txs = snap.loanTxs || []
    const total = txs.reduce((acc, t) => acc + (Number(t.amount) || 0), 0)
    content = (
      <table>
        <thead><tr style={{ color: 'var(--text3)' }}><th style={{ textAlign: 'left' }}>Дата</th><th style={{ textAlign: 'left' }}>Контрагент</th><th style={{ textAlign: 'right' }}>Сума</th></tr></thead>
        <tbody>
          {txs.map(t => (
            <tr key={t.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
              <td><div className="trunc" title={t.counterparty || ''}>{t.counterparty || t.description || '—'}</div>{t.article && <div className="trunc" style={{ fontSize: 11, color: 'var(--text3)' }}>{t.article}</div>}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: Number(t.amount) >= 0 ? GREEN : RED }}>{Number(t.amount) >= 0 ? '+' : '−'}{fmtInt(Math.abs(Number(t.amount) || 0))}</td>
            </tr>
          ))}
          {txs.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>Немає рухів ПФД</td></tr>}
        </tbody>
        <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={2}>Сальдо (отримано − повернено)</td><td style={{ textAlign: 'right' }}>{si(total)} грн</td></tr></tfoot>
      </table>
    )
  } else {
    const isRecv = drill.type === 'recv'
    title = isRecv ? 'Дебіторка — нам винні' : 'Кредиторка — ми винні'
    color = isRecv ? AMBER : RED
    const docs = (isRecv ? snap.receivableDocs : snap.payableDocs) || []
    const byC = {}
    docs.forEach(d => { const g = (byC[d.contractor_id] ||= { name: d.contractorName, rows: [], total: 0 }); g.rows.push(d); g.total += d.amount })
    const groups = Object.values(byC).sort((a, b) => b.total - a.total)
    content = (
      <table>
        <tbody>
          {groups.map((g, gi) => (
            <Fragment key={gi}>
              <tr style={{ background: 'var(--surface2)', fontWeight: 700 }}>
                <td colSpan={2}>{g.name}</td>
                <td style={{ textAlign: 'right', color, whiteSpace: 'nowrap' }}>{fmtInt(g.total)} грн</td>
              </tr>
              {g.rows.sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || '')).map(r => (
                <tr key={r.id} onClick={() => openById(r.id)} style={{ cursor: 'pointer' }} title="Відкрити документ">
                  <td style={{ paddingLeft: 18, fontSize: 12.5, color: 'var(--blue)' }}><i className="ti ti-file-text" style={{ marginRight: 4 }} />{getDocType(r.type)?.label || r.type} №{r.doc_number || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.doc_date}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtInt(r.amount)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {groups.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>Немає неоплачених документів</td></tr>}
        </tbody>
      </table>
    )
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', zIndex: 1000, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 760, boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color }}>{title}</div>
          <button className="btn" onClick={onClose} style={{ flexShrink: 0 }}><i className="ti ti-x" /></button>
        </div>
        <div className="tbl-wrap" style={{ border: 'none', maxHeight: '64vh', overflow: 'auto' }}>{content}</div>
      </div>
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => setOpenDoc(null)} />}
    </div>
  )
}

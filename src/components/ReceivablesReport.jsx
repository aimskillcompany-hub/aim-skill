import { Fragment, useEffect, useMemo, useState } from 'react'
import { useCompany } from '../lib/company'
import { loadReceivables, groupReceivables, BUCKETS } from '../lib/receivables'
import { exportReceivablesPdf } from '../lib/receivablesPdf'
import { loadDocItems } from '../lib/docItems'
import { lastReminders } from '../lib/clientStatement'
import ClientStatementModal from './ClientStatementModal'

// Звіт «Дебіторка»: підсумок + старіння + контрагенти (розгортаються до документів). PDF-експорт.
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const now = new Date()
const _int = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const n0 = (v) => _int.format(Math.round(Math.abs(Number(v) || 0)))
const _dec = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n2 = (v) => _dec.format(Number(v) || 0)
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const MONO = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

export default function ReceivablesReport() {
  const { companies } = useCompany()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [raw, setRaw] = useState(null)
  const [scope, setScope] = useState('all') // 'all' | companyId
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')                 // пошук контрагента за назвою / ЄДРПОУ
  const [stmt, setStmt] = useState(null)         // група контрагента для «Звіту для клієнта»
  const [reminders, setReminders] = useState({}) // останнє нагадування по контрагенту (068)
  const reloadReminders = () => lastReminders().then(r => setReminders(r || {}))
  useEffect(() => { reloadReminders() }, [])

  useEffect(() => {
    if (!companies?.length) return
    let cancelled = false
    setLoading(true); setErr(null)
    loadReceivables(companies, year, month)
      .then(r => { if (!cancelled) setRaw(r) })
      .catch(e => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companies, year, month])

  const filtered = useMemo(() => {
    if (!raw) return null
    const docs = scope === 'all' ? raw.docs : raw.docs.filter(x => x.companyId === scope)
    return groupReceivables(docs)
  }, [raw, scope])
  const shown = useMemo(() => {
    if (!filtered) return null
    const t = q.trim().toLowerCase()
    if (!t) return filtered.contractors
    return filtered.contractors.filter(c => (c.name || '').toLowerCase().includes(t) || (c.edrpou || '').includes(t))
  }, [filtered, q])

  const years = [2025, 2026, 2027].filter(y => y <= now.getFullYear() + 1)
  const asOf = raw?.asOf ? d(raw.asOf) : ''

  return (
    <div style={{ fontFamily: 'Manrope, system-ui, sans-serif', color: '#17151F', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Шапка */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.02em' }}>Дебіторка</h1>
          <div style={{ fontSize: 15, color: '#5E5A6B' }}>Станом на {asOf || '—'}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={selStyle}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...selStyle, minWidth: 90 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => filtered && exportReceivablesPdf({ ...filtered, asOf: raw.asOf, scopeName: scope === 'all' ? 'Усі юрособи' : (raw?.companies.find(c => c.id === scope)?.name || '') })}
            disabled={!filtered} style={{ height: 40, padding: '0 16px', border: 'none', borderRadius: 9, background: filtered ? '#17151F' : '#B9B4C9', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: filtered ? 'pointer' : 'default' }}>
            <i className="ti ti-file-download" style={{ marginRight: 6 }} />PDF
          </button>
        </div>
      </div>

      {/* Перемикач юросіб */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, background: '#fff', border: '1px solid #ECEAF2', borderRadius: 12, padding: 4, alignSelf: 'flex-start' }}>
        <Tab active={scope === 'all'} onClick={() => setScope('all')}>Усі юрособи</Tab>
        {(raw?.companies || companies || []).map(c => (
          <Tab key={c.id} active={scope === c.id} onClick={() => setScope(c.id)}>{c.name || c.short_name}</Tab>
        ))}
      </div>

      {loading && <div style={{ fontSize: 13, color: '#5E5A6B' }}><i className="ti ti-loader" /> Рахуємо…</div>}
      {err && <div style={{ background: '#fff', border: '1px solid #ECEAF2', borderRadius: 20, padding: 20, color: '#C62828' }}>Помилка: {err}</div>}

      {filtered && (
        <>
          <Summary s={filtered.summary} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '0 1 380px' }}>
              <i className="ti ti-search" style={{ position: 'absolute', left: 12, top: 12, color: '#8A849C' }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Контрагент: назва або ЄДРПОУ" style={{ ...selStyle, width: '100%', paddingLeft: 34, boxSizing: 'border-box' }} />
            </div>
            {q && <span style={{ fontSize: 13, color: '#5E5A6B' }}>Знайдено: {shown.length}</span>}
          </div>
          <ContractorsTable contractors={shown} summary={filtered.summary} showCompany={scope === 'all'} reminders={reminders}
            onReport={(c) => setStmt(raw.docs.filter(x => x.contractorId === c.contractorId).length ? { ...c, docs: raw.docs.filter(x => x.contractorId === c.contractorId) } : c)} />
          <div style={{ fontSize: 12, color: '#8A849C' }}>Вік — від дати документа; прострочка — від строку оплати (дата документа + відстрочка з картки контрагента), до сьогодні або до кінця минулого періоду. Борг = сума документа − оплати. Клік по документу — товарні позиції.</div>
        </>
      )}
      {stmt && <ClientStatementModal group={stmt} defaultAsOf={raw?.asOf} onClose={() => setStmt(null)} onLogged={reloadReminders} />}
    </div>
  )
}

const selStyle = { height: 40, minWidth: 130, padding: '0 12px', border: '1px solid #DDD9E8', borderRadius: 9, background: '#fff', fontFamily: 'inherit', fontSize: 14, color: '#17151F' }

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      height: 40, padding: '0 16px', border: 'none', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
      background: active ? '#17151F' : 'transparent', color: active ? '#fff' : '#17151F', fontWeight: active ? 700 : 600,
    }}>{children}</button>
  )
}

function Summary({ s }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ECEAF2', borderRadius: 20, padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 56px', alignItems: 'flex-end' }}>
        <KPI label="Дебіторка разом" value={<span style={{ ...MONO, fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em' }}>{n0(s.total)} ₴</span>} />
        <KPI label="Старше 30 днів" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600, color: '#C62828' }}>{n0(s.over30)} ₴ <span style={{ fontSize: 15 }}>· {Math.round(s.over30Pct * 100)}%</span></span>} />
        <KPI label="Боржників" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600 }}>{s.debtors}</span>} />
        <KPI label="У т.ч. ПДВ" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600, color: '#5E5A6B' }}>{n0(s.vat)} ₴</span>} />
      </div>
      {/* Шкала старіння */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 3 }}>
          {BUCKETS.map(b => { const w = s.total ? (s.buckets[b.key] / s.total * 100) : 0; return w > 0.01 ? <div key={b.key} style={{ width: w + '%', background: b.color }} /> : null })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 28px', fontSize: 13, color: '#5E5A6B' }}>
          {BUCKETS.map(b => (
            <span key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: b.color }} />{b.label}{' '}
              <span style={{ ...MONO, color: b.key === '30+' ? '#C62828' : '#17151F', fontWeight: b.key === '30+' ? 600 : 400 }}>{n0(s.buckets[b.key])}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function KPI({ label, value }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 13, color: '#5E5A6B', fontWeight: 600 }}>{label}</span>{value}</div>
}

function ContractorsTable({ contractors, summary, showCompany, reminders, onReport }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ECEAF2', borderRadius: 20, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ fontSize: 12, color: '#5E5A6B' }}>
              <th style={{ ...th, textAlign: 'left' }}>Контрагент</th>
              <th style={th}>Борг</th>
              <th style={th}>з них 30+ дн.</th>
              <th style={th}>Найстаріший</th>
            </tr>
          </thead>
          <tbody>
            {contractors.map(c => <ContractorRow key={c.contractorId} c={c} showCompany={showCompany} last={reminders?.[c.contractorId]} onReport={onReport} />)}
            <tr style={{ background: '#FAF9FC', fontWeight: 700 }}>
              <td style={{ ...td, textAlign: 'left' }}>Разом</td>
              <td style={{ ...td, ...MONO }}>{n0(summary.total)}</td>
              <td style={{ ...td, ...MONO, color: '#C62828' }}>{n0(summary.over30)}</td>
              <td style={td}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th = { padding: '14px 16px', textAlign: 'right', borderBottom: '1px solid #ECEAF2', fontWeight: 600 }
const td = { padding: '14px 16px', textAlign: 'right', borderBottom: '1px solid #ECEAF2', verticalAlign: 'middle' }

function ContractorRow({ c, showCompany, last, onReport }) {
  const [open, setOpen] = useState(false)
  const [openDoc, setOpenDoc] = useState({})   // docId → розгорнуто
  const [items, setItems] = useState({})       // docId → { rows, noItems, mismatch }
  const toggleDoc = async (x) => {
    const on = !openDoc[x.docId]
    setOpenDoc(s => ({ ...s, [x.docId]: on }))
    if (on && !items[x.docId]) {
      const r = await loadDocItems([x]).catch(() => ({}))
      setItems(s => ({ ...s, [x.docId]: r[x.docId] || { rows: [], noItems: true } }))
    }
  }
  return (
    <>
      <tr style={{ background: open ? '#F7F5FC' : undefined, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td style={{ ...td, textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className={`ti ti-chevron-${open ? 'down' : 'right'}`} style={{ color: open ? '#5B2FD6' : '#8A849C', fontSize: 16 }} />
            <span style={{ fontWeight: 700 }}>{c.name}</span>
            <span style={{ fontSize: 12, color: '#5E5A6B' }}>{c.docs.length} док.</span>
            {showCompany && <span style={{ fontSize: 11, color: '#8A849C' }}>· {[...new Set(c.docs.map(x => x.companyName))].join(', ')}</span>}
            <span style={{ flex: 1 }} />
            {last && <span title={`Останнє нагадування: ${last.created_by_name || ''}, борг ${n0(last.total)} ₴`} style={{ fontSize: 11.5, color: '#8A849C', whiteSpace: 'nowrap' }}><i className="ti ti-bell" /> {d(last.created_at)}</span>}
            <button onClick={e => { e.stopPropagation(); onReport(c) }} style={{ height: 30, padding: '0 12px', border: '1px solid #DDD9E8', borderRadius: 8, background: '#fff', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', color: '#5B2FD6' }}>
              <i className="ti ti-file-invoice" /> Звіт для клієнта
            </button>
          </div>
        </td>
        <td style={{ ...td, ...MONO, fontWeight: 700 }}>{n0(c.total)}</td>
        <td style={{ ...td, ...MONO, color: c.over30 > 0 ? '#C62828' : '#B8B4C4' }}>{c.over30 > 0 ? n0(c.over30) : '—'}</td>
        <td style={{ ...td, ...MONO, color: c.oldest > 30 ? '#C62828' : '#17151F', fontWeight: c.oldest > 30 ? 600 : 400 }}>{c.oldest} дн.</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} style={{ padding: '0 16px 16px 40px', background: '#F7F5FC' }}>
            <div style={{ background: '#fff', border: '1px solid #E6E2F0', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 12, color: '#5E5A6B' }}>
                    <th style={{ ...dth, textAlign: 'left' }}>Документ</th>
                    <th style={dth}>Дата</th>
                    <th style={dth}>Сума</th>
                    <th style={dth}>Оплачено</th>
                    <th style={dth}>Залишок</th>
                    <th style={dth}>Строк оплати</th>
                    <th style={dth}>Простр.</th>
                    <th style={dth}>Вік</th>
                  </tr>
                </thead>
                <tbody>
                  {c.docs.map((x, i) => (
                    <Fragment key={x.docId}>
                    <tr onClick={() => toggleDoc(x)} style={{ cursor: 'pointer', borderBottom: i === c.docs.length - 1 && !openDoc[x.docId] ? 'none' : '1px solid #EFECF5', background: openDoc[x.docId] ? '#FBFAFE' : undefined }}>
                      <td style={{ ...dtd, textAlign: 'left' }}>
                        <i className={`ti ti-chevron-${openDoc[x.docId] ? 'down' : 'right'}`} style={{ color: '#8A849C', fontSize: 13, marginRight: 4 }} />
                        <span style={{ fontWeight: 600, color: '#5B2FD6' }}>{x.doc_number}</span>
                        {showCompany && <span style={{ fontSize: 11, color: '#8A849C', marginLeft: 6 }}>{x.companyName}</span>}
                        {!x.is_verified && <span style={{ fontSize: 12, color: '#C62828', marginLeft: 6 }}>не звірено</span>}
                        {!x.is_signed && <span style={{ fontSize: 12, color: '#C62828', marginLeft: 6 }}>не підписано</span>}
                      </td>
                      <td style={{ ...dtd, ...MONO }}>{d(x.doc_date)}</td>
                      <td style={{ ...dtd, ...MONO }}>{n0(x.amount)}</td>
                      <td style={{ ...dtd, ...MONO, color: x.paid > 0 ? '#17151F' : '#B8B4C4' }}>{n0(x.paid)}</td>
                      <td style={{ ...dtd, ...MONO, fontWeight: 700 }}>{n0(x.outstanding)}</td>
                      <td style={{ ...dtd, ...MONO, color: '#5E5A6B' }} title={`відстрочка ${x.delayDays} дн.`}>{d(x.dueDate)}</td>
                      <td style={{ ...dtd, ...MONO, color: x.overdueDays > 0 ? '#C62828' : '#B8B4C4', fontWeight: x.overdueDays > 0 ? 600 : 400 }}>{x.overdueDays > 0 ? x.overdueDays : '—'}</td>
                      <td style={{ ...dtd, ...MONO, color: x.ageDays > 30 ? '#C62828' : '#17151F' }}>{x.ageDays}</td>
                    </tr>
                    {openDoc[x.docId] && (
                      <tr style={{ borderBottom: '1px solid #EFECF5' }}>
                        <td colSpan={8} style={{ padding: '4px 12px 10px 34px', background: '#FBFAFE' }}>
                          {!items[x.docId] ? <span style={{ fontSize: 12, color: '#8A849C' }}>Завантаження позицій…</span> : (
                            <>
                              {items[x.docId].noItems && <div style={{ fontSize: 12, color: '#B7791F', marginBottom: 4 }}><i className="ti ti-alert-triangle" /> немає позицій — у звіті для клієнта буде «Згідно документа»</div>}
                              {items[x.docId].mismatch && <div style={{ fontSize: 12, color: '#C62828', marginBottom: 4 }}><i className="ti ti-scale" /> сума рядків відрізняється від суми документа на {n0(items[x.docId].diff)} ₴</div>}
                              {!items[x.docId].noItems && (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                  <thead><tr style={{ color: '#8A849C', fontSize: 11 }}>
                                    <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600 }}>№</th><th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600 }}>Найменування</th>
                                    <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600 }}>Артикул</th><th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 600 }}>К-сть</th>
                                    <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 600 }}>Ціна з ПДВ</th><th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 600 }}>Сума з ПДВ</th>
                                  </tr></thead>
                                  <tbody>
                                    {items[x.docId].rows.map(r => (
                                      <tr key={r.n} style={{ borderTop: '1px solid #EFECF5' }}>
                                        <td style={{ padding: '3px 6px', color: '#8A849C' }}>{r.n}</td>
                                        <td style={{ padding: '3px 6px' }}>{r.name}</td>
                                        <td style={{ padding: '3px 6px', color: '#5E5A6B', ...MONO, fontSize: 11.5 }}>{r.sku || ''}</td>
                                        <td style={{ padding: '3px 6px', textAlign: 'right', ...MONO }}>{r.qty} {r.unit}</td>
                                        <td style={{ padding: '3px 6px', textAlign: 'right', ...MONO }}>{n2(r.price)}</td>
                                        <td style={{ padding: '3px 6px', textAlign: 'right', ...MONO }}>{n2(r.sum)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              {x.payments?.length > 0 && <div style={{ fontSize: 12, color: '#1F7A4D', marginTop: 4 }}>Оплати: {x.payments.map(p => `${d(p.date)} — ${n2(p.amount)}`).join('; ')}</div>}
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

const dth = { padding: '9px 12px', textAlign: 'right', borderBottom: '1px solid #EFECF5', fontWeight: 600, fontSize: 12, color: '#5E5A6B' }
const dtd = { padding: '9px 12px', textAlign: 'right', fontSize: 13 }

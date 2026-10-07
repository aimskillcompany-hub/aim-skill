import { Fragment, useEffect, useMemo, useState } from 'react'
import { useCompany } from '../lib/company'
import { useUser } from '../lib/auth'
import { computeProfitability, saveAgent } from '../lib/profitability'

// Прибутковість реалізації: видаткові → товари (закупка FIFO → реалізація → прибуток → агентські → чистий).
const now = new Date()
const _int = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const si = (n) => { const v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + _int.format(Math.abs(v)) }
const col = (n) => { const v = Math.round(Number(n) || 0); return v < 0 ? '#C62828' : v === 0 ? '#B8B4C4' : '#17151F' }
const pct = (f) => f == null ? '—' : (f < 0 ? '−' : '') + (Math.abs(f * 100)).toFixed(1).replace('.', ',') + '%'
const d2 = (s) => s ? String(s).slice(8, 10) + '.' + String(s).slice(5, 7) : ''
const MONO = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const firstDay = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`
const lastDay = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

export default function ProfitabilityReport() {
  const { companies } = useCompany()
  const { user } = useUser()
  const [companyId, setCompanyId] = useState(null)
  const [from, setFrom] = useState(firstDay(now.getFullYear(), now.getMonth() + 1))
  const [to, setTo] = useState(lastDay(now.getFullYear(), now.getMonth() + 1))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { if (!companyId && companies?.length) setCompanyId(companies[0].id) }, [companies])
  const company = useMemo(() => (companies || []).find(c => c.id === companyId), [companies, companyId])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setLoading(true); setErr(null)
    computeProfitability(companyId, company?.is_vat_payer !== false, from, to)
      .then(r => { if (!cancelled) setData(r) })
      .catch(e => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companyId, from, to, tick])

  return (
    <div style={{ fontFamily: 'Manrope, system-ui, sans-serif', color: '#17151F', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.02em' }}>Прибутковість реалізації</h1>
          <div style={{ fontSize: 15, color: '#5E5A6B' }}>Видаткові накладні · {d2(from)}.{from.slice(0, 4)}–{d2(to)}.{to.slice(0, 4)} · усі суми без ПДВ</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={lblS}>Період</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selS} />
              <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selS} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={lblS}>Юрособа</label>
            <select value={companyId || ''} onChange={e => setCompanyId(e.target.value)} style={selS}>
              {(companies || []).map(c => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading && <div style={{ fontSize: 13, color: '#5E5A6B' }}><i className="ti ti-loader" /> Рахуємо…</div>}
      {err && <div style={{ background: '#fff', border: '1px solid #ECEAF2', borderRadius: 20, padding: 20, color: '#C62828' }}>Помилка: {err}{/agent_commissions/.test(err) ? ' — запустіть міграцію 064.' : ''}</div>}

      {data && (
        <>
          <Summary t={data.totals} />
          <InvoicesTable data={data} userId={user?.id} onChanged={() => setTick(t => t + 1)} />
          <div style={{ fontSize: 12, color: '#8A849C' }}>
            Прибуток = реалізація − закупка (FIFO). Маржа = прибуток ÷ реалізація. Агентські = прибуток × % (вручну; при збитку не нараховуються).
            Чистий = прибуток − агентські. ПДВ до сплати = ПДВ з реалізації − вхідний ПДВ (кредит лише по закупках у платника ПДВ).
          </div>
        </>
      )}
    </div>
  )
}

const lblS = { fontSize: 12, color: '#5E5A6B', fontWeight: 600 }
const selS = { height: 44, padding: '0 12px', border: '1px solid #DDD9E8', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 15, color: '#17151F' }

function Summary({ t }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ECEAF2', borderRadius: 20, padding: 28, display: 'flex', flexWrap: 'wrap', gap: '24px 48px', alignItems: 'flex-end' }}>
      <K label="Чистий прибуток" big value={<span style={{ ...MONO, fontSize: 40, fontWeight: 600, color: '#5B2FD6' }}>{si(t.net)} ₴</span>} />
      <K label="Прибуток" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600, color: col(t.profit) }}>{si(t.profit)}</span>} />
      <K label="Агентські" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600, color: '#C62828' }}>−{_int.format(Math.abs(Math.round(t.commission)))}</span>} />
      <K label="Маржа" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600 }}>{pct(t.margin)}</span>} />
      <K label="Виручка" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600 }}>{si(t.sellSum)}</span>} />
      <K label="ПДВ до сплати" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600, color: col(t.vatToPay) }}>{si(t.vatToPay)}</span>} />
      <K label="Збиткові накладні" value={<span style={{ ...MONO, fontSize: 24, fontWeight: 600, color: t.lossCount ? '#C62828' : '#B8B4C4' }}>{t.lossCount}{t.lossCount ? ` · ${si(t.lossSum)}` : ''}</span>} />
    </div>
  )
}
function K({ label, value, big }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 13, color: '#5E5A6B', fontWeight: 600 }}>{label}</span>{value}</div>
}

function InvoicesTable({ data, userId, onChanged }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ECEAF2', borderRadius: 20, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 1000, borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ fontSize: 12, color: '#5E5A6B' }}>
              <th style={thL}>Накладна</th><th style={thL}>Клієнт</th>
              <th style={th}>Виручка</th><th style={th}>ПДВ до сплати</th><th style={th}>Прибуток</th><th style={th}>Маржа</th>
              <th style={{ ...th, background: '#FFF8E6' }}>Агент, %</th><th style={{ ...th, background: '#FFF8E6' }}>Агентські</th>
              <th style={{ ...th, color: '#17151F', fontWeight: 700 }}>Чистий прибуток</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map(inv => <InvoiceRow key={inv.id} inv={inv} userId={userId} onChanged={onChanged} />)}
            <tr style={{ background: '#FAF9FC', fontWeight: 700 }}>
              <td style={tdL}>Разом · {data.totals.count} накл.</td><td style={tdL} />
              <td style={{ ...td, ...MONO }}>{si(data.totals.sellSum)}</td>
              <td style={{ ...td, ...MONO, color: col(data.totals.vatToPay) }}>{si(data.totals.vatToPay)}</td>
              <td style={{ ...td, ...MONO, color: col(data.totals.profit) }}>{si(data.totals.profit)}</td>
              <td style={{ ...td, ...MONO }}>{pct(data.totals.margin)}</td>
              <td style={{ ...td, background: '#FFF8E6' }} />
              <td style={{ ...td, ...MONO, background: '#FFF8E6', color: '#C62828' }}>−{_int.format(Math.abs(Math.round(data.totals.commission)))}</td>
              <td style={{ ...td, ...MONO, color: '#5B2FD6' }}>{si(data.totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th = { padding: '14px 16px', textAlign: 'right', borderBottom: '1px solid #ECEAF2', fontWeight: 600 }
const thL = { ...th, textAlign: 'left' }
const td = { padding: '14px 16px', textAlign: 'right', borderBottom: '1px solid #ECEAF2', verticalAlign: 'middle' }
const tdL = { ...td, textAlign: 'left' }

function InvoiceRow({ inv, userId, onChanged }) {
  const [open, setOpen] = useState(false)
  const [pctVal, setPctVal] = useState(inv.percent ? String(inv.percent) : '')
  const [agent, setAgent] = useState(inv.agentName || '')
  const [savedPct, setSavedPct] = useState(inv.percent)

  const loss = inv.profit <= 0
  const livePct = Number(pctVal) || 0
  const commission = loss ? 0 : Math.round(inv.profit * livePct / 100)
  const net = inv.profit - commission

  const persist = async (p, a) => {
    try { await saveAgent(inv.id, { agentName: a, percent: p, userId }); setSavedPct(p); onChanged() }
    catch (e) { alert(e.message) }
  }
  const onPctBlur = () => { if ((Number(pctVal) || 0) !== (Number(savedPct) || 0)) persist(Number(pctVal) || 0, agent) }

  return (
    <>
      <tr style={{ background: open ? '#F7F5FC' : undefined, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td style={tdL}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className={`ti ti-chevron-${open ? 'down' : 'right'}`} style={{ color: open ? '#5B2FD6' : '#8A849C', fontSize: 16 }} />
            <span style={{ fontWeight: 700 }}>{inv.doc_number}</span>
            <span style={{ ...MONO, fontSize: 12, color: '#5E5A6B' }}>{d2(inv.doc_date)}</span>
          </div>
        </td>
        <td style={tdL}>{inv.client}</td>
        <td style={{ ...td, ...MONO }}>{si(inv.sellSum)}</td>
        <td style={{ ...td, ...MONO, color: col(inv.vatToPay) }}>{si(inv.vatToPay)}</td>
        <td style={{ ...td, ...MONO, color: col(inv.profit) }}>{si(inv.profit)}</td>
        <td style={{ ...td, ...MONO, color: inv.margin != null && inv.margin < 0 ? '#C62828' : '#17151F' }}>{pct(inv.margin)}</td>
        <td style={{ ...td, background: '#FFFCF2' }} onClick={e => e.stopPropagation()}>
          {loss ? <span style={{ fontSize: 12, color: '#8A849C' }}>збиток</span>
            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                <input value={pctVal} onChange={e => setPctVal(e.target.value.replace(/[^\d.]/g, ''))} onBlur={onPctBlur} placeholder="—"
                  style={{ width: 52, height: 32, padding: '0 8px', border: '1px solid #E6D9B0', borderRadius: 8, background: '#fff', ...MONO, fontSize: 13, textAlign: 'right' }} />
                <span style={{ color: '#5E5A6B', fontSize: 13 }}>%</span>
              </span>}
        </td>
        <td style={{ ...td, ...MONO, background: '#FFFCF2', color: commission > 0 ? '#C62828' : '#B8B4C4' }}>{commission > 0 ? '−' + _int.format(commission) : '0'}</td>
        <td style={{ ...td, ...MONO, fontWeight: 700, color: col(net) }}>{si(net)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ padding: '0 16px 16px 40px', background: '#F7F5FC' }}>
            <ItemsTable inv={inv} />
            <div style={{ marginTop: 12, background: '#FFF8E6', border: '1px solid #F0E2B6', borderRadius: 12, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 24px', fontSize: 14 }}>
              <span style={{ fontWeight: 700 }}>Агентські</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ color: '#5E5A6B', fontSize: 13 }}>Агент</label>
                <input value={agent} onChange={e => setAgent(e.target.value)} onBlur={() => persist(Number(pctVal) || 0, agent)} placeholder="Ім'я агента"
                  style={{ minWidth: 160, height: 36, padding: '0 10px', border: '1px solid #E6D9B0', borderRadius: 8, background: '#fff', fontFamily: 'inherit', fontSize: 14 }} />
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ color: '#5E5A6B', fontSize: 13 }}>% від прибутку</label>
                <input value={pctVal} onChange={e => setPctVal(e.target.value.replace(/[^\d.]/g, ''))} onBlur={onPctBlur} placeholder="—" disabled={loss}
                  style={{ width: 56, height: 36, padding: '0 8px', border: '1px solid #E6D9B0', borderRadius: 8, background: loss ? '#F0EFF4' : '#fff', ...MONO, fontSize: 14, textAlign: 'right' }} />
              </span>
              {!loss
                ? <span style={{ ...MONO, color: '#5E5A6B' }}>{si(inv.profit)} × {livePct}% = <span style={{ color: '#C62828', fontWeight: 600 }}>−{_int.format(commission)}</span></span>
                : <span style={{ fontSize: 13, color: '#8A849C' }}>Збиток — агентські не нараховуються</span>}
              <span style={{ marginLeft: 'auto' }}>Чистий прибуток <span style={{ ...MONO, fontWeight: 800, color: '#5B2FD6', fontSize: 16 }}>{si(net)} ₴</span></span>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ItemsTable({ inv }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E6E2F0', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ fontSize: 11, color: '#5E5A6B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <th style={{ ...dth2, borderBottom: 'none' }} colSpan={2} />
            <th style={{ ...dth2, background: '#FAF9FC', textAlign: 'center', borderBottom: 'none' }} colSpan={2}>Закупка</th>
            <th style={{ ...dth2, background: '#F3F6FF', textAlign: 'center', borderBottom: 'none', color: '#2848C7' }} colSpan={2}>Реалізація</th>
            <th style={{ ...dth2, borderBottom: 'none' }} colSpan={3} />
          </tr>
          <tr style={{ fontSize: 12, color: '#5E5A6B' }}>
            <th style={dthL}>Найменування</th><th style={dth}>К-сть</th>
            <th style={{ ...dth, background: '#FAF9FC' }}>Ціна</th><th style={{ ...dth, background: '#FAF9FC' }}>Сума</th>
            <th style={{ ...dth, background: '#F3F6FF' }}>Ціна</th><th style={{ ...dth, background: '#F3F6FF' }}>Сума</th>
            <th style={dth}>ПДВ до сплати</th><th style={{ ...dth, fontWeight: 700 }}>Прибуток</th><th style={{ ...dth, fontWeight: 700 }}>Маржа</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((x, i) => (
            <tr key={i} style={{ fontSize: 13 }}>
              <td style={dtdL}>{x.name}</td>
              <td style={{ ...dtd, ...MONO }}>{_int.format(x.qty)} {x.unit}</td>
              <td style={{ ...dtd, ...MONO, background: '#FAF9FC' }}>{si(x.buyUnit)}</td>
              <td style={{ ...dtd, ...MONO, background: '#FAF9FC' }}>{si(x.buySum)}</td>
              <td style={{ ...dtd, ...MONO, background: '#F3F6FF' }}>{si(x.sellUnit)}</td>
              <td style={{ ...dtd, ...MONO, background: '#F3F6FF' }}>{si(x.sellSum)}</td>
              <td style={{ ...dtd, ...MONO, color: col(x.vatToPay) }}>{si(x.vatToPay)}</td>
              <td style={{ ...dtd, ...MONO, fontWeight: 600, color: col(x.profit) }}>{si(x.profit)}</td>
              <td style={{ ...dtd, ...MONO, fontWeight: 600, color: x.margin != null && x.margin < 0 ? '#C62828' : '#17151F' }}>{pct(x.margin)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, borderTop: '1px solid #DDD9E8' }}>
            <td style={dtdL}>Разом по накладній</td><td style={dtd} />
            <td style={{ ...dtd, background: '#FAF9FC' }} /><td style={{ ...dtd, ...MONO, background: '#FAF9FC' }}>{si(inv.buySum)}</td>
            <td style={{ ...dtd, background: '#F3F6FF' }} /><td style={{ ...dtd, ...MONO, background: '#F3F6FF' }}>{si(inv.sellSum)}</td>
            <td style={{ ...dtd, ...MONO, color: col(inv.vatToPay) }}>{si(inv.vatToPay)}</td>
            <td style={{ ...dtd, ...MONO, color: col(inv.profit) }}>{si(inv.profit)}</td>
            <td style={{ ...dtd, ...MONO }}>{pct(inv.margin)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
const dth = { padding: '9px 12px', textAlign: 'right', borderBottom: '1px solid #EFECF5', fontWeight: 600 }
const dthL = { ...dth, textAlign: 'left' }
const dth2 = { padding: '6px 12px', fontWeight: 700 }
const dtd = { padding: '9px 12px', textAlign: 'right', borderBottom: '1px solid #EFECF5' }
const dtdL = { ...dtd, textAlign: 'left' }

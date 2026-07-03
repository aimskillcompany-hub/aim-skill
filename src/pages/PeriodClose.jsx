import { useState, useEffect } from 'react'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import { listClosings, periodStatus, runChecklist, computeSnapshot, closePeriod, reopenPeriod } from '../lib/periodClose'

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const si = v => (v < 0 ? '−' : '') + fmt(v)
const col = v => (v >= 0 ? 'var(--green)' : 'var(--red)')

const STATUS = {
  open: { label: 'Відкритий', color: 'var(--text3)', bg: 'var(--surface2)' },
  closed: { label: 'Закритий', color: '#fff', bg: 'var(--green)' },
  reopened: { label: 'Переоткритий', color: '#fff', bg: 'var(--amber, #d97706)' },
}

export default function PeriodClose() {
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [closings, setClosings] = useState([])
  const [sel, setSel] = useState(null) // month 1..12
  const [check, setCheck] = useState(null)
  const [snap, setSnap] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState(null)

  const load = async () => setClosings(await listClosings())
  useEffect(() => { load() }, [])

  const rowFor = (m) => closings.find(c => c.period_year === year && c.period_month === m)
  const openMonth = async (m) => {
    setSel(m); setCheck(null); setSnap(null); setErr(null)
    const r = rowFor(m)
    if (r?.status === 'closed') { setSnap(r.snapshot) }
  }

  const doCheck = async () => {
    setBusy('check'); setErr(null)
    try { setCheck(await runChecklist(year, sel)) } catch (e) { setErr(e.message) }
    setBusy('')
  }
  const doPreview = async () => {
    setBusy('preview'); setErr(null)
    try { setSnap(await computeSnapshot(year, sel)) } catch (e) { setErr(e.message) }
    setBusy('')
  }
  const doClose = async () => {
    if (!confirm(`Закрити ${MONTHS[sel - 1]} ${year}? Дані періоду буде заблоковано для змін.`)) return
    setBusy('close'); setErr(null)
    try { const s = await closePeriod(year, sel, user?.id); setSnap(s); await load() } catch (e) { setErr(e.message) }
    setBusy('')
  }
  const doReopen = async () => {
    if (!confirm(`Переоткрити ${MONTHS[sel - 1]} ${year}? Блокування знімається, знімок стане неактуальним.`)) return
    setBusy('reopen'); setErr(null)
    try { await reopenPeriod(year, sel, user?.id); await load(); setSnap(null) } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const selRow = sel ? rowFor(sel) : null
  const selStatus = sel ? periodStatus(closings, year, sel) : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ margin: 0 }}>Закриття періоду</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn" onClick={() => { setYear(y => y - 1); setSel(null) }}>←</button>
          <b style={{ minWidth: 54, textAlign: 'center' }}>{year}</b>
          <button className="btn" onClick={() => { setYear(y => y + 1); setSel(null) }}>→</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {MONTHS.map((name, i) => {
            const m = i + 1
            const st = periodStatus(closings, year, m)
            const s = STATUS[st]
            const isFuture = year > now.getFullYear() || (year === now.getFullYear() && m > now.getMonth() + 1)
            return (
              <div key={m} onClick={() => !isFuture && openMonth(m)}
                style={{
                  border: `1px solid ${sel === m ? 'var(--blue)' : 'var(--border)'}`, borderRadius: 10, padding: '10px 12px',
                  cursor: isFuture ? 'default' : 'pointer', opacity: isFuture ? 0.4 : 1,
                  background: sel === m ? 'var(--blueBg, #eff4ff)' : 'var(--surface)',
                }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{name}</div>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, color: s.color, background: s.bg }}>{s.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {err && <div className="card" style={{ color: 'var(--red)', marginBottom: 16 }}>{err}</div>}

      {sel && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ margin: 0 }}>{MONTHS[sel - 1]} {year}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {selStatus !== 'closed' && <>
                <button className="btn" onClick={doCheck} disabled={busy === 'check'}>
                  <i className="ti ti-checklist" /> {busy === 'check' ? '…' : 'Перевірити готовність'}
                </button>
                <button className="btn" onClick={doPreview} disabled={busy === 'preview'}>
                  <i className="ti ti-eye" /> {busy === 'preview' ? '…' : 'Попередній знімок'}
                </button>
                <button className="btn btn-primary" onClick={doClose} disabled={busy === 'close' || (check && check.blockers > 0)}
                  title={check && check.blockers > 0 ? 'Спершу усуньте блокери' : ''}>
                  <i className="ti ti-lock" /> {busy === 'close' ? '…' : 'Закрити період'}
                </button>
              </>}
              {selStatus === 'closed' && isAdmin && (
                <button className="btn" onClick={doReopen} disabled={busy === 'reopen'} style={{ color: 'var(--red)' }}>
                  <i className="ti ti-lock-open" /> {busy === 'reopen' ? '…' : 'Переоткрити'}
                </button>
              )}
            </div>
          </div>

          {selStatus === 'closed' && selRow && (
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>
              🔒 Закрито {selRow.closed_at?.slice(0, 10)}{selRow.reopened_at ? ` · переоткривалось ${selRow.reopened_at.slice(0, 10)}` : ''}
            </div>
          )}

          {check && <Checklist check={check} />}
          {snap && <Snapshot snap={snap} frozen={selStatus === 'closed'} />}
        </div>
      )}
    </div>
  )
}

function Checklist({ check }) {
  const ok = check.blockers === 0
  return (
    <div style={{ marginBottom: 18, border: `1px solid ${ok ? 'var(--green)' : 'var(--red)'}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10, color: ok ? 'var(--green)' : 'var(--red)' }}>
        {ok ? '✅ Період готовий до закриття' : `⚠️ Блокери закриття: ${check.blockers}`}
      </div>
      <Row bad={check.negativeStock.length > 0} label="Мінусові залишки складу"
        val={check.negativeStock.length ? `${check.negativeStock.length} товар(ів)` : 'немає'} />
      {check.negativeStock.slice(0, 8).map(n => (
        <div key={n.id} style={{ fontSize: 12, color: 'var(--red)', marginLeft: 24 }}>• {n.name?.slice(0, 55)} = {n.qty}</div>
      ))}
      <Row bad={check.docsNoAmount.length > 0} label="Документи без суми"
        val={check.docsNoAmount.length ? `${check.docsNoAmount.length} шт` : 'немає'} />
      <Row bad={false} warn={check.unclassifiedTx > 0} label="Некласифіковані транзакції (не блокує)"
        val={check.unclassifiedTx ? `${check.unclassifiedTx} шт` : 'немає'} />
    </div>
  )
}
const Row = ({ bad, warn, label, val }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
    <span><i className={`ti ${bad ? 'ti-x' : warn ? 'ti-alert-triangle' : 'ti-check'}`} style={{ color: bad ? 'var(--red)' : warn ? 'var(--amber, #d97706)' : 'var(--green)', marginRight: 6 }} />{label}</span>
    <b>{val}</b>
  </div>
)

function Snapshot({ snap, frozen }) {
  const t = snap.pl?.totals || {}
  const m = snap.margin || {}
  const kpi = [
    { label: 'Дохід (P&L)', v: t.revenue, c: 'var(--green)' },
    { label: 'Витрати', v: (t.cogs || 0) + (t.opex || 0), c: 'var(--red)' },
    { label: 'Чистий P&L', v: t.net, c: col(t.net || 0) },
    { label: 'Маржа (реалізація)', v: m.marginSum, c: col(m.marginSum || 0) },
    { label: 'Оцінка складу', v: snap.stock?.totalValue, c: 'var(--text)' },
    { label: 'Гроші (Банк+Каса)', v: snap.cashBankTotal, c: 'var(--text)' },
    { label: 'Дебіторка', v: snap.receivable, c: 'var(--green)' },
    { label: 'Кредиторка', v: snap.payable, c: 'var(--red)' },
  ]
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{frozen ? '🔒 Заморожений знімок' : 'Попередній знімок (не збережено)'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        {kpi.map(k => (
          <div key={k.label} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.c }}>{si(k.v || 0)}</div>
          </div>
        ))}
      </div>
      {snap.stock?.items?.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>Залишки складу ({snap.stock.count}) — оцінка {fmt(snap.stock.totalValue)}</summary>
          <table style={{ width: '100%', fontSize: 12, marginTop: 8 }}>
            <thead><tr style={{ color: 'var(--text3)', textAlign: 'right' }}>
              <th style={{ textAlign: 'left' }}>Товар</th><th>К-сть</th><th>Собів/од</th><th>Вартість</th></tr></thead>
            <tbody>
              {snap.stock.items.slice(0, 60).map(it => (
                <tr key={it.product_id} style={{ textAlign: 'right' }}>
                  <td style={{ textAlign: 'left' }}>{it.name?.slice(0, 45)}</td>
                  <td style={{ color: it.qty < 0 ? 'var(--red)' : 'inherit' }}>{it.qty}</td>
                  <td>{fmt(it.unit_cost)}</td><td>{fmt(it.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

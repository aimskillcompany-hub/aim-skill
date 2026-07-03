import { useState, useEffect } from 'react'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import { listClosings, periodStatus, runChecklist, computeSnapshot, closePeriod, reopenPeriod, computeContinuity, snapshotDiff } from '../lib/periodClose'

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
  const [cont, setCont] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState(null)

  const load = async () => setClosings(await listClosings())
  useEffect(() => { load() }, [])

  const rowFor = (m) => closings.find(c => c.period_year === year && c.period_month === m)
  const openMonth = async (m) => {
    setSel(m); setCheck(null); setSnap(null); setCont(null); setErr(null)
    const r = rowFor(m)
    if (r?.status === 'closed') { setSnap(r.snapshot) }
  }

  const doCont = async () => {
    setBusy('cont'); setErr(null)
    try { setCont(await computeContinuity(year, sel)) } catch (e) { setErr(e.message) }
    setBusy('')
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={doCont} disabled={busy === 'cont'}>
                <i className="ti ti-arrows-exchange" /> {busy === 'cont' ? '…' : 'Рух за період'}
              </button>
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
          {snap?._prev && <SnapDiff snap={snap} />}
          {cont && <Continuity cont={cont} />}
          {snap && <Snapshot snap={snap} frozen={selStatus === 'closed'} />}
        </div>
      )}
    </div>
  )
}

function SnapDiff({ snap }) {
  const diff = snapshotDiff(snap)
  if (!diff) return null
  const sd = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(v)
  const dc = v => Math.abs(v) < 0.5 ? 'var(--text3)' : v > 0 ? 'var(--green)' : 'var(--red)'
  const items = [
    ['Чистий P&L', diff.totals.plNet], ['Дохід', diff.totals.revenue], ['Витрати', diff.totals.expense],
    ['Маржа', diff.totals.marginSum], ['Оцінка складу', diff.totals.stockValue],
    ['Гроші', diff.totals.cashBank], ['Дебіторка', diff.totals.receivable], ['Кредиторка', diff.totals.payable],
  ]
  return (
    <div style={{ marginBottom: 18, border: '1px solid var(--amber, #d97706)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>
        🔁 Зміни з попереднього закриття{diff.prevClosedAt ? ` (${diff.prevClosedAt.slice(0, 10)})` : ''}
      </div>
      {!diff.changed && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Нічого не змінилось — цифри збіглися з попереднім закриттям.</div>}
      {diff.changed && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 8, marginBottom: 12 }}>
          {items.filter(([, v]) => Math.abs(v) > 0.5).map(([label, v]) => (
            <div key={label} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</div>
              <div style={{ fontWeight: 700, color: dc(v) }}>{sd(v)}</div>
            </div>
          ))}
        </div>
        {diff.products.length > 0 && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>Змінені товари ({diff.products.length})</summary>
            <table style={{ width: '100%', fontSize: 12, marginTop: 8 }}>
              <thead><tr style={{ color: 'var(--text3)', textAlign: 'right' }}>
                <th style={{ textAlign: 'left' }}>Товар</th><th>Було</th><th>Стало</th><th>Δ вартість</th></tr></thead>
              <tbody>
                {diff.products.slice(0, 80).map(p => (
                  <tr key={p.product_id} style={{ textAlign: 'right' }}>
                    <td style={{ textAlign: 'left' }}>{p.name?.slice(0, 42)}</td>
                    <td>{p.prevQty}</td><td><b>{p.curQty}</b></td>
                    <td style={{ color: dc(p.valD) }}>{sd(p.valD)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </>}
    </div>
  )
}

function Continuity({ cont }) {
  const c = cont.cashTot
  return (
    <div style={{ marginBottom: 18, border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Гроші: на початок + рух = на кінець</div>
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead><tr style={{ color: 'var(--text3)', textAlign: 'right' }}>
          <th style={{ textAlign: 'left' }}>Рахунок</th><th>На початок</th><th>Надходження</th><th>Витрати</th><th>На кінець</th></tr></thead>
        <tbody>
          {cont.cash.map(a => (
            <tr key={a.id} style={{ textAlign: 'right' }}>
              <td style={{ textAlign: 'left' }}>{a.name}</td>
              <td>{si(a.opening)}</td>
              <td style={{ color: 'var(--green)' }}>{a.inflow ? '+' + fmt(a.inflow) : '—'}</td>
              <td style={{ color: 'var(--red)' }}>{a.outflow ? '−' + fmt(a.outflow) : '—'}</td>
              <td><b>{si(a.closing)}</b></td>
            </tr>
          ))}
          <tr style={{ textAlign: 'right', borderTop: '2px solid var(--border)', fontWeight: 700 }}>
            <td style={{ textAlign: 'left' }}>Разом</td>
            <td>{si(c.opening)}</td><td style={{ color: 'var(--green)' }}>+{fmt(c.inflow)}</td>
            <td style={{ color: 'var(--red)' }}>−{fmt(c.outflow)}</td><td>{si(c.closing)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ fontWeight: 700, margin: '18px 0 8px' }}>
        Склад (оцінка за собівартістю): на початок {fmt(cont.stock.openVal)} → на кінець <b>{fmt(cont.stock.closeVal)}</b>
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>Товари ({cont.stock.items.length}): к-сть на початок + прихід − видаток = на кінець</summary>
        <table style={{ width: '100%', fontSize: 12, marginTop: 8 }}>
          <thead><tr style={{ color: 'var(--text3)', textAlign: 'right' }}>
            <th style={{ textAlign: 'left' }}>Товар</th><th>Початок</th><th>Прихід</th><th>Видаток</th><th>Кінець</th><th>Вартість кін.</th></tr></thead>
          <tbody>
            {cont.stock.items.slice(0, 100).map(it => (
              <tr key={it.product_id} style={{ textAlign: 'right' }}>
                <td style={{ textAlign: 'left' }}>{it.name?.slice(0, 42)}</td>
                <td>{it.open}</td>
                <td style={{ color: 'var(--green)' }}>{it.inQ ? '+' + it.inQ : '—'}</td>
                <td style={{ color: 'var(--red)' }}>{it.outQ ? '−' + it.outQ : '—'}</td>
                <td style={{ color: it.close < 0 ? 'var(--red)' : 'inherit' }}><b>{it.close}</b></td>
                <td>{fmt(it.closeVal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
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

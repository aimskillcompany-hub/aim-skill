import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../lib/company'
import { fmtInt } from '../lib/fmt'
import { computeOrderMargins } from '../lib/accrual'
import { todayKyiv } from '../lib/dates'
import { useNewUi } from '../lib/uiPrefs'
import OrderMarginsNew from './OrderMarginsNew'

// «Маржа по замовленнях»: по замовленнях, відвантажених у періоді (дата поставки = остання видаткова/акт):
// виручка і собівартість відвантаженого (без ПДВ, як у P&L за нарахуванням), маржа, %, дата поставки,
// дата повної оплати клієнтом, днів до оплати.
const d = (s) => s ? s.split('-').reverse().join('.') : '—'
const money = (v) => `${v < 0 ? '−' : ''}${fmtInt(v)}`

export default function OrderMarginsReport() {
  const { activeId } = useCompany()
  const t = todayKyiv()
  const [from, setFrom] = useState(t.slice(0, 4) + '-01-01')
  const [to, setTo] = useState(t)
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [sort, setSort] = useState({ key: 'shipDate', dir: -1 })

  useEffect(() => {
    let cancelled = false
    setRows(null); setErr(null)
    computeOrderMargins(from, to).then(r => { if (!cancelled) setRows(r) }).catch(e => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [from, to, activeId])

  const sorted = useMemo(() => {
    if (!rows) return []
    const v = (r) => r[sort.key] ?? (sort.dir > 0 ? Infinity : -Infinity)
    return [...rows].sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir)
  }, [rows, sort])

  const tot = useMemo(() => {
    const s = { revenue: 0, cost: 0, margin: 0 }
    ;(rows || []).forEach(r => { s.revenue += r.revenue; s.cost += r.cost; s.margin += r.margin })
    const paidRows = (rows || []).filter(r => r.daysToPay != null)
    s.avgDays = paidRows.length ? paidRows.reduce((a, r) => a + r.daysToPay, 0) / paidRows.length : null
    s.pct = s.revenue > 0 ? s.margin / s.revenue : null
    return s
  }, [rows])

  const newUi = useNewUi()
  if (newUi) return <OrderMarginsNew rows={rows} err={err} from={from} to={to} setFrom={setFrom} setTo={setTo} today={t} />

  const Th = ({ k, children, right }) => (
    <th onClick={() => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : -1 }))} style={{ textAlign: right ? 'right' : 'left', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
      {children}{sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div>
      <div className="compact" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="form-group"><label>Поставка з</label><input type="date" className="form-input" value={from} onChange={e => e.target.value && setFrom(e.target.value)} /></div>
        <div className="form-group"><label>по</label><input type="date" className="form-input" value={to} onChange={e => e.target.value && setTo(e.target.value)} /></div>
        {rows && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginLeft: 'auto', fontSize: 13 }}>
            <span>Замовлень: <b>{rows.length}</b></span>
            <span>Виручка: <b>{money(tot.revenue)}</b></span>
            <span>Маржа: <b style={{ color: tot.margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(tot.margin)}</b>{tot.pct != null && <> · {(tot.pct * 100).toFixed(1)}%</>}</span>
            <span>Сер. днів до оплати: <b>{tot.avgDays != null ? Math.round(tot.avgDays) : '—'}</b></span>
          </div>
        )}
      </div>

      {err && <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}</div>}
      <div className="card">
        {!rows ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : rows.length === 0 ? <p style={{ color: 'var(--text3)', margin: 0 }}>Немає замовлень з відвантаженням у цьому періоді (потрібна видаткова накладна або акт, прив'язані до замовлення).</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <Th k="number">Замовлення</Th><Th k="client">Клієнт</Th>
                <Th k="revenue" right>Виручка</Th><Th k="cost" right>Собівартість</Th><Th k="margin" right>Маржа</Th><Th k="marginPct" right>% маржі</Th>
                <Th k="shipDate">Поставка</Th><Th k="payDate">Оплата</Th><Th k="daysToPay" right>Днів до оплати</Th>
              </tr></thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}><Link to={`/orders/${r.id}`}>№{r.number}</Link></td>
                    <td><div className="trunc" style={{ maxWidth: 260 }}>{r.client}</div></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.revenue)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: r.missingCost ? '#B45309' : undefined }} title={r.missingCost ? 'Частина позицій без собівартості — маржа завищена' : r.estimatedCost ? 'Частина позицій без партії — собівартість оцінена (поточна)' : undefined}>
                      {money(r.cost)}{(r.missingCost || r.estimatedCost) && <i className="ti ti-alert-triangle" style={{ marginLeft: 4 }} />}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: r.margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(r.margin)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.marginPct != null ? (r.marginPct * 100).toFixed(1) + '%' : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{d(r.shipDate)}</td>
                    <td style={{ whiteSpace: 'nowrap', color: r.payDate ? undefined : 'var(--text3)' }}>
                      {r.payDate ? d(r.payDate) : r.paid > 0 ? `частково ${Math.round((r.paidPct || 0) * 100)}%` : 'не оплачено'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: r.daysToPay > 30 ? 'var(--red)' : undefined }}>{r.daysToPay != null ? r.daysToPay : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text3)', margin: '10px 0 0' }}>
          Виручка і собівартість — відвантаженого (видаткові накладні й акти замовлення, без ПДВ), як у P&L за нарахуванням. Поставка — дата останнього документа відвантаження.
          Оплата — дата, коли оплати клієнта (через документи, замовлення або пряму прив'язку; та сама транзакція — один раз) покрили суму документів з ПДВ.
          <i className="ti ti-alert-triangle" style={{ color: '#B45309', margin: '0 3px' }} />— у частини позицій немає собівартості.
        </p>
      </div>
    </div>
  )
}

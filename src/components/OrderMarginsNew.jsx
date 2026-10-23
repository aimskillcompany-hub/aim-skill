// «Маржа по замовленнях» — новий інтерфейс (ТЗ 5.1; макет Margin). Дані — ті самі rows з computeOrderMargins;
// тут лише відбір, сортування й показ. Збиткові / з маржею < 5% / без собівартості — підсвічені.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatAmount } from '../utils/format'
import { Segmented, TableSkeleton, EmptyState, Button } from './ui'

const d = (s) => s ? s.split('-').reverse().join('.') : '—'
const dm = (s) => s ? s.slice(8, 10) + '.' + s.slice(5, 7) : ''
const n0 = (v) => formatAmount(v, { decimals: 0 })
const pctTxt = (p) => p == null ? '—' : `${(p * 100).toFixed(1).replace('.', ',')}%`
const risky = (r) => r.missingCost || r.margin < 0 || (r.marginPct != null && r.marginPct < 0.05)
const PAGE = 25

export default function OrderMarginsNew({ rows, err, from, to, setFrom, setTo, today }) {
  const [preset, setPreset] = useState('ytd')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'shipDate', dir: -1 })
  const [limit, setLimit] = useState(PAGE)

  const applyPreset = (p) => {
    setPreset(p); setLimit(PAGE)
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
    const iso = (yy, mm, dd = 1) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    if (p === 'month') setFrom(iso(y, m))
    if (p === 'quarter') setFrom(iso(y, Math.floor((m - 1) / 3) * 3 + 1))
    if (p === 'year') { const s = new Date(Date.UTC(y - 1, m - 1, Number(today.slice(8, 10)) + 1)); setFrom(s.toISOString().slice(0, 10)) }
    if (p === 'ytd') setFrom(iso(y, 1))
    setTo(today)
  }

  const counts = useMemo(() => {
    const r = rows || []
    return { all: r.length, unpaid: r.filter(x => !x.payDate).length, risky: r.filter(risky).length, late: r.filter(x => x.daysToPay > 30).length }
  }, [rows])
  const list = useMemo(() => {
    let r = rows || []
    if (filter === 'unpaid') r = r.filter(x => !x.payDate)
    if (filter === 'risky') r = r.filter(risky)
    if (filter === 'late') r = r.filter(x => x.daysToPay > 30)
    const v = (x) => x[sort.key] ?? (sort.dir > 0 ? Infinity : -Infinity)
    return [...r].sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir)
  }, [rows, filter, sort])
  const tot = useMemo(() => {
    const s = { revenue: 0, margin: 0 }
    ;(rows || []).forEach(r => { s.revenue += r.revenue; s.margin += r.margin })
    const paid = (rows || []).filter(r => r.daysToPay != null)
    s.avgDays = paid.length ? Math.round(paid.reduce((a, r) => a + r.daysToPay, 0) / paid.length) : null
    return s
  }, [rows])
  const clients = useMemo(() => {
    const m = {}
    ;(rows || []).forEach(r => { const c = (m[r.client || '—'] ||= { name: r.client || '—', n: 0, revenue: 0, margin: 0 }); c.n++; c.revenue += r.revenue; c.margin += r.margin })
    return Object.values(m).sort((a, b) => b.margin - a.margin)
  }, [rows])
  const cMax = Math.max(1, ...clients.map(c => c.revenue))

  const Th = ({ k, children }) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : -1 }))}>{children}{sort.key === k && <i className={`ti ${sort.dir > 0 ? 'ti-arrow-up' : 'ti-arrow-down'}`} aria-hidden="true" />}</button>
    </th>
  )

  return (
    <div className="mgn">
      <div className="an-toolbar">
        <span className="cfn-muted cfn-sm">Поставка</span>
        <Segmented ariaLabel="Період поставки" value={preset} onChange={applyPreset}
          options={[{ value: 'month', label: 'Місяць' }, { value: 'quarter', label: 'Квартал' }, { value: 'year', label: 'Рік' }, { value: 'ytd', label: 'З 1 січня' }]} />
        <span className="mgn-dates">
          <input type="date" className="form-input" aria-label="Поставка з" value={from} onChange={e => { if (e.target.value) { setFrom(e.target.value); setPreset(null) } }} />
          <span aria-hidden="true">—</span>
          <input type="date" className="form-input" aria-label="Поставка по" value={to} onChange={e => { if (e.target.value) { setTo(e.target.value); setPreset(null) } }} />
        </span>
      </div>

      {err && <div className="cfn-card cfn-err">Не вдалося порахувати маржу: {err}</div>}
      {!rows ? <TableSkeleton rows={10} cols={7} label="Рахую маржу…" /> : rows.length === 0
        ? <EmptyState icon="ti-percentage" title="Немає відвантажених замовлень" text="У цьому періоді немає видаткових накладних чи актів, прив'язаних до замовлень." />
        : <>
          <div className="mgn-kpis">
            <div className="mgn-hero"><span>Маржа</span><b className={tot.margin < 0 ? 'is-neg' : ''}>{n0(tot.margin)} ₴</b><small>{tot.revenue ? pctTxt(tot.margin / tot.revenue) : '—'} від виручки</small></div>
            <div className="cfn-card mgn-kpi"><span>Виручка без ПДВ</span><b>{n0(tot.revenue)} ₴</b><small>{rows.length} замовл. відвантажено</small></div>
            <div className="cfn-card mgn-kpi"><span>Сер. днів до оплати</span><b>{tot.avgDays ?? '—'}{tot.avgDays != null && ' дн.'}</b><small>від поставки до грошей</small></div>
            <button type="button" className={`cfn-card mgn-kpi mgn-risk${counts.risky ? ' is-warn' : ' is-none'}`} onClick={() => { setFilter('risky'); setLimit(PAGE) }}>
              <span>Потребують уваги</span><b>{counts.risky} замовл.</b><small>маржа &lt; 5%, збиток або без собівартості</small><em className="mgn-risk-go">Показати</em></button>
          </div>

          <section className="cfn-card mgn-clients" aria-label="Маржа по клієнтах">
            <div className="pln-months-head"><h2>Маржа по клієнтах</h2><span className="cfn-muted cfn-sm">за всіма замовленнями періоду</span></div>
            <ul>
              {clients.slice(0, 8).map(c => (
                <li key={c.name}>
                  <span className="mgn-cl-name"><b>{c.name}</b> <small>· {c.n} зам.</small></span>
                  <span className="mgn-cl-bar" aria-hidden="true"><span style={{ width: `${(c.revenue / cMax) * 100}%` }}><i style={{ width: `${c.revenue > 0 ? Math.max(0, Math.min(1, c.margin / c.revenue)) * 100 : 0}%` }} /></span></span>
                  <span className="mgn-cl-sum"><b className={c.margin < 0 ? 'is-neg' : ''}>{n0(c.margin)}</b> <small>з {n0(c.revenue)}</small></span>
                  <span className={`mgn-cl-pct${c.revenue && c.margin / c.revenue < 0.05 ? ' is-low' : ''}`}>{c.revenue ? pctTxt(c.margin / c.revenue) : '—'}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="cfn-card cfn-report" aria-label="Замовлення">
            <div className="cfn-report-head">
              <Segmented ariaLabel="Відбір" className="is-chips-sm" value={filter} onChange={f => { setFilter(f); setLimit(PAGE) }}
                options={[{ value: 'all', label: 'Усі', count: counts.all }, { value: 'unpaid', label: 'Не оплачені', count: counts.unpaid }, { value: 'risky', label: 'Ризикові', count: counts.risky }, { value: 'late', label: 'Оплата > 30 днів', count: counts.late }]} />
            </div>
            <div className="cfn-tbl mgn-tbl">
              <table>
                <thead><tr><Th k="number">Замовлення</Th><Th k="revenue">Виручка</Th><Th k="cost">Собівартість</Th><Th k="margin">Маржа</Th><Th k="marginPct">% маржі</Th><Th k="shipDate">Поставка</Th><Th k="payDate">Оплата</Th></tr></thead>
                <tbody>
                  {list.slice(0, limit).map(r => {
                    const p = r.marginPct, low = !r.missingCost && p != null && p < 0.05
                    return (
                      <tr key={r.id} className={r.margin < 0 ? 'is-loss' : ''}>
                        <th scope="row"><Link to={`/orders/${r.id}`}>№ {r.number}</Link><small>{r.client}</small></th>
                        <td>{n0(r.revenue)}</td>
                        <td className={r.missingCost ? 'is-neg' : ''}>{r.missingCost && !r.cost ? '0 — немає' : n0(r.cost)}{(r.missingCost || r.estimatedCost) && <i className="ti ti-alert-triangle" title={r.missingCost ? 'Частина позицій без собівартості — маржа завищена' : 'Частина позицій без партії — собівартість оцінена'} />}</td>
                        <td className={`is-strong ${r.margin < 0 ? 'is-neg' : 'is-pos'}`}>{n0(r.margin)}</td>
                        <td className="mgn-pct">
                          <span className="mgn-scale"><span className={`mgn-track${r.missingCost ? ' is-bad' : low || r.margin < 0 ? ' is-low' : ''}`}><i style={{ width: `${p == null ? 0 : Math.max(2, Math.min(1, Math.abs(p) / 0.35) * 100)}%` }} /></span>
                            <b className={r.missingCost ? 'is-neg' : low || r.margin < 0 ? 'is-warn' : ''}>{pctTxt(p)}</b></span>
                          {r.missingCost ? <span className="mgn-tag is-bad">немає собівартості — маржа завищена</span> : r.margin < 0 ? <span className="mgn-tag is-bad">збиток</span> : low ? <span className="mgn-tag">низька маржа</span> : null}
                        </td>
                        <td>{d(r.shipDate)}</td>
                        <td className="mgn-pay">
                          {r.payDate ? <><span className="mgn-tag is-ok">оплачено {dm(r.payDate)}</span>{r.daysToPay != null && <small className={r.daysToPay > 30 ? 'is-neg' : ''}>{r.daysToPay < 0 ? `передоплата ${-r.daysToPay} дн.` : `${r.daysToPay} дн.`}</small>}</>
                            : r.paid > 0 ? <span className="mgn-tag is-part">частково {Math.round((r.paidPct || 0) * 100)}%</span>
                            : <span className="mgn-tag is-bad">не оплачено</span>}
                        </td>
                      </tr>
                    )
                  })}
                  {list.length === 0 && <tr><td colSpan={7} className="pln-empty">У цьому відборі замовлень немає</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mgn-more">
              <span className="cfn-muted cfn-sm">Показано {Math.min(limit, list.length)} з {list.length}</span>
              {list.length > limit && <Button variant="secondary" onClick={() => setLimit(l => l + PAGE)}>Показати ще</Button>}
            </div>
          </section>
          <p className="cfn-muted cfn-sm">Виручка й собівартість — відвантаженого (видаткові й акти замовлення), без ПДВ, як у P&L за нарахуванням. Поставка — дата останнього документа відвантаження. Оплата — коли оплати клієнта покрили суму документів з ПДВ.</p>
        </>}
    </div>
  )
}

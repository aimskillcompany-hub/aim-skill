// «Прогноз → Точність прогнозу» (ТЗ редизайну 5.3, 6.2; макет ForecastAccuracy). Розрахунок — lib/accuracy.
import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../lib/company'
import { computeAccuracy, inForecastWithoutSnapshot, KEYS } from '../lib/accuracy'
import { takeSnapshot, isMissingSnapTable, COST_LABELS } from '../lib/snapshots'
import { formatAmount, plural } from '../utils/format'
import { Button, Callout, EmptyState, TableSkeleton, useToast, InfoTip } from './ui'
import '../pages/Reports.css'
import '../pages/AnalyticsNew.css'
import './ForecastNew.css'

const n0 = (v) => formatAmount(v, { decimals: 0 })
const sg = (v) => formatAmount(v, { decimals: 0, sign: 'always' })
const dm = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : '—'
const pc = (f) => f == null ? '—' : `${Math.round(f * 100)}%`
const LABELS = { revenue: 'Виручка', ...COST_LABELS }
const REASON = { revenue: 'Виручка менша за план', purchase: 'Закупівля дорожча', logistics: 'Логістика дорожча за план', commission: 'Комісії більші', agent: 'Агентські більші', tax: 'Податок більший', other: 'Інші витрати більші' }

export default function ForecastAccuracy() {
  const { companies } = useCompany()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [missing, setMissing] = useState(false)
  const [pending, setPending] = useState([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState({})
  const load = () => {
    if (!companies?.length) return
    setErr(null)
    computeAccuracy(companies).then(setData).catch(e => { if (isMissingSnapTable(e)) { setMissing(true); setData({ rows: [], withoutSnap: 0 }) } else setErr(e.message) })
    inForecastWithoutSnapshot().then(setPending).catch(() => setPending([]))
  }
  useEffect(load, [companies])
  const backfill = async () => {
    setBusy(true); let done = 0
    for (const o of pending) { try { await takeSnapshot(o.id, { late: true }); done++ } catch (e) { toast(`№${o.order_number}: ${e.message}`, { type: 'error' }) } }
    setBusy(false); toast(`Знімок зроблено: ${done} ${plural(done, ['замовлення', 'замовлення', 'замовлень'])}`); load()
  }

  if (err) return <Callout tone="danger" title="Не вдалося порахувати точність." text={err} />
  if (!data) return <TableSkeleton rows={6} cols={6} label="Порівнюю прогноз із фактом…" />
  const rows = data.rows.filter(r => r.planProfit > 0 && !r.noFact)
  const plan = rows.reduce((s, r) => s + r.planProfit, 0), fact = rows.reduce((s, r) => s + r.factProfit, 0)
  const acc = plan > 0 ? fact / plan : null
  const delays = rows.filter(r => r.delay != null)
  const avgDelay = delays.length ? Math.round(delays.reduce((s, r) => s + r.delay, 0) / delays.length) : null
  const late = delays.filter(r => r.delay > 0).length
  const reasons = KEYS.map(k => ({ k, v: rows.reduce((s, r) => s + Math.min(0, r.dev[k]), 0) })).filter(x => x.v < -0.5).sort((a, b) => a.v - b.v)
  const rMax = Math.max(1, ...reasons.map(x => -x.v))
  const tone = (g) => g === 'ok' ? 'is-ok' : g === 'fair' ? 'is-fair' : g === 'bad' ? 'is-bad' : ''

  return (
    <div className="rpt fca">
      {missing && <Callout tone="warn" title="Знімки прогнозу ще не доступні" text="— потрібна міграція 099. До того точність не рахується." />}
      {!missing && pending.length > 0 && (
        <Callout tone="warn" title={`${pending.length} ${plural(pending.length, ['замовлення', 'замовлення', 'замовлень'])} у прогнозі без знімка.`}
          text="Вони стояли «в прогнозі» ще до знімків. Зробимо знімок їхнього поточного плану з позначкою «зроблено пізніше» — тоді після закриття їх можна буде порівняти з фактом."
          action={{ label: busy ? 'Роблю знімки…' : 'Зробити знімок зараз', onClick: busy ? undefined : backfill }} />
      )}
      {rows.length === 0 ? (
        <EmptyState icon="ti-target-arrow" title="Ще немає закритих замовлень зі знімком прогнозу"
          text={`Знімок зберігається, коли замовлення позначають «в прогноз». Після закриття (статус «Закрито») тут з'явиться порівняння плану з фактом.${data.withoutSnap ? ` Закритих без знімка: ${data.withoutSnap} — для них точність не рахується.` : ''}`} />
      ) : <>
        {/* макет ForecastAccuracy (23.10.2026): одна картка з висновком, «Куди ділися», таблиця прибутку план → факт */}
        <section className="rpt-card fca-one" aria-label="Точність прогнозу прибутку">
          <div className="fca-one-n"><span>Справдилось прогнозу прибутку</span>
            <b className={tone(acc == null ? null : acc >= 0.95 && acc <= 1.05 ? 'ok' : acc >= 0.85 ? 'fair' : 'bad')}>{pc(acc)}</b></div>
          <p>Планували заробити <b>{n0(plan)} ₴</b>, заробили <b>{n0(fact)} ₴</b> <span className={fact - plan < 0 ? 'rpt-late' : 'fcn-in'}>({sg(fact - plan)} ₴)</span>.<br />
            {!delays.length ? 'Оплат за закритими замовленнями ще немає.'
              : late ? <>{late} з {delays.length} {plural(delays.length, ['клієнта', 'клієнтів', 'клієнтів'])} заплатили пізніше графіка, у середньому на <b>{Math.round(delays.filter(r => r.delay > 0).reduce((a, r) => a + r.delay, 0) / late)} дн.</b></>
              : 'Усі клієнти заплатили вчасно.'}</p>
        </section>

        {reasons.length > 0 && (
          <section className="rpt-card fca-where" aria-label="Куди ділися гроші">
            <h2 className="rpt-h3">Куди ділися {n0(-reasons.reduce((a, x) => a + x.v, 0))} ₴</h2>
            <div className="fca-bar" aria-hidden="true">{reasons.map((x, i) => <span key={x.k} className={`is-${i}`} style={{ flexGrow: -x.v }} />)}</div>
            <ul className="fca-leg">{reasons.map((x, i) => <li key={x.k}><i className={`is-${i}`} />{REASON[x.k]} <b>{sg(x.v)}</b></li>)}</ul>
          </section>
        )}

        <section className="rpt-card is-flush">
          <div className="cfn-report-head"><h2 className="rpt-h3">Закриті замовлення</h2></div>
          <div className="tbl-wrap rpt-table fca-table"><table>
            <thead><tr><th>Замовлення</th><th className="r">Прибуток: план → факт</th><th className="r">Оплата</th>
              <th className="r">Справдилось<InfoTip label="Справдилось" placement="left">Справдилось = фактичний прибуток ÷ запланований. План — знімок у момент позначки «в прогноз».<br />95–105% — точно<br />85–95% — допустимо<br />нижче 85% — не справдився</InfoTip></th></tr></thead>
            <tbody>
              {data.rows.map(r => {
                const isOpen = !!open[r.id]
                const worst = KEYS.map(k => [k, r.dev[k]]).sort((a, b) => a[1] - b[1])[0]
                return (
                  <Fragment key={r.id}>
                    <tr className="is-click" onClick={() => setOpen(s => ({ ...s, [r.id]: !s[r.id] }))} aria-expanded={isOpen}>
                      <td className="c-name"><i className={`ti ti-chevron-${isOpen ? 'down' : 'right'} rpt-muted`} aria-hidden="true" /> <Link to={`/orders/${r.id}`} className="fcn-num" onClick={e => e.stopPropagation()}>№{r.number}</Link> <span>{r.client}</span>{r.late && <small className="rpt-muted"> · знімок пізніше</small>}</td>
                      <td className="r rpt-num c-net"><span className="rpt-muted">{n0(r.planProfit)} →</span> <b>{n0(r.factProfit)}</b> <small className={r.factProfit - r.planProfit < 0 ? 'rpt-late' : 'fcn-in'}>{sg(r.factProfit - r.planProfit)}</small></td>
                      <td className="r">{r.noFact ? <span className="rpt-muted">немає відвантаження</span> : r.delay == null ? <span className="rpt-muted">не оплачено</span> : r.delay > 0 ? <span className="rpt-late">+{r.delay} дн.</span> : <span className="fcn-in">вчасно</span>}</td>
                      <td className="r"><span className={`fca-g ${tone(r.grade)}`}>{pc(r.accuracy)}</span></td>
                    </tr>
                    {isOpen && (
                      <tr className="rpt-sub"><td colSpan={4}>
                        <div className="fca-row">
                          <p className="fca-concl">{worst && worst[1] < -0.5
                            ? <>Прибуток з’їла стаття «{LABELS[worst[0]]}»: заклали {n0(r.plan[worst[0]])} ₴, фактично {n0(r.fact[worst[0]])} ₴.</>
                            : <>Жодна стаття не погіршила прибуток проти плану.</>}
                            {r.delay > 0 ? ` Клієнт оплатив на ${r.delay} дн. пізніше.` : ''}</p>
                          <p className="fca-lines">{KEYS.filter(k => Math.abs(r.dev[k]) >= 0.5).map(k => (
                            <span key={k}>{LABELS[k]}: {n0(r.plan[k])} → <b>{n0(r.fact[k])}</b> <em className={r.dev[k] < 0 ? 'rpt-late' : 'fcn-in'}>({sg(r.dev[k])})</em></span>))}
                            <span>оплата: план {dm(r.planPay)} → факт {r.factPay ? dm(r.factPay) : '—'}</span>
                            <Link to={`/orders/${r.id}`}>Відкрити замовлення →</Link></p>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table></div>
        </section>
      </>}
    </div>
  )
}

// «Прогноз → Точність прогнозу» (ТЗ редизайну 5.3, 6.2; макет ForecastAccuracy). Розрахунок — lib/accuracy.
import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../lib/company'
import { computeAccuracy, inForecastWithoutSnapshot, KEYS } from '../lib/accuracy'
import { takeSnapshot, isMissingSnapTable, COST_LABELS } from '../lib/snapshots'
import { formatAmount, plural } from '../utils/format'
import { Button, Callout, EmptyState, TableSkeleton, useToast } from './ui'
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
        <section className="fca-hero" aria-label="Точність прогнозу прибутку">
          <div className="fca-main"><span>Точність прогнозу прибутку</span><b className={tone(acc == null ? null : acc >= 0.95 && acc <= 1.05 ? 'ok' : acc >= 0.85 ? 'fair' : 'bad')}>{pc(acc)}</b>
            <small>з кожних 100 ₴ запланованого прибутку отримали {acc == null ? '—' : Math.round(acc * 100)} ₴</small></div>
          <div><span>Прибуток · план</span><b>{n0(plan)} ₴</b></div>
          <div><span>Прибуток · факт</span><b>{n0(fact)} ₴</b><small className={fact - plan < 0 ? 'is-neg' : 'is-pos'}>{sg(fact - plan)} ₴</small></div>
          {!delays.length ? <div><span>Оплата клієнтів</span><b className="is-sm">—</b><small>оплат за закритими замовленнями ще немає</small></div> :
          <div><span>Гроші прийшли {avgDelay > 0 ? 'пізніше' : avgDelay < 0 ? 'раніше' : 'вчасно'}</span><b className="is-sm">{avgDelay == null ? '—' : avgDelay === 0 ? 'вчасно' : `у середньому на ${Math.abs(avgDelay)} дн.`}</b>
            <small>{late} з {delays.length} {plural(delays.length, ['замовлення', 'замовлень', 'замовлень'])} — із затримкою</small></div>}
        </section>

        <div className="fcn-mid">
          <section className="cfn-card fca-why" aria-label="Чому прибуток вийшов меншим">
            <h2>{reasons.length ? 'Чому прибуток вийшов меншим' : 'Прибуток не менший за план'}</h2>
            {reasons.map(x => (
              <div key={x.k} className="fca-reason"><div><span>{REASON[x.k]}</span><b>{sg(x.v)} ₴</b></div>
                <span className="fca-track"><i style={{ width: `${(-x.v / rMax) * 100}%` }} /></span></div>
            ))}
          </section>
          <section className="cfn-card fca-legend" aria-label="Як читати оцінку">
            <h2>Як читати оцінку</h2>
            <p><span className="fca-g is-ok">95–105%</span>Прогноз точний</p>
            <p><span className="fca-g is-fair">85–95%</span>Допустиме відхилення</p>
            <p><span className="fca-g is-bad">&lt; 85%</span>Прогноз не справдився: розберіть причину</p>
            <small className="rpt-muted">Точність = фактичний прибуток ÷ запланований. План — зі знімка в момент позначки «в прогноз»; пізніші правки замовлення його не змінюють.</small>
          </section>
        </div>

        <section className="rpt-card is-flush">
          <div className="cfn-report-head"><h2 className="rpt-h3">Закриті замовлення: план проти факту</h2><span className="rpt-muted rpt-note">натисніть рядок, щоб побачити розбір</span></div>
          <div className="tbl-wrap rpt-table fca-table"><table>
            <thead><tr><th>Замовлення</th><th className="r">Виручка · план → факт</th><th className="r">Витрати · план → факт</th><th className="r">Прибуток · план → факт</th><th className="r">Оплата</th><th className="r">Точність</th></tr></thead>
            <tbody>
              {data.rows.map(r => {
                const pe = r.plan.revenue - r.planProfit, fe = r.fact.revenue - r.factProfit
                const isOpen = !!open[r.id]
                return (
                  <Fragment key={r.id}>
                    <tr className="is-click" onClick={() => setOpen(s => ({ ...s, [r.id]: !s[r.id] }))} aria-expanded={isOpen}>
                      <td className="c-name"><Link to={`/orders/${r.id}`} className="fcn-num" onClick={e => e.stopPropagation()}>№{r.number}</Link><small className="rpt-muted">{r.client}{r.late ? ' · знімок зроблено пізніше' : ''}</small></td>
                      <td className="r rpt-num"><span className="rpt-muted">{n0(r.plan.revenue)} →</span> <b className={r.fact.revenue < r.plan.revenue - 0.5 ? 'rpt-late' : ''}>{n0(r.fact.revenue)}</b></td>
                      <td className="r rpt-num"><span className="rpt-muted">{n0(pe)} →</span> <b className={fe > pe + 0.5 ? 'rpt-late' : ''}>{n0(fe)}</b></td>
                      <td className="r rpt-num c-net"><span className="rpt-muted">{n0(r.planProfit)} →</span> <b>{n0(r.factProfit)}</b><small className={r.factProfit - r.planProfit < 0 ? 'rpt-late' : 'fcn-in'}>{sg(r.factProfit - r.planProfit)} ₴</small></td>
                      <td className="r">{r.noFact ? <span className="rpt-muted">немає відвантаження</span> : r.delay == null ? <span className="rpt-muted">не оплачено</span> : r.delay > 0 ? <span className="rpt-late">+{r.delay} дн.</span> : <span className="fcn-in">вчасно</span>}</td>
                      <td className="r"><span className={`fca-g ${tone(r.grade)}`}>{pc(r.accuracy)}</span></td>
                    </tr>
                    {isOpen && (
                      <tr className="rpt-sub"><td colSpan={6}>
                        <div className="fca-detail">
                          <div><h3>Розбір по статтях</h3>
                            <table className="fca-items"><thead><tr><th /><th className="r">План</th><th className="r">Факт</th><th className="r">Вплив</th></tr></thead>
                              <tbody>{KEYS.filter(k => r.plan[k] || r.fact[k]).map(k => (
                                <tr key={k}><td>{LABELS[k]}</td><td className="r rpt-num rpt-muted">{n0(r.plan[k])}</td><td className="r rpt-num"><b>{n0(r.fact[k])}</b></td><td className={`r rpt-num ${r.dev[k] < -0.5 ? 'rpt-late' : r.dev[k] > 0.5 ? 'fcn-in' : 'rpt-muted'}`}>{Math.abs(r.dev[k]) < 0.5 ? '0' : sg(r.dev[k])}</td></tr>
                              ))}
                                <tr className="is-tot"><td>Прибуток</td><td className="r rpt-num">{n0(r.planProfit)}</td><td className="r rpt-num"><b>{n0(r.factProfit)}</b></td><td className={`r rpt-num ${r.factProfit < r.planProfit ? 'rpt-late' : 'fcn-in'}`}>{sg(r.factProfit - r.planProfit)}</td></tr></tbody></table></div>
                          <div><h3>Оплата клієнта</h3>
                            <div className="fca-pay"><span>план {dm(r.planPay)}</span><i className={r.delay > 0 ? 'is-late' : ''} /><span className={r.delay > 0 ? 'is-late' : ''}>факт {r.factPay ? dm(r.factPay) : '—'}</span></div>
                            {(() => { const worst = KEYS.map(k => [k, r.dev[k]]).sort((a, b) => a[1] - b[1])[0]; return worst && worst[1] < -0.5
                              ? <p className="fca-concl"><b>Висновок:</b> найбільше прибуток зменшила стаття «{LABELS[worst[0]]}»: у прогнозі {n0(r.plan[worst[0]])} ₴, фактично {n0(r.fact[worst[0]])} ₴ ({sg(worst[1])} ₴).</p>
                              : <p className="fca-concl"><b>Висновок:</b> жодна стаття не погіршила прибуток проти плану.</p> })()}
                            <p className="rpt-muted rpt-note">Знімок від {dm(r.snap.taken_at?.slice(0, 10))}.{r.snap.taken_at?.slice(0, 4)}{r.late ? ' (зроблено пізніше, ніж замовлення потрапило в прогноз)' : ''}. <Link to={`/orders/${r.id}`}>Відкрити замовлення →</Link></p>
                          </div>
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

// Зведений баланс групи — новий інтерфейс (ТЗ редизайну 5.2; макет Investor). Розрахунок — той самий
// computeConsolidated + forecastNetByDate, що й у старому вигляді; тут лише показ.
// «Операції всередині групи» вимкнено → eliminateIntragroup (lib/group): прибирає дебіторку/кредиторку між нашими
// компаніями з обох боків; капітал групи не змінюється, якщо обидві сторони обліковані однаково (інакше — плашка).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { eliminateIntragroup } from '../lib/group'
import { formatAmount } from '../utils/format'
import { Button, Switch, TableSkeleton, Callout } from './ui'
import '../pages/Reports.css'
import '../pages/AnalyticsNew.css'
import './ConsolidatedNew.css'

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const n0 = (v) => formatAmount(v, { decimals: 0 })
const pct = (f) => `${(Math.abs(f) * 100).toFixed(1).replace('.', ',')}%`
const ENT = ['var(--brand)', 'var(--info-fg)', 'var(--group-fg)', 'var(--warn-mark)', 'var(--expense-chart)']

export default function ConsolidatedNew({ data, forecast, loading, err, year, month, setYear, setMonth, years, onPdf }) {
  const [showGroup, setShowGroup] = useState(true)
  const [showFc, setShowFc] = useState(true)
  const [hl, setHl] = useState(null)
  const view = useMemo(() => {
    if (!data) return null
    if (showGroup) return { rows: data.rows, total: data.total, mismatch: 0 }
    return eliminateIntragroup(data.rows, data.ig || {})
  }, [data, showGroup])
  const asOf = `${String(new Date(year, month, 0).getDate()).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`
  const igTotal = data ? Object.values(data.ig || {}).reduce((a, x) => a + x.recv + x.pay, 0) : 0

  const head = (
    <div className="rpt-bar">
      <select className="form-input rpt-sel" aria-label="Місяць" value={month} onChange={e => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
      <select className="form-input rpt-sel is-year" aria-label="Рік" value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
      <Switch checked={showGroup} onChange={setShowGroup} label="Операції всередині групи" />
      <Button variant="secondary" icon="ti-download" onClick={onPdf} disabled={!data}>PDF</Button>
    </div>
  )
  if (err) return <div className="rpt">{head}<Callout tone="danger" title="Не вдалося порахувати зведений баланс." text={err} /></div>
  if (!view) return <div className="rpt">{head}{(loading || !err) && <TableSkeleton rows={10} cols={5} label="Рахую по всіх юрособах…" />}</div>

  const { rows, total: t } = view
  const liab = t.pay + t.loans
  const loansIn = (r) => Math.max(0, r.loans), loansOut = (r) => Math.max(0, -r.loans)
  // прогноз (та сама логіка, що в старому вигляді)
  const net = forecast?.net || 0, rc = forecast?.receivableCollect || 0, pp = forecast?.payablePay || 0
  const income = forecast?.income || 0, expense = forecast?.expense || 0
  const fc = { cash: t.cash + net, stock: t.stock, recv: t.recv - rc, fa: t.fa, assets: t.assets + net - rc, pay: t.pay - pp, loans: t.loans, equity: t.equity + net - rc + pp }
  const dEq = fc.equity - t.equity
  const other = t.equity - t.fa - t.cash

  const cols = rows.length + 1 + (showFc ? 2 : 0) + 1
  const line = (label, get, opts = {}) => {
    const tv = get(t), fv = opts.fc ? opts.fc() : null
    return (
      <tr className={opts.cls || ''}>
        <th scope="row">{label}{opts.sub && <small>{opts.sub}</small>}</th>
        {rows.map((r, i) => { const v = get(r); return <td key={r.id} className={`${hl === i ? 'is-hl' : ''}${v < 0 ? ' is-neg' : ''}${!v ? ' is-zero' : ''}`}>{n0(v)}</td> })}
        <td className={`csn-grp${tv < 0 ? ' is-neg' : ''}`}>{n0(tv)}</td>
        {showFc && <><td className="csn-move">{opts.move ?? '—'}</td><td className={`csn-fc${fv < 0 ? ' is-neg' : ''}`}>{fv == null ? '' : n0(fv)}</td></>}
      </tr>
    )
  }
  const mv = (v) => !Math.round(v) ? '0' : <span className={v < 0 ? 'is-neg' : 'is-pos'}>{formatAmount(v, { decimals: 0, sign: 'always' })}</span>

  return (
    <div className="rpt csn">
      {head}
      <section className="csn-hero" aria-label="Рівняння балансу групи">
        <div className="csn-hero-top"><span>Консолідовано · станом на {asOf}{forecast ? ' · з прогнозом' : ''}{!showGroup ? ' · без операцій усередині групи' : ''}</span><span>{rows.map(r => r.name).join(' · ')}</span></div>
        <div className="csn-eq">
          <div><span>Активи</span><b>{n0(t.assets)} ₴</b></div><i aria-hidden="true">−</i>
          <div><span>Зобов'язання</span><b className="is-out">{n0(liab)} ₴</b></div><i aria-hidden="true">=</i>
          <div className="is-eq"><span>Власний капітал групи</span><b className={t.equity < 0 ? 'is-neg' : ''}>{n0(t.equity)} ₴</b></div>
        </div>
        {t.assets > 0 && <>
          <div className="csn-scale" aria-hidden="true"><span className="is-liab" style={{ flexGrow: Math.max(0, liab) }} /><span className="is-eq" style={{ flexGrow: Math.max(0, t.equity) }} /></div>
          <div className="csn-scale-l"><span>Зобов'язання · {pct(liab / t.assets)} активів</span><span>{t.equity < 0 ? `Капітал від'ємний · −${pct(t.equity / t.assets)} активів` : `Капітал · ${pct(t.equity / t.assets)} активів`}</span></div>
        </>}
      </section>

      <div className="rpt-kpis csn-kpis">
        <div className="cfn-card csn-kpi"><span>Боргове навантаження</span><b className={liab / (t.assets || 1) > 0.5 ? 'is-warn' : 'is-pos'}>{t.assets ? pct(liab / t.assets) : '—'}</b><small>зобов'язання / активи</small></div>
        <div className="cfn-card csn-kpi"><span>Гроші покривають борги</span><b>{liab > 0 ? `${Math.round((t.cash / liab) * 100)}%` : '—'}</b><small>{n0(t.cash)} ₴ на {n0(liab)} ₴</small></div>
        <div className="cfn-card csn-kpi"><span>Дебіторка групи</span><b className="is-warn">{n0(t.recv)} ₴</b><small>{t.assets ? `${Math.round((t.recv / t.assets) * 100)}% активів — чекає оплати` : ''}</small></div>
        <div className="cfn-card csn-kpi"><span>Прогноз на {asOf.slice(0, 5)}</span><b className={dEq < 0 ? 'is-neg' : ''}>{!forecast ? '—' : Math.abs(dEq) < 1 ? 'без змін' : `${formatAmount(dEq, { decimals: 0, sign: 'always' })} ₴`}</b><small><Link to="/forecast">угоди в роботі →</Link></small></div>
      </div>

      <div className="csn-mid">
        <section className="cfn-card csn-ent" aria-label="Хто формує капітал групи">
          <div className="pln-months-head"><h2>Хто формує капітал групи</h2><span className="rpt-muted rpt-note">натисніть — підсвітимо колонку в таблиці</span></div>
          <div className="csn-ent-bar" aria-hidden="true">{rows.map((r, i) => <span key={r.id} style={{ flexGrow: Math.max(0, r.equity), background: ENT[i % ENT.length] }} />)}</div>
          <div className="csn-ent-cards">
            {rows.map((r, i) => (
              <button key={r.id} type="button" className="csn-ent-card" aria-pressed={hl === i} onClick={() => setHl(h => h === i ? null : i)}>
                <span className="csn-ent-n"><i style={{ background: ENT[i % ENT.length] }} />{r.name}</span>
                <b className={r.equity < 0 ? 'is-neg' : ''}>{n0(r.equity)} ₴</b>
                <small>{t.equity ? `${pct(r.equity / t.equity)} капіталу` : ''} · активи {n0(r.assets)}</small>
                {r.error && <small className="rpt-late">помилка розрахунку: {r.error}</small>}
              </button>
            ))}
          </div>
        </section>
        <section className="cfn-card csn-back" aria-label="Чим забезпечений капітал">
          <h2>Чим забезпечений капітал</h2>
          {[['Основні засоби', t.fa, 'var(--brand)'], ['Гроші', t.cash, 'var(--info-fg)'], ['Інші чисті активи', other, 'var(--muted-2)']].map(([l, v, c]) => (
            <div key={l} className="csn-back-row">
              <div><span>{l}</span><b>{n0(v)}{t.equity ? <small> · {pct(v / t.equity)}</small> : null}</b></div>
              <span className="csn-back-track"><i style={{ width: `${t.equity > 0 ? Math.max(0, Math.min(100, (v / t.equity) * 100)) : 0}%`, background: c }} /></span>
            </div>
          ))}
          <small className="rpt-muted">інші чисті активи = склад + дебіторка − зобов'язання</small>
        </section>
      </div>

      <section className="rpt-card is-flush">
        <div className="cfn-report-head">
          <div><h2 className="rpt-h3">Зведений баланс по юрособах</h2><span className="rpt-muted rpt-note">факт на {asOf}{showFc ? ' → прогноз на кінець місяця' : ''}</span></div>
          <Switch checked={showFc} onChange={setShowFc} label="Показати прогноз" />
        </div>
        <div className="cfn-tbl csn-tbl"><table>
          <thead><tr><th scope="col">Стаття</th>{rows.map((r, i) => <th key={r.id} scope="col" className={hl === i ? 'is-hl' : ''}><i style={{ background: ENT[i % ENT.length] }} />{r.name}</th>)}<th scope="col" className="csn-grp">Група · факт</th>{showFc && <><th scope="col">Рух</th><th scope="col" className="csn-fc">Прогноз</th></>}</tr></thead>
          <tbody>
            <tr className="csn-sec"><th colSpan={cols}>Активи</th></tr>
            {line('Гроші', r => r.cash, { fc: () => fc.cash, move: forecast ? <span className="csn-io"><span className="is-pos">+{n0(income)}</span><span className="is-neg">−{n0(expense)}</span></span> : '—' })}
            {line('Склад', r => r.stock, { fc: () => fc.stock })}
            {line('Дебіторка', r => r.recv, { fc: () => fc.recv, move: rc ? mv(-rc) : '—' })}
            {line('Основні засоби', r => r.fa, { fc: () => fc.fa })}
            {line('Активи разом', r => r.assets, { cls: 'csn-tot', fc: () => fc.assets, move: mv(net - rc) })}
            <tr className="csn-sec"><th colSpan={cols}>Зобов'язання</th></tr>
            {line('Кредиторка', r => -r.pay, { fc: () => -fc.pay, move: pp ? mv(pp) : '—' })}
            {line('Позики отримані (ми винні)', r => -loansIn(r), { sub: 'поворотна фін. допомога', fc: () => -rows.reduce((a, r) => a + loansIn(r), 0) })}
            {line('Позики видані (нам винні)', r => loansOut(r), { sub: 'зменшують зобов\'язання групи', fc: () => rows.reduce((a, r) => a + loansOut(r), 0) })}
            {line('Зобов\'язання разом', r => -(r.pay + r.loans), { cls: 'csn-tot', fc: () => -(fc.pay + fc.loans), move: pp ? mv(pp) : '—' })}
            <tr className="csn-sec"><th colSpan={cols}>Власний капітал</th></tr>
            {line('Власний капітал', r => r.equity, { cls: 'csn-eqrow', fc: () => fc.equity, move: mv(dEq) })}
            <tr className="csn-share"><th scope="row">Частка в капіталі групи</th>{rows.map((r, i) => <td key={r.id} className={hl === i ? 'is-hl' : ''}>{t.equity ? pct(r.equity / t.equity) : '—'}</td>)}<td className="csn-grp">100%</td>{showFc && <><td /><td className="csn-fc" /></>}</tr>
          </tbody>
        </table></div>
        <div className="csn-note">
          {showGroup
            ? igTotal > 0 && <Callout tone="info" title="Внутрішньогрупові розрахунки." text={`Між нашими компаніями є борги на ${n0(igTotal)} ₴ (дебіторка й кредиторка разом) — вони роздувають активи й зобов'язання групи. Вимкніть «Операції всередині групи» вгорі: борги приберуться з обох боків, капітал групи не зміниться. Позики між компаніями лишаються як є.`} />
            : Math.abs(view.mismatch) >= 1
              ? <Callout tone="warn" title="Сторони обліковані по-різному." text={`Після виключення капітал групи змінився на ${formatAmount(-view.mismatch, { decimals: 0, sign: 'always' })} ₴: борг однієї нашої компанії перед іншою не збігається з дзеркальним документом в іншої. Перевірте видаткові / прихідні між компаніями групи.`} />
              : <Callout tone="info" title="Операції всередині групи виключено." text="Дебіторку й кредиторку між нашими компаніями прибрано з обох боків; капітал групи не змінився — сторони обліковані однаково." />}
        </div>
      </section>
    </div>
  )
}

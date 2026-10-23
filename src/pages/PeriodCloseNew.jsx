// «Закриття періоду» — новий інтерфейс (ТЗ редизайну 5.5; макети PeriodClose / PeriodCloseMobile).
// Логіка, перевірки й звіти — ті самі (runChecklist, computeCompleteness, CashFlowView / PLView / BalanceView, товари);
// тут лише каркас. Переоткриття — лише адміністратор, з причиною (міграція 100 перевіряє на сервері й пише журнал).
import { useEffect, useState } from 'react'
import { Button, Modal, Segmented, TableSkeleton, Callout } from '../components/ui'
import { listCloseLog } from '../lib/periodClose'
import { computeCashFlow } from '../lib/cashflow'
import { formatAmount, plural } from '../utils/format'
import './Reports.css'
import './PeriodCloseNew.css'

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const MS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const ST = { open: ['Відкритий', ''], closed: ['Закритий', 'is-closed'], reopened: ['Переоткритий', 'is-reopened'], future: ['Майбутній', 'is-future'] }
const dmyt = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 16)}` : '—'

export default function PeriodCloseNew({ year, setYear, sel, openMonth, statusOf, rowFor, check, comp, busy, err, isAdmin, onClose, onReopen,
  renderChecklist, renderCompleteness, renderReport }) {
  const now = new Date()
  const [rep, setRep] = useState('cashflow')
  const [ask, setAsk] = useState(false)
  const [reason, setReason] = useState('')
  const [log, setLog] = useState([])
  const isFuture = (m) => year > now.getFullYear() || (year === now.getFullYear() && m > now.getMonth() + 1)
  const reopenedList = MONTHS.map((_, i) => i + 1).filter(m => statusOf(m) === 'reopened')
  const st = sel ? statusOf(sel) : null
  const isClosed = st === 'closed'
  const row = sel ? rowFor(sel) : null
  useEffect(() => { if (sel) listCloseLog(year, sel).then(setLog); else setLog([]) }, [sel, year, st])
  // без вибору — одразу відкриваємо найпізніший минулий місяць, який ще не закрито (макет PeriodClose)
  useEffect(() => {
    if (sel) return
    const cand = MONTHS.map((_, i) => i + 1).filter(m => !isFuture(m) && statusOf(m) !== 'closed').pop()
    if (cand) openMonth(cand)
  }, [year, sel, statusOf])   // statusOf оновлюється після завантаження закриттів — тоді й обираємо

  const checks = check ? [
    ['Мінусові залишки складу', check.negativeStock.length],
    ['Документи без суми', check.docsNoAmount.length],
    ['Неперевірені документи', check.unverifiedDocs || 0],
    ['Некласифіковані транзакції', check.unclassifiedTx],
    ['Накладні без руху складу', (check.unpostedStock || []).length, true],
  ] : []
  const presold = check?.presoldStock || []
  const passed = checks.filter(c => !c[1]).length
  const ready = check && check.blockers === 0
  const R = 30, C = 2 * Math.PI * R

  return (
    <div className="rpt-page pcn">
      <div className="pcn-head">
        <div><h1 className="rpt-h1">Закриття періоду</h1><p className="rpt-sub">Закритий місяць не можна змінити — ні в інтерфейсі, ні прямим запитом. Переоткриває лише адміністратор, з причиною.</p></div>
        <div className="pcn-year"><Button variant="secondary" iconOnly icon="ti-chevron-left" aria-label="Попередній рік" onClick={() => setYear(year - 1)} /><b>{year}</b><Button variant="secondary" iconOnly icon="ti-chevron-right" aria-label="Наступний рік" onClick={() => setYear(year + 1)} /></div>
      </div>

      <div className="pcn-strip" role="list">
        {MONTHS.map((n, i) => {
          const m = i + 1, fut = isFuture(m), s = fut ? 'future' : statusOf(m)
          return (
            <button key={m} type="button" role="listitem" className={`pcn-m ${ST[s][1]}`} aria-pressed={sel === m} disabled={fut} onClick={() => openMonth(m)}>
              <b>{MS[i]}</b><i className="pcn-m-bar" aria-hidden="true" /><span>{s === 'closed' ? <i className="ti ti-lock" aria-hidden="true" /> : s === 'reopened' ? <i className="ti ti-lock-open" aria-hidden="true" /> : null}{ST[s][0]}</span>
            </button>
          )
        })}
      </div>
      <ul className="pcn-legend" aria-label="Позначення"><li><i className="is-closed" />Закритий</li><li><i className="is-reopened" />Переоткритий: був закритий, зараз можна змінювати</li><li><i />Відкритий</li></ul>
      {reopenedList.length > 0 && <Callout tone="warn" title={`Переоткриті місяці: ${reopenedList.map(m => MONTHS[m - 1].toLowerCase()).join(', ')}.`} text="Їхні дані знову можна змінювати — закрийте їх повторно після виправлень." />}
      {err && <Callout tone="danger" title="Помилка." text={err} />}

      {!sel ? <div className="cfn-card pcn-empty">Оберіть місяць угорі.</div> : <>
        <section className={`pcn-hero ${isClosed ? 'is-closed' : ready ? 'is-ready' : ''}`} aria-label="Стан місяця">
          {isClosed ? <>
            <i className="ti ti-lock pcn-lock" aria-hidden="true" />
            <div className="pcn-hero-t"><span>{MONTHS[sel - 1]} {year}</span><b>Місяць закрито</b>
              <small>{row?.closed_at ? `Закрито ${row.closed_at.slice(0, 10).split('-').reverse().join('.')}` : ''}{row?.reopened_at ? ` · переоткривався ${row.reopened_at.slice(0, 10).split('-').reverse().join('.')}${row.reopen_reason ? ` («${row.reopen_reason}»)` : ''}` : ''}</small></div>
            {isAdmin && <Button variant="secondary" icon="ti-lock-open" onClick={() => { setReason(''); setAsk(true) }}>Переоткрити</Button>}
          </> : <>
            <svg className="pcn-ring" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r={R} className="pcn-ring-bg" /><circle cx="36" cy="36" r={R} className="pcn-ring-fg" strokeDasharray={`${(passed / 5) * C} ${C}`} transform="rotate(-90 36 36)" /><text x="36" y="41" textAnchor="middle">{check ? `${passed}/5` : '…'}</text></svg>
            <div className="pcn-hero-t"><span>{MONTHS[sel - 1]} {year} · {check ? `${passed} з 5 перевірок пройдено` : 'перевіряю…'}</span>
              <b>{!check ? 'Перевіряю готовність…' : ready ? 'Готовий до закриття' : 'Ще не можна закрити'}</b>
              <small>{!check ? '' : ready ? 'Блокерів немає. Перегляньте звіти місяця й закривайте.' : `Блокерів: ${check.blockers}. Виправте їх у кроці 1.`}</small></div>
            <Button variant="primary" icon="ti-lock" disabled={!ready || busy === 'close'} loading={busy === 'close'} onClick={onClose}>Закрити місяць</Button>
          </>}
        </section>

        {!isClosed && <>
          <div className="pcn-row1">
          <section className="cfn-card pcn-step" aria-label="Крок 1">
            <div className="pcn-step-h"><span className="pcn-n">1</span><div><h2>Перевірки</h2><small className="rpt-muted">Натисніть рядок — відкриються конкретні записи, які треба виправити.</small></div></div>
            {check ? <>
              <ul className="pcn-checks">{checks.map(([l, n, warn]) => <li key={l} className={n ? (warn ? 'is-warn' : 'is-bad') : 'is-ok'}><span className="pcn-ci" aria-hidden="true">{n ? '!' : <i className="ti ti-check" />}</span><span className="pcn-cl">{l}</span><b className="pcn-badge">{n ? `${n}${warn ? ' · не блокує' : ''}` : 'усе гаразд'}</b></li>)}
                {presold.length > 0 && <li className="is-warn"><span className="pcn-ci" aria-hidden="true"><i className="ti ti-info-small" /></span><span className="pcn-cl">Продано під замовлення — мінус покрито пізнішим приходом</span><b className="pcn-badge">{presold.length} · не блокує</b></li>}</ul>
              <details className="pcn-details"><summary>Розкрити записи</summary>{renderChecklist()}</details>
            </> : <TableSkeleton rows={4} cols={2} label="Перевіряю…" />}
          </section>
          <section className="cfn-card pcn-after" aria-label="Що станеться після закриття">
            <h2>Що станеться після закриття</h2>
            <ul>
              <li><span className="pcn-ai is-lock"><i className="ti ti-lock" aria-hidden="true" /></span>Транзакції, документи й склад за {MONTHS[sel - 1].toLowerCase()} не можна буде змінити — ні в інтерфейсі, ні прямим запитом.</li>
              <li><span className="pcn-ai is-chart"><i className="ti ti-chart-bar" aria-hidden="true" /></span>Баланс і P&L за місяць фіксуються — саме ці цифри бачить інвестор.</li>
              <li><span className="pcn-ai is-warn"><i className="ti ti-lock-open" aria-hidden="true" /></span>Переоткрити місяць може лише адміністратор, із причиною; система запише, хто і чому.</li>
            </ul>
          </section>
          </div>
          <section className="cfn-card pcn-step" aria-label="Крок 2">
            <div className="pcn-step-h"><span className="pcn-n">2</span><div><h2>Чи всі гроші потрапили у звіти</h2><small className="rpt-muted">Рухи місяця: у P&L · ПФД і перекази · без статті · ігноровані.</small></div></div>
            {comp ? <>
              {comp.active?.sum > 0 && (() => {
                const tiles = [
                  ['inpl', 'Увійшло в P&L', comp.inPL, `${comp.inPL.n} ${plural(comp.inPL.n, ['транзакція', 'транзакції', 'транзакцій'])}`],
                  ['fin', 'Поза P&L свідомо: ПФД, ОЗ, перекази', comp.otherFin, `${comp.otherFin.n} тр. · враховані в Cash Flow і Балансі — це нормально`],
                  ['bad', 'Випали з P&L: без статті або не валідовані', { n: comp.noArticle.n + comp.unvalidated.n, sum: comp.noArticle.sum + comp.unvalidated.sum }, comp.noArticle.n + comp.unvalidated.n ? 'призначте статтю й підтвердьте — нижче' : 'нічого не випало'],
                  ['ign', 'Ігноровані', comp.ignored, comp.ignored.n ? 'приховані з усіх звітів — перевірте нижче' : 'нічого не приховано зі звітів'],
                ]
                const total = tiles.reduce((a, t) => a + t[2].sum, 0) || 1
                return <>
                  <div className="pcn-prop" aria-hidden="true">{tiles.map(t => t[2].sum > 0 && <span key={t[0]} className={`is-${t[0]}`} style={{ flexGrow: t[2].sum / total }} />)}</div>
                  <div className="pcn-tiles">{tiles.map(t => (
                    <div key={t[0]} className={`pcn-tile is-${t[0]}${t[0] === 'bad' && !t[2].n ? ' is-zero' : ''}`}>
                      <span>{t[1]}</span><b>{t[0] === 'ign' ? `${formatAmount(t[2].sum, { decimals: 0 })} ₴ · ${t[2].n}` : `${formatAmount(t[2].sum, { decimals: 0 })} ₴`}</b><small>{t[3]}</small>
                    </div>))}</div>
                </>
              })()}
              <details className="pcn-details"><summary>Розкрити записи</summary>{renderCompleteness()}</details>
            </> : <TableSkeleton rows={3} cols={2} label="Рахую…" />}
          </section>
        </>}

        <section className="cfn-card pcn-step" aria-label="Крок 3">
          <div className="pcn-step-h"><span className="pcn-n">{isClosed ? <i className="ti ti-file-analytics" aria-hidden="true" /> : 3}</span><div><h2>Звіти місяця</h2><small className="rpt-muted">{isClosed ? 'Цифри закритого місяця.' : 'Кожну цифру можна розкрити до операцій і виправити.'}</small></div></div>
          <div className="pcn-r3">
            <CashMini year={year} month={sel} onOpen={() => { setRep('cashflow'); document.getElementById('pcn-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />
            <section className="pcn-other" aria-label="Інші звіти за місяць">
              <h3>Інші звіти за {MONTHS[sel - 1].toLowerCase()}</h3>
              {[['pl', 'P&L', 'прибутки та збитки · нарахування і касовий'], ['balance', 'Управлінський баланс', `стан на кінець місяця`], ['goods', 'Товари', 'куплено → продано → лишилось']].map(([k, t, d]) => (
                <button key={k} type="button" aria-pressed={rep === k} onClick={() => { setRep(k); document.getElementById('pcn-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
                  <span><b>{t}</b><small>{d}</small></span><i className="ti ti-arrow-right" aria-hidden="true" /></button>))}
            </section>
          </div>
          <Segmented ariaLabel="Звіт" value={rep} onChange={setRep} options={[{ value: 'cashflow', label: 'Cash Flow' }, { value: 'pl', label: 'P&L' }, { value: 'balance', label: 'Баланс' }, { value: 'goods', label: 'Товари' }]} />
          <div className="pcn-report" id="pcn-report">{renderReport(rep)}</div>
        </section>

        {log.length > 0 && (
          <section className="cfn-card pcn-step" aria-label="Журнал">
            <h2>Журнал місяця</h2>
            <ul className="pcn-log">{log.map((x, i) => <li key={i}><i className={`ti ${x.action === 'close' ? 'ti-lock' : 'ti-lock-open'}`} aria-hidden="true" /><b>{x.action === 'close' ? 'Закрито' : 'Переоткрито'}</b><span>{dmyt(x.at)} · {x.who}</span>{x.reason && <em>{x.reason}</em>}</li>)}</ul>
          </section>
        )}

        {!isClosed && (
          <div className="pcn-sticky">
            <span>{!check ? 'Перевіряю…' : ready ? <><i className="ti ti-circle-check" aria-hidden="true" /> Готовий до закриття</> : <><i className="ti ti-alert-circle" aria-hidden="true" /> Блокерів: {check.blockers}</>}</span>
            <Button variant="primary" icon="ti-lock" disabled={!ready || busy === 'close'} loading={busy === 'close'} onClick={onClose}>Закрити {MONTHS[sel - 1].toLowerCase()}</Button>
          </div>
        )}
      </>}

      <Modal open={ask} title={`Переоткрити ${sel ? MONTHS[sel - 1].toLowerCase() : ''} ${year}?`} onClose={() => setAsk(false)}
        footer={<><Button variant="secondary" onClick={() => setAsk(false)}>Скасувати</Button><Button variant="danger" icon="ti-lock-open" disabled={!reason.trim() || busy === 'reopen'} loading={busy === 'reopen'} onClick={async () => { await onReopen(reason.trim()); setAsk(false) }}>Переоткрити</Button></>}>
        <p className="rpt-muted">Блокування знімається: дані місяця знову можна змінювати. Причина потрапить у журнал.</p>
        <div className="form-group"><label htmlFor="pcn-reason">Причина *</label><textarea id="pcn-reason" className="form-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Напр. забули провести прихідну від постачальника" /></div>
      </Modal>
    </div>
  )
}

// Cash Flow місяця: залишок по днях (макет PeriodClose, крок 3) — той самий computeCashFlow, що й звіт нижче
function CashMini({ year, month, onOpen }) {
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); computeCashFlow(year, month).then(setD).catch(() => setD(false)) }, [year, month])
  if (d === false) return null
  if (!d) return <section className="cfn-card pcn-cash"><TableSkeleton rows={3} cols={2} label="Рахую Cash Flow…" /></section>
  const pts = [d.openingCash, ...d.cols.map(c => d.closingByCol[c.key])]
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1
  const xy = pts.map((v, i) => [(i / Math.max(1, pts.length - 1)) * 100, 92 - ((v - lo) / span) * 80])
  const peak = pts.indexOf(hi)
  const n0 = (v) => formatAmount(v, { decimals: 0 })
  return (
    <section className="cfn-card pcn-cash" aria-label="Cash Flow: залишок по днях">
      <div className="pcn-cash-h"><h3>Cash Flow · залишок по днях</h3><button type="button" className="rpt-link" onClick={onOpen}>Відкрити повністю →</button></div>
      <dl className="pcn-cash-k">
        <div><dt>На початок</dt><dd>{n0(d.openingCash)}</dd></div>
        <div><dt>Надходження</dt><dd className="is-in">{formatAmount(d.inflow?.total || 0, { decimals: 0, sign: 'always' })}</dd></div>
        <div><dt>Витрати</dt><dd className="is-out">{formatAmount(-(Math.abs(d.outflow?.total || 0)), { decimals: 0, sign: 'always' })}</dd></div>
        <div><dt>На кінець</dt><dd className={d.closingCash < 0 ? 'is-out' : ''}>{n0(d.closingCash)}</dd></div>
      </dl>
      <svg className="pcn-cash-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Залишок від ${n0(d.openingCash)} до ${n0(d.closingCash)}, найвищий ${n0(hi)}`}>
        <polygon points={`0,100 ${xy.map(p => p.join(',')).join(' ')} 100,100`} className="pcn-cash-area" />
        <polyline points={xy.map(p => p.join(',')).join(' ')} className="pcn-cash-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="pcn-cash-x"><span>1.{String(month).padStart(2, '0')}</span><span>макс. {n0(hi)}{peak > 0 ? ` · ${d.cols[peak - 1]?.label || ''}.${String(month).padStart(2, '0')}` : ''}</span><span>{d.cols.length}.{String(month).padStart(2, '0')}</span></div>
    </section>
  )
}

// «Закриття періоду» — новий інтерфейс (ТЗ редизайну 5.5; макети PeriodClose / PeriodCloseMobile).
// Логіка, перевірки й звіти — ті самі (runChecklist, computeCompleteness, CashFlowView / PLView / BalanceView, товари);
// тут лише каркас. Переоткриття — лише адміністратор, з причиною (міграція 100 перевіряє на сервері й пише журнал).
import { useEffect, useState } from 'react'
import { Button, Modal, Segmented, TableSkeleton, Callout } from '../components/ui'
import { listCloseLog } from '../lib/periodClose'
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

  const checks = check ? [
    ['Мінусові залишки складу', check.negativeStock.length],
    ['Документи без суми', check.docsNoAmount.length],
    ['Неперевірені документи', check.unverifiedDocs || 0],
    ['Некласифіковані транзакції', check.unclassifiedTx],
    ['Накладні без руху складу', (check.unpostedStock || []).length, true],
  ] : []
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
              <b>{MS[i]}</b><span>{s === 'closed' ? <i className="ti ti-lock" aria-hidden="true" /> : s === 'reopened' ? <i className="ti ti-lock-open" aria-hidden="true" /> : null}{ST[s][0]}</span>
            </button>
          )
        })}
      </div>
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
          <section className="cfn-card pcn-step" aria-label="Крок 1">
            <div className="pcn-step-h"><span className="pcn-n">1</span><div><h2>Перевірки</h2><small className="rpt-muted">Натисніть рядок — відкриються конкретні записи, які треба виправити.</small></div></div>
            {check ? <>
              <ul className="pcn-checks">{checks.map(([l, n, warn]) => <li key={l} className={n ? (warn ? 'is-warn' : 'is-bad') : 'is-ok'}><i className={`ti ${n ? 'ti-alert-circle' : 'ti-circle-check'}`} aria-hidden="true" />{l}<b>{n ? `${n}${warn ? ' · не блокує' : ''}` : 'усе гаразд'}</b></li>)}</ul>
              <details className="pcn-details"><summary>Розкрити записи</summary>{renderChecklist()}</details>
            </> : <TableSkeleton rows={4} cols={2} label="Перевіряю…" />}
          </section>
          <section className="cfn-card pcn-step" aria-label="Крок 2">
            <div className="pcn-step-h"><span className="pcn-n">2</span><div><h2>Чи всі гроші потрапили у звіти</h2><small className="rpt-muted">Рухи місяця: у P&L · ПФД і перекази · без статті · ігноровані.</small></div></div>
            {comp ? renderCompleteness() : <TableSkeleton rows={3} cols={2} label="Рахую…" />}
          </section>
        </>}

        <section className="cfn-card pcn-step" aria-label="Крок 3">
          <div className="pcn-step-h"><span className="pcn-n">{isClosed ? <i className="ti ti-file-analytics" aria-hidden="true" /> : 3}</span><div><h2>Звіти місяця</h2><small className="rpt-muted">{isClosed ? 'Цифри закритого місяця.' : 'Кожну цифру можна розкрити до операцій і виправити.'}</small></div></div>
          <Segmented ariaLabel="Звіт" value={rep} onChange={setRep} options={[{ value: 'cashflow', label: 'Cash Flow' }, { value: 'pl', label: 'P&L' }, { value: 'balance', label: 'Баланс' }, { value: 'goods', label: 'Товари' }]} />
          <div className="pcn-report">{renderReport(rep)}</div>
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

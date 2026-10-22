// Реєстр замовлень у новому інтерфейсі (ТЗ редизайну 4.1; макети Orders / OrdersMobile).
// Дані, фільтри й обробники приходять з Orders.jsx — тут лише подача. Логіка не змінюється.
import { useMemo } from 'react'
import { Segmented, EmptyState, TableSkeleton, Button } from '../components/ui'
import { ORDER_STATUS_TONE } from '../components/ui/statusMaps'
import { formatAmount, formatShort } from '../utils/format'
import { STATUS_ORDER, OUTCOME, statusLabel, labelForStatus } from '../lib/orders'
import { initials } from '../components/AppShell'
import './OrdersNew.css'

const fmtD = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''
// Аватар клієнта: стабільний колір за назвою (лише фон / текст із токенів)
const AV_TONES = ['info', 'group', 'brand', 'warn']
const toneOf = (s) => AV_TONES[[...(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_TONES.length]

// Етап: шкала з 9 сегментів (скільки етапів пройдено) + назва; колір — тон статусу
function Stage({ o }) {
  const done = !!o.archived_at
  const code = OUTCOME[o.outcome] && done ? o.outcome : o.status
  const tone = ORDER_STATUS_TONE[code] || 'neutral'
  const i = STATUS_ORDER.indexOf(o.status)
  const filled = done && o.outcome === 'won' ? STATUS_ORDER.length : i >= 0 ? i + 1 : 1
  const label = OUTCOME[o.outcome] && done ? OUTCOME[o.outcome].label : statusLabel(o)
  return (
    <span className={`on-stage is-${tone}`} title={`Етап ${Math.min(filled, STATUS_ORDER.length)} з ${STATUS_ORDER.length}`}>
      <span className="on-stage-bar" aria-hidden="true">
        {STATUS_ORDER.map((_, k) => <i key={k} className={k < filled ? 'on' : undefined} />)}
      </span>
      {label}
    </span>
  )
}

function Person({ name }) {
  if (!name || name === '—') return <span className="on-person is-none" title="Не призначено"><span className="on-av is-none" aria-hidden="true">?</span><span className="on-trunc">Не призначено</span></span>
  return <span className="on-person" title={name}><span className="on-av" aria-hidden="true">{initials(name)}</span><span className="on-trunc">{name}</span></span>
}

function TaskChip({ o, navigate }) {
  if (!o.tasks) return <span className="on-muted" aria-label="Задач немає">—</span>
  return (
    <button type="button" className={`on-task${o.tasks.late ? ' is-late' : ''}`}
      onClick={e => { e.stopPropagation(); navigate(o.tasks.n === 1 ? `/tasks?task=${o.tasks.first.id}` : `/orders/${o.id}?tab=tasks`) }}
      aria-label={`Невиконаних задач: ${o.tasks.n}${o.tasks.late ? `, прострочено: ${o.tasks.late}` : ''}`}
      title={o.tasks.n === 1 ? `Задача: ${o.tasks.first.title}` : `Невиконаних задач: ${o.tasks.n}`}>
      <i className="ti ti-checkbox" aria-hidden="true" />{o.tasks.n}
    </button>
  )
}

function Flags({ o, toggleInvestor, toggleForecast, toggleCommission }) {
  return (
    <span className="orders-flags" onClick={e => e.stopPropagation()}>
      <button type="button" onClick={() => toggleInvestor(o)} aria-pressed={!!o.in_investor} title={o.in_investor ? 'Інвестор: враховується' : 'Інвестор: додати в розрахунок'} aria-label="Інвестор">
        <i className="ti ti-diamond-filled" aria-hidden="true" style={{ color: o.in_investor ? 'var(--group-fg)' : undefined }} /></button>
      <button type="button" onClick={() => toggleForecast(o)} aria-pressed={!!o.in_forecast} title={o.in_forecast ? 'Прогноз: у прогнозі' : 'Прогноз: додати'} aria-label="Прогноз">
        <i className="ti ti-trending-up" aria-hidden="true" style={{ color: o.in_forecast ? 'var(--info-fg)' : undefined }} /></button>
      <button type="button" onClick={() => toggleCommission(o)} aria-pressed={!!o.commission_paid} title={o.commission_paid ? 'Комісію сплачено' : 'Комісію не сплачено'} aria-label="Комісію сплачено">
        <i className={`ti ${o.commission_paid ? 'ti-square-check-filled' : 'ti-square'}`} aria-hidden="true" style={{ color: o.commission_paid ? 'var(--brand)' : undefined }} /></button>
    </span>
  )
}

export default function OrdersNew({
  orders, rows, loading, q, setQ, filter, setFilter, filters, view, setView, views, manager, setManager, stage, setStage,
  linking, autoLinkPayments, onNew, navigate, flags, sort, onSort, kanban, report,
}) {
  // «у роботі» — не архівні; плитки етапів рахуються з них (незалежно від пошуку)
  const open = useMemo(() => orders.filter(o => !o.archived_at), [orders])
  const openSum = open.reduce((s, o) => s + (Number(o.total) || 0), 0)
  const stages = useMemo(() => STATUS_ORDER.map(s => {
    const list = open.filter(o => o.status === s)
    return { s, n: list.length, sum: list.reduce((a, o) => a + (Number(o.total) || 0), 0) }
  }).filter(x => x.n > 0), [open])
  const managers = useMemo(() => [...new Set(orders.map(o => o.managerName).filter(n => n && n !== '—'))].sort((a, b) => a.localeCompare(b, 'uk')), [orders])
  const total = rows.reduce((s, o) => s + (Number(o.total) || 0), 0)
  const sortBtn = (k, label, align) => (
    <th style={{ textAlign: align }} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="on-sort" onClick={() => onSort(k)}>{label}{sort.key === k && <i className={`ti ${sort.dir === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down'}`} aria-hidden="true" />}</button>
    </th>
  )

  return (
    <div className="on">
      <div className="on-head">
        <div>
          <h1 className="on-h1">Замовлення</h1>
          <p className="on-sub">{open.length} в роботі · {formatAmount(openSum)} ₴ з ПДВ</p>
        </div>
        <div className="on-actions">
          <Button variant="secondary" icon="ti-refresh" onClick={autoLinkPayments} loading={linking} aria-label="Підтягнути оплати" className="on-hide-sm">{linking ? 'Підбір…' : 'Підтягнути оплати'}</Button>
          <Button variant="secondary" iconOnly icon="ti-refresh" onClick={autoLinkPayments} loading={linking} aria-label="Підтягнути оплати" className="on-show-sm" />
          <Button variant="brand" icon="ti-plus" onClick={onNew}>Нове замовлення</Button>
        </div>
      </div>

      {stages.length > 0 && (
        <div className="on-stages" role="group" aria-label="Етапи замовлень у роботі">
          {stages.map(x => {
            const tone = ORDER_STATUS_TONE[x.s] || 'neutral'
            const on = stage === x.s
            return (
              <button key={x.s} type="button" className={`on-tile is-${tone}`} aria-pressed={on} onClick={() => setStage(on ? null : x.s)}
                title={`${labelForStatus(x.s)}: ${x.n} · ${formatAmount(x.sum)} ₴`}>
                <span className="on-tile-head"><span className="on-tile-dot" aria-hidden="true" />{labelForStatus(x.s)}<span className="on-tile-n">{x.n}</span></span>
                <span className="on-tile-sum">{formatShort(x.sum)} <small>₴</small></span>
                <span className="on-tile-bar" aria-hidden="true"><span style={{ width: `${openSum > 0 ? Math.max(2, x.sum / openSum * 100) : 0}%` }} /></span>
              </button>
            )
          })}
        </div>
      )}

      <section className="on-card">
        <div className="on-toolbar">
          <Segmented ariaLabel="Фільтр замовлень" value={filter} onChange={setFilter} options={filters} />
          <label className="on-search">
            <i className="ti ti-search" aria-hidden="true" />
            <input type="search" className="form-input" placeholder="№ або клієнт" aria-label="Пошук замовлень" value={q} onChange={e => setQ(e.target.value)} />
          </label>
          {managers.length > 0 && (
            <select className="form-input on-mgr" aria-label="Менеджер" value={manager} onChange={e => setManager(e.target.value)}>
              <option value="">Менеджер: усі</option>
              {managers.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="—">Не призначено</option>
            </select>
          )}
          <span className="on-views"><Segmented ariaLabel="Вигляд" value={view} onChange={setView} options={views} /></span>
        </div>
        {stage && (
          <div className="on-active-filter">
            Етап: <b>{labelForStatus(stage)}</b>
            <button type="button" className="on-link" onClick={() => setStage(null)}>Скинути</button>
          </div>
        )}

        {view === 'report' ? report : loading ? <TableSkeleton rows={8} cols={6} label="Завантаження замовлень…" />
          : view === 'kanban' ? kanban
          : rows.length === 0 ? (
            q.trim() || filter !== 'all' || manager || stage
              ? <EmptyState icon="ti-search" title="Нічого не знайдено" text="Змініть пошук або фільтр."
                  action={{ label: 'Скинути фільтри', onClick: () => { setQ(''); setFilter('all'); setManager(''); setStage(null) } }} />
              : <EmptyState icon="ti-clipboard-list" title="Замовлень ще немає" text="Створіть перше замовлення — далі його етапи, документи й оплати будуть тут."
                  action={{ label: 'Нове замовлення', icon: 'ti-plus', onClick: onNew }} />
          ) : (
            <>
              {/* комп'ютер і планшет — таблиця */}
              <div className="on-table-wrap">
                <table className="on-table">
                  <thead><tr>
                    {sortBtn('order_number', '№')}
                    {sortBtn('client', 'Клієнт')}
                    {sortBtn('manager', 'Менеджер')}
                    {sortBtn('stage', 'Етап')}
                    <th>Задачі</th>
                    <th title="Інвестор · Прогноз · Комісію сплачено">Позначки</th>
                    {sortBtn('total', 'Сума з ПДВ', 'right')}
                  </tr></thead>
                  <tbody>
                    {rows.map(o => (
                      <tr key={o.id} className={o.overdue ? 'is-overdue' : undefined} onClick={() => navigate(`/orders/${o.id}`)} tabIndex={0}
                        onKeyDown={e => { if (e.key === 'Enter') navigate(`/orders/${o.id}`) }}>
                        <td><span className="on-no">{o.order_number || o.id.slice(0, 6)}</span><span className="on-date">{fmtD(o.created_at)}</span></td>
                        <td><span className="on-client"><span className={`on-av is-${toneOf(o.clientName)}`} aria-hidden="true">{initials(o.clientName)}</span><span className="on-trunc">{o.clientName}</span></span></td>
                        <td><Person name={o.managerName} /></td>
                        <td>
                          <Stage o={o} />
                          {o.paid_transaction_id && o.status !== 'paid' && <span className="on-paid" title="Оплату від клієнта прив'язано"><i className="ti ti-cash" aria-hidden="true" /> оплачено</span>}
                          {o.overdue && <span className="on-late">прострочено</span>}
                        </td>
                        <td><TaskChip o={o} navigate={navigate} /></td>
                        <td onClick={e => e.stopPropagation()}><Flags o={o} {...flags} /></td>
                        <td className="on-sum">{formatAmount(o.total)} <small>₴</small></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={6}>Разом · {rows.length} замовл.</td>
                    <td className="on-sum">{formatAmount(total)} <small>₴</small></td>
                  </tr></tfoot>
                </table>
              </div>

              {/* телефон — картки */}
              <ul className="on-cards" aria-label="Замовлення">
                {rows.map(o => (
                  <li key={o.id}>
                    <button type="button" className={`on-mcard${o.overdue ? ' is-overdue' : ''}`} onClick={() => navigate(`/orders/${o.id}`)}>
                      <span className="on-mcard-top">
                        <span><b>№ {o.order_number || o.id.slice(0, 6)}</b> <span className="on-date is-inline">{fmtD(o.created_at)}</span></span>
                        <Stage o={o} />
                      </span>
                      <span className="on-mcard-client">{o.clientName}</span>
                      <span className="on-mcard-foot">
                        <Person name={o.managerName} />
                        {o.tasks && <span className={`on-task is-static${o.tasks.late ? ' is-late' : ''}`}>задач: {o.tasks.n}</span>}
                        <span className="on-sum">{formatAmount(o.total)} <small>₴</small></span>
                      </span>
                    </button>
                  </li>
                ))}
                <li className="on-mtotal">Разом · {rows.length} замовл. · <b>{formatAmount(total)} ₴</b></li>
              </ul>
            </>
          )}
      </section>

      {/* телефон: кнопка створення над нижньою панеллю (ТЗ, розділ 3 — лише на списках) */}
      <button type="button" className="on-fab" onClick={onNew} aria-label="Нове замовлення"><i className="ti ti-plus" aria-hidden="true" /></button>
    </div>
  )
}

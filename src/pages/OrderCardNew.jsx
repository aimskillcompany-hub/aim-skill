// Картка замовлення в новому інтерфейсі (ТЗ редизайну 4.1; макети Order / OrderMobile): шапка, етапи,
// праворуч — план прибутку, оплата від клієнта, найближчі задачі. Логіка й дії — з OrderCard.jsx.
// Тут лише читання (позиції, інші витрати, задачі) для показу; запис — тільки через передані обробники.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCompany } from '../lib/company'
import { computeOrderPlan, expenseNet } from '../lib/orderPlan'
import { loadOrderProfit } from '../lib/orderProfit'
import { ORDER_TYPES, OUTCOME, flowFor, statusLabel } from '../lib/orders'
import { STATUS as TASK_STATUS, ACTIVE, isOverdue, shortDate, kyivTime } from '../lib/tasks'
import { formatAmount } from '../utils/format'
import { Button, Menu, StatusPill, InfoTip } from '../components/ui'
import { initials } from '../components/AppShell'
import './OrderCardNew.css'

const fmtD = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''

// План з позицій замовлення — той самий розрахунок, що у вкладці «Прибутковість» і «Прогнозі»
export function useOrderPlan(o) {
  const { active } = useCompany()
  const vatOn = active?.is_vat_payer !== false
  const [state, setState] = useState(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      let { data: rows, error } = await supabase.from('order_items').select('qty, unit_price, cost_price, vat_rate, cost_vat_rate, price_includes_vat, supplier_id').eq('order_id', o.id)
      if (error) ({ data: rows } = await supabase.from('order_items').select('qty, unit_price, cost_price, vat_rate, price_includes_vat, supplier_id').eq('order_id', o.id))
      const { data: exp } = await supabase.from('order_expenses').select('*').eq('order_id', o.id)
      const other = (exp || []).reduce((s, e) => s + expenseNet(e), 0)
      if (alive) setState({ count: (rows || []).length, plan: computeOrderPlan(rows || [], { vatOn, agentPct: o.agent_commission_pct, otherExpenses: other }) })
    })()
    return () => { alive = false }
  }, [o.id, o.total, o.agent_commission_pct, vatOn])
  return state
}

// Етапи смугами (як у макеті): пройдені — зелені з галочкою, поточний — бурштиновий / зелений, далі — сірі.
// Клік по етапу одразу змінює статус (рішення власника — без підтвердження).
function StageBars({ o, onChange }) {
  const steps = flowFor(o.type)
  let cur = steps.findIndex(x => x.s === o.status)
  if (cur < 0) cur = 0
  const ref = useRef(null)
  useEffect(() => {
    const box = ref.current, el = box?.querySelector('[aria-current="step"]')
    if (!el || box.scrollWidth <= box.clientWidth) return
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
    box.scrollLeft += (r.left - b.left) - (b.width - r.width) / 2
  }, [cur])
  return (
    <nav className="ocn-steps" aria-label="Етапи замовлення" ref={ref}>
      {steps.map((st, i) => {
        const cls = i < cur ? 'is-done' : i === cur ? (st.accent ? 'is-current is-attention' : 'is-current') : ''
        return (
          <button key={st.s} type="button" className={`ocn-step ${cls}`} aria-current={i === cur ? 'step' : undefined}
            onClick={() => onChange(st.s)} title={i === cur ? 'Поточний етап' : `Перевести в «${st.label}»`}>
            <span className="ocn-step-bar" aria-hidden="true" />
            <span className="ocn-step-label">{i < cur && <i className="ti ti-check" aria-hidden="true" />}{st.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function useProfileName(id) {
  const [name, setName] = useState(null)
  useEffect(() => {
    if (!id) { setName(null); return }
    supabase.from('profiles').select('full_name, email').eq('id', id).maybeSingle().then(({ data }) => setName(data ? (data.full_name || data.email) : null))
  }, [id])
  return name
}

export function OrderHeadNew({ o, plan, busy, onBack, onStatus, onArchive, onUnarchive, onCopy, onDelete, onUnlinkPayment, payment }) {
  const managerName = useProfileName(o.manager_id)
  const steps = flowFor(o.type)
  const cur = steps.findIndex(x => x.s === o.status)
  const next = !o.archived_at && cur >= 0 ? steps[cur + 1] : null
  const p = plan?.plan
  // ТЗ «Прибутковість у замовленні» 2.0: у шапці — чистий прибуток (план), після закриття й повної оплати — факт
  const { active } = useCompany()
  const [fact, setFact] = useState(null)
  useEffect(() => {
    setFact(null)
    if (o.status !== 'closed') return
    let on = true
    loadOrderProfit(o, { vatOn: active?.is_vat_payer !== false }).then(r => { if (on && r.hasFact && r.fullyPaid) setFact(r.fact) }).catch(() => {})
    return () => { on = false }
  }, [o.id, o.status, o.paid_transaction_id])
  const head = fact ? { net: fact.net, rev: fact.revenue, tag: 'факт' } : p ? { net: p.net, rev: p.revenueNet, tag: 'план' } : null
  const headPct = head && head.rev > 0 ? (head.net / head.rev * 100).toFixed(1).replace('.', ',') : null
  const client = o.contractors?.name
  return (
    <>
      <Link to="/orders" className="ocn-back" onClick={onBack}><i className="ti ti-chevron-left" aria-hidden="true" /><span className="ocn-back-lg">Реєстр замовлень</span><span className="ocn-back-sm">Замовлення {o.order_number || ''}{ORDER_TYPES[o.type] ? ` · ${ORDER_TYPES[o.type]}` : ''}</span></Link>
      <section className="ocn-head">
        <div className="ocn-head-top">
          <div className="ocn-head-main">
            <div className="ocn-title-row">
              <h1 className="ocn-h1">Замовлення {o.order_number || o.id.slice(0, 6)}</h1>
              {ORDER_TYPES[o.type] && <span className="ocn-chip is-brand">{ORDER_TYPES[o.type]}</span>}
              {o.archived_at && OUTCOME[o.outcome]
                ? <StatusPill status={o.outcome} kind="order" />
                : <StatusPill status={o.status} kind="order" label={statusLabel(o)} />}
            </div>
            <div className="ocn-meta">
              {client && (o.client_id
                ? <Link to={`/contractors/${o.client_id}`} className="ocn-meta-item ocn-client"><span className="ocn-av" aria-hidden="true">{initials(client)}</span>{client}</Link>
                : <span className="ocn-meta-item"><span className="ocn-av" aria-hidden="true">{initials(client)}</span>{client}</span>)}
              <span className={`ocn-meta-item${managerName ? '' : ' is-none'}`}><span className="ocn-av is-round" aria-hidden="true">{managerName ? initials(managerName) : '?'}</span>{managerName || 'Менеджера не призначено'}</span>
              {o.created_at && <span className="ocn-meta-item ocn-muted">Створено {fmtD(o.created_at)}</span>}
              {o.paid_transaction_id && payment && (
                <button type="button" className="ocn-paid" onClick={onUnlinkPayment} title={`${payment.description || ''}\n\nНатисніть, щоб відв'язати, якщо це не оплата цього замовлення`}>
                  <i className="ti ti-cash" aria-hidden="true" /> Оплачено {fmtD(payment.date)} · {formatAmount(Math.abs(payment.amount))} ₴ <i className="ti ti-x" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <div className="ocn-head-side">
            <div className="ocn-total">{formatAmount(o.total)} <small>₴</small></div>
            <div className="ocn-total-sub">з ПДВ{head && <> · чистий прибуток <b className={head.net < 0 ? 'is-neg' : ''}>{formatAmount(head.net, { decimals: 0 })} ₴</b> · {head.tag}{headPct != null ? ` · ${headPct}%` : ''}</>}</div>
            <div className="ocn-actions">
              <Button variant="secondary" iconOnly icon="ti-copy" aria-label="Копіювати замовлення" title="Копіювати замовлення" onClick={onCopy} loading={busy === 'copy'} />
              {o.archived_at
                ? <Button variant="secondary" icon="ti-rotate-2" onClick={onUnarchive} loading={busy === 'archive'}>Повернути в роботу</Button>
                : <>
                    <Button variant="secondary" icon="ti-x" className="ocn-lost" onClick={() => onArchive('lost')} disabled={busy === 'archive'} aria-label="Програно"><span className="ocn-btn-t">Програно</span></Button>
                    <Button variant="secondary" icon="ti-check" className="ocn-won" onClick={() => onArchive('won')} disabled={busy === 'archive'} aria-label="Виконано"><span className="ocn-btn-t">Виконано</span></Button>
                  </>}
              {next && <Button variant="primary" onClick={() => onStatus(next.s)}>Далі: {next.label} <i className="ti ti-arrow-right" aria-hidden="true" /></Button>}
              <Menu items={[{ label: 'Видалити замовлення', icon: 'ti-trash', danger: true, disabled: !!busy, onClick: onDelete }]}
                trigger={<Button variant="secondary" iconOnly icon="ti-dots" aria-label="Інші дії" />} />
            </div>
          </div>
        </div>
        <StageBars o={o} onChange={onStatus} />
      </section>
    </>
  )
}

export function OrderAside({ o, plan, payment, onTab }) {
  const [tasks, setTasks] = useState(null)
  useEffect(() => {
    supabase.from('tasks').select('id, title, status, due_at, due_date, assignee_id').eq('entity_type', 'order').eq('entity_id', o.id)
      .then(({ data }) => setTasks((data || []).filter(t => ACTIVE(t)).sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'))))
  }, [o.id])
  const p = plan?.plan
  return (
    <aside className="ocn-aside" aria-label="Підсумок замовлення">
      <section className="ocn-plan">
        <span className="ocn-plan-label">Чистий прибуток (план)
          {plan?.count > 0 && <button type="button" className="ocn-plan-pdf" title="Розрахунок (PDF)" aria-label="Розрахунок рентабельності, PDF"
            onClick={async () => {
              const { data: rows } = await supabase.from('order_items').select('*, contractors(name)').eq('order_id', o.id).order('created_at')
              const { investorReportPdf } = await import('../lib/docgen')
              investorReportPdf(o, rows || [])
            }}><i className="ti ti-file-type-pdf" aria-hidden="true" /></button>}</span>
        {p ? <>
          <div className={`ocn-plan-value${p.net < 0 ? ' is-neg' : ''}`}>{formatAmount(p.net, { decimals: 0, sign: p.net > 0 ? 'always' : 'auto' })} ₴</div>
          <span className="ocn-plan-hint">{p.revenueNet > 0 ? `маржа ${(p.net / p.revenueNet * 100).toFixed(1).replace('.', ',')}% після податку` : 'додайте позиції у «Товари»'}</span>
          <dl className="ocn-plan-rows">
            <div><dt>Виручка без ПДВ</dt><dd>{formatAmount(p.revenueNet, { decimals: 0 })}</dd></div>
            <div><dt>Собівартість</dt><dd>{formatAmount(-p.costNet, { decimals: 0 })}</dd></div>
            {p.tax > 0 && <div><dt>Податок 18%</dt><dd>{formatAmount(-p.tax, { decimals: 0 })}</dd></div>}
            {p.agent > 0 && <div><dt>Агентські</dt><dd>{formatAmount(-p.agent, { decimals: 0 })}</dd></div>}
            {p.other > 0 && <div><dt>Інші витрати</dt><dd>{formatAmount(-p.other, { decimals: 0 })}</dd></div>}
          </dl>
        </> : <div className="ocn-plan-value">…</div>}
        <button type="button" className="ocn-plan-link" onClick={() => onTab('finance')}>Прибутковість <i className="ti ti-arrow-right" aria-hidden="true" /></button>
      </section>

      <section className="ocn-box">
        <div className="ocn-box-head"><h2>Оплата від клієнта</h2>
          {o.paid_transaction_id ? <span className="ocn-chip is-brand">Отримано</span> : <span className="ocn-chip is-warn">Не знайдено</span>}
        </div>
        {o.paid_transaction_id && payment
          ? <p className="ocn-box-text">{fmtD(payment.date)} · <b>{formatAmount(Math.abs(payment.amount))} ₴</b><br />{payment.counterparty || payment.description || ''}</p>
          : <p className="ocn-box-text">Оплату ще не знайдено<InfoTip label="Оплата від клієнта">Платежу з таким контрагентом і сумою у виписці поки немає. Прив’яжіть оплату вручну.</InfoTip></p>}
        {!o.paid_transaction_id && <Button variant="secondary" onClick={() => onTab('finance')} className="ocn-wide">Прив'язати вручну</Button>}
      </section>

      <section className="ocn-box">
        <div className="ocn-box-head"><h2>Найближчі задачі</h2>
          <button type="button" className="ocn-link" onClick={() => onTab('tasks')}>{tasks?.length ? `Усі ${tasks.length}` : 'Додати'}</button>
        </div>
        {tasks == null ? <p className="ocn-box-text">…</p>
          : tasks.length === 0 ? <p className="ocn-box-text">Відкритих задач немає.</p>
          : <ul className="ocn-tasks">
              {tasks.slice(0, 3).map(t => (
                <li key={t.id}><Link to={`/tasks?task=${t.id}`}>
                  <span className="ocn-dot" style={{ background: isOverdue(t) ? 'var(--expense-chart)' : (TASK_STATUS[t.status]?.dot || 'var(--muted-2)') }} aria-hidden="true" />
                  <span><b>{t.title}</b><small>{t.due_date ? `${shortDate(t.due_date)}${t.due_at && kyivTime(t.due_at) !== '18:00' ? ', ' + kyivTime(t.due_at) : ''}` : 'без терміну'}{isOverdue(t) ? ' · прострочено' : ''}</small></span>
                </Link></li>
              ))}
            </ul>}
      </section>
    </aside>
  )
}

// Підсумок внизу (як у макеті): собівартість, виручка, ПДВ, маржа, разом до сплати
export function OrderTotals({ o, plan }) {
  const p = plan?.plan
  if (!p || !plan.count) return null
  const pct = p.revenueNet > 0 ? Math.round(p.gross / p.revenueNet * 100) : 0
  return (
    <div className="ocn-totals">
      <div><span>Собівартість без ПДВ</span><b>{formatAmount(p.costNet)}</b></div>
      <div><span>Виручка без ПДВ</span><b>{formatAmount(p.revenueNet)}</b></div>
      <div><span>ПДВ</span><b>{formatAmount(p.saleVat)}</b></div>
      <div><span>Маржа без ПДВ</span><b className={p.gross < 0 ? 'is-neg' : 'is-pos'}>{formatAmount(p.gross)} · {pct}%</b></div>
      <div className="is-dark"><span>Разом до сплати, з ПДВ</span><b>{formatAmount(o.total)} ₴</b></div>
    </div>
  )
}

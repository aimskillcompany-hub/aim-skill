// Вкладка «Прибутковість» v2 (ТЗ 05-TZ-pributkovist-v2, 27.10.2026; макети OrderProfit2 / 2T / 2Mobile).
// Порядок: Результат → Що зробити → Гроші по замовленню → Деталі (акордеони). Права колонка картки на цій вкладці прихована.
// Розрахунки без змін: lib/orderProfit (план, факт за оплатами, знімок, висновок), графік — buildOrderForecasts.
import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { useCompany } from '../lib/company'
import { loadOrderProfit, EXPENSE_KINDS } from '../lib/orderProfit'
import { loadPaymentPlan, savePaymentPlanEntry, saveSupplierTerms, setSupplierSettled, DEFAULT_CLIENT_DAYS } from '../lib/forecast'
import { paymentCandidates, unlinkOrderPayment } from '../lib/orderPayments'
import { findSupplierDocPays, findAmountPays, linkSupplierDocPay } from '../lib/supplierDocPays'
import { todayKyiv } from '../lib/dates'
import { formatAmount } from '../utils/format'
import { Button, Modal, Callout, EmptyState, Menu, useToast, InfoTip } from './ui'
import ContractorSelect from './ui/ContractorSelect'
import './OrderProfitV2.css'

const n0 = (v) => formatAmount(v, { decimals: 0 })
const n2 = (v) => Math.abs((Number(v) || 0) % 1) < 0.005 ? formatAmount(v, { decimals: 0 }) : formatAmount(v)   // копійки — лише коли є
const sg0 = (v) => formatAmount(v, { decimals: 0, sign: 'always' })
const sg2 = (v) => Math.abs((Number(v) || 0) % 1) < 0.005 ? formatAmount(v, { decimals: 0, sign: 'always' }) : formatAmount(v, { sign: 'always' })
const dm = (s) => s ? `${String(s).slice(8, 10)}.${String(s).slice(5, 7)}` : '—'
const dmy = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const pc = (f) => f == null || !isFinite(f) ? '—' : `${(f * 100).toFixed(1).replace('.', ',')}%`
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const SUSPECT = /ПФД|позик|фін\.?\s*допомог|повернен/i
const LS_KEY = 'aim.opv2.details'
const readOpen = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {} } catch { return {} } }
const saveOpen = (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)) } catch { /* приватний режим */ } }
const useMobile = () => {
  const q = '(max-width: 767px)'
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches)
  useEffect(() => { const mq = window.matchMedia?.(q); if (!mq) return; const f = () => setM(mq.matches); mq.addEventListener?.('change', f); return () => mq.removeEventListener?.('change', f) }, [])
  return m
}

export default function OrderProfitV2({ o, onOrderChange }) {
  const { user } = useUser()
  const { active } = useCompany()
  const toast = useToast()
  const mobile = useMobile()
  const vatOn = active?.is_vat_payer !== false
  const today = todayKyiv()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [pp, setPp] = useState([])
  const [cands, setCands] = useState([])          // оплата клієнта, знайдена за клієнтом і сумою
  const [found, setFound] = useState([])          // оплати постачальникам: через прихідні + за сумою
  const [open, setOpen] = useState(null)          // розгорнутий рядок платежу (key)
  const [det, setDet] = useState(readOpen)        // акордеони «Деталей»
  const [hl, setHl] = useState(null)              // підсвічена оплата в «Прив'язаних оплатах»
  const [modal, setModal] = useState(null)        // { type: 'expense'|'link'|'found', ... }
  const shipRef = useRef(null)

  const load = () => {
    setErr(null)
    loadOrderProfit(o, { vatOn }).then(setD).catch(e => setErr(e.message))
    loadPaymentPlan(o.id).then(setPp).catch(() => setPp([]))
    if (!o.paid_transaction_id && o.client_id) paymentCandidates(o).then(setCands).catch(() => setCands([]))
    else setCands([])
  }
  useEffect(load, [o.id, o.total, o.paid_transaction_id, o.status, o.agent_commission_pct, vatOn])
  // пошук оплат постачальникам — коли є картки (потрібні неоплачені рядки)
  useEffect(() => {
    if (!d) return
    let alive = true
    ;(async () => {
      const docs = await findSupplierDocPays([o.id]).catch(() => [])
      const lines = d.cards.filter(c => c.isSupplier && c.supplierId && !c.paid && !c.settled).map(c => ({ key: c.key, supplierId: c.supplierId, remaining: Math.max(0, c.plan - c.fact) }))
      const byAmt = await findAmountPays(o.id, lines, { exclude: new Set(docs.map(p => p.txId)), today }).catch(() => [])
      if (alive) setFound([...docs, ...byAmt])
    })()
    return () => { alive = false }
  }, [d])
  const changed = () => { load(); onOrderChange?.() }
  const toggleDet = (k, v) => setDet(s => { const n = { ...s, [k]: v ?? !s[k] }; saveOpen(n); return n })

  if (err) return <Callout tone="danger" title="Не вдалося завантажити." text={err} action={{ label: 'Повторити', onClick: load }} />
  if (!d) return <div className="opv2"><div className="opv2-skel" aria-label="Рахую прибутковість…"><i /><i /><i /></div></div>
  if (!d.itemsCount) return <EmptyState icon="ti-calculator" title="Додайте товари, щоб побачити прибутковість" text="План рахується з позицій замовлення." action={{ label: 'До товарів', onClick: () => document.getElementById('ocn-tab-items')?.click() }} />

  const { pl, fact, hasFact, closed } = d
  const final = closed && d.fullyPaid
  const ship = pp.find(x => x.kind === 'ship') || {}, client = pp.find(x => x.kind === 'client') || {}
  const savePlan = async (kind, patch) => {
    const cur = kind === 'ship' ? ship : client
    try { await savePaymentPlanEntry(o.id, { kind, supplierId: null, planDate: 'planDate' in patch ? patch.planDate : cur.plan_date, days: 'days' in patch ? patch.days : cur.days }); load() }
    catch (e) { toast(e.message, { type: 'error' }) }
  }
  const supRows = (sid) => pp.filter(x => x.kind === 'supplier' && (x.supplier_id || null) === (sid || null)).sort((a, b) => (a.part_no || 1) - (b.part_no || 1))
  const termsOf = (sid) => { const rows = supRows(sid); return { baseDate: rows.find(x => x.base_date)?.base_date || '', parts: rows.length ? rows.map(x => ({ sharePct: x.share_pct ?? '', days: x.days ?? '', planDate: x.plan_date || '' })) : [{ sharePct: '', days: '', planDate: '' }] } }
  const saveTerms = async (sid, t) => { try { await saveSupplierTerms(o.id, sid || null, t); toast('Умови оплати збережено'); load() } catch (e) { toast(e.message, { type: 'error' }) } }
  const settle = async (c, on) => { try { await setSupplierSettled(o.id, c.supplierId, on); toast(on ? 'Позначено «Оплачено повністю»' : 'Залишок знову відкрито'); changed() } catch (e) { toast('Не вдалося: ' + e.message, { type: 'error' }) } }

  // ── Гроші зараз і прогрес ──
  const nowSum = d.payments.reduce((s, p) => s + p.sign * p.amount, 0)
  const clientPaid = d.clientGross, clientPlan = d.plan.revenueGross
  const supPaid = d.supplierGross, supPlan = d.plan.costGross
  const supplierIds = [...new Set(d.cards.filter(c => c.isSupplier && c.supplierId).map(c => c.supplierId))]
  const due = (c) => Math.max(0, c.plan - c.fact)
  const clientDue = d.cards.filter(c => c.kind === 'income').reduce((s, c) => s + due(c), 0)
  const supTargets = () => { const by = {}, out = []
    d.cards.filter(c => c.isSupplier && c.supplierId && !c.paid && !c.settled).forEach(c => { const r = due(c); if (r > 0.5) { out.push({ supplierId: c.supplierId, amount: r }); by[c.supplierId] = (by[c.supplierId] || 0) + r } })
    Object.entries(by).forEach(([sid, v]) => { if (!out.some(x => x.supplierId === sid && Math.abs(x.amount - v) < 0.5)) out.push({ supplierId: sid, amount: v }) })
    return out }
  const openLink = (preset = {}) => setModal({ type: 'link', preset })

  // ── «Що зробити» (ТЗ 05, 4) ──
  const todo = []
  d.payments.filter(p => p.sign > 0 && !p.confirmed && ((o.client_id && p.contractorId && p.contractorId !== o.client_id) || SUSPECT.test(`${p.purpose} ${p.description}`))).forEach(p => todo.push({
    tone: 'bad', title: `Перевірити оплату ${n0(p.amount)} ₴`,
    text: `Прийшла від ${p.counterparty}${p.purpose || p.description ? ` з призначенням «${(p.purpose || p.description).slice(0, 60)}»` : ''}, а клієнт замовлення — ${o.contractors?.name || 'інший'}`,
    amount: p.amount, sign: 1, btn: { label: 'Перевірити', onClick: () => { toggleDet('pays', true); setHl(p.txId); setTimeout(() => document.getElementById('opv2-pays')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60) } },
  }))
  d.cards.filter(c => c.overdue && !c.paid && !c.settled && c.kind !== 'income').forEach(c => todo.push({
    tone: 'bad', title: `Прострочено: ${c.partsCount > 1 ? 'частина ' + c.partNo + '/' + c.partsCount + ' · ' : ''}${c.label}`,
    text: `${c.partsCount > 1 ? `Частина ${c.partNo}/${c.partsCount}` : 'Платіж'} мала бути сплачена ${dm(c.date)}`,
    amount: -due(c), sign: -1, btn: { label: 'Прив’язати', dark: true, onClick: () => openLink({ dir: 'expense', supplierIds: c.supplierId ? [c.supplierId] : supplierIds, target: c.supplierId ? { supplierId: c.supplierId, amount: due(c) } : null }) },
  }))
  if (found.length) todo.push({
    tone: 'info', title: `${found.length} ${found.length === 1 ? 'оплату' : 'оплати'} постачальникам знайдено`,
    text: `${found.some(p => !p.byAmount) ? 'Через прихідні накладні' : 'За сумою'}: ${[...new Set(found.map(p => p.doc?.contractors?.name || p.tx?.counterparty).filter(Boolean))].join(', ')}`,
    amount: found.reduce((s, p) => s + p.amount, 0), sign: 0, btn: { label: 'Переглянути', brand: true, onClick: () => setModal({ type: 'found' }) },
  })
  const noSup = d.cards.filter(c => c.warn === 'supplier')
  if (noSup.length) todo.push({
    tone: 'warn', title: 'Вказати постачальника',
    text: `Позиції на ${n0(noSup.reduce((s, c) => s + c.plan, 0))} ₴ без постачальника — не можна знайти оплату й умови`,
    amount: -noSup.reduce((s, c) => s + c.plan, 0), sign: -1, btn: { label: 'Вказати', dark: true, onClick: () => { setOpen(noSup[0].key); setTimeout(() => document.getElementById('opv2-row-' + noSup[0].key)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60) } },
  })
  if (d.shipEst && !ship.plan_date) todo.push({
    tone: 'amber', title: 'Задати дату відвантаження', text: `Зараз усі дати орієнтовні (сьогодні + 14 дн.)`, amount: null,
    btn: { label: 'Задати', onClick: () => { shipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => shipRef.current?.open?.(), 300) } },
  })
  const cliCard = d.cards.find(c => c.kind === 'income' && !c.paid)
  if (cliCard && cliCard.date && cliCard.date < today && !(cliCard.fact > 0.5)) todo.push({
    tone: 'bad', title: 'Оплату від клієнта не знайдено', text: `Шукаємо за клієнтом і сумою ${n0(o.total)} ₴`,
    amount: due(cliCard), sign: 1, btn: { label: 'Прив’язати', onClick: () => openLink({ dir: 'income', target: { amount: due(cliCard) } }) },
  })

  // ── Висновок ──
  const v = d.verdict
  const vTone = !hasFact ? 'is-muted' : !final ? 'is-warn' : !v ? 'is-muted' : v.loss ? 'is-bad' : v.acc >= 95 && v.acc <= 105 ? 'is-ok' : v.acc >= 85 ? 'is-warn' : 'is-orange'
  const marg = (x, rev) => rev > 0 ? x / rev : null

  return (
    <div className={`opv2${mobile ? ' is-mobile' : ''}`}>
      {/* ── 1. Результат ── */}
      <section className="opv2-card opv2-res" aria-label="Результат">
        <div className="opv2-res-c">
          <span className="opv2-lbl">{final ? 'Заробили' : 'Заробимо · план'}<InfoTip label="Чистий прибуток">Чистий прибуток = виручка без ПДВ − собівартість − податок 18% − агентські − інші витрати. Валова маржа {pc(marg(pl.gross, pl.revenue))}.</InfoTip></span>
          {(() => { const val = final ? fact.net : pl.net, rev = final ? fact.revenue : pl.revenue
            return <><b className={`opv2-big ${val < 0 ? 'is-neg' : 'is-pos'}`}>{n0(val)} ₴</b>
              <small>{val < 0 ? 'Замовлення збиткове' : `${pc(marg(val, rev))} чистої маржі${final ? ` · план ${n0(pl.net)} ₴` : ''}`}</small></> })()}
        </div>
        <div className="opv2-res-c opv2-now">
          <div className="opv2-now-h"><span>Гроші по замовленню {d.fullyPaid ? '· усе сплачено' : 'зараз'}</span><b className={nowSum < 0 ? 'is-neg' : 'is-pos'}>{sg0(nowSum)} ₴</b></div>
          <Bar label="Клієнт оплатив" a={clientPaid} b={clientPlan} tone="in" mobile={mobile} />
          <Bar label="Постачальникам сплачено" a={supPaid} b={supPlan} tone="out" mobile={mobile} />
        </div>
        <div className={`opv2-res-c opv2-verdict ${vTone}`}>
          {!hasFact ? <><b>Факту ще немає</b><p>Порахуємо після перших прив’язаних оплат.{d.snap ? ` Знімок прогнозу збережено ${dm(d.snap.taken_at?.slice(0, 10))}.` : ' Знімок прогнозу ще не збережено — він зберігається при позначці «в прогноз».'}</p></>
            : !final ? <><b>Факт попередній</b><p>Клієнт оплатив {Math.round((d.clientPct || 0) * 100)}%, постачальникам — {Math.round((d.supplierPct || 0) * 100)}%. Прибуток за оплатами ({n0(fact.net)} ₴) порахуємо остаточно після закриття.</p></>
            : v ? <><b>{v.loss ? 'Замовлення збиткове' : v.acc >= 95 && v.acc <= 105 ? `Прогноз справдився · ${v.acc}%` : `Справдилось ${v.acc}% прогнозу`}</b>
                <p>Факт {n0(fact.net)} ₴ ({pc(marg(fact.net, fact.revenue))}) проти плану {n0(pl.net)} ₴{v.worst ? `: ${v.worst.l.toLowerCase()} ${sg0(v.worst.d)} ₴` : ''}.{v.delay ? ` Клієнт оплатив на ${v.delay} дн. пізніше.` : ''}{d.planFrom === 'live' ? ' Знімок прогнозу не зберігся — порівняння з поточним планом.' : ''}</p></>
            : <><b>Усе сплачено</b><p>Висновок з’явиться після закриття замовлення.</p></>}
        </div>
      </section>

      {/* ── 2. Що зробити ── */}
      <section className="opv2-card" aria-label="Що зробити">
        <div className="opv2-head"><h2>Що зробити{todo.length > 0 && <span className="opv2-count">{todo.length}</span>}</h2>
          {!mobile && <div className="opv2-acts"><Button size="sm" variant="secondary" onClick={() => openLink({})}>Прив’язати з виписки</Button><Button size="sm" variant="secondary" onClick={() => setModal({ type: 'expense', kind: 'delivery' })}>+ Інша витрата</Button></div>}</div>
        {todo.length === 0 ? <p className="opv2-done">✓ Усі оплати прив’язані, дат і постачальників не бракує</p> : (
          <ul className="opv2-todo">{todo.map((t, i) => (
            <li key={i}>
              <span className={`opv2-dot is-${t.tone}`} aria-hidden="true" />
              <div className="opv2-todo-t"><b>{t.title}</b><span>{t.text}</span></div>
              {t.amount != null ? <b className={`opv2-todo-a ${t.sign > 0 ? 'is-pos' : t.sign < 0 ? 'is-neg' : 'is-info'}`}>{t.sign > 0 ? '+' : ''}{n0(t.amount)}</b> : <span />}
              <Button size="sm" variant={t.btn.dark ? 'primary' : t.btn.brand ? 'brand' : 'secondary'} onClick={t.btn.onClick}>{t.btn.label}</Button>
            </li>
          ))}</ul>
        )}
      </section>

      {/* ── 3. Гроші по замовленню ── */}
      <section className="opv2-card is-flush" aria-label="Гроші по замовленню">
        <div className="opv2-head opv2-pad">
          <h2>Гроші по замовленню</h2>
          <div className="opv2-shipline">
            {!mobile && <>
              <span>Відвантаження</span>
              <EditDate ref={shipRef} value={ship.plan_date || (d.shipEst ? '' : d.shipDate) || ''} placeholder={`не задано · ${dm(d.shipDate)}`} onSave={(val) => savePlan('ship', { planDate: val || null })} label="Дата відвантаження" />
              <span>· клієнт платить через</span>
              <EditDays value={client.days} placeholder={DEFAULT_CLIENT_DAYS} onSave={(val) => savePlan('client', { days: val })} />
            </>}
            <InfoTip label="Дати платежів" placement="left">Без дати відвантаження система бере сьогодні + 14 днів і позначає дати «орієнтовно». Оплата клієнта = відвантаження + N днів. Умови постачальника — у рядку платежу.</InfoTip>
          </div>
        </div>
        {mobile && <div className="opv2-pad opv2-mship">
          <label>Відвантаження <EditDate ref={shipRef} value={ship.plan_date || (d.shipEst ? '' : d.shipDate) || ''} placeholder={`не задано · ${dm(d.shipDate)}`} onSave={(val) => savePlan('ship', { planDate: val || null })} label="Дата відвантаження" /></label>
          <label>клієнт платить через <EditDays value={client.days} placeholder={DEFAULT_CLIENT_DAYS} onSave={(val) => savePlan('client', { days: val })} /></label>
        </div>}
        {d.cards.length > 0 && (mobile
          ? (d.frozen ? <p className="opv2-hold-m">Тримає {n0(d.frozen.amount)} ₴ ваших грошей · з {dm(d.frozen.from)}</p> : null)
          : <StepChart cards={d.cards} />)}
        {d.cards.length === 0 ? <p className="opv2-pad opv2-muted">Немає платежів у графіку.</p> : (
          <div className="opv2-rows" role="list">{d.cards.map(c => {
            const canOpen = c.isSupplier || c.kind === 'income'
            const isOpen = open === c.key
            const panel = canOpen && isOpen ? (c.isSupplier
              ? <SupplierPanel key={'p' + c.key} c={c} o={o} init={termsOf(c.supplierId)} onSave={t => saveTerms(c.supplierId, t)} onSettle={settle} onAssigned={changed}
                  onLink={() => openLink({ dir: 'expense', supplierIds: c.supplierId ? [c.supplierId] : supplierIds, target: c.supplierId ? { supplierId: c.supplierId, amount: due(c) } : null })} />
              : <ClientPanel c={c} client={client} onSave={(dt) => savePlan('client', { planDate: dt || null })} onLink={() => openLink({ dir: 'income', target: { amount: due(c) } })} />) : null
            return (
              <Fragment key={c.key}>
                <div id={'opv2-row-' + c.key} role="listitem" className={`opv2-row${c.after < 0 ? ' is-low' : ''}${isOpen ? ' is-open' : ''}${canOpen ? ' is-click' : ''}`}
                  onClick={canOpen ? () => setOpen(isOpen ? null : c.key) : undefined}
                  onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : c.key) } } : undefined}
                  tabIndex={canOpen ? 0 : undefined} aria-expanded={canOpen ? isOpen : undefined}>
                  <span className="opv2-caret" aria-hidden="true">{canOpen && <i className={`ti ti-chevron-${isOpen ? 'down' : 'right'}`} />}</span>
                  <span className="opv2-date"><b>{dm(c.date)}</b><small className={rowSubCls(c)}>{rowSub(c)}</small></span>
                  <span className="opv2-name"><b>{rowName(c, o)}</b><InfoTip label="Умова платежу">{rowTerms(c)}</InfoTip>
                    {c.part && <span className="opv2-part"><i><em style={{ width: `${Math.min(100, (c.fact / c.plan) * 100)}%` }} /></i><small>{c.kind === 'income' ? 'отримано' : 'сплачено'} {n0(c.fact)} з {n2(c.plan)}</small></span>}
                    {c.settled && <small className="opv2-settled">оплачено повністю вручну{c.saving > 0.5 ? ` · на ${n0(c.saving)} ₴ менше за план` : ''}</small>}</span>
                  <span className={`opv2-chip ${chipCls(c)}`}>{chipText(c, mobile)}</span>
                  <b className={`opv2-amt ${c.amount < 0 ? 'is-neg' : 'is-pos'}`}>{c.amount < 0 ? '−' : '+'}{n2(Math.abs(c.amount))}</b>
                  <small className={`opv2-after ${c.after < 0 ? 'is-neg' : 'is-pos'}`}>{mobile ? '→ ' : 'після: '}{sg2(c.after)}</small>
                </div>
                {panel && !mobile && <div className="opv2-panel" onClick={e => e.stopPropagation()}>{panel}</div>}
                {panel && mobile && <Modal open onClose={() => setOpen(null)} title={rowName(c, o)}>{panel}</Modal>}
              </Fragment>
            )
          })}</div>
        )}
        <div className="opv2-foot opv2-pad">
          {d.frozen ? <span className="is-neg">{closed ? 'Замовлення тримало' : 'Замовлення тримає'} до {n0(d.frozen.amount)} ₴ ваших грошей{d.frozen.days != null ? ` — ${d.frozen.days} дн.` : ''} ({dm(d.frozen.from)}{d.frozen.to ? ` – ${dm(d.frozen.to)}` : ''})</span> : <span />}
          {d.flow && <span className={d.flow.ok ? '' : 'is-neg'}>чистий потік <b>{sg2(d.flow.planNet)} ₴</b> {d.flow.ok ? <span className="is-pos">✓ сходиться з планом</span> : `не сходиться з планом на ${n2(d.flow.planNet - d.flow.check)} ₴`}<InfoTip label="Чистий потік" placement="left">Сума всіх платежів по замовленню = чистий прибуток + податок 18% (податок у потік не входить).</InfoTip></span>}
        </div>
      </section>

      {/* ── 4. Деталі ── */}
      <section className="opv2-card is-flush opv2-det" aria-label="Деталі">
        <Acc id="calc" open={det.calc} onToggle={() => toggleDet('calc')} title="Розрахунок прибутку"
          summary={`виручка ${n0(pl.revenue)} · собівартість ${n0(-pl.cost)} · податок ${n0(-pl.tax)}`}>
          <CalcTable d={d} o={o} vatOn={vatOn} />
        </Acc>
        <Acc id="pays" open={det.pays} onToggle={() => toggleDet('pays')} title="Прив’язані оплати" count={d.payments.length}
          summary={(() => { const inc = d.payments.filter(p => p.sign > 0).reduce((s, p) => s + p.amount, 0), out = d.payments.filter(p => p.sign < 0).reduce((s, p) => s + p.amount, 0)
            return !d.payments.length ? '' : out ? `надходження +${n2(inc)} · виплати −${n2(out)}` : `+${n2(inc)}` })()}>
          <PaysList o={o} d={d} hl={hl} cands={cands} userId={user?.id} onChanged={changed} />
        </Acc>
        <Acc id="exps" open={det.exps} onToggle={() => toggleDet('exps')} title="Інші витрати" count={d.exps.length}
          summary={d.exps.length ? n0(-d.exps.reduce((s, e) => s + (Number(e.amount) || 0), 0)) : '0'}>
          <ExpList d={d} onAdd={(kind) => setModal({ type: 'expense', kind })} onChanged={changed} />
        </Acc>
      </section>

      {mobile && <div className="opv2-mbar"><Button variant="primary" onClick={() => openLink({})}>Прив’язати оплату</Button><Button variant="secondary" onClick={() => setModal({ type: 'expense', kind: 'delivery' })}>+ Інша витрата</Button></div>}

      {modal?.type === 'expense' && <ExpenseModal o={o} kind={modal.kind} pl={pl} vatOn={vatOn} userId={user?.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); changed() }} />}
      {modal?.type === 'link' && <LinkTxModal o={o} preset={modal.preset} supplierIds={supplierIds} clientDue={clientDue} supTargets={supTargets()} userId={user?.id} onClose={() => setModal(null)} onDone={() => { setModal(null); changed() }} />}
      {modal?.type === 'found' && <FoundModal found={found} userId={user?.id} onClose={() => setModal(null)} onDone={() => { setModal(null); changed() }} />}
    </div>
  )
}

// ── Рядок платежу: підписи ──
function rowSub(c) {
  if (c.paid && !c.settled) return `${c.kind === 'income' ? 'отримано' : 'оплачено'}${c.when ? ' ' + dm(c.when) : ''}${c.late > 0 ? ` · +${c.late} дн.` : ''}`
  if (c.settled) return 'оплачено'
  if (c.overdue) return 'прострочено'
  if (c.manual) return 'вручну'
  if (c.estimated) return 'орієнтовно'
  return ''
}
const rowSubCls = (c) => c.paid ? '' : c.overdue ? 'is-bad' : c.estimated && !c.manual ? 'is-warn' : ''
function rowName(c, o) {
  if (c.isSupplier) return `${c.supplierId ? c.label : 'Постачальник не вказаний'}${c.partsCount > 1 && c.partNo ? ` · частина ${c.partNo}/${c.partsCount}` : ''}`
  if (c.kind === 'income') return c.label || `Оплата від ${o.contractors?.name || 'клієнта'}`
  return c.label
}
function rowTerms(c) {
  if (c.kind === 'income') return c.itemShip ? `Позиції з відвантаженням ${dm(c.itemShip)}: відвантаження + дні оплати клієнта.` : 'Відвантаження + дні, через які платить клієнт (у заголовку блоку).'
  if (/ПДВ/.test(c.label || '')) return 'ПДВ з відвантаженого — до 30-го числа наступного місяця.'
  if (!c.isSupplier) return 'Інша витрата або агентські — у дату оплати клієнта.'
  const when = (days, base) => days > 0 ? `${base} + ${days} дн.` : days < 0 ? `передоплата за ${-days} дн. до ${base === 'Відвантаження' ? 'відвантаження' : 'отримання'}` : `у день ${base === 'Відвантаження' ? 'відвантаження' : 'отримання'}`
  if (c.itemShip) return `Позиції з відвантаженням ${dm(c.itemShip)}: ${when(c.days, 'Відвантаження')}.`
  if (c.ownDays) return `Відстрочка позиції: ${when(c.days, 'Відвантаження')}.`
  if (c.manual) return `${c.partsCount > 1 ? `Частина ${c.partNo}/${c.partsCount}: ${Math.round(c.sharePct)}%, ` : ''}дата вписана вручну.`
  const base = c.baseDate ? 'Отримання товару' : 'Відвантаження'
  const w = when(c.days, base)
  return `${c.partsCount > 1 ? `Частина ${c.partNo}/${c.partsCount}: ${Math.round(c.sharePct)}%, ` : ''}${w.charAt(0).toUpperCase() + w.slice(1)}.`
}
const chipCls = (c) => c.paid ? 'is-ok' : c.part ? 'is-part' : c.overdue ? 'is-bad' : ''
const chipText = (c, m) => c.paid ? (c.kind === 'income' ? 'отримано' : 'оплачено') : c.part ? `частково${m ? ' · ' + Math.round((c.fact / c.plan) * 100) + '%' : ''}` : c.overdue ? 'прострочено' : 'заплановано'

// ── Смужка прогресу «Клієнт оплатив / Постачальникам сплачено» ──
function Bar({ label, a, b, tone, mobile }) {
  const p = b > 0 ? Math.min(1, a / b) : 0
  return (
    <div className="opv2-bar">
      <span>{label}</span>
      <span className="opv2-bar-v">{mobile ? `${Math.round(p * 100)}%` : <><b>{n0(a)}</b> з {n2(b)}</>}</span>
      <i className={`is-${tone}`}><em style={{ width: `${p * 100}%` }} /></i>
    </div>
  )
}

// ── Поле-кнопка з олівцем: дата (ref.open() — фокус із «Що зробити») ──
const EditDate = forwardRef(function EditDate({ value, placeholder, onSave, label }, ref) {
  const [edit, setEdit] = useState(false)
  const btn = useRef(null)
  useImperativeHandle(ref, () => ({ open: () => setEdit(true), scrollIntoView: (o) => btn.current?.scrollIntoView(o) }), [])
  if (edit) return <input type="date" className="form-input opv2-edit" autoFocus defaultValue={value || ''} aria-label={label}
    onBlur={e => { setEdit(false); if ((e.target.value || '') !== (value || '')) onSave(e.target.value) }}
    onKeyDown={e => { if (e.key === 'Escape') setEdit(false); if (e.key === 'Enter') e.currentTarget.blur() }} />
  return <button ref={btn} type="button" className="opv2-pill" onClick={() => setEdit(true)} aria-label={`${label}: змінити`}>{value ? dm(value) : placeholder} ✎</button>
})
function EditDays({ value, placeholder, onSave }) {
  const [edit, setEdit] = useState(false)
  if (edit) return <input type="number" className="form-input opv2-edit is-num" autoFocus defaultValue={value ?? ''} placeholder={String(placeholder)} aria-label="Клієнт платить через, днів"
    onBlur={e => { setEdit(false); const v = e.target.value; if (String(v) !== String(value ?? '')) onSave(v === '' ? null : Number(v)) }}
    onKeyDown={e => { if (e.key === 'Escape') setEdit(false); if (e.key === 'Enter') e.currentTarget.blur() }} />
  return <button type="button" className="opv2-pill" onClick={() => setEdit(true)} aria-label="Клієнт платить через: змінити">{value ?? placeholder} дн. ✎</button>
}

// ── Ступінчастий графік наростаючого залишку (ТЗ 05, 5.2) ──
function StepChart({ cards }) {
  const box = useRef(null)
  const [w, setW] = useState(900)
  const [hover, setHover] = useState(null)
  useEffect(() => { const el = box.current; if (!el) return; const m = () => { const cs = getComputedStyle(el); setW(Math.max(200, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))) }; const ro = new ResizeObserver(m); ro.observe(el); m(); return () => ro.disconnect() }, [])
  const pts = useMemo(() => {
    const by = []
    cards.filter(c => c.date).forEach(c => { const last = by[by.length - 1]; if (last && last.date === c.date) { last.after = c.after; last.items.push(c) } else by.push({ date: c.date, after: c.after, items: [c] }) })
    return by
  }, [cards])
  if (!pts.length) return null
  const H = 120, top = 12, bot = 22, padL = 0, padR = 12
  const t0 = Date.parse(pts[0].date), t1 = Date.parse(pts[pts.length - 1].date)
  const span = Math.max(1, t1 - t0)
  const x = (dt) => padL + 40 + (Date.parse(dt) - t0) / span * (w - 40 - padL - padR - 30)
  const vals = [0, ...pts.map(p => p.after)]
  const max = Math.max(...vals), min = Math.min(...vals)
  const rng = Math.max(1, max - min)
  const y = (v) => top + (max - v) / rng * (H - top - bot)
  let path = `M 0 ${y(0)} L ${x(pts[0].date)} ${y(0)}`
  let prev = 0
  pts.forEach((p, i) => { path += ` L ${x(p.date)} ${y(prev)} L ${x(p.date)} ${y(p.after)}`; prev = p.after; if (i === pts.length - 1) path += ` L ${w} ${y(p.after)}` })
  const area = `${path} L ${w} ${y(0)} L 0 ${y(0)} Z`
  const low = pts.reduce((a, p) => (p.after < (a?.after ?? 0) ? p : a), null)
  let lastX = -1e9
  const labels = pts.map(p => { const xx = x(p.date); const show = xx - lastX >= w * 0.05; if (show) lastX = xx; return show })
  const h = hover != null ? pts[hover] : null
  return (
    <div className="opv2-chart" ref={box}>
      <svg width={w} height={H} role="img" aria-label="Наростаючий залишок по замовленню">
        <rect x="0" y={y(0)} width={w} height={Math.max(0, y(min) - y(0) + 4)} className="opv2-neg-bg" />
        <clipPath id="opv2-under"><rect x="0" y={y(0)} width={w} height={H} /></clipPath>
        <path d={area} className="opv2-area" clipPath="url(#opv2-under)" />
        <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="opv2-zero" />
        <path d={path} className="opv2-step" />
        {pts.map((p, i) => <circle key={p.date} cx={x(p.date)} cy={y(p.after)} r={p === low ? 4.5 : 3.5} className={p.after < 0 ? 'is-neg' : ''} />)}
        {low && <text x={x(low.date) + 10} y={Math.min(H - bot - 4, y(low.after) - 6)} className="opv2-low-l">{n0(low.after)} ₴</text>}
        {pts.map((p, i) => labels[i] && <text key={'l' + p.date} x={x(p.date)} y={H - 6} textAnchor="middle" className="opv2-x">{dm(p.date)}</text>)}
        {pts.map((p, i) => <rect key={'h' + p.date} x={x(p.date) - 12} y="0" width="24" height={H - bot} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />)}
      </svg>
      {h && <div className="opv2-tip" style={{ left: Math.min(Math.max(4, x(h.date) - 100), w - 210) }}>
        <b>{dmy(h.date)}</b>
        {h.items.map(c => <span key={c.key}>{c.label} <b className={c.amount < 0 ? 'is-neg' : 'is-pos'}>{sg0(c.amount)}</b></span>)}
        <span>Залишок після <b className={h.after < 0 ? 'is-neg' : ''}>{sg0(h.after)} ₴</b></span>
      </div>}
    </div>
  )
}

// ── Розгорнутий рядок постачальника: постачальник, отримання товару, частини, кнопки (ТЗ 05, 5.3) ──
function SupplierPanel({ c, o, init, onSave, onSettle, onLink, onAssigned }) {
  const toast = useToast()
  const [t, setT] = useState(init)
  const [dirty, setDirty] = useState(false)
  const [sup, setSup] = useState({ name: '', id: null })
  const set = (f) => { setT(f); setDirty(true) }
  const setPart = (i, patch) => set({ ...t, parts: t.parts.map((x, k) => k === i ? { ...x, ...patch } : x) })
  const filled = t.parts.filter(x => x.sharePct !== '' && x.sharePct != null)
  const sum = filled.reduce((s, x) => s + Number(x.sharePct || 0), 0)
  const blanks = t.parts.length - filled.length
  const total = blanks ? 100 : sum
  const bad = t.parts.length > 1 && (blanks ? sum >= 100 : Math.abs(sum - 100) > 0.01)
  const fixed = c.ownDays || c.itemShip
  const assign = async (cid) => {
    // «Постачальник не вказаний»: проставити постачальника позиціям замовлення без нього
    const { error } = await supabase.from('order_items').update({ supplier_id: cid }).eq('order_id', o.id).is('supplier_id', null)
    if (error) return toast(error.message, { type: 'error' })
    toast('Постачальника вказано'); onAssigned()
  }
  return (
    <div className="opv2-sp">
      <div className="opv2-sp-row">
        <label className="opv2-f"><span>Постачальник</span>
          {c.supplierId ? <input className="form-input" value={c.label.replace(/^Платимо /, '')} disabled />
            : <ContractorSelect value={sup.name} placeholder="— не вказано —" onChange={v => setSup({ name: v, id: null })} onContractorSelect={x => { setSup({ name: x.name, id: x.id }); assign(x.id) }} />}</label>
        {!fixed && <label className="opv2-f"><span>Отримання товару</span><input type="date" className="form-input" value={t.baseDate || ''} onChange={e => set({ ...t, baseDate: e.target.value })} /></label>}
        {c.defDays != null && <small className="opv2-muted">у картці постачальника: {c.defDays} дн.</small>}
      </div>
      {fixed ? <p className="opv2-muted">{c.itemShip ? `Позиції з окремою датою відвантаження ${dmy(c.itemShip)}` : 'Відстрочка позиції'} — змінюється у «Товарах».</p> : (
        <div className="opv2-sp-parts"><span>Частини оплати:</span>
          {t.parts.map((x, i) => (
            <span key={i} className="opv2-sp-part">
              <input className="form-input is-num" inputMode="decimal" aria-label={`Частина ${i + 1}, %`} value={x.sharePct} placeholder={t.parts.length === 1 ? '100' : blanks ? String(Math.max(0, Math.round((100 - sum) / blanks))) : ''} onChange={e => setPart(i, { sharePct: e.target.value })} disabled={t.parts.length === 1} />
              <span>% через</span>
              <input className="form-input is-num" inputMode="numeric" aria-label={`Частина ${i + 1}, днів`} value={x.days} placeholder={c.defDays != null ? String(c.defDays) : '0'} onChange={e => setPart(i, { days: e.target.value })} />
              <span>дн.</span>
              {x.planDate && <small className="opv2-muted">вручну {dmy(x.planDate)} <button type="button" className="opv2-x-btn" onClick={() => setPart(i, { planDate: '' })} aria-label="Прибрати ручну дату">×</button></small>}
              {t.parts.length > 1 && <button type="button" className="opv2-x-btn" onClick={() => set({ ...t, parts: t.parts.filter((_, k) => k !== i) })} aria-label="Видалити частину">×</button>}
            </span>
          ))}
          <button type="button" className="opv2-chipbtn" disabled={t.parts.length >= 12} onClick={() => set({ ...t, parts: t.parts.length === 1 ? [{ ...t.parts[0], sharePct: t.parts[0].sharePct || '50' }, { sharePct: '50', days: '', planDate: '' }] : [...t.parts, { sharePct: '', days: '', planDate: '' }] })}>+ частина</button>
          <span className={bad ? 'is-neg' : 'is-pos'}>разом {Math.round(total * 100) / 100}% {bad ? '' : '✓'}</span>
        </div>
      )}
      <div className="opv2-sp-acts">
        <Button size="sm" variant="secondary" onClick={onLink}>Прив’язати з виписки</Button>
        {c.supplierId && !c.paid && !c.settled && <Button size="sm" variant="secondary" onClick={() => onSettle(c, true)}>Оплачено повністю</Button>}
        {c.settled && <Button size="sm" variant="ghost" onClick={() => onSettle(c, false)}>Скасувати «Оплачено повністю»</Button>}
        {!fixed && <Button size="sm" variant="brand" disabled={!dirty || bad} onClick={() => { onSave(t); setDirty(false) }}>Зберегти умови</Button>}
      </div>
    </div>
  )
}
function ClientPanel({ c, client, onSave, onLink }) {
  return (
    <div className="opv2-sp">
      <div className="opv2-sp-row">
        <label className="opv2-f"><span>Дата оплати вручну</span><input type="date" className="form-input" defaultValue={client.plan_date || ''} onBlur={e => { if ((e.target.value || '') !== (client.plan_date || '')) onSave(e.target.value) }} /></label>
        <small className="opv2-muted">порожньо — відвантаження + {client.days ?? DEFAULT_CLIENT_DAYS} дн.</small>
      </div>
      <div className="opv2-sp-acts"><Button size="sm" variant="secondary" onClick={onLink}>Прив’язати з виписки</Button></div>
    </div>
  )
}

// ── Акордеон «Деталей» ──
function Acc({ id, open, onToggle, title, count, summary, children }) {
  return (
    <div className={`opv2-acc${open ? ' is-open' : ''}`} id={'opv2-' + id}>
      <button type="button" className="opv2-acc-h" aria-expanded={!!open} onClick={onToggle}>
        <span className="opv2-caret" aria-hidden="true"><i className={`ti ti-chevron-${open ? 'down' : 'right'}`} /></span>
        <b>{title}{count != null && count > 0 && <span className="opv2-count">{count}</span>}</b>
        <span className="opv2-acc-s">{summary}</span>
      </button>
      {open && <div className="opv2-acc-b">{children}</div>}
    </div>
  )
}

function CalcTable({ d, o, vatOn }) {
  const { pl, fact, hasFact, closed } = d
  const final = closed && d.fullyPaid
  const otherTypes = [...new Set(d.exps.filter(e => e.kind !== 'agent').map(e => EXPENSE_KINDS[e.kind] || e.name).filter(Boolean))]
  const rows = [
    ['revenue', 'Виручка', hasFact && d.clientGross ? `Факт: оплата клієнта ${n2(d.clientGross)} ₴${vatOn ? ' ÷ 1,2' : ''}. План: ${n2(d.plan.revenueGross)} ₴ з ПДВ.` : `Сума продажу ${n2(d.plan.revenueGross)} ₴ з ПДВ${vatOn ? ' ÷ 1,2' : ''}.`, 1],
    ['cost', 'Собівартість товару', hasFact && d.supplierGross ? `Факт: оплата постачальникам ${n2(d.supplierGross)} ₴ ÷ 1,2. План: закупка ${n0(d.plan.costGross)} ₴ з ПДВ.` : `Закупка ${n0(d.plan.costGross)} ₴ з ПДВ, без ПДВ.`, -1],
    ['gross', 'Валовий прибуток', `Виручка − собівартість. Валова маржа ${pc(pl.revenue > 0 ? pl.gross / pl.revenue : null)}.`, 1, 'sub'],
    ['other', 'Інші витрати', otherTypes.length ? otherTypes.join(', ') + '.' : 'Доставка, монтаж, комісії — додаються в «Інших витратах».', -1],
    ['tax', 'Податок 18%', vatOn ? '18% від валового прибутку.' : 'Неплатник ПДВ — не нараховується.', -1],
    ['agent', 'Агентські', o.agent_commission_pct ? `${o.agent_commission_pct}% агента${d.decisionNotes.length ? `; протокол: ${d.decisionNotes.join(', ')}` : ''}.` : d.decisionNotes.length ? `Протокол: ${d.decisionNotes.join(', ')}.` : 'Не вказано.', -1],
    ['net', 'Чистий прибуток', `Валовий − інші витрати − податок − агентські.${d.planFrom === 'snapshot' ? ` План — зі знімка ${dm(d.snap?.taken_at?.slice(0, 10))}.` : ''}`, 1, 'net'],
  ]
  return (
    <div className="opv2-tbl"><table>
      <thead><tr><th>{vatOn ? 'Без ПДВ' : 'Сума'}</th><th className="r">План</th>{hasFact && <><th className="r">Факт · за оплатами</th><th className="r">Різниця</th></>}</tr></thead>
      <tbody>{rows.map(([k, label, tip, sgn, kind]) => {
        const p = sgn * pl[k], f = sgn * fact[k], diff = f - p
        return (
          <tr key={k} className={kind ? `is-${kind}` : ''}>
            <th scope="row">{label}<InfoTip label={label}>{tip}</InfoTip></th>
            <td className={`r ${p < 0 ? 'is-neg' : kind === 'net' ? 'is-pos' : ''}`}>{n0(p)}</td>
            {hasFact && <><td className={`r ${f < 0 ? 'is-neg' : ''}`}>{n0(f)}</td>
              <td className={`r ${Math.abs(diff) < 0.5 || !final ? 'is-muted' : diff > 0 ? 'is-pos' : 'is-neg'}`}>{Math.abs(diff) < 0.5 ? '—' : sg0(diff)}</td></>}
          </tr>
        )
      })}</tbody>
    </table></div>
  )
}

function PaysList({ o, d, hl, cands, userId, onChanged }) {
  const toast = useToast()
  const [share, setShare] = useState(null)   // { p, value }
  const unlink = async (p) => {
    try {
      if (p.orderLinkId) { const { error } = await supabase.from('order_transactions').delete().eq('id', p.orderLinkId); if (error) throw error }
      else if (p.direct) await unlinkOrderPayment(o)
      else return toast('Цю оплату прив’язано до документа — відв’яжіть її в документі або в «Банку».', { type: 'error' })
      onChanged()
    } catch (e) { toast(e.message, { type: 'error' }) }
  }
  const confirm = async (p) => {
    const { error } = p.direct
      ? await qc('orders').update({ paid_confirmed_at: new Date().toISOString() }).eq('id', o.id)
      : await supabase.from('order_transactions').update({ confirmed_at: new Date().toISOString(), confirmed_by: userId || null }).eq('id', p.orderLinkId)
    if (error) return toast(/confirmed|paid_confirmed/.test(error.message) ? 'Потрібна міграція 106' : error.message, { type: 'error' })
    toast('Позначено як оплату клієнта'); onChanged()
  }
  const saveShare = async () => {
    const v = Number(String(share.value).replace(',', '.').replace(/\s/g, ''))
    if (!(v > 0) || v > share.p.txTotal + 0.01) return toast(`Частка має бути від 0 до ${n2(share.p.txTotal)} ₴`, { type: 'error' })
    const { error } = await supabase.from('order_transactions').update({ amount: v }).eq('id', share.p.orderLinkId)
    if (error) return toast(error.message, { type: 'error' })
    setShare(null); onChanged()
  }
  const linkClient = async (t) => {
    const { error } = await qc('orders').update({ paid_transaction_id: t.id }).eq('id', o.id)
    if (error) return toast(error.message, { type: 'error' })
    onChanged()
  }
  const suspect = (p) => p.sign > 0 && !p.confirmed && ((o.client_id && p.contractorId && p.contractorId !== o.client_id) || SUSPECT.test(`${p.purpose} ${p.description}`))
  return (
    <>
      {cands.length > 0 && <div className="opv2-cands">{cands.map(t => (
        <div key={t.id}><span>Знайдено оплату від клієнта: <b>{n2(Math.abs(t.amount))} ₴</b> · {dmy(t.date)}</span><Button size="sm" variant="brand" onClick={() => linkClient(t)}>Прив’язати</Button></div>
      ))}</div>}
      {d.payments.length === 0 ? <p className="opv2-muted opv2-pad">Оплат ще немає.</p> : (
        <ul className="opv2-pays">{d.payments.map(p => (
          <li key={p.txId} className={hl === p.txId ? 'is-hl' : ''}>
            <span className="opv2-p-d">{dm(p.date)}</span>
            <span className="opv2-p-n"><b>{p.counterparty}</b>{p.purpose && <small> · {p.purpose}</small>}
              {suspect(p) && <span className="opv2-p-warn">інший платник або призначення — перевірте <button type="button" onClick={() => confirm(p)}>Це оплата клієнта</button> <button type="button" onClick={() => unlink(p)}>Відв’язати</button></span>}</span>
            <span className="opv2-p-s">{p.src}</span>
            <b className={`opv2-p-a ${p.sign > 0 ? 'is-pos' : 'is-neg'}`}>{sg2(p.sign * p.amount)}</b>
            <Menu trigger={<Button variant="ghost" size="sm" iconOnly icon="ti-dots" aria-label="Дії з оплатою" />} items={[
              { label: 'Відв’язати', icon: 'ti-unlink', confirm: { title: 'Відв’язати оплату від замовлення?', text: 'Транзакція лишиться в «Банку».', confirmLabel: 'Відв’язати' }, onClick: () => unlink(p) },
              ...(p.orderLinkId ? [{ label: 'Змінити частку', icon: 'ti-percentage', onClick: () => setShare({ p, value: String(p.amount) }) }] : []),
            ]} />
          </li>
        ))}</ul>
      )}
      {share && <Modal open onClose={() => setShare(null)} title="Частка оплати до замовлення"
        footer={<><Button variant="secondary" onClick={() => setShare(null)}>Скасувати</Button><Button variant="brand" onClick={saveShare}>Зберегти</Button></>}>
        <p className="opv2-muted">{share.p.counterparty} · {dmy(share.p.date)} · платіж {n2(share.p.txTotal)} ₴</p>
        <label className="opv2-f"><span>Частка, ₴</span><input className="form-input is-num" inputMode="decimal" autoFocus value={share.value} onChange={e => setShare(s => ({ ...s, value: e.target.value }))} /></label>
      </Modal>}
    </>
  )
}

function ExpList({ d, onAdd, onChanged }) {
  return (
    <>
      {d.exps.length > 0 && <ul className="opv2-exps">{d.exps.map(e => (
        <li key={e.id}>
          <span><b>{EXPENSE_KINDS[e.kind] || e.name}</b>{e.kind && e.name && e.name !== EXPENSE_KINDS[e.kind] ? <small> · {e.name}</small> : ''}</span>
          <small>{e.expense_date ? dmy(e.expense_date) : ''}</small>
          <span className={`opv2-chip ${e.transaction_id ? 'is-ok' : ''}`}>{e.transaction_id ? 'оплачено' : 'заплановано'}</span>
          <b className="is-neg">−{n2(e.amount)}{e.vat_included ? <small> з ПДВ</small> : ''}</b>
          <Button variant="ghost" size="sm" iconOnly icon="ti-x" aria-label={`Видалити витрату «${e.name}»`} onClick={async () => { await supabase.from('order_expenses').delete().eq('id', e.id); onChanged() }} />
        </li>
      ))}</ul>}
      <div className="opv2-addchips">{['delivery', 'install', 'bank_fee', 'agent'].map(k => <button key={k} type="button" className="opv2-dashed" onClick={() => onAdd(k)}>+ {EXPENSE_KINDS[k]}</button>)}</div>
    </>
  )
}

// ── 7.1 Інша витрата: чипи, поля, попередній перегляд ──
function ExpenseModal({ o, kind: k0, pl, vatOn, userId, onClose, onSaved }) {
  const [f, setF] = useState({ kind: k0, name: EXPENSE_KINDS[k0], amount: '', vat: false, contractor_id: null, cname: '', date: todayKyiv() })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const amount = Number(String(f.amount).replace(',', '.').replace(/\s/g, '')) || 0
  const net = f.vat && vatOn ? amount / 1.2 : amount
  const after = pl.net - net
  const mg = (x) => pl.revenue > 0 ? x / pl.revenue : null
  const save = async () => {
    if (!(amount > 0)) return setErr('Вкажіть суму')
    setBusy(true)
    const { error } = await supabase.from('order_expenses').insert({ order_id: o.id, name: f.name?.trim() || EXPENSE_KINDS[f.kind], amount, created_by: userId || null,
      kind: f.kind, vat_included: f.vat, contractor_id: f.contractor_id, expense_date: f.date || null })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Інша витрата по замовленню"
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button variant="brand" loading={busy} onClick={save}>Додати витрату</Button></>}>
      <div className="opv2-form">
        <div className="opv2-kinds" role="group" aria-label="Тип витрати">{['delivery', 'install', 'bank_fee', 'agent', 'other'].map(k => (
          <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => setF(s => ({ ...s, kind: k, name: s.name === EXPENSE_KINDS[s.kind] || !s.name ? (k === 'other' ? '' : EXPENSE_KINDS[k]) : s.name }))}>{k === 'other' ? 'Інше' : EXPENSE_KINDS[k]}</button>))}</div>
        <div className="opv2-grid2">
          <label className="opv2-f"><span>Назва</span><input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} /></label>
          <label className="opv2-f"><span>Контрагент</span><ContractorSelect value={f.cname} placeholder="необов’язково" onChange={v => setF(s => ({ ...s, cname: v, contractor_id: null }))} onContractorSelect={c => setF(s => ({ ...s, cname: c.name, contractor_id: c.id }))} /></label>
          <label className="opv2-f"><span>Сума</span><span className="opv2-amtvat"><input className="form-input is-num" inputMode="decimal" autoFocus value={f.amount} onChange={e => set('amount', e.target.value)} />
            <span className="opv2-seg" role="group" aria-label="ПДВ"><button type="button" aria-pressed={f.vat} onClick={() => set('vat', true)}>з ПДВ</button><button type="button" aria-pressed={!f.vat} onClick={() => set('vat', false)}>без ПДВ</button></span></span></label>
          <label className="opv2-f"><span>Дата</span><input type="date" className="form-input" value={f.date} onChange={e => set('date', e.target.value)} /></label>
        </div>
        {amount > 0 && <p className="opv2-preview">Чистий прибуток: {n0(pl.net)} → <b>{n0(after)} ₴</b> · маржа {pc(mg(pl.net))} → {pc(mg(after))}</p>}
        {err && <p className="is-neg">{err}</p>}
      </div>
    </Modal>
  )
}

// ── 7.2 Оплата з виписки: чипи-фільтри, радіо, частка, примітка ──
function LinkTxModal({ o, preset = {}, supplierIds, clientDue, supTargets, userId, onClose, onDone }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  // з рядка / пункту «Що зробити» — фільтри під цей рядок; із загальної кнопки — без фільтрів
  const [fCli, setFCli] = useState(preset.dir === 'income')
  const [fSup, setFSup] = useState(preset.dir === 'expense')
  const [fNear, setFNear] = useState(!!preset.target)
  const sups = preset.supplierIds?.length ? preset.supplierIds : supplierIds
  const [rows, setRows] = useState(null)
  const [pick, setPick] = useState(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const targets = useMemo(() => {
    const t = []
    if (preset.target) t.push({ dir: preset.dir, ...preset.target })
    else { if (clientDue > 0.5) t.push({ dir: 'income', amount: clientDue }); supTargets.forEach(x => t.push({ dir: 'expense', ...x })) }
    return t
  }, [])
  const nearOf = (tx) => {
    const a = Math.abs(Number(tx.amount) || 0), dir = tx.amount > 0 ? 'income' : 'expense'
    return targets.filter(x => x.dir === dir && (!x.supplierId || x.supplierId === tx.contractor_id) && Math.abs(a - x.amount) <= 5000).sort((x, y) => Math.abs(a - x.amount) - Math.abs(a - y.amount))[0] || null
  }
  useEffect(() => {
    let alive = true
    const id = setTimeout(async () => {
      let query = qc('bank_transactions').select('id, date, counterparty, description, amount, edrpou, contractor_id').eq('is_ignored', false).order('date', { ascending: false }).limit(400)
      if (fCli && !fSup) { query = query.gt('amount', 0); if (o.client_id) query = query.eq('contractor_id', o.client_id) }
      else if (fSup && !fCli) { query = query.lt('amount', 0); if (sups.length) query = query.in('contractor_id', sups) }
      else if (fCli && fSup) { const ids = [o.client_id, ...sups].filter(Boolean); if (ids.length) query = query.in('contractor_id', ids) }
      const term = q.trim()
      if (term) {
        const num = Number(term.replace(/\s/g, '').replace(',', '.'))
        query = isFinite(num) && num > 0 ? query.or(`amount.eq.${num},amount.eq.${-num}`) : query.or(`counterparty.ilike.%${term}%,description.ilike.%${term}%,edrpou.ilike.%${term}%`)
      }
      const { data } = await query
      let list = data || []
      // вільний (не прив'язаний) залишок транзакції
      const ids = list.map(t => t.id)
      const used = {}, mine = new Set(), direct = new Set()
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200)
        const [{ data: ot }, { data: po }] = await Promise.all([
          supabase.from('order_transactions').select('order_id, transaction_id, amount').in('transaction_id', part),
          supabase.from('orders').select('id, paid_transaction_id').in('paid_transaction_id', part),
        ])
        ;(ot || []).forEach(x => { used[x.transaction_id] = (used[x.transaction_id] || 0) + Math.abs(Number(x.amount) || 0); if (x.order_id === o.id) mine.add(x.transaction_id) })
        ;(po || []).forEach(x => direct.add(x.paid_transaction_id))
      }
      list = list.map(t => ({ ...t, free: direct.has(t.id) || mine.has(t.id) ? 0 : Math.round((Math.abs(Number(t.amount) || 0) - (used[t.id] || 0)) * 100) / 100 })).filter(t => t.free > 0.5)
      if (fNear && targets.length) list = list.filter(nearOf)
      if (alive) setRows(list.slice(0, 60))
    }, q ? 300 : 0)
    return () => { alive = false; clearTimeout(id) }
  }, [q, fCli, fSup, fNear])
  const choose = (t) => { setPick(t); const nt = nearOf(t); setAmount(String(nt ? Math.min(t.free, Math.round(nt.amount * 100) / 100) : t.free)) }
  const link = async () => {
    const v = Number(String(amount).replace(',', '.').replace(/\s/g, ''))
    if (!(v > 0)) return toast('Вкажіть частку', { type: 'error' })
    if (v > pick.free + 0.01) return toast(`Вільно лише ${n2(pick.free)} ₴ цієї транзакції`, { type: 'error' })
    setBusy(true)
    const { error } = await supabase.from('order_transactions').insert({ order_id: o.id, transaction_id: pick.id, kind: pick.amount > 0 ? 'income' : 'expense', amount: v, note: note.trim() || null, created_by: userId || null })
    setBusy(false)
    if (error) return toast(error.message, { type: 'error' })
    toast('Оплату прив’язано'); onDone()
  }
  const Chip = ({ on, set, children }) => <button type="button" className={`opv2-fchip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => set(!on)}>{on && '✓ '}{children}</button>
  return (
    <Modal open onClose={onClose} size="lg" title="Оплата з виписки"
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button variant="brand" loading={busy} disabled={!pick} onClick={link}>Прив’язати</Button></>}>
      <div className="opv2-form">
        <input className="form-input" type="search" aria-label="Пошук транзакції" placeholder="Пошук: контрагент, призначення, сума" value={q} onChange={e => setQ(e.target.value)} />
        <div className="opv2-fchips">
          {o.client_id && <Chip on={fCli} set={setFCli}>Лише від клієнта</Chip>}
          {sups.length > 0 && <Chip on={fSup} set={setFSup}>Лише постачальники замовлення</Chip>}
          {targets.length > 0 && <Chip on={fNear} set={setFNear}>Сума ±5 000 від «до оплати»</Chip>}
        </div>
        {rows == null ? <p className="opv2-muted">Шукаю…</p> : rows.length === 0 ? <p className="opv2-muted">{fNear ? `Платежів із сумою ±5 000 від «до оплати» (${targets.map(t => n0(t.amount)).join(' / ')} ₴) не знайдено. Вимкніть фільтр суми.` : 'Транзакцій не знайдено.'}</p> : (
          <ul className="opv2-txs" role="radiogroup" aria-label="Транзакції">{rows.map(t => (
            <li key={t.id} className={pick?.id === t.id ? 'is-on' : ''}>
              <label>
                <input type="radio" name="opv2-tx" checked={pick?.id === t.id} onChange={() => choose(t)} />
                <span className="opv2-p-d">{dm(t.date)}</span>
                <span className="opv2-p-n"><b>{t.counterparty || '—'}</b><small>{t.description || ''}</small></span>
                <b className={`opv2-p-a ${t.amount > 0 ? 'is-pos' : 'is-neg'}`}>{sg2(t.amount)}{t.free < Math.abs(t.amount) - 0.5 && <small> вільно {n2(t.free)}</small>}{nearOf(t) && <small className="is-pos"> ≈ до оплати {n0(nearOf(t).amount)}</small>}</b>
              </label>
            </li>
          ))}</ul>
        )}
        {pick && <div className="opv2-grid2 opv2-txfoot">
          <label className="opv2-f"><span>Частка до замовлення, ₴</span><input className="form-input is-num" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label className="opv2-f"><span>Примітка</span><input className="form-input" placeholder="необов’язково" value={note} onChange={e => setNote(e.target.value)} /></label>
        </div>}
      </div>
    </Modal>
  )
}

// ── 7.3 Прив’язати знайдені оплати (через прихідні й за сумою) ──
function FoundModal({ found, userId, onClose, onDone }) {
  const toast = useToast()
  const key = (p) => p.txId + '|' + (p.docId || 'amt')
  const [on, setOn] = useState(() => new Set(found.map(key)))
  const [busy, setBusy] = useState(false)
  const sel = found.filter(p => on.has(key(p)))
  const link = async () => {
    setBusy(true)
    try { for (const p of sel) await linkSupplierDocPay(p, userId); toast(`Прив’язано ${sel.length}`); onDone() }
    catch (e) { toast('Не вдалося: ' + e.message, { type: 'error' }); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Прив’язати знайдені оплати"
      footer={<><span className="opv2-muted opv2-total">разом {n2(sel.reduce((s, p) => s + p.amount, 0))} ₴</span><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button variant="brand" loading={busy} disabled={!sel.length} onClick={link}>Прив’язати вибрані ({sel.length})</Button></>}>
      <p className="opv2-muted">Знайдено через прихідні накладні (товар із них пішов у це замовлення) і за сумою планового платежу.</p>
      <ul className="opv2-found">{found.map(p => (
        <li key={key(p)}>
          <label>
            <input type="checkbox" checked={on.has(key(p))} onChange={e => setOn(s => { const n = new Set(s); e.target.checked ? n.add(key(p)) : n.delete(key(p)); return n })} />
            <span className="opv2-p-n"><b>{p.doc?.contractors?.name || p.tx?.counterparty || 'Постачальник'}</b> <small>· {dm(p.tx?.date)}</small>
              <small>{p.byAmount ? 'знайдено за сумою' : `прихідна № ${p.doc?.doc_number || '—'} · частка ${Math.round(p.share * 100)}%`}</small></span>
            <b className="opv2-p-a is-neg">−{n2(p.amount)}</b>
          </label>
        </li>
      ))}</ul>
    </Modal>
  )
}

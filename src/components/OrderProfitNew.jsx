// Вкладка «Прибутковість» картки замовлення — новий інтерфейс (ТЗ «Прибутковість у замовленні», 23.10.2026;
// макет OrderProfit). Розрахунок — lib/orderProfit (план — computeOrderPlan, графік — buildOrderForecasts,
// факт — за оплатами). Прив'язка оплат — той самий TxPicker / прив'язка «оплачено клієнтом», що й раніше.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { useCompany } from '../lib/company'
import { loadOrderProfit, EXPENSE_KINDS } from '../lib/orderProfit'
import { loadPaymentPlan, savePaymentPlanEntry, DEFAULT_CLIENT_DAYS } from '../lib/forecast'
import { paymentCandidates, unlinkOrderPayment } from '../lib/orderPayments'
import { qc } from '../lib/companyScope'
import { todayKyiv } from '../lib/dates'
import { formatAmount } from '../utils/format'
import { Button, Modal, Callout, TableSkeleton, EmptyState, Menu, useToast, InfoTip } from './ui'
import ContractorSelect from './ui/ContractorSelect'
import { TxPicker } from './OrderFinanceTab'
import './OrderProfitNew.css'

const n0 = (v) => formatAmount(v, { decimals: 0 })
const n2 = (v) => formatAmount(v)
const sg2 = (v) => formatAmount(v, { sign: 'always' })
const dm = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : '—'
const dmy = (s) => s ? s.slice(0, 10).split('-').reverse().join('.') : '—'
const pc = (f) => f == null ? '—' : `${(f * 100).toFixed(1).replace('.', ',')}%`

export default function OrderProfitNew({ o, onOrderChange }) {
  const { user } = useUser()
  const { active } = useCompany()
  const toast = useToast()
  const vatOn = active?.is_vat_payer !== false
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [exp, setExp] = useState(null)       // форма витрати { kind }
  const [picker, setPicker] = useState(null) // 'income' | 'expense'
  const [cands, setCands] = useState([])
  const [pp, setPp] = useState([])           // графік: ship / client
  const load = () => {
    setErr(null)
    loadOrderProfit(o, { vatOn }).then(setD).catch(e => setErr(e.message))
    loadPaymentPlan(o.id).then(setPp).catch(() => setPp([]))
    if (!o.paid_transaction_id && o.client_id) paymentCandidates(o).then(setCands).catch(() => setCands([]))
  }
  useEffect(load, [o.id, o.total, o.paid_transaction_id, o.status, o.agent_commission_pct, vatOn])
  const changed = () => { load(); onOrderChange?.() }

  if (err) return <Callout tone="danger" title="Не вдалося порахувати прибутковість." text={err} />
  if (!d) return <TableSkeleton rows={8} cols={4} label="Рахую прибутковість…" />
  if (!d.itemsCount) return <EmptyState icon="ti-calculator" title="Додайте товари, щоб побачити прибутковість" text="План рахується з позицій замовлення." action={{ label: 'До товарів', onClick: () => document.getElementById('ocn-tab-items')?.click() }} />

  const { pl, fact, hasFact, closed } = d
  const marg = (x, rev) => rev > 0 ? x / rev : null
  const final = closed && d.fullyPaid
  // рядки таблиці: [ключ, назва, підпис, знак (1 — дохід, −1 — витрата), підсумок?]
  const otherTypes = [...new Set(d.exps.filter(e => e.kind !== 'agent').map(e => EXPENSE_KINDS[e.kind] || e.name).filter(Boolean))]
  const rows = [
    ['revenue', 'Виручка', hasFact && d.clientGross ? `оплата клієнта ${n2(d.clientGross)} ₴${vatOn ? ' ÷ 1,2' : ''}` : `з ${n2(d.plan.revenueGross)} ₴ з ПДВ`, 1],
    ['cost', 'Собівартість товару', hasFact && d.supplierGross ? `оплата постачальнику ${n2(d.supplierGross)} ₴ ÷ 1,2` : `закупка з ПДВ ${n0(d.plan.costGross)} ₴`, -1],
    ['gross', 'Валовий прибуток', `валова маржа ${pc(marg(pl.gross, pl.revenue))}`, 1, 'sub'],
    ['other', 'Інші витрати', otherTypes.length ? otherTypes.join(', ').toLowerCase() : 'доставка, монтаж, комісії', -1],
    ['tax', 'Податок 18%', vatOn ? 'від валового прибутку' : 'неплатник ПДВ — не нараховується', -1],
    ['agent', 'Агентські', o.agent_commission_pct ? `${o.agent_commission_pct}% агента${d.decisionNotes.length ? ` · протокол: ${d.decisionNotes.join(', ')}` : ''}` : d.decisionNotes.length ? `протокол: ${d.decisionNotes.join(', ')}` : 'не вказано', -1],
    ['net', 'Чистий прибуток', hasFact && final ? `${pc(marg(fact.net, fact.revenue))} · план ${pc(marg(pl.net, pl.revenue))}` : `чиста маржа ${pc(marg(pl.net, pl.revenue))}`, 1, 'net'],
  ]
  const ship = pp.find(x => x.kind === 'ship') || {}, client = pp.find(x => x.kind === 'client') || {}
  const savePlan = async (kind, patch) => {
    const cur = kind === 'ship' ? ship : client
    try { await savePaymentPlanEntry(o.id, { kind, supplierId: null, planDate: 'planDate' in patch ? patch.planDate : cur.plan_date, days: 'days' in patch ? patch.days : cur.days }); load() }
    catch (e) { toast(e.message, { type: 'error' }) }
  }
  const unlink = async (p) => {
    try {
      if (p.orderLinkId) await supabase.from('order_transactions').delete().eq('id', p.orderLinkId)
      else if (p.txId === o.paid_transaction_id) await unlinkOrderPayment(o)
      else return toast('Цю оплату прив\'язано до документа — відв\'яжіть її в документі або в «Банку».', { type: 'error' })
      changed()
    } catch (e) { toast(e.message, { type: 'error' }) }
  }
  const linkClient = async (t) => {
    const { error } = await qc('orders').update({ paid_transaction_id: t.id }).eq('id', o.id)
    if (error) return toast(error.message, { type: 'error' })
    changed()
  }
  const verdictTone = !d.verdict ? 'is-info' : d.verdict.loss ? 'is-bad' : d.verdict.acc >= 95 && d.verdict.acc <= 105 ? 'is-ok' : d.verdict.acc >= 85 ? 'is-fair' : 'is-bad'

  return (
    <div className="opn">
      {/* ── Скільки заробимо ── */}
      <section className="opn-card" aria-label="Скільки заробимо">
        <div className="opn-top">
          <div className="opn-cell"><span>План · заробимо</span><b className={pl.net < 0 ? 'is-neg' : 'is-pos'}>{n0(pl.net)} ₴</b><small>{pc(marg(pl.net, pl.revenue))} чистої маржі</small></div>
          <div className="opn-cell"><span>Факт · заробили</span>
            {hasFact ? <><b className={fact.net < 0 ? 'is-neg' : ''}>{n0(fact.net)} ₴</b>
              <small className={final ? (fact.net < pl.net ? 'is-neg' : 'is-pos') : ''}>{final ? `${formatAmount(fact.net - pl.net, { decimals: 0, sign: 'always' })} ₴ від плану · ${pc(marg(fact.net, fact.revenue))} маржі` : 'попередньо — оплачено ще не все'}</small>
              {!d.fullyPaid && <span className="opn-paidbar">оплачено клієнтом {Math.round((d.clientPct || 0) * 100)}%, постачальнику {Math.round((d.supplierPct || 0) * 100)}%</span>}</>
              : <><b className="is-muted">—</b><small>з'явиться після перших оплат</small></>}
          </div>
          <div className={`opn-cell opn-verdict ${verdictTone}`}>
            {d.verdict ? <>
              <b>{d.verdict.loss ? 'Замовлення збиткове' : d.verdict.acc >= 95 && d.verdict.acc <= 105 ? `Прогноз справдився · ${d.verdict.acc}%` : `Справдилось ${d.verdict.acc}% прогнозу`}</b>
              <p>{d.verdict.worst ? `${d.verdict.worst.d < 0 ? 'Прибуток зменшила' : 'Прибуток збільшила'} стаття «${d.verdict.worst.l}»: ${formatAmount(d.verdict.worst.d, { decimals: 0, sign: 'always' })} ₴ проти плану` : 'Усі статті збіглися з планом'}{d.verdict.delay ? `, а клієнт оплатив на ${d.verdict.delay} дн. пізніше` : ''}.{d.planFrom === 'live' ? ' Знімок прогнозу не зберігся — порівняння з поточним планом.' : ''}</p>
            </> : d.snap ? <>
              <b>Прогноз збережено {dm(d.snap.taken_at?.slice(0, 10))}<InfoTip label="Знімок прогнозу">{closed ? 'Висновок з’явиться, коли клієнт і постачальники оплатять усе.' : 'Коли замовлення закриється, тут з’явиться порівняння плану з фактом — як у «Точності прогнозу».'}</InfoTip></b>
            </> : <>
              <b>Прогноз ще не збережено</b>
              <p>Знімок плану зберігається, коли замовлення позначають «в прогноз» у реєстрі. Без нього після закриття порівняння буде з поточним планом.</p>
            </>}
          </div>
        </div>
        <div className="opn-tbl"><table>
          <thead><tr><th>Без ПДВ</th><th className="r">План{d.planFrom === 'snapshot' ? ` · від ${dm(d.snap.taken_at?.slice(0, 10))}` : ''}</th><th className="r">Факт · за оплатами<InfoTip label="Факт" placement="left">Факт рахується за рухом грошей: прив’язані оплати клієнта й постачальників, без ПДВ.</InfoTip></th><th className="r">Різниця</th></tr></thead>
          <tbody>{rows.map(([k, label, hint, s, kind]) => {
            const p = s * pl[k], f = s * fact[k], diff = hasFact ? (f - p) : null
            const better = diff == null ? null : diff > 0.5 ? true : diff < -0.5 ? false : null
            return (
              <tr key={k} className={kind ? `is-${kind}` : ''}>
                <th scope="row"><b>{label}</b>{hint && <small> · {hint}</small>}</th>
                <td className={`r ${p < 0 ? 'is-neg' : kind === 'net' ? 'is-pos' : ''}`}>{n0(p)}</td>
                <td className={`r ${!hasFact ? 'is-muted' : f < 0 ? 'is-neg' : ''}`}>{hasFact ? n0(f) : '—'}</td>
                <td className={`r ${diff == null || Math.abs(diff) < 0.5 ? 'is-muted' : !final ? 'is-muted' : better ? 'is-pos' : 'is-neg'}`}>{diff == null ? '' : Math.abs(diff) < 0.5 ? '—' : formatAmount(diff, { decimals: 0, sign: 'always' })}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
        <div className="opn-chips">
          <span>+ Інша витрата по замовленню:</span>
          {['delivery', 'install', 'bank_fee', 'agent'].map(k => <button key={k} type="button" className="opn-chip" onClick={() => setExp({ kind: k })}>{EXPENSE_KINDS[k]}</button>)}
        </div>
        {d.exps.length > 0 && (
          <ul className="opn-exps">{d.exps.map(e => (
            <li key={e.id}><span>{EXPENSE_KINDS[e.kind] || e.name}{e.kind && e.name && e.name !== EXPENSE_KINDS[e.kind] ? ` · ${e.name}` : ''}{e.expense_date ? ` · ${dmy(e.expense_date)}` : ''}{e.transaction_id ? ' · оплачено' : ''}</span>
              <b>{n2(e.amount)} ₴ {e.vat_included ? <small>з ПДВ</small> : <small>без ПДВ</small>}</b>
              <Button variant="ghost" size="sm" iconOnly icon="ti-x" aria-label={`Видалити витрату «${e.name}»`} onClick={async () => { await supabase.from('order_expenses').delete().eq('id', e.id); changed() }} /></li>
          ))}</ul>
        )}
      </section>

      {/* ── Рух грошей ── */}
      <section className="opn-card" aria-label="Рух грошей по замовленню">
        <div className="opn-head">
          <h2>Рух грошей по замовленню</h2>
          <div className="opn-ship">
            <label>Відвантаження<InfoTip label="Дати графіка платежів">Дати не обов’язкові: якщо поле порожнє, дата ставиться за правилом і позначається «орієнтовно».</InfoTip> <input type="date" className="form-input" value={ship.plan_date || (d.shipEst ? '' : d.shipDate) || ''} onChange={e => savePlan('ship', { planDate: e.target.value || null })} aria-describedby="opn-ship-h" /></label>
            <label>· клієнт платить через <input type="number" className="form-input opn-days" defaultValue={client.days ?? ''} key={'d' + (client.days ?? '')} placeholder={String(DEFAULT_CLIENT_DAYS)} onBlur={e => { const v = e.target.value; if (String(v) !== String(client.days ?? '')) savePlan('client', { days: v === '' ? null : Number(v) }) }} /> дн.</label>
            {d.shipEst && !ship.plan_date && <small id="opn-ship-h">орієнтовно: {dmy(d.shipDate)}</small>}
          </div>
        </div>
        {d.cards.length === 0 ? <p className="opn-muted">Немає платежів у графіку.</p> : (
          <div className="opn-cards">{d.cards.map(c => (
            <div key={c.key} className={`opn-pay${d.minCard?.key === c.key ? ' is-low' : ''}`}>
              <div className="opn-pay-h"><b>{dm(c.date)}</b>
                <span className={`opn-st ${c.paid ? (c.late > 0 ? 'is-late' : 'is-ok') : c.part ? 'is-part' : c.overdue ? 'is-late' : ''}`}>
                  {c.paid ? `${c.kind === 'income' ? 'отримано' : 'оплачено'}${c.when ? ' ' + dm(c.when) : ''}${c.late > 0 ? ` · +${c.late} дн.` : ''}` : c.part ? `отримано ${n0(c.fact)} з ${n0(c.plan)}` : c.overdue ? 'прострочено' : c.estimated ? 'орієнтовно' : 'заплановано'}</span></div>
              <span className="opn-pay-l">{c.label}</span>
              <b className={`opn-pay-a ${c.amount < 0 ? 'is-neg' : 'is-pos'}`}>{sg2(c.amount)} ₴</b>
              {c.part && <span className="opn-prog"><i style={{ width: `${Math.min(100, (c.fact / c.plan) * 100)}%` }} /></span>}
              {c.warn === 'supplier' && <span className="opn-warn">Постачальника не вказано. <button type="button" onClick={() => document.getElementById('ocn-tab-items')?.click()}>Вказати</button></span>}
              {c.warn === 'client' && <span className="opn-warn">У виписці ще не знайдено. <button type="button" onClick={() => setPicker('income')}>Прив'язати вручну</button></span>}
              <small className="opn-after">по замовленню після цього: <b className={c.after < 0 ? 'is-neg' : 'is-pos'}>{sg2(c.after)} ₴</b></small>
            </div>
          ))}</div>
        )}
        <div className="opn-foot">
          {d.frozen ? <span className="opn-frozen">{d.closed
            ? `Гроші були заморожені з ${dm(d.frozen.from)} по ${dm(d.frozen.to)} — ${d.frozen.days ?? '…'} дн. по ${n0(d.frozen.amount)} ₴.`
            : `З ${dm(d.frozen.from)}${d.frozen.to ? ` по ${dm(d.frozen.to)}` : ''} замовлення тримає ${n0(d.frozen.amount)} ₴ ваших грошей${d.frozen.days != null ? ` — ${d.frozen.days} дн.` : ''}`}</span> : <span />}
          {d.flow && <span className={d.flow.ok ? '' : 'is-neg'}>чистий потік <b>{sg2(d.flow.planNet)} ₴</b> {d.flow.ok ? <span className="is-pos">✓ сходиться з планом</span> : `не сходиться з планом на ${n2(d.flow.planNet - d.flow.check)} ₴`} <InfoTip label="Чистий потік" placement="left">Податок 18% у грошовий потік не входить, тому потік = чистий прибуток + податок.</InfoTip></span>}
        </div>
      </section>

      {/* ── Оплати ── */}
      <section className="opn-card is-flush" aria-label="Оплати по замовленню">
        <div className="opn-head opn-pad">
          <h2>Оплати по замовленню</h2>
          <div className="opn-acts"><Button variant="secondary" icon="ti-link" onClick={() => setPicker('income')}>Прив'язати з виписки</Button><Button variant="primary" icon="ti-plus" onClick={() => setPicker('expense')}>Витрата</Button></div>
        </div>
        {!o.paid_transaction_id && cands.length > 0 && (
          <div className="opn-cands">{cands.map(t => (
            <div key={t.id}><span>Знайдено оплату від клієнта: <b>{n2(Math.abs(t.amount))} ₴</b> · {dmy(t.date)}</span><Button size="sm" variant="brand" onClick={() => linkClient(t)}>Прив'язати</Button></div>
          ))}</div>
        )}
        {d.payments.length === 0 ? <p className="opn-empty">Оплат ще немає.<InfoTip label="Пошук оплати">Оплату від {o.contractors?.name || 'клієнта'} шукаємо у виписці автоматично за контрагентом і сумою {n2(o.total)} ₴.{cands.length ? '' : ' Поки нічого не знайдено.'}</InfoTip></p> : (
          <ul className="opn-pays">{d.payments.map(p => (
            <li key={p.txId}>
              <span className="opn-p-d">{dmy(p.date)}</span>
              <span className="opn-p-n"><b>{p.counterparty}</b>{p.purpose && <small> · {p.purpose}</small>}</span>
              <span className="opn-p-s">{p.src}</span>
              <b className={`opn-p-a ${p.sign > 0 ? 'is-pos' : 'is-neg'}`}>{formatAmount(p.sign * p.amount, { sign: 'always' })}</b>
              <Menu trigger={<Button variant="ghost" size="sm" iconOnly icon="ti-dots" aria-label="Дії з оплатою" />} items={[
                { label: 'Відв\'язати від замовлення', icon: 'ti-unlink', confirm: { title: 'Відв\'язати оплату від замовлення?', text: 'Транзакція лишиться в «Банку».', confirmLabel: 'Відв\'язати' }, onClick: () => unlink(p) },
              ]} />
            </li>
          ))}</ul>
        )}
      </section>

      {exp && <ExpenseForm o={o} kind={exp.kind} userId={user?.id} onClose={() => setExp(null)} onSaved={() => { setExp(null); changed() }} />}
      {picker && <TxPicker kind={picker} orderId={o.id} clientId={o.client_id} userId={user?.id} onClose={() => setPicker(null)} onAdded={() => { setPicker(null); changed() }} />}
    </div>
  )
}

function ExpenseForm({ o, kind, userId, onClose, onSaved }) {
  const [f, setF] = useState({ kind, name: EXPENSE_KINDS[kind], amount: '', vat: false, contractor_id: null, cname: '', date: todayKyiv() })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = async () => {
    const amount = Number(String(f.amount).replace(',', '.').replace(/\s/g, ''))
    if (!(amount > 0)) return setErr('Вкажіть суму')
    setBusy(true)
    let { error } = await supabase.from('order_expenses').insert({ order_id: o.id, name: f.name?.trim() || EXPENSE_KINDS[kind], amount, created_by: userId || null,
      kind, vat_included: f.vat, contractor_id: f.contractor_id, expense_date: f.date || null })
    if (error && /kind|vat_included|contractor_id|expense_date/.test(error.message || '')) {   // до міграції 102
      ({ error } = await supabase.from('order_expenses').insert({ order_id: o.id, name: f.name?.trim() || EXPENSE_KINDS[kind], amount: f.vat ? Math.round(amount / 1.2 * 100) / 100 : amount, created_by: userId || null }))
    }
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }
  return (
    <Modal open title={`${EXPENSE_KINDS[kind]} — витрата по замовленню`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button variant="primary" icon="ti-check" loading={busy} onClick={save}>Додати</Button></>}>
      <div className="form-grid">
        <div className="form-group"><label>Сума, ₴ *</label><input className="form-input" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} autoFocus /></div>
        <div className="form-group"><label>ПДВ</label>
          <div className="opn-seg" role="group" aria-label="ПДВ"><button type="button" aria-pressed={!f.vat} onClick={() => set('vat', false)}>без ПДВ</button><button type="button" aria-pressed={f.vat} onClick={() => set('vat', true)}>з ПДВ</button></div></div>
        <div className="form-group full"><label>Що це<InfoTip label="Нова витрата">Витрата одразу зменшує план. У «Факт» вона потрапить, коли прив’яжете оплату з виписки («Оплати по замовленню» → «Витрата»).</InfoTip></label><input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} /></div>
        <div className="form-group"><label>Контрагент (необов'язково)</label><ContractorSelect value={f.cname} placeholder="Кому платимо" onChange={v => setF(s => ({ ...s, cname: v, contractor_id: null }))} onContractorSelect={c => setF(s => ({ ...s, cname: c.name, contractor_id: c.id }))} /></div>
        <div className="form-group"><label>Дата</label><input type="date" className="form-input" value={f.date} onChange={e => set('date', e.target.value)} /></div>
      </div>
      {err && <p className="is-neg">{err}</p>}
    </Modal>
  )
}

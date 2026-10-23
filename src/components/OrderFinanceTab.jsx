import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { paymentCandidates, clientPayments, unlinkOrderPayment } from '../lib/orderPayments'
import { useCompany } from '../lib/company'
import { computeOrderPlan } from '../lib/orderPlan'
import OrderPaymentPlan from './OrderPaymentPlan'
import { Modal, Button, Switch, TableSkeleton, useToast } from './ui'

// Вкладка «Прибутковість» картки замовлення: касовий, РЕАЛЬНИЙ прибуток за
// фактичними банківськими транзакціями. Оплата клієнта прив'язується тут (замість
// «Деталей») і одразу враховується як надходження. Плюс довільні надходження/витрати
// частками. Прибуток = надходження − витрати. Таблиця order_transactions (міграція 057).

const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''

export default function OrderFinanceTab({ o, onOrderChange }) {
  const { user } = useUser()
  const toast = useToast()
  const [items, setItems] = useState(null)
  const [missing, setMissing] = useState(false) // міграція 057 ще не застосована
  const [picker, setPicker] = useState(null)     // 'income' | 'expense'
  // Прив'язка оплати клієнта (orders.paid_transaction_id)
  const [payTx, setPayTx] = useState(null)        // прив'язана оплата
  const [cands, setCands] = useState(null)        // кандидати (контрагент+сума), коли не прив'язано
  const [pickList, setPickList] = useState(null)  // ручний вибір оплати клієнта
  const [payBusy, setPayBusy] = useState(false)

  const loadItems = async () => {
    const { data, error } = await supabase.from('order_transactions')
      .select('id, kind, amount, note, transaction_id, bank_transactions(date, counterparty, description, amount, direction)')
      .eq('order_id', o.id).order('created_at')
    if (error) { setMissing(/order_transactions/.test(error.message || '')); setItems([]); return }
    setMissing(false); setItems(data || [])
  }
  const loadPayment = async () => {
    if (o.paid_transaction_id) {
      const { data } = await supabase.from('bank_transactions')
        .select('id, date, amount, description, counterparty').eq('id', o.paid_transaction_id).single()
      setPayTx(data || null); setCands(null)
    } else {
      setPayTx(null)
      setCands(await paymentCandidates(o).catch(() => []))
    }
  }
  useEffect(() => { loadItems() }, [o.id])
  useEffect(() => { loadPayment() }, [o.id, o.paid_transaction_id, o.client_id, o.total])

  // Прив'язка/відв'язка оплати клієнта (оновлює замовлення → бейдж у шапці через onOrderChange)
  const linkPayment = async (txId) => {
    setPayBusy(true)
    const { error } = await qc('orders').update({ paid_transaction_id: txId }).eq('id', o.id)
    setPayBusy(false)
    if (error) { toast('Не вдалося прив\'язати оплату: ' + (/paid_transaction_id/.test(error.message || '') ? 'запустіть міграцію 056' : error.message), { type: 'error' }); return }
    setPickList(null); onOrderChange?.()
  }
  const unlinkPayment = async () => {
    setPayBusy(true)
    try { await unlinkOrderPayment(o) } catch (e) { toast('Не вдалося відв\'язати: ' + e.message, { type: 'error' }) }   // і більше не пропонувати її
    setPayBusy(false); onOrderChange?.()
  }
  const openPayPicker = async () => setPickList(await clientPayments(o).catch(() => []))

  const removeItem = async (it) => { await supabase.from('order_transactions').delete().eq('id', it.id); loadItems() }

  // Прив'язана оплата рахується як надходження (якщо не додана вручну окремим рядком)
  const itemTxIds = useMemo(() => new Set((items || []).map(i => i.transaction_id).filter(Boolean)), [items])
  const payAmount = payTx && !itemTxIds.has(payTx.id) ? Math.abs(Number(payTx.amount) || 0) : 0
  const itemsIncome = useMemo(() => (items || []).filter(i => i.kind === 'income').reduce((s, i) => s + (Number(i.amount) || 0), 0), [items])
  const expense = useMemo(() => (items || []).filter(i => i.kind === 'expense').reduce((s, i) => s + (Number(i.amount) || 0), 0), [items])
  const income = itemsIncome + payAmount
  const profit = income - expense
  const marginPct = income > 0 ? (profit / income * 100) : 0

  if (items == null) return <TableSkeleton rows={4} cols={4} label="Завантаження прибутковості…" />

  // Блок прив'язки оплати показуємо ЛИШЕ поки оплату не прив'язано (кандидати/ручний вибір).
  // Після прив'язки оплата живе єдиним рядком у «Надходженнях» (без дублювання).
  const PayRow = ({ t, recommended }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: recommended ? 'rgba(16,185,129,.06)' : 'var(--surface)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(Math.abs(t.amount))} грн <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· {d(t.date)}</span>
          {recommended && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>рекомендовано (сума збігається)</span>}</div>
        <div className="trunc" style={{ fontSize: 12, color: 'var(--text2)' }}>{t.description || t.counterparty || ''}</div>
      </div>
      <Button size="sm" variant="secondary" disabled={payBusy} onClick={() => linkPayment(t.id)}>Прив'язати</Button>
    </div>
  )
  const paymentBlock = (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <i className="ti ti-cash" style={{ fontSize: 18, color: 'var(--green)' }} />
        <h3 style={{ margin: 0, fontSize: 15 }}>Оплата від клієнта</h3>
      </div>
      {!o.client_id ? (
        <p style={{ color: 'var(--text3)', fontSize: 13, margin: 0 }}>Призначте клієнта в «Деталях», щоб підтягнути оплату.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cands === null ? <p style={{ color: 'var(--text3)', fontSize: 13, margin: 0 }}>Пошук оплат…</p>
            : cands.length ? (<><p style={{ fontSize: 13, color: 'var(--text2)', margin: 0 }}>Знайдено оплату від цього клієнта на суму замовлення:</p>{cands.map(t => <PayRow key={t.id} t={t} recommended />)}</>)
            : <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>Оплати з таким контрагентом і сумою не знайдено. Можна прив'язати вручну.</p>}
          {pickList === null ? (
            <span><Button size="sm" variant="secondary" icon="ti-link" onClick={openPayPicker}>Прив'язати вручну</Button></span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>Вхідні оплати клієнта:</span>
                <Button size="sm" variant="ghost" onClick={() => setPickList(null)}>Сховати</Button>
              </div>
              {pickList.length ? pickList.map(t => <PayRow key={t.id} t={t} recommended={cands?.some(c => c.id === t.id)} />)
                : <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>У клієнта немає вхідних банківських оплат.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )

  const Section = ({ kind, label, color, sum, pinned }) => {
    const list = (items || []).filter(i => i.kind === kind)
    const empty = list.length === 0 && !pinned
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, color }}>{label} <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 13 }}>· {fmt(sum)} грн</span></div>
          <Button variant="secondary" size="sm" icon="ti-plus" onClick={() => setPicker(kind)}>Додати транзакцію</Button>
        </div>
        {empty ? <p style={{ color: 'var(--text3)', fontSize: 13, margin: 0 }}>Немає транзакцій.</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table><thead><tr><th>Дата</th><th>Контрагент / опис</th><th style={{ textAlign: 'right' }}>Сума</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {pinned}
                {list.map(it => { const t = it.bank_transactions || {}; return (
                  <tr key={it.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(t.date)}</td>
                    <td><div className="trunc" style={{ maxWidth: 340 }}>{t.counterparty || t.description || (it.transaction_id ? '—' : 'транзакцію видалено')}{it.note ? <span style={{ color: 'var(--text3)' }}> · {it.note}</span> : null}</div></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 500 }}>{fmt(it.amount)}</td>
                    <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" iconOnly icon="ti-x" aria-label="Прибрати транзакцію із замовлення" onClick={() => removeItem(it)} /></td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // Прив'язана оплата клієнта — закріплений рядок у надходженнях (відв'язка = прибрати з прибутковості)
  const incomePinned = payAmount > 0 ? (
    <tr style={{ background: 'rgba(16,185,129,.06)' }}>
      <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(payTx.date)}</td>
      <td><div className="trunc" style={{ maxWidth: 340 }}><span style={{ color: 'var(--green)', fontWeight: 600 }}>Оплата клієнта</span> · {payTx.counterparty || payTx.description || '—'}</div></td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 500 }}>{fmt(payAmount)}</td>
      <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" iconOnly icon="ti-unlink" aria-label="Відв'язати оплату клієнта" title="Відв'язати оплату клієнта" disabled={payBusy} onClick={unlinkPayment} /></td>
    </tr>
  ) : null

  return (
    <div>
      {missing ? (
        <div className="card"><p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>Запустіть міграцію 057 (таблиця <code>order_transactions</code>), щоб прив'язувати надходження/витрати до замовлення. Оплату клієнта можна прив'язати вже зараз.</p></div>
      ) : null}

      {!o.paid_transaction_id && paymentBlock}

      <PlannedProfit o={o} userId={user?.id} />

      <OrderPaymentPlan o={o} />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-grid">
          <Kpi label="Надходження (факт)" value={income} color="var(--green)" />
          <Kpi label="Витрати (факт)" value={expense} color="var(--red)" />
          <Kpi label="Реальний прибуток" value={profit} color={profit >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Kpi label="Маржа" text={income > 0 ? `${marginPct.toFixed(1)}%` : '—'} color={profit >= 0 ? 'var(--green)' : 'var(--red)'} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text3)', margin: '10px 0 0' }}>
          Реальна (касова) прибутковість за фактичними грошима. Прив'язана оплата клієнта враховується автоматично; суми — як у виписці (з ПДВ), транзакцію можна додати часткою.
        </p>
      </div>

      {!missing && <>
        <Section kind="income" label="Надходження" color="var(--green)" sum={income} pinned={incomePinned} />
        <Section kind="expense" label="Витрати" color="var(--red)" sum={expense} />
      </>}

      {picker && <TxPicker kind={picker} orderId={o.id} clientId={o.client_id} userId={user?.id} onClose={() => setPicker(null)} onAdded={() => { setPicker(null); loadItems() }} />}
    </div>
  )
}

// ── Планова прибутковість: з позицій замовлення (закупка/продаж/ПДВ) + «Інші витрати» ──
// Розрахунок — єдиний computeOrderPlan (lib/orderPlan.js), той самий, що й у «Прогнозі».
function PlannedProfit({ o, userId }) {
  const { active } = useCompany()
  const toast = useToast()
  const vatOn = active?.is_vat_payer !== false
  const [rows, setRows] = useState(null)       // позиції замовлення
  const [exp, setExp] = useState([])           // інші витрати
  const [missing, setMissing] = useState(false)
  const [add, setAdd] = useState({ name: '', amount: '' })

  const loadExp = async () => {
    const { data, error } = await supabase.from('order_expenses').select('*').eq('order_id', o.id).order('created_at')
    if (error) { setMissing(/order_expenses/.test(error.message || '')); setExp([]); return }
    setMissing(false); setExp(data || [])
  }
  useEffect(() => {
    supabase.from('order_items').select('qty, unit_price, cost_price, vat_rate, cost_vat_rate, price_includes_vat, supplier_id').eq('order_id', o.id)
      .then(async ({ data, error }) => {
        if (error) ({ data } = await supabase.from('order_items').select('qty, unit_price, cost_price, vat_rate, price_includes_vat, supplier_id').eq('order_id', o.id)) // ґрейсфул до 067
        setRows(data || [])
      })
    loadExp()
  }, [o.id])

  const addExp = async () => {
    if (!(Number(add.amount) > 0)) return
    const { error } = await supabase.from('order_expenses').insert({ order_id: o.id, name: add.name.trim() || 'Інша витрата', amount: Number(add.amount), created_by: userId || null })
    if (error) { toast(/order_expenses/.test(error.message || '') ? 'Запустіть міграцію 065' : error.message, { type: 'error' }); return }
    setAdd({ name: '', amount: '' }); loadExp()
  }
  const rmExp = async (id) => { await supabase.from('order_expenses').delete().eq('id', id); loadExp() }

  const otherSum = exp.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const plan = computeOrderPlan(rows || [], { vatOn, agentPct: o.agent_commission_pct, otherExpenses: otherSum })
  const { revenueNet: revenue, costNet: cost, gross, tax, agent, net } = plan
  const marginPct = revenue > 0 ? (net / revenue * 100) : 0

  if (rows == null) return null

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <i className="ti ti-calculator" style={{ color: 'var(--blue)' }} />
        <h3 style={{ margin: 0, fontSize: 15 }}>Планова прибутковість</h3>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>з позицій замовлення (без ПДВ)</span>
      </div>
      <div className="kpi-grid">
        <Kpi label="Виручка" value={revenue} />
        <Kpi label="Собівартість" value={cost} color="var(--text2)" />
        <Kpi label="Валовий прибуток" value={gross} color={gross >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Kpi label={vatOn ? 'Податок 18%' : 'Податок (єдиний — не тут)'} value={-tax} color="var(--red)" />
        {agent > 0 && <Kpi label="Агентські" value={-agent} color="var(--red)" />}
        <Kpi label="Інші витрати" value={-otherSum} color="var(--red)" />
        <Kpi label="Чистий прибуток" value={net} color={net >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Kpi label="Маржа" text={revenue > 0 ? `${marginPct.toFixed(1)}%` : '—'} color={net >= 0 ? 'var(--green)' : 'var(--red)'} />
      </div>

      {/* Інші витрати */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Інші витрати</div>
        {missing && <p style={{ fontSize: 13, color: 'var(--amber,#b45309)' }}>Запустіть міграцію 065, щоб додавати інші витрати.</p>}
        {exp.map(e => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
            <span style={{ flex: 1 }}>{e.name}</span>
            <span style={{ fontFamily: 'monospace' }}>{fmt(e.amount)} грн</span>
            <Button size="sm" variant="ghost" iconOnly icon="ti-x" aria-label={`Видалити витрату «${e.name}»`} onClick={() => rmExp(e.id)} />
          </div>
        ))}
        {!missing && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <input className="form-input" placeholder="Назва (доставка, монтаж, комісія, податок…)" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} style={{ flex: '1 1 240px' }} />
            <input className="form-input" type="number" placeholder="Сума, грн" value={add.amount} onChange={e => setAdd(a => ({ ...a, amount: e.target.value }))} style={{ width: 140 }} onKeyDown={e => e.key === 'Enter' && addExp()} />
            <Button variant="secondary" icon="ti-plus" onClick={addExp}>Додати</Button>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text3)', margin: '10px 0 0' }}>
        Рахується автоматично з позицій замовлення: Виручка − Собівартість = Валовий прибуток. Чистий = валовий − податок 18% − агентські − інші витрати (додавайте сюди доставку, монтаж, комісії тощо).
      </p>
    </div>
  )
}

// Вибір банківської транзакції + сума частки
function TxPicker({ kind, orderId, clientId, userId, onClose, onAdded }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [chosen, setChosen] = useState(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [onlyClient, setOnlyClient] = useState(kind === 'income' && !!clientId)

  const search = async (term) => {
    let query = qc('bank_transactions')
      .select('id, date, counterparty, description, amount, direction, edrpou, contractor_id')
      .eq('is_ignored', false).order('date', { ascending: false }).limit(60)
    if (kind === 'income') query = query.eq('direction', 'Доходи')
    else if (kind === 'expense') query = query.eq('direction', 'Витрати')
    if (onlyClient && clientId) query = query.eq('contractor_id', clientId)
    const t = term.trim()
    if (t) query = query.or(`counterparty.ilike.%${t}%,description.ilike.%${t}%,edrpou.ilike.%${t}%`)
    const { data } = await query
    setRows(data || [])
  }
  useEffect(() => { const id = setTimeout(() => search(q), q ? 300 : 0); return () => clearTimeout(id) }, [q, onlyClient])

  // Скільки з транзакції вже розподілено на замовлення (частки + пряма прив'язка оплати клієнта) —
  // щоб одна транзакція не потрапила повною сумою в кілька замовлень (подвійний факт у прибутковості/прогнозі).
  const [allocated, setAllocated] = useState(0)
  const [pickErr, setPickErr] = useState(null)
  const pick = async (t) => {
    setPickErr(null)
    const total = Math.abs(Number(t.amount) || 0)
    const [{ data: shares }, { data: direct }] = await Promise.all([
      supabase.from('order_transactions').select('order_id, amount').eq('transaction_id', t.id),
      qc('orders').select('id').eq('paid_transaction_id', t.id),
    ])
    const used = (shares || []).reduce((s2, x) => s2 + (Number(x.amount) || 0), 0)
      + ((direct || []).some(o => o.id !== orderId && !(shares || []).some(x => x.order_id === o.id)) ? total : 0)
    const already = Math.round(used * 100) / 100
    setAllocated(already)
    setChosen(t)
    setAmount(String(Math.max(0, Math.round((total - already) * 100) / 100)))
  }

  const add = async () => {
    if (!chosen) return
    const total = Math.abs(Number(chosen.amount) || 0)
    const share = Math.abs(Number(amount) || 0)
    if (share <= 0) { setPickErr('Вкажіть суму частки'); return }
    if (share > total - allocated + 0.01) { setPickErr(`Перевищено суму транзакції: вільно ${fmt(Math.max(0, total - allocated))} грн (уже розподілено ${fmt(allocated)} грн на інші замовлення).`); return }
    setBusy(true)
    const { error } = await supabase.from('order_transactions').insert({
      order_id: orderId, transaction_id: chosen.id, kind,
      amount: Math.abs(Number(amount) || 0), note: note.trim() || null, created_by: userId || null,
    })
    setBusy(false)
    if (error) { toast('Не вдалося: ' + (/order_transactions/.test(error.message || '') ? 'запустіть міграцію 057' : error.message), { type: 'error' }); return }
    onAdded()
  }

  return (
    <Modal open onClose={onClose} size="lg" title={`Додати ${kind === 'income' ? 'надходження' : 'витрату'} з банку`}
      footer={chosen ? <>
        <Button variant="secondary" icon="ti-arrow-left" onClick={() => setChosen(null)}>Інша транзакція</Button>
        <Button variant="dark" loading={busy} onClick={add}>Додати</Button>
      </> : null}>
      <div>
        {!chosen ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <input className="form-input" type="search" aria-label="Пошук транзакції" placeholder="Пошук: контрагент / опис / ЄДРПОУ…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 240px' }} />
              {kind === 'income' && clientId && <Switch checked={onlyClient} onChange={setOnlyClient} label="Лише від клієнта" />}
            </div>
            {rows == null ? <TableSkeleton rows={5} cols={3} />
              : rows.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Транзакцій не знайдено.</p> : (
                <div className="tbl-wrap" style={{ border: 'none' }}>
                  <table><thead><tr><th>Дата</th><th>Контрагент / опис</th><th style={{ textAlign: 'right' }}>Сума</th></tr></thead>
                    <tbody>{rows.map(t => (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => pick(t)} tabIndex={0}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(t) } }}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(t.date)}</td>
                        <td><div className="trunc" style={{ maxWidth: 340 }}>{t.counterparty || t.description || '—'}</div></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(t.amount)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
          </>
        ) : (
          <>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
              <div>{d(chosen.date)} · <b>{chosen.counterparty || chosen.description || '—'}</b></div>
              <div style={{ color: 'var(--text3)', marginTop: 2 }}>Сума транзакції: {fmt(chosen.amount)} грн{allocated > 0.005 && <> · уже розподілено на замовлення: <b>{fmt(allocated)}</b> грн</>}</div>
            </div>
            {pickErr && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{pickErr}</div>}
            <div className="form-grid">
              <div className="form-group"><label className="form-label" htmlFor="tx-share">Сума частки на замовлення, грн</label>
                <input id="tx-share" className="form-input" type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-describedby="tx-share-hint" />
                <span id="tx-share-hint" style={{ fontSize: 12, color: 'var(--text2)' }}>За замовчуванням — вся вільна сума транзакції; зменште, якщо вона ділиться між замовленнями.</span>
              </div>
              <div className="form-group"><label className="form-label" htmlFor="tx-note">Примітка (необов'язково)</label>
                <input id="tx-note" className="form-input" value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function Kpi({ label, value, text, color }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{text != null ? text : <>{fmtInt(value)} <span style={{ fontSize: 14, color: 'var(--text3)' }}>грн</span></>}</div>
    </div>
  )
}

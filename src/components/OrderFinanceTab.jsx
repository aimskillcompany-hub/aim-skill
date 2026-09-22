import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { paymentCandidates, clientPayments } from '../lib/orderPayments'

// Вкладка «Прибутковість» картки замовлення: касовий, РЕАЛЬНИЙ прибуток за
// фактичними банківськими транзакціями. Оплата клієнта прив'язується тут (замість
// «Деталей») і одразу враховується як надходження. Плюс довільні надходження/витрати
// частками. Прибуток = надходження − витрати. Таблиця order_transactions (міграція 057).

const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''

export default function OrderFinanceTab({ o, onOrderChange }) {
  const { user } = useUser()
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
    if (error) { alert('Не вдалося прив\'язати оплату: ' + (/paid_transaction_id/.test(error.message || '') ? 'запустіть міграцію 056' : error.message)); return }
    setPickList(null); onOrderChange?.()
  }
  const unlinkPayment = async () => {
    setPayBusy(true)
    await qc('orders').update({ paid_transaction_id: null }).eq('id', o.id)
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

  if (items == null) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>

  // Блок прив'язки оплати показуємо ЛИШЕ поки оплату не прив'язано (кандидати/ручний вибір).
  // Після прив'язки оплата живе єдиним рядком у «Надходженнях» (без дублювання).
  const PayRow = ({ t, recommended }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: recommended ? 'rgba(16,185,129,.06)' : 'var(--surface)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(Math.abs(t.amount))} грн <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· {d(t.date)}</span>
          {recommended && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>рекомендовано (сума збігається)</span>}</div>
        <div className="trunc" style={{ fontSize: 12, color: 'var(--text2)' }}>{t.description || t.counterparty || ''}</div>
      </div>
      <button className="btn" disabled={payBusy} onClick={() => linkPayment(t.id)} style={{ fontSize: 12, padding: '4px 12px' }}>Прив'язати</button>
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
            <button className="btn" onClick={openPayPicker} style={{ alignSelf: 'flex-start', fontSize: 12 }}><i className="ti ti-link" /> Прив'язати вручну</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>Вхідні оплати клієнта:</span>
                <button className="btn" onClick={() => setPickList(null)} style={{ fontSize: 12, padding: '2px 10px' }}>Сховати</button>
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
          <button className="btn" onClick={() => setPicker(kind)}><i className="ti ti-plus" /> Додати транзакцію</button>
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
                    <td style={{ textAlign: 'right' }}><button className="btn" onClick={() => removeItem(it)} style={{ padding: '2px 8px', color: 'var(--red)' }}><i className="ti ti-x" /></button></td>
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
      <td style={{ textAlign: 'right' }}><button className="btn" disabled={payBusy} onClick={unlinkPayment} title="Відв'язати оплату клієнта" style={{ padding: '2px 8px', color: 'var(--red)' }}><i className="ti ti-unlink" /></button></td>
    </tr>
  ) : null

  return (
    <div>
      {missing ? (
        <div className="card"><p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>Запустіть міграцію 057 (таблиця <code>order_transactions</code>), щоб прив'язувати надходження/витрати до замовлення. Оплату клієнта можна прив'язати вже зараз.</p></div>
      ) : null}

      {!o.paid_transaction_id && paymentBlock}

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

// Вибір банківської транзакції + сума частки
function TxPicker({ kind, orderId, clientId, userId, onClose, onAdded }) {
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

  const pick = (t) => { setChosen(t); setAmount(String(Math.abs(Number(t.amount) || 0))) }

  const add = async () => {
    if (!chosen) return
    setBusy(true)
    const { error } = await supabase.from('order_transactions').insert({
      order_id: orderId, transaction_id: chosen.id, kind,
      amount: Math.abs(Number(amount) || 0), note: note.trim() || null, created_by: userId || null,
    })
    setBusy(false)
    if (error) { alert('Не вдалося: ' + (/order_transactions/.test(error.message || '') ? 'запустіть міграцію 057' : error.message)); return }
    onAdded()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 640, maxWidth: '100%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>Додати {kind === 'income' ? 'надходження' : 'витрату'} з банку</div>
          <button className="btn" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        {!chosen ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <input className="form-input" placeholder="Пошук: контрагент / опис / ЄДРПОУ…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 240px' }} autoFocus />
              {kind === 'income' && clientId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={onlyClient} onChange={e => setOnlyClient(e.target.checked)} style={{ width: 16, height: 16 }} /> лише від клієнта
                </label>
              )}
            </div>
            {rows == null ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p>
              : rows.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Транзакцій не знайдено.</p> : (
                <div className="tbl-wrap" style={{ border: 'none' }}>
                  <table><thead><tr><th>Дата</th><th>Контрагент / опис</th><th style={{ textAlign: 'right' }}>Сума</th></tr></thead>
                    <tbody>{rows.map(t => (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => pick(t)}>
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
              <div style={{ color: 'var(--text3)', marginTop: 2 }}>Сума транзакції: {fmt(chosen.amount)} грн</div>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Сума частки на замовлення (грн)</label>
                <input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>За замовч. — вся сума транзакції; зменште, якщо ділиться між замовленнями.</span>
              </div>
              <div className="form-group"><label>Примітка (необов'язково)</label>
                <input className="form-input" value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={add} disabled={busy}>{busy ? '…' : 'Додати'}</button>
              <button className="btn" onClick={() => setChosen(null)}>← Інша транзакція</button>
            </div>
          </>
        )}
      </div>
    </div>
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

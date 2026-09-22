import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'

// Вкладка «Прибутковість» картки замовлення: касовий, РЕАЛЬНИЙ прибуток за
// фактичними банківськими транзакціями. Надходження/витрати чіпляються до
// замовлення частками (суми з ПДВ, як у виписці). Прибуток = надходження − витрати.
// Таблиця order_transactions (міграція 057). Незалежно від документів/статусу.

const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''

export default function OrderFinanceTab({ o }) {
  const { user } = useUser()
  const [items, setItems] = useState(null)
  const [missing, setMissing] = useState(false) // міграція 057 ще не застосована
  const [picker, setPicker] = useState(null)     // 'income' | 'expense'

  const load = async () => {
    const { data, error } = await supabase.from('order_transactions')
      .select('id, kind, amount, note, transaction_id, bank_transactions(date, counterparty, description, amount, direction)')
      .eq('order_id', o.id).order('created_at')
    if (error) { setMissing(/order_transactions/.test(error.message || '')); setItems([]); return }
    setMissing(false); setItems(data || [])
  }
  useEffect(() => { load() }, [o.id])

  const income = useMemo(() => (items || []).filter(i => i.kind === 'income').reduce((s, i) => s + (Number(i.amount) || 0), 0), [items])
  const expense = useMemo(() => (items || []).filter(i => i.kind === 'expense').reduce((s, i) => s + (Number(i.amount) || 0), 0), [items])
  const profit = income - expense
  const marginPct = income > 0 ? (profit / income * 100) : 0

  const removeItem = async (it) => { await supabase.from('order_transactions').delete().eq('id', it.id); load() }

  // Швидко додати прив'язану оплату клієнта (orders.paid_transaction_id) як надходження
  const attachedIds = useMemo(() => new Set((items || []).map(i => i.transaction_id).filter(Boolean)), [items])
  const canAddClientPayment = o.paid_transaction_id && !attachedIds.has(o.paid_transaction_id)
  const addClientPayment = async () => {
    const { data: tx } = await supabase.from('bank_transactions').select('id, amount').eq('id', o.paid_transaction_id).single()
    if (!tx) return
    await supabase.from('order_transactions').insert({
      order_id: o.id, transaction_id: tx.id, kind: 'income',
      amount: Math.abs(Number(tx.amount) || 0), created_by: user?.id || null,
    })
    load()
  }

  if (items == null) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  if (missing) return <div className="card"><p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>Запустіть міграцію 057 (таблиця <code>order_transactions</code>), щоб прив'язувати надходження/витрати до замовлення.</p></div>

  const Section = ({ kind, label, color, sum }) => {
    const list = (items || []).filter(i => i.kind === kind)
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, color }}>{label} <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 13 }}>· {fmt(sum)} грн</span></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {kind === 'income' && canAddClientPayment && (
              <button className="btn" onClick={addClientPayment} title="Додати прив'язану оплату клієнта як надходження"><i className="ti ti-cash" /> Оплата клієнта</button>
            )}
            <button className="btn" onClick={() => setPicker(kind)}><i className="ti ti-plus" /> Додати транзакцію</button>
          </div>
        </div>
        {list.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13, margin: 0 }}>Немає транзакцій.</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table><thead><tr><th>Дата</th><th>Контрагент / опис</th><th style={{ textAlign: 'right' }}>Сума</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>{list.map(it => { const t = it.bank_transactions || {}; return (
                <tr key={it.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(t.date)}</td>
                  <td><div className="trunc" style={{ maxWidth: 340 }}>{t.counterparty || t.description || (it.transaction_id ? '—' : 'транзакцію видалено')}{it.note ? <span style={{ color: 'var(--text3)' }}> · {it.note}</span> : null}</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 500 }}>{fmt(it.amount)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn" onClick={() => removeItem(it)} style={{ padding: '2px 8px', color: 'var(--red)' }}><i className="ti ti-x" /></button></td>
                </tr>
              )})}</tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-grid">
          <Kpi label="Надходження (факт)" value={income} color="var(--green)" />
          <Kpi label="Витрати (факт)" value={expense} color="var(--red)" />
          <Kpi label="Реальний прибуток" value={profit} color={profit >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Kpi label="Маржа" text={income > 0 ? `${marginPct.toFixed(1)}%` : '—'} color={profit >= 0 ? 'var(--green)' : 'var(--red)'} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text3)', margin: '10px 0 0' }}>
          Реальна (касова) прибутковість за фактичними грошима. Суми — як у виписці (з ПДВ); транзакцію можна прив'язати часткою, якщо вона ділиться між замовленнями.
        </p>
      </div>

      <Section kind="income" label="Надходження" color="var(--green)" sum={income} />
      <Section kind="expense" label="Витрати" color="var(--red)" sum={expense} />

      {picker && <TxPicker kind={picker} orderId={o.id} clientId={o.client_id} userId={user?.id} onClose={() => setPicker(null)} onAdded={() => { setPicker(null); load() }} />}
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

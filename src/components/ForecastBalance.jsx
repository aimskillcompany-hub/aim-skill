import { useEffect, useState } from 'react'
import { useUser } from '../lib/auth'
import { fmtInt } from '../lib/fmt'
import { labelForStatus, statusAccent } from '../lib/orders'
import { loadForecast, addForecastItem, removeForecastItem } from '../lib/forecast'

// Ручний прогноз: по замовленнях з відміткою «в прогноз» вносимо очікувані надходження/витрати з датами.
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const today = () => new Date().toISOString().slice(0, 10)

export default function ForecastBalance() {
  const { user } = useUser()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  const reload = () => { setErr(null); loadForecast().then(setData).catch(e => setErr(e.message)) }
  useEffect(() => { reload() }, [])

  if (err) return <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}{/forecast_items|in_forecast/.test(err) ? ' — запустіть міграцію 061.' : ''}</div>
  if (!data) return <p style={{ color: 'var(--text3)' }}>Завантаження…</p>

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kpi label="Прогнозні надходження" value={data.totals.income} color="#16A34A" />
        <Kpi label="Прогнозні витрати" value={data.totals.expense} color="#DC2626" />
        <Kpi label="Чистий прогнозний потік" value={data.totals.net} color="#2563EB" big />
      </div>

      {data.rows.length === 0 ? (
        <div className="card"><p style={{ color: 'var(--text3)' }}>
          Немає замовлень у прогнозі. Познач замовлення кнопкою <i className="ti ti-trending-up" style={{ color: '#2563EB' }} /> «в прогноз» у реєстрі <b>Замовлення</b>.
        </p></div>
      ) : data.rows.map(o => <OrderForecast key={o.id} order={o} userId={user?.id} onChange={reload} />)}
    </div>
  )
}

function OrderForecast({ order, userId, onChange }) {
  const [adding, setAdding] = useState(null) // { kind, amount, date, note }
  const [busy, setBusy] = useState(false)

  const run = async (fn) => { setBusy(true); try { await fn(); await onChange() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const save = () => run(async () => {
    if (!(Number(adding.amount) > 0)) throw new Error('Вкажіть суму')
    await addForecastItem({ orderId: order.id, companyId: order.companyId, kind: adding.kind, amount: adding.amount, expectedDate: adding.date, note: adding.note, userId })
    setAdding(null)
  })

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>№{order.number}</div>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: (statusAccent(order.status) || '#999') + '22', color: statusAccent(order.status) || 'var(--text2)' }}>{labelForStatus(order.status)}</span>
        <span style={{ fontSize: 13, color: 'var(--text2)', flex: 1 }} className="trunc">{order.client} · {order.company}</span>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          +{fmtInt(order.income)} · −{fmtInt(order.expense)} · нетто <b style={{ color: order.net >= 0 ? '#16A34A' : '#DC2626' }}>{order.net < 0 ? '−' : ''}{fmtInt(order.net)}</b>
        </span>
      </div>

      {order.lines.length > 0 && (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 8 }}>
          <tbody>
            {order.lines.map(l => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 4px', width: 110 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: l.kind === 'income' ? '#16A34A' : '#DC2626' }}>
                    {l.kind === 'income' ? '↓ Надходження' : '↑ Витрата'}
                  </span>
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600, width: 120 }}>{l.kind === 'expense' ? '−' : ''}{fmtInt(l.amount)} ₴</td>
                <td style={{ padding: '6px 4px', color: 'var(--text2)', width: 110 }}>{d(l.expected_date)}</td>
                <td style={{ padding: '6px 4px', color: 'var(--text3)', fontSize: 12 }}>{l.note || ''}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right', width: 36 }}>
                  <button className="btn" style={{ padding: '2px 6px' }} disabled={busy} onClick={() => run(() => removeForecastItem(l.id))}><i className="ti ti-x" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--surface2)', padding: 10, borderRadius: 8 }}>
          <div><label style={{ fontSize: 11, color: 'var(--text3)' }}>Тип</label>
            <select className="form-input" value={adding.kind} onChange={e => setAdding(a => ({ ...a, kind: e.target.value }))}>
              <option value="income">Надходження</option>
              <option value="expense">Витрата</option>
            </select>
          </div>
          <div><label style={{ fontSize: 11, color: 'var(--text3)' }}>Сума</label>
            <input className="form-input" type="number" value={adding.amount} onChange={e => setAdding(a => ({ ...a, amount: e.target.value }))} style={{ width: 130 }} autoFocus />
          </div>
          <div><label style={{ fontSize: 11, color: 'var(--text3)' }}>Очікувана дата</label>
            <input className="form-input" type="date" value={adding.date} onChange={e => setAdding(a => ({ ...a, date: e.target.value }))} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}><label style={{ fontSize: 11, color: 'var(--text3)' }}>Примітка</label>
            <input className="form-input" value={adding.note} onChange={e => setAdding(a => ({ ...a, note: e.target.value }))} placeholder="необов'язково" />
          </div>
          <button className="btn btn-primary" onClick={save} disabled={busy}>Додати</button>
          <button className="btn" onClick={() => setAdding(null)}>×</button>
        </div>
      ) : (
        <button className="btn" onClick={() => setAdding({ kind: 'income', amount: '', date: today(), note: '' })}>
          <i className="ti ti-plus" /> Додати прогнозний рядок
        </button>
      )}
    </div>
  )
}

function Kpi({ label, value, color, big }) {
  return (
    <div className="card" style={{ flex: '1 1 200px', minWidth: 180, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: big ? 24 : 20, fontWeight: 700, color }}>{value < 0 ? '−' : ''}{fmtInt(value)} ₴</div>
    </div>
  )
}

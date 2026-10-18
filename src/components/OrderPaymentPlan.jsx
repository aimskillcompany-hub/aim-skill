import { useEffect, useState } from 'react'
import { fmt } from '../lib/fmt'
import { buildOrderForecasts, loadPaymentPlan, savePaymentPlanEntry, DEFAULT_CLIENT_DAYS } from '../lib/forecast'

// «Графік платежів» замовлення + рядки, які замовлення дає в «Прогноз» (план − факт = залишок).
// Дати не обов'язкові: порожнє поле → правило за замовчуванням, рядок позначається «орієнтовна».
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'

export default function OrderPaymentPlan({ o }) {
  const [fc, setFc] = useState(null)
  const [plan, setPlan] = useState([])
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = async () => {
    setErr(null)
    try {
      const [r] = await buildOrderForecasts({ orderIds: [o.id] })
      setFc(r || null)
      try { setPlan(await loadPaymentPlan(o.id)); setMissing(false) } catch { setMissing(true); setPlan([]) }
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [o.id, o.total, o.paid_transaction_id, o.agent_commission_pct])

  const entry = (kind, supplierId = null) => plan.find(x => x.kind === kind && (x.supplier_id || null) === supplierId) || {}
  const save = async (kind, supplierId, patch) => {
    setBusy(true); setErr(null)
    try {
      const cur = entry(kind, supplierId)
      await savePaymentPlanEntry(o.id, { kind, supplierId, planDate: 'planDate' in patch ? patch.planDate : cur.plan_date, days: 'days' in patch ? patch.days : cur.days })
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (err) return <div className="card" style={{ marginBottom: 14, color: 'var(--red)', fontSize: 13 }}>Прогноз замовлення: {err}</div>
  if (!fc) return null

  const suppliers = fc.lines.filter(l => l.key.startsWith('sup-'))
  const ship = entry('ship'), client = entry('client')
  const DateIn = ({ value, onChange }) => <input type="date" className="form-input" disabled={busy || missing} value={value || ''} onChange={e => onChange(e.target.value || null)} style={{ height: 32, padding: '4px 8px', fontSize: 13, maxWidth: 160 }} />
  const Hint = ({ children }) => <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{children}</span>
  const mismatch = Math.abs(fc.planNet - fc.checkNet) > 1

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <i className="ti ti-calendar-dollar" style={{ fontSize: 18, color: '#2563EB' }} />
        <h3 style={{ margin: 0, fontSize: 15 }}>Графік платежів і прогноз</h3>
        {!fc.inForecast && <span style={{ fontSize: 11.5, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 6, padding: '2px 8px' }}>замовлення не позначене «в прогноз» — рядки не потрапляють у «Прогноз»</span>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 12px' }}>
        Дати не обов'язкові: якщо поле порожнє, дата ставиться за правилом і позначається «орієнтовна». Податок 18% у прогноз не входить.
      </p>
      {missing && <p style={{ fontSize: 12.5, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', margin: '0 0 12px' }}>Щоб задавати дати, запустіть міграцію 067 у Supabase. Поки що всі дати рахуються за правилами.</p>}

      {/* Графік */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div className="form-group">
          <label>Відвантаження</label>
          <DateIn value={ship.plan_date} onChange={v => save('ship', null, { planDate: v })} />
          <Hint>{ship.plan_date ? 'задано вручну' : fc.shipEst ? `за замовч.: сьогодні + 14 дн. (${d(fc.shipDate)})` : `за видатковою: ${d(fc.shipDate)}`}</Hint>
        </div>
        <div className="form-group">
          <label>Оплата від клієнта</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <DateIn value={client.plan_date} onChange={v => save('client', null, { planDate: v })} />
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>або через</span>
            <input type="number" className="form-input" disabled={busy || missing || !!client.plan_date} placeholder={String(DEFAULT_CLIENT_DAYS)} defaultValue={client.days ?? ''} key={'cd' + (client.days ?? '')}
              onBlur={e => { const v = e.target.value; if (String(v) !== String(client.days ?? '')) save('client', null, { days: v === '' ? null : Number(v) }) }}
              style={{ width: 64, height: 32, padding: '4px 8px', fontSize: 13 }} />
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>дн.</span>
          </div>
          <Hint>{client.plan_date ? 'задано вручну' : `після відвантаження → ${d(fc.clientDate)}`}</Hint>
        </div>
        {suppliers.map(l => {
          const e = entry('supplier', l.supplierId || null)
          return (
            <div key={l.key} className="form-group">
              <label className="trunc" title={l.label}>Оплата: {l.label}</label>
              <DateIn value={e.plan_date} onChange={v => save('supplier', l.supplierId || null, { planDate: v })} />
              <Hint>{e.plan_date ? 'задано вручну' : `${l.estimated ? 'орієнтовно' : 'за субзамовленням / відвантаженням'}: ${d(l.date)}`}</Hint>
            </div>
          )
        })}
      </div>

      {/* Рядки прогнозу */}
      <div className="tbl-wrap" style={{ border: 'none' }}>
        <table>
          <thead><tr>
            <th>Рядок прогнозу</th><th style={{ textAlign: 'right' }}>План</th><th style={{ textAlign: 'right' }}>Факт</th>
            <th style={{ textAlign: 'right' }}>Залишок</th><th>Дата</th><th>Стан</th>
          </tr></thead>
          <tbody>
            {fc.lines.map(l => {
              const sign = l.kind === 'income' ? '+' : '−'
              const color = l.kind === 'income' ? 'var(--green)' : 'var(--red)'
              const state = l.remaining <= 0.5 ? (l.note || 'виконано') : l.fact > 0.5 ? 'частково' : 'план'
              return (
                <tr key={l.key} style={l.remaining <= 0.5 ? { color: 'var(--text3)' } : undefined}>
                  <td><span style={{ color, fontWeight: 600 }}>{l.kind === 'income' ? '↓' : '↑'}</span> {l.label}{l.flag === 'receivable' && <span style={{ fontSize: 11, color: '#B7791F' }}> · дебіторка</span>}{l.payablePart > 0.5 && <span style={{ fontSize: 11, color: '#B7791F' }}> · кредиторка {fmt(l.payablePart)}</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{sign}{fmt(Math.abs(l.plan))}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{l.fact > 0.5 ? fmt(l.fact) : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: l.remaining > 0.5 ? color : undefined }}>{l.remaining > 0.5 ? sign + fmt(l.remaining) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(l.date)}{l.estimated && l.remaining > 0.5 && <span title="Дата за правилом за замовчуванням" style={{ fontSize: 11, color: 'var(--text3)' }}> · орієнт.</span>}{l.overdue && <span style={{ fontSize: 11, color: 'var(--red)' }}> · прострочено</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{state}</td>
                </tr>
              )
            })}
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
              <td>Чистий потік</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fc.planNet < 0 ? '−' : '+'}{fmt(Math.abs(fc.planNet))}</td>
              <td />
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: fc.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{fc.net < 0 ? '−' : '+'}{fmt(Math.abs(fc.net))}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, margin: '8px 0 0', color: mismatch ? 'var(--red)' : 'var(--text3)' }}>
        {mismatch
          ? <>⚠ Звірка не зійшлась: план потоку {fmt(fc.planNet)} ≠ чистий прибуток + податок 18% ({fmt(fc.checkNet)}). Перевірте позиції.</>
          : <>✓ Звірка: план потоку = чистий прибуток з «Планової прибутковості» + податок 18% ({fmt(fc.checkNet)}), бо податок у прогноз не входить.</>}
      </p>
    </div>
  )
}

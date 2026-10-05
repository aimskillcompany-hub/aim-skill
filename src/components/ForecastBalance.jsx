import { useEffect, useState } from 'react'
import { useCompany } from '../lib/company'
import { fmtInt } from '../lib/fmt'
import { labelForStatus, statusAccent } from '../lib/orders'
import { computeForecast } from '../lib/forecast'

// Прогноз майбутнього балансу: поточні гроші + очікувані надходження − очікувані виплати по угодах у роботі.

export default function ForecastBalance() {
  const { companies } = useCompany()
  const [committedOnly, setCommittedOnly] = useState(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!companies?.length) return
    let cancelled = false
    setLoading(true); setErr(null)
    computeForecast(companies, { committedOnly })
      .then(r => { if (!cancelled) setData(r) })
      .catch(e => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companies, committedOnly])

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={committedOnly} onChange={e => setCommittedOnly(e.target.checked)} />
          Лише законтрактовані угоди (договір / замовлення й далі)
        </label>
        {loading && <span style={{ fontSize: 13, color: 'var(--text3)' }}><i className="ti ti-loader" /> Рахуємо…</span>}
      </div>

      {err && <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}</div>}

      {data && (
        <>
          {/* Прогноз грошей: поточні → +надходження −виплати = майбутні */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 16 }}>
            <Kpi label="Гроші зараз" value={data.totals.nowCash} color="var(--text)" />
            <Op>+</Op>
            <Kpi label="Очікувані надходження" sub="від клієнтів" value={data.totals.clientDue} color="#16A34A" />
            <Op>−</Op>
            <Kpi label="Очікувані виплати" sub="постачальникам" value={data.totals.supplierDue} color="#DC2626" />
            <Op>=</Op>
            <Kpi label="Прогноз грошей" value={data.totals.projectedCash} color="#2563EB" big />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi label="Очікуваний прибуток по угодах у роботі" sub="виручка − собівартість" value={data.totals.margin} color="#7C3AED" big />
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="card-title" style={{ marginBottom: 10 }}>Угоди в роботі ({data.rows.length})</div>
            {data.rows.length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 13 }}>Немає відкритих угод з очікуваними потоками.</p>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 820 }}>
                <thead>
                  <tr style={{ color: 'var(--text3)', fontSize: 11, textAlign: 'right' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>№ / Клієнт</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Компанія</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Статус</th>
                    <th style={{ padding: '6px 8px' }}>Виручка</th>
                    <th style={{ padding: '6px 8px' }}>Собівартість</th>
                    <th style={{ padding: '6px 8px', color: '#16A34A' }}>Отримати від клієнта</th>
                    <th style={{ padding: '6px 8px', color: '#DC2626' }}>Сплатити постачальнику</th>
                    <th style={{ padding: '6px 8px' }}>Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '8px' }}>
                        <div style={{ fontWeight: 500 }}>№{r.number}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }} className="trunc">{r.client}</div>
                      </td>
                      <td style={{ textAlign: 'left', padding: '8px', fontSize: 12, color: 'var(--text2)' }}>{r.company}</td>
                      <td style={{ textAlign: 'left', padding: '8px' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: (statusAccent(r.status) || '#999') + '22', color: statusAccent(r.status) || 'var(--text2)' }}>{labelForStatus(r.status)}</span>
                      </td>
                      <td style={{ padding: '8px' }}>{fmtInt(r.rev)}</td>
                      <td style={{ padding: '8px', color: 'var(--text3)' }}>{fmtInt(r.cost)}</td>
                      <td style={{ padding: '8px', color: '#16A34A', fontWeight: r.clientDue > 0.5 ? 600 : 400 }}>{r.clientDue > 0.5 ? fmtInt(r.clientDue) : '—'}</td>
                      <td style={{ padding: '8px', color: '#DC2626', fontWeight: r.supplierDue > 0.5 ? 600 : 400 }}>{r.supplierDue > 0.5 ? fmtInt(r.supplierDue) : '—'}</td>
                      <td style={{ padding: '8px', fontWeight: 600, color: r.margin < 0 ? 'var(--red)' : '#7C3AED' }}>{r.margin < 0 ? '−' : ''}{fmtInt(r.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 12 }}>
            Прогноз по відкритих замовленнях усіх юросіб. «Отримати від клієнта» = виручка − вже отримано (прив'язана оплата).
            «Сплатити постачальнику» = собівартість − вже сплачено (замовлення постачальнику зі статусом «Оплачено»).
            Сценарій «оплатив постачальнику, чекаю товар» → лишається тільки надходження; «ще не оплатив» → і виплата, і надходження.
            Це оцінка за даними замовлень (не враховує майбутні податки/витрати поза угодами).
          </p>
        </>
      )}
    </div>
  )
}

function Kpi({ label, sub, value, color, big }) {
  return (
    <div className="card" style={{ flex: big ? '1 1 220px' : '1 1 170px', minWidth: 150, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{sub}</div>}
      <div style={{ fontSize: big ? 24 : 19, fontWeight: 700, color, marginTop: 2 }}>{fmtInt(value)} ₴</div>
    </div>
  )
}
function Op({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', fontSize: 22, color: 'var(--text3)', fontWeight: 700 }}>{children}</div>
}

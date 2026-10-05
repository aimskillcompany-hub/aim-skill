import { useEffect, useState } from 'react'
import { useCompany } from '../lib/company'
import { fmtInt } from '../lib/fmt'
import { computeConsolidated } from '../lib/consolidated'
import { forecastNetByDate } from '../lib/forecast'

const lastDayStr = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

// Зведений баланс по всіх юрособах — повна картина бізнесу для інвестора.

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const now = new Date()

export default function ConsolidatedBalance() {
  const { companies } = useCompany()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1) // 1..12
  const [data, setData] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!companies?.length) return
    let cancelled = false
    setLoading(true); setErr(null)
    Promise.all([
      computeConsolidated(year, month, companies),
      forecastNetByDate(lastDayStr(year, month)).catch(() => null), // прогноз необов'язковий (до міграції 061)
    ])
      .then(([r, f]) => { if (!cancelled) { setData(r); setForecast(f) } })
      .catch(e => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year, month, companies])

  const years = [2025, 2026, 2027].filter(y => y <= now.getFullYear() + 1)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>Станом на кінець періоду:</span>
        <select className="form-input" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 140 }}>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className="form-input" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {loading && <span style={{ fontSize: 13, color: 'var(--text3)' }}><i className="ti ti-loader" /> Рахуємо по {companies?.length || 0} компаніях…</span>}
      </div>

      {err && <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}</div>}

      {data && (
        <>
          {/* Підсумкові KPI */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi label="Активи (разом)" value={data.total.assets} color="var(--text)" big />
            <Kpi label="Зобов'язання (разом)" value={data.total.pay + Math.max(0, data.total.loans)} color="#DC2626" />
            <Kpi label="Власний капітал (разом)" value={data.total.equity} color="#7C3AED" big />
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="card-title" style={{ marginBottom: 10 }}>Баланс по юрособах</div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr style={{ color: 'var(--text3)', fontSize: 11, textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Компанія</th>
                  <th style={{ padding: '6px 8px' }}>Гроші</th>
                  <th style={{ padding: '6px 8px' }}>Склад</th>
                  <th style={{ padding: '6px 8px' }}>Дебіторка</th>
                  <th style={{ padding: '6px 8px' }}>ОЗ</th>
                  <th style={{ padding: '6px 8px', borderLeft: '1px solid var(--border)' }}>Активи</th>
                  <th style={{ padding: '6px 8px', borderLeft: '1px solid var(--border)' }}>Кредиторка</th>
                  <th style={{ padding: '6px 8px' }}>ПФД</th>
                  <th style={{ padding: '6px 8px', borderLeft: '1px solid var(--border)' }}>Капітал</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                    <td style={{ textAlign: 'left', padding: '8px', fontWeight: 500 }}>
                      {r.name}{r.error && <span title={r.error} style={{ color: 'var(--red)', marginLeft: 6 }}><i className="ti ti-alert-triangle" /></span>}
                    </td>
                    <td style={{ padding: '8px' }}>{fmtInt(r.cash)}</td>
                    <td style={{ padding: '8px' }}>{fmtInt(r.stock)}</td>
                    <td style={{ padding: '8px' }}>{fmtInt(r.recv)}</td>
                    <td style={{ padding: '8px' }}>{fmtInt(r.fa)}</td>
                    <td style={{ padding: '8px', borderLeft: '1px solid var(--border)', fontWeight: 600 }}>{fmtInt(r.assets)}</td>
                    <td style={{ padding: '8px', borderLeft: '1px solid var(--border)' }}>{fmtInt(r.pay)}</td>
                    <td style={{ padding: '8px', color: r.loans < 0 ? '#16A34A' : 'var(--text)' }}>{r.loans < 0 ? '−' : ''}{fmtInt(r.loans)}</td>
                    <td style={{ padding: '8px', borderLeft: '1px solid var(--border)', fontWeight: 700, color: r.equity < 0 ? 'var(--red)' : '#7C3AED' }}>{r.equity < 0 ? '−' : ''}{fmtInt(r.equity)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--text)', textAlign: 'right', fontWeight: 700 }}>
                  <td style={{ textAlign: 'left', padding: '8px' }}>РАЗОМ</td>
                  <td style={{ padding: '8px' }}>{fmtInt(data.total.cash)}</td>
                  <td style={{ padding: '8px' }}>{fmtInt(data.total.stock)}</td>
                  <td style={{ padding: '8px' }}>{fmtInt(data.total.recv)}</td>
                  <td style={{ padding: '8px' }}>{fmtInt(data.total.fa)}</td>
                  <td style={{ padding: '8px', borderLeft: '1px solid var(--border)' }}>{fmtInt(data.total.assets)}</td>
                  <td style={{ padding: '8px', borderLeft: '1px solid var(--border)' }}>{fmtInt(data.total.pay)}</td>
                  <td style={{ padding: '8px', color: data.total.loans < 0 ? '#16A34A' : 'var(--text)' }}>{data.total.loans < 0 ? '−' : ''}{fmtInt(data.total.loans)}</td>
                  <td style={{ padding: '8px', borderLeft: '1px solid var(--border)', color: '#7C3AED' }}>{data.total.equity < 0 ? '−' : ''}{fmtInt(data.total.equity)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 12 }}>
            Активи = Гроші + Склад + Дебіторка + ОЗ. Капітал = Активи − Кредиторка − ПФД (чиста). ПФД від'ємна (зелена) — нам мають повернути (актив).
            Внутрішньогрупова ПФД між вашими компаніями самознищується в сумі; внутрішньогрупові дебіторка/кредиторка показані «грос» (на Капітал не впливають).
          </p>

          {/* Прогноз — ручні очікувані потоки станом на кінець періоду */}
          {forecast && (forecast.income > 0.5 || forecast.expense > 0.5) && (
            <div className="card" style={{ marginTop: 16, borderColor: '#2563EB', borderStyle: 'dashed' }}>
              <div className="card-title" style={{ marginBottom: 10, color: '#2563EB' }}>
                <i className="ti ti-trending-up" /> Прогноз станом на {MONTHS[month - 1]} {year}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
                <Kpi label="Гроші (факт)" value={data.total.cash} color="var(--text)" />
                <Op>+</Op>
                <Kpi label="Прогн. надходження" value={forecast.income} color="#16A34A" />
                <Op>−</Op>
                <Kpi label="Прогн. витрати" value={forecast.expense} color="#DC2626" />
                <Op>=</Op>
                <Kpi label="Прогноз грошей" value={data.total.cash + forecast.net} color="#2563EB" big />
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                <Kpi label="Капітал (факт)" value={data.total.equity} color="#7C3AED" />
                <Op>→</Op>
                <Kpi label="Прогнозний капітал" value={data.total.equity + forecast.net} color="#7C3AED" big />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
                Враховані прогнозні рядки з очікуваною датою ≤ кінця періоду (вносяться у вкладці «Прогноз»). Зміни місяць/рік угорі, щоб побачити баланс на іншу дату.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, color, big }) {
  return (
    <div className="card" style={{ flex: big ? '1 1 200px' : '1 1 150px', minWidth: 140, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: big ? 24 : 20, fontWeight: 700, color }}>{value < 0 ? '−' : ''}{fmtInt(value)} ₴</div>
    </div>
  )
}
function Op({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', fontSize: 22, color: 'var(--text3)', fontWeight: 700 }}>{children}</div>
}

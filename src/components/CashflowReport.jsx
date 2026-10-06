import { useEffect, useState } from 'react'
import { useCompany } from '../lib/company'
import { computeCashflow } from '../lib/cashflowReport'

// CashFlow по місяцях у розрізі статей і проектів (активна компанія).
const M = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const now = new Date()
const _int = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const n0 = (v) => Math.abs(Math.round(Number(v) || 0)) < 0.5 ? '' : _int.format(Math.round(Math.abs(Number(v) || 0)))
const MONO = { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

export default function CashflowReport() {
  const { activeId, active } = useCompany()
  const [year, setYear] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null)
    computeCashflow(year)
      .then(r => { if (!cancelled) setData(r) })
      .catch(e => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year, activeId])

  const years = [2025, 2026, 2027].filter(y => y <= now.getFullYear() + 1)

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <i className="ti ti-arrows-exchange" style={{ fontSize: 22 }} />
        <h1 style={{ margin: 0 }}>CashFlow</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="form-input" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
        Рух грошей по місяцях ({active?.short_name || active?.name || ''}). Статті «Виручка: товари / ПЗ» та «Закупівля товарів» — у розрізі проектів
        (призначається в Банк/Каса, поле «Проект»).
      </p>

      {loading && <p style={{ color: 'var(--text3)' }}><i className="ti ti-loader" /> Рахуємо…</p>}
      {err && <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}</div>}

      {data && (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1100 }}>
            <thead>
              <tr style={{ fontSize: 11, color: 'var(--text3)' }}>
                <th style={{ ...th, textAlign: 'left', minWidth: 220 }}>Стаття</th>
                {M.map(m => <th key={m} style={th}>{m}</th>)}
                <th style={{ ...th, borderLeft: '1px solid var(--border)', fontWeight: 800 }}>Разом</th>
              </tr>
            </thead>
            <tbody>
              <Section title="ПРОЕКТИ НАДХОДЖЕННЯ" color="#166534" bg="#DCFCE7" rows={data.sections.projIncome} tot={data.totals.projIncome} />
              <Section title="НАДХОДЖЕННЯ" color="#166534" bg="#DCFCE7" rows={data.sections.income} tot={data.totals.income} />
              <Section title="ПРОЕКТ ВИТРАТИ" color="#991B1B" bg="#FEE2E2" rows={data.sections.projExpense} tot={data.totals.projExpense} />
              <Section title="ВИТРАТИ" color="#991B1B" bg="#FEE2E2" rows={data.sections.expense} tot={data.totals.expense} />
              <TotalRow label="Чистий потік" r={data.net} strong />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const th = { padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const cell = { padding: '7px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)' }

function Section({ title, color, bg, rows, tot }) {
  return (
    <>
      <tr>
        <td colSpan={14} style={{ padding: '8px 10px', background: bg, color, fontWeight: 800, fontSize: 12, letterSpacing: '0.04em', borderBottom: '1px solid var(--border)' }}>{title}</td>
      </tr>
      {rows.length === 0 && <tr><td colSpan={14} style={{ padding: '7px 10px', color: 'var(--text3)', fontSize: 12 }}>—</td></tr>}
      {rows.map(r => (
        <tr key={r.key}>
          <td style={{ ...cell, textAlign: 'left' }}>{r.label}</td>
          {r.months.map((v, i) => <td key={i} style={{ ...cell, ...MONO, color: v ? 'var(--text)' : 'var(--text3)' }}>{n0(v)}</td>)}
          <td style={{ ...cell, ...MONO, borderLeft: '1px solid var(--border)', fontWeight: 700 }}>{n0(r.total)}</td>
        </tr>
      ))}
      {rows.length > 0 && <TotalRow label={`Разом ${title.toLowerCase()}`} r={tot} />}
    </>
  )
}

function TotalRow({ label, r, strong }) {
  return (
    <tr style={{ background: strong ? '#17151F' : '#FAF9FC' }}>
      <td style={{ ...cell, textAlign: 'left', fontWeight: 700, color: strong ? '#fff' : 'var(--text)' }}>{label}</td>
      {r.months.map((v, i) => <td key={i} style={{ ...cell, ...MONO, fontWeight: 600, color: strong ? '#fff' : 'var(--text2)' }}>{n0(v)}</td>)}
      <td style={{ ...cell, ...MONO, borderLeft: '1px solid var(--border)', fontWeight: 800, color: strong ? '#fff' : 'var(--text)' }}>{n0(r.total)}</td>
    </tr>
  )
}

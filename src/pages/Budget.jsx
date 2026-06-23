import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmtInt } from '../lib/fmt'
import { fetchArticles, groupByType } from '../lib/articles'
import { computeAging } from '../lib/pl'
import { getAccountBalances } from '../lib/accounts'

const NOW = new Date()
const YEARS = [NOW.getFullYear(), NOW.getFullYear() + 1, NOW.getFullYear() - 1]
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const pad = n => String(n).padStart(2, '0')

export default function Budget() {
  const { user } = useUser()
  const [year, setYear] = useState(NOW.getFullYear())
  const [month, setMonth] = useState(NOW.getMonth() + 1)
  const [articles, setArticles] = useState([])
  const [plan, setPlan] = useState({})        // article name → { id, amount }
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  const ym = `${year}-${pad(month)}`

  const load = async () => {
    setLoading(true)
    const [arts, { data: plans }] = await Promise.all([
      fetchArticles(),
      supabase.from('plans').select('id, article, amount').eq('year_month', ym),
    ])
    setArticles(arts)
    const map = {}; (plans || []).forEach(p => { map[p.article] = { id: p.id, amount: Number(p.amount) || 0 } })
    setPlan(map)
    setLoading(false)
  }
  useEffect(() => { load() }, [ym])

  const grouped = useMemo(() => groupByType(articles), [articles])
  const setAmount = (name, v) => setPlan(p => ({ ...p, [name]: { ...p[name], amount: v } }))

  const save = async () => {
    const arts = [...(grouped.income || []), ...(grouped.expense || [])]
    for (const a of arts) {
      const entry = plan[a.name]
      const amt = Number(entry?.amount) || 0
      if (entry?.id) {
        if (amt > 0) await supabase.from('plans').update({ amount: amt, article_id: a.id }).eq('id', entry.id)
        else await supabase.from('plans').delete().eq('id', entry.id)
      } else if (amt > 0) {
        await supabase.from('plans').insert({ year_month: ym, article: a.name, article_id: a.id, amount: amt, direction: a.type === 'income' ? 'Доходи' : 'Витрати', created_by: user?.id || null })
      }
    }
    setSaved(true); setTimeout(() => setSaved(false), 2500); load()
  }

  const totals = useMemo(() => {
    const sumType = (arts) => (arts || []).reduce((s, a) => s + (Number(plan[a.name]?.amount) || 0), 0)
    return { income: sumType(grouped.income), expense: sumType(grouped.expense) }
  }, [plan, grouped])

  return (
    <div>
      <div className="page-header"><h1>Бюджет і прогноз</h1></div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-input" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 110 }}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <select className="form-input" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 150 }}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        <button className="btn btn-primary" onClick={save} style={{ marginLeft: 'auto' }}>Зберегти план</button>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Збережено!</span>}
      </div>

      <Forecast planIncome={totals.income} planExpense={totals.expense} />

      {loading ? <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <PlanColumn title="Доходи" arts={grouped.income} plan={plan} setAmount={setAmount} total={totals.income} color="var(--green)" />
          <PlanColumn title="Витрати" arts={grouped.expense} plan={plan} setAmount={setAmount} total={totals.expense} color="var(--red)" />
        </div>
      )}
    </div>
  )
}

function PlanColumn({ title, arts, plan, setAmount, total, color }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{title}</div>
        <div style={{ fontWeight: 700, color }}>{fmtInt(total)} грн</div>
      </div>
      {(arts || []).map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flex: 1, fontSize: 13 }}>{a.name}</span>
          <input className="form-input" type="number" value={plan[a.name]?.amount ?? ''} onChange={e => setAmount(a.name, e.target.value)} placeholder="0" style={{ width: 130, textAlign: 'right' }} />
        </div>
      ))}
      {(!arts || arts.length === 0) && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Немає статей</p>}
    </div>
  )
}

// Грошовий прогноз = план + відкриті борги + активні замовлення
function Forecast({ planIncome, planExpense }) {
  const [extra, setExtra] = useState(null)
  useEffect(() => {
    Promise.all([
      computeAging(),
      supabase.from('orders').select('total, status').neq('status', 'closed'),
      getAccountBalances(),
    ]).then(([aging, { data: orders }, balances]) => {
      const activeOrders = (orders || []).reduce((s, o) => s + (Number(o.total) || 0), 0)
      const currentBalance = balances.reduce((s, b) => s + b.balance, 0)
      setExtra({ receivable: aging.receivable.total, payable: aging.payable.total, activeOrders, currentBalance })
    })
  }, [])

  const inflow = planIncome + (extra?.receivable || 0) + (extra?.activeOrders || 0)
  const outflow = planExpense + (extra?.payable || 0)
  const net = inflow - outflow
  const projected = (extra?.currentBalance || 0) + net

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-title">Грошовий прогноз</div>
      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">Поточний залишок</div><div className="kpi-value" style={{ fontSize: 22 }}>{fmtInt(extra?.currentBalance || 0)}</div><div className="kpi-sub">по всіх рахунках</div></div>
        <div className="kpi"><div className="kpi-label">Очікувані надходження</div><div className="kpi-value" style={{ color: 'var(--green)', fontSize: 22 }}>{fmtInt(inflow)}</div><div className="kpi-sub">план {fmtInt(planIncome)} + дебіторка {fmtInt(extra?.receivable || 0)} + замовлення {fmtInt(extra?.activeOrders || 0)}</div></div>
        <div className="kpi"><div className="kpi-label">Очікувані витрати</div><div className="kpi-value" style={{ color: 'var(--red)', fontSize: 22 }}>{fmtInt(outflow)}</div><div className="kpi-sub">план {fmtInt(planExpense)} + кредиторка {fmtInt(extra?.payable || 0)}</div></div>
        <div className="kpi"><div className="kpi-label">Прогнозований залишок</div><div className="kpi-value" style={{ color: projected >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 22 }}>{fmtInt(projected)}</div><div className="kpi-sub">поточний {net >= 0 ? '+' : '−'} {fmtInt(Math.abs(net))}</div></div>
      </div>
    </div>
  )
}

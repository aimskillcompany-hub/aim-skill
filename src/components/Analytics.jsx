import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Reports from './Reports'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))
const CASH_DIR = { income: 1, expense: -1, advance_out: -1, advance_return: 1 }

export default function Analytics({ user, onPage }) {
  const [tab, setTab] = useState('overview')
  const [period, setPeriod] = useState('month') // month, quarter, year, custom
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [to, setTo] = useState(() => new Date().toISOString().split('T')[0])

  // KPI
  const [stats, setStats] = useState({ revenue: 0, expenses: 0, net: 0, bankFlow: 0, cashBalance: 0, noArticle: 0 })
  const [debtors, setDebtors] = useState([])
  const [creditors, setCreditors] = useState([])
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(true)

  // Period presets
  useEffect(() => {
    const now = new Date()
    if (period === 'month') {
      setFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0])
      setTo(now.toISOString().split('T')[0])
    } else if (period === 'quarter') {
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      setFrom(qStart.toISOString().split('T')[0])
      setTo(now.toISOString().split('T')[0])
    } else if (period === 'year') {
      setFrom(new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0])
      setTo(now.toISOString().split('T')[0])
    }
  }, [period])

  useEffect(() => { loadOverview() }, [from, to])

  const loadOverview = async () => {
    setLoading(true)
    const [{ data: bankTxs }, { data: cashTxs }, { data: docs }, { data: contractors }] = await Promise.all([
      supabase.from('bank_transactions').select('amount, direction, date, article').eq('is_ignored', false).gte('date', from).lte('date', to),
      supabase.from('cash_transactions').select('amount, type'),
      supabase.from('generated_docs').select('doc_type, total, status, contractor_id, contractor_name, bank_transaction_id'),
      supabase.from('bank_transactions').select('amount, direction, contractor_id').eq('is_ignored', false),
    ])

    const all = bankTxs || []
    const revenue = all.filter(t => t.direction === 'Доходи').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const expenses = all.filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)

    // Bank balance (all time)
    const { data: allBank } = await supabase.from('bank_transactions').select('amount').eq('is_ignored', false)
    const bankFlow = (allBank || []).reduce((s, t) => s + (t.amount || 0), 0)
    const cashBalance = (cashTxs || []).reduce((s, t) => s + (CASH_DIR[t.type] || 0) * (t.amount || 0), 0)
    const noArticle = all.filter(t => !t.article?.trim()).length

    setStats({ revenue, expenses, net: revenue - expenses, bankFlow, cashBalance, noArticle })

    // Дебіторка / Кредиторка по контрагентах
    const allDocs = docs || []
    const allTxs = contractors || []

    // Групуємо по contractor_id
    const contMap = {}
    allDocs.forEach(d => {
      if (!d.contractor_id || d.status === 'cancelled') return
      if (!contMap[d.contractor_id]) contMap[d.contractor_id] = { name: d.contractor_name, outDocs: 0, inDocs: 0, income: 0, expense: 0 }
      if (['waybill', 'serviceAct'].includes(d.doc_type)) contMap[d.contractor_id].outDocs += parseFloat(d.total) || 0
      if (d.doc_type === 'incomingWaybill') contMap[d.contractor_id].inDocs += parseFloat(d.total) || 0
    })
    allTxs.forEach(t => {
      if (!t.contractor_id || !contMap[t.contractor_id]) return
      if (t.direction === 'Доходи') contMap[t.contractor_id].income += Math.abs(t.amount || 0)
      if (t.direction === 'Витрати') contMap[t.contractor_id].expense += Math.abs(t.amount || 0)
    })

    const debtList = [], creditList = []
    Object.entries(contMap).forEach(([id, c]) => {
      const debit = c.outDocs - c.income
      const credit = c.inDocs - c.expense
      if (debit > 100) debtList.push({ id, name: c.name, amount: debit, docs: c.outDocs, paid: c.income })
      if (credit > 100) creditList.push({ id, name: c.name, amount: credit, docs: c.inDocs, paid: c.expense })
    })
    setDebtors(debtList.sort((a, b) => b.amount - a.amount))
    setCreditors(creditList.sort((a, b) => b.amount - a.amount))

    // Chart — по місяцях
    const monthMap = {}
    ;(bankTxs || []).forEach(t => {
      const m = t.date?.substring(0, 7)
      if (!m) return
      if (!monthMap[m]) monthMap[m] = { month: m, revenue: 0, expenses: 0 }
      if (t.direction === 'Доходи') monthMap[m].revenue += Math.abs(t.amount || 0)
      if (t.direction === 'Витрати') monthMap[m].expenses += Math.abs(t.amount || 0)
    })
    const chart = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month))
    chart.forEach(m => { m.net = m.revenue - m.expenses })
    setChartData(chart)

    setLoading(false)
  }

  const totalDebt = debtors.reduce((s, d) => s + d.amount, 0)
  const totalCredit = creditors.reduce((s, d) => s + d.amount, 0)

  const TABS = [
    { id: 'overview', label: 'Огляд', icon: 'ti-chart-dots-3' },
    { id: 'pl', label: 'P&L', icon: 'ti-report-analytics' },
    { id: 'cashflow', label: 'Грошовий потік', icon: 'ti-cash' },
    { id: 'debt', label: 'Заборгованість', icon: 'ti-scale' },
  ]

  return (
    <div>
      <div className="page-header">
        <h1>Звітність</h1>
        <p>Управлінська аналітика та фінансові звіти</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />{t.label}
          </button>
        ))}
      </div>

      {/* ═══ ОГЛЯД ═══ */}
      {tab === 'overview' && (
        <div>
          {/* Period filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {[{ id: 'month', label: 'Місяць' }, { id: 'quarter', label: 'Квартал' }, { id: 'year', label: 'Рік' }, { id: 'custom', label: 'Довільний' }].map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)} style={{
                padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
                background: period === p.id ? 'var(--blue)' : 'var(--surface)', color: period === p.id ? '#fff' : 'var(--text2)',
                fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
              }}>{p.label}</button>
            ))}
            {period === 'custom' && (
              <>
                <input type="date" className="form-input" style={{ height: 34, fontSize: 12, width: 140 }} value={from} onChange={e => setFrom(e.target.value)} />
                <span style={{ color: 'var(--text3)' }}>—</span>
                <input type="date" className="form-input" style={{ height: 34, fontSize: 12, width: 140 }} value={to} onChange={e => setTo(e.target.value)} />
              </>
            )}
            <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 8 }}>{from} — {to}</span>
          </div>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 16 }}>
            <div className="kpi">
              <div className="kpi-label">Виручка</div>
              <div className="kpi-value" style={{ color: 'var(--green)' }}>{fmt(stats.revenue)}</div>
              <div className="kpi-sub">грн</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Витрати</div>
              <div className="kpi-value" style={{ color: 'var(--red)' }}>{fmt(stats.expenses)}</div>
              <div className="kpi-sub">грн</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Чистий результат</div>
              <div className="kpi-value" style={{ color: stats.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{stats.net >= 0 ? '+' : '−'}{fmt(stats.net)}</div>
              <div className="kpi-sub">грн</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Банк</div>
              <div className="kpi-value" style={{ color: stats.bankFlow >= 0 ? 'var(--green)' : 'var(--red)' }}>{stats.bankFlow >= 0 ? '+' : '−'}{fmt(stats.bankFlow)}</div>
              <div className="kpi-sub">грн (весь час)</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Каса</div>
              <div className="kpi-value" style={{ color: stats.cashBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>{stats.cashBalance >= 0 ? '+' : '−'}{fmt(stats.cashBalance)}</div>
              <div className="kpi-sub">грн</div>
            </div>
          </div>

          {/* Дебіторка / Кредиторка summary */}
          {(totalDebt > 0 || totalCredit > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div className="kpi" style={{ borderLeft: '3px solid var(--amber)', cursor: 'pointer' }} onClick={() => setTab('debt')}>
                <div className="kpi-label">Дебіторка (нам винні)</div>
                <div className="kpi-value" style={{ color: 'var(--amber)' }}>{fmt(totalDebt)}</div>
                <div className="kpi-sub">{debtors.length} контрагентів · грн</div>
              </div>
              <div className="kpi" style={{ borderLeft: '3px solid var(--red)', cursor: 'pointer' }} onClick={() => setTab('debt')}>
                <div className="kpi-label">Кредиторка (ми винні)</div>
                <div className="kpi-value" style={{ color: 'var(--red)' }}>{fmt(totalCredit)}</div>
                <div className="kpi-sub">{creditors.length} контрагентів · грн</div>
              </div>
            </div>
          )}

          {/* Без статті */}
          {stats.noArticle > 0 && (
            <div className="kpi" style={{ marginBottom: 16, cursor: 'pointer', borderLeft: '3px solid var(--red)' }} onClick={() => onPage?.('registry')}>
              <div className="kpi-label">Без статті</div>
              <div className="kpi-value" style={{ color: 'var(--red)' }}>{stats.noArticle}</div>
              <div className="kpi-sub">транзакцій потребують класифікації</div>
            </div>
          )}

          {/* Chart */}
          {chartData.length > 1 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Виручка та витрати</div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text3)' }} axisLine={false} tickLine={false} width={52}
                    tickFormatter={v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'k' : v} />
                  <Tooltip formatter={v => fmt(v) + ' грн'} />
                  <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="Доходи" fill="#4A7C59" radius={[4,4,0,0]} maxBarSize={48} />
                  <Bar dataKey="expenses" name="Витрати" fill="#9B3A3A" radius={[4,4,0,0]} maxBarSize={48} />
                  <Line dataKey="net" name="Результат" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ═══ P&L ═══ */}
      {tab === 'pl' && <Reports initialTab="pl" />}

      {/* ═══ ГРОШОВИЙ ПОТІК ═══ */}
      {tab === 'cashflow' && <Reports initialTab="cf" />}

      {/* ═══ ЗАБОРГОВАНІСТЬ ═══ */}
      {tab === 'debt' && (
        <div>
          {debtors.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title" style={{ color: 'var(--amber)' }}>Дебіторська заборгованість (нам винні)</div>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Контрагент</th>
                      <th style={{ textAlign: 'right' }}>Відвантажено</th>
                      <th style={{ textAlign: 'right' }}>Оплачено</th>
                      <th style={{ textAlign: 'right' }}>Борг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtors.map(d => (
                      <tr key={d.id} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                        onClick={() => onPage?.('contractors', d.id)}>
                        <td style={{ fontWeight: 500 }}>{d.name}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.docs)} грн</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--green)' }}>{fmt(d.paid)} грн</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--amber)', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.amount)} грн</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                      <td>Разом</td>
                      <td style={{ textAlign: 'right' }}>{fmt(debtors.reduce((s, d) => s + d.docs, 0))} грн</td>
                      <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmt(debtors.reduce((s, d) => s + d.paid, 0))} грн</td>
                      <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmt(totalDebt)} грн</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {creditors.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title" style={{ color: 'var(--red)' }}>Кредиторська заборгованість (ми винні)</div>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Контрагент</th>
                      <th style={{ textAlign: 'right' }}>Отримано</th>
                      <th style={{ textAlign: 'right' }}>Оплачено</th>
                      <th style={{ textAlign: 'right' }}>Борг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditors.map(d => (
                      <tr key={d.id} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                        onClick={() => onPage?.('contractors', d.id)}>
                        <td style={{ fontWeight: 500 }}>{d.name}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.docs)} грн</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--green)' }}>{fmt(d.paid)} грн</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.amount)} грн</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                      <td>Разом</td>
                      <td style={{ textAlign: 'right' }}>{fmt(creditors.reduce((s, d) => s + d.docs, 0))} грн</td>
                      <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmt(creditors.reduce((s, d) => s + d.paid, 0))} грн</td>
                      <td style={{ textAlign: 'right', color: 'var(--red)' }}>{fmt(totalCredit)} грн</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {debtors.length === 0 && creditors.length === 0 && (
            <div className="card">
              <div className="empty"><p>Немає заборгованостей</p></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

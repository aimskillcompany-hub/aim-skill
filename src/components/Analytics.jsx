import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Reports from './Reports'
import Budget from './Budget'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'

import { fmtInt as fmt } from '../lib/fmt'

const CASH_DIR = { income: 1, expense: -1, advance: -1, advance_return: 1, bank_to_cash: 1, cash_to_bank: -1 }

// Розгортання планів: шаблони → конкретні місяці
function getMonthRange(from, to) {
  const months = []
  let [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (fy < ty || (fy === ty && fm <= tm)) {
    months.push(`${fy}-${String(fm).padStart(2, '0')}`)
    fm++; if (fm > 12) { fm = 1; fy++ }
  }
  return months
}
function expandPlans(allPlans) {
  const result = []
  allPlans.forEach(p => {
    if (p.is_template && p.template_from && p.template_to) {
      getMonthRange(p.template_from, p.template_to).forEach(m => result.push({ ...p, year_month: m }))
    } else if (p.year_month) {
      result.push(p)
    }
  })
  return result
}

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
  const [forecast, setForecast] = useState(null)
  const [cashFc, setCashFc] = useState(null)
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
    const [{ data: bankTxs }, { data: cashTxs }, { data: docs }, { data: contractors }, { data: items }, { data: contrs }] = await Promise.all([
      supabase.from('bank_transactions').select('id, amount, amount_net, vat_amount, direction, date, article, contractor_id').eq('is_ignored', false).eq('is_validated', true).gte('date', from).lte('date', to),
      supabase.from('cash_transactions').select('amount, type'),
      supabase.from('generated_docs').select('doc_type, doc_date, total, status, contractor_id, contractor_name, bank_transaction_id'),
      supabase.from('bank_transactions').select('amount, direction, contractor_id').eq('is_ignored', false).eq('is_validated', true),
      supabase.from('transaction_items').select('bank_transaction_id, amount, vat_rate'),
      supabase.from('contractors').select('id, is_vat_payer').eq('status', 'active'),
    ])

    const all = bankTxs || []
    // Побудувати map: bank_tx_id → { net, vat } з transaction_items
    const txNetMap = {}
    // items.amount = сума З ПДВ. net = amount / (1 + rate/100)
    ;(items || []).forEach(item => {
      if (!item.bank_transaction_id) return
      const amt = parseFloat(item.amount) || 0
      const vatRate = parseFloat(item.vat_rate) || 0
      const net = vatRate > 0 ? amt / (1 + vatRate / 100) : amt
      const vat = amt - net
      if (!txNetMap[item.bank_transaction_id]) txNetMap[item.bank_transaction_id] = { net: 0, vat: 0 }
      txNetMap[item.bank_transaction_id].net += net
      txNetMap[item.bank_transaction_id].vat += vat
    })

    // Карта контрагентів: чи платник ПДВ
    const vatPayerMap = {}
    ;(contrs || []).forEach(c => { vatPayerMap[c.id] = c.is_vat_payer })

    let revenueGross = 0, revenueVat = 0
    let expensesGross = 0, expensesVat = 0
    all.forEach(t => {
      const gross = Math.abs(t.amount || 0)
      const mapped = txNetMap[t.id]
      let vat
      if (mapped) {
        // Є items — точний ПДВ
        vat = mapped.vat
      } else if (t.direction === 'Доходи') {
        // Ми продаємо — завжди з ПДВ (ми платник)
        vat = gross * 20 / 120
      } else if (t.contractor_id && vatPayerMap[t.contractor_id]) {
        // Купуємо у платника ПДВ
        vat = gross * 20 / 120
      } else {
        // Купуємо у НЕ платника ПДВ або невідомо
        vat = 0
      }
      if (t.direction === 'Доходи') { revenueGross += gross; revenueVat += vat }
      if (t.direction === 'Витрати') { expensesGross += gross; expensesVat += vat }
    })
    const revenueNet = revenueGross - revenueVat
    const expensesNet = expensesGross - expensesVat

    // Bank balance (all time)
    const { data: allBank } = await supabase.from('bank_transactions').select('amount').eq('is_ignored', false).eq('is_validated', true)
    const bankFlow = (allBank || []).reduce((s, t) => s + (t.amount || 0), 0)
    const cashBalance = (cashTxs || []).reduce((s, t) => s + (CASH_DIR[t.type] || 0) * (t.amount || 0), 0)
    const noArticle = all.filter(t => !t.article?.trim()).length

    setStats({ revenueGross, expensesGross, revenueNet, expensesNet, revenueVat, expensesVat, net: revenueNet - expensesNet, netGross: revenueGross - expensesGross, bankFlow, cashBalance, noArticle })

    // Дебіторка / Кредиторка по контрагентах
    const allDocs = docs || []
    const allTxs = contractors || []

    // Групуємо по contractor_id — неоплачені документи з aging
    const today = new Date()
    const contMap = {}
    const agingBucket = (docDate) => {
      if (!docDate) return '120+'
      const days = Math.floor((today - new Date(docDate)) / 86400000)
      if (days <= 30) return '0-30'
      if (days <= 60) return '31-60'
      if (days <= 90) return '61-90'
      return '90+'
    }
    const emptyAging = () => ({ '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 })

    allDocs.forEach(d => {
      if (!d.contractor_id || d.status === 'cancelled') return
      if (!contMap[d.contractor_id]) contMap[d.contractor_id] = { name: d.contractor_name, unpaidOut: 0, unpaidIn: 0, totalOut: 0, totalIn: 0, agingOut: emptyAging(), agingIn: emptyAging() }
      const amt = parseFloat(d.total) || 0
      const bucket = agingBucket(d.doc_date)
      if (['waybill', 'serviceAct'].includes(d.doc_type)) {
        contMap[d.contractor_id].totalOut += amt
        if (!d.bank_transaction_id) { contMap[d.contractor_id].unpaidOut += amt; contMap[d.contractor_id].agingOut[bucket] += amt }
      }
      if (d.doc_type === 'incomingWaybill') {
        contMap[d.contractor_id].totalIn += amt
        if (!d.bank_transaction_id) { contMap[d.contractor_id].unpaidIn += amt; contMap[d.contractor_id].agingIn[bucket] += amt }
      }
    })

    const debtList = [], creditList = []
    Object.entries(contMap).forEach(([id, c]) => {
      if (c.unpaidOut > 100) debtList.push({ id, name: c.name, amount: c.unpaidOut, docs: c.totalOut, paid: c.totalOut - c.unpaidOut, aging: c.agingOut })
      if (c.unpaidIn > 100) creditList.push({ id, name: c.name, amount: c.unpaidIn, docs: c.totalIn, paid: c.totalIn - c.unpaidIn, aging: c.agingIn })
    })
    setDebtors(debtList.sort((a, b) => b.amount - a.amount))
    setCreditors(creditList.sort((a, b) => b.amount - a.amount))

    // Chart — по днях або тижнях (автоматично)
    const daysDiff = Math.ceil((new Date(to) - new Date(from)) / 86400000)
    const useWeeks = daysDiff > 60
    const bucketMap = {}
    ;(bankTxs || []).forEach(t => {
      if (!t.date) return
      let key
      if (useWeeks) {
        // Початок тижня (понеділок)
        const d = new Date(t.date)
        const day = d.getDay() || 7
        d.setDate(d.getDate() - day + 1)
        key = d.toISOString().split('T')[0]
      } else {
        key = t.date
      }
      if (!bucketMap[key]) bucketMap[key] = { month: key, revenue: 0, expenses: 0 }
      if (t.direction === 'Доходи') bucketMap[key].revenue += Math.abs(t.amount || 0)
      if (t.direction === 'Витрати') bucketMap[key].expenses -= Math.abs(t.amount || 0)
    })
    const chart = Object.values(bucketMap).sort((a, b) => a.month.localeCompare(b.month))
    chart.forEach(m => { m.net = m.revenue - m.expenses })
    setChartData(chart)

    // Cash Flow Forecast
    // Баланс = сума доходів - сума витрат (не просто sum amount)
    const bankIncome = (allTxs || []).filter(t => t.direction === 'Доходи').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const bankExpense = (allTxs || []).filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const bankBalance = bankIncome - bankExpense
    const cashBal = (cashTxs || []).reduce((s, t) => s + (CASH_DIR[t.type] || 0) * (t.amount || 0), 0)
    const currentBalance = bankBalance + cashBal

    const totalDebtors = debtList.reduce((s, d) => s + d.amount, 0)
    const totalCreditors = creditList.reduce((s, d) => s + d.amount, 0)

    // Замовлення в роботі (confirmed/in_progress)
    const activeOrders = allDocs.filter(d =>
      (d.doc_type === 'purchaseOrder' || d.doc_type === 'salesOrder') &&
      ['confirmed', 'in_progress'].includes(d.status)
    )
    const ordersIncome = activeOrders.filter(d => d.doc_type === 'salesOrder').reduce((s, d) => s + (parseFloat(d.total) || 0), 0)
    const ordersExpense = activeOrders.filter(d => d.doc_type === 'purchaseOrder').reduce((s, d) => s + (parseFloat(d.total) || 0), 0)

    // Середньомісячний потік за останні 3 місяці з bankTxs (має дати)
    const threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    const threeMonthsStr = threeMonthsAgo.toISOString().split('T')[0]
    const { data: recentBank } = await supabase.from('bank_transactions')
      .select('amount, direction, date').eq('is_ignored', false).eq('is_validated', true)
      .gte('date', threeMonthsStr)
    const recentIncome = (recentBank || []).filter(t => t.direction === 'Доходи').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const recentExpense = (recentBank || []).filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const monthsCount = Math.max(1, Math.ceil((Date.now() - threeMonthsAgo.getTime()) / (30 * 86400000)))
    const avgMonthlyNet = (recentIncome - recentExpense) / monthsCount

    // ── Грошовий прогноз на основі бюджету (plans) + дебіторки/кредиторки ──
    const now = new Date()
    const { data: allPlans } = await supabase.from('plans').select('*')
    // Плановий операційний нетто по місяцях (з бюджету, з розгортанням шаблонів)
    const planNetByMonth = {}
    expandPlans(allPlans || []).forEach(p => {
      if (!p.year_month) return
      const sign = p.direction === 'Доходи' ? 1 : p.direction === 'Витрати' ? -1 : 0
      planNetByMonth[p.year_month] = (planNetByMonth[p.year_month] || 0) + sign * (parseFloat(p.amount) || 0)
    })

    // Очікуване погашення дебіторки/кредиторки по місяцях за aging.
    // Свіжі (0-60 дн) — наступний місяць; старі (60+) — далі/під питанням.
    const debtByMonth = [0, 0, 0], credByMonth = [0, 0, 0]
    const spread = (aging, target) => {
      if (!aging) return
      target[0] += (aging['0-30'] || 0) + (aging['31-60'] || 0)
      target[1] += (aging['61-90'] || 0)
      target[2] += (aging['90+'] || 0)
    }
    debtList.forEach(d => spread(d.aging, debtByMonth))
    creditList.forEach(c => spread(c.aging, credByMonth))

    const monthNamesUk = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']
    const fcRows = []
    let bal = currentBalance
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const idx = i - 1
      const debtIn = debtByMonth[idx] || 0
      const ordIn = i === 1 ? ordersIncome : 0
      const credOut = credByMonth[idx] || 0
      const ordOut = i === 1 ? ordersExpense : 0
      const hasPlan = planNetByMonth[ym] !== undefined
      const opNet = hasPlan ? planNetByMonth[ym] : Math.round(avgMonthlyNet)
      const open = bal
      const close = open + debtIn + ordIn - credOut - ordOut + opNet
      fcRows.push({ ym, name: monthNamesUk[d.getMonth()], open, debtIn, ordIn, credOut, ordOut, opNet, hasPlan, close })
      bal = close
    }
    setCashFc({ opening: currentBalance, bankBalance, cashBal, rows: fcRows })

    setLoading(false)
  }

  const totalDebt = debtors.reduce((s, d) => s + d.amount, 0)
  const totalCredit = creditors.reduce((s, d) => s + d.amount, 0)

  const TABS = [
    { id: 'overview', label: 'Огляд', icon: 'ti-chart-dots-3' },
    { id: 'pl', label: 'P&L', icon: 'ti-report-analytics' },
    { id: 'budget', label: 'Бюджет', icon: 'ti-calendar-dollar' },
    { id: 'cashflow', label: 'Грошовий потік', icon: 'ti-cash' },
    { id: 'forecast', label: 'Прогноз', icon: 'ti-crystal-ball' },
    { id: 'debt', label: 'Заборгованість', icon: 'ti-scale' },
  ]

  return (
    <div>
      <div className="page-header">
        <h1>Звітність</h1>
        <p>Управлінська аналітика та фінансові звіти</p>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`tab-btn ${tab === t.id ? 'active' : ''}`}>
            <i className={`ti ${t.icon}`} />{t.label}
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
          <div className="kpi-grid cols-5">
            <div className="kpi">
              <div className="kpi-label">Виручка</div>
              <div className="kpi-value" style={{ color: 'var(--green)' }}>{fmt(stats.revenueGross)}</div>
              <div className="kpi-sub">грн</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Витрати</div>
              <div className="kpi-value" style={{ color: 'var(--red)' }}>{fmt(stats.expensesGross)}</div>
              <div className="kpi-sub">грн</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Результат</div>
              <div className="kpi-value" style={{ color: stats.netGross >= 0 ? 'var(--green)' : 'var(--red)' }}>{stats.netGross >= 0 ? '+' : '−'}{fmt(stats.netGross)}</div>
              <div className="kpi-sub">грн</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Банк</div>
              <div className="kpi-value" style={{ color: stats.bankFlow >= 0 ? 'var(--green)' : 'var(--red)' }}>{stats.bankFlow >= 0 ? '+' : '−'}{fmt(stats.bankFlow)}</div>
              <div className="kpi-sub">весь час</div>
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
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false}
                    tickFormatter={v => { const d = v.split('-'); return d.length === 3 ? `${d[2]}.${d[1]}` : v }} />
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

      {/* ═══ БЮДЖЕТ (План P&L) ═══ */}
      {tab === 'budget' && <Budget user={user} />}

      {/* ═══ ГРОШОВИЙ ПОТІК ═══ */}
      {tab === 'cashflow' && <Reports initialTab="cf" />}

      {/* ═══ ПРОГНОЗ ═══ */}
      {tab === 'forecast' && cashFc && (() => {
        const balColor = n => n >= 0 ? 'var(--green)' : 'var(--red)'
        const rows = cashFc.rows
        const flowTd = (key, v, sign) => (
          <td key={key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: v ? (sign > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)' }}>
            {v ? (sign > 0 ? '+' : '−') + fmt(v) : '—'}
          </td>
        )
        const nowTd = <td style={{ textAlign: 'right', color: 'var(--text3)' }}>—</td>

        return (
          <div>
            {stats.noArticle > 10 && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 16 }} />
                Прогноз базується тільки на валідованих даних. У вас {stats.noArticle} транзакцій без статті — валідуйте їх для точнішого прогнозу.
              </div>
            )}

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Грошовий прогноз на 3 місяці</div>
              <div className="tbl-wrap" style={{ marginBottom: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 240 }}>Рух коштів</th>
                      <th style={{ textAlign: 'right', minWidth: 110 }}>Зараз</th>
                      {rows.map((r, i) => (
                        <th key={r.ym} style={{ textAlign: 'right', minWidth: 110, background: i % 2 ? undefined : 'var(--surface2)' }}>{r.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Залишок на початок */}
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ fontSize: 13, fontWeight: 500 }}>Залишок на початок</td>
                      <td style={{ textAlign: 'right', fontWeight: 500, color: balColor(cashFc.opening), fontVariantNumeric: 'tabular-nums' }}>{fmt(cashFc.opening)}</td>
                      {rows.map(r => (
                        <td key={r.ym} style={{ textAlign: 'right', color: balColor(r.open), fontVariantNumeric: 'tabular-nums' }}>{fmt(r.open)}</td>
                      ))}
                    </tr>
                    {/* Дебіторка */}
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ fontSize: 13 }}>+ Дебіторка<div style={{ fontSize: 10, color: 'var(--text3)' }}>нам винні — за строком боргу</div></td>
                      {nowTd}
                      {rows.map(r => flowTd(r.ym, r.debtIn, 1))}
                    </tr>
                    {/* Замовлення клієнтів */}
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ fontSize: 13 }}>+ Замовлення клієнтів<div style={{ fontSize: 10, color: 'var(--text3)' }}>підтверджені</div></td>
                      {nowTd}
                      {rows.map(r => flowTd(r.ym, r.ordIn, 1))}
                    </tr>
                    {/* Кредиторка */}
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ fontSize: 13 }}>− Кредиторка<div style={{ fontSize: 10, color: 'var(--text3)' }}>ми винні — за строком боргу</div></td>
                      {nowTd}
                      {rows.map(r => flowTd(r.ym, r.credOut, -1))}
                    </tr>
                    {/* Замовлення постачальникам */}
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ fontSize: 13 }}>− Замовлення постачальникам<div style={{ fontSize: 10, color: 'var(--text3)' }}>підтверджені закупки</div></td>
                      {nowTd}
                      {rows.map(r => flowTd(r.ym, r.ordOut, -1))}
                    </tr>
                    {/* Операційний потік */}
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ fontSize: 13 }}>± Операційний потік<div style={{ fontSize: 10, color: 'var(--text3)' }}>план з бюджету або середній тренд</div></td>
                      {nowTd}
                      {rows.map(r => (
                        <td key={r.ym} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.opNet >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {r.opNet ? (r.opNet > 0 ? '+' : '−') + fmt(r.opNet) : '—'}
                          <div style={{ fontSize: 9, color: r.hasPlan ? 'var(--blue)' : 'var(--text3)' }}>{r.hasPlan ? 'план' : 'тренд'}</div>
                        </td>
                      ))}
                    </tr>
                    {/* Залишок на кінець */}
                    <tr style={{ borderTop: '3px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                      <td>= Залишок на кінець</td>
                      <td style={{ textAlign: 'right', color: balColor(cashFc.opening), fontVariantNumeric: 'tabular-nums' }}>{fmt(cashFc.opening)}</td>
                      {rows.map(r => (
                        <td key={r.ym} style={{ textAlign: 'right', color: balColor(r.close), fontVariantNumeric: 'tabular-nums', background: r.close < 0 ? 'var(--red-bg)' : undefined }}>
                          {fmt(r.close)}
                          {r.close < 0 && <div style={{ fontSize: 10, color: 'var(--red)' }}>⚠ дефіцит</div>}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, lineHeight: 1.5 }}>
                <strong>Як читати:</strong> залишок на початок наступного місяця = залишок на кінець попереднього. Дебіторка/кредиторка рознесені за строком боргу (свіжі — найближчий місяць). Операційний потік береться з <b>Бюджету</b> (якщо є план на місяць), інакше — середній потік за 3 місяці.
              </div>
            </div>

            {/* Перенесено: порівняння плану й факту тепер у вкладках «Бюджет» та «P&L → Порівняння» */}
            <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <i className="ti ti-arrows-diff" style={{ fontSize: 22, color: 'var(--blue)' }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Порівняння плану та факту переїхало</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                  Вносьте бюджет у вкладці <b>Бюджет</b>, а звіряйте з фактом у <b>P&L → Порівняння</b>.
                </div>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => setTab('budget')} style={{ width: 'auto' }}>До бюджету</button>
              <button className="btn btn-sm btn-primary" onClick={() => setTab('pl')} style={{ width: 'auto' }}>До P&L</button>
            </div>

          </div>
        )
      })()}

      {/* ═══ ЗАБОРГОВАНІСТЬ ═══ */}
      {tab === 'debt' && (
        <div>
          {[
            { data: debtors, title: 'Дебіторська заборгованість (нам винні)', color: 'var(--amber)', total: totalDebt, docLabel: 'Відвантажено' },
            { data: creditors, title: 'Кредиторська заборгованість (ми винні)', color: 'var(--red)', total: totalCredit, docLabel: 'Отримано' },
          ].filter(g => g.data.length > 0).map(g => (
            <div key={g.title} className="card" style={{ marginBottom: 16 }}>
              <div className="card-title" style={{ color: g.color }}>{g.title}</div>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Контрагент</th>
                      <th style={{ textAlign: 'right' }}>Борг</th>
                      <th style={{ textAlign: 'right', fontSize: 11 }}>0-30 дн</th>
                      <th style={{ textAlign: 'right', fontSize: 11 }}>31-60 дн</th>
                      <th style={{ textAlign: 'right', fontSize: 11 }}>61-90 дн</th>
                      <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--red)' }}>90+ дн</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.data.map(d => (
                      <tr key={d.id} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                        onClick={() => onPage?.('contractors', d.id)}>
                        <td style={{ fontWeight: 500 }}>{d.name}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: g.color, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.amount)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>{d.aging?.['0-30'] > 0 ? fmt(d.aging['0-30']) : '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>{d.aging?.['31-60'] > 0 ? fmt(d.aging['31-60']) : '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--amber)' }}>{d.aging?.['61-90'] > 0 ? fmt(d.aging['61-90']) : '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--red)', fontWeight: d.aging?.['90+'] > 0 ? 600 : 400 }}>{d.aging?.['90+'] > 0 ? fmt(d.aging['90+']) : '—'}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                      <td>Разом</td>
                      <td style={{ textAlign: 'right', color: g.color }}>{fmt(g.total)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(g.data.reduce((s, d) => s + (d.aging?.['0-30'] || 0), 0))}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(g.data.reduce((s, d) => s + (d.aging?.['31-60'] || 0), 0))}</td>
                      <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmt(g.data.reduce((s, d) => s + (d.aging?.['61-90'] || 0), 0))}</td>
                      <td style={{ textAlign: 'right', color: 'var(--red)' }}>{fmt(g.data.reduce((s, d) => s + (d.aging?.['90+'] || 0), 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

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

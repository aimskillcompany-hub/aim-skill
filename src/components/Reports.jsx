import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS, PL_SIGN } from '../lib/articles'
import PlTable, { buildPlData } from './PlTable'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area, Cell, PieChart, Pie,
} from 'recharts'

const fmt  = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))
const fmtS = n => n === 0 ? '—' : (n > 0 ? '+' : '−') + fmt(n)
const fmtK = n => {
  const abs = Math.abs(n || 0)
  if (abs >= 1000000) return (n/1000000).toFixed(1) + ' млн'
  if (abs >= 1000)    return (n/1000).toFixed(0) + ' тис.'
  return Math.round(n).toString()
}
const numColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text3)'

const ARTICLE_TYPE_ORDER = ['income','expense','transfer','other']
const SECTION_LABELS = { income:'Доходи', expense:'Витрати', transfer:'Перекази / ПФД', other:'Інше' }
const SECTION_SIGN   = { income:+1, expense:-1, transfer:+1, other:+1 }
const EXPENSE_COLORS = ['#2563EB','#6B6B6B','#0891b2','#059669','#4A7C59','#9B3A3A','#6B6B6B','#2563EB','#4A7C59','#ca8a04']
const DIRS = ['Витрати','Доходи','ПФД','Внутрішні перекази','Відсотки банку','Інше']

// Абсолютна сума для P&L (direction визначає секцію, amount завжди показується додатнім)
const absAmount = (tx) => Math.abs(tx.amount || 0)

// ── Planning helpers ─────────────────────────────────────────────────────────
function getMonthRange(from, to) {
  const months = []
  let [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (fy < ty || (fy === ty && fm <= tm)) {
    months.push(`${fy}-${String(fm).padStart(2,'0')}`)
    fm++; if (fm > 12) { fm = 1; fy++ }
  }
  return months
}

function expandPlans(allPlans) {
  const result = []
  allPlans.forEach(p => {
    if (p.is_template && p.template_from && p.template_to) {
      getMonthRange(p.template_from, p.template_to).forEach(m => {
        result.push({ ...p, year_month: m })
      })
    } else if (p.year_month) {
      result.push(p)
    }
  })
  return result
}

function getNextMonths(n = 6) {
  const months = []
  const now = new Date()
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
  }
  return months
}

const currentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
}

const DIR_TO_TYPE = {
  'Витрати':'expense','Доходи':'income','ПФД':'transfer',
  'Внутрішні перекази':'transfer','Відсотки банку':'income','Інше':'other',
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:12.5, boxShadow:'0 1px 2px rgba(0,0,0,0.05)' }}>
      <div style={{ fontWeight:600, marginBottom:6 }}>{label}</div>
      {payload.map((p, i) => {
        // Витрати зберігаються як позитивне число, показуємо з мінусом
        const isExpenses = p.dataKey === 'expenses'
        const displayVal = isExpenses ? -p.value : p.value
        return (
          <div key={i} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:3 }}>
            <span style={{ width:10, height:10, borderRadius:2, background:p.color, flexShrink:0 }} />
            <span style={{ color:'var(--text2)' }}>{p.name}:</span>
            <span style={{ fontWeight:600, color: displayVal < 0 ? 'var(--red)' : 'var(--green)' }}>
              {displayVal >= 0 ? '+' : '−'}{fmt(displayVal)} грн
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function Reports({ initialTab }) {
  const [loading, setLoading]       = useState(true)
  const [articles, setArticles]     = useState([])
  const [months, setMonths]         = useState([])
  const [artData, setArtData]       = useState({}) // article -> month -> {sum, txs[]}
  const [monthly, setMonthly]       = useState([]) // for charts
  const [expenseByArt, setExpenseByArt] = useState([])
  const [drillDown, setDrillDown]   = useState(null)
  const [editTx, setEditTx]         = useState(null)
  const [editForm, setEditForm]     = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [allArticles, setAllArticles] = useState([])
  const [projects, setProjects]     = useState([])
  const [planData, setPlanData]     = useState({}) // article -> month -> planSum
  const [planMonths, setPlanMonths] = useState([]) // future months with plans
  const [rptGran, setRptGran]     = useState('month') // day | week | month
  const [rptFrom, setRptFrom]     = useState('')
  const [rptTo, setRptTo]         = useState('')
  const [rawTxs, setRawTxs]       = useState([])
  const [compareMode, setCompareMode] = useState(false)
  const [cfMonthly, setCfMonthly]   = useState([])

  const rptPeriodKey = (dateStr) => {
    if (!dateStr) return null
    if (rptGran === 'day') return dateStr
    if (rptGran === 'week') {
      const d = new Date(dateStr)
      const day = d.getDay() || 7
      d.setDate(d.getDate() - day + 1)
      return d.toISOString().split('T')[0]
    }
    return dateStr.substring(0, 7)
  }

  useEffect(() => {
    supabase.from('projects').select('id,name').eq('status','active').order('name').then(({ data }) => setProjects(data || []))

    // Fetch plans
    supabase.from('plans').select('*').then(({ data: plns }) => {
      const expanded = expandPlans(plns || [])
      const grouped = {}
      expanded.forEach(p => {
        const art = p.article || '(без статті)'
        if (!grouped[art]) grouped[art] = {}
        if (!grouped[art][p.year_month]) grouped[art][p.year_month] = 0
        const sign = p.direction === 'Доходи' ? 1 : -1
        grouped[art][p.year_month] += sign * (p.amount || 0)
      })
      setPlanData(grouped)
      // Future months that have plans
      const now = currentMonth()
      const futurePlannedMonths = [...new Set(expanded.map(p => p.year_month).filter(m => m > now))].sort()
      setPlanMonths(futurePlannedMonths)
    })
    fetchArticles().then(setAllArticles)
    Promise.all([
      fetchArticles(),
      supabase.from('bank_transactions').select('id,date,amount,direction,article,counterparty,description,is_ignored').eq('is_ignored', false).order('date'),
    ]).then(([arts, { data: txs }]) => {
      // Normalize field names for compatibility
      ;(txs || []).forEach(t => { t.contractor = t.counterparty; t.projects = null })

      // CF from all transactions (not just Доходи/Витрати)
      const cfByMonth = {}
      ;(txs || []).forEach(tx => {
        const m = tx.date?.substring(0,7)
        if (!m) return
        if (!cfByMonth[m]) cfByMonth[m] = { month:m, inflow:0, outflow:0 }
        if (tx.amount > 0) cfByMonth[m].inflow += tx.amount
        else cfByMonth[m].outflow += Math.abs(tx.amount)
      })
      const cfMonths = Object.keys(cfByMonth).sort()
      let cfCum = 0
      setCfMonthly(cfMonths.map(m => {
        const d = cfByMonth[m]
        const net = d.inflow - d.outflow
        cfCum += net
        return { label: m, inflow: d.inflow, outflow: d.outflow, net, cumBalance: cfCum }
      }))

      // P&L тільки Доходи і Витрати — інші типи (ПФД, Внутрішні перекази, Інше) не враховуються
      const all = (txs || []).filter(t => t.direction === 'Доходи' || t.direction === 'Витрати')
      setArticles(arts)
      setRawTxs(all)

      // ── Extract sorted months ───────────────────────────────────────────
      const mSet = new Set(all.map(t => t.date?.substring(0,7)).filter(Boolean))
      const sortedMonths = [...mSet].sort()
      setMonths(sortedMonths)

      // ── Group by article + month ────────────────────────────────────────
      const grouped = {}
      all.forEach(tx => {
        const m   = tx.date?.substring(0,7)
        // Розділяємо "без статті" на доходи і витрати
        const art = tx.article || (tx.direction === 'Доходи' ? '(без статті: доходи)' : '(без статті: витрати)')
        if (!grouped[art])    grouped[art] = {}
        if (!grouped[art][m]) grouped[art][m] = { sum: 0, txs: [] }
        grouped[art][m].sum += absAmount(tx)
        grouped[art][m].txs.push(tx)
      })
      setArtData(grouped)

      // ── Monthly aggregates for charts ───────────────────────────────────
      const byMonth = {}
      all.forEach(tx => {
        const m = tx.date?.substring(0,7)
        if (!m) return
        if (!byMonth[m]) byMonth[m] = { month:m, revenue:0, expenses:0, pfd:0, other:0 }
        const abs = Math.abs(tx.amount || 0)
        if      (tx.direction==='Доходи')  byMonth[m].revenue  += abs
        else if (tx.direction==='Витрати') byMonth[m].expenses += abs
        else if (tx.direction==='ПФД')     byMonth[m].pfd      += (tx.amount || 0)
        else                               byMonth[m].other    += (tx.amount || 0)
      })
      let cum = 0
      const mArr = sortedMonths.map(m => {
        const d = byMonth[m] || { revenue:0, expenses:0, pfd:0, other:0 }
        const net = d.revenue - d.expenses
        cum += net + d.pfd + d.other
        return { ...d, net, cumCF:cum, label: m.replace('2025-','').replace('2026-',"'26-") }
      })
      setMonthly(mArr)

      // ── Expense breakdown for pie ────────────────────────────────────────
      const expByArt = {}
      all.filter(t => t.direction==='Витрати').forEach(tx => {
        const art = tx.article || 'Інше'
        expByArt[art] = (expByArt[art]||0) + Math.abs(tx.amount||0)
      })
      setExpenseByArt(Object.entries(expByArt).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({ name:name.substring(0,28), fullName:name, value })))

      setLoading(false)
    })
  }, [])

  // Re-group data when granularity or date range changes
  useEffect(() => {
    if (!rawTxs.length) return
    // Filter by date range
    const filtered = rawTxs.filter(tx => {
      if (rptFrom && tx.date < rptFrom) return false
      if (rptTo && tx.date > rptTo) return false
      return true
    })
    // Re-group by period
    const pSet = new Set(filtered.map(t => rptPeriodKey(t.date)).filter(Boolean))
    const sortedPeriods = [...pSet].sort()
    setMonths(sortedPeriods)

    const grouped = {}
    filtered.forEach(tx => {
      const m = rptPeriodKey(tx.date)
      if (!m) return
      const art = tx.article || (tx.direction === 'Доходи' ? '(без статті: доходи)' : '(без статті: витрати)')
      if (!grouped[art]) grouped[art] = {}
      if (!grouped[art][m]) grouped[art][m] = { sum: 0, txs: [] }
      grouped[art][m].sum += absAmount(tx)
      grouped[art][m].txs.push(tx)
    })
    setArtData(grouped)

    // Monthly aggregates for charts
    const byPeriod = {}
    filtered.forEach(tx => {
      const m = rptPeriodKey(tx.date)
      if (!m) return
      if (!byPeriod[m]) byPeriod[m] = { month:m, revenue:0, expenses:0, pfd:0, other:0 }
      const abs = Math.abs(tx.amount || 0)
      if (tx.direction==='Доходи') byPeriod[m].revenue += abs
      else if (tx.direction==='Витрати') byPeriod[m].expenses += abs
      else if (tx.direction==='ПФД') byPeriod[m].pfd += (tx.amount || 0)
      else byPeriod[m].other += (tx.amount || 0)
    })
    let cum = 0
    setMonthly(sortedPeriods.map(m => {
      const d = byPeriod[m] || { revenue:0, expenses:0, pfd:0, other:0 }
      const net = d.revenue - d.expenses
      cum += net + d.pfd + d.other
      return { ...d, net, cumCF:cum, label: m.length > 7 ? m.substring(5) : m }
    }))

    // Expense pie
    const expByArt = {}
    filtered.filter(t => t.direction==='Витрати').forEach(tx => {
      const art = tx.article || 'Інше'
      expByArt[art] = (expByArt[art]||0) + Math.abs(tx.amount||0)
    })
    setExpenseByArt(Object.entries(expByArt).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({ name:name.substring(0,28), fullName:name, value })))
  }, [rptGran, rptFrom, rptTo, rawTxs])

  const openEdit = (tx) => {
    setEditForm({
      id: tx.id,
      date: tx.date,
      contractor: tx.contractor || '',
      amount: tx.amount,
      direction: tx.direction,
      article: tx.article || '',
      project_id: tx.project_id || '',
      description: tx.description || '',
    })
    setEditTx(tx)
  }

  const handleEditSave = async () => {
    setEditSaving(true)
    const { error } = await supabase.from('bank_transactions').update({
      direction: editForm.direction,
      article: editForm.article || null,
      description: editForm.description || null,
    }).eq('id', editForm.id)

    if (!error) {
      setEditTx(null)
      // Перезавантажуємо дані — оновлюємо drill-down і таблицю
      Promise.all([
        fetchArticles(),
        supabase.from('bank_transactions').select('id,date,amount,direction,article,counterparty,description,is_ignored').eq('is_ignored', false).order('date'),
      ]).then(([arts, { data: txs }]) => {
        ;(txs || []).forEach(t => { t.contractor = t.counterparty; t.projects = null })
        const all = (txs || []).filter(t => t.direction === 'Доходи' || t.direction === 'Витрати')
        // Re-group artData
        const grouped = {}
        all.forEach(tx => {
          const m   = tx.date?.substring(0,7)
          const art = tx.article || (tx.direction === 'Доходи' ? '(без статті: доходи)' : '(без статті: витрати)')
          if (!grouped[art])    grouped[art] = {}
          if (!grouped[art][m]) grouped[art][m] = { sum: 0, txs: [] }
          grouped[art][m].sum += absAmount(tx)
          grouped[art][m].txs.push(tx)
        })
        setArtData(grouped)
        // Оновлюємо drill-down якщо відкритий
        if (drillDown) {
          const updTxs = (drillDown.txs || []).map(t =>
            t.id === editForm.id ? { ...t, ...editForm, amount: parseFloat(editForm.amount) } : t
          )
          setDrillDown(prev => prev ? ({
            ...prev,
            txs: updTxs,
            sum: updTxs.reduce((s,t) => s + absAmount(t), 0),
          }) : null)
        }
      })
    }
    setEditSaving(false)
  }

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'var(--text2)' }}>Завантаження...</div>

  if (!months.length) return (
    <div>
      {!initialTab && <div className="page-header"><h1>Звіти P&L</h1></div>}
      <div className="card"><div className="empty">
        <i className="ti ti-chart-bar" style={{ fontSize:48, color:'var(--text3)', display:'block', margin:'0 auto 12px' }} />
        <p>Немає даних. Додайте операції.</p>
      </div></div>
    </div>
  )

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const totRevenue  = monthly.reduce((s,m)=>s+m.revenue,0)
  const totExpenses = monthly.reduce((s,m)=>s+m.expenses,0)
  const totNet      = totRevenue - totExpenses
  const lastCF      = monthly[monthly.length-1]?.cumCF || 0
  const margin      = totRevenue > 0 ? ((totNet/totRevenue)*100).toFixed(1) : null

  // Calculate previous period for comparison
  const prevRevenue = compareMode && rptFrom && rptTo ? (() => {
    const from = new Date(rptFrom)
    const to = new Date(rptTo)
    const diff = to - from
    const prevFrom = new Date(from - diff).toISOString().split('T')[0]
    const prevTo = new Date(to - diff - 86400000).toISOString().split('T')[0]
    const prevTxs = rawTxs.filter(t => t.date >= prevFrom && t.date <= prevTo)
    const pRev = prevTxs.filter(t => t.direction === 'Доходи').reduce((s,t) => s + Math.abs(t.amount||0), 0)
    const pExp = prevTxs.filter(t => t.direction === 'Витрати').reduce((s,t) => s + Math.abs(t.amount||0), 0)
    return { revenue: pRev, expenses: pExp, net: pRev - pExp }
  })() : null

  // ── Build P&L table rows from articles ──────────────────────────────────────
  // Collect articles that have data + active articles
  const activeArticleNames = new Set(articles.map(a => a.name))
  const allArticleNamesInData = new Set(Object.keys(artData))
  const allNames = new Set([...activeArticleNames, ...allArticleNamesInData])

  // Map article name → type
  const artTypeMap = {}
  articles.forEach(a => { artTypeMap[a.name] = a.type })
  // Infer type for articles not in settings
  ;[...allArticleNamesInData].forEach(name => {
    if (!artTypeMap[name]) {
      // Guess from transactions
      const txsForArt = Object.values(artData[name] || {}).flatMap(d => d.txs)
      const dir = txsForArt[0]?.direction
      if (dir === 'Доходи') artTypeMap[name] = 'income'
      else if (dir === 'Витрати') artTypeMap[name] = 'expense'
      else if (dir === 'ПФД' || dir === 'Внутрішні перекази') artTypeMap[name] = 'transfer'
      else artTypeMap[name] = 'other'
    }
  })

  // Group article names by type, ordered by article sort_order
  const byType = {}
  ARTICLE_TYPE_ORDER.forEach(t => { byType[t] = [] })
  // First, add articles in defined order
  articles.forEach(a => {
    if (artData[a.name] || activeArticleNames.has(a.name)) {
      const t = a.type || 'other'
      if (!byType[t]) byType[t] = []
      if (!byType[t].includes(a.name)) byType[t].push(a.name)
    }
  })
  // Then, add articles from data that aren't in settings
  ;[...allArticleNamesInData].forEach(name => {
    const t = artTypeMap[name] || 'other'
    if (!byType[t]) byType[t] = []
    if (!byType[t].includes(name)) byType[t].push(name)
  })

  // Section totals per month
  const sectionTotals = {}
  ARTICLE_TYPE_ORDER.forEach(type => {
    sectionTotals[type] = {}
    months.forEach(m => {
      sectionTotals[type][m] = (byType[type] || []).reduce((s, name) => s + (artData[name]?.[m]?.sum || 0), 0)
    })
    sectionTotals[type]._total = months.reduce((s,m) => s + (sectionTotals[type][m]||0), 0)
  })

  // P&L ієрархія з pl_level
  const plData = buildPlData(articles, artData, months)
  const totGP = plData.calcRows._gp?._total || 0
  const totEBIT = plData.calcRows._ebit?._total || 0
  const totNetPL = plData.calcRows._net?._total || 0
  const gpMargin = totRevenue > 0 ? ((totGP / totRevenue) * 100).toFixed(1) : null

  const cellStyle = (v, bold = false, clickable = false) => ({
    padding: '7px 12px',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: v === 0 ? 'var(--text3)' : numColor(v),
    fontWeight: bold ? 500 : 400,
    cursor: clickable && v !== 0 ? 'pointer' : 'default',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    transition: 'background .1s',
  })

  const handleCellClick = (articleName, month) => {
    const d = artData[articleName]?.[month]
    if (!d || d.sum === 0) return
    setDrillDown({ article: articleName, month, txs: d.txs, sum: d.sum })
  }

  const handleSectionClick = (type, month) => {
    const names = byType[type] || []
    const txs = names.flatMap(name => artData[name]?.[month]?.txs || [])
    const sum = sectionTotals[type][month] || 0
    if (!txs.length) return
    setDrillDown({ article: SECTION_LABELS[type], month, txs, sum })
  }

  const handleTotalClick = (month) => {
    const allTxs = Object.values(artData).flatMap(d => d[month]?.txs || [])
    if (!allTxs.length) return
    const sum = ARTICLE_TYPE_ORDER.reduce((s, type) => s + (SECTION_SIGN[type] || 1) * (sectionTotals[type]?.[month] || 0), 0)
    setDrillDown({ article: 'Всі операції', month, txs: allTxs, sum })
  }

  return (
    <div>
      {!initialTab && <div className="page-header">
        <h1>Звіти P&L</h1>
        <p>Фінансовий результат — натисніть на суму для деталізації</p>
      </div>}

      {/* Period controls */}
      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
          {[{id:'month',label:'Місяць'},{id:'week',label:'Тиждень'},{id:'day',label:'День'}].map(g => (
            <button key={g.id} onClick={() => setRptGran(g.id)} style={{
              padding:'8px 14px', border:'none', cursor:'pointer', fontSize:13, fontWeight:500,
              fontFamily:'-apple-system,Inter,sans-serif',
              background: rptGran===g.id ? '#000' : 'var(--surface)',
              color: rptGran===g.id ? '#fff' : 'var(--text2)',
            }}>{g.label}</button>
          ))}
        </div>
        <span style={{ fontSize:13, color:'var(--text2)' }}>Період:</span>
        <input type="date" className="form-input" value={rptFrom} onChange={e => setRptFrom(e.target.value)}
          style={{ width:150, height:40, fontSize:13 }} />
        <span style={{ color:'var(--text3)' }}>—</span>
        <input type="date" className="form-input" value={rptTo} onChange={e => setRptTo(e.target.value)}
          style={{ width:150, height:40, fontSize:13 }} />
        {(rptFrom || rptTo) && (
          <button className="btn btn-sm btn-secondary" onClick={() => { setRptFrom(''); setRptTo('') }}
            style={{ height:40, display:'flex', alignItems:'center', gap:4 }}>
            <i className="ti ti-x" style={{ fontSize:13 }} />Скинути
          </button>
        )}
        <button
          className={`btn btn-sm ${compareMode ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setCompareMode(c => !c)}
          style={{ width:'auto', height:40 }}
        >
          <i className="ti ti-arrows-diff" style={{ fontSize:14 }} />
          Порівняння
        </button>
      </div>

      {/* KPIs — only when standalone or no initialTab */}
      {!initialTab && <div className="kpi-grid" style={{ marginBottom:20 }}>
        <div className="kpi">
          <div className="kpi-label">Загальна виручка</div>
          <div className="kpi-value blue">{fmt(totRevenue)} грн</div>
          {prevRevenue && (
            <div className="kpi-sub" style={{ color: totRevenue >= prevRevenue.revenue ? 'var(--green)' : 'var(--red)' }}>
              {totRevenue >= prevRevenue.revenue ? '+' : ''}{((totRevenue - prevRevenue.revenue) / (prevRevenue.revenue || 1) * 100).toFixed(1)}% vs попередній
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-label">Валовий прибуток (GP)</div>
          <div className={`kpi-value ${totGP>=0?'green':'red'}`}>{fmt(totGP)} грн</div>
          {gpMargin && <div className="kpi-sub">{gpMargin}% від виручки</div>}
        </div>
        <div className="kpi">
          <div className="kpi-label">EBIT</div>
          <div className={`kpi-value ${totEBIT>=0?'green':'red'}`}>{fmt(totEBIT)} грн</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Чистий прибуток (Net)</div>
          <div className={`kpi-value ${totNetPL>=0?'green':'red'}`}>{fmt(totNetPL)} грн</div>
          {prevRevenue && (
            <div className="kpi-sub" style={{ color: totNet >= prevRevenue.net ? 'var(--green)' : 'var(--red)' }}>
              {totNet >= prevRevenue.net ? '+' : ''}{((totNet - prevRevenue.net) / (Math.abs(prevRevenue.net) || 1) * 100).toFixed(1)}% vs попередній
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-label">Поточний CF</div>
          <div className={`kpi-value ${lastCF>=0?'green':'red'}`}>{fmt(lastCF)} грн</div>
        </div>
      </div>}

      {/* Charts — only standalone */}
      {!initialTab && <>
      <div style={{ display:'grid', gridTemplateColumns: expenseByArt.length > 0 ? '3fr 2fr' : '1fr', gap:14, marginBottom:14 }}>
        <div className="card" style={{ padding:'18px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text2)', marginBottom:16 }}>Виручка та витрати по місяцях, грн</div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={monthly} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize:12, fill:'var(--text2)' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize:11, fill:'var(--text3)' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize:12, paddingTop:8 }} formatter={v=><span style={{color:'var(--text2)'}}>{v}</span>} />
              <Bar dataKey="revenue"  name="Виручка" fill="#4A7C59" radius={[4,4,0,0]} maxBarSize={48} />
              <Bar dataKey="expenses" name="Витрати" fill="#9B3A3A" radius={[4,4,0,0]} maxBarSize={48} />
              <Line dataKey="net" name="Результат" stroke="#f59e0b" strokeWidth={2.5} dot={{ r:4, fill:'#f59e0b' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {expenseByArt.length > 0 && (
          <div className="card" style={{ padding:'18px 16px' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--text2)', marginBottom:16 }}>Структура витрат</div>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={expenseByArt} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={2} dataKey="value">
                  {expenseByArt.map((_, i) => <Cell key={i} fill={EXPENSE_COLORS[i%EXPENSE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v,n,p)=>[`${fmt(v)} грн`, p.payload.fullName]} contentStyle={{ fontSize:12, borderRadius:8, border:'1px solid var(--border)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:120, overflowY:'auto' }}>
              {expenseByArt.slice(0,6).map((item,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:7, fontSize:11.5 }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:EXPENSE_COLORS[i%EXPENSE_COLORS.length], flexShrink:0 }} />
                  <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text2)' }} title={item.fullName}>{item.name}</span>
                  <span style={{ color:'var(--text)', fontWeight:500, flexShrink:0 }}>{fmt(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* CF Chart */}
      <div className="card" style={{ padding:'18px 16px', marginBottom:14 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--text2)', marginBottom:16 }}>
          Накопичений Cash Flow, грн
          <span style={{ marginLeft:12, fontSize:12, fontWeight:400, color: lastCF>=0?'var(--green)':'var(--red)' }}>
            Поточний: {lastCF>=0?'+':''}{fmt(lastCF)} грн
          </span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={monthly} margin={{ top:4, right:8, left:0, bottom:4 }}>
            <defs>
              <linearGradient id="cfGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={lastCF>=0?'#2563EB':'#9B3A3A'} stopOpacity={0.15}/>
                <stop offset="95%" stopColor={lastCF>=0?'#2563EB':'#9B3A3A'} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize:12, fill:'var(--text2)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtK} tick={{ fontSize:11, fill:'var(--text3)' }} axisLine={false} tickLine={false} width={64} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="cumCF" name="Cash Flow" stroke={lastCF>=0?'#2563EB':'#9B3A3A'} strokeWidth={2.5} fill="url(#cfGrad)" dot={{ r:4, fill:lastCF>=0?'#2563EB':'#9B3A3A', strokeWidth:2, stroke:'#fff' }} activeDot={{ r:6 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      </>}

      {/* ── Cash Flow Table ── */}
      {(!initialTab || initialTab === 'cf') && <>
      <div className="card" style={{ padding:'18px 0', overflowX:'auto', marginBottom:14 }}>
        <div style={{ padding:'0 18px 12px', fontSize:14, fontWeight:600, color:'var(--text)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>Рух грошових коштів</span>
          <span style={{ fontSize:12, fontWeight:400, color:'var(--text3)' }}>Всі операції включно з ПФД та іншими</span>
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:400 }}>
          <thead>
            <tr>
              <th style={{ textAlign:'left', padding:'8px 18px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)', fontSize:12 }}>Період</th>
              <th style={{ textAlign:'right', padding:'8px 12px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)', fontSize:12 }}>Надходження</th>
              <th style={{ textAlign:'right', padding:'8px 12px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)', fontSize:12 }}>Списання</th>
              <th style={{ textAlign:'right', padding:'8px 12px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)', fontSize:12 }}>Нетто</th>
              <th style={{ textAlign:'right', padding:'8px 12px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)', fontSize:12 }}>Залишок</th>
            </tr>
          </thead>
          <tbody>
            {cfMonthly.map(m => (
              <tr key={m.label} style={{ borderBottom:'1px solid var(--bg)' }}>
                <td style={{ padding:'8px 18px', fontWeight:500 }}>{m.label}</td>
                <td style={{ padding:'8px 12px', textAlign:'right', color:'var(--green)', fontVariantNumeric:'tabular-nums' }}>+{fmt(m.inflow)}</td>
                <td style={{ padding:'8px 12px', textAlign:'right', color:'var(--red)', fontVariantNumeric:'tabular-nums' }}>-{fmt(m.outflow)}</td>
                <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:500, color: m.net >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric:'tabular-nums' }}>
                  {m.net >= 0 ? '+' : '-'}{fmt(Math.abs(m.net))}
                </td>
                <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:500, color: m.cumBalance >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric:'tabular-nums' }}>
                  {m.cumBalance >= 0 ? '+' : '-'}{fmt(Math.abs(m.cumBalance))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}

      {/* ── P&L Table by articles ──────────────────────────────────────────────── */}
      {(!initialTab || initialTab === 'pl') &&
      (() => {
        const curMonth = currentMonth()
        const allDisplayMonths = [
          ...months,
          ...planMonths.filter(m => !months.includes(m))
        ]
        const isPlan = m => m > curMonth
        const isCurrent = m => m === curMonth

        // Build plan section totals
        const planSectionTotals = {}
        ARTICLE_TYPE_ORDER.forEach(type => {
          planSectionTotals[type] = {}
          allDisplayMonths.forEach(m => {
            planSectionTotals[type][m] = (byType[type] || []).reduce((s, name) => s + (planData[name]?.[m] || 0), 0)
          })
        })

        const exportToExcel = () => {
          if (!months.length) return
          const rows = []
          // Header row
          rows.push(['Стаття', ...months, 'РАЗОМ'])

          ARTICLE_TYPE_ORDER.forEach(type => {
            const articles = byType[type] || []
            if (articles.length === 0) return
            // Section header
            rows.push([SECTION_LABELS[type]])
            // Article rows
            const sign = SECTION_SIGN[type] || 1
            articles.forEach(artName => {
              const rowTotal = sign * months.reduce((s,m) => s + (artData[artName]?.[m]?.sum || 0), 0)
              if (rowTotal === 0) return
              rows.push([artName, ...months.map(m => sign * (artData[artName]?.[m]?.sum || 0)), rowTotal])
            })
            // Section total
            const secTotal = sign * (sectionTotals[type]?._total || 0)
            rows.push(['Разом ' + SECTION_LABELS[type].toLowerCase(), ...months.map(m => sign * (sectionTotals[type]?.[m] || 0)), secTotal])
          })
          // Net result
          const netRow = ['ЧИСТИЙ РЕЗУЛЬТАТ', ...months.map(m => {
            return ARTICLE_TYPE_ORDER.reduce((s, type) => s + (SECTION_SIGN[type] || 1) * (sectionTotals[type]?.[m] || 0), 0)
          }), totNet]
          rows.push(netRow)

          const ws = XLSX.utils.aoa_to_sheet(rows)
          const wb = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb, ws, 'P&L')
          XLSX.writeFile(wb, `PL_${rptFrom || 'all'}_${rptTo || 'all'}.xlsx`)
        }

        return (
      <div className="card" style={{ padding:'18px 0', overflowX:'auto' }}>
        <div style={{ padding:'0 18px 12px', fontSize:13, fontWeight:600, color:'var(--text2)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          P&L по місяцях
          <span style={{ fontSize:11, fontWeight:400, color:'var(--text3)', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'2px 8px' }}>
            натисніть на суму для деталізації
          </span>
          {planMonths.length > 0 && (
            <span style={{ fontSize:11, fontWeight:400, color:'#8B6914', background:'#FEF9EF', border:'1px dashed #D4A843', borderRadius:6, padding:'2px 8px', display:'flex', alignItems:'center', gap:4 }}>
              <i className="ti ti-calendar-stats" style={{ fontSize:12 }} />
              {planMonths.length} планових місяців
            </span>
          )}
          <button className="btn btn-sm btn-secondary" onClick={exportToExcel} style={{ width:'auto', height:40 }}>
            <i className="ti ti-download" style={{ fontSize:14 }} />
            Excel
          </button>
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5, minWidth:500 }}>
          <thead>
            <tr>
              <th style={{ textAlign:'left', padding:'8px 18px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)', minWidth:200, position:'sticky', left:0, zIndex:1 }}>
                Стаття
              </th>
              {allDisplayMonths.map(m => (
                <th key={m} style={{
                  padding:'8px 12px',
                  background: isPlan(m) ? '#FEF9EF' : isCurrent(m) ? '#EFF4FF' : 'var(--surface2)',
                  borderBottom:'1px solid var(--border)',
                  borderLeft: isPlan(m) && !isPlan(allDisplayMonths[allDisplayMonths.indexOf(m)-1]) ? '2px dashed #D4A843' : undefined,
                  textAlign:'right', fontWeight:500,
                  color: isPlan(m) ? '#8B6914' : isCurrent(m) ? 'var(--blue)' : 'var(--text2)',
                  whiteSpace:'nowrap',
                }}>
                  {m}
                  {isPlan(m) && <div style={{ fontSize:9, fontWeight:400, color:'#6B6B6B', letterSpacing:'.5px' }}>ПЛАН</div>}
                  {isCurrent(m) && <div style={{ fontSize:9, fontWeight:400, color:'#6B6B6B', letterSpacing:'.5px' }}>ЗАРАЗ</div>}
                </th>
              ))}
              <th style={{ padding:'8px 12px', background:'#EFF4FF', borderBottom:'1px solid var(--border)', textAlign:'right', fontWeight:700, color:'var(--blue)', whiteSpace:'nowrap', borderLeft:'2px solid #E2E8F0' }}>
                РАЗОМ
              </th>
            </tr>
          </thead>
          <PlTable
            artData={artData}
            months={allDisplayMonths}
            plData={plData}
            isCurrent={isCurrent}
            isPlan={isPlan}
            planData={planData}
            onCellClick={handleCellClick}
            onSectionClick={handleSectionClick}
          />
          {false && <tbody>
            {ARTICLE_TYPE_ORDER.map(type => {
              const rows = byType[type] || []
              if (rows.length === 0) return null
              const secTotal = months.reduce((s,m) => s+(sectionTotals[type][m]||0), 0)
              if (secTotal === 0 && rows.every(name => !artData[name])) return null

              return (
                <>
                  {/* Section header */}
                  <tr key={`sec-${type}`}>
                    <td colSpan={months.length + 2} style={{ padding:'10px 18px 4px', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', color:'var(--text3)', background:'var(--surface2)', borderTop:'1px solid var(--border)' }}>
                      {SECTION_LABELS[type]}
                    </td>
                  </tr>

                  {/* Article rows */}
                  {rows.map(artName => {
                    const rowTotal = months.reduce((s,m) => s+(artData[artName]?.[m]?.sum||0), 0)
                    const hasAnyPlan = allDisplayMonths.some(m => isPlan(m) && planData[artName]?.[m])
                    if (rowTotal === 0 && !artData[artName] && !hasAnyPlan) return null
                    return (
                      <tr key={artName} style={{ borderBottom:'1px solid #F0F2F5' }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background=''}
                      >
                        <td style={{ padding:'7px 18px 7px 28px', fontSize:13, color:'var(--text)', position:'sticky', left:0, background:'var(--surface)', zIndex:1 }}>
                          {artName}
                        </td>
                        {allDisplayMonths.map(m => {
                          if (isPlan(m)) {
                            const pv = planData[artName]?.[m] || 0
                            return (
                              <td key={m} style={{
                                padding:'7px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums',
                                color: pv === 0 ? 'var(--text3)' : pv > 0 ? '#4A7C59' : '#9B3A3A',
                                fontStyle:'italic', fontSize:12.5,
                                background:'#FEF9EF',
                                borderLeft: !isPlan(allDisplayMonths[allDisplayMonths.indexOf(m)-1]) ? '2px dashed #D4A843' : undefined,
                              }}>
                                {pv === 0 ? '—' : fmtS(pv)}
                              </td>
                            )
                          }
                          const raw = artData[artName]?.[m]?.sum || 0
                          const v = (SECTION_SIGN[type] || 1) * raw
                          return (
                            <td key={m}
                              style={{ ...cellStyle(v, false, true), background: isCurrent(m)?'#EFF4FF':'' }}
                              onClick={() => handleCellClick(artName, m)}
                              title={v !== 0 ? 'Натисніть для деталізації' : undefined}
                              onMouseEnter={e => { if(v!==0) e.currentTarget.style.background='#EFF4FF' }}
                              onMouseLeave={e => e.currentTarget.style.background= isCurrent(m)?'#EFF4FF':''}
                            >
                              {fmtS(v)}
                            </td>
                          )
                        })}
                        {(() => {
                          const sign = SECTION_SIGN[type] || 1
                          const factTotal = sign * months.reduce((s,m) => s+(artData[artName]?.[m]?.sum||0), 0)
                          const planTotal = sign * allDisplayMonths.filter(m=>isPlan(m)).reduce((s,m) => s+(planData[artName]?.[m]||0), 0)
                          const forecast = factTotal + planTotal
                          return (<>
                            <td style={{ ...cellStyle(factTotal, true), background:'#EFF4FF', cursor: factTotal!==0?'pointer':'default', borderLeft:'2px solid #E2E8F0' }}>
                              {fmtS(factTotal)}
                            </td>
                            <td style={{ ...cellStyle(forecast, true), background: forecast===factTotal?'#F0F2F5':'#EFF5EF', fontStyle: planTotal!==0?'italic':'' }}>
                              {forecast===0?'—':fmtS(forecast)}
                            </td>
                          </>)
                        })()}
                      </tr>
                    )
                  })}

                  {/* Section total */}
                  <tr key={`total-${type}`} style={{ borderTop:'2px solid var(--border)', borderBottom:'1px solid var(--border)' }}>
                    <td style={{ padding:'8px 18px', fontWeight:700, fontSize:13, color:'var(--text2)', background:'var(--surface2)', position:'sticky', left:0 }}>
                      Разом {SECTION_LABELS[type].toLowerCase()}
                    </td>
                    {allDisplayMonths.map(m => {
                      if (isPlan(m)) {
                        const pv = planSectionTotals[type][m] || 0
                        return (
                          <td key={m} style={{
                            padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums',
                            color: pv===0?'var(--text3)':pv>0?'#4A7C59':'#9B3A3A',
                            fontWeight:700, fontStyle:'italic', fontSize:12.5,
                            background:'#F0F2F5',
                            borderLeft: !isPlan(allDisplayMonths[allDisplayMonths.indexOf(m)-1]) ? '2px dashed #E2E8F0' : undefined,
                          }}>
                            {pv===0?'—':fmtS(pv)}
                          </td>
                        )
                      }
                      const raw = sectionTotals[type][m] || 0
                      const v = (SECTION_SIGN[type] || 1) * raw
                      return (
                        <td key={m}
                          style={{ ...cellStyle(v, true, true), background: isCurrent(m)?'#EFF4FF':'var(--surface2)' }}
                          onClick={() => handleSectionClick(type, m)}
                          title={v!==0?'Натисніть для деталізації':undefined}
                          onMouseEnter={e => { if(v!==0) e.currentTarget.style.background='#EFF4FF' }}
                          onMouseLeave={e => e.currentTarget.style.background= isCurrent(m)?'#EFF4FF':'var(--surface2)'}
                        >
                          {fmtS(v)}
                        </td>
                      )
                    })}
                    {(() => {
                      const sign = SECTION_SIGN[type] || 1
                      const factT = sign * (sectionTotals[type]._total || 0)
                      const planT = sign * allDisplayMonths.filter(m=>isPlan(m)).reduce((s,m) => s+(planSectionTotals[type][m]||0), 0)
                      const forecastT = factT + planT
                      return (<>
                        <td style={{ ...cellStyle(factT, true), background:'#EFF4FF', borderLeft:'2px solid #E2E8F0' }}>
                          {fmtS(factT)}
                        </td>
                        <td style={{ ...cellStyle(forecastT, true), background: planT!==0?'#EFF5EF':'#F0F2F5', fontStyle: planT!==0?'italic':'' }}>
                          {forecastT===0?'—':fmtS(forecastT)}
                        </td>
                      </>)
                    })()}
                  </tr>
                </>
              )
            })}

            {/* Net result row */}
            <tr style={{ borderTop:'2px solid var(--border)' }}>
              <td style={{ padding:'10px 18px', fontWeight:700, fontSize:14, background:'var(--surface2)', position:'sticky', left:0 }}>
                ЧИСТИЙ РЕЗУЛЬТАТ
              </td>
              {allDisplayMonths.map(m => {
                if (isPlan(m)) {
                  const pv = Object.values(planData).reduce((s,d) => s+(d[m]||0), 0)
                  return (
                    <td key={m} style={{
                      padding:'10px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums',
                      color: pv===0?'var(--text3)':pv>0?'#4A7C59':'#9B3A3A',
                      fontWeight:700, fontStyle:'italic', fontSize:13,
                      background:'#F0F2F5',
                      borderLeft: !isPlan(allDisplayMonths[allDisplayMonths.indexOf(m)-1]) ? '2px dashed #E2E8F0' : undefined,
                    }}>
                      {pv===0?'—':fmtS(pv)}
                    </td>
                  )
                }
                const v = ARTICLE_TYPE_ORDER.reduce((s, type) => s + (SECTION_SIGN[type] || 1) * (sectionTotals[type]?.[m] || 0), 0)
                return (
                  <td key={m}
                    style={{ ...cellStyle(v, true, true), background: isCurrent(m)?'#EFF4FF':'var(--surface2)', fontSize:13 }}
                    onClick={() => handleTotalClick(m)}
                    title={v!==0?'Натисніть для деталізації':undefined}
                    onMouseEnter={e => { if(v!==0) e.currentTarget.style.background='#EFF4FF' }}
                    onMouseLeave={e => e.currentTarget.style.background= isCurrent(m)?'#EFF4FF':'var(--surface2)'}
                  >
                    {fmtS(v)}
                  </td>
                )
              })}
              {(() => {
                const planNetTotal = allDisplayMonths.filter(m=>isPlan(m)).reduce((s,m) => {
                  return s + Object.values(planData).reduce((ps,d) => ps+(d[m]||0), 0)
                }, 0)
                const forecastNet = totNet + planNetTotal
                return (<>
                  <td style={{ ...cellStyle(totNet, true), background:'#EFF4FF', fontSize:13, borderLeft:'2px solid #E2E8F0' }}>
                    {fmtS(totNet)}
                  </td>
                  <td style={{ ...cellStyle(forecastNet, true), background: planNetTotal!==0?'#EFF5EF':'#F0F2F5', fontSize:13, fontStyle: planNetTotal!==0?'italic':'' }}>
                    {forecastNet===0?'—':fmtS(forecastNet)}
                  </td>
                </>)
              })()}
            </tr>
          </tbody>}
        </table>
      </div>
        )
      })()}

      {/* ── Drill-down modal ────────────────────────────────────────────────────── */}
      {drillDown && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setDrillDown(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <div>
                <div style={{ fontSize:15, fontWeight:600 }}>{drillDown.article}</div>
                <div style={{ fontSize:12.5, color:'var(--text2)', marginTop:2 }}>{drillDown.month} · {drillDown.txs.length} операцій</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:18, fontWeight:700, color: drillDown.sum>=0?'var(--green)':'var(--red)' }}>
                    {drillDown.sum>=0?'+':''}{fmt(drillDown.sum)} грн
                  </div>
                </div>
                <button className="modal-close" onClick={() => setDrillDown(null)}>×</button>
              </div>
            </div>
            <div className="tbl-wrap" style={{ maxHeight:400 }}>
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Контрагент</th>
                    <th>Проєкт</th>
                    <th style={{ textAlign:'right' }}>Сума, грн</th>
                    <th style={{ width:36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {[...drillDown.txs].sort((a,b) => Math.abs(b.amount||0) - Math.abs(a.amount||0)).map(tx => (
                    <tr key={tx.id} style={{ borderBottom:'1px solid #F0F2F5' }}>
                      <td style={{ color:'var(--text2)', fontSize:12, whiteSpace:'nowrap' }}>{tx.date}</td>
                      <td>
                        <div style={{ fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200 }} title={tx.contractor}>{tx.contractor}</div>
                        {tx.description && <div style={{ fontSize:11, color:'var(--text3)' }}>{tx.description.substring(0,60)}</div>}
                      </td>
                      <td style={{ fontSize:12, color:'var(--text2)' }}>{tx.projects?.name || '—'}</td>
                      <td style={{ textAlign:'right', fontWeight:600, fontVariantNumeric:'tabular-nums', color:(tx.amount||0)>=0?'var(--green)':'var(--red)', whiteSpace:'nowrap' }}>
                        {(tx.amount||0)>=0?'+':''}{fmt(tx.amount)} грн
                      </td>
                      <td>
                        <button
                          onClick={() => openEdit(tx)}
                          style={{ background:'none', border:'1px solid var(--border2)', borderRadius:6, width:28, height:28, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text2)' }}
                          title="Редагувати"
                        >
                          <i className="ti ti-pencil" style={{ fontSize:13 }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:'2px solid var(--border)', background:'var(--surface2)' }}>
                    <td colSpan={4} style={{ padding:'8px 12px', fontWeight:700, fontSize:13 }}>Разом</td>
                    <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:700, fontSize:13, color: drillDown.sum>=0?'var(--green)':'var(--red)' }}>
                      {drillDown.sum>=0?'+':''}{fmt(drillDown.sum)} грн
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit transaction modal ─────────────────────────────────────────────── */}
      {editTx && (
        <div className="modal-bg" style={{ zIndex: 400 }} onClick={e => e.target===e.currentTarget && setEditTx(null)}>
          <div className="modal">
            <div className="modal-header">
              <h2 style={{ fontSize:15 }}>Редагувати операцію</h2>
              <button className="modal-close" onClick={() => setEditTx(null)}>×</button>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Дата</label>
                <input type="date" className="form-input" value={editForm.date} onChange={e => setEditForm(f=>({...f,date:e.target.value}))} />
              </div>
              <div className="form-group">
                <label>Контрагент</label>
                <input className="form-input" value={editForm.contractor} onChange={e => setEditForm(f=>({...f,contractor:e.target.value}))} />
              </div>
              <div className="form-group">
                <label>Сума (зі знаком)</label>
                <input type="number" className="form-input" value={editForm.amount} onChange={e => setEditForm(f=>({...f,amount:e.target.value}))} />
              </div>
              <div className="form-group">
                <label>Напрям</label>
                <select className="form-input" value={editForm.direction} onChange={e => setEditForm(f=>({...f,direction:e.target.value}))}>
                  {DIRS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Стаття</label>
                <select className="form-input" value={editForm.article} onChange={e => setEditForm(f=>({...f,article:e.target.value}))}>
                  <option value="">— оберіть —</option>
                  {Object.entries(groupByType(allArticles)).map(([type, items]) =>
                    items.length > 0 ? (
                      <optgroup key={type} label={TYPE_LABELS[type]}>
                        {items.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                      </optgroup>
                    ) : null
                  )}
                </select>
              </div>
              <div className="form-group">
                <label>Проєкт</label>
                <select className="form-input" value={editForm.project_id} onChange={e => setEditForm(f=>({...f,project_id:e.target.value}))}>
                  <option value="">— без проєкту —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group full">
                <label>Призначення</label>
                <textarea className="form-input" rows={2} value={editForm.description} onChange={e => setEditForm(f=>({...f,description:e.target.value}))} />
              </div>
            </div>

            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? 'Збереження...' : 'Зберегти'}
              </button>
              <button className="btn btn-secondary" onClick={() => setEditTx(null)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import ContractorSelect from './ui/ContractorSelect'

const DIRS = ['Доходи','Витрати','ПФД','Внутрішні перекази','Інше']
const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))

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

function getNextMonths(n = 8) {
  const months = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
  }
  return months
}

const EMPTY_FORM = {
  direction: 'Витрати', article: '', project_id: '', contractor: '',
  amount: '', description: '', planned_date: '',
  is_template: false, template_from: '', template_to: '',
}

export default function Planning({ user }) {
  const [tab, setTab] = useState('plans')       // plans | pvf | pl
  const [plans, setPlans]       = useState([])
  const [articles, setArticles] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)
  const [editId, setEditId]     = useState(null)
  const [filterMonth, setFilterMonth] = useState('')
  const [pvfData, setPvfData]   = useState([])
  const [pvfLoading, setPvfLoading] = useState(false)
  const [plData, setPlData]     = useState(null)
  const [plLoading, setPlLoading] = useState(false)
  const [plGran, setPlGran]     = useState('month') // day | week | month
  const [plFrom, setPlFrom]     = useState('')
  const [plTo, setPlTo]         = useState('')

  const nextMonths = getNextMonths(8)

  useEffect(() => {
    Promise.all([
      fetchArticles(),
      supabase.from('projects').select('id,name').eq('status','active').order('name'),
      supabase.from('plans').select('*,projects(name)').order('year_month').order('created_at'),
    ]).then(([arts, { data: projs }, { data: plns }]) => {
      setArticles(arts)
      setProjects(projs || [])
      setPlans(plns || [])
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (tab === 'pvf') loadPvf()
    if (tab === 'pl') loadPl()
  }, [tab, plGran, plFrom, plTo])

  const loadPvf = async () => {
    setPvfLoading(true)
    const [{ data: txs }, { data: plns }] = await Promise.all([
      supabase.from('transactions').select('date,amount,direction'),
      supabase.from('plans').select('*'),
    ])
    // Build months: all fact months + next 6
    const factMonths = new Set((txs||[]).map(t => t.date?.substring(0,7)).filter(Boolean))
    const allMonths = [...new Set([...factMonths, ...getNextMonths(6)])].sort()

    const rows = allMonths.map(m => {
      const mTxs = (txs||[]).filter(t => t.date?.startsWith(m))
      const factRev  = mTxs.filter(t=>t.direction==='Доходи').reduce((s,t)=>s+(t.amount||0),0)
      const factExp  = mTxs.filter(t=>t.direction==='Витрати').reduce((s,t)=>s+Math.abs(t.amount||0),0)

      // Expand templates
      const expanded = expandPlans(plns||[])
      const mPlans = expanded.filter(p => p.year_month === m)
      const planRev = mPlans.filter(p=>p.direction==='Доходи').reduce((s,p)=>s+(p.amount||0),0)
      const planExp = mPlans.filter(p=>p.direction==='Витрати').reduce((s,p)=>s+(p.amount||0),0)

      const today = new Date()
      const mDate = new Date(m + '-01')
      const isFuture = mDate > new Date(today.getFullYear(), today.getMonth(), 1)
      const isCurrent = m === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`

      return { m, factRev, factExp, planRev, planExp, isFuture, isCurrent,
        factNet: factRev - factExp, planNet: planRev - planExp,
        revPct: planRev > 0 ? Math.round(factRev/planRev*100) : null,
        expPct: planExp > 0 ? Math.round(factExp/planExp*100) : null,
      }
    })
    setPvfData(rows)
    setPvfLoading(false)
  }

  const DIR_TO_TYPE = { 'Доходи':'income', 'Витрати':'expense', 'ПФД':'transfer', 'Внутрішні перекази':'transfer', 'Інше':'other' }
  const SECTION_LABELS = { income:'Доходи', expense:'Витрати', transfer:'Перекази / ПФД', other:'Інше' }
  const SECTION_ORDER = ['income','expense','transfer','other']

  // Get period key from a date string based on granularity
  const getPeriodKey = (dateStr, gran) => {
    if (!dateStr) return null
    if (gran === 'day') return dateStr // YYYY-MM-DD
    if (gran === 'week') {
      const d = new Date(dateStr)
      const day = d.getDay() || 7
      d.setDate(d.getDate() - day + 1) // Monday
      return d.toISOString().split('T')[0]
    }
    return dateStr.substring(0, 7) // YYYY-MM
  }

  const formatPeriodLabel = (key, gran) => {
    if (gran === 'day') return key
    if (gran === 'week') return `тижд. ${key}`
    return key
  }

  const loadPl = async () => {
    setPlLoading(true)
    const { data: plns } = await supabase.from('plans').select('*')
    const expanded = expandPlansHelper(plns || [])

    // Filter by date range if set
    const filtered = expanded.filter(p => {
      const d = p.planned_date || p.year_month + '-01'
      if (plFrom && d < plFrom) return false
      if (plTo && d > plTo) return false
      return true
    })

    // Group into periods based on granularity
    const periodsSet = new Set()
    const artData = {}
    const artTypes = {}
    filtered.forEach(p => {
      const d = p.planned_date || p.year_month + '-15'
      const period = getPeriodKey(d, plGran)
      if (!period) return
      periodsSet.add(period)
      const art = p.article || '(без статті)'
      const type = DIR_TO_TYPE[p.direction] || 'other'
      if (!artTypes[art]) artTypes[art] = type
      if (!artData[art]) artData[art] = {}
      if (!artData[art][period]) artData[art][period] = 0
      const sign = p.direction === 'Доходи' ? 1 : -1
      artData[art][period] += sign * (p.amount || 0)
    })

    const months = [...periodsSet].sort()

    // Group articles by section
    const bySection = {}
    SECTION_ORDER.forEach(t => { bySection[t] = [] })
    Object.keys(artData).forEach(art => {
      const t = artTypes[art] || 'other'
      if (!bySection[t]) bySection[t] = []
      if (!bySection[t].includes(art)) bySection[t].push(art)
    })

    // Section totals
    const sectionTotals = {}
    SECTION_ORDER.forEach(type => {
      sectionTotals[type] = {}
      months.forEach(m => {
        sectionTotals[type][m] = (bySection[type] || []).reduce((s, art) => s + (artData[art]?.[m] || 0), 0)
      })
      sectionTotals[type]._total = months.reduce((s, m) => s + (sectionTotals[type][m] || 0), 0)
    })

    setPlData({ months, artData, artTypes, bySection, sectionTotals })
    setPlLoading(false)
  }

  // Build planned_date for a given month using the day from the original date
  const buildPlannedDate = (yearMonth, originalDate) => {
    if (!originalDate) return yearMonth + '-01'
    const day = originalDate.split('-')[2] || '01'
    // Clamp day to valid range for the month
    const [y, m] = yearMonth.split('-').map(Number)
    const maxDay = new Date(y, m, 0).getDate() // last day of month
    const clampedDay = Math.min(parseInt(day), maxDay)
    return `${yearMonth}-${String(clampedDay).padStart(2, '0')}`
  }

  // Expand templates — each month gets its own planned_date with correct day
  const expandPlansHelper = (allPlans) => {
    const result = []
    allPlans.forEach(p => {
      if (p.is_template && p.template_from && p.template_to) {
        getMonthRange(p.template_from, p.template_to).forEach(m => {
          result.push({ ...p, year_month: m, planned_date: buildPlannedDate(m, p.planned_date) })
        })
      } else if (p.year_month || p.planned_date) {
        result.push(p)
      }
    })
    return result
  }

  const expandPlans = expandPlansHelper

  const reload = async () => {
    const { data } = await supabase.from('plans').select('*,projects(name)').order('year_month').order('created_at')
    setPlans(data || [])
  }

  const handleSave = async () => {
    if (!form.amount || !form.direction) return
    if (!form.is_template && !form.planned_date) {
      alert('Оберіть планову дату платежу')
      return
    }
    if (form.is_template && (!form.template_from || !form.template_to)) {
      alert('Оберіть діапазон місяців')
      return
    }
    if (form.is_template && !form.planned_date) {
      alert('Оберіть дату платежу — день буде повторюватись щомісяця')
      return
    }
    setSaving(true)
    const autoMonth = form.planned_date ? form.planned_date.substring(0, 7) : null
    const payload = {
      direction: form.direction,
      article: form.article || null,
      project_id: form.project_id || null,
      contractor: form.contractor || null,
      amount: parseFloat(form.amount),
      description: form.description || null,
      planned_date: form.planned_date || null,
      is_template: form.is_template,
      year_month: form.is_template ? form.template_from : autoMonth,
      template_from: form.is_template ? form.template_from : null,
      template_to: form.is_template ? form.template_to : null,
      created_by: user?.id,
    }
    console.log('Saving plan payload:', payload)
    let saveError = null
    if (editId) {
      const { error } = await supabase.from('plans').update(payload).eq('id', editId)
      saveError = error
    } else {
      const { error } = await supabase.from('plans').insert(payload)
      saveError = error
    }
    if (saveError) {
      console.error('Plans save error:', saveError)
      alert('Помилка збереження: ' + saveError.message)
      setSaving(false)
      return
    }
    await reload()
    setShowForm(false)
    setForm(EMPTY_FORM)
    setEditId(null)
    setSaving(false)
  }

  const handleEdit = (p) => {
    setForm({
      direction: p.direction, article: p.article||'', project_id: p.project_id||'', contractor: p.contractor||'',
      amount: Math.abs(p.amount), description: p.description||'',
      planned_date: p.planned_date || (p.year_month ? p.year_month + '-01' : ''),
      is_template: p.is_template||false,
      template_from: p.template_from||'', template_to: p.template_to||'',
    })
    setEditId(p.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Видалити запис?')) return
    await supabase.from('plans').delete().eq('id', id)
    await reload()
  }

  const visiblePlans = filterMonth
    ? expandPlans(plans).filter(p => p.year_month === filterMonth)
    : plans

  const pct = (fact, plan) => plan > 0 ? Math.round(fact/plan*100) : null
  const pctColor = v => v == null ? 'var(--text3)' : v >= 100 ? 'var(--green)' : v >= 75 ? 'var(--amber)' : 'var(--red)'

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Завантаження...</div>

  return (
    <div>
      <div className="page-header">
        <h1>Планування</h1>
        <p>Плануйте доходи та витрати на майбутні місяці</p>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:20 }}>
        {[
          { id:'plans', label:'Планові записи', icon:'ti-calendar-stats' },
          { id:'pl',    label:'P&L План',        icon:'ti-chart-bar' },
          { id:'pvf',   label:'План vs Факт',    icon:'ti-arrows-diff' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'10px 18px', border:'none', background:'none', cursor:'pointer',
            fontSize:13, fontWeight:500, fontFamily:'inherit',
            display:'flex', alignItems:'center', gap:6,
            borderBottom: tab===t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab===t.id ? 'var(--blue)' : 'var(--text2)',
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize:15 }} />{t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Plans ──────────────────────────────────────────────────── */}
      {tab === 'plans' && (
        <>
          <div style={{ display:'flex', gap:10, marginBottom:14, alignItems:'center', flexWrap:'wrap' }}>
            <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setEditId(null); setShowForm(true) }} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <i className="ti ti-plus" style={{ fontSize:15 }} /> Додати запис
            </button>
            <select className="form-input" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ width:160 }}>
              <option value="">Всі місяці</option>
              {nextMonths.map(m => <option key={m}>{m}</option>)}
            </select>
            <span style={{ fontSize:12, color:'var(--text3)', marginLeft:4 }}>
              {plans.length} записів
            </span>
          </div>

          {/* Plans list */}
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            {visiblePlans.length === 0 ? (
              <div className="empty">
                <i className="ti ti-calendar-plus" style={{ fontSize:40, color:'var(--text3)', display:'block', margin:'0 auto 12px' }} />
                <p>Немає планових записів. Додайте перший!</p>
              </div>
            ) : (
              <div className="tbl-wrap" style={{ border:'none' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Місяць</th>
                      <th>Дата платежу</th>
                      <th>Напрям / Стаття</th>
                      <th>Проєкт</th>
                      <th style={{ textAlign:'right' }}>Сума, грн</th>
                      <th>Опис</th>
                      <th style={{ width:72 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePlans.map((p, i) => (
                      <tr key={p.id + (filterMonth ? i : '')} style={{ borderBottom:'1px solid #F0F2F5' }}>
                        <td style={{ whiteSpace:'nowrap' }}>
                          {p.is_template ? (
                            <span style={{ fontSize:11, background:'#EFF5EF', color:'#4A7C59', border:'1px solid #E2E8F0', borderRadius:6, padding:'2px 7px', fontWeight:500 }}>
                              <i className="ti ti-repeat" style={{ fontSize:11, marginRight:3 }} />
                              {p.template_from} → {p.template_to}
                            </span>
                          ) : (
                            <span style={{ fontSize:13 }}>{p.year_month}</span>
                          )}
                        </td>
                        <td style={{ fontSize:12, color:'var(--text2)', whiteSpace:'nowrap' }}>{p.planned_date || '—'}</td>
                        <td>
                          <div style={{ fontSize:11, color: p.direction==='Доходи'?'var(--green)':'var(--red)', fontWeight:600, marginBottom:1 }}>{p.direction}</div>
                          <div style={{ fontSize:13 }}>{p.article || '—'}</div>
                        </td>
                        <td style={{ fontSize:12, color:'var(--text2)' }}>{p.projects?.name || '—'}</td>
                        <td style={{ textAlign:'right', fontWeight:600, color: p.direction==='Доходи'?'var(--green)':'var(--red)', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
                          {p.direction==='Доходи'?'+':'−'}{fmt(p.amount)} грн
                        </td>
                        <td style={{ fontSize:12, color:'var(--text2)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.description||'—'}</td>
                        <td>
                          <div style={{ display:'flex', gap:4 }}>
                            <button onClick={() => handleEdit(p)} style={{ background:'none', border:'1px solid var(--border2)', borderRadius:6, width:28, height:28, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text2)' }}>
                              <i className="ti ti-pencil" style={{ fontSize:13 }} />
                            </button>
                            <button onClick={() => handleDelete(p.id)} style={{ background:'none', border:'1px solid #E2E8F0', borderRadius:6, width:28, height:28, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--red)' }}>
                              <i className="ti ti-trash" style={{ fontSize:13 }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TAB: Plan vs Fact ────────────────────────────────────────────── */}
      {tab === 'pvf' && (
        <>
          {pvfLoading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text2)' }}>Завантаження...</div>
          ) : (
            <div className="card" style={{ padding:0, overflow:'hidden' }}>
              <div style={{ padding:'14px 18px 10px', fontSize:13, fontWeight:600, color:'var(--text2)', display:'flex', alignItems:'center', gap:10 }}>
                Помісячне порівняння плану та факту
                <span style={{ display:'flex', gap:8, fontSize:11, fontWeight:400 }}>
                  <span style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'2px 8px', color:'var(--text3)' }}>Факт</span>
                  <span style={{ background:'#EFF5EF', border:'1px dashed #E2E8F0', borderRadius:6, padding:'2px 8px', color:'#4A7C59' }}>ПЛАН</span>
                </span>
              </div>
              <div className="tbl-wrap" style={{ border:'none' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ minWidth:100 }}>Місяць</th>
                      <th style={{ textAlign:'right' }}>Доходи факт</th>
                      <th style={{ textAlign:'right' }}>Доходи план</th>
                      <th style={{ textAlign:'right' }}>Викон.</th>
                      <th style={{ textAlign:'right' }}>Витрати факт</th>
                      <th style={{ textAlign:'right' }}>Витрати план</th>
                      <th style={{ textAlign:'right' }}>Викон.</th>
                      <th style={{ textAlign:'right' }}>Рез. факт</th>
                      <th style={{ textAlign:'right' }}>Рез. план</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pvfData.map(row => {
                      const revPct = pct(row.factRev, row.planRev)
                      const expPct = pct(row.factExp, row.planExp)
                      const isFuture = row.isFuture
                      const isCurrent = row.isCurrent
                      return (
                        <tr key={row.m} style={{
                          borderBottom:'1px solid #F0F2F5',
                          background: isFuture ? '#fafafa' : isCurrent ? '#EFF5EF' : '',
                        }}>
                          <td>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontSize:13, fontWeight: isCurrent?600:400 }}>{row.m}</span>
                              {isCurrent && <span style={{ fontSize:10, background:'#EFF5EF', color:'#4A7C59', border:'1px solid #E2E8F0', borderRadius:6, padding:'1px 6px', fontWeight:600 }}>зараз</span>}
                              {isFuture && <span style={{ fontSize:10, background:'#F0F2F5', color:'var(--text3)', borderRadius:6, padding:'1px 6px' }}>план</span>}
                            </div>
                          </td>
                          {/* Доходи факт */}
                          <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', color: isFuture?'var(--text3)':'var(--green)', fontStyle: isFuture?'italic':'' }}>
                            {isFuture ? '—' : (row.factRev > 0 ? '+'+fmt(row.factRev) : '—')}
                          </td>
                          {/* Доходи план */}
                          <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', color:'#4A7C59', fontStyle:'italic', background: isFuture?'#EFF5EF':'' }}>
                            {row.planRev > 0 ? '+'+fmt(row.planRev) : '—'}
                          </td>
                          {/* % доходів */}
                          <td style={{ textAlign:'right', color: pctColor(revPct), fontWeight:600, fontSize:12 }}>
                            {isFuture ? '—' : (revPct != null ? revPct+'%' : '—')}
                          </td>
                          {/* Витрати факт */}
                          <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', color: isFuture?'var(--text3)':'var(--red)' }}>
                            {isFuture ? '—' : (row.factExp > 0 ? '−'+fmt(row.factExp) : '—')}
                          </td>
                          {/* Витрати план */}
                          <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', color:'#9B3A3A', fontStyle:'italic', background: isFuture?'#F5EDED':'' }}>
                            {row.planExp > 0 ? '−'+fmt(row.planExp) : '—'}
                          </td>
                          {/* % витрат */}
                          <td style={{ textAlign:'right', color: expPct != null ? (expPct<=100?'var(--green)':'var(--red)') : 'var(--text3)', fontWeight:600, fontSize:12 }}>
                            {isFuture ? '—' : (expPct != null ? expPct+'%' : '—')}
                          </td>
                          {/* Результат факт */}
                          <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:600, color: isFuture?'var(--text3)': row.factNet>=0?'var(--green)':'var(--red)' }}>
                            {isFuture ? '—' : (row.factRev>0||row.factExp>0 ? (row.factNet>=0?'+':'−')+fmt(row.factNet) : '—')}
                          </td>
                          {/* Результат план */}
                          <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:600, color: row.planNet>=0?'#4A7C59':'#9B3A3A', fontStyle:'italic', background: isFuture?(row.planNet>=0?'#EFF5EF':'#F5EDED'):'' }}>
                            {row.planRev>0||row.planExp>0 ? (row.planNet>=0?'+':'−')+fmt(row.planNet) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB: P&L План ─────────────────────────────────────────────── */}
      {tab === 'pl' && (
        <>
          {/* Period controls */}
          <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
              {[{id:'month',label:'Місяць'},{id:'week',label:'Тиждень'},{id:'day',label:'День'}].map(g => (
                <button key={g.id} onClick={() => setPlGran(g.id)} style={{
                  padding:'8px 14px', border:'none', cursor:'pointer', fontSize:13, fontWeight:500,
                  fontFamily:'-apple-system,Inter,sans-serif',
                  background: plGran===g.id ? '#000' : 'var(--surface)',
                  color: plGran===g.id ? '#fff' : 'var(--text2)',
                }}>{g.label}</button>
              ))}
            </div>
            <input type="date" className="form-input" value={plFrom} onChange={e => setPlFrom(e.target.value)}
              style={{ width:150, height:40, fontSize:13 }} placeholder="Від" />
            <input type="date" className="form-input" value={plTo} onChange={e => setPlTo(e.target.value)}
              style={{ width:150, height:40, fontSize:13 }} placeholder="До" />
            {(plFrom || plTo) && (
              <button className="btn btn-sm btn-secondary" onClick={() => { setPlFrom(''); setPlTo('') }}
                style={{ height:40, display:'flex', alignItems:'center', gap:4 }}>
                <i className="ti ti-x" style={{ fontSize:13 }} />Скинути
              </button>
            )}
          </div>

          {plLoading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text2)' }}>Завантаження...</div>
          ) : !plData || plData.months.length === 0 ? (
            <div className="card">
              <div className="empty">
                <i className="ti ti-chart-bar" style={{ fontSize:40, color:'var(--text3)', display:'block', margin:'0 auto 12px' }} />
                <p>Немає планових даних. Додайте записи у вкладці "Планові записи".</p>
              </div>
            </div>
          ) : (() => {
            const { months, artData, bySection, sectionTotals } = plData
            const fmtS = n => n === 0 ? '—' : (n > 0 ? '+' : '−') + fmt(n)
            const numColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text3)'

            // KPI totals
            const totRev = months.reduce((s, m) => s + (sectionTotals.income?.[m] || 0), 0)
            const totExp = months.reduce((s, m) => s + Math.abs(sectionTotals.expense?.[m] || 0), 0)
            const totNet = totRev - totExp

            return (
              <>
                {/* KPI */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:20 }}>
                  {[
                    { l:'Плановий дохід', v:totRev, c:'var(--green)' },
                    { l:'Планові витрати', v:totExp, c:'var(--red)' },
                    { l:'Плановий результат', v:totNet, c: totNet >= 0 ? 'var(--green)' : 'var(--red)' },
                  ].map(({ l, v, c }) => (
                    <div key={l} className="kpi">
                      <div className="kpi-label">{l}</div>
                      <div className="kpi-value" style={{ color:c }}>{fmt(v)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>грн</span></div>
                    </div>
                  ))}
                </div>

                {/* P&L Table */}
                <div className="card" style={{ padding:'18px 0', overflowX:'auto' }}>
                  <div style={{ padding:'0 18px 12px', fontSize:14, fontWeight:600, color:'var(--text)' }}>
                    P&L на основі плану — {plGran === 'day' ? 'по днях' : plGran === 'week' ? 'по тижнях' : 'по місяцях'}
                  </div>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:500 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign:'left', padding:'10px 18px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontWeight:600, color:'var(--text2)', fontSize:12, textTransform:'uppercase', letterSpacing:.5, minWidth:180, position:'sticky', left:0, zIndex:1 }}>
                          Стаття
                        </th>
                        {months.map(m => (
                          <th key={m} style={{ padding:'10px 12px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', textAlign:'right', fontWeight:600, color:'var(--text2)', fontSize:12, whiteSpace:'nowrap' }}>
                            {m}
                          </th>
                        ))}
                        <th style={{ padding:'10px 12px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', textAlign:'right', fontWeight:600, color:'var(--text)', fontSize:12, borderLeft:'2px solid var(--border)' }}>
                          РАЗОМ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {SECTION_ORDER.map(type => {
                        const rows = bySection[type] || []
                        if (rows.length === 0) return null
                        const secTotal = sectionTotals[type]?._total || 0
                        if (secTotal === 0 && rows.every(art => !artData[art])) return null

                        return (
                          <React.Fragment key={type}>
                            {/* Section header */}
                            <tr>
                              <td colSpan={months.length + 2} style={{ padding:'10px 18px 4px', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', color:'var(--text3)', background:'var(--surface2)', borderTop:'1px solid var(--border)' }}>
                                {SECTION_LABELS[type]}
                              </td>
                            </tr>

                            {/* Article rows */}
                            {rows.map(art => {
                              const rowTotal = months.reduce((s, m) => s + (artData[art]?.[m] || 0), 0)
                              if (rowTotal === 0) return null
                              return (
                                <tr key={art} style={{ borderBottom:'1px solid var(--bg)' }}>
                                  <td style={{ padding:'8px 18px 8px 28px', fontSize:13, color:'var(--text)', position:'sticky', left:0, background:'var(--surface)', zIndex:1 }}>
                                    {art}
                                  </td>
                                  {months.map(m => {
                                    const v = artData[art]?.[m] || 0
                                    return (
                                      <td key={m} style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color: numColor(v), fontWeight: v !== 0 ? 500 : 400, whiteSpace:'nowrap', fontSize:13 }}>
                                        {fmtS(v)}
                                      </td>
                                    )
                                  })}
                                  <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color: numColor(rowTotal), fontWeight:500, whiteSpace:'nowrap', fontSize:13, borderLeft:'2px solid var(--border)' }}>
                                    {fmtS(rowTotal)}
                                  </td>
                                </tr>
                              )
                            })}

                            {/* Section total */}
                            <tr style={{ borderTop:'2px solid var(--border)', borderBottom:'1px solid var(--border)' }}>
                              <td style={{ padding:'8px 18px', fontWeight:600, fontSize:13, color:'var(--text2)', background:'var(--surface2)', position:'sticky', left:0 }}>
                                Разом {SECTION_LABELS[type]?.toLowerCase()}
                              </td>
                              {months.map(m => {
                                const v = sectionTotals[type]?.[m] || 0
                                return (
                                  <td key={m} style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color: numColor(v), fontWeight:500, background:'var(--surface2)', whiteSpace:'nowrap', fontSize:13 }}>
                                    {fmtS(v)}
                                  </td>
                                )
                              })}
                              <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color: numColor(secTotal), fontWeight:600, background:'var(--surface2)', whiteSpace:'nowrap', fontSize:13, borderLeft:'2px solid var(--border)' }}>
                                {fmtS(secTotal)}
                              </td>
                            </tr>
                          </React.Fragment>
                        )
                      })}

                      {/* Net result */}
                      <tr style={{ borderTop:'2px solid var(--border)' }}>
                        <td style={{ padding:'10px 18px', fontWeight:600, fontSize:14, background:'var(--surface2)', position:'sticky', left:0 }}>
                          ЧИСТИЙ РЕЗУЛЬТАТ
                        </td>
                        {months.map(m => {
                          const v = SECTION_ORDER.reduce((s, type) => s + (sectionTotals[type]?.[m] || 0), 0)
                          return (
                            <td key={m} style={{ padding:'10px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:500, color: numColor(v), background:'var(--surface2)', whiteSpace:'nowrap', fontSize:14 }}>
                              {fmtS(v)}
                            </td>
                          )
                        })}
                        <td style={{ padding:'10px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:600, color: numColor(totNet), background:'var(--surface2)', whiteSpace:'nowrap', fontSize:14, borderLeft:'2px solid var(--border)' }}>
                          {fmtS(totNet)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )
          })()}
        </>
      )}

      {/* ── Form modal ──────────────────────────────────────────────────── */}
      {showForm && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2>{editId ? 'Редагувати запис' : 'Новий плановий запис'}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
            </div>

            {/* Template toggle */}
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, padding:'10px 14px', background:'var(--surface2)', borderRadius:8, border:'1px solid var(--border)' }}>
              <input type="checkbox" id="is_template" checked={form.is_template} onChange={e => setForm(f=>({...f, is_template:e.target.checked}))} style={{ width:16, height:16, cursor:'pointer' }} />
              <label htmlFor="is_template" style={{ fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                <i className="ti ti-repeat" style={{ fontSize:15, color:'var(--blue)' }} />
                Повторюваний шаблон (наприклад, зарплата щомісяця)
              </label>
            </div>

            <div className="form-grid">
              {/* Template month range */}
              {form.is_template && (
                <>
                  <div className="form-group">
                    <label>Місяць від</label>
                    <select className="form-input" value={form.template_from} onChange={e => setForm(f=>({...f,template_from:e.target.value}))}>
                      <option value="">— оберіть —</option>
                      {nextMonths.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Місяць до</label>
                    <select className="form-input" value={form.template_to} onChange={e => setForm(f=>({...f,template_to:e.target.value}))}>
                      <option value="">— оберіть —</option>
                      {nextMonths.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </>
              )}

              {/* Row 1: Напрям + Контрагент */}
              <div className="form-group">
                <label>Напрям</label>
                <select className="form-input" value={form.direction} onChange={e => setForm(f=>({...f,direction:e.target.value}))}>
                  {DIRS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Контрагент</label>
                <ContractorSelect
                  value={form.contractor}
                  onChange={v => setForm(f=>({...f,contractor:v}))}
                  onContractorSelect={c => {
                    if (c._new) return
                    if (c.default_direction) setForm(f=>({...f,direction:c.default_direction}))
                    if (c.default_article) setForm(f=>({...f,article:c.default_article}))
                  }}
                />
              </div>

              {/* Row 2: Стаття + Сума */}
              <div className="form-group">
                <label>Стаття</label>
                <select className="form-input" value={form.article} onChange={e => setForm(f=>({...f,article:e.target.value}))}>
                  <option value="">— оберіть —</option>
                  {Object.entries(groupByType(articles)).map(([type, items]) =>
                    items.length > 0 ? (
                      <optgroup key={type} label={TYPE_LABELS[type]}>
                        {items.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                      </optgroup>
                    ) : null
                  )}
                </select>
              </div>
              <div className="form-group">
                <label>Сума, грн</label>
                <input type="number" min="0" className="form-input" placeholder="0" value={form.amount} onChange={e => setForm(f=>({...f,amount:e.target.value}))} />
              </div>

              {/* Row 3: Проєкт + Дата */}
              <div className="form-group">
                <label>Проєкт</label>
                <select className="form-input" value={form.project_id} onChange={e => setForm(f=>({...f,project_id:e.target.value}))}>
                  <option value="">— без проєкту —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>{form.is_template ? 'День платежу (повторюватиметься) *' : 'Планова дата платежу *'}</label>
                <input type="date" className="form-input" value={form.planned_date} onChange={e => setForm(f=>({...f,planned_date:e.target.value}))} />
              </div>

              {/* Row 4: Опис */}
              <div className="form-group full">
                <label>Опис (необов'язково)</label>
                <input className="form-input" placeholder="Наприклад: зарплата команди" value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} />
              </div>
            </div>

            {form.is_template && form.template_from && form.template_to && form.amount && (
              <div style={{ background:'#EFF5EF', border:'1px solid #E2E8F0', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'#4A7C59', marginTop:8 }}>
                <i className="ti ti-info-circle" style={{ marginRight:6 }} />
                Буде створено {getMonthRange(form.template_from, form.template_to).length} записів по {fmt(form.amount)} грн кожен
                ({form.direction === 'Доходи' ? '+' : '−'}{fmt(form.amount * getMonthRange(form.template_from, form.template_to).length)} грн загалом)
                {form.planned_date && (
                  <div style={{ marginTop:4 }}>
                    Платіж {form.planned_date.split('-')[2]}-го числа кожного місяця
                  </div>
                )}
              </div>
            )}

            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Збереження...' : editId ? 'Зберегти' : 'Додати'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowForm(false); setEditId(null) }}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

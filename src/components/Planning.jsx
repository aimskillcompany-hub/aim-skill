import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'

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
  direction: 'Витрати', article: '', project_id: '',
  amount: '', description: '',
  is_template: false, year_month: '', template_from: '', template_to: '',
}

export default function Planning({ user }) {
  const [tab, setTab] = useState('plans')       // plans | pvf
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
  }, [tab])

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

  // Expand templates into individual month records
  const expandPlans = (allPlans) => {
    const result = []
    allPlans.forEach(p => {
      if (p.is_template && p.template_from && p.template_to) {
        getMonthRange(p.template_from, p.template_to).forEach(m => {
          result.push({ ...p, year_month: m })
        })
      } else {
        result.push(p)
      }
    })
    return result
  }

  const reload = async () => {
    const { data } = await supabase.from('plans').select('*,projects(name)').order('year_month').order('created_at')
    setPlans(data || [])
  }

  const handleSave = async () => {
    if (!form.amount || !form.direction) return
    // Validate month
    if (!form.is_template && !form.year_month) {
      alert('Оберіть місяць')
      return
    }
    if (form.is_template && (!form.template_from || !form.template_to)) {
      alert('Оберіть діапазон місяців')
      return
    }
    setSaving(true)
    const payload = {
      direction: form.direction,
      article: form.article || null,
      project_id: form.project_id || null,
      amount: parseFloat(form.amount),
      description: form.description || null,
      is_template: form.is_template,
      year_month: form.is_template ? form.template_from : form.year_month,
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
      direction: p.direction, article: p.article||'', project_id: p.project_id||'',
      amount: Math.abs(p.amount), description: p.description||'',
      is_template: p.is_template||false,
      year_month: p.year_month||'',
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
          { id:'pvf',   label:'План vs Факт',   icon:'ti-arrows-diff' },
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

      {/* ── Form modal ──────────────────────────────────────────────────── */}
      {showForm && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowForm(false)}>
          <div className="modal" style={{ maxWidth:520 }}>
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
              {/* Month(s) */}
              {form.is_template ? (
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
              ) : (
                <div className="form-group">
                  <label>Місяць</label>
                  <select className="form-input" value={form.year_month} onChange={e => setForm(f=>({...f,year_month:e.target.value}))}>
                    <option value="">— оберіть —</option>
                    {nextMonths.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>Напрям</label>
                <select className="form-input" value={form.direction} onChange={e => setForm(f=>({...f,direction:e.target.value}))}>
                  {DIRS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>

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

              <div className="form-group">
                <label>Проєкт</label>
                <select className="form-input" value={form.project_id} onChange={e => setForm(f=>({...f,project_id:e.target.value}))}>
                  <option value="">— без проєкту —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="form-group full">
                <label>Опис (необов'язково)</label>
                <input className="form-input" placeholder="Наприклад: зарплата команди" value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} />
              </div>
            </div>

            {form.is_template && form.template_from && form.template_to && form.amount && (
              <div style={{ background:'#EFF5EF', border:'1px solid #E2E8F0', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'#4A7C59', marginTop:4 }}>
                <i className="ti ti-info-circle" style={{ marginRight:6 }} />
                Буде створено {getMonthRange(form.template_from, form.template_to).length} записів по {fmt(form.amount)} грн кожен
                ({form.direction === 'Доходи' ? '+' : '−'}{fmt(form.amount * getMonthRange(form.template_from, form.template_to).length)} грн загалом)
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

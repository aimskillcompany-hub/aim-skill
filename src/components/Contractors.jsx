import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import { upsertContractor, syncContractorStats, importMissingContractors, mergeDuplicates } from '../lib/contractors'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))
const TYPES = [
  { id: 'client', label: 'Клієнт', bg: '#EFF5EF', color: '#4A7C59' },
  { id: 'supplier', label: 'Постачальник', bg: '#F5EDED', color: '#9B3A3A' },
  { id: 'other', label: 'Інше', bg: '#F0F2F5', color: '#6B6B6B' },
]
const LEGAL_FORMS = ['ТОВ', 'ФОП', 'АТ', 'ПП', 'ФО', 'Інше']
const TAX_SYSTEMS = ['Загальна', 'Спрощена гр.1', 'Спрощена гр.2', 'Спрощена гр.3', 'Спрощена гр.4']
const typeStyle = t => {
  const s = TYPES.find(x => x.id === t) || TYPES[2]
  return { background: s.bg, color: s.color, fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap' }
}
const typeLabel = t => (TYPES.find(x => x.id === t) || TYPES[2]).label

const EMPTY = {
  name:'', short_name:'', edrpou:'', type:'other',
  legal_form:'', tax_system:'', is_vat_payer:false, vat_certificate:'',
  email:'', phone:'', phone2:'', contact_person:'', contact_position:'', website:'',
  address:'', legal_address:'', actual_address:'', city:'', region:'', postal_code:'',
  iban:'', bank_name:'', mfo:'', currency:'UAH',
  default_article:'', default_direction:'', notes:'', status:'active',
}

// ── Section card component ──
function Section({ title, icon, children }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:20, marginBottom:16 }}>
      <div style={{ fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:14, display:'flex', alignItems:'center', gap:8 }}>
        <i className={`ti ${icon}`} style={{ fontSize:16, color:'var(--text2)' }} />{title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value }) {
  if (!value) return null
  return (
    <div style={{ minWidth:0 }}>
      <div style={{ fontSize:12, color:'var(--text3)', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:500, wordBreak:'break-word' }}>{value}</div>
    </div>
  )
}

export default function Contractors({ user }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [articles, setArticles] = useState([])
  const [view, setView] = useState('list') // list | detail
  const [detail, setDetail] = useState(null)
  const [detailTab, setDetailTab] = useState('info')
  const [detailTxs, setDetailTxs] = useState([])
  const [expandedTx, setExpandedTx] = useState(null)
  const [detailProjects, setDetailProjects] = useState([])
  const [detailPlans, setDetailPlans] = useState([])
  const [balanceByMonth, setBalanceByMonth] = useState([])
  const [reconcileFrom, setReconcileFrom] = useState('')
  const [reconcileTo, setReconcileTo] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  useEffect(() => { loadAll(); fetchArticles().then(setArticles) }, [])

  const loadAll = async () => {
    setLoading(true)
    const { data } = await supabase.from('contractors').select('*').order('name')
    const contractors = data || []
    const { data: txStats } = await supabase.from('bank_transactions').select('counterparty, edrpou, amount, direction, date').eq('is_ignored', false)

    // Build stats by ЄДРПОУ (primary) and by name (fallback)
    const statsByCode = {}
    const statsByName = {}
    ;(txStats || []).forEach(tx => {
      const code = tx.edrpou?.trim()
      const name = tx.counterparty?.trim()
      const empty = { income:0, expense:0, otherIn:0, otherOut:0, count:0, lastDate:null }
      const target = code ? (statsByCode[code] || (statsByCode[code] = { ...empty }))
                         : name ? (statsByName[name.toLowerCase()] || (statsByName[name.toLowerCase()] = { ...empty }))
                         : null
      if (!target) return
      target.count++
      const amt = tx.amount || 0
      if (tx.direction === 'Доходи') target.income += Math.abs(amt)
      else if (tx.direction === 'Витрати') target.expense += Math.abs(amt)
      else if (amt > 0) target.otherIn += Math.abs(amt)
      else target.otherOut += Math.abs(amt)
      if (!target.lastDate || tx.date > target.lastDate) target.lastDate = tx.date
    })

    setList(contractors.map(c => {
      const code = c.edrpou?.trim()
      const s = (code && statsByCode[code]) || statsByName[c.name?.trim().toLowerCase()] || {}
      return { ...c, total_income:s.income||c.total_income||0, total_expense:s.expense||c.total_expense||0, total_otherIn:s.otherIn||0, total_otherOut:s.otherOut||0, operations_count:s.count||c.operations_count||0, last_operation_date:s.lastDate||c.last_operation_date }
    }))
    setLoading(false)
  }

  const [filterNoCode, setFilterNoCode] = useState(false)

  const filtered = list.filter(c => {
    if (c.status === 'archived' && filterType !== 'archived') return false
    if (filterType && filterType !== 'archived' && filterType !== 'no_code' && c.type !== filterType) return false
    if (filterNoCode && c.edrpou && c.edrpou.trim().length > 3) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(c.name||'').toLowerCase().includes(q) && !(c.short_name||'').toLowerCase().includes(q) && !(c.edrpou||'').toLowerCase().includes(q)) return false
    }
    return true
  })

  const kpi = {
    total: list.filter(c=>c.status!=='archived').length,
    clients: list.filter(c=>c.type==='client'&&c.status!=='archived').length,
    suppliers: list.filter(c=>c.type==='supplier'&&c.status!=='archived').length,
    noCode: list.filter(c => c.status !== 'archived' && (!c.edrpou || c.edrpou.trim().length <= 3)).length,
    topTurnover: list.reduce((max,c) => {
      const t = (c.total_income||0)+(c.total_expense||0)
      return t>max.val ? { name:c.short_name||c.name, val:t } : max
    }, { name:'—', val:0 }),
  }

  const openAdd = () => { setForm(EMPTY); setEditId(null); setShowForm(true) }
  const openEdit = (c) => {
    const f = {}
    Object.keys(EMPTY).forEach(k => { f[k] = c[k] ?? EMPTY[k] })
    setForm(f); setEditId(c.id); setShowForm(true)
  }
  const handleSave = async () => {
    if (!form.name) return
    setSaving(true)
    const payload = { ...form, created_by:user?.id }
    if (editId) await supabase.from('contractors').update(payload).eq('id', editId)
    else await supabase.from('contractors').insert(payload)
    setSaving(false); setShowForm(false); await loadAll()
    if (editId && detail) {
      const { data } = await supabase.from('contractors').select('*').eq('id', editId).single()
      if (data) setDetail(prev => ({ ...prev, ...data }))
    }
  }
  const handleDelete = async (id) => { if (!confirm('Видалити контрагента?')) return; await supabase.from('contractors').delete().eq('id', id); loadAll(); if (detail?.id===id) { setView('list'); setDetail(null) } }
  const handleArchive = async (c) => {
    const newStatus = c.status === 'archived' ? 'active' : 'archived'
    await supabase.from('contractors').update({ status:newStatus }).eq('id', c.id)
    loadAll()
    if (detail?.id===c.id) setDetail(prev => ({ ...prev, status:newStatus }))
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    const merged = await mergeDuplicates(supabase)
    const synced = await syncContractorStats(supabase)
    setSyncResult({ imported: 0, synced, merged })
    await loadAll()
    setSyncing(false)
  }

  const openDetail = async (c) => {
    setDetail(c); setDetailTab('info'); setView('detail')
    setReconcileFrom(''); setReconcileTo('')
    setExpandedTx(null)

    try {
      // Fetch transactions by ЄДРПОУ (primary) or by name (fallback)
      const baseSelect = 'id,date,amount,direction,article,counterparty,description,project_id,edrpou,doc_type,doc_number'
      const fullSelect = `${baseSelect},documents(id,file_name,file_path,file_type,file_size,doc_role),transaction_items(id,name,quantity,unit,unit_price,amount)`

      const buildQuery = (sel) => {
        let q = supabase.from('bank_transactions').select(sel)
          .eq('is_ignored', false).order('date', { ascending: false }).limit(500)
        if (c.edrpou?.trim()) q = q.eq('edrpou', c.edrpou.trim())
        else q = q.ilike('counterparty', c.name)
        return q
      }

      // Спробувати з documents + items, fallback без них
      let txResult = await buildQuery(fullSelect)
      if (txResult.error) {
        console.warn('Full select failed, fallback:', txResult.error.message)
        txResult = await buildQuery(baseSelect)
      }

      const allTxs = txResult.data || []

      // Підвантажити stock_movements з cost_price для маржинальності
      const allItemIds = allTxs.flatMap(tx => (tx.transaction_items || []).map(it => it.id)).filter(Boolean)
      if (allItemIds.length > 0) {
        try {
          const { data: movs } = await supabase.from('stock_movements')
            .select('transaction_item_id, type, cost_price')
            .in('transaction_item_id', allItemIds)
          const movMap = {}
          ;(movs || []).forEach(m => { if (m.transaction_item_id) movMap[m.transaction_item_id] = m })
          allTxs.forEach(tx => {
            ;(tx.transaction_items || []).forEach(it => {
              const mov = movMap[it.id]
              if (mov) it._costPrice = mov.cost_price
            })
          })
        } catch (e) { console.warn('stock_movements load:', e.message) }
      }

      setDetailTxs(allTxs)

      // Plans (non-blocking)
      try {
        const { data: plans } = await supabase.from('plans')
          .select('id,year_month,planned_date,amount,direction,article,description')
          .ilike('article', `%${c.default_article || '___NOMATCH___'}%`)
          .order('planned_date')
        setDetailPlans(plans || [])
      } catch { setDetailPlans([]) }

      // Find projects linked to this contractor's transactions
      const txIds = allTxs.map(t => t.id).filter(Boolean)
      const projIds = new Set(allTxs.map(t => t.project_id).filter(Boolean))
      if (txIds.length > 0) {
        const { data: items } = await supabase.from('transaction_items')
          .select('project_id').in('bank_transaction_id', txIds).not('project_id', 'is', null)
        ;(items || []).forEach(it => projIds.add(it.project_id))
      }
      if (projIds.size > 0) {
        const { data: projs } = await supabase.from('projects').select('name').in('id', [...projIds])
        setDetailProjects((projs || []).map(p => p.name))
      } else {
        setDetailProjects([])
      }

      // Build monthly balance
      const byMonth = {}
      allTxs.forEach(tx => {
        const m = tx.date?.substring(0,7)
        if (!m) return
        if (!byMonth[m]) byMonth[m] = { month:m, income:0, expense:0, count:0 }
        if (tx.amount > 0) byMonth[m].income += tx.amount
        else byMonth[m].expense += Math.abs(tx.amount)
        byMonth[m].count++
      })
      const months = Object.keys(byMonth).sort()
      let cumBalance = 0
      const rows = months.map(m => {
        const r = byMonth[m]
        const net = r.income - r.expense
        cumBalance += net
        return { ...r, net, cumBalance }
      })
      setBalanceByMonth(rows)
    } catch (e) {
      console.error('openDetail error:', e)
      setDetailTxs([])
      setDetailProjects([])
      setDetailPlans([])
      setBalanceByMonth([])
    }
  }

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'var(--text2)' }}>Завантаження...</div>

  // ═══════════════════════════════════════════
  // DETAIL VIEW — full screen
  // ═══════════════════════════════════════════
  if (view === 'detail' && detail) {
    const balance = (detail.total_income||0) - (detail.total_expense||0)
    const txIncome = detailTxs.filter(t=>t.amount>0).reduce((s,t)=>s+(t.amount||0),0)
    const txExpense = detailTxs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount||0),0)

    return (
      <div>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24, flexWrap:'wrap' }}>
          <button onClick={() => { setView('list'); setDetail(null) }}
            className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
            <i className="ti ti-arrow-left" style={{ fontSize:16 }} /> Назад
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <h1 style={{ fontSize:22, fontWeight:600, margin:0 }}>{detail.short_name || detail.name}</h1>
              <span style={typeStyle(detail.type)}>{typeLabel(detail.type)}</span>
              {detail.status === 'archived' && <span style={{ fontSize:11, background:'var(--surface2)', color:'var(--text3)', padding:'2px 8px', borderRadius:6 }}>Архів</span>}
            </div>
            {detail.edrpou && <div style={{ fontSize:13, color:'var(--text2)', marginTop:4 }}>ЄДРПОУ: {detail.edrpou}</div>}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => openEdit(detail)} className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
              <i className="ti ti-pencil" style={{ fontSize:14 }} /> Редагувати
            </button>
            <button onClick={() => handleArchive(detail)} className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
              <i className={`ti ${detail.status==='archived'?'ti-archive-off':'ti-archive'}`} style={{ fontSize:14 }} />
              {detail.status === 'archived' ? 'Відновити' : 'Архівувати'}
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(4,1fr)', marginBottom:12 }}>
          <div className="kpi"><div className="kpi-label">Доходи</div><div className="kpi-value" style={{ color:'var(--green)' }}>+{fmt(detail.total_income)}</div><div className="kpi-sub">грн</div></div>
          <div className="kpi"><div className="kpi-label">Витрати</div><div className="kpi-value" style={{ color:'var(--red)' }}>-{fmt(detail.total_expense)}</div><div className="kpi-sub">грн</div></div>
          <div className="kpi"><div className="kpi-label">Сальдо</div><div className="kpi-value" style={{ color:balance>=0?'var(--green)':'var(--red)' }}>{balance>=0?'+':'-'}{fmt(balance)}</div><div className="kpi-sub">грн</div></div>
          <div className="kpi"><div className="kpi-label">Операцій</div><div className="kpi-value">{detail.operations_count||0}</div><div className="kpi-sub">остання: {detail.last_operation_date||'—'}</div></div>
        </div>
        {(detail.total_otherIn > 0 || detail.total_otherOut > 0) && (
          <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(3,1fr)', marginBottom:20 }}>
            <div className="kpi"><div className="kpi-label">Інші вхідні</div><div className="kpi-value" style={{ color:'var(--green)' }}>+{fmt(detail.total_otherIn)}</div><div className="kpi-sub">грн</div></div>
            <div className="kpi"><div className="kpi-label">Інші вихідні</div><div className="kpi-value" style={{ color:'var(--red)' }}>-{fmt(detail.total_otherOut)}</div><div className="kpi-sub">грн</div></div>
            <div className="kpi"><div className="kpi-label">Сальдо інших</div><div className="kpi-value" style={{ color:((detail.total_otherIn||0)-(detail.total_otherOut||0))>=0?'var(--green)':'var(--red)' }}>{((detail.total_otherIn||0)-(detail.total_otherOut||0))>=0?'+':'-'}{fmt((detail.total_otherIn||0)-(detail.total_otherOut||0))}</div><div className="kpi-sub">грн</div></div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:20, gap:0 }}>
          {[
            { id:'info', label:'Реквізити', icon:'ti-file-info' },
            { id:'balance', label:'Баланс', icon:'ti-scale' },
            { id:'txs', label:`Операції (${detailTxs.length})`, icon:'ti-list-details' },
            { id:'notes', label:'Нотатки', icon:'ti-notes' },
          ].map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)} style={{
              padding:'10px 18px', border:'none', background:'none', cursor:'pointer',
              fontSize:14, fontWeight:500, fontFamily:'inherit',
              display:'flex', alignItems:'center', gap:6,
              borderBottom: detailTab===t.id ? '2px solid #000' : '2px solid transparent',
              color: detailTab===t.id ? 'var(--text)' : 'var(--text2)',
            }}><i className={`ti ${t.icon}`} style={{ fontSize:15 }} />{t.label}</button>
          ))}
        </div>

        {/* ── Tab: Реквізити ── */}
        {detailTab === 'info' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <Section title="Юридичні дані" icon="ti-building">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Field label="Повна назва" value={detail.name} />
                <Field label="Коротка назва" value={detail.short_name} />
                <Field label="ЄДРПОУ / ІПН" value={detail.edrpou} />
                <Field label="Форма" value={detail.legal_form} />
                <Field label="Система оподаткування" value={detail.tax_system} />
                <Field label="Платник ПДВ" value={detail.is_vat_payer ? 'Так' : 'Ні'} />
                <Field label="№ свідоцтва ПДВ" value={detail.vat_certificate} />
                <Field label="Тип" value={typeLabel(detail.type)} />
              </div>
            </Section>

            <Section title="Контакти" icon="ti-address-book">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Field label="Контактна особа" value={detail.contact_person} />
                <Field label="Посада" value={detail.contact_position} />
                <Field label="Телефон" value={detail.phone} />
                <Field label="Доп. телефон" value={detail.phone2} />
                <Field label="Email" value={detail.email} />
                <Field label="Сайт" value={detail.website} />
              </div>
            </Section>

            <Section title="Банківські реквізити" icon="ti-building-bank">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Field label="IBAN" value={detail.iban} />
                <Field label="Банк" value={detail.bank_name} />
                <Field label="МФО" value={detail.mfo} />
                <Field label="Валюта" value={detail.currency} />
              </div>
            </Section>

            <Section title="Адреса" icon="ti-map-pin">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Field label="Юридична адреса" value={detail.legal_address} />
                <Field label="Фактична адреса" value={detail.actual_address} />
                <Field label="Місто" value={detail.city} />
                <Field label="Область" value={detail.region} />
                <Field label="Індекс" value={detail.postal_code} />
              </div>
            </Section>

            <Section title="Налаштування" icon="ti-settings">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Field label="Стаття за замовч." value={detail.default_article} />
                <Field label="Напрям за замовч." value={detail.default_direction} />
              </div>
            </Section>
          </div>
        )}

        {/* ── Tab: Баланс ── */}
        {detailTab === 'balance' && (() => {
          const totalIncome = detailTxs.filter(t=>t.amount>0).reduce((s,t)=>s+(t.amount||0),0)
          const totalExpense = detailTxs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount||0),0)
          const currentBalance = totalIncome - totalExpense
          const today = new Date().toISOString().split('T')[0]

          // Overdue plans
          const overdue = detailPlans.filter(p => {
            const d = p.planned_date || (p.year_month + '-28')
            return d < today && p.direction === 'Доходи'
          })

          // Upcoming plans
          const upcoming = detailPlans.filter(p => {
            const d = p.planned_date || (p.year_month + '-01')
            return d >= today
          }).slice(0, 10)

          // Reconciliation data — filtered by period
          const reconTxs = detailTxs.filter(tx => {
            if (reconcileFrom && tx.date < reconcileFrom) return false
            if (reconcileTo && tx.date > reconcileTo) return false
            return true
          })
          const reconIncome = reconTxs.filter(t=>t.amount>0).reduce((s,t)=>s+(t.amount||0),0)
          const reconExpense = reconTxs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount||0),0)

          return (
            <div>
              {/* Balance KPIs */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:20 }}>
                <div className="kpi">
                  <div className="kpi-label">Поточний баланс</div>
                  <div className="kpi-value" style={{ color: currentBalance>=0?'var(--green)':'var(--red)' }}>
                    {currentBalance>=0?'+':'-'}{fmt(currentBalance)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>грн</span>
                  </div>
                  <div className="kpi-sub">{currentBalance>0?'Нам повинні':'Ми повинні'}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Нам оплатили</div>
                  <div className="kpi-value" style={{ color:'var(--green)' }}>+{fmt(totalIncome)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>грн</span></div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Ми оплатили</div>
                  <div className="kpi-value" style={{ color:'var(--red)' }}>-{fmt(totalExpense)} <span style={{ fontSize:13, fontWeight:400, color:'var(--text3)' }}>грн</span></div>
                </div>
              </div>

              {/* Overdue */}
              {overdue.length > 0 && (
                <Section title={`Прострочені платежі (${overdue.length})`} icon="ti-alert-triangle">
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {overdue.map(p => (
                      <div key={p.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', background:'var(--red-bg)', borderRadius:8, border:'1px solid var(--border)' }}>
                        <div>
                          <div style={{ fontWeight:500, fontSize:14 }}>{p.article || p.description || 'Без статті'}</div>
                          <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>{p.planned_date || p.year_month} · {p.direction}</div>
                        </div>
                        <div style={{ fontSize:16, fontWeight:500, color:'var(--red)', whiteSpace:'nowrap' }}>
                          {fmt(p.amount)} грн
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Upcoming payments */}
              {upcoming.length > 0 && (
                <Section title="Очікувані платежі" icon="ti-calendar-event">
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {upcoming.map(p => (
                      <div key={p.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', background:'var(--surface2)', borderRadius:8 }}>
                        <div>
                          <div style={{ fontWeight:500, fontSize:14 }}>{p.article || p.description || 'Без статті'}</div>
                          <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>{p.planned_date || p.year_month}</div>
                        </div>
                        <div style={{ fontSize:15, fontWeight:500, color: p.direction==='Доходи'?'var(--green)':'var(--red)', whiteSpace:'nowrap' }}>
                          {p.direction==='Доходи'?'+':'-'}{fmt(p.amount)} грн
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Monthly balance history */}
              {balanceByMonth.length > 0 && (
                <Section title="Помісячний баланс" icon="ti-chart-line">
                  <div className="tbl-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Місяць</th>
                          <th style={{ textAlign:'right' }}>Дохід</th>
                          <th style={{ textAlign:'right' }}>Витрати</th>
                          <th style={{ textAlign:'right' }}>Сальдо</th>
                          <th style={{ textAlign:'right' }}>Накопичений баланс</th>
                          <th style={{ textAlign:'right' }}>Операцій</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balanceByMonth.map(r => (
                          <tr key={r.month}>
                            <td style={{ fontWeight:500 }}>{r.month}</td>
                            <td style={{ textAlign:'right', color:'var(--green)', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>
                              {r.income>0 ? '+'+fmt(r.income) : '—'}
                            </td>
                            <td style={{ textAlign:'right', color:'var(--red)', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>
                              {r.expense>0 ? '-'+fmt(r.expense) : '—'}
                            </td>
                            <td style={{ textAlign:'right', fontWeight:500, color:r.net>=0?'var(--green)':'var(--red)', fontVariantNumeric:'tabular-nums' }}>
                              {r.net>=0?'+':'-'}{fmt(r.net)}
                            </td>
                            <td style={{ textAlign:'right', fontWeight:500, color:r.cumBalance>=0?'var(--green)':'var(--red)', fontVariantNumeric:'tabular-nums' }}>
                              {r.cumBalance>=0?'+':'-'}{fmt(r.cumBalance)}
                            </td>
                            <td style={{ textAlign:'right', color:'var(--text2)' }}>{r.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* Reconciliation act */}
              <Section title="Акт звірки" icon="ti-file-check">
                <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
                  <span style={{ fontSize:13, color:'var(--text2)' }}>Період:</span>
                  <input type="date" className="form-input" value={reconcileFrom} onChange={e => setReconcileFrom(e.target.value)} style={{ width:160, height:40, fontSize:13 }} />
                  <span style={{ color:'var(--text3)' }}>—</span>
                  <input type="date" className="form-input" value={reconcileTo} onChange={e => setReconcileTo(e.target.value)} style={{ width:160, height:40, fontSize:13 }} />
                  {(reconcileFrom||reconcileTo) && (
                    <button className="btn btn-sm btn-secondary" onClick={() => { setReconcileFrom(''); setReconcileTo('') }} style={{ width:'auto', height:40 }}>
                      <i className="ti ti-x" style={{ fontSize:13 }} /> Скинути
                    </button>
                  )}
                </div>

                {reconTxs.length === 0 ? (
                  <div style={{ padding:24, textAlign:'center', color:'var(--text3)' }}>
                    {reconcileFrom||reconcileTo ? 'Немає операцій за обраний період' : 'Оберіть період для формування акту звірки'}
                  </div>
                ) : (
                  <>
                    {/* Summary */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
                      <div style={{ background:'var(--green-bg)', borderRadius:8, padding:'12px 16px' }}>
                        <div style={{ fontSize:12, color:'var(--green)' }}>Надходження</div>
                        <div style={{ fontSize:18, fontWeight:500, color:'var(--green)' }}>+{fmt(reconIncome)} грн</div>
                      </div>
                      <div style={{ background:'var(--red-bg)', borderRadius:8, padding:'12px 16px' }}>
                        <div style={{ fontSize:12, color:'var(--red)' }}>Витрати</div>
                        <div style={{ fontSize:18, fontWeight:500, color:'var(--red)' }}>-{fmt(reconExpense)} грн</div>
                      </div>
                      <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 16px' }}>
                        <div style={{ fontSize:12, color:'var(--text2)' }}>Сальдо</div>
                        <div style={{ fontSize:18, fontWeight:500, color:(reconIncome-reconExpense)>=0?'var(--green)':'var(--red)' }}>
                          {(reconIncome-reconExpense)>=0?'+':'-'}{fmt(reconIncome-reconExpense)} грн
                        </div>
                      </div>
                    </div>

                    {/* Transactions list */}
                    <div className="tbl-wrap" style={{ maxHeight:300 }}>
                      <table>
                        <thead><tr><th>Дата</th><th>Напрям</th><th>Стаття</th><th style={{ textAlign:'right' }}>Сума</th></tr></thead>
                        <tbody>
                          {reconTxs.sort((a,b) => a.date>b.date?1:-1).map(tx => (
                            <tr key={tx.id}>
                              <td style={{ fontSize:13, whiteSpace:'nowrap' }}>{tx.date}</td>
                              <td style={{ fontSize:13, color:'var(--text2)' }}>{tx.direction}</td>
                              <td style={{ fontSize:13, color:'var(--text2)' }}>{tx.article||'—'}</td>
                              <td style={{ textAlign:'right', fontWeight:500, color:tx.amount>=0?'var(--green)':'var(--red)', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
                                {tx.amount>=0?'+':''}{fmt(tx.amount)} грн
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ marginTop:12, fontSize:13, color:'var(--text3)', textAlign:'right' }}>
                      {reconTxs.length} операцій за {reconcileFrom||'початок'} — {reconcileTo||'сьогодні'}
                    </div>
                  </>
                )}
              </Section>
            </div>
          )
        })()}

        {/* ── Tab: Операції ── */}
        {detailTab === 'txs' && (
          <div>
            {detailTxs.length === 0 ? (
              <div className="card"><div className="empty"><p>Немає операцій з цим контрагентом</p></div></div>
            ) : (
              <>
                {(() => {
                  // Торгова маржинальність
                  const salesTxs = detailTxs.filter(t => t.direction === 'Доходи')
                  const salesItems = salesTxs.flatMap(tx => (tx.transaction_items || []))
                  let goodsRevenue = 0, goodsCost = 0
                  salesItems.forEach(it => {
                    const qty = parseFloat(it.quantity) || 0
                    const sellPrice = parseFloat(it.unit_price) || 0
                    const costPrice = it._costPrice || 0
                    goodsRevenue += qty * sellPrice
                    goodsCost += qty * costPrice
                  })
                  const goodsMargin = goodsRevenue - goodsCost
                  const hasGoods = goodsRevenue > 0

                  return (
                    <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
                      <div style={{ background:'var(--green-bg)', borderRadius:12, padding:'12px 16px', flex:1, minWidth:100 }}>
                        <div style={{ fontSize:11, color:'var(--green)' }}>Дохід (оплати)</div>
                        <div style={{ fontSize:18, fontWeight:500, color:'var(--green)' }}>+{fmt(txIncome)} грн</div>
                      </div>
                      <div style={{ background:'var(--red-bg)', borderRadius:12, padding:'12px 16px', flex:1, minWidth:100 }}>
                        <div style={{ fontSize:11, color:'var(--red)' }}>Витрати (оплати)</div>
                        <div style={{ fontSize:18, fontWeight:500, color:'var(--red)' }}>-{fmt(txExpense)} грн</div>
                      </div>
                      {hasGoods && (
                        <>
                          <div style={{ background:'var(--surface2)', borderRadius:12, padding:'12px 16px', flex:1, minWidth:100 }}>
                            <div style={{ fontSize:11, color:'var(--text3)' }}>Собівартість</div>
                            <div style={{ fontSize:18, fontWeight:500 }}>{fmt(goodsCost)} грн</div>
                          </div>
                          <div style={{ background: goodsMargin >= 0 ? 'var(--green-bg)' : 'var(--red-bg)', borderRadius:12, padding:'12px 16px', flex:1, minWidth:100 }}>
                            <div style={{ fontSize:11, color: goodsMargin >= 0 ? 'var(--green)' : 'var(--red)' }}>Маржа товарів</div>
                            <div style={{ fontSize:18, fontWeight:500, color: goodsMargin >= 0 ? 'var(--green)' : 'var(--red)' }}>
                              {goodsMargin >= 0 ? '+' : '−'}{fmt(Math.abs(goodsMargin))} грн
                              {goodsRevenue > 0 && <span style={{ fontSize:12, fontWeight:400 }}> ({((goodsMargin / goodsRevenue) * 100).toFixed(0)}%)</span>}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })()}
                <div className="tbl-wrap">
                  <table>
                    <thead><tr><th>Дата</th><th style={{ textAlign:'right' }}>Сума</th><th>Напрям</th><th>Стаття</th><th>Опис</th><th style={{ width:40 }}></th></tr></thead>
                    <tbody>
                      {detailTxs.map(tx => {
                        const isExpanded = expandedTx === tx.id
                        const hasDocs = tx.documents?.length > 0
                        const hasItems = tx.transaction_items?.length > 0
                        const hasDetails = hasDocs || hasItems || tx.description
                        return (
                          <React.Fragment key={tx.id}>
                            <tr style={{ cursor: hasDetails ? 'pointer' : 'default', background: isExpanded ? 'var(--bg)' : '' }}
                              onClick={() => hasDetails && setExpandedTx(isExpanded ? null : tx.id)}>
                              <td style={{ fontSize:13, color:'var(--text2)', whiteSpace:'nowrap' }}>{tx.date}</td>
                              <td style={{ textAlign:'right', fontWeight:500, color:tx.amount>=0?'var(--green)':'var(--red)', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
                                {tx.amount>=0?'+':''}{fmt(tx.amount)} грн
                              </td>
                              <td style={{ fontSize:13, color:'var(--text2)' }}>{tx.direction}</td>
                              <td style={{ fontSize:13, color:'var(--text2)' }}>{tx.article||'—'}</td>
                              <td style={{ fontSize:12, color:'var(--text3)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.description||'—'}</td>
                              <td style={{ textAlign:'center' }}>
                                {hasDetails && (
                                  <span style={{ display:'flex', gap:4, justifyContent:'center', alignItems:'center' }}>
                                    {hasDocs && <i className="ti ti-paperclip" style={{ fontSize:13, color:'var(--blue)' }} title={`${tx.documents.length} файл(ів)`} />}
                                    {hasItems && <i className="ti ti-package" style={{ fontSize:13, color:'var(--text2)' }} title={`${tx.transaction_items.length} позицій`} />}
                                    <i className={`ti ti-chevron-${isExpanded?'up':'down'}`} style={{ fontSize:13, color:'var(--text3)' }} />
                                  </span>
                                )}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr><td colSpan={6} style={{ padding:0, background:'var(--bg)' }}>
                                <div style={{ padding:'12px 18px', display:'flex', flexDirection:'column', gap:10 }}>
                                  {tx.description && (
                                    <div style={{ fontSize:12.5, color:'var(--text2)', lineHeight:1.5 }}>
                                      <strong>Призначення:</strong> {tx.description}
                                    </div>
                                  )}
                                  {tx.doc_type && (
                                    <div style={{ fontSize:12, color:'var(--text3)' }}>
                                      Тип: {tx.doc_type}{tx.doc_number ? ` №${tx.doc_number}` : ''}
                                    </div>
                                  )}
                                  {hasItems && (
                                    <div>
                                      <div style={{ fontSize:12, fontWeight:500, color:'var(--text2)', marginBottom:4 }}>Позиції ({tx.transaction_items.length})</div>
                                      {(() => {
                                        const isSale = tx.direction === 'Доходи'
                                        const items = tx.transaction_items
                                        const txCost = isSale ? items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (it._costPrice || 0), 0) : 0
                                        const txSell = isSale ? items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0) : 0
                                        const txMargin = txSell - txCost
                                        return (<>
                                      <table style={{ width:'100%', fontSize:12 }}>
                                        <thead><tr style={{ background:'var(--surface)' }}>
                                          <th style={{ textAlign:'left', padding:'4px 8px' }}>Назва</th>
                                          <th style={{ textAlign:'right', padding:'4px 8px' }}>К-сть</th>
                                          <th style={{ textAlign:'left', padding:'4px 8px' }}>Од.</th>
                                          <th style={{ textAlign:'right', padding:'4px 8px' }}>Ціна</th>
                                          {isSale && <th style={{ textAlign:'right', padding:'4px 8px' }}>С/в</th>}
                                          <th style={{ textAlign:'right', padding:'4px 8px' }}>Сума</th>
                                          {isSale && <th style={{ textAlign:'right', padding:'4px 8px' }}>Маржа</th>}
                                        </tr></thead>
                                        <tbody>
                                          {items.map(it => {
                                            const qty = parseFloat(it.quantity) || 0
                                            const costPrice = it._costPrice || 0
                                            const margin = isSale ? qty * (parseFloat(it.unit_price) || 0) - qty * costPrice : 0
                                            return (
                                            <tr key={it.id} style={{ borderBottom:'1px solid var(--border)' }}>
                                              <td style={{ padding:'4px 8px' }}>{it.name}</td>
                                              <td style={{ padding:'4px 8px', textAlign:'right' }}>{it.quantity||'—'}</td>
                                              <td style={{ padding:'4px 8px' }}>{it.unit||''}</td>
                                              <td style={{ padding:'4px 8px', textAlign:'right' }}>{it.unit_price ? fmt(it.unit_price) : '—'}</td>
                                              {isSale && <td style={{ padding:'4px 8px', textAlign:'right', color:'var(--text3)' }}>{costPrice ? fmt(costPrice) : '—'}</td>}
                                              <td style={{ padding:'4px 8px', textAlign:'right', fontWeight:500 }}>{it.amount ? fmt(it.amount) : '—'}</td>
                                              {isSale && <td style={{ padding:'4px 8px', textAlign:'right', fontWeight:500, color: margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{costPrice ? `${margin>=0?'+':''}${fmt(margin)}` : '—'}</td>}
                                            </tr>
                                          )})}
                                        </tbody>
                                        {isSale && txCost > 0 && (
                                          <tfoot><tr style={{ borderTop:'2px solid var(--border)', fontWeight:600, fontSize:12 }}>
                                            <td colSpan={4} style={{ padding:'4px 8px' }}>Разом</td>
                                            <td style={{ padding:'4px 8px', textAlign:'right' }}>{fmt(txCost)}</td>
                                            <td style={{ padding:'4px 8px', textAlign:'right' }}>{fmt(txSell)}</td>
                                            <td style={{ padding:'4px 8px', textAlign:'right', color: txMargin >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                              {txMargin>=0?'+':''}{fmt(txMargin)}
                                            </td>
                                          </tr></tfoot>
                                        )}
                                      </table>
                                      </>)})()}
                                    </div>
                                  )}
                                  {hasDocs && (
                                    <div>
                                      <div style={{ fontSize:12, fontWeight:500, color:'var(--text2)', marginBottom:4 }}>Документи ({tx.documents.length})</div>
                                      {tx.documents.map(doc => (
                                        <div key={doc.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0' }}>
                                          <i className="ti ti-file-text" style={{ fontSize:14, color:'var(--blue)' }} />
                                          <span style={{ fontSize:12, color:'var(--text2)', flex:1 }}>{doc.file_name}</span>
                                          <button className="btn btn-sm btn-secondary" style={{ padding:'2px 8px', fontSize:11 }}
                                            onClick={async (e) => {
                                              e.stopPropagation()
                                              const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 300)
                                              if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                                            }}>
                                            <i className="ti ti-eye" style={{ fontSize:12 }} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td></tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Tab: Проєкти ── */}
        {detailTab === 'projects' && (
          <div>
            {detailProjects.length === 0 ? (
              <div className="card"><div className="empty"><p>Немає прив'язаних проєктів</p></div></div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:12 }}>
                {detailProjects.map(name => (
                  <div key={name} className="card" style={{ marginBottom:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <i className="ti ti-briefcase" style={{ fontSize:18, color:'var(--text2)' }} />
                      <div style={{ fontWeight:500, fontSize:15 }}>{name}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Нотатки ── */}
        {detailTab === 'notes' && (
          <div className="card">
            {detail.notes ? (
              <div style={{ fontSize:14, lineHeight:1.6, whiteSpace:'pre-wrap' }}>{detail.notes}</div>
            ) : (
              <div className="empty"><p>Немає нотаток. Натисніть "Редагувати" щоб додати.</p></div>
            )}
          </div>
        )}

        {/* Form modal (reused) */}
        {showForm && renderForm()}
      </div>
    )
  }

  // ═══════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════
  function renderForm() {
    return (
      <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowForm(false)}>
        <div className="modal modal-lg">
          <div className="modal-header">
            <h2>{editId ? 'Редагувати контрагента' : 'Новий контрагент'}</h2>
            <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
          </div>
          <div className="form-grid">
            <div className="form-group full"><label>Повна назва *</label><input className="form-input" value={form.name} onChange={setF('name')} placeholder="ТОВ Компанія" /></div>
            <div className="form-group"><label>Коротка назва</label><input className="form-input" value={form.short_name} onChange={setF('short_name')} /></div>
            <div className="form-group"><label>ЄДРПОУ / ІПН</label><input className="form-input" value={form.edrpou} onChange={setF('edrpou')} /></div>
            <div className="form-group"><label>Тип</label><select className="form-input" value={form.type} onChange={setF('type')}>{TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div className="form-group"><label>Юридична форма</label><select className="form-input" value={form.legal_form} onChange={setF('legal_form')}><option value="">—</option>{LEGAL_FORMS.map(f=><option key={f}>{f}</option>)}</select></div>
            <div className="form-group"><label>Система оподаткування</label><select className="form-input" value={form.tax_system} onChange={setF('tax_system')}><option value="">—</option>{TAX_SYSTEMS.map(s=><option key={s}>{s}</option>)}</select></div>
            <div className="form-group">
              <label>Платник ПДВ</label>
              <div style={{ display:'flex', alignItems:'center', gap:8, height:48 }}>
                <input type="checkbox" checked={form.is_vat_payer} onChange={setF('is_vat_payer')} style={{ width:18, height:18 }} />
                <span style={{ fontSize:14, color:'var(--text2)' }}>{form.is_vat_payer ? 'Так' : 'Ні'}</span>
              </div>
            </div>
            {form.is_vat_payer && <div className="form-group"><label>№ свідоцтва ПДВ</label><input className="form-input" value={form.vat_certificate} onChange={setF('vat_certificate')} /></div>}

            <div className="form-group"><label>Контактна особа</label><input className="form-input" value={form.contact_person} onChange={setF('contact_person')} /></div>
            <div className="form-group"><label>Посада</label><input className="form-input" value={form.contact_position} onChange={setF('contact_position')} /></div>
            <div className="form-group"><label>Телефон</label><input className="form-input" value={form.phone} onChange={setF('phone')} placeholder="+380..." /></div>
            <div className="form-group"><label>Доп. телефон</label><input className="form-input" value={form.phone2} onChange={setF('phone2')} /></div>
            <div className="form-group"><label>Email</label><input className="form-input" value={form.email} onChange={setF('email')} /></div>
            <div className="form-group"><label>Сайт</label><input className="form-input" value={form.website} onChange={setF('website')} /></div>

            <div className="form-group full"><label>Юридична адреса</label><input className="form-input" value={form.legal_address} onChange={setF('legal_address')} /></div>
            <div className="form-group full"><label>Фактична адреса</label><input className="form-input" value={form.actual_address} onChange={setF('actual_address')} /></div>
            <div className="form-group"><label>Місто</label><input className="form-input" value={form.city} onChange={setF('city')} /></div>
            <div className="form-group"><label>Область</label><input className="form-input" value={form.region} onChange={setF('region')} /></div>
            <div className="form-group"><label>Індекс</label><input className="form-input" value={form.postal_code} onChange={setF('postal_code')} /></div>

            <div className="form-group"><label>IBAN</label><input className="form-input" value={form.iban} onChange={setF('iban')} placeholder="UA..." /></div>
            <div className="form-group"><label>Банк</label><input className="form-input" value={form.bank_name} onChange={setF('bank_name')} /></div>
            <div className="form-group"><label>МФО</label><input className="form-input" value={form.mfo} onChange={setF('mfo')} /></div>
            <div className="form-group"><label>Валюта</label><select className="form-input" value={form.currency} onChange={setF('currency')}><option>UAH</option><option>USD</option><option>EUR</option></select></div>

            <div className="form-group"><label>Стаття за замовч.</label>
              <select className="form-input" value={form.default_article} onChange={setF('default_article')}>
                <option value="">—</option>
                {Object.entries(groupByType(articles)).map(([type,items]) =>
                  items.length>0 ? <optgroup key={type} label={TYPE_LABELS[type]}>{items.map(a=><option key={a.id} value={a.name}>{a.name}</option>)}</optgroup> : null
                )}
              </select>
            </div>
            <div className="form-group"><label>Напрям за замовч.</label>
              <select className="form-input" value={form.default_direction} onChange={setF('default_direction')}><option value="">—</option><option>Доходи</option><option>Витрати</option><option>ПФД</option><option>Інше</option></select>
            </div>
            <div className="form-group full"><label>Нотатки</label><textarea className="form-input" rows={3} value={form.notes} onChange={setF('notes')} /></div>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleSave} disabled={saving||!form.name} style={{ width:'auto' }}>{saving?'Збереження...':editId?'Зберегти':'Додати'}</button>
            <button className="btn btn-secondary" onClick={() => setShowForm(false)} style={{ width:'auto' }}>Скасувати</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div><h1>Контрагенти</h1><p>Реєстр клієнтів та постачальників</p></div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={handleSync} disabled={syncing} style={{ width:'auto' }}>
            <i className={`ti ${syncing ? 'ti-loader-2' : 'ti-refresh'}`} style={{ fontSize:15 }} />
            {syncing ? 'Синхронізація...' : 'Синхронізувати'}
          </button>
          <button className="btn btn-primary" onClick={openAdd} style={{ width:'auto' }}>
            <i className="ti ti-plus" style={{ fontSize:15 }} /> Додати
          </button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(5,1fr)', marginBottom:20 }}>
        <div className="kpi"><div className="kpi-label">Всього</div><div className="kpi-value">{kpi.total}</div></div>
        <div className="kpi"><div className="kpi-label">Клієнти</div><div className="kpi-value" style={{ color:'var(--green)' }}>{kpi.clients}</div></div>
        <div className="kpi"><div className="kpi-label">Постачальники</div><div className="kpi-value" style={{ color:'var(--red)' }}>{kpi.suppliers}</div></div>
        <div className="kpi" style={{ cursor:'pointer', border: filterNoCode ? '2px solid var(--red)' : undefined }} onClick={() => setFilterNoCode(f=>!f)}>
          <div className="kpi-label">Без ЄДРПОУ/ІПН</div>
          <div className="kpi-value" style={{ color: kpi.noCode > 0 ? 'var(--red)' : 'var(--green)' }}>{kpi.noCode}</div>
        </div>
      </div>

      {syncResult && (
        <div style={{ background:'var(--green-bg)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 16px', marginBottom:12, fontSize:13, color:'var(--green)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>Імпортовано: {syncResult.imported} нових · Об'єднано дублікатів: {syncResult.merged || 0} · Оновлено: {syncResult.synced}</span>
          <button onClick={() => setSyncResult(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--green)', fontSize:16 }}>×</button>
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ flex:1, position:'relative', minWidth:200 }}>
          <i className="ti ti-search" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:16 }} />
          <input className="form-input" style={{ width:'100%', paddingLeft:38 }} placeholder="Пошук..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['','client','supplier','other'].map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`btn btn-sm ${filterType===t?'btn-primary':'btn-secondary'}`} style={{ width:'auto' }}>{t?typeLabel(t):'Всі'}</button>
        ))}
        <button onClick={() => setFilterNoCode(f => !f)}
          className={`btn btn-sm ${filterNoCode?'btn-primary':'btn-secondary'}`}
          style={{ width:'auto' }}>
          <i className="ti ti-alert-circle" style={{ fontSize:14 }} />
          Без ЄДРПОУ/ІПН
        </button>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Назва</th><th>Тип</th><th style={{ textAlign:'right' }}>Доходи</th><th style={{ textAlign:'right' }}>Витрати</th><th style={{ textAlign:'right' }}>Сальдо</th><th style={{ textAlign:'right' }}>Інші вх.</th><th style={{ textAlign:'right' }}>Інші вих.</th><th style={{ textAlign:'right' }}>Оп.</th><th>Остання</th><th style={{ width:80 }}></th></tr></thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={10} style={{ textAlign:'center', padding:32, color:'var(--text3)' }}>{search?'Не знайдено':'Немає контрагентів'}</td></tr>}
            {filtered.map(c => (
              <tr key={c.id} style={{ cursor:'pointer' }} onClick={() => openDetail(c)}>
                <td><div style={{ fontWeight:500, fontSize:14 }}>{c.short_name||c.name}</div>{c.edrpou && <div style={{ fontSize:12, color:'var(--text3)' }}>ЄДРПОУ: {c.edrpou}</div>}</td>
                <td><span style={typeStyle(c.type)}>{typeLabel(c.type)}</span></td>
                <td style={{ textAlign:'right', color:'var(--green)', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{c.total_income>0?'+'+fmt(c.total_income):'—'}</td>
                <td style={{ textAlign:'right', color:'var(--red)', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{c.total_expense>0?'-'+fmt(c.total_expense):'—'}</td>
                <td style={{ textAlign:'right', fontWeight:500, fontVariantNumeric:'tabular-nums', color:(c.total_income-c.total_expense)>=0?'var(--green)':'var(--red)' }}>{(c.total_income||c.total_expense)?(c.total_income-c.total_expense>=0?'+':'-')+fmt(c.total_income-c.total_expense):'—'}</td>
                <td style={{ textAlign:'right', color:'var(--green)', fontVariantNumeric:'tabular-nums' }}>{c.total_otherIn>0?'+'+fmt(c.total_otherIn):'—'}</td>
                <td style={{ textAlign:'right', color:'var(--red)', fontVariantNumeric:'tabular-nums' }}>{c.total_otherOut>0?'-'+fmt(c.total_otherOut):'—'}</td>
                <td style={{ textAlign:'right', color:'var(--text2)' }}>{c.operations_count||0}</td>
                <td style={{ fontSize:13, color:'var(--text2)', whiteSpace:'nowrap' }}>{c.last_operation_date||'—'}</td>
                <td onClick={e => e.stopPropagation()}>
                  <div style={{ display:'flex', gap:4 }}>
                    <button onClick={() => openEdit(c)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:8, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text2)' }}><i className="ti ti-pencil" style={{ fontSize:14 }} /></button>
                    <button onClick={() => handleDelete(c.id)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:8, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--red)' }}><i className="ti ti-trash" style={{ fontSize:14 }} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && renderForm()}
    </div>
  )
}

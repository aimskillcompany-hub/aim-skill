import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import { upsertContractor, syncContractorStats, importMissingContractors, mergeDuplicates } from '../lib/contractors'
import { fetchByEdrpou, isVkursiConfigured, getVkursiCredentials, setVkursiCredentials } from '../lib/vkursi'
import DocGenModal from './DocGenModal'
import { loadContractorDocs, getDocLabel, getDocType, STATUS_LABELS, STATUS_COLORS, formatMoney as fmtDoc, updateDocStatus, generatePdf, generateXlsx, DOCUMENT_TYPES, createStockFromDoc } from '../lib/docgen'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))

function ItemsTable({ items, isSale, onProductClick }) {
  const totalSell = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0)
  const totalCost = isSale ? items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (it._costPrice || 0), 0) : 0
  const totalMargin = totalSell - totalCost
  return (
    <div>
      <div style={{ fontSize:12, fontWeight:500, color:'var(--text2)', marginBottom:4 }}>Позиції ({items.length})</div>
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
            const cp = it._costPrice
            const hasCost = cp !== null && cp !== undefined && cp > 0
            const sell = parseFloat(it.amount) || 0
            const margin = hasCost ? sell - qty * cp : null
            return (
              <tr key={it.id} style={{ borderBottom:'1px solid var(--border)' }}>
                <td style={{ padding:'4px 8px' }}>
                  {it.product_id && onProductClick ? (
                    <span style={{ color:'var(--blue)', cursor:'pointer', textDecoration:'underline dotted' }}
                      onClick={e => { e.stopPropagation(); onProductClick(it.product_id) }}
                      title="Відкрити на складі">{it.name}</span>
                  ) : it.name}
                </td>
                <td style={{ padding:'4px 8px', textAlign:'right' }}>{qty || '—'}</td>
                <td style={{ padding:'4px 8px' }}>{it.unit || ''}</td>
                <td style={{ padding:'4px 8px', textAlign:'right' }}>{it.unit_price ? fmt(it.unit_price) : '—'}</td>
                {isSale && <td style={{ padding:'4px 8px', textAlign:'right', color:'var(--text3)' }}>{hasCost ? fmt(cp) : '—'}</td>}
                <td style={{ padding:'4px 8px', textAlign:'right', fontWeight:500 }}>{sell ? fmt(sell) : '—'}</td>
                {isSale && <td style={{ padding:'4px 8px', textAlign:'right', fontWeight:500, color: margin !== null ? (margin >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)' }}>{margin !== null ? (margin >= 0 ? '+' : '') + fmt(margin) : '—'}</td>}
              </tr>
            )
          })}
        </tbody>
        {isSale && totalCost > 0 && (
          <tfoot><tr style={{ borderTop:'2px solid var(--border)', fontWeight:600 }}>
            <td colSpan={4} style={{ padding:'4px 8px' }}>Разом</td>
            <td style={{ padding:'4px 8px', textAlign:'right' }}>{fmt(totalCost)}</td>
            <td style={{ padding:'4px 8px', textAlign:'right' }}>{fmt(totalSell)}</td>
            <td style={{ padding:'4px 8px', textAlign:'right', color: totalMargin >= 0 ? 'var(--green)' : 'var(--red)' }}>{totalMargin >= 0 ? '+' : ''}{fmt(totalMargin)}</td>
          </tr></tfoot>
        )}
      </table>
    </div>
  )
}

function TxStats({ txs, txIncome, txExpense }) {
  let goodsCost = 0, goodsRevenue = 0
  txs.filter(t => t.direction === 'Доходи').forEach(tx => {
    (tx.transaction_items || []).forEach(it => {
      const qty = parseFloat(it.quantity) || 0
      const cp = it._costPrice
      const sell = parseFloat(it.unit_price) || 0
      if (cp && cp > 0) goodsCost += qty * cp
      goodsRevenue += qty * sell
    })
  })
  // Все без ПДВ: виручка з items, собівартість FIFO
  const revenue = goodsRevenue > 0 ? goodsRevenue : txIncome
  const totalExp = goodsCost + txExpense
  const margin = revenue - totalExp
  const marginColor = margin >= 0 ? 'var(--green)' : 'var(--red)'
  const marginBg = margin >= 0 ? 'var(--green-bg)' : 'var(--red-bg)'
  return (
    <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
      <div style={{ background:'var(--green-bg)', borderRadius:12, padding:'12px 16px', flex:1, minWidth:100 }}>
        <div style={{ fontSize:11, color:'var(--green)' }}>Виручка (без ПДВ)</div>
        <div style={{ fontSize:18, fontWeight:500, color:'var(--green)' }}>+{fmt(revenue)} грн</div>
        {goodsRevenue > 0 && txIncome !== revenue && <div style={{ fontSize:10, color:'var(--text3)' }}>Оплачено: {fmt(txIncome)} (з ПДВ)</div>}
      </div>
      <div style={{ background:'var(--red-bg)', borderRadius:12, padding:'12px 16px', flex:1, minWidth:100 }}>
        <div style={{ fontSize:11, color:'var(--red)' }}>Витрати</div>
        <div style={{ fontSize:18, fontWeight:500, color:'var(--red)' }}>-{fmt(totalExp)} грн</div>
        {goodsCost > 0 && <div style={{ fontSize:10, color:'var(--text3)' }}>с/в {fmt(goodsCost)}{txExpense > 0 ? ` + дод. ${fmt(txExpense)}` : ''}</div>}
      </div>
      <div style={{ background:marginBg, borderRadius:12, padding:'12px 16px', flex:1, minWidth:100 }}>
        <div style={{ fontSize:11, color:marginColor }}>Маржа</div>
        <div style={{ fontSize:18, fontWeight:500, color:marginColor }}>
          {margin >= 0 ? '+' : '−'}{fmt(Math.abs(margin))} грн
          {txIncome > 0 && <span style={{ fontSize:12, fontWeight:400 }}> ({((margin / txIncome) * 100).toFixed(0)}%)</span>}
        </div>
      </div>
    </div>
  )
}
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
  address:'', legal_address:'', actual_address:'', delivery_address:'', city:'', region:'', postal_code:'',
  iban:'', bank_name:'', mfo:'', currency:'UAH',
  default_article:'', default_direction:'', notes:'', status:'active',
}

// ── Inline add forms ──
function ContactAddForm({ contractorId, onAdded }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', position: '', phone: '', email: '', is_signer: false })
  if (!open) return <button onClick={() => setOpen(true)} style={{ marginTop:8, background:'none', border:'1px dashed var(--border)', borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:12, color:'var(--blue)', fontFamily:'inherit', width:'100%' }}>
    <i className="ti ti-plus" style={{ fontSize:12 }} /> Додати контактну особу
  </button>
  return (
    <div style={{ marginTop:8, border:'1px solid var(--border)', borderRadius:8, padding:10, background:'var(--bg)' }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
        <input className="form-input" style={{ height:32, fontSize:12 }} placeholder="ПІБ *" value={f.name} onChange={e => setF(p => ({...p, name:e.target.value}))} />
        <input className="form-input" style={{ height:32, fontSize:12 }} placeholder="Посада" value={f.position} onChange={e => setF(p => ({...p, position:e.target.value}))} />
        <input className="form-input" style={{ height:32, fontSize:12 }} placeholder="Телефон" value={f.phone} onChange={e => setF(p => ({...p, phone:e.target.value}))} />
        <input className="form-input" style={{ height:32, fontSize:12 }} placeholder="Email" value={f.email} onChange={e => setF(p => ({...p, email:e.target.value}))} />
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6 }}>
        <label style={{ fontSize:12, display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
          <input type="checkbox" checked={f.is_signer} onChange={e => setF(p => ({...p, is_signer:e.target.checked}))} /> Підписант документів
        </label>
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          <button className="btn btn-sm btn-primary" disabled={!f.name.trim()} onClick={async () => {
            await supabase.from('contractor_contacts').insert({ contractor_id: contractorId, ...f })
            setF({ name:'', position:'', phone:'', email:'', is_signer:false }); setOpen(false); onAdded()
          }}>Додати</button>
          <button className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>Скасувати</button>
        </div>
      </div>
    </div>
  )
}

function ContractAddForm({ contractorId, onAdded }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ number: '', date: '', subject: '' })
  if (!open) return <button onClick={() => setOpen(true)} style={{ marginTop:8, background:'none', border:'1px dashed var(--border)', borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:12, color:'var(--blue)', fontFamily:'inherit', width:'100%' }}>
    <i className="ti ti-plus" style={{ fontSize:12 }} /> Додати договір
  </button>
  return (
    <div style={{ marginTop:8, border:'1px solid var(--border)', borderRadius:8, padding:10, background:'var(--bg)' }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 2fr', gap:6 }}>
        <input className="form-input" style={{ height:32, fontSize:12 }} placeholder="Номер *" value={f.number} onChange={e => setF(p => ({...p, number:e.target.value}))} />
        <input type="date" className="form-input" style={{ height:32, fontSize:12 }} value={f.date} onChange={e => setF(p => ({...p, date:e.target.value}))} />
        <input className="form-input" style={{ height:32, fontSize:12 }} placeholder="Предмет договору" value={f.subject} onChange={e => setF(p => ({...p, subject:e.target.value}))} />
      </div>
      <div style={{ display:'flex', gap:6, marginTop:6, justifyContent:'flex-end' }}>
        <button className="btn btn-sm btn-primary" disabled={!f.number.trim()} onClick={async () => {
          await supabase.from('contractor_contracts').insert({ contractor_id: contractorId, ...f, date: f.date || null })
          setF({ number:'', date:'', subject:'' }); setOpen(false); onAdded()
        }}>Додати</button>
        <button className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>Скасувати</button>
      </div>
    </div>
  )
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

export default function Contractors({ user, onNavigate }) {
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
  const [vkursiLoading, setVkursiLoading] = useState(false)
  const [vkursiError, setVkursiError] = useState(null)
  const [vkursiInfo, setVkursiInfo] = useState(null)
  const [showDocGen, setShowDocGen] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [contractorDocs, setContractorDocs] = useState([])
  const [contacts, setContacts] = useState([])
  const [contracts, setContracts] = useState([])
  const [aiPasteMode, setAiPasteMode] = useState(false)
  const [aiPasteText, setAiPasteText] = useState('')
  const [aiParsing, setAiParsing] = useState(false)
  const [aiPasteError, setAiPasteError] = useState(null)
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
      return { ...c, total_income:s.income||0, total_expense:s.expense||0, total_otherIn:s.otherIn||0, total_otherOut:s.otherOut||0, operations_count:s.count||0, last_operation_date:s.lastDate||null }
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
    if (editId) {
      await supabase.from('contractors').update(payload).eq('id', editId)
    } else {
      const { data: newC } = await supabase.from('contractors').insert(payload).select('id').single()
      // Якщо є контактна особа — додати в contractor_contacts як підписанта
      if (newC?.id && form.contact_person) {
        await supabase.from('contractor_contacts').insert({
          contractor_id: newC.id,
          name: form.contact_person,
          position: form.contact_position || null,
          phone: form.phone || null,
          email: form.email || null,
          is_signer: true,
        })
      }
    }
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
    loadContractorDocs(c.id).then(docs => setContractorDocs(docs))
    supabase.from('contractor_contacts').select('*').eq('contractor_id', c.id).order('is_signer', { ascending: false }).order('name').then(({ data }) => setContacts(data || []))
    supabase.from('contractor_contracts').select('*').eq('contractor_id', c.id).order('date', { ascending: false }).then(({ data }) => setContracts(data || []))

    // Fetch transactions by ЄДРПОУ (primary) or by name (fallback)
    let txQuery = supabase.from('bank_transactions')
      .select('id,date,amount,direction,article,counterparty,description,project_id,edrpou,doc_type,doc_number,documents(id,file_name,file_path,file_type,file_size,doc_role),transaction_items(id,name,quantity,unit,unit_price,amount,product_id)')
      .eq('is_ignored', false)
      .order('date', { ascending: false }).limit(500)

    if (c.edrpou?.trim()) {
      txQuery = txQuery.eq('edrpou', c.edrpou.trim())
    } else {
      txQuery = txQuery.ilike('counterparty', c.name)
    }

    const [{ data:txs }, { data:plans }] = await Promise.all([
      txQuery,
      supabase.from('plans')
        .select('id,year_month,planned_date,amount,direction,article,description')
        .ilike('article', `%${c.default_article || '___NOMATCH___'}%`)
        .order('planned_date'),
    ])

    const allTxs = txs || []

    // Підвантажити cost_price з stock_movements для маржі
    const allItemIds = allTxs.flatMap(tx => (tx.transaction_items || []).map(it => it.id)).filter(Boolean)
    if (allItemIds.length > 0) {
      try {
        const { data: movs } = await supabase.from('stock_movements')
          .select('transaction_item_id, cost_price')
          .in('transaction_item_id', allItemIds)
        const movMap = {}
        ;(movs || []).forEach(m => { if (m.transaction_item_id) movMap[m.transaction_item_id] = m })
        allTxs.forEach(tx => {
          ;(tx.transaction_items || []).forEach(it => {
            const mov = movMap[it.id]
            if (mov && mov.cost_price) it._costPrice = mov.cost_price
          })
        })
      } catch (e) { console.warn('cost_price load:', e.message) }
    }

    setDetailTxs(allTxs)
    setDetailPlans(plans || [])

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
  }

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'var(--text2)' }}>Завантаження...</div>

  // ═══════════════════════════════════════════
  // DETAIL VIEW — full screen
  // ═══════════════════════════════════════════
  if (view === 'detail' && detail) {
    const txIncome = detailTxs.filter(t=>t.direction==='Доходи').reduce((s,t)=>s+Math.abs(t.amount||0),0)
    const txExpense = detailTxs.filter(t=>t.direction==='Витрати').reduce((s,t)=>s+Math.abs(t.amount||0),0)
    const balance = txIncome - txExpense

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
            {detail.edrpou?.trim().length >= 6 && (
              <button className="btn btn-secondary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}
                disabled={vkursiLoading}
                onClick={async () => {
                  if (!isVkursiConfigured()) { setVkursiError('Спочатку налаштуйте Vkursi в Налаштування → Інтеграції'); return }
                  setVkursiLoading(true); setVkursiError(null); setVkursiInfo(null)
                  try {
                    const info = await fetchByEdrpou(detail.edrpou)
                    const noOverwrite = ['name','short_name','phone','phone2','email','website','legal_address','contact_person','contact_position']
                    const allFields = ['name','short_name','ipn','legal_form','state','registration_date',
                      'phone','phone2','email','website','legal_address','city','region','postal_code',
                      'contact_person','contact_position','director','director_position','founders',
                      'primary_kved','capital','court_cases_count','enforcement_count',
                      'express_score','vkursi_data','vkursi_updated_at']
                    const updates = {}
                    for (const f of allFields) {
                      if (info[f] != null && info[f] !== '') {
                        if (noOverwrite.includes(f) && detail[f]) continue
                        updates[f] = info[f]
                      }
                    }
                    if (info.is_vat_payer) updates.is_vat_payer = true
                    if (Object.keys(updates).length > 0) {
                      await supabase.from('contractors').update(updates).eq('id', detail.id)
                      setDetail(d => ({ ...d, ...updates }))
                      setList(l => l.map(c => c.id === detail.id ? { ...c, ...updates } : c))
                    }
                    setVkursiInfo(info)
                  } catch (e) { setVkursiError(e.message) }
                  setVkursiLoading(false)
                }}>
                <i className="ti ti-download" style={{ fontSize:14 }} /> {vkursiLoading ? '...' : 'Вкурсі'}
              </button>
            )}
            {vkursiError && <div style={{ fontSize:12, color:'var(--red)', padding:'6px 12px', background:'var(--red-bg)', borderRadius:8 }}>{vkursiError}</div>}
            {vkursiInfo && !vkursiError && <div style={{ fontSize:12, color:'var(--green)', padding:'6px 12px', background:'var(--green-bg)', borderRadius:8 }}>Дані оновлено з Vkursi</div>}
            <button onClick={() => { setEditingDoc(null); setShowDocGen(true) }} className="btn btn-primary" style={{ width:'auto', minHeight:40, padding:'8px 14px' }}>
              <i className="ti ti-file-plus" style={{ fontSize:14 }} /> Створити документ
            </button>
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
          <div className="kpi"><div className="kpi-label">Доходи</div><div className="kpi-value" style={{ color:'var(--green)' }}>+{fmt(txIncome)}</div><div className="kpi-sub">грн</div></div>
          <div className="kpi"><div className="kpi-label">Витрати</div><div className="kpi-value" style={{ color:'var(--red)' }}>-{fmt(txExpense)}</div><div className="kpi-sub">грн</div></div>
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
            { id:'docs', label:`Документи (${contractorDocs.length})`, icon:'ti-file-text' },
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
                <Field label="ЄДРПОУ" value={detail.edrpou} />
                <Field label="ІПН" value={detail.ipn} />
                <Field label="Форма" value={detail.legal_form} />
                <Field label="Стан" value={detail.state} />
                <Field label="Дата реєстрації" value={detail.registration_date} />
                <Field label="Основний КВЕД" value={detail.primary_kved} />
                <Field label="Система оподаткування" value={detail.tax_system} />
                <Field label="Платник ПДВ" value={detail.is_vat_payer ? 'Так' : 'Ні'} />
                <Field label="№ свідоцтва ПДВ" value={detail.vat_certificate} />
                <Field label="Статутний капітал" value={detail.capital ? `${detail.capital} грн` : null} />
                <Field label="Тип" value={typeLabel(detail.type)} />
              </div>
            </Section>

            <Section title="Контактні особи" icon="ti-users">
              {contacts.length > 0 ? (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {contacts.map(c => (
                    <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:500, fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
                          {c.name}
                          {c.is_signer && <span style={{ fontSize:10, background:'var(--green-bg)', color:'var(--green)', padding:'1px 6px', borderRadius:4 }}>Підписант</span>}
                        </div>
                        <div style={{ fontSize:12, color:'var(--text2)' }}>
                          {[c.position, c.phone, c.email].filter(Boolean).join('  ·  ')}
                        </div>
                      </div>
                      <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:14 }}
                        onClick={async () => {
                          await supabase.from('contractor_contacts').update({ is_signer: !c.is_signer }).eq('id', c.id)
                          supabase.from('contractor_contacts').select('*').eq('contractor_id', detail.id).order('is_signer', { ascending: false }).order('name').then(({ data }) => setContacts(data || []))
                        }} title={c.is_signer ? 'Зняти підписанта' : 'Зробити підписантом'}>
                        <i className={`ti ${c.is_signer ? 'ti-signature' : 'ti-signature-off'}`} />
                      </button>
                      <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--red)', fontSize:14 }}
                        onClick={async () => {
                          if (!confirm(`Видалити ${c.name}?`)) return
                          await supabase.from('contractor_contacts').delete().eq('id', c.id)
                          supabase.from('contractor_contacts').select('*').eq('contractor_id', detail.id).order('is_signer', { ascending: false }).order('name').then(({ data }) => setContacts(data || []))
                        }}>
                        <i className="ti ti-trash" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize:12, color:'var(--text3)', padding:'8px 0' }}>Немає контактних осіб</div>
              )}
              <ContactAddForm contractorId={detail.id} onAdded={() => {
                supabase.from('contractor_contacts').select('*').eq('contractor_id', detail.id).order('is_signer', { ascending: false }).order('name').then(({ data }) => setContacts(data || []))
              }} />
            </Section>

            {(detail.court_cases_count > 0 || detail.enforcement_count > 0) && (
              <Section title="Ризики" icon="ti-alert-triangle">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="Судових справ" value={detail.court_cases_count} />
                  <Field label="Виконавчих проваджень" value={detail.enforcement_count} />
                </div>
              </Section>
            )}

            <Section title="Договори" icon="ti-file-text">
              {contracts.length > 0 ? (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {contracts.map(ct => (
                    <div key={ct.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:500, fontSize:13 }}>
                          №{ct.number}{ct.date ? ` від ${ct.date}` : ''}
                          <span style={{ fontSize:10, marginLeft:8, padding:'1px 6px', borderRadius:4,
                            background: ct.status === 'active' ? 'var(--green-bg)' : ct.status === 'completed' ? 'var(--surface2)' : 'var(--red-bg)',
                            color: ct.status === 'active' ? 'var(--green)' : ct.status === 'completed' ? 'var(--text3)' : 'var(--red)',
                          }}>{ct.status === 'active' ? 'Діючий' : ct.status === 'completed' ? 'Завершений' : 'Скасований'}</span>
                        </div>
                        {ct.subject && <div style={{ fontSize:12, color:'var(--text2)' }}>{ct.subject}</div>}
                      </div>
                      <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--red)', fontSize:14 }}
                        onClick={async () => {
                          if (!confirm(`Видалити договір №${ct.number}?`)) return
                          await supabase.from('contractor_contracts').delete().eq('id', ct.id)
                          supabase.from('contractor_contracts').select('*').eq('contractor_id', detail.id).order('date', { ascending: false }).then(({ data }) => setContracts(data || []))
                        }}>
                        <i className="ti ti-trash" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize:12, color:'var(--text3)', padding:'8px 0' }}>Немає договорів</div>
              )}
              <ContractAddForm contractorId={detail.id} onAdded={() => {
                supabase.from('contractor_contracts').select('*').eq('contractor_id', detail.id).order('date', { ascending: false }).then(({ data }) => setContracts(data || []))
              }} />
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
                <Field label="Адреса доставки" value={detail.delivery_address} />
                <Field label="Місто" value={detail.city} />
                <Field label="Область" value={detail.region} />
                <Field label="Індекс" value={detail.postal_code} />
              </div>
            </Section>

            <Section title="Налаштування" icon="ti-settings">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Field label="Стаття за замовч." value={detail.default_article} />
                <Field label="Напрям за замовч." value={detail.default_direction} />
                {detail.vkursi_updated_at && (
                  <Field label="Vkursi оновлено" value={new Date(detail.vkursi_updated_at).toLocaleDateString('uk-UA')} />
                )}
              </div>
            </Section>
          </div>
        )}

        {/* ── Tab: Документи ── */}
        {detailTab === 'docs' && (
          <div>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тип</th>
                    <th>Номер</th>
                    <th style={{ textAlign: 'right' }}>Сума</th>
                    <th>Статус</th>
                    <th>Транзакція</th>
                    <th style={{ width: 130 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {contractorDocs.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign:'center', padding:20, color:'var(--text3)' }}>Немає документів</td></tr>
                  )}
                  {contractorDocs.map(doc => {
                    const st = STATUS_COLORS[doc.status] || STATUS_COLORS.draft
                    return (
                      <tr key={doc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{doc.doc_date}</td>
                        <td style={{ fontSize: 13 }}>{getDocLabel(doc.doc_type)}</td>
                        <td style={{ fontSize: 13, fontWeight: 500 }}>{doc.doc_number}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtDoc(doc.total)} грн</td>
                        <td>
                          <select style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px', background: st.bg, color: st.color, fontFamily: 'inherit', cursor: 'pointer' }}
                            value={doc.status} onChange={async e => {
                              await updateDocStatus(doc.id, e.target.value)
                              loadContractorDocs(detail.id).then(docs => setContractorDocs(docs))
                            }}>
                            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {doc.bank_transaction_id ? (
                            <span style={{ color: 'var(--green)', fontSize: 11 }}><i className="ti ti-link" style={{ fontSize: 12 }} /> Привʼязано</span>
                          ) : (
                            <button className="btn btn-sm btn-secondary" style={{ padding: '1px 6px', fontSize: 10 }}
                              onClick={async () => {
                                const txId = prompt('ID банківської транзакції:')
                                if (!txId) return
                                await updateDocStatus(doc.id, doc.status, txId)
                                loadContractorDocs(detail.id).then(docs => setContractorDocs(docs))
                              }}>Привʼязати</button>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {/* Списати зі складу — для видаткових */}
                            {getDocType(doc.doc_type)?.stockEffect === 'out' && doc.status !== 'cancelled' && (
                              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--amber)', fontSize: 15, padding: '0 4px' }}
                                title="Списати зі складу"
                                onClick={async () => {
                                  const docItems = typeof doc.items === 'string' ? JSON.parse(doc.items) : doc.items
                                  const names = docItems.map(i => `${i.name} × ${i.quantity}`).join('\n')
                                  if (!confirm(`Списати зі складу:\n\n${names}\n\nПідтвердити?`)) return
                                  await createStockFromDoc(doc.id, doc.doc_type, docItems, doc.doc_date, user.id)
                                  alert('Товари списано зі складу')
                                }}>
                                <i className="ti ti-package-export" style={{ fontSize: 14 }} />
                              </button>
                            )}
                            {doc.doc_type === 'invoice' && (
                              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: 15, padding: '0 4px' }}
                                title="Створити акт/накладну на підставі"
                                onClick={() => {
                                  const docItems = typeof doc.items === 'string' ? JSON.parse(doc.items) : doc.items
                                  setEditingDoc({ ...doc, id: null, doc_type: null, doc_number: '', items: docItems, _fromInvoice: doc.doc_number })
                                  setShowDocGen(true)
                                }}>
                                <i className="ti ti-copy" style={{ fontSize: 14 }} />
                              </button>
                            )}
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 15, padding: '0 4px' }}
                              title="Редагувати" onClick={() => { setEditingDoc(doc); setShowDocGen(true) }}>
                              <i className="ti ti-pencil" style={{ fontSize: 14 }} />
                            </button>
                            <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                              onClick={() => {
                                const items = typeof doc.items === 'string' ? JSON.parse(doc.items) : doc.items
                                generatePdf(doc.doc_type, detail, items, { docNumber: doc.doc_number, docDate: doc.doc_date, notes: doc.notes })
                              }}>PDF</button>
                            <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                              onClick={() => {
                                const items = typeof doc.items === 'string' ? JSON.parse(doc.items) : doc.items
                                generateXlsx(doc.doc_type, detail, items, { docNumber: doc.doc_number, docDate: doc.doc_date, notes: doc.notes })
                              }}>XLS</button>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 15, padding: '0 4px' }}
                              title="Видалити" onClick={async () => {
                                if (!confirm(`Видалити ${getDocLabel(doc.doc_type)} №${doc.doc_number}?`)) return
                                await supabase.from('generated_docs').delete().eq('id', doc.id)
                                loadContractorDocs(detail.id).then(docs => setContractorDocs(docs))
                              }}>
                              <i className="ti ti-trash" style={{ fontSize: 14 }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab: Баланс ── */}
        {detailTab === 'balance' && (() => {
          const totalIncome = detailTxs.filter(t=>t.direction==='Доходи').reduce((s,t)=>s+Math.abs(t.amount||0),0)
          const totalExpense = detailTxs.filter(t=>t.direction==='Витрати').reduce((s,t)=>s+Math.abs(t.amount||0),0)
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
                <TxStats txs={detailTxs} txIncome={txIncome} txExpense={txExpense} />
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
                                    <ItemsTable
                                      items={tx.transaction_items}
                                      isSale={tx.direction === 'Доходи'}
                                      onProductClick={pid => { sessionStorage.setItem('aim-open-product', pid); onNavigate && onNavigate('inventory') }}
                                    />
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

        {/* DocGen modal */}
        {showDocGen && (
          <DocGenModal
            contractor={detail}
            userId={user.id}
            editDoc={editingDoc}
            onClose={() => { setShowDocGen(false); setEditingDoc(null) }}
            onSaved={() => loadContractorDocs(detail.id).then(docs => setContractorDocs(docs))}
          />
        )}
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
          {/* AI розпізнавання */}
          {!editId && (
            <div style={{ marginBottom:14 }}>
              {!aiPasteMode ? (
                <button onClick={() => setAiPasteMode(true)} style={{ width:'100%', padding:'10px', background:'var(--bg)', border:'1px dashed var(--border)', borderRadius:10, cursor:'pointer', fontSize:13, color:'var(--blue)', fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                  <i className="ti ti-sparkles" style={{ fontSize:16 }} /> Вставити текст з реквізитами — AI заповнить поля
                </button>
              ) : (
                <div style={{ border:'1px solid var(--border)', borderRadius:10, padding:12, background:'var(--bg)' }}>
                  <div style={{ fontSize:12, fontWeight:500, marginBottom:6, color:'var(--text2)' }}>Вставте будь-який текст з реквізитами компанії</div>
                  <textarea className="form-input" rows={4} style={{ fontSize:12, marginBottom:8 }}
                    value={aiPasteText} onChange={e => setAiPasteText(e.target.value)}
                    placeholder="Наприклад: ТОВ «Компанія», ЄДРПОУ 12345678, м. Київ, вул. Хрещатик 1, IBAN UA123..." />
                  {aiPasteError && <div style={{ fontSize:12, color:'var(--red)', marginBottom:6 }}>{aiPasteError}</div>}
                  <div style={{ display:'flex', gap:6 }}>
                    <button className="btn btn-primary btn-sm" disabled={aiParsing || !aiPasteText.trim()} onClick={async () => {
                      setAiParsing(true); setAiPasteError(null)
                      try {
                        const { parseCompanyFromText } = await import('../lib/ai')
                        const parsed = await parseCompanyFromText(aiPasteText)
                        setForm(f => {
                          const updated = { ...f }
                          Object.entries(parsed).forEach(([k, v]) => {
                            if (v && v !== null && v !== 'null' && v !== '') {
                              if (k in f) updated[k] = typeof v === 'boolean' ? v : String(v)
                              // Додатковий маппінг
                              if (k === 'legal_address' && !updated.legal_address) updated.legal_address = String(v)
                              if (k === 'address' && !updated.address) updated.address = String(v)
                              if (k === 'ipn' && String(v).length === 12) {
                                updated.is_vat_payer = true
                                if (!updated.vat_certificate) updated.vat_certificate = String(v)
                              }
                            }
                          })
                          return updated
                        })
                        setAiPasteMode(false); setAiPasteText('')
                      } catch (e) { setAiPasteError(e.message) }
                      setAiParsing(false)
                    }}>{aiParsing ? 'Розпізнаю...' : 'Розпізнати'}</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setAiPasteMode(false); setAiPasteText('') }}>Скасувати</button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="form-grid">
            <div className="form-group full"><label>Повна назва *</label><input className="form-input" value={form.name} onChange={setF('name')} placeholder="ТОВ Компанія" /></div>
            <div className="form-group"><label>Коротка назва</label><input className="form-input" value={form.short_name} onChange={setF('short_name')} /></div>
            <div className="form-group">
              <label>ЄДРПОУ / ІПН</label>
              <div style={{ display:'flex', gap:6 }}>
                <input className="form-input" value={form.edrpou} onChange={setF('edrpou')} style={{ flex:1 }} />
                {form.edrpou?.trim().length >= 6 && (
                  <button className="btn btn-secondary" style={{ flexShrink:0, fontSize:12, padding:'0 12px' }}
                    disabled={vkursiLoading}
                    onClick={async () => {
                      setVkursiLoading(true); setVkursiError(null)
                      try {
                        const info = await fetchByEdrpou(form.edrpou)
                        setForm(f => ({
                          ...f,
                          name: info.name || f.name,
                          short_name: info.short_name || f.short_name,
                          legal_form: info.legal_form || f.legal_form,
                          is_vat_payer: info.is_vat_payer ?? f.is_vat_payer,
                          phone: info.phone || f.phone,
                          phone2: info.phone2 || f.phone2,
                          email: info.email || f.email,
                          website: info.website || f.website,
                          legal_address: info.legal_address || f.legal_address,
                          address: info.address || f.address,
                          city: info.city || f.city,
                          region: info.region || f.region,
                          postal_code: info.postal_code || f.postal_code,
                          contact_person: info.contact_person || f.contact_person,
                          contact_position: info.contact_position || f.contact_position,
                        }))
                        setVkursiInfo(info)
                      } catch (e) {
                        setVkursiError(e.message)
                      }
                      setVkursiLoading(false)
                    }}>
                    {vkursiLoading ? '...' : <><i className="ti ti-download" style={{ fontSize:13 }} /> Вкурсі</>}
                  </button>
                )}
              </div>
              {vkursiError && <div style={{ fontSize:11, color:'var(--red)', marginTop:4 }}>{vkursiError}</div>}
              {vkursiInfo && <div style={{ fontSize:11, color:'var(--green)', marginTop:4 }}>
                {vkursiInfo._primaryActivity && <div>КВЕД: {vkursiInfo._primaryActivity}</div>}
                {vkursiInfo._state && <div>Стан: {vkursiInfo._state}</div>}
                {vkursiInfo._capital && <div>Статутний капітал: {vkursiInfo._capital} грн</div>}
              </div>}
            </div>
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
            <div className="form-group full"><label>Адреса доставки</label><input className="form-input" value={form.delivery_address} onChange={setF('delivery_address')} placeholder="Адреса для відвантаження товару" /></div>
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

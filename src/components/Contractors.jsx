import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'

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
  const [detailProjects, setDetailProjects] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadAll(); fetchArticles().then(setArticles) }, [])

  const loadAll = async () => {
    setLoading(true)
    const { data } = await supabase.from('contractors').select('*').order('name')
    const contractors = data || []
    const { data: txStats } = await supabase.from('transactions').select('contractor, amount, direction, date')
    const stats = {}
    ;(txStats || []).forEach(tx => {
      const name = tx.contractor?.trim()
      if (!name) return
      if (!stats[name]) stats[name] = { income:0, expense:0, count:0, lastDate:null }
      stats[name].count++
      if (tx.direction === 'Доходи') stats[name].income += Math.abs(tx.amount || 0)
      else stats[name].expense += Math.abs(tx.amount || 0)
      if (!stats[name].lastDate || tx.date > stats[name].lastDate) stats[name].lastDate = tx.date
    })
    setList(contractors.map(c => {
      const s = stats[c.name] || stats[c.short_name] || {}
      return { ...c, total_income:s.income||c.total_income||0, total_expense:s.expense||c.total_expense||0, operations_count:s.count||c.operations_count||0, last_operation_date:s.lastDate||c.last_operation_date }
    }))
    setLoading(false)
  }

  const filtered = list.filter(c => {
    if (c.status === 'archived' && filterType !== 'archived') return false
    if (filterType && filterType !== 'archived' && c.type !== filterType) return false
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

  const openDetail = async (c) => {
    setDetail(c); setDetailTab('info'); setView('detail')
    const { data:txs } = await supabase.from('transactions')
      .select('id,date,amount,direction,article,projects(name)')
      .ilike('contractor', c.name).order('date',{ascending:false}).limit(100)
    setDetailTxs(txs||[])
    setDetailProjects([...new Set((txs||[]).map(t=>t.projects?.name).filter(Boolean))])
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
        <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(5,1fr)', marginBottom:20 }}>
          <div className="kpi"><div className="kpi-label">Оборот</div><div className="kpi-value">{fmt((detail.total_income||0)+(detail.total_expense||0))}</div><div className="kpi-sub">грн</div></div>
          <div className="kpi"><div className="kpi-label">Дохід</div><div className="kpi-value" style={{ color:'var(--green)' }}>+{fmt(detail.total_income)}</div><div className="kpi-sub">грн</div></div>
          <div className="kpi"><div className="kpi-label">Витрати</div><div className="kpi-value" style={{ color:'var(--red)' }}>-{fmt(detail.total_expense)}</div><div className="kpi-sub">грн</div></div>
          <div className="kpi"><div className="kpi-label">Баланс</div><div className="kpi-value" style={{ color:balance>=0?'var(--green)':'var(--red)' }}>{balance>=0?'+':'-'}{fmt(balance)}</div><div className="kpi-sub">грн</div></div>
          <div className="kpi"><div className="kpi-label">Операцій</div><div className="kpi-value">{detail.operations_count||0}</div><div className="kpi-sub">остання: {detail.last_operation_date||'—'}</div></div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:20, gap:0 }}>
          {[
            { id:'info', label:'Реквізити', icon:'ti-file-info' },
            { id:'txs', label:`Операції (${detailTxs.length})`, icon:'ti-list-details' },
            { id:'projects', label:`Проєкти (${detailProjects.length})`, icon:'ti-briefcase' },
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

        {/* ── Tab: Операції ── */}
        {detailTab === 'txs' && (
          <div>
            {detailTxs.length === 0 ? (
              <div className="card"><div className="empty"><p>Немає операцій з цим контрагентом</p></div></div>
            ) : (
              <>
                <div style={{ display:'flex', gap:16, marginBottom:16 }}>
                  <div style={{ background:'var(--green-bg)', borderRadius:12, padding:'12px 20px' }}>
                    <div style={{ fontSize:12, color:'var(--green)' }}>Дохід</div>
                    <div style={{ fontSize:20, fontWeight:500, color:'var(--green)' }}>+{fmt(txIncome)} грн</div>
                  </div>
                  <div style={{ background:'var(--red-bg)', borderRadius:12, padding:'12px 20px' }}>
                    <div style={{ fontSize:12, color:'var(--red)' }}>Витрати</div>
                    <div style={{ fontSize:20, fontWeight:500, color:'var(--red)' }}>-{fmt(txExpense)} грн</div>
                  </div>
                </div>
                <div className="tbl-wrap">
                  <table>
                    <thead><tr><th>Дата</th><th style={{ textAlign:'right' }}>Сума</th><th>Напрям</th><th>Стаття</th><th>Проєкт</th></tr></thead>
                    <tbody>
                      {detailTxs.map(tx => (
                        <tr key={tx.id}>
                          <td style={{ fontSize:13, color:'var(--text2)', whiteSpace:'nowrap' }}>{tx.date}</td>
                          <td style={{ textAlign:'right', fontWeight:500, color:tx.amount>=0?'var(--green)':'var(--red)', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
                            {tx.amount>=0?'+':''}{fmt(tx.amount)} грн
                          </td>
                          <td style={{ fontSize:13, color:'var(--text2)' }}>{tx.direction}</td>
                          <td style={{ fontSize:13, color:'var(--text2)' }}>{tx.article||'—'}</td>
                          <td style={{ fontSize:13, color:'var(--text2)' }}>{tx.projects?.name||'—'}</td>
                        </tr>
                      ))}
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
        <button className="btn btn-primary" onClick={openAdd} style={{ width:'auto' }}>
          <i className="ti ti-plus" style={{ fontSize:15 }} /> Додати
        </button>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(4,1fr)', marginBottom:20 }}>
        <div className="kpi"><div className="kpi-label">Всього</div><div className="kpi-value">{kpi.total}</div></div>
        <div className="kpi"><div className="kpi-label">Клієнти</div><div className="kpi-value" style={{ color:'var(--green)' }}>{kpi.clients}</div></div>
        <div className="kpi"><div className="kpi-label">Постачальники</div><div className="kpi-value" style={{ color:'var(--red)' }}>{kpi.suppliers}</div></div>
        <div className="kpi"><div className="kpi-label">Найбільший оборот</div><div className="kpi-value" style={{ fontSize:16 }}>{kpi.topTurnover.name}</div><div className="kpi-sub">{fmt(kpi.topTurnover.val)} грн</div></div>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ flex:1, position:'relative', minWidth:200 }}>
          <i className="ti ti-search" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:16 }} />
          <input className="form-input" style={{ width:'100%', paddingLeft:38 }} placeholder="Пошук..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['','client','supplier','other'].map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`btn btn-sm ${filterType===t?'btn-primary':'btn-secondary'}`} style={{ width:'auto' }}>{t?typeLabel(t):'Всі'}</button>
        ))}
      </div>

      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Назва</th><th>Тип</th><th style={{ textAlign:'right' }}>Дохід</th><th style={{ textAlign:'right' }}>Витрати</th><th style={{ textAlign:'right' }}>Операцій</th><th>Остання</th><th style={{ width:80 }}></th></tr></thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:32, color:'var(--text3)' }}>{search?'Не знайдено':'Немає контрагентів'}</td></tr>}
            {filtered.map(c => (
              <tr key={c.id} style={{ cursor:'pointer' }} onClick={() => openDetail(c)}>
                <td><div style={{ fontWeight:500, fontSize:14 }}>{c.short_name||c.name}</div>{c.edrpou && <div style={{ fontSize:12, color:'var(--text3)' }}>ЄДРПОУ: {c.edrpou}</div>}</td>
                <td><span style={typeStyle(c.type)}>{typeLabel(c.type)}</span></td>
                <td style={{ textAlign:'right', color:'var(--green)', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{c.total_income>0?'+'+fmt(c.total_income):'—'}</td>
                <td style={{ textAlign:'right', color:'var(--red)', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{c.total_expense>0?'-'+fmt(c.total_expense):'—'}</td>
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

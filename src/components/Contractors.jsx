import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))
const TYPES = [
  { id: 'client', label: 'Клієнт', bg: '#EFF5EF', color: '#4A7C59' },
  { id: 'supplier', label: 'Постачальник', bg: '#F5EDED', color: '#9B3A3A' },
  { id: 'other', label: 'Інше', bg: '#F0F2F5', color: '#6B6B6B' },
]
const typeStyle = (t) => {
  const s = TYPES.find(x => x.id === t) || TYPES[2]
  return { background: s.bg, color: s.color, fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap' }
}
const typeLabel = (t) => (TYPES.find(x => x.id === t) || TYPES[2]).label

const EMPTY = {
  name: '', short_name: '', edrpou: '', type: 'other',
  email: '', phone: '', address: '',
  iban: '', bank_name: '', mfo: '',
  default_article: '', default_direction: '', notes: '',
}

export default function Contractors({ user }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [articles, setArticles] = useState([])

  // Form
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  // Detail
  const [detail, setDetail] = useState(null)
  const [detailTab, setDetailTab] = useState('info')
  const [detailTxs, setDetailTxs] = useState([])
  const [detailProjects, setDetailProjects] = useState([])

  useEffect(() => {
    loadAll()
    fetchArticles().then(setArticles)
  }, [])

  const loadAll = async () => {
    setLoading(true)
    const { data } = await supabase.from('contractors').select('*').order('name')
    const contractors = data || []

    // Sync stats from transactions
    const { data: txStats } = await supabase.from('transactions')
      .select('contractor, amount, direction, date')

    const stats = {}
    ;(txStats || []).forEach(tx => {
      const name = tx.contractor?.trim()
      if (!name) return
      if (!stats[name]) stats[name] = { income: 0, expense: 0, count: 0, lastDate: null }
      stats[name].count++
      if (tx.direction === 'Доходи') stats[name].income += Math.abs(tx.amount || 0)
      else stats[name].expense += Math.abs(tx.amount || 0)
      if (!stats[name].lastDate || tx.date > stats[name].lastDate) stats[name].lastDate = tx.date
    })

    // Update contractors with stats
    const updated = contractors.map(c => {
      const s = stats[c.name] || stats[c.short_name] || {}
      return {
        ...c,
        total_income: s.income || c.total_income || 0,
        total_expense: s.expense || c.total_expense || 0,
        operations_count: s.count || c.operations_count || 0,
        last_operation_date: s.lastDate || c.last_operation_date,
      }
    })

    setList(updated)
    setLoading(false)
  }

  const filtered = list.filter(c => {
    if (filterType && c.type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(c.name || '').toLowerCase().includes(q) &&
          !(c.short_name || '').toLowerCase().includes(q) &&
          !(c.edrpou || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const kpi = {
    total: list.length,
    clients: list.filter(c => c.type === 'client').length,
    suppliers: list.filter(c => c.type === 'supplier').length,
    topTurnover: list.reduce((max, c) => {
      const t = (c.total_income || 0) + (c.total_expense || 0)
      return t > max.val ? { name: c.short_name || c.name, val: t } : max
    }, { name: '—', val: 0 }),
  }

  // CRUD
  const openAdd = () => { setForm(EMPTY); setEditId(null); setShowForm(true) }
  const openEdit = (c) => {
    setForm({
      name: c.name || '', short_name: c.short_name || '', edrpou: c.edrpou || '',
      type: c.type || 'other', email: c.email || '', phone: c.phone || '',
      address: c.address || '', iban: c.iban || '', bank_name: c.bank_name || '',
      mfo: c.mfo || '', default_article: c.default_article || '',
      default_direction: c.default_direction || '', notes: c.notes || '',
    })
    setEditId(c.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name) return
    setSaving(true)
    const payload = { ...form, created_by: user?.id }
    if (editId) {
      await supabase.from('contractors').update(payload).eq('id', editId)
    } else {
      await supabase.from('contractors').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    loadAll()
  }

  const handleDelete = async (id) => {
    if (!confirm('Видалити контрагента?')) return
    await supabase.from('contractors').delete().eq('id', id)
    loadAll()
  }

  // Detail
  const openDetail = async (c) => {
    setDetail(c)
    setDetailTab('info')
    const { data: txs } = await supabase.from('transactions')
      .select('id, date, amount, direction, article, projects(name)')
      .ilike('contractor', c.name)
      .order('date', { ascending: false }).limit(50)
    setDetailTxs(txs || [])
    const projNames = [...new Set((txs || []).map(t => t.projects?.name).filter(Boolean))]
    setDetailProjects(projNames)
  }

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Завантаження...</div>

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Контрагенти</h1>
          <p>Реєстр клієнтів та постачальників</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd} style={{ width: 'auto' }}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> Додати контрагента
        </button>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
        <div className="kpi"><div className="kpi-label">Всього</div><div className="kpi-value">{kpi.total}</div></div>
        <div className="kpi"><div className="kpi-label">Клієнти</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{kpi.clients}</div></div>
        <div className="kpi"><div className="kpi-label">Постачальники</div><div className="kpi-value" style={{ color: 'var(--red)' }}>{kpi.suppliers}</div></div>
        <div className="kpi"><div className="kpi-label">Найбільший оборот</div><div className="kpi-value" style={{ fontSize: 16 }}>{kpi.topTurnover.name}</div><div className="kpi-sub">{fmt(kpi.topTurnover.val)} грн</div></div>
      </div>

      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 200 }}>
          <i className="ti ti-search" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 16 }} />
          <input className="form-input" style={{ width: '100%', paddingLeft: 38 }}
            placeholder="Пошук по назві або ЄДРПОУ..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['', 'client', 'supplier', 'other'].map(t => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`btn btn-sm ${filterType === t ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto' }}>
            {t ? typeLabel(t) : 'Всі'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Назва</th>
              <th>Тип</th>
              <th style={{ textAlign: 'right' }}>Дохід</th>
              <th style={{ textAlign: 'right' }}>Витрати</th>
              <th style={{ textAlign: 'right' }}>Операцій</th>
              <th>Остання оп.</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                {search ? 'Не знайдено' : 'Немає контрагентів'}
              </td></tr>
            )}
            {filtered.map(c => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(c)}>
                <td>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{c.short_name || c.name}</div>
                  {c.edrpou && <div style={{ fontSize: 12, color: 'var(--text3)' }}>ЄДРПОУ: {c.edrpou}</div>}
                </td>
                <td><span style={typeStyle(c.type)}>{typeLabel(c.type)}</span></td>
                <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {c.total_income > 0 ? '+' + fmt(c.total_income) : '—'}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--red)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {c.total_expense > 0 ? '-' + fmt(c.total_expense) : '—'}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{c.operations_count || 0}</td>
                <td style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{c.last_operation_date || '—'}</td>
                <td onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => openEdit(c)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)' }}>
                      <i className="ti ti-pencil" style={{ fontSize: 14 }} />
                    </button>
                    <button onClick={() => handleDelete(c.id)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)' }}>
                      <i className="ti ti-trash" style={{ fontSize: 14 }} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {detail && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <div>
                <h2>{detail.short_name || detail.name}</h2>
                {detail.edrpou && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>ЄДРПОУ: {detail.edrpou}</div>}
              </div>
              <button className="modal-close" onClick={() => setDetail(null)}>×</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
              {[{ id: 'info', label: 'Інфо' }, { id: 'txs', label: `Операції (${detailTxs.length})` }, { id: 'projects', label: `Проєкти (${detailProjects.length})` }].map(t => (
                <button key={t.id} onClick={() => setDetailTab(t.id)} style={{
                  padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                  borderBottom: detailTab === t.id ? '2px solid #000' : '2px solid transparent',
                  color: detailTab === t.id ? 'var(--text)' : 'var(--text2)',
                }}>{t.label}</button>
              ))}
            </div>

            {/* Info tab */}
            {detailTab === 'info' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
                {[
                  ['Повна назва', detail.name],
                  ['Коротка назва', detail.short_name],
                  ['ЄДРПОУ', detail.edrpou],
                  ['Тип', typeLabel(detail.type)],
                  ['Email', detail.email],
                  ['Телефон', detail.phone],
                  ['Адреса', detail.address],
                  ['IBAN', detail.iban],
                  ['Банк', detail.bank_name],
                  ['МФО', detail.mfo],
                  ['Стаття за замовч.', detail.default_article],
                  ['Напрям за замовч.', detail.default_direction],
                ].filter(([, v]) => v).map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 2 }}>{l}</div>
                    <div style={{ fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
                {detail.notes && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 2 }}>Нотатки</div>
                    <div>{detail.notes}</div>
                  </div>
                )}
                <div style={{ gridColumn: '1/-1', display: 'flex', gap: 16, padding: '12px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
                  <div><div style={{ fontSize: 12, color: 'var(--text3)' }}>Дохід</div><div style={{ fontSize: 18, fontWeight: 500, color: 'var(--green)' }}>+{fmt(detail.total_income)} грн</div></div>
                  <div><div style={{ fontSize: 12, color: 'var(--text3)' }}>Витрати</div><div style={{ fontSize: 18, fontWeight: 500, color: 'var(--red)' }}>-{fmt(detail.total_expense)} грн</div></div>
                  <div><div style={{ fontSize: 12, color: 'var(--text3)' }}>Операцій</div><div style={{ fontSize: 18, fontWeight: 500 }}>{detail.operations_count}</div></div>
                </div>
              </div>
            )}

            {/* Txs tab */}
            {detailTab === 'txs' && (
              <div>
                {detailTxs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>Немає операцій</div>
                ) : (
                  <div className="tbl-wrap" style={{ maxHeight: 400 }}>
                    <table>
                      <thead><tr><th>Дата</th><th style={{ textAlign: 'right' }}>Сума</th><th>Стаття</th><th>Проєкт</th></tr></thead>
                      <tbody>
                        {detailTxs.map(tx => (
                          <tr key={tx.id}>
                            <td style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{tx.date}</td>
                            <td style={{ textAlign: 'right', fontWeight: 500, color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)} грн
                            </td>
                            <td style={{ fontSize: 13, color: 'var(--text2)' }}>{tx.article || '—'}</td>
                            <td style={{ fontSize: 13, color: 'var(--text2)' }}>{tx.projects?.name || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Projects tab */}
            {detailTab === 'projects' && (
              <div>
                {detailProjects.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>Немає прив'язаних проєктів</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detailProjects.map(name => (
                      <div key={name} style={{ padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, fontWeight: 500 }}>
                        <i className="ti ti-briefcase" style={{ fontSize: 15, marginRight: 8, color: 'var(--text2)' }} />
                        {name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="btn-row" style={{ marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => { openEdit(detail); setDetail(null) }} style={{ width: 'auto' }}>
                <i className="ti ti-pencil" style={{ fontSize: 14 }} /> Редагувати
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit form modal */}
      {showForm && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2>{editId ? 'Редагувати контрагента' : 'Новий контрагент'}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
            </div>
            <div className="form-grid">
              <div className="form-group full">
                <label>Повна назва *</label>
                <input className="form-input" value={form.name} onChange={setF('name')} placeholder="ТОВ Компанія" />
              </div>
              <div className="form-group">
                <label>Коротка назва</label>
                <input className="form-input" value={form.short_name} onChange={setF('short_name')} placeholder="Компанія" />
              </div>
              <div className="form-group">
                <label>ЄДРПОУ / ІПН</label>
                <input className="form-input" value={form.edrpou} onChange={setF('edrpou')} placeholder="12345678" />
              </div>
              <div className="form-group">
                <label>Тип</label>
                <select className="form-input" value={form.type} onChange={setF('type')}>
                  {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Email</label>
                <input className="form-input" value={form.email} onChange={setF('email')} placeholder="email@company.com" />
              </div>
              <div className="form-group">
                <label>Телефон</label>
                <input className="form-input" value={form.phone} onChange={setF('phone')} placeholder="+380..." />
              </div>
              <div className="form-group full">
                <label>Адреса</label>
                <input className="form-input" value={form.address} onChange={setF('address')} />
              </div>
              <div className="form-group">
                <label>IBAN</label>
                <input className="form-input" value={form.iban} onChange={setF('iban')} placeholder="UA..." />
              </div>
              <div className="form-group">
                <label>Банк</label>
                <input className="form-input" value={form.bank_name} onChange={setF('bank_name')} />
              </div>
              <div className="form-group">
                <label>МФО</label>
                <input className="form-input" value={form.mfo} onChange={setF('mfo')} />
              </div>
              <div className="form-group">
                <label>Стаття за замовч.</label>
                <select className="form-input" value={form.default_article} onChange={setF('default_article')}>
                  <option value="">— не задано —</option>
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
                <label>Напрям за замовч.</label>
                <select className="form-input" value={form.default_direction} onChange={setF('default_direction')}>
                  <option value="">— не задано —</option>
                  <option>Доходи</option>
                  <option>Витрати</option>
                  <option>ПФД</option>
                  <option>Інше</option>
                </select>
              </div>
              <div className="form-group full">
                <label>Нотатки</label>
                <textarea className="form-input" rows={2} value={form.notes} onChange={setF('notes')} />
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name} style={{ width: 'auto' }}>
                {saving ? 'Збереження...' : editId ? 'Зберегти' : 'Додати'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)} style={{ width: 'auto' }}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

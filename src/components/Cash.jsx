import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import ContractorSelect from './ui/ContractorSelect'
import { fmtInt as fmt } from '../lib/fmt'

const TYPES = {
  income:         { label: 'Готівкова виручка',    color: '#4A7C59', bg: '#EFF5EF', icon: 'ti-arrow-down-circle',  dir: +1 },
  expense:        { label: 'Витрата готівкою',      color: '#9B3A3A', bg: '#F5EDED', icon: 'ti-arrow-up-circle',    dir: -1 },
  advance:        { label: 'Видача підзвітних',     color: '#6B6B6B', bg: '#F0F2F5', icon: 'ti-user-dollar',        dir: -1 },
  advance_return: { label: 'Повернення підзвітних', color: '#2563EB', bg: '#EFF4FF', icon: 'ti-corner-down-left',   dir: +1 },
  bank_to_cash:   { label: 'Банк → Каса',           color: '#6B6B6B', bg: '#F0F2F5', icon: 'ti-transfer-in',        dir: +1 },
  cash_to_bank:   { label: 'Каса → Банк',           color: '#6B6B6B', bg: '#F0F2F5', icon: 'ti-transfer-out',       dir: -1 },
}

const NEEDS_CLASSIFICATION = ['income', 'expense']
const NEEDS_ADVANCE_PERSON = ['advance']
const NEEDS_ADVANCE_PARENT = ['advance_return']

export default function Cash({ user }) {
  const [tab, setTab] = useState('all')
  const [ops, setOps] = useState([])
  const [advances, setAdvances] = useState([])
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [articles, setArticles] = useState([])
  const [projects, setProjects] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState('expense')
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailDocs, setDetailDocs] = useState([])
  const [showReturn, setShowReturn] = useState(null)
  const [returnAmount, setReturnAmount] = useState('')
  const [returnDesc, setReturnDesc] = useState('')
  const fileRef = useRef()
  const [pendingFile, setPendingFile] = useState(null)

  useEffect(() => {
    fetchArticles().then(setArticles)
    supabase.from('projects').select('id,name').eq('status','active').order('name').then(({ data }) => setProjects(data || []))
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    const { data } = await supabase.from('cash_transactions').select('*, projects(name)').order('date', { ascending: false })
    const all = data || []
    setOps(all)
    setBalance(all.reduce((s, t) => {
      const sign = TYPES[t.type]?.dir || 1
      return s + sign * (t.amount || 0)
    }, 0))

    // Підзвітні: всі видачі + агрегуємо повернення
    const adv = all.filter(t => t.type === 'advance')
    const returns = all.filter(t => t.type === 'advance_return')
    const withReturns = adv.map(a => {
      const returned = returns.filter(r => r.advance_parent_id === a.id).reduce((s, r) => s + (r.amount || 0), 0)
      const outstanding = (a.amount || 0) - returned
      const overdue = a.advance_deadline && new Date(a.advance_deadline) < new Date() && outstanding > 0
      return { ...a, returned, outstanding, overdue }
    })
    setAdvances(withReturns)
    setLoading(false)
  }

  const openForm = (type) => {
    setFormType(type)
    setForm({ date: new Date().toISOString().split('T')[0], amount: '', description: '', counterparty: '', article: '', projectId: '', advance_person: '', advance_deadline: '', advance_parent_id: '' })
    setPendingFile(null)
    setShowForm(true)
  }

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (!form.date || !form.amount) return
    setSaving(true)

    const row = {
      date: form.date,
      amount: parseFloat(form.amount) || 0,
      type: formType,
      description: form.description || null,
      counterparty: form.counterparty || null,
      article: NEEDS_CLASSIFICATION.includes(formType) ? (form.article || null) : null,
      project_id: NEEDS_CLASSIFICATION.includes(formType) ? (form.projectId || null) : null,
      advance_person: NEEDS_ADVANCE_PERSON.includes(formType) ? (form.advance_person || null) : null,
      advance_deadline: NEEDS_ADVANCE_PERSON.includes(formType) ? (form.advance_deadline || null) : null,
      advance_parent_id: NEEDS_ADVANCE_PARENT.includes(formType) ? (form.advance_parent_id || null) : null,
      created_by: user.id,
    }

    const { data: saved, error } = await supabase.from('cash_transactions').insert(row).select().single()
    if (error) { alert('Помилка збереження: ' + error.message); setSaving(false); return }
    if (saved && pendingFile) {
      const ext = pendingFile.name.split('.').pop()
      const path = `cash/${saved.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, pendingFile)
      if (!upErr) {
        await supabase.from('documents').insert({
          cash_transaction_id: saved.id,
          file_name: pendingFile.name,
          file_path: path,
          file_type: pendingFile.type,
          file_size: pendingFile.size,
          doc_role: 'incoming',
          uploaded_by: user.id,
        })
      }
    }

    setSaving(false)
    setShowForm(false)
    loadAll()
  }

  const handleReturn = async () => {
    if (!returnAmount || !showReturn) return
    setSaving(true)
    await supabase.from('cash_transactions').insert({
      date: new Date().toISOString().split('T')[0],
      amount: parseFloat(returnAmount),
      type: 'advance_return',
      advance_parent_id: showReturn.id,
      advance_person: showReturn.advance_person,
      description: returnDesc || `Повернення підзвітних: ${showReturn.advance_person}`,
      created_by: user.id,
    })
    setSaving(false)
    setShowReturn(null)
    setReturnAmount('')
    setReturnDesc('')
    loadAll()
  }

  const openDetail = async (op) => {
    setDetail(op)
    const { data } = await supabase.from('documents').select('*').eq('cash_transaction_id', op.id)
    setDetailDocs(data || [])
  }

  const downloadDoc = async (doc) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const deleteOp = async (id) => {
    if (!window.confirm('Видалити операцію?')) return
    await supabase.from('cash_transactions').delete().eq('id', id)
    loadAll()
  }

  const openAdvances = advances.filter(a => a.outstanding > 0)
  const closedAdvances = advances.filter(a => a.outstanding <= 0)

  const TypeBadge = ({ type }) => {
    const t = TYPES[type]
    if (!t) return null
    return (
      <span style={{ background: t.bg, color: t.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <i className={`ti ${t.icon}`} style={{ fontSize: 11 }} />{t.label}
      </span>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Каса</h1>
          <p style={{ fontSize: 13, color: 'var(--text2)' }}>Готівкові операції та підзвітні</p>
        </div>
        <div className="kpi" style={{ textAlign: 'right', minWidth: 180 }}>
          <div className="kpi-label">Залишок каси</div>
          <div className={`kpi-value ${balance >= 0 ? 'green' : 'red'}`}>{balance >= 0 ? '' : '−'}{fmt(balance)} грн</div>
        </div>
      </div>

      {/* Quick action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(TYPES).map(([type, t]) => (
          <button key={type} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }} onClick={() => openForm(type)}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 14, color: t.color }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {[
          { id: 'all', label: 'Всі операції', icon: 'ti-list-details' },
          { id: 'advances', label: `Підзвітні${openAdvances.length ? ` (${openAdvances.length})` : ''}`, icon: 'ti-user-dollar' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '9px 18px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />{t.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Завантаження...</div>}

      {/* ── TAB: ALL ── */}
      {!loading && tab === 'all' && (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип операції</th>
                <th>Опис / Особа</th>
                <th style={{ textAlign: 'right' }}>Сума, грн</th>
                <th>Стаття / Проєкт</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ops.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>Немає операцій. Натисніть будь-яку кнопку вище.</td></tr>
              )}
              {ops.map(op => {
                const t = TYPES[op.type]
                const signed = (t?.dir || 1) * (op.amount || 0)
                return (
                  <tr key={op.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(op)}>
                    <td style={{ color: 'var(--text2)', fontSize: 12, whiteSpace: 'nowrap' }}>{op.date}</td>
                    <td><TypeBadge type={op.type} /></td>
                    <td>
                      <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                        {op.advance_person || op.counterparty || op.description || '—'}
                      </div>
                      {op.advance_person && op.description && (
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{op.description}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: signed >= 0 ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
                      {signed >= 0 ? '+' : '−'}{fmt(signed)}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                      <div>{op.article || '—'}</div>
                      {op.projects?.name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{op.projects.name}</div>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)' }}
                        onClick={() => deleteOp(op.id)}
                      ><i className="ti ti-trash" style={{ fontSize: 13 }} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB: ADVANCES ── */}
      {!loading && tab === 'advances' && (
        <div>
          {openAdvances.length === 0 && closedAdvances.length === 0 && (
            <div className="card">
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                <i className="ti ti-user-check" style={{ fontSize: 48, display: 'block', margin: '0 auto 12px', color: 'var(--green)' }} />
                <p style={{ fontWeight: 600, color: 'var(--green)' }}>Немає відкритих підзвітних</p>
              </div>
            </div>
          )}

          {/* Open advances */}
          {openAdvances.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ti ti-clock" style={{ fontSize: 15, color: 'var(--amber)' }} />
                Відкриті підзвітні ({openAdvances.length})
              </div>
              {openAdvances.map(a => (
                <div key={a.id} style={{ border: `1px solid ${a.overdue ? '#E2E8F0' : 'var(--border)'}`, borderRadius: 12, padding: '14px 16px', background: a.overdue ? '#F5EDED' : 'var(--surface)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{a.advance_person}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{a.description}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {a.overdue && (
                        <span style={{ fontSize: 11, background: '#F5EDED', color: 'var(--red)', padding: '2px 8px', borderRadius: 6, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                          <i className="ti ti-alert-triangle" style={{ marginRight: 3, fontSize: 11 }} />Прострочено
                        </span>
                      )}
                      {a.advance_deadline && (
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>До {a.advance_deadline}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
                    {[
                      { l: 'Видано', v: fmt(a.amount) + ' грн', c: 'var(--text)' },
                      { l: 'Повернено', v: fmt(a.returned) + ' грн', c: 'var(--green)' },
                      { l: 'Залишок', v: fmt(a.outstanding) + ' грн', c: a.overdue ? 'var(--red)' : 'var(--amber)' },
                    ].map(({ l, v, c }) => (
                      <div key={l}>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>{l}</div>
                        <div style={{ fontWeight: 500, fontSize: 14, color: c }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 5 }} onClick={() => { setShowReturn(a); setReturnAmount(a.outstanding.toString()) }}>
                      <i className="ti ti-corner-down-left" style={{ fontSize: 13 }} />Повернення
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => openDetail(a)}>Деталі</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Closed advances */}
          {closedAdvances.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ti ti-circle-check" style={{ fontSize: 14, color: 'var(--green)' }} />
                Закриті ({closedAdvances.length})
              </div>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Дата</th><th>Особа</th><th style={{ textAlign: 'right' }}>Видано</th><th style={{ textAlign: 'right' }}>Повернено</th><th>Статус</th></tr></thead>
                  <tbody>
                    {closedAdvances.map(a => (
                      <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(a)}>
                        <td style={{ color: 'var(--text2)', fontSize: 12 }}>{a.date}</td>
                        <td>{a.advance_person}</td>
                        <td style={{ textAlign: 'right', color: 'var(--red)' }}>−{fmt(a.amount)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--green)' }}>+{fmt(a.returned)}</td>
                        <td><span style={{ fontSize: 11, background: '#EFF5EF', color: 'var(--green)', padding: '2px 8px', borderRadius: 6 }}>Закрито</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: Add operation ── */}
      {showForm && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className={`ti ${TYPES[formType]?.icon}`} style={{ fontSize: 18, color: TYPES[formType]?.color }} />
                {TYPES[formType]?.label}
              </h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
            </div>

            {/* Type switcher */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {Object.entries(TYPES).map(([type, t]) => (
                <button key={type} onClick={() => setFormType(type)} style={{
                  padding: '4px 10px', border: `1px solid ${formType === type ? t.color : 'var(--border2)'}`,
                  borderRadius: 6, background: formType === type ? t.bg : 'none',
                  color: formType === type ? t.color : 'var(--text2)', cursor: 'pointer',
                  fontSize: 12, fontFamily: 'inherit', fontWeight: formType === type ? 600 : 400,
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Дата *</label>
                <input type="date" className="form-input" value={form.date} onChange={setF('date')} />
              </div>
              <div className="form-group">
                <label>Сума, грн *</label>
                <input type="number" className="form-input" value={form.amount} onChange={setF('amount')} placeholder="0.00" />
              </div>

              {/* Advance person */}
              {NEEDS_ADVANCE_PERSON.includes(formType) && (<>
                <div className="form-group">
                  <label>Кому видано *</label>
                  <input className="form-input" value={form.advance_person} onChange={setF('advance_person')} placeholder="ПІБ або посада" />
                </div>
                <div className="form-group">
                  <label>Повернути до</label>
                  <input type="date" className="form-input" value={form.advance_deadline} onChange={setF('advance_deadline')} />
                </div>
              </>)}

              {/* Advance return — link to parent */}
              {NEEDS_ADVANCE_PARENT.includes(formType) && (
                <div className="form-group full">
                  <label>Повернення по підзвітних</label>
                  <select className="form-input" value={form.advance_parent_id} onChange={setF('advance_parent_id')}>
                    <option value="">— оберіть яка видача закривається —</option>
                    {openAdvances.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.advance_person} · {fmt(a.outstanding)} грн залишок · {a.date}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Classification for income/expense */}
              {NEEDS_CLASSIFICATION.includes(formType) && (<>
                <div className="form-group">
                  <label>Контрагент</label>
                  <ContractorSelect
  value={form.counterparty}
  onChange={v => setForm(f => ({...f, counterparty: v}))}
  onContractorSelect={c => {
    if (c._new) return
    if (c.default_article) setForm(f => ({...f, article: c.default_article}))
  }}
/>
                </div>
                <div className="form-group">
                  <label>Стаття</label>
                  <select className="form-input" value={form.article} onChange={setF('article')}>
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
                  <label>Проєкт</label>
                  <select className="form-input" value={form.projectId} onChange={setF('projectId')}>
                    <option value="">— без проєкту —</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </>)}

              <div className="form-group full">
                <label>Призначення</label>
                <textarea className="form-input" rows={2} value={form.description} onChange={setF('description')} placeholder="Опис операції" />
              </div>
            </div>

            {/* Document attach */}
            <div style={{ marginTop: 12 }}>
              {pendingFile ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                  <i className="ti ti-file-text" style={{ fontSize: 18, color: 'var(--blue)' }} />
                  <span style={{ flex: 1, fontSize: 13 }}>{pendingFile.name}</span>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)' }} onClick={() => setPendingFile(null)}>
                    <i className="ti ti-x" style={{ fontSize: 14 }} />
                  </button>
                </div>
              ) : (
                <button className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => fileRef.current.click()}>
                  <i className="ti ti-paperclip" style={{ fontSize: 14 }} />
                  Прикріпити документ (необовʼязково)
                </button>
              )}
              <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={e => setPendingFile(e.target.files[0])} />
            </div>

            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.date || !form.amount}>
                {saving ? 'Збереження...' : 'Зберегти'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Return advance ── */}
      {showReturn && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setShowReturn(null)}>
          <div className="modal">
            <div className="modal-header">
              <h2>Повернення підзвітних</h2>
              <button className="modal-close" onClick={() => setShowReturn(null)}>×</button>
            </div>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
              <strong>{showReturn.advance_person}</strong>
              <span style={{ color: 'var(--text2)', marginLeft: 8 }}>Залишок: {fmt(showReturn.outstanding)} грн</span>
            </div>
            <div className="form-grid">
              <div className="form-group full">
                <label>Сума повернення, грн</label>
                <input type="number" className="form-input" value={returnAmount} onChange={e => setReturnAmount(e.target.value)} max={showReturn.outstanding} />
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                  Можна повернути частково. Залишок {fmt(showReturn.outstanding - (parseFloat(returnAmount) || 0))} грн залишиться відкритим.
                </div>
              </div>
              <div className="form-group full">
                <label>Примітка</label>
                <input className="form-input" value={returnDesc} onChange={e => setReturnDesc(e.target.value)} placeholder="необовʼязково" />
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleReturn} disabled={saving || !returnAmount}>
                {saving ? 'Збереження...' : 'Зафіксувати повернення'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowReturn(null)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Detail ── */}
      {detail && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal">
            <div className="modal-header">
              <h2><TypeBadge type={detail.type} /></h2>
              <button className="modal-close" onClick={() => setDetail(null)}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 16, background: 'var(--surface2)', borderRadius: 8, padding: '12px 14px' }}>
              {[
                ['Дата', detail.date],
                ['Сума', `${TYPES[detail.type]?.dir === -1 ? '−' : '+'}${fmt(detail.amount)} грн`],
                detail.advance_person && ['Особа', detail.advance_person],
                detail.advance_deadline && ['До', detail.advance_deadline],
                detail.counterparty && ['Контрагент', detail.counterparty],
                detail.article && ['Стаття', detail.article],
                detail.projects?.name && ['Проєкт', detail.projects.name],
                detail.description && ['Призначення', detail.description],
              ].filter(Boolean).map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 1 }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
            {detailDocs.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ti ti-paperclip" style={{ fontSize: 14, color: 'var(--blue)' }} />
                  Документи ({detailDocs.length})
                </div>
                {detailDocs.map(doc => (
                  <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <i className="ti ti-file-text" style={{ fontSize: 18, color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.file_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{(doc.file_size / 1024).toFixed(0)} KB</div>
                    </div>
                    <button className="btn btn-sm btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => downloadDoc(doc)}>
                      <i className="ti ti-download" style={{ fontSize: 13 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'

// Фінансові результати проекту (адмін): реальний, касовий прибуток за фактичними
// банківськими транзакціями. Проект — окрема сутність; транзакції чіпляються частками
// (надходження/витрати), сума — як у виписці (з ПДВ). Прибуток = надходження − витрати.

const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''

export default function FinanceProjects() {
  const { user } = useUser()
  const [projects, setProjects] = useState(null)
  const [selId, setSelId] = useState(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const loadProjects = async () => {
    const { data } = await qc('finance_projects').select('*').is('archived_at', null).order('created_at', { ascending: false })
    setProjects(data || [])
    if (data?.length && !selId) setSelId(data[0].id)
  }
  useEffect(() => { loadProjects() }, [])

  const create = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const { data, error } = await qc('finance_projects').insert(withCompany({ name: newName.trim(), created_by: user?.id || null })).select('id').single()
    setCreating(false)
    if (error) { alert('Не вдалося: ' + (/finance_projects/.test(error.message) ? 'запустіть міграцію 055' : error.message)); return }
    setNewName(''); await loadProjects(); setSelId(data.id)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ti ti-chart-pie" style={{ fontSize: 22 }} />
        <h1 style={{ margin: 0 }}>Фінрезультат проекту</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
        Реальний прибуток за фактичними грошима: оберіть проект, додайте банківські транзакції надходжень і витрат.
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Список проектів */}
        <div className="card" style={{ flex: '0 0 280px', minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input className="form-input" placeholder="Новий проект…" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
            <button className="btn btn-primary" onClick={create} disabled={creating}><i className="ti ti-plus" /></button>
          </div>
          {projects == null ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Завантаження…</p>
            : projects.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Проектів немає. Створіть перший.</p>
            : projects.map(p => (
              <div key={p.id} onClick={() => setSelId(p.id)} style={{ padding: '9px 11px', borderRadius: 8, cursor: 'pointer', marginBottom: 4, background: selId === p.id ? 'var(--surface2)' : 'transparent', fontWeight: selId === p.id ? 600 : 400, fontSize: 14 }}>
                {p.name}
              </div>
            ))}
        </div>

        {/* Деталі проекту */}
        <div style={{ flex: '1 1 520px', minWidth: 320 }}>
          {selId ? <ProjectDetail key={selId} projectId={selId} onDeleted={() => { setSelId(null); loadProjects() }} onRenamed={loadProjects} /> : <div className="card"><p style={{ color: 'var(--text3)' }}>Оберіть або створіть проект.</p></div>}
        </div>
      </div>
    </div>
  )
}

function ProjectDetail({ projectId, onDeleted, onRenamed }) {
  const [project, setProject] = useState(null)
  const [items, setItems] = useState(null)
  const [picker, setPicker] = useState(null) // 'income' | 'expense'

  const load = async () => {
    const [{ data: p }, { data: its }] = await Promise.all([
      qc('finance_projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('finance_project_items')
        .select('id, kind, amount, note, transaction_id, bank_transactions(date, counterparty, description, amount, direction)')
        .eq('project_id', projectId).order('created_at'),
    ])
    setProject(p); setItems(its || [])
  }
  useEffect(() => { load() }, [projectId])

  const income = useMemo(() => (items || []).filter(i => i.kind === 'income').reduce((s, i) => s + (Number(i.amount) || 0), 0), [items])
  const expense = useMemo(() => (items || []).filter(i => i.kind === 'expense').reduce((s, i) => s + (Number(i.amount) || 0), 0), [items])
  const profit = income - expense
  const marginPct = income > 0 ? (profit / income * 100) : 0

  const removeItem = async (it) => {
    await supabase.from('finance_project_items').delete().eq('id', it.id)
    load()
  }
  const delProject = async () => {
    if (!confirm(`Видалити проект «${project?.name}» з усіма прив'язками?`)) return
    await qc('finance_projects').delete().eq('id', projectId)
    onDeleted()
  }
  const rename = async () => {
    const name = prompt('Назва проекту:', project?.name || '')
    if (name == null || !name.trim()) return
    await qc('finance_projects').update({ name: name.trim() }).eq('id', projectId)
    load(); onRenamed()
  }

  if (!project) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>

  const Section = ({ kind, label, color }) => {
    const list = (items || []).filter(i => i.kind === kind)
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontWeight: 600, color }}>{label} <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 13 }}>· {fmt(kind === 'income' ? income : expense)} грн</span></div>
          <button className="btn" onClick={() => setPicker(kind)}><i className="ti ti-plus" /> Додати транзакцію</button>
        </div>
        {list.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13, margin: 0 }}>Немає транзакцій.</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table><thead><tr><th>Дата</th><th>Контрагент / опис</th><th style={{ textAlign: 'right' }}>Сума</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>{list.map(it => { const t = it.bank_transactions || {}; return (
                <tr key={it.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(t.date)}</td>
                  <td><div className="trunc" style={{ maxWidth: 320 }}>{t.counterparty || t.description || (it.transaction_id ? '—' : 'транзакцію видалено')}</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 500 }}>{fmt(it.amount)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn" onClick={() => removeItem(it)} style={{ padding: '2px 8px', color: 'var(--red)' }}><i className="ti ti-x" /></button></td>
                </tr>
              )})}</tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{project.name}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={rename}><i className="ti ti-pencil" /> Перейменувати</button>
            <button className="btn" onClick={delProject} style={{ color: 'var(--red)' }}><i className="ti ti-trash" /> Видалити</button>
          </div>
        </div>
        <div className="kpi-grid" style={{ marginTop: 14 }}>
          <Kpi label="Надходження" value={income} color="var(--green)" />
          <Kpi label="Витрати" value={expense} color="var(--red)" />
          <Kpi label="Реальний прибуток" value={profit} color={profit >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Kpi label="Маржа" value={null} text={income > 0 ? `${marginPct.toFixed(1)}%` : '—'} color={profit >= 0 ? 'var(--green)' : 'var(--red)'} />
        </div>
      </div>

      <Section kind="income" label="Надходження" color="var(--green)" />
      <Section kind="expense" label="Витрати" color="var(--red)" />

      {picker && <TxPicker kind={picker} onClose={() => setPicker(null)} onAdded={() => { setPicker(null); load() }} projectId={projectId} />}
    </div>
  )
}

// Вибір банківської транзакції + сума частки
function TxPicker({ kind, projectId, onClose, onAdded }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [chosen, setChosen] = useState(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const search = async (term) => {
    let query = qc('bank_transactions')
      .select('id, date, counterparty, description, amount, direction, edrpou')
      .eq('is_ignored', false).order('date', { ascending: false }).limit(60)
    // Підказка за напрямом: надходження → Доходи, витрати → Витрати
    if (kind === 'income') query = query.eq('direction', 'Доходи')
    else if (kind === 'expense') query = query.eq('direction', 'Витрати')
    const t = term.trim()
    if (t) query = query.or(`counterparty.ilike.%${t}%,description.ilike.%${t}%,edrpou.ilike.%${t}%`)
    const { data } = await query
    setRows(data || [])
  }
  useEffect(() => { const id = setTimeout(() => search(q), q ? 300 : 0); return () => clearTimeout(id) }, [q])

  const pick = (t) => { setChosen(t); setAmount(String(Math.abs(Number(t.amount) || 0))) }

  const add = async () => {
    if (!chosen) return
    setBusy(true)
    const { error } = await supabase.from('finance_project_items').insert({
      project_id: projectId, transaction_id: chosen.id, kind,
      amount: Math.abs(Number(amount) || 0), note: note.trim() || null,
    })
    setBusy(false)
    if (error) { alert('Не вдалося: ' + error.message); return }
    onAdded()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 620, maxWidth: '100%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>Додати {kind === 'income' ? 'надходження' : 'витрату'} з банку</div>
          <button className="btn" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        {!chosen ? (
          <>
            <input className="form-input" placeholder="Пошук: контрагент / опис / ЄДРПОУ…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} autoFocus />
            {rows == null ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p>
              : rows.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Транзакцій не знайдено.</p> : (
                <div className="tbl-wrap" style={{ border: 'none' }}>
                  <table><thead><tr><th>Дата</th><th>Контрагент / опис</th><th style={{ textAlign: 'right' }}>Сума</th></tr></thead>
                    <tbody>{rows.map(t => (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => pick(t)}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(t.date)}</td>
                        <td><div className="trunc" style={{ maxWidth: 320 }}>{t.counterparty || t.description || '—'}</div></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(t.amount)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
          </>
        ) : (
          <>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
              <div>{d(chosen.date)} · <b>{chosen.counterparty || chosen.description || '—'}</b></div>
              <div style={{ color: 'var(--text3)', marginTop: 2 }}>Сума транзакції: {fmt(chosen.amount)} грн</div>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Сума частки на проект (грн)</label>
                <input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>За замовч. — вся сума транзакції; зменште, якщо ділиться між проектами.</span>
              </div>
              <div className="form-group"><label>Примітка (необов'язково)</label>
                <input className="form-input" value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={add} disabled={busy}>{busy ? '…' : 'Додати'}</button>
              <button className="btn" onClick={() => setChosen(null)}>← Інша транзакція</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, text, color }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{text != null ? text : <>{fmtInt(value)} <span style={{ fontSize: 14, color: 'var(--text3)' }}>грн</span></>}</div>
    </div>
  )
}

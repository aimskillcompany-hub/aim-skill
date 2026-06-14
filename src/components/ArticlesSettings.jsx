import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { invalidateCache, TYPE_LABELS } from '../lib/articles'

const TYPES = ['expense', 'income', 'transfer', 'other']

export default function ArticlesSettings() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState({ name: '', type: 'expense' })
  const [saving, setSaving] = useState(false)
  const [activeType, setActiveType] = useState('expense')

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('articles').select('*').order('type').order('sort_order').order('name')
    setArticles(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openAdd = () => {
    setEditItem(null)
    setForm({ name: '', type: activeType })
    setShowForm(true)
  }

  const openEdit = (a) => {
    setEditItem(a)
    setForm({ name: a.name, type: a.type })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    if (editItem) {
      await supabase.from('articles').update({ name: form.name.trim(), type: form.type }).eq('id', editItem.id)
    } else {
      const maxOrder = Math.max(0, ...articles.filter(a => a.type === form.type).map(a => a.sort_order || 0))
      await supabase.from('articles').insert({ name: form.name.trim(), type: form.type, sort_order: maxOrder + 10 })
    }
    invalidateCache()
    setSaving(false)
    setShowForm(false)
    load()
  }

  const handleToggle = async (a) => {
    await supabase.from('articles').update({ is_active: !a.is_active }).eq('id', a.id)
    invalidateCache()
    setArticles(prev => prev.map(x => x.id === a.id ? { ...x, is_active: !a.is_active } : x))
  }

  const handleDelete = async (a) => {
    if (!window.confirm(`Видалити статтю "${a.name}"?`)) return
    await supabase.from('articles').delete().eq('id', a.id)
    invalidateCache()
    setArticles(prev => prev.filter(x => x.id !== a.id))
  }

  const byType = TYPES.reduce((acc, t) => {
    acc[t] = articles.filter(a => a.type === t)
    return acc
  }, {})

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Статті доходів та витрат</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 2 }}>
            Налаштуйте категорії для класифікації операцій
          </div>
        </div>
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={openAdd}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} />Додати статтю
        </button>
      </div>

      {/* Type tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {TYPES.map(t => (
          <button key={t} onClick={() => setActiveType(t)} style={{
            padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
            borderBottom: activeType === t ? '2px solid var(--blue)' : '2px solid transparent',
            color: activeType === t ? 'var(--blue)' : 'var(--text2)',
          }}>
            {TYPE_LABELS[t]}
            <span style={{ marginLeft: 6, fontSize: 11, background: activeType === t ? 'var(--blue-bg)' : 'var(--surface2)', color: activeType === t ? 'var(--blue)' : 'var(--text3)', padding: '1px 6px', borderRadius: 10 }}>
              {byType[t]?.length || 0}
            </span>
          </button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text2)', padding: 20, textAlign: 'center' }}>Завантаження...</div>}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {byType[activeType]?.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text3)', fontSize: 13 }}>
              Немає статей. Натисніть «Додати статтю».
            </div>
          )}
          {byType[activeType]?.map(a => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              border: '1px solid var(--border)', borderRadius: 8,
              background: a.is_active ? 'var(--surface)' : 'var(--surface2)',
              opacity: a.is_active ? 1 : 0.55,
            }}>
              <i className="ti ti-grip-vertical" style={{ color: 'var(--text3)', fontSize: 14, cursor: 'grab' }} />
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: a.is_active ? 500 : 400 }}>{a.name}</span>
              {!a.is_active && (
                <span style={{ fontSize: 11, background: 'var(--border)', color: 'var(--text3)', padding: '1px 8px', borderRadius: 4 }}>
                  Вимкнено
                </span>
              )}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => handleToggle(a)}
                  title={a.is_active ? 'Вимкнути' : 'Увімкнути'}
                  style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: a.is_active ? 'var(--text2)' : 'var(--green)' }}
                >
                  <i className={`ti ${a.is_active ? 'ti-eye-off' : 'ti-eye'}`} style={{ fontSize: 13 }} />
                </button>
                <button
                  onClick={() => openEdit(a)}
                  style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)' }}
                >
                  <i className="ti ti-pencil" style={{ fontSize: 13 }} />
                </button>
                <button
                  onClick={() => handleDelete(a)}
                  style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)' }}
                >
                  <i className="ti ti-trash" style={{ fontSize: 13 }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2>{editItem ? 'Редагувати статтю' : 'Нова стаття'}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
            </div>
            <div className="form-grid">
              <div className="form-group full">
                <label>Назва статті *</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Наприклад: Витрати на рекламу"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                />
              </div>
              <div className="form-group full">
                <label>Тип</label>
                <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? 'Збереження...' : editItem ? 'Зберегти' : 'Додати'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

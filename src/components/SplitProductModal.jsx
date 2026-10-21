import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc } from '../lib/companyScope'
import { fetchAll } from '../lib/fetchAll'
import { fmt } from '../lib/fmt'
import { dmy } from '../lib/shipmentRecon'

// назва товару так, як вона записана в документі руху («Прихід: …» → «…»)
const docName = (m) => (m.description || '').replace(/^[^:]*:\s*/, '').trim() || '(без назви)'

// «Розділити картку» (087): обрані рухи й синоніми → на нову або наявну картку. Скасовується з журналу.
export default function SplitProductModal({ product, onClose, onDone }) {
  const [movs, setMovs] = useState(null)
  const [aliases, setAliases] = useState([])
  const [sel, setSel] = useState(() => new Set())
  const [selAl, setSelAl] = useState(() => new Set())
  const [mode, setMode] = useState('new')          // new | existing
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [target, setTarget] = useState(null)
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)

  const load = async () => {
    const rows = await fetchAll(() => qc('stock_movements')
      .select('id, type, quantity, price, cost_price, date, description, source, documents(doc_number, doc_date)')
      .eq('product_id', product.id)).catch(e => { setErr(e.message); return [] })
    setMovs(rows.sort((a, b) => String(a.documents?.doc_date || a.date).localeCompare(String(b.documents?.doc_date || b.date))))
    const { data: al } = await supabase.from('product_aliases').select('alias').eq('product_id', product.id)
    setAliases((al || []).map(a => a.alias))
    const { data: lg } = await supabase.from('cost_action_log').select('id, created_at, before, after, action')
      .in('action', ['split', 'split_undo']).order('created_at', { ascending: false }).limit(200)
    const undone = new Set((lg || []).filter(r => r.action === 'split_undo').map(r => r.before?.split_log))
    setLog((lg || []).filter(r => r.action === 'split' && (r.before?.src?.id === product.id || r.before?.target === product.id) && !undone.has(r.id)))
  }
  useEffect(() => { load() }, [product.id])

  useEffect(() => {
    const t = q.trim()
    if (mode !== 'existing' || t.length < 2) { setFound([]); return }
    qc('product_stock').select('id, name, sku, computed_stock').or(`name.ilike.%${t}%,sku.ilike.%${t}%`).limit(15)
      .then(({ data }) => setFound((data || []).filter(r => r.id !== product.id)))
  }, [q, mode])

  // групи за назвою в документах
  const groups = useMemo(() => {
    const g = new Map()
    for (const m of movs || []) {
      const k = docName(m)
      if (!g.has(k)) g.set(k, [])
      g.get(k).push(m)
    }
    return [...g.entries()].map(([k, rows]) => ({
      name: k, rows,
      inQty: rows.filter(r => r.type === 'in').reduce((s, r) => s + Number(r.quantity || 0), 0),
      outQty: rows.filter(r => r.type === 'out').reduce((s, r) => s + Number(r.quantity || 0), 0),
    }))
  }, [movs])

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleGroup = (g) => {
    const ids = g.rows.filter(r => r.source !== 'assembly').map(r => r.id)
    const all = ids.every(id => sel.has(id))
    setSel(s => { const n = new Set(s); ids.forEach(id => all ? n.delete(id) : n.add(id)); return n })
    // синонім з такою самою назвою — разом із групою
    const al = aliases.find(a => a.trim().toLowerCase() === g.name.toLowerCase())
    if (al) setSelAl(s => { const n = new Set(s); all ? n.delete(al) : n.add(al); return n })
    if (!all && !name) setName(g.name)
  }
  const toggleAl = (a) => setSelAl(s => { const n = new Set(s); n.has(a) ? n.delete(a) : n.add(a); return n })

  const picked = (movs || []).filter(m => sel.has(m.id))
  const pin = picked.filter(m => m.type === 'in').reduce((s, m) => s + Number(m.quantity || 0), 0)
  const pout = picked.filter(m => m.type === 'out').reduce((s, m) => s + Number(m.quantity || 0), 0)
  const allIn = (movs || []).filter(m => m.type === 'in').reduce((s, m) => s + Number(m.quantity || 0), 0)
  const allOut = (movs || []).filter(m => m.type === 'out').reduce((s, m) => s + Number(m.quantity || 0), 0)

  const run = async () => {
    setErr(null)
    if (sel.size === 0 && selAl.size === 0) { setErr('Позначте рухи або синоніми'); return }
    if (mode === 'new' && !name.trim()) { setErr('Вкажіть назву нової картки'); return }
    if (mode === 'existing' && !target) { setErr('Оберіть картку, на яку переносимо'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('split_product', {
      p_src: product.id, p_movs: [...sel], p_target: mode === 'existing' ? target.id : null,
      p_new_name: mode === 'new' ? name.trim() : null, p_new_sku: mode === 'new' ? (sku.trim() || null) : null,
      p_aliases: [...selAl],
    })
    setBusy(false)
    if (error) {
      setErr(error.code === 'PGRST202' ? 'Міграцію 087 ще не застосовано' : error.message.replace(/^[A-Z_]+:\s*/, ''))
      return
    }
    setDone(data); setSel(new Set()); setSelAl(new Set()); load()
  }

  const undo = async (logId) => {
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('split_undo', { p_log: logId })
    setBusy(false)
    if (error) { setErr(error.message.replace(/^[A-Z_]+:\s*/, '')); return }
    setDone(null); load()
  }

  const cell = { padding: '4px 6px', fontSize: 12, borderBottom: '1px solid var(--border)' }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Розділити картку</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
          <b>{product.name}</b> · прийшло {fmt(allIn)}, продано {fmt(allOut)}. Позначте рухи <b>іншого товару</b> — вони перейдуть на нову або наявну картку.
          Собівартість не змінюється; після розділення перевірте «Діагностику» і «Застосувати FIFO» (з резервною копією).
        </div>

        {!movs ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : (
          <div style={{ maxHeight: '42vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {groups.map(g => {
              const ids = g.rows.filter(r => r.source !== 'assembly').map(r => r.id)
              const all = ids.length > 0 && ids.every(id => sel.has(id))
              return (
                <div key={g.name}>
                  <div onClick={() => toggleGroup(g)} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', background: 'var(--surface2)', cursor: 'pointer', fontSize: 13, position: 'sticky', top: 0 }}>
                    <input type="checkbox" readOnly checked={all} />
                    <b className="trunc" style={{ flex: 1 }}>{g.name}</b>
                    <span style={{ color: 'var(--text3)', flexShrink: 0 }}>↓{fmt(g.inQty)} ↑{fmt(g.outQty)}</span>
                  </div>
                  <table style={{ width: '100%' }}><tbody>
                    {g.rows.map(m => (
                      <tr key={m.id} onClick={() => m.source !== 'assembly' && toggle(m.id)} style={{ cursor: m.source === 'assembly' ? 'default' : 'pointer', opacity: m.source === 'assembly' ? 0.5 : 1 }}>
                        <td style={{ ...cell, width: 28 }}><input type="checkbox" readOnly disabled={m.source === 'assembly'} checked={sel.has(m.id)} /></td>
                        <td style={{ ...cell, width: 80 }}>{dmy(m.documents?.doc_date || m.date)}</td>
                        <td style={{ ...cell, width: 80, color: m.type === 'in' ? 'var(--green)' : 'var(--red)' }}>{m.type === 'in' ? '↓ прихід' : '↑ видаток'}</td>
                        <td style={{ ...cell, width: 60, textAlign: 'right' }}>{fmt(m.quantity)}</td>
                        <td style={{ ...cell, width: 100, textAlign: 'right' }} title={m.type === 'in' ? 'ціна приходу' : 'собівартість'}>{fmt(m.type === 'in' ? m.price : m.cost_price)}</td>
                        <td style={cell}>{m.documents?.doc_number ? `№${m.documents.doc_number}` : m.source === 'assembly' ? 'збірка (переноситься разом зі збіркою)' : m.source || ''}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              )
            })}
            {groups.length === 0 && <div style={{ padding: 10, color: 'var(--text3)', fontSize: 13 }}>Рухів немає</div>}
          </div>
        )}

        {aliases.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>СИНОНІМИ, які перенести (за ними імпорт підставляє картку)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {aliases.map(a => (
                <span key={a} onClick={() => toggleAl(a)} style={{ cursor: 'pointer', borderRadius: 6, padding: '2px 8px', fontSize: 12, border: '1px solid ' + (selAl.has(a) ? 'var(--blue)' : 'var(--border)'), background: selAl.has(a) ? 'var(--blue)' : 'var(--surface2)', color: selAl.has(a) ? '#fff' : 'var(--text)' }}>{a}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
          {[['new', 'На нову картку'], ['existing', 'На наявну картку']].map(([k, l]) => (
            <button key={k} className="btn" onClick={() => setMode(k)} style={{ background: mode === k ? 'var(--blue)' : 'var(--surface)', color: mode === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)', fontSize: 12 }}>{l}</button>
          ))}
        </div>
        {mode === 'new' ? (
          <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="form-group"><label>Назва нової картки *</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="form-group"><label>Артикул</label><input className="form-input" value={sku} onChange={e => setSku(e.target.value)} /></div>
          </div>
        ) : !target ? (
          <div style={{ marginTop: 8 }}>
            <input className="form-input" placeholder="Знайти картку (назва або артикул)…" value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 180, overflow: 'auto' }}>
              {found.map(r => (
                <div key={r.id} onClick={() => setTarget(r)} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                  <span className="trunc">{r.name}{r.sku ? <span style={{ color: 'var(--text3)', fontSize: 11 }}> · {r.sku}</span> : ''}</span><span>{fmt(r.computed_stock)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 13 }}>На картку <b>{target.name}</b> <button className="btn" onClick={() => setTarget(null)} style={{ padding: '0 6px' }}>змінити</button></div>
        )}

        {(sel.size > 0 || selAl.size > 0) && (
          <div style={{ marginTop: 10, fontSize: 13, background: 'var(--surface2)', borderRadius: 8, padding: 10 }}>
            Перенести {sel.size} рух(ів): ↓{fmt(pin)} ↑{fmt(pout)}, синонімів {selAl.size}.
            Тут лишиться ↓{fmt(allIn - pin)} ↑{fmt(allOut - pout)}
            {allIn - pin - (allOut - pout) < 0 && <b style={{ color: 'var(--red)' }}> — залишок стане мінусовим ({fmt(allIn - pin - allOut + pout)})</b>}
          </div>
        )}
        {done && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--green)' }}>
          Готово: перенесено рухів {done.movements}, синонімів {done.aliases}{done.created ? ', створено нову картку' : ''}; знято розподілів по партіях {done.allocations_removed}.
          <a href={`/inventory/product/${done.target}`} style={{ marginLeft: 8 }}>Відкрити картку →</a>
        </div>}
        {log.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)' }}>
          <div style={{ fontWeight: 700, color: 'var(--text3)' }}>РОЗДІЛЕННЯ ЦІЄЇ КАРТКИ</div>
          {log.map(r => <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
            <span>{dmy(r.created_at?.slice(0, 10))}: {r.before?.src?.id === product.id ? 'перенесено звідси' : `перенесено сюди з «${r.before?.src?.name}»`} — рухів {(r.after?.stock_movements || []).length}, синонімів {(r.after?.product_aliases || []).length}</span>
            <button className="btn" disabled={busy} onClick={() => undo(r.id)} style={{ padding: '0 8px', fontSize: 12 }}>Скасувати</button>
          </div>)}
        </div>}
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={() => done ? onDone() : onClose()}>{done ? 'Закрити' : 'Скасувати'}</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || (sel.size === 0 && selAl.size === 0)}>{busy ? '…' : 'Розділити'}</button>
        </div>
      </div>
    </div>
  )
}

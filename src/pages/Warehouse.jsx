import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { assembleProduct } from '../lib/stockService'
import { getDocType } from '../lib/docgen'
import DocModal from '../components/DocModal'
import { useSort, SortTh } from '../components/Sort'

// поля документа-джерела, потрібні для модалки DocModal
const DOC_EMBED = 'documents(id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, contractors(name))'

export default function Warehouse() {
  const [tab, setTab] = useState('stock')
  return (
    <div>
      <div className="page-header"><h1>Склад</h1></div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {[['stock', 'Залишки', 'ti-package'], ['movements', 'Рухи', 'ti-arrows-up-down'], ['assemblies', 'Збірки', 'ti-tool']].map(([id, lbl, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}><i className={`ti ${icon}`} style={{ fontSize: 15 }} />{lbl}</button>
        ))}
      </div>
      {tab === 'stock' && <StockTab />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'assemblies' && <AssembliesTab />}
    </div>
  )
}
const tabStyle = (active) => ({
  padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
  fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
  borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent', color: active ? 'var(--blue)' : 'var(--text2)',
})

// ───────── Залишки (довідник товарів) ─────────
function StockTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [onlyStock, setOnlyStock] = useState(false)
  const [detail, setDetail] = useState(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('product_stock')
      .select('id, name, sku, unit, buy_price, sell_price, computed_stock, total_in, total_out')
      .eq('status', 'active').order('name').limit(2000)
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r => {
      if (onlyStock && (Number(r.computed_stock) || 0) <= 0) return false
      if (!t) return true
      return (r.name || '').toLowerCase().includes(t) || (r.sku || '').toLowerCase().includes(t)
    })
  }, [rows, q, onlyStock])

  const totalValue = useMemo(() => filtered.reduce((s, r) => s + (Number(r.computed_stock) || 0) * (Number(r.buy_price) || 0), 0), [filtered])
  const { sort, onSort, sorted } = useSort('name', 'asc')
  const view = sorted(filtered, {
    computed_stock: r => Number(r.computed_stock) || 0,
    buy_price: r => Number(r.buy_price) || 0,
    sell_price: r => Number(r.sell_price) || 0,
  })

  if (loading) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" placeholder="Пошук товару або артикулу…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 260px', maxWidth: 400 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><input type="checkbox" checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)} /> Тільки з залишком</label>
        <span style={{ marginLeft: 'auto', color: 'var(--text2)', fontSize: 13 }}>{filtered.length} товарів · вартість запасу ≈ {fmtInt(totalValue)} грн</span>
      </div>
      <div className="card">
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead><tr>
              <SortTh label="Товар" k="name" sort={sort} onSort={onSort} />
              <SortTh label="Артикул" k="sku" sort={sort} onSort={onSort} />
              <SortTh label="Залишок" k="computed_stock" sort={sort} onSort={onSort} align="right" />
              <SortTh label="Закупівля" k="buy_price" sort={sort} onSort={onSort} align="right" />
              <SortTh label="Продаж" k="sell_price" sort={sort} onSort={onSort} align="right" />
            </tr></thead>
            <tbody>
              {view.map(r => {
                const stock = Number(r.computed_stock) || 0
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(r)}>
                    <td><div className="trunc" style={{ fontWeight: 500 }}>{r.name}</div></td>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>{r.sku || '—'}</td>
                    <td style={{ textAlign: 'right', color: stock > 0 ? 'var(--text)' : 'var(--text3)', fontWeight: stock > 0 ? 600 : 400 }}>{fmt(stock)} {r.unit}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{r.buy_price ? fmt(r.buy_price) : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{r.sell_price ? fmt(r.sell_price) : '—'}</td>
                  </tr>
                )
              })}
              {view.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Нічого не знайдено</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {detail && <ProductModal product={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function ProductModal({ product, onClose }) {
  const { user } = useUser()
  const [aliases, setAliases] = useState([])
  const [movs, setMovs] = useState([])
  const [openDoc, setOpenDoc] = useState(null)
  useEffect(() => {
    supabase.from('product_aliases').select('alias').eq('product_id', product.id).then(({ data }) => setAliases(data || []))
    supabase.from('stock_movements').select(`id, type, quantity, cost_price, date, description, document_id, ${DOC_EMBED}`).eq('product_id', product.id).order('date', { ascending: false }).limit(50).then(({ data }) => setMovs(data || []))
  }, [product.id])
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>{product.name}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="kpi-label">Залишок</div><div className="kpi-value">{fmt(product.computed_stock)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>{product.unit}</span></div></div>
          <div className="kpi"><div className="kpi-label">Надійшло / Вибуло</div><div className="kpi-value" style={{ fontSize: 18 }}>{fmt(product.total_in)} / {fmt(product.total_out)}</div></div>
          <div className="kpi"><div className="kpi-label">Артикул</div><div className="kpi-value" style={{ fontSize: 16 }}>{product.sku || '—'}</div></div>
        </div>
        {aliases.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Синоніми ({aliases.length})</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{aliases.slice(0, 20).map((a, i) => <span key={i} style={{ background: 'var(--surface2)', borderRadius: 6, padding: '2px 8px', fontSize: 12 }}>{a.alias}</span>)}</div>
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Рухи</div>
        <div className="tbl-wrap" style={{ border: 'none', maxHeight: 300, overflowY: 'auto' }}>
          <table><thead><tr><th>Дата</th><th>Тип</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Собівартість</th><th>Опис</th><th>Документ</th></tr></thead>
            <tbody>{movs.map(m => <tr key={m.id}><td style={{ fontSize: 12 }}>{m.date}</td><td>{m.type === 'in' ? 'Прихід' : m.type === 'out' ? 'Видаток' : m.type}</td><td style={{ textAlign: 'right' }}>{fmt(m.quantity)}</td><td style={{ textAlign: 'right' }}>{m.cost_price ? fmt(m.cost_price) : '—'}</td><td><div className="trunc">{m.description}</div></td>
              <td>{m.documents
                ? <a onClick={() => setOpenDoc(m.documents)} style={{ color: 'var(--blue)', cursor: 'pointer', fontSize: 12 }}><i className="ti ti-file" /> {getDocType(m.documents.type)?.label || 'документ'}</a>
                : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => setOpenDoc(null)} />}
    </div>
  )
}

// ───────── Рухи ─────────
function MovementsTab() {
  const { user } = useUser()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('all')
  const [openDoc, setOpenDoc] = useState(null)
  useEffect(() => {
    setLoading(true)
    let qb = supabase.from('stock_movements').select(`id, type, quantity, cost_price, total, date, description, source, document_id, products(name), ${DOC_EMBED}`).order('date', { ascending: false }).limit(500)
    if (type !== 'all') qb = qb.eq('type', type)
    qb.then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [type])
  const { sort, onSort, sorted } = useSort('date', 'desc')
  const view = sorted(rows, {
    product: m => m.products?.name || '',
    quantity: m => Number(m.quantity) || 0,
    cost_price: m => Number(m.cost_price) || 0,
  })
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <select className="form-input" value={type} onChange={e => setType(e.target.value)} style={{ width: 180 }}>
          <option value="all">Всі рухи</option><option value="in">Прихід</option><option value="out">Видаток</option><option value="adjustment">Коригування</option>
        </select>
      </div>
      <div className="card">
        {loading ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <SortTh label="Дата" k="date" sort={sort} onSort={onSort} />
                <SortTh label="Товар" k="product" sort={sort} onSort={onSort} />
                <SortTh label="Тип" k="type" sort={sort} onSort={onSort} />
                <SortTh label="К-сть" k="quantity" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Собівартість" k="cost_price" sort={sort} onSort={onSort} align="right" />
                <th>Джерело</th>
              </tr></thead>
              <tbody>
                {view.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{m.date}</td>
                    <td><div className="trunc">{m.products?.name || '—'}</div></td>
                    <td><span style={{ color: m.type === 'in' ? 'var(--green)' : 'var(--red)', fontSize: 12, fontWeight: 600 }}>{m.type === 'in' ? 'Прихід' : m.type === 'out' ? 'Видаток' : m.type}</span></td>
                    <td style={{ textAlign: 'right' }}>{fmt(m.quantity)}</td>
                    <td style={{ textAlign: 'right' }}>{m.cost_price ? fmt(m.cost_price) : '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {m.documents
                        ? <a onClick={() => setOpenDoc(m.documents)} style={{ color: 'var(--blue)', cursor: 'pointer' }} title={m.documents.file_name}><i className="ti ti-file" /> {getDocType(m.documents.type)?.label || 'документ'}</a>
                        : <span style={{ color: 'var(--text3)' }}>{m.source || '—'}</span>}
                    </td>
                  </tr>
                ))}
                {view.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Рухів немає</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => setOpenDoc(null)} />}
    </div>
  )
}

// ───────── Збірки ─────────
function AssembliesTab() {
  const { user } = useUser()
  const [rows, setRows] = useState([])
  const [showNew, setShowNew] = useState(false)
  const load = () => supabase.from('assemblies').select('id, name, quantity, total_cost, assembled_at, products(name)').order('assembled_at', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><i className="ti ti-plus" /> Нова збірка</button>
      </div>
      <div className="card">
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead><tr><th>Виріб</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Собівартість</th><th style={{ textAlign: 'right' }}>За од.</th><th>Дата</th></tr></thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}><td><div className="trunc" style={{ fontWeight: 500 }}>{a.products?.name || a.name}</div></td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.quantity)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.total_cost)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{a.quantity ? fmt(a.total_cost / a.quantity) : '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{a.assembled_at}</td></tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Збірок немає</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {showNew && <NewAssemblyModal user={user} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} />}
    </div>
  )
}

function NewAssemblyModal({ user, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [stock, setStock] = useState([])
  const [components, setComponents] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('product_stock').select('id, name, unit, computed_stock').gt('computed_stock', 0).order('name').limit(1000).then(({ data }) => setStock(data || []))
  }, [])

  const addComp = (p) => {
    if (components.find(c => c.productId === p.id)) return
    setComponents(cs => [...cs, { productId: p.id, productName: p.name, unit: p.unit, available: p.computed_stock, qty: 1 }])
    setQ('')
  }
  const setQty = (id, qty) => setComponents(cs => cs.map(c => c.productId === id ? { ...c, qty } : c))
  const remove = (id) => setComponents(cs => cs.filter(c => c.productId !== id))

  const save = async () => {
    if (!name.trim()) { setError('Вкажіть назву виробу'); return }
    if (!components.length) { setError('Додайте компоненти'); return }
    setBusy(true); setError(null)
    const res = await assembleProduct({
      name: name.trim(), quantity: Number(quantity) || 1,
      components: components.map(c => ({ productId: c.productId, productName: c.productName, qty: Number(c.qty) || 0 })),
      userId: user?.id,
    })
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    onSaved()
  }

  const matches = q.trim().length >= 2 ? stock.filter(s => s.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>Нова збірка</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="form-group full"><label>Назва готового виробу</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="form-group"><label>Кількість</label><input className="form-input" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Компоненти зі складу</div>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input className="form-input" placeholder="Знайти товар…" value={q} onChange={e => setQ(e.target.value)} />
          {matches.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 10, maxHeight: 220, overflowY: 'auto' }}>
              {matches.map(m => (
                <div key={m.id} onClick={() => addComp(m)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                  {m.name} <span style={{ color: 'var(--text3)' }}>· залишок {fmt(m.computed_stock)} {m.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {components.map(c => (
          <div key={c.productId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}><div className="trunc">{c.productName}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>залишок {fmt(c.available)} {c.unit}</div></div>
            <input className="form-input" type="number" value={c.qty} onChange={e => setQty(c.productId, e.target.value)} style={{ width: 90 }} />
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>×{quantity}</span>
            <button className="btn" onClick={() => remove(c.productId)} style={{ padding: '2px 8px' }}><i className="ti ti-x" /></button>
          </div>
        ))}

        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Зібрати'}</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>Система спише компоненти за FIFO-собівартістю і оприбуткує готовий виріб.</p>
      </div>
    </div>
  )
}

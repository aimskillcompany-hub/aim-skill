import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { assembleProduct, getAssembly, deleteAssembly, editAssembly } from '../lib/stockService'
import { getDocType } from '../lib/docgen'
import DocModal from '../components/DocModal'
import { useSort, SortTh } from '../components/Sort'

// поля документа-джерела, потрібні для модалки DocModal
const DOC_EMBED = 'documents(id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, contractors(name))'
const SRC_LABEL = { document: 'з документа', manual: 'вручну', assembly: 'збірка', auto: 'авто' }
const srcLabel = (s) => SRC_LABEL[s] || s || '—'

export default function Warehouse() {
  const [tab, setTab] = useState('goods')
  return (
    <div>
      <div className="page-header"><h1>Склад</h1></div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {[['goods', 'Товари', 'ti-package'], ['services', 'Послуги', 'ti-briefcase'], ['consumables', 'Розхідні матеріали', 'ti-paper-bag'], ['movements', 'Рухи', 'ti-arrows-up-down'], ['assemblies', 'Збірки', 'ti-tool']].map(([id, lbl, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}><i className={`ti ${icon}`} style={{ fontSize: 15 }} />{lbl}</button>
        ))}
      </div>
      {tab === 'goods' && <StockTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'consumables' && <ConsumablesTab />}
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
  const [cat, setCat] = useState('')        // фільтр за категорією ('' = всі, '__none__' = без категорії)
  const [grouped, setGrouped] = useState(false)
  const [sel, setSel] = useState(() => new Set()) // обрані товари для масового присвоєння
  const [bulkCat, setBulkCat] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('product_stock')
      .select('id, name, sku, unit, category, buy_price, sell_price, computed_stock, total_in, total_out')
      .eq('status', 'active').eq('product_type', 'goods').order('name').limit(2000)
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const categories = useMemo(() => {
    const set = new Set()
    rows.forEach(r => { const c = (r.category || '').trim(); if (c) set.add(c) })
    return [...set].sort((a, b) => a.localeCompare(b, 'uk'))
  }, [rows])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r => {
      if (onlyStock && (Number(r.computed_stock) || 0) <= 0) return false
      if (cat === '__none__' && (r.category || '').trim()) return false
      if (cat && cat !== '__none__' && (r.category || '').trim() !== cat) return false
      if (!t) return true
      return (r.name || '').toLowerCase().includes(t) || (r.sku || '').toLowerCase().includes(t)
    })
  }, [rows, q, onlyStock, cat])

  const totalValue = useMemo(() => filtered.reduce((s, r) => s + (Number(r.computed_stock) || 0) * (Number(r.buy_price) || 0), 0), [filtered])
  const { sort, onSort, sorted } = useSort('name', 'asc')
  const view = sorted(filtered, {
    computed_stock: r => Number(r.computed_stock) || 0,
    buy_price: r => Number(r.buy_price) || 0,
    sell_price: r => Number(r.sell_price) || 0,
  })

  // Групування за категорією (для режиму «Групувати»)
  const groups = useMemo(() => {
    if (!grouped) return null
    const map = new Map()
    for (const r of view) {
      const key = (r.category || '').trim() || '__none__'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    const arr = [...map.entries()].map(([key, items]) => ({
      key,
      label: key === '__none__' ? 'Без категорії' : key,
      items,
      value: items.reduce((s, r) => s + (Number(r.computed_stock) || 0) * (Number(r.buy_price) || 0), 0),
    }))
    arr.sort((a, b) => a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.label.localeCompare(b.label, 'uk'))
    return arr
  }, [grouped, view])

  const toggleSel = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allVisibleSelected = view.length > 0 && view.every(r => sel.has(r.id))
  const toggleAll = () => setSel(s => {
    const n = new Set(s)
    if (allVisibleSelected) view.forEach(r => n.delete(r.id))
    else view.forEach(r => n.add(r.id))
    return n
  })
  const assignBulk = async () => {
    if (!sel.size) return
    setBulkBusy(true)
    const val = bulkCat.trim() || null
    await supabase.from('products').update({ category: val }).in('id', [...sel])
    setSel(new Set()); setBulkCat(''); setBulkBusy(false)
    load()
  }

  const renderRow = (r) => {
    const stock = Number(r.computed_stock) || 0
    const stockColor = stock > 0 ? 'var(--green)' : stock < 0 ? 'var(--red)' : 'var(--text3)'
    return (
      <tr key={r.id} style={{ cursor: 'pointer', background: sel.has(r.id) ? 'var(--surface2)' : undefined }} onClick={() => setDetail(r)}>
        <td style={{ width: 34 }} onClick={e => { e.stopPropagation(); toggleSel(r.id) }}>
          <input type="checkbox" checked={sel.has(r.id)} onChange={() => {}} style={{ display: 'block' }} />
        </td>
        <td><div className="trunc" style={{ fontWeight: 500 }}>{r.name}</div></td>
        <td style={{ color: 'var(--text2)', fontSize: 12 }}>{r.sku || '—'}</td>
        <td style={{ textAlign: 'right', color: stockColor, fontWeight: stock !== 0 ? 600 : 400 }}>{fmt(stock)} {r.unit}</td>
        <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{r.buy_price ? fmt(r.buy_price) : '—'}</td>
        <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{r.sell_price ? fmt(r.sell_price) : '—'}</td>
      </tr>
    )
  }

  if (loading) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" placeholder="Пошук товару або артикулу…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 220px', maxWidth: 360 }} />
        <select className="form-input" value={cat} onChange={e => setCat(e.target.value)} style={{ width: 200 }}>
          <option value="">Усі категорії</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
          <option value="__none__">Без категорії</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} /> Групувати</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><input type="checkbox" checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)} /> Тільки з залишком</label>
        <span style={{ marginLeft: 'auto', color: 'var(--text2)', fontSize: 13 }}>{filtered.length} товарів · вартість запасу ≈ {fmtInt(totalValue)} грн</span>
      </div>
      {sel.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Обрано: {sel.size}</span>
          <input className="form-input" list="wh-categories-bulk" placeholder="Категорія для обраних" value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={{ flex: '1 1 220px', maxWidth: 320 }} />
          <datalist id="wh-categories-bulk">{categories.map(c => <option key={c} value={c} />)}</datalist>
          <button className="btn btn-primary" onClick={assignBulk} disabled={bulkBusy || !bulkCat.trim()}>{bulkBusy ? '…' : 'Присвоїти категорію'}</button>
          <button className="btn" onClick={assignBulk} disabled={bulkBusy || !!bulkCat.trim()} title="Очистити категорію в обраних">Очистити</button>
          <button className="btn" onClick={() => setSel(new Set())}>Зняти виділення</button>
        </div>
      )}
      <div className="card">
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead><tr>
              <th style={{ width: 34 }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="Виділити всі видимі" /></th>
              <SortTh label="Товар" k="name" sort={sort} onSort={onSort} />
              <SortTh label="Артикул" k="sku" sort={sort} onSort={onSort} />
              <SortTh label="Залишок" k="computed_stock" sort={sort} onSort={onSort} align="right" />
              <SortTh label="Закупівля" k="buy_price" sort={sort} onSort={onSort} align="right" />
              <SortTh label="Продаж" k="sell_price" sort={sort} onSort={onSort} align="right" />
            </tr></thead>
            <tbody>
              {!grouped && view.map(renderRow)}
              {grouped && groups.map(g => (
                <Fragment key={g.key}>
                  <tr style={{ background: 'var(--surface2)' }}>
                    <td colSpan={3} style={{ fontWeight: 700 }}>{g.label} <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 12 }}>· {g.items.length}</span></td>
                    <td colSpan={3} style={{ textAlign: 'right', color: 'var(--text3)', fontSize: 12 }}>запас ≈ {fmtInt(g.value)} грн</td>
                  </tr>
                  {g.items.map(renderRow)}
                </Fragment>
              ))}
              {view.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Нічого не знайдено</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {detail && <ProductModal product={detail} onClose={() => { setDetail(null); load() }} />}
    </div>
  )
}

// ───────── Послуги (без залишків: к-сть + вартість, вхідні/вихідні) ─────────
function ServicesTab() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState(null)

  const load = async () => {
    const { data: prods } = await supabase.from('product_stock')
      .select('id, name, category').eq('status', 'active').eq('product_type', 'service').order('name').limit(2000)
    const ids = (prods || []).map(p => p.id)
    let movs = []
    if (ids.length) {
      const { data } = await supabase.from('stock_movements').select('product_id, type, quantity, total').in('product_id', ids)
      movs = data || []
    }
    const agg = {}
    movs.forEach(m => {
      const a = (agg[m.product_id] ||= { inQty: 0, inVal: 0, outQty: 0, outVal: 0 })
      const qn = Number(m.quantity) || 0, t = Number(m.total) || 0
      if (m.type === 'in') { a.inQty += qn; a.inVal += t } else if (m.type === 'out') { a.outQty += qn; a.outVal += t }
    })
    setRows((prods || []).map(p => ({ ...p, ...(agg[p.id] || { inQty: 0, inVal: 0, outQty: 0, outVal: 0 }) })))
  }
  useEffect(() => { load() }, [])

  if (!rows) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  const t = q.trim().toLowerCase()
  const flt = rows.filter(r => !t || (r.name || '').toLowerCase().includes(t))
  const out = flt.filter(r => r.outQty > 0 || r.outVal > 0)
  const inc = flt.filter(r => r.inQty > 0 || r.inVal > 0)
  const both = flt.filter(r => !(r.outQty || r.outVal) && !(r.inQty || r.inVal)) // ще без операцій

  const Section = ({ title, list, qtyKey, valKey, color }) => (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{title}</div>
        <div style={{ fontSize: 13, color }}>{fmtInt(list.reduce((s, r) => s + r[valKey], 0))} грн</div>
      </div>
      {list.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Немає операцій.</p> : (
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead><tr><th>Послуга</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Загальна вартість</th></tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(r)}>
                  <td><div className="trunc" style={{ fontWeight: 500 }}>{r.name}</div>{r.category && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.category}</div>}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r[qtyKey])}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color }}>{fmtInt(r[valKey])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <div>
      <input className="form-input" placeholder="Пошук послуги…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 360, marginBottom: 14 }} />
      <Section title="Вихідні послуги (надаємо)" list={out} qtyKey="outQty" valKey="outVal" color="var(--green)" />
      <Section title="Вхідні послуги (отримуємо)" list={inc} qtyKey="inQty" valKey="inVal" color="var(--red)" />
      {both.length > 0 && (
        <div className="card">
          <div className="card-title">Без операцій ({both.length})</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {both.map(r => <span key={r.id} onClick={() => setDetail(r)} style={{ background: 'var(--surface2)', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>{r.name}</span>)}
          </div>
        </div>
      )}
      {detail && <ProductModal product={detail} onClose={() => { setDetail(null); load() }} />}
    </div>
  )
}

// ───────── Розхідні матеріали (придбано/списано/залишок + списання) ─────────
function ConsumablesTab() {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [consume, setConsume] = useState(null)
  const [detail, setDetail] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('product_stock')
      .select('id, name, unit, computed_stock, total_in, total_out').eq('status', 'active').eq('product_type', 'expense').order('name').limit(2000)
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  if (!rows) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  const t = q.trim().toLowerCase()
  const view = rows.filter(r => !t || (r.name || '').toLowerCase().includes(t))

  return (
    <div>
      <input className="form-input" placeholder="Пошук матеріалу…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 360, marginBottom: 14 }} />
      <div className="card">
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead><tr><th>Матеріал</th><th style={{ textAlign: 'right' }}>Придбано</th><th style={{ textAlign: 'right' }}>Списано</th><th style={{ textAlign: 'right' }}>Залишок</th><th /></tr></thead>
            <tbody>
              {view.map(r => {
                const bal = Number(r.computed_stock) || 0
                const c = bal > 0 ? 'var(--green)' : bal < 0 ? 'var(--red)' : 'var(--text3)'
                return (
                  <tr key={r.id}>
                    <td onClick={() => setDetail(r)} style={{ cursor: 'pointer' }}><div className="trunc" style={{ fontWeight: 500, color: 'var(--blue)' }}>{r.name}</div></td>
                    <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{fmt(r.total_in)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{fmt(r.total_out)}</td>
                    <td style={{ textAlign: 'right', color: c, fontWeight: 600 }}>{fmt(bal)} {r.unit}</td>
                    <td style={{ textAlign: 'right' }}><button className="btn" onClick={() => setConsume(r)} title="Списати"><i className="ti ti-minus" /> Списати</button></td>
                  </tr>
                )
              })}
              {view.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Немає розхідних матеріалів</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {consume && <ConsumeModal product={consume} user={user} onClose={() => setConsume(null)} onDone={() => { setConsume(null); load() }} />}
      {detail && <ProductModal product={detail} onClose={() => { setDetail(null); load() }} />}
    </div>
  )
}

function ConsumeModal({ product, user, onClose, onDone }) {
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const save = async () => {
    const q = Number(qty) || 0
    if (q <= 0) { setErr('Вкажіть кількість'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('stock_movements').insert({
      product_id: product.id, type: 'out', quantity: q, date,
      source: 'manual', description: note.trim() || `Списання: ${product.name}`.slice(0, 200), created_by: user?.id || null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Списати матеріал</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{product.name} · залишок {fmt(product.computed_stock)} {product.unit}</div>
        <div className="form-grid">
          <div className="form-group"><label>Кількість *</label><input className="form-input" type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} autoFocus /></div>
          <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="form-group full"><label>Примітка</label><input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="напр. видано в офіс" /></div>
        </div>
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Списати'}</button>
        </div>
      </div>
    </div>
  )
}

const PRODUCT_TYPES = [['goods', 'Товар'], ['service', 'Послуга'], ['expense', 'Розхідний матеріал']]

function ProductModal({ product, onClose }) {
  const { user } = useUser()
  const [aliases, setAliases] = useState([])
  const [movs, setMovs] = useState([])
  const [openDoc, setOpenDoc] = useState(null)
  const [linkMov, setLinkMov] = useState(null)
  const [allCats, setAllCats] = useState([])
  const [form, setForm] = useState(null)
  const [orig, setOrig] = useState(null)
  const [stock, setStock] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const loadMovs = () => supabase.from('stock_movements').select(`id, type, quantity, cost_price, date, description, source, document_id, ${DOC_EMBED}`).eq('product_id', product.id).order('date', { ascending: false }).limit(50).then(({ data }) => setMovs(data || []))
  useEffect(() => {
    supabase.from('product_stock').select('computed_stock, total_in, total_out, unit, product_type').eq('id', product.id).maybeSingle().then(({ data }) => setStock(data))
    supabase.from('product_aliases').select('alias').eq('product_id', product.id).then(({ data }) => setAliases(data || []))
    supabase.from('products').select('category').not('category', 'is', null).then(({ data }) => {
      setAllCats([...new Set((data || []).map(d => (d.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk')))
    })
    supabase.from('products').select('id, name, sku, unit, category, product_type, buy_price, sell_price, min_stock').eq('id', product.id).single().then(({ data }) => {
      if (data) { setForm(data); setOrig(data) }
    })
    loadMovs()
  }, [product.id])

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const dirty = form && orig && JSON.stringify(form) !== JSON.stringify(orig)

  const save = async () => {
    if (!form.name?.trim()) { setErr('Вкажіть назву'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('products').update({
      name: form.name.trim(), sku: form.sku?.trim() || null, unit: form.unit?.trim() || 'шт',
      category: form.category?.trim() || null, product_type: form.product_type,
      buy_price: form.buy_price === '' ? null : Number(form.buy_price), sell_price: form.sell_price === '' ? null : Number(form.sell_price),
      min_stock: form.min_stock === '' ? null : Number(form.min_stock),
    }).eq('id', product.id)
    setBusy(false)
    if (error) { setErr('Помилка збереження: ' + error.message); return }
    onClose()
  }

  const archive = async () => {
    if (!confirm('Архівувати? Зникне зі списків складу, історія рухів збережеться.')) return
    setBusy(true)
    await supabase.from('products').update({ status: 'archived' }).eq('id', product.id)
    setBusy(false); onClose()
  }

  const del = async () => {
    const { count } = await supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('product_id', product.id)
    if (count > 0) {
      alert(`Не можна видалити: є ${count} складських рухів (історія). Скористайтесь «Архівувати».`)
      return
    }
    if (!confirm('Видалити безповоротно? Дію не можна скасувати.')) return
    setBusy(true)
    const { error } = await supabase.from('products').delete().eq('id', product.id)
    setBusy(false)
    if (error) { setErr('Не вдалося видалити: ' + error.message + '. Спробуйте «Архівувати».'); return }
    onClose()
  }

  const linkDoc = async (docId) => {
    await supabase.from('stock_movements').update({ document_id: docId, source: 'document' }).eq('id', linkMov.id)
    setLinkMov(null); loadMovs()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>{form?.name || product.name}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          {(form?.product_type || stock?.product_type) === 'service'
            ? <div className="kpi"><div className="kpi-label">Послуга</div><div className="kpi-value" style={{ fontSize: 16 }}>без залишку</div></div>
            : <div className="kpi"><div className="kpi-label">Залишок</div><div className="kpi-value" style={{ color: (Number(stock?.computed_stock) || 0) > 0 ? 'var(--green)' : (Number(stock?.computed_stock) || 0) < 0 ? 'var(--red)' : 'var(--text3)' }}>{fmt(stock?.computed_stock || 0)} <span style={{ fontSize: 13, color: 'var(--text3)' }}>{stock?.unit}</span></div></div>}
          <div className="kpi"><div className="kpi-label">Надійшло / Вибуло</div><div className="kpi-value" style={{ fontSize: 18 }}>{fmt(stock?.total_in || 0)} / {fmt(stock?.total_out || 0)}</div></div>
          <div className="kpi"><div className="kpi-label">Рухів</div><div className="kpi-value" style={{ fontSize: 18 }}>{movs.length}</div></div>
        </div>

        {!form ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : (
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div className="form-group full"><label>Назва *</label><input className="form-input" value={form.name || ''} onChange={e => setF('name', e.target.value)} /></div>
            <div className="form-group"><label>Тип</label>
              <select className="form-input" value={form.product_type || 'goods'} onChange={e => setF('product_type', e.target.value)}>
                {PRODUCT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Артикул</label><input className="form-input" value={form.sku || ''} onChange={e => setF('sku', e.target.value)} /></div>
            <div className="form-group"><label>Категорія</label>
              <input className="form-input" list="wh-categories" value={form.category || ''} onChange={e => setF('category', e.target.value)} />
              <datalist id="wh-categories">{allCats.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="form-group"><label>Одиниця</label><input className="form-input" value={form.unit || ''} onChange={e => setF('unit', e.target.value)} /></div>
            <div className="form-group"><label>Ціна закупівлі</label><input className="form-input" type="number" step="any" value={form.buy_price ?? ''} onChange={e => setF('buy_price', e.target.value)} /></div>
            <div className="form-group"><label>Ціна продажу</label><input className="form-input" type="number" step="any" value={form.sell_price ?? ''} onChange={e => setF('sell_price', e.target.value)} /></div>
            <div className="form-group"><label>Мін. залишок</label><input className="form-input" type="number" step="any" value={form.min_stock ?? ''} onChange={e => setF('min_stock', e.target.value)} /></div>
          </div>
        )}

        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={archive} disabled={busy} style={{ color: 'var(--text2)' }}><i className="ti ti-archive" /> Архівувати</button>
            <button className="btn" onClick={del} disabled={busy} style={{ color: 'var(--red)' }}><i className="ti ti-trash" /> Видалити</button>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? '…' : 'Зберегти зміни'}</button>
        </div>

        {aliases.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Синоніми ({aliases.length})</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{aliases.slice(0, 20).map((a, i) => <span key={i} style={{ background: 'var(--surface2)', borderRadius: 6, padding: '2px 8px', fontSize: 12 }}>{a.alias}</span>)}</div>
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Рухи</div>
        <div className="tbl-wrap" style={{ border: 'none', maxHeight: 280, overflowY: 'auto' }}>
          <table><thead><tr><th>Дата</th><th>Тип</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Собівартість</th><th>Опис</th><th>Документ</th></tr></thead>
            <tbody>{movs.map(m => <tr key={m.id}><td style={{ fontSize: 12 }}>{m.date}</td><td>{m.type === 'in' ? 'Прихід' : m.type === 'out' ? 'Видаток' : m.type}</td><td style={{ textAlign: 'right' }}>{fmt(m.quantity)}</td><td style={{ textAlign: 'right' }}>{m.cost_price ? fmt(m.cost_price) : '—'}</td><td><div className="trunc">{m.description}</div></td>
              <td>{m.documents
                ? <a onClick={() => setOpenDoc(m.documents)} style={{ color: 'var(--blue)', cursor: 'pointer', fontSize: 12 }}><i className="ti ti-file" /> {getDocType(m.documents.type)?.label || 'документ'}</a>
                : <span style={{ color: 'var(--text3)', fontSize: 12 }}>{srcLabel(m.source)} <button className="btn" onClick={() => setLinkMov(m)} title="Прив'язати документ" style={{ padding: '0 6px' }}><i className="ti ti-link" /></button></span>}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => setOpenDoc(null)} />}
      {linkMov && <DocPickerModal title="Прив'язати документ до руху" match={{ date: linkMov.date }} onClose={() => setLinkMov(null)} onPick={linkDoc} />}
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
  const [linkMov, setLinkMov] = useState(null)
  const load = () => {
    setLoading(true)
    let qb = supabase.from('stock_movements').select(`id, type, quantity, cost_price, total, date, description, source, document_id, products(name), ${DOC_EMBED}`).order('date', { ascending: false }).limit(500)
    if (type !== 'all') qb = qb.eq('type', type)
    qb.then(({ data }) => { setRows(data || []); setLoading(false) })
  }
  useEffect(() => { load() }, [type])
  const linkDoc = async (docId) => {
    await supabase.from('stock_movements').update({ document_id: docId, source: 'document' }).eq('id', linkMov.id)
    setLinkMov(null); load()
  }
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
                        : <span style={{ color: 'var(--text3)' }}>{srcLabel(m.source)} <button className="btn" onClick={() => setLinkMov(m)} title="Прив'язати документ" style={{ padding: '0 6px', marginLeft: 4 }}><i className="ti ti-link" /></button></span>}
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
      {linkMov && <DocPickerModal title="Прив'язати документ до руху" match={{ date: linkMov.date }} onClose={() => setLinkMov(null)} onPick={linkDoc} />}
    </div>
  )
}

// ───────── Вибір документа для прив'язки (рекомендація за датою руху) ─────────
function DocPickerModal({ title, match, onClose, onPick }) {
  const [q, setQ] = useState('')
  const [docs, setDocs] = useState([])
  const movDate = match?.date || null
  useEffect(() => {
    const t = setTimeout(async () => {
      let qb = supabase.from('documents').select('id, type, file_name, amount, doc_date, created_at, contractors(name)').limit(120)
      const term = q.trim()
      if (term) { const e = term.replace(/[%,()]/g, ' '); qb = qb.or(`file_name.ilike.%${e}%,doc_number.ilike.%${e}%`).order('created_at', { ascending: false }) }
      else if (movDate) { const d = new Date(movDate); const lo = new Date(d - 45 * 864e5).toISOString().slice(0, 10); const hi = new Date(+d + 45 * 864e5).toISOString().slice(0, 10); qb = qb.gte('doc_date', lo).lte('doc_date', hi).order('doc_date', { ascending: false }) }
      else qb = qb.order('created_at', { ascending: false }).limit(50)
      const { data } = await qb
      setDocs(data || [])
    }, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, movDate])

  const ranked = useMemo(() => {
    const md = movDate ? new Date(movDate) : null
    return docs.map(d => {
      const dd = d.doc_date || null
      const days = md && dd ? Math.round(Math.abs((md - new Date(dd)) / 864e5)) : null
      return { d, days, rec: days != null && days <= 15 }
    }).sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
  }, [docs, movDate])

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>{title || 'Оберіть документ'}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        {movDate && <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>Дата руху: <b>{movDate}</b> — рекомендовано документи з близькою датою.</div>}
        <input className="form-input" placeholder="Пошук за назвою або номером…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} autoFocus />
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {ranked.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Нічого не знайдено.</p>}
          {ranked.map(({ d, days, rec }) => (
            <div key={d.id} onClick={() => onPick(d.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, background: rec ? 'var(--green-bg)' : undefined }}>
              <div style={{ flex: 1 }}>
                <div className="trunc">{getDocType(d.type)?.label || d.type || 'документ'}{d.file_name ? ` · ${d.file_name}` : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {d.contractors?.name || ''} {d.doc_date ? `· ${d.doc_date}` : ''}
                  {rec && <span style={{ background: 'var(--green-bg)', color: 'var(--green)', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>рекомендовано · дата ±{days}дн</span>}
                  {!rec && days != null && <span style={{ color: 'var(--text3)' }}>±{days}дн</span>}
                </div>
              </div>
              <span style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>{d.amount ? fmt(d.amount) + ' грн' : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ───────── Збірки ─────────
function AssembliesTab() {
  const { user } = useUser()
  const [rows, setRows] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null)
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
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(a)}><td><div className="trunc" style={{ fontWeight: 500 }}>{a.products?.name || a.name}</div></td>
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
      {detail && <AssemblyDetailModal id={detail.id} user={user} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); load() }} />}
    </div>
  )
}

// Перегляд/редагування/видалення збірки
function AssemblyDetailModal({ id, user, onClose, onChanged }) {
  const [a, setA] = useState(null)
  const [edit, setEdit] = useState(false)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [comps, setComps] = useState([])       // { productId, productName, unit, qty } — qty ЗА ОДИНИЦЮ виробу
  const [stock, setStock] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getAssembly(id).then(data => {
      if (!data) { setErr('Збірку не знайдено'); return }
      setA(data)
      const qy = Number(data.quantity) || 1
      setName(data.name || data.products?.name || '')
      setQuantity(qy)
      setDate(data.assembled_at || '')
      setNotes(data.notes || '')
      setComps((data.items || []).map(it => ({
        productId: it.product_id, productName: it.products?.name || '', unit: it.products?.unit || 'шт',
        qty: qy ? (Number(it.quantity) || 0) / qy : Number(it.quantity) || 0,
      })))
    })
    supabase.from('product_stock').select('id, name, unit, computed_stock').gt('computed_stock', 0).order('name').limit(1000).then(({ data }) => setStock(data || []))
  }, [id])

  const addComp = (p) => { if (!comps.find(c => c.productId === p.id)) setComps(cs => [...cs, { productId: p.id, productName: p.name, unit: p.unit, qty: 1 }]); setQ('') }
  const setQty = (pid, v) => setComps(cs => cs.map(c => c.productId === pid ? { ...c, qty: v } : c))
  const removeComp = (pid) => setComps(cs => cs.filter(c => c.productId !== pid))

  const save = async () => {
    if (!name.trim()) { setErr('Вкажіть назву'); return }
    if (!comps.length) { setErr('Додайте компоненти'); return }
    setBusy(true); setErr(null)
    const res = await editAssembly(id, { name: name.trim(), quantity: Number(quantity) || 1, components: comps.map(c => ({ productId: c.productId, productName: c.productName, qty: Number(c.qty) || 0 })), date, notes, userId: user?.id })
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    onChanged()
  }

  const del = async () => {
    if (!confirm('Видалити збірку? Компоненти повернуться на склад, виріб — знімається. Дію не можна скасувати.')) return
    setBusy(true)
    const res = await deleteAssembly(id)
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    onChanged()
  }

  const found = q.trim() ? stock.filter(s => (s.name || '').toLowerCase().includes(q.trim().toLowerCase()) && !comps.find(c => c.productId === s.id)).slice(0, 8) : []

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header"><h2>{a?.products?.name || a?.name || 'Збірка'}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        {!a ? <p style={{ color: 'var(--text3)' }}>{err || 'Завантаження…'}</p> : (
          <>
            {!edit ? (
              <>
                <div className="kpi-grid" style={{ marginBottom: 16 }}>
                  <div className="kpi"><div className="kpi-label">Кількість</div><div className="kpi-value" style={{ fontSize: 18 }}>{fmt(a.quantity)}</div></div>
                  <div className="kpi"><div className="kpi-label">Собівартість</div><div className="kpi-value" style={{ fontSize: 18 }}>{fmt(a.total_cost)}</div></div>
                  <div className="kpi"><div className="kpi-label">За одиницю</div><div className="kpi-value" style={{ fontSize: 18 }}>{a.quantity ? fmt(a.total_cost / a.quantity) : '—'}</div></div>
                </div>
                {a.notes && <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{a.notes}</div>}
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Складається з ({a.items.length})</div>
                <div className="tbl-wrap" style={{ border: 'none' }}>
                  <table>
                    <thead><tr><th>Компонент</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Собівартість/од</th><th style={{ textAlign: 'right' }}>Сума</th></tr></thead>
                    <tbody>
                      {a.items.map((it, i) => (
                        <tr key={i}>
                          <td><div className="trunc">{it.products?.name || '—'}</div></td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(it.quantity)} {it.products?.unit || 'шт'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{fmt(it.cost_price)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{err}</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
                  <button className="btn" onClick={del} disabled={busy} style={{ color: 'var(--red)' }}><i className="ti ti-trash" /> Видалити</button>
                  <button className="btn btn-primary" onClick={() => setEdit(true)}><i className="ti ti-edit" /> Редагувати</button>
                </div>
              </>
            ) : (
              <>
                <div className="form-grid" style={{ marginBottom: 12 }}>
                  <div className="form-group full"><label>Назва виробу</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} /></div>
                  <div className="form-group"><label>Кількість виробів</label><input className="form-input" type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
                  <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={date || ''} onChange={e => setDate(e.target.value)} /></div>
                  <div className="form-group full"><label>Примітка</label><input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} /></div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Компоненти (к-сть за 1 виріб)</div>
                <div className="tbl-wrap" style={{ border: 'none', marginBottom: 8 }}>
                  <table>
                    <thead><tr><th>Компонент</th><th style={{ width: 110, textAlign: 'right' }}>К-сть/од</th><th /></tr></thead>
                    <tbody>
                      {comps.map(c => (
                        <tr key={c.productId}>
                          <td><div className="trunc">{c.productName}</div></td>
                          <td style={{ textAlign: 'right' }}><input className="form-input" type="number" min="0" step="any" value={c.qty} onChange={e => setQty(c.productId, e.target.value)} style={{ width: 90, textAlign: 'right' }} /></td>
                          <td style={{ textAlign: 'right' }}><button className="btn" onClick={() => removeComp(c.productId)} style={{ color: 'var(--red)', padding: '2px 8px' }}><i className="ti ti-x" /></button></td>
                        </tr>
                      ))}
                      {comps.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--text3)', fontSize: 13 }}>Немає компонентів</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <input className="form-input" placeholder="Додати компонент зі складу…" value={q} onChange={e => setQ(e.target.value)} />
                  {found.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 5, maxHeight: 220, overflow: 'auto' }}>
                      {found.map(p => (
                        <div key={p.id} onClick={() => addComp(p)} style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                          {p.name} <span style={{ color: 'var(--text3)', fontSize: 11 }}>· на складі {fmt(p.computed_stock)} {p.unit}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 10 }}>Збереження перезбере виріб: старі компоненти повернуться на склад, нові — спишуться (перевіряється наявність).</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn" onClick={() => { setEdit(false); setErr(null) }}>Скасувати</button>
                  <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Зберегти зміни'}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
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

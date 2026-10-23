import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc, withCompany } from '../lib/companyScope'
import { fetchAll, fetchAllData, fetchAllIn } from '../lib/fetchAll'
import { useUser } from '../lib/auth'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { fmt, fmtInt } from '../lib/fmt'
import { resolveProduct, assembleProduct, getAssembly, deleteAssembly, editAssembly, mergeProducts } from '../lib/stockService'
import { exportAssemblyAct } from '../lib/assemblyAct'
import { getDocType } from '../lib/docgen'
import DocModal from '../components/DocModal'
import RecalcCostModal from '../components/RecalcCostModal'
import CostDiagnosticsModal from '../components/CostDiagnosticsModal'
import ProductBatches from '../components/ProductBatches'
import SplitProductModal from '../components/SplitProductModal'
import StockExcelModal from '../components/StockExcelModal'
import { loadDocFull, dmy } from '../lib/shipmentRecon'
import { loadPurchaseSummary } from '../lib/productBatches'
import { loadBatches } from '../lib/batches'
import GeneratedDocModal from '../components/GeneratedDocModal'
import { useSort, SortTh } from '../components/Sort'
import { todayKyiv } from '../lib/dates'
import { useNewUi } from '../lib/uiPrefs'
import { Button, Menu, Modal, Tabs, Switch, KpiTile, EmptyState, TableSkeleton, Callout, Segmented, useToast, InfoTip } from '../components/ui'
import { formatAmount, plural } from '../utils/format'
import './WarehouseNew.css'
const POS = ['позиція', 'позиції', 'позицій']

// Одиниця з різним написанням («ШТ», «Штука», «шт.») → канонічна; нестандартна — показуємо позначку
const UNIT_CANON = { 'шт': 'шт', 'штука': 'шт', 'штук': 'шт', 'штуки': 'шт', 'пак': 'пак', 'пакет': 'пак', 'упак': 'уп', 'упаковка': 'уп', 'уп': 'уп', 'компл': 'компл', 'комплект': 'компл' }
const canonUnit = (u) => { const k = String(u || '').trim().toLowerCase().replace(/\.$/, ''); return UNIT_CANON[k] || k }
const unitOdd = (u) => !!u && String(u).trim() !== canonUnit(u)

// поля документа-джерела, потрібні для модалки DocModal / GeneratedDocModal
const DOC_EMBED = 'documents(id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, source, generated_doc_id, contractors(name))'
const SRC_LABEL = { document: 'з документа', manual: 'вручну', assembly: 'збірка', auto: 'авто' }
const srcLabel = (s) => SRC_LABEL[s] || s || '—'

export default function Warehouse() {
  const newUi = useNewUi()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [tab, setTabState] = useState(() => params.get('tab') || 'goods')
  const setTab = (t) => { setTabState(t); setParams(t === 'goods' ? {} : { tab: t }, { replace: true }) }
  const [recalc, setRecalc] = useState(false)
  const [diag, setDiag] = useState(false)
  const [xls, setXls] = useState(false)
  const [rev, setRev] = useState(0)
  const [stats, setStats] = useState(null)      // новий інтерфейс: «N товарів у довіднику · M у наявності»
  const [newProd, setNewProd] = useState(false)
  const { user } = useUser()
  const canXls = ['admin', 'accountant'].includes(user?.role)
  if (newUi) return (
    <div className="whn">
      <div className="whn-head">
        <div><h1 className="whn-h1">Склад</h1>
          {stats && <p className="whn-sub">{stats.total} {plural(stats.total, ['товар', 'товари', 'товарів'])} у довіднику · {stats.inStock} у наявності</p>}</div>
        <div className="whn-actions">
          <Link className="btn btn-secondary whn-hide-sm" to="/inventory/recon">Звірка видаткових</Link>
          <span className="whn-hide-sm"><Menu trigger={<Button variant="secondary">Собівартість<i className="ti ti-chevron-down" aria-hidden="true" /></Button>} items={[
            { label: 'Діагностика собівартості', icon: 'ti-stethoscope', onClick: () => setDiag(true) },
            { label: 'Перерахувати за період (FIFO)', icon: 'ti-calculator', onClick: () => setRecalc(true) },
          ]} /></span>
          {canXls && <Button variant="secondary" icon="ti-file-spreadsheet" onClick={() => setXls(true)} className="whn-hide-sm">Excel</Button>}
          {user?.role !== 'viewer' && <Button variant="brand" icon="ti-plus" onClick={() => setNewProd(true)} className="whn-hide-sm">Товар</Button>}
          <span className="whn-only-sm"><Menu trigger={<Button variant="secondary" iconOnly icon="ti-dots-vertical" aria-label="Дії складу" />} items={[
            ...(user?.role !== 'viewer' ? [{ label: 'Новий товар', icon: 'ti-plus', onClick: () => setNewProd(true) }] : []),
            { label: 'Звірка видаткових', icon: 'ti-arrows-exchange', onClick: () => navigate('/inventory/recon') },
            { label: 'Діагностика собівартості', icon: 'ti-stethoscope', onClick: () => setDiag(true) },
            { label: 'Перерахувати собівартість (FIFO)', icon: 'ti-calculator', onClick: () => setRecalc(true) },
            ...(canXls ? [{ label: 'Excel: вивантажити / виправити', icon: 'ti-file-spreadsheet', onClick: () => setXls(true) }] : []),
          ]} /></span>
        </div>
      </div>
      {newProd && <NewProductModal userId={user?.id} onClose={() => setNewProd(false)} onCreated={(id) => { setNewProd(false); navigate(`/inventory/product/${id}`) }} />}
      {recalc && <RecalcCostModal onClose={() => setRecalc(false)} />}
      {diag && <CostDiagnosticsModal onClose={() => setDiag(false)} />}
      {xls && <StockExcelModal onClose={() => setXls(false)} onDone={() => { setXls(false); setRev(r => r + 1) }} />}
      {tab === 'goods' && <StockTab key={rev} newUi onStats={setStats} onExcel={canXls ? () => setXls(true) : null}
        tabs={<Tabs ariaLabel="Розділи складу" idPrefix="whn-tab" value={tab} onChange={setTab} tabs={WH_TABS} />} />}
      {tab !== 'goods' && <section className="whn-card"><Tabs ariaLabel="Розділи складу" idPrefix="whn-tab" value={tab} onChange={setTab} tabs={WH_TABS} />
        <div className="whn-pad">
          {tab === 'services' && <ServicesTab key={rev} />}
          {tab === 'consumables' && <ConsumablesTab key={rev} />}
          {tab === 'movements' && <MovementsTab />}
          {tab === 'assemblies' && <AssembliesTab />}
        </div></section>}
    </div>
  )
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h1>Склад</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" to="/inventory/recon" title="Видаткова → позиції → прихідна, з якої списано; обидва документи поруч; прив'язка, дата оприбуткування, об'єднання карток"><i className="ti ti-arrows-exchange" /> Звірка видаткових</Link>
          {['admin', 'accountant'].includes(user?.role) && <button className="btn" onClick={() => setXls(true)} title="Вивантажити рухи й картки в Excel, позначити, що куди перенести, і завантажити виправлення (з переглядом перед застосуванням)"><i className="ti ti-file-spreadsheet" /> Excel: вивантажити / виправити</button>}
          <button className="btn" onClick={() => setDiag(true)} title="Звіт зараз vs FIFO, база ПДВ партій, позиції без партій — нічого не змінює"><i className="ti ti-stethoscope" /> Діагностика собівартості</button>
          <button className="btn" onClick={() => setRecalc(true)} title="Заново розподілити відвантаження періоду по партіях (FIFO) і перезаписати собівартість"><i className="ti ti-calculator" /> Перерахувати собівартість за період</button>
        </div>
      </div>
      {recalc && <RecalcCostModal onClose={() => setRecalc(false)} />}
      {diag && <CostDiagnosticsModal onClose={() => setDiag(false)} />}
      {xls && <StockExcelModal onClose={() => setXls(false)} onDone={() => { setXls(false); setRev(r => r + 1) }} />}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {[['goods', 'Товари', 'ti-package'], ['services', 'Послуги', 'ti-briefcase'], ['consumables', 'Розхідні матеріали', 'ti-paper-bag'], ['movements', 'Рухи', 'ti-arrows-up-down'], ['assemblies', 'Збірки', 'ti-tool']].map(([id, lbl, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}><i className={`ti ${icon}`} style={{ fontSize: 15 }} />{lbl}</button>
        ))}
      </div>
      {tab === 'goods' && <StockTab key={rev} />}
      {tab === 'services' && <ServicesTab key={rev} />}
      {tab === 'consumables' && <ConsumablesTab key={rev} />}
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
const WH_TABS = [{ id: 'goods', label: 'Товари' }, { id: 'services', label: 'Послуги' }, { id: 'consumables', label: 'Розхідні матеріали' }, { id: 'movements', label: 'Рухи' }, { id: 'assemblies', label: 'Збірки' }]

// «+ Товар» (новий інтерфейс): те саме правило, що й при розпізнаванні документів — resolveProduct
// спершу шукає за артикулом / синонімом / назвою і лише тоді створює картку (дублів не плодить).
function NewProductModal({ userId, onClose, onCreated }) {
  const toast = useToast()
  const [f, setF] = useState({ name: '', sku: '', unit: 'шт' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return
    setBusy(true)
    try {
      const r = await resolveProduct(f.name, f.unit.trim() || 'шт', null, userId, f.sku)
      if (!r?.productId) throw new Error('Не вдалося створити товар')
      if (!r.isNew) toast('Такий товар уже є в довіднику — відкрито його картку')
      onCreated(r.productId)
    } catch (e) { toast(e.message, { type: 'error' }); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Новий товар" footer={<>
      <Button variant="secondary" onClick={onClose}>Скасувати</Button>
      <Button variant="brand" onClick={save} loading={busy} disabled={!f.name.trim()}>Створити</Button></>}>
      <div className="form-grid">
        <div className="form-group full"><label htmlFor="np-name">Назва<InfoTip label="Новий товар">Якщо товар із таким артикулом або назвою вже є — відкриємо наявну картку, дубль не створюється.</InfoTip></label>
          <input id="np-name" className="form-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') save() }} /></div>
        <div className="form-group"><label htmlFor="np-sku">Артикул</label>
          <input id="np-sku" className="form-input" value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} /></div>
        <div className="form-group"><label htmlFor="np-unit">Одиниця</label>
          <input id="np-unit" className="form-input" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} /></div>
      </div>
    </Modal>
  )
}

// ───────── Залишки (довідник товарів) ─────────
function StockTab({ newUi = false, tabs = null, onExcel = null, onStats = null }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [onlyStock, setOnlyStock] = useState(false)
  const openProduct = useOpenProduct()
  const [cat, setCat] = useState('')        // фільтр за категорією ('' = всі, '__none__' = без категорії)
  const [grouped, setGrouped] = useState(false)
  const [sel, setSel] = useState(() => new Set()) // обрані товари для масового присвоєння
  const [bulkCat, setBulkCat] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [quality, setQuality] = useState(null)   // новий інтерфейс: 'minus' | 'nosku' | 'unit'
  const [shown, setShown] = useState(50)

  const load = async () => {
    setLoading(true)
    // усі товари (раніше .limit(2000) мовчки обрізався сервером до 1000)
    const make = () => { let q = qc('product_stock')
      .select('id, name, sku, unit, category, buy_price, sell_price, computed_stock, total_in, total_out, status')
      .eq('product_type', 'goods'); return q }
    const { data } = await fetchAllData(make).then(r => ({ ...r, data: [...(r.data || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk')) }))
    // архівні — лише з перемикачем «Архівні»; але архівна картка з ненульовим залишком показується завжди (позначка «архів»):
    // інакше мінус від продажу з заархівованої картки ховається (ВН-0036, 23.10.2026)
    setRows((data || []).filter(r => showArchived || r.status === 'active' || r.status == null || Math.abs(Number(r.computed_stock) || 0) > 0.00001))
    setLoading(false)
  }
  useEffect(() => { load() }, [showArchived])
  // ціна по залишку = вартість партій, що лишились (найпізніші приходи), / к-сть — замість одного «buy_price»
  const [stockAt, setStockAt] = useState(null)
  useEffect(() => { const d = todayKyiv(); loadBatches(d).then(b => setStockAt(b.at(d))).catch(() => setStockAt(null)) }, [])
  const unitPrice = (r) => { const x = stockAt?.[r.id]; return x?.qty > 0 ? x.value / x.qty : Number(r.buy_price) || 0 }
  const valueOf = (r) => stockAt ? (stockAt[r.id]?.value || 0) : (Number(r.computed_stock) || 0) * (Number(r.buy_price) || 0)

  const categories = useMemo(() => {
    const set = new Set()
    rows.forEach(r => { const c = (r.category || '').trim(); if (c) set.add(c) })
    return [...set].sort((a, b) => a.localeCompare(b, 'uk'))
  }, [rows])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r => {
      if (onlyStock && (Number(r.computed_stock) || 0) <= 0) return false
      if (quality === 'minus' && !((Number(r.computed_stock) || 0) < 0)) return false
      if (quality === 'nosku' && (r.sku || '').trim()) return false
      if (quality === 'unit' && !unitOdd(r.unit)) return false
      if (cat === '__none__' && (r.category || '').trim()) return false
      if (cat && cat !== '__none__' && (r.category || '').trim() !== cat) return false
      if (!t) return true
      return (r.name || '').toLowerCase().includes(t) || (r.sku || '').toLowerCase().includes(t)
    })
  }, [rows, q, onlyStock, cat, quality])

  const totalValue = useMemo(() => filtered.reduce((s, r) => s + valueOf(r), 0), [filtered, stockAt])
  const { sort, onSort, sorted } = useSort('name', 'asc')
  const view = sorted(filtered, {
    computed_stock: r => Number(r.computed_stock) || 0,
    buy_price: r => unitPrice(r),
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
      value: items.reduce((s, r) => s + valueOf(r), 0),
    }))
    arr.sort((a, b) => a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.label.localeCompare(b.label, 'uk'))
    return arr
  }, [grouped, view, stockAt])

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
      <tr key={r.id} style={{ cursor: 'pointer', background: sel.has(r.id) ? 'var(--surface2)' : undefined }} onClick={() => openProduct(r, 'goods')}>
        <td style={{ width: 34 }} onClick={e => { e.stopPropagation(); toggleSel(r.id) }}>
          <input type="checkbox" checked={sel.has(r.id)} onChange={() => {}} style={{ display: 'block' }} />
        </td>
        <td><div className="trunc" style={{ fontWeight: 500 }}>{r.name}{r.status === 'archived' && <span style={{ fontSize: 10, color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px', marginLeft: 6 }}>архів</span>}</div></td>
        <td style={{ color: 'var(--text2)', fontSize: 12 }}>{r.sku || '—'}</td>
        <td style={{ textAlign: 'right', color: stockColor, fontWeight: stock !== 0 ? 600 : 400 }}>{fmt(stock)} {r.unit}</td>
        <td style={{ textAlign: 'right', color: 'var(--text2)' }} title="Середня ціна партій, що лишились на складі (без ПДВ)">{unitPrice(r) ? fmt(unitPrice(r)) : '—'}</td>
        <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{r.sell_price ? fmt(r.sell_price) : '—'}</td>
      </tr>
    )
  }

  const inStockN = rows.filter(r => (Number(r.computed_stock) || 0) > 0).length
  useEffect(() => { if (onStats && !loading) onStats({ total: rows.length, inStock: inStockN }) }, [rows, loading, inStockN])
  if (newUi) {
    const inStock = inStockN
    const minus = rows.filter(r => (Number(r.computed_stock) || 0) < 0).length
    const noSku = rows.filter(r => !(r.sku || '').trim()).length
    const oddUnits = rows.filter(r => unitOdd(r.unit))
    const oddSpellings = [...new Set(oddUnits.map(r => String(r.unit).trim()))].slice(0, 6)
    const page = grouped ? view : view.slice(0, shown)
    const row = (r) => {
      const stock = Number(r.computed_stock) || 0
      const up = unitPrice(r), val = valueOf(r)
      return (
        <tr key={r.id} className={sel.has(r.id) ? 'is-sel' : undefined} onClick={() => openProduct(r, 'goods')} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') openProduct(r, 'goods') }}>
          <td className="whn-cbcell" onClick={e => e.stopPropagation()}><input type="checkbox" className="whn-cb" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} aria-label={`Вибрати «${r.name}»`} /></td>
          <td><span className="whn-prod">
            <span className={`whn-ico${stock > 0 ? ' is-on' : ''}`} aria-hidden="true"><i className="ti ti-box" /></span>
            <span className="whn-prod-text"><b>{r.name}{r.status === 'archived' && <span className="whn-tag">архів</span>}</b>
              <span className="whn-sku">{(r.sku || '').trim() ? <code>{r.sku}</code> : <><span className="whn-muted">артикул не вказано</span><span className="whn-tag is-warn">без артикулу</span></>}
                {unitOdd(r.unit) && <span className="whn-tag is-warn">одиниця «{r.unit}»</span>}</span></span></span></td>
          <td className="r"><span className={`whn-stock${stock > 0 ? ' is-pos' : stock < 0 ? ' is-neg' : ''}`}>{stock < 0 ? '−' : ''}{fmt(Math.abs(stock))} {r.unit || 'шт'}</span></td>
          <td className="r whn-num whn-up">{up ? <>{formatAmount(up)} ₴<small className="whn-only-sm"> / од.</small></> : '—'}
            {!(r.sku || '').trim() && <span className="whn-tag is-warn whn-only-sm">без артикулу</span>}
            {unitOdd(r.unit) && <span className="whn-tag is-warn whn-only-sm">«{r.unit}»</span>}</td>
          <td className="r whn-num">{val ? <b>{formatAmount(val)} ₴</b> : stock > 0 && stockAt
            ? <span className="whn-nobatch" title="Кількість є, але партій (прихідних із ціною) немає — вартість не рахуємо. Оприбуткуйте прихідну накладну.">—<small>немає партій</small></span>
            : <b>—</b>}</td>
        </tr>
      )
    }
    return (
      <div className="whn">
        <div className="whn-kpis">
          <section className="whn-value"><span>Вартість запасу</span><b>≈ {formatAmount(totalValue, { decimals: 0 })} ₴</b><small>за собівартістю партій (FIFO), без ПДВ{cat || onlyStock || q || quality ? ' · з урахуванням фільтра' : ''}</small>
            <button type="button" className="whn-instock" aria-pressed={onlyStock} onClick={() => setOnlyStock(o => !o)}>
              <span><i aria-hidden="true" />{inStock} {plural(inStock, POS)} у наявності</span><small>{onlyStock ? 'показати всі' : 'лише в наявності'}</small></button></section>
          <KpiTile className="whn-kpi-lg" label="У наявності" value={`${inStock} ${plural(inStock, POS)}`} hint={`ще ${rows.length - inStock - minus} — 0 шт`} onClick={() => setOnlyStock(true)} />
          {minus > 0 && <KpiTile className="whn-kpi-lg" label="Мінусові залишки" tone="danger" value={`${minus} ${plural(minus, POS)}`} hint="продано більше, ніж прийшло — перевірити" onClick={() => setQuality(quality === 'minus' ? null : 'minus')} />}
          {(noSku > 0 || oddUnits.length > 0) && (
            <section className="whn-quality">
              <div className="whn-quality-head"><span>Якість довідника<InfoTip label="Якість довідника">Товари, які заважають точному обліку: без артикулу або з однією одиницею, записаною по-різному. Чип відфільтровує список.</InfoTip></span>{onExcel && <button type="button" className="whn-link" onClick={onExcel}>Виправити в Excel →</button>}</div>
              {noSku > 0 && <button type="button" className="whn-qchip" aria-pressed={quality === 'nosku'} onClick={() => setQuality(quality === 'nosku' ? null : 'nosku')}><b>{noSku}</b> без артикулу</button>}
              {oddUnits.length > 0 && <button type="button" className="whn-qchip" aria-pressed={quality === 'unit'} onClick={() => setQuality(quality === 'unit' ? null : 'unit')}><b>{oddUnits.length}</b> з одиницею в різному написанні: {oddSpellings.join(' / ')}</button>}
            </section>
          )}
        </div>

        <section className="whn-card">
          {tabs}
          <div className="whn-toolbar">
            <label className="whn-search"><i className="ti ti-search" aria-hidden="true" /><input type="search" className="form-input" placeholder="Назва або артикул" aria-label="Пошук товарів" value={q} onChange={e => setQ(e.target.value)} /></label>
            <select className="form-input whn-cat" aria-label="Категорія" value={cat} onChange={e => setCat(e.target.value)}>
              <option value="">Усі категорії · {categories.length}</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__none__">Без категорії</option>
            </select>
            <Switch checked={onlyStock} onChange={setOnlyStock} label="Тільки в наявності" />
            <Switch checked={grouped} onChange={setGrouped} label="За категоріями" />
            <Switch checked={showArchived} onChange={setShowArchived} label="Архівні" />
          </div>
          <div className="whn-mchips">
            {minus > 0 && <button type="button" className="whn-mchip is-danger" aria-pressed={quality === 'minus'} onClick={() => setQuality(quality === 'minus' ? null : 'minus')}><i aria-hidden="true" />Мінусові <b>{minus}</b></button>}
            {noSku > 0 && <button type="button" className="whn-mchip" aria-pressed={quality === 'nosku'} onClick={() => setQuality(quality === 'nosku' ? null : 'nosku')}><i aria-hidden="true" />Без артикулу <b>{noSku}</b></button>}
            {oddUnits.length > 0 && <button type="button" className="whn-mchip" aria-pressed={quality === 'unit'} onClick={() => setQuality(quality === 'unit' ? null : 'unit')}><i aria-hidden="true" />Різні одиниці <b>{oddUnits.length}</b></button>}
          </div>
          {!loading && <div className="whn-listhead"><span>{onlyStock ? 'У наявності' : 'Усі товари'}</span><span>{view.length} з {rows.length}</span></div>}
          {quality && <div className="whn-filter">Фільтр: <b>{{ minus: 'мінусові залишки', nosku: 'без артикулу', unit: 'одиниця в різному написанні' }[quality]}</b><button type="button" className="whn-link" onClick={() => setQuality(null)}>Скинути</button></div>}
          {sel.size > 0 && (
            <div className="whn-bulk">
              <b>Вибрано {sel.size}</b>
              <input className="form-input" list="wh-categories-bulk" placeholder="Категорія для вибраних" aria-label="Категорія для вибраних" value={bulkCat} onChange={e => setBulkCat(e.target.value)} />
              <datalist id="wh-categories-bulk">{categories.map(c => <option key={c} value={c} />)}</datalist>
              <Button size="sm" variant="brand" onClick={assignBulk} loading={bulkBusy} disabled={!bulkCat.trim()}>Присвоїти категорію</Button>
              <Button size="sm" variant="ghost" onClick={assignBulk} disabled={bulkBusy || !!bulkCat.trim()}>Очистити категорію</Button>
              <button type="button" className="whn-bulk-cancel" onClick={() => setSel(new Set())}>Скасувати</button>
            </div>
          )}
          {loading ? <TableSkeleton rows={8} cols={4} label="Завантаження складу…" />
            : view.length === 0 ? <EmptyState icon="ti-box" title="Нічого не знайдено" text="Змініть пошук або фільтр." />
            : <>
              <div className="whn-table-wrap"><table className="whn-table">
                <thead><tr>
                  <th className="whn-cbcell"><input type="checkbox" className="whn-cb" checked={allVisibleSelected} onChange={toggleAll} aria-label="Вибрати всі видимі" /></th>
                  <th><button type="button" className="whn-sort" onClick={() => onSort('name')}>Товар</button></th>
                  <th className="r"><button type="button" className="whn-sort" onClick={() => onSort('computed_stock')}>Залишок</button></th>
                  <th className="r"><button type="button" className="whn-sort" onClick={() => onSort('buy_price')}>Собівартість, од. <small>без ПДВ</small></button></th>
                  <th className="r">Вартість залишку</th>
                </tr></thead>
                <tbody>
                  {!grouped && page.map(row)}
                  {grouped && groups.map(g => (
                    <Fragment key={g.key}>
                      <tr className="whn-group"><td colSpan={3}>{g.label} <span>· {g.items.length}</span></td><td colSpan={2} className="r">запас ≈ {formatAmount(g.value, { decimals: 0 })} ₴</td></tr>
                      {g.items.map(row)}
                    </Fragment>
                  ))}
                </tbody>
              </table></div>
              {!grouped && <div className="whn-foot"><span>Показано {page.length} з {view.length}</span>{page.length < view.length && <Button variant="secondary" onClick={() => setShown(n => n + 50)}>Показати ще</Button>}</div>}
            </>}
        </section>
      </div>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Показати архівні</label>
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
               <SortTh label="Ціна по залишку" k="buy_price" sort={sort} onSort={onSort} align="right" />
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
    </div>
  )
}

// ───────── Послуги (без залишків: к-сть + вартість, вхідні/вихідні) ─────────
function ServicesTab() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const openProduct = useOpenProduct()
  const [showArchived, setShowArchived] = useState(false)

  const load = async () => {
    const makeP = () => { const q = qc('product_stock').select('id, name, category, status').eq('product_type', 'service'); return showArchived ? q : q.eq('status', 'active') }
    const { data: prods } = await fetchAllData(makeP).then(r => ({ ...r, data: [...(r.data || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk')) }))
    const ids = (prods || []).map(p => p.id)
    const movs = ids.length ? await fetchAllIn(() => qc('stock_movements').select('id, product_id, type, quantity, total'), 'product_id', ids) : []
    const agg = {}
    movs.forEach(m => {
      const a = (agg[m.product_id] ||= { inQty: 0, inVal: 0, outQty: 0, outVal: 0 })
      const qn = Number(m.quantity) || 0, t = Number(m.total) || 0
      if (m.type === 'in') { a.inQty += qn; a.inVal += t } else if (m.type === 'out') { a.outQty += qn; a.outVal += t }
    })
    setRows((prods || []).map(p => ({ ...p, ...(agg[p.id] || { inQty: 0, inVal: 0, outQty: 0, outVal: 0 }) })))
  }
  useEffect(() => { load() }, [showArchived])

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
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openProduct(r, 'services')}>
                  <td><div className="trunc" style={{ fontWeight: 500 }}>{r.name}{r.status === 'archived' && <span style={{ fontSize: 10, color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px', marginLeft: 6 }}>архів</span>}</div>{r.category && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.category}</div>}</td>
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
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Пошук послуги…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 360 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Показати архівні</label>
      </div>
      <Section title="Вихідні послуги (надаємо)" list={out} qtyKey="outQty" valKey="outVal" color="var(--green)" />
      <Section title="Вхідні послуги (отримуємо)" list={inc} qtyKey="inQty" valKey="inVal" color="var(--red)" />
      {both.length > 0 && (
        <div className="card">
          <div className="card-title">Без операцій ({both.length})</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {both.map(r => <span key={r.id} onClick={() => openProduct(r, 'services')} style={{ background: 'var(--surface2)', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>{r.name}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

// ───────── Розхідні матеріали (придбано/списано/залишок + списання) ─────────
function ConsumablesTab() {
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [consume, setConsume] = useState(null)
  const openProduct = useOpenProduct()
  const [showArchived, setShowArchived] = useState(false)

  const load = async () => {
    const make = () => { const q = qc('product_stock')
      .select('id, name, unit, computed_stock, total_in, total_out, status').eq('product_type', 'expense'); return showArchived ? q : q.eq('status', 'active') }
    const { data } = await fetchAllData(make).then(r => ({ ...r, data: [...(r.data || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk')) }))
    setRows(data || [])
  }
  useEffect(() => { load() }, [showArchived])

  if (!rows) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  const t = q.trim().toLowerCase()
  const view = rows.filter(r => !t || (r.name || '').toLowerCase().includes(t))

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Пошук матеріалу…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 360 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Показати архівні</label>
      </div>
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
                    <td onClick={() => openProduct(r, 'consumables')} style={{ cursor: 'pointer' }}><div className="trunc" style={{ fontWeight: 500, color: 'var(--blue)' }}>{r.name}{r.status === 'archived' && <span style={{ fontSize: 10, color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px', marginLeft: 6 }}>архів</span>}</div></td>
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
    </div>
  )
}

function ConsumeModal({ product, user, onClose, onDone }) {
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(todayKyiv())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const save = async () => {
    const q = Number(qty) || 0
    if (q <= 0) { setErr('Вкажіть кількість'); return }
    setBusy(true); setErr(null)
    const { error } = await qc('stock_movements').insert(withCompany({
      product_id: product.id, type: 'out', quantity: q, date,
      source: 'manual', description: note.trim() || `Списання: ${product.name}`.slice(0, 200), created_by: user?.id || null,
    }))
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

// картка товару відкривається окремою сторінкою /inventory/product/:id (з поверненням на ту саму вкладку складу)
function useOpenProduct() {
  const navigate = useNavigate()
  return (r, tab = 'goods') => navigate(`/inventory/product/${r.id}${tab !== 'goods' ? `?from=${tab}` : ''}`)
}
export function ProductPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const from = params.get('from')
  const back = `/inventory${from ? `?tab=${from}` : ''}`
  const [product, setProduct] = useState(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    supabase.from('products').select('id, name').eq('id', id).maybeSingle().then(({ data }) => { if (data) setProduct(data); else setMissing(true) })
  }, [id])
  if (missing) return <div><Link to={back}>← Склад</Link><p style={{ color: 'var(--text3)' }}>Товар не знайдено.</p></div>
  if (!product) return <div><Link to={back}>← Склад</Link><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
  return <ProductModal product={product} asPage backTo={back} onClose={() => navigate(back)} />
}

function ProductModal({ product, onClose, asPage = false, backTo = '/inventory' }) {
  const { user } = useUser()
  const [aliases, setAliases] = useState([])
  const [movs, setMovs] = useState([])
  const [openDoc, setOpenDoc] = useState(null)
  const [genDoc, setGenDoc] = useState(null)
  const [linkMov, setLinkMov] = useState(null)
  const [allCats, setAllCats] = useState([])
  const [form, setForm] = useState(null)
  const [orig, setOrig] = useState(null)
  const [stock, setStock] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [showMove, setShowMove] = useState(false)
  const [showMerge, setShowMerge] = useState(false)
  const [showSplit, setShowSplit] = useState(false)
  const [view, setView] = useState('batches')   // «Партії» | «Рухи»
  const [pur, setPur] = useState(null)          // ціни закупівлі за партіями
  const newUi = useNewUi()
  const [pdTab, setPdTab] = useState('main')   // новий інтерфейс: Основне | Партії | Синоніми | Рухи
  useEffect(() => { loadPurchaseSummary(product.id).then(setPur).catch(() => setPur(null)) }, [product.id])
  // Маржа продажів і розбіжності (макет Product) — те саме правило, що звіт «Товари» в закритті періоду:
  // продажі = рухи «out» без збірок; виручка = к-сть × ціна, собівартість = к-сть × cost_price (обидві без ПДВ)
  const [sales, setSales] = useState(null)
  useEffect(() => {
    if (!newUi) return
    qc('stock_movements').select('type, quantity, price, cost_price, source, document_id').eq('product_id', product.id).limit(5000).then(({ data, error }) => {
      if (error) { setSales(false); return }
      const out = (data || []).filter(m => m.type !== 'in' && m.source !== 'assembly')
      const rev = out.reduce((a, m) => a + (Number(m.quantity) || 0) * (Number(m.price) || 0), 0)
      const cost = out.reduce((a, m) => a + (Number(m.quantity) || 0) * (Number(m.cost_price) || 0), 0)
      setSales({
        rev, cost, n: out.length,
        noCost: out.filter(m => !(Number(m.cost_price) > 0)).length,                                       // продаж без собівартості (немає партії)
        noPrice: (data || []).filter(m => m.type === 'in' && m.source !== 'assembly' && !(Number(m.price) > 0)).length, // прихід без ціни
        noDoc: (data || []).filter(m => !m.document_id && !['manual', 'assembly'].includes(m.source)).length,          // автоматичний рух без документа
      })
    })
  }, [product.id, newUi])
  const openAnyDoc = (id) => loadDocFull(id).then(d => d && (d.source === 'generated' ? setGenDoc(d) : setOpenDoc(d)))
  const loadStock = () => qc('product_stock').select('computed_stock, total_in, total_out, unit, product_type').eq('id', product.id).maybeSingle().then(({ data }) => setStock(data))
  const loadMovs = () => qc('stock_movements').select(`id, type, quantity, cost_price, date, description, source, document_id, ${DOC_EMBED}`).eq('product_id', product.id).order('date', { ascending: false }).limit(50).then(({ data }) => setMovs(data || []))
  useEffect(() => {
    qc('product_stock').select('computed_stock, total_in, total_out, unit, product_type').eq('id', product.id).maybeSingle().then(({ data }) => setStock(data))
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
      sell_price: form.sell_price === '' ? null : Number(form.sell_price),   // закупівля — лише з партій (не вводиться)
      min_stock: form.min_stock === '' ? null : Number(form.min_stock),
    }).eq('id', product.id)
    setBusy(false)
    if (error) { setErr('Помилка збереження: ' + error.message); return }
    onClose()
  }

  const archive = async () => {
    const left = Number(stock?.computed_stock) || 0
    if (Math.abs(left) > 0.00001) { alert(`Не можна архівувати: на складі ${left > 0 ? 'залишок' : 'мінус'} ${left} ${stock?.unit || 'шт'}. Спершу обнуліть залишок або об'єднайте картку з іншою («Об'єднати з товаром»).`); return }
    if (!confirm('Архівувати? Зникне зі списків складу, історія рухів збережеться.')) return
    setBusy(true)
    await supabase.from('products').update({ status: 'archived' }).eq('id', product.id)
    setBusy(false); onClose()
  }

  const del = async () => {
    const { count } = await qc('stock_movements').select('id', { count: 'exact', head: true }).eq('product_id', product.id)
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
    await qc('stock_movements').update({ document_id: docId, source: 'document' }).eq('id', linkMov.id)
    setLinkMov(null); loadMovs()
  }

  const delMov = async (m) => {
    if (!confirm(`Видалити рух: ${m.type === 'in' ? 'Прихід' : m.type === 'out' ? 'Видаток' : m.type} ${m.quantity} від ${m.date}? Залишок перерахується.`)) return
    await qc('stock_movements').delete().eq('id', m.id)
    loadMovs(); loadStock()
  }

  if (asPage && newUi) {
    const isService = (form?.product_type || stock?.product_type) === 'service'
    const st = Number(stock?.computed_stock) || 0
    const sell = form && form.sell_price !== '' && form.sell_price != null ? Number(form.sell_price) : null
    const last = pur?.last?.unit || null
    const markup = sell && last ? (sell - last) / last * 100 : null
    const below = sell != null && last && sell < last
    const copySku = async () => { try { await navigator.clipboard.writeText(form?.sku || '') } catch {} }
    const quick = last ? [10, 20, 30].map(p => ({ p, v: Math.round(last * (1 + p / 100) * 100) / 100 })) : []
    return (
      <div className="pdn">
        <Link to={backTo} className="pdn-back"><i className="ti ti-chevron-left" aria-hidden="true" />Склад</Link>
        <section className="pdn-head">
          <span className="pdn-ico" aria-hidden="true"><i className={`ti ${isService ? 'ti-briefcase' : 'ti-box'}`} /></span>
          <div className="pdn-head-main">
            <h1 className="pdn-h1">{form?.name || product.name}</h1>
            <div className="pdn-meta">
              {form?.category && <span className="pdn-chip">{form.category}</span>}
              <span>{(PRODUCT_TYPES.find(([v]) => v === (form?.product_type || 'goods')) || [, 'Товар'])[1]} · {form?.unit || stock?.unit || 'шт'}</span>
              {form?.sku && <span className="pdn-sku"><code>{form.sku}</code><button type="button" className="pdn-copy" onClick={copySku} aria-label="Скопіювати артикул"><i className="ti ti-copy" aria-hidden="true" /></button></span>}
            </div>
          </div>
          <div className="pdn-actions">
            {!isService && <Button variant="secondary" icon="ti-arrows-up-down" onClick={() => setShowMove(true)}>Ручний рух</Button>}
            <Menu trigger={<Button variant="secondary" iconOnly icon="ti-dots" aria-label="Інші дії" />} items={[
              { label: 'Об\'єднати з товаром', icon: 'ti-arrows-join', onClick: () => setShowMerge(true) },
              ...(['admin', 'accountant'].includes(user?.role) ? [{ label: 'Розділити картку', icon: 'ti-arrows-split-2', onClick: () => setShowSplit(true) }] : []),
              { divider: true },
              { label: 'Архівувати', icon: 'ti-archive', onClick: archive },
              { label: 'Видалити', icon: 'ti-trash', danger: true, onClick: del },
            ]} />
          </div>
        </section>

        {below && (
          <Callout tone="danger" title={`Ціна продажу ${formatAmount(sell)} ₴ нижча за останню закупку ${formatAmount(last)} ₴ (обидві без ПДВ).`}
            text="Наступний продаж за цією ціною буде збитковим." action={{ label: 'Оновити ціну', onClick: () => { setPdTab('main'); setTimeout(() => document.getElementById('pdn-sell')?.focus(), 0) } }} />
        )}

        <div className="pdn-kpis">
          {isService
            ? <KpiTile label="Послуга" value="без залишку" />
            : <KpiTile label="Залишок" tone={st < 0 ? 'danger' : st > 0 ? 'brand' : 'neutral'} value={`${st < 0 ? '−' : ''}${fmt(Math.abs(st))} ${stock?.unit || form?.unit || 'шт'}`} hint={`мін. залишок ${form?.min_stock ?? 0}`} />}
          <KpiTile label="Прийшло / вийшло" value={`${fmt(stock?.total_in || 0)} / ${fmt(stock?.total_out || 0)}`} hint={`${pur?.lots?.length || 0} партій · ${movs.length} рухів`} />
          <KpiTile label="Закупка за од., без ПДВ" value={last ? `${formatAmount(last)} ₴` : '—'} hint={pur?.lots?.length > 1 ? `середня ${formatAmount(pur.avg)} · від ${formatAmount(pur.min)} до ${formatAmount(pur.max)}` : 'остання партія'} />
          {sales && sales.n > 0 && (
            <section className="pdn-dark"><span>Маржа продажів</span>
              <b className={sales.rev - sales.cost < 0 ? 'is-neg' : ''}>{formatAmount(sales.rev - sales.cost, { decimals: 0 })} ₴</b>
              <small>{sales.rev > 0 ? `${((sales.rev - sales.cost) / sales.rev * 100).toFixed(1).replace('.', ',')}% від виручки ${formatAmount(sales.rev, { decimals: 0 })} ₴` : 'виручки ще немає'} · без ПДВ{sales.noCost ? ` · завищена: ${sales.noCost} продаж без собівартості` : ''}</small></section>
          )}
          {sales && (() => {
            const issues = [st < 0 && `мінусовий залишок ${fmt(st)}`, sales.noCost && `${sales.noCost} продаж без собівартості`, sales.noPrice && `${sales.noPrice} прихід без ціни`, sales.noDoc && `${sales.noDoc} рух без документа`].filter(Boolean)
            const n = (st < 0 ? 1 : 0) + sales.noCost + sales.noPrice + sales.noDoc
            return <KpiTile label="Розбіжності" tone={n ? 'danger' : 'neutral'} value={n ? String(n) : 'немає'}
              hint={n ? `${issues.join(' · ')} · переглянути →` : 'рухи складу узгоджені'} onClick={n ? () => setPdTab('movs') : undefined} />
          })()}
          {pur?.stockAvg != null && !(sales && sales.n > 0) && <section className="pdn-dark"><span>Вартість залишку</span><b>{formatAmount(pur.stockValue, { decimals: 0 })} ₴</b><small>по {formatAmount(pur.stockAvg)} за од. (FIFO), без ПДВ</small></section>}
        </div>

        <section className="pdn-body">
          <Tabs ariaLabel="Розділи товару" idPrefix="pdn-tab" value={pdTab} onChange={setPdTab} tabs={[
            { id: 'main', label: 'Основне' }, { id: 'batches', label: 'Партії', count: pur?.lots?.length || undefined },
            { id: 'aliases', label: 'Синоніми', count: aliases.length || undefined }, { id: 'movs', label: 'Рухи', count: movs.length || undefined }]} />
          {pdTab === 'main' && (!form ? <TableSkeleton rows={4} cols={2} /> : (
            <div className="pdn-main">
              <div className="pdn-form">
                <div className="form-group"><label className="form-label" htmlFor="pdn-name">Назва</label><input id="pdn-name" className="form-input" value={form.name || ''} onChange={e => setF('name', e.target.value)} /></div>
                <div className="form-group"><span className="form-label">Тип</span>
                  <Segmented ariaLabel="Тип" value={form.product_type || 'goods'} onChange={v => setF('product_type', v)} options={PRODUCT_TYPES.map(([value, label]) => ({ value, label }))} /></div>
                <div className="pdn-grid2">
                  <div className="form-group"><label className="form-label" htmlFor="pdn-sku">Артикул</label><input id="pdn-sku" className="form-input" value={form.sku || ''} onChange={e => setF('sku', e.target.value)} /></div>
                  <div className="form-group"><label className="form-label" htmlFor="pdn-cat">Категорія</label><input id="pdn-cat" className="form-input" list="wh-categories" value={form.category || ''} onChange={e => setF('category', e.target.value)} />
                    <datalist id="wh-categories">{allCats.map(c => <option key={c} value={c} />)}</datalist></div>
                  <div className="form-group"><label className="form-label" htmlFor="pdn-unit">Одиниця</label><input id="pdn-unit" className="form-input" value={form.unit || ''} onChange={e => setF('unit', e.target.value)} /></div>
                  <div className="form-group"><label className="form-label" htmlFor="pdn-min">Мінімальний залишок</label><input id="pdn-min" className="form-input" type="number" step="any" value={form.min_stock ?? ''} onChange={e => setF('min_stock', e.target.value)} /></div>
                </div>
              </div>
              <aside className="pdn-side">
                <section className="pdn-price">
                  <h2>Ціна продажу</h2>
                  <label className={`pdn-price-field${below ? ' is-bad' : ''}`}><input id="pdn-sell" type="number" step="any" inputMode="decimal" aria-label="Ціна продажу, без ПДВ" value={form.sell_price ?? ''} onChange={e => setF('sell_price', e.target.value)} /><span>₴ без ПДВ</span></label>
                  {markup != null && <div className="pdn-row"><span>Націнка до ост. закупки</span><b className={markup < 0 ? 'is-neg' : 'is-pos'}>{markup > 0 ? '+' : markup < 0 ? '−' : ''}{Math.abs(markup).toFixed(1).replace('.', ',')}%</b></div>}
                  {quick.length > 0 && <>
                    <span className="pdn-small">Швидко підставити:</span>
                    <div className="pdn-quick">{quick.map(x => <button key={x.p} type="button" onClick={() => setF('sell_price', String(x.v))}><small>+{x.p}% до ост. закупки</small><b>{formatAmount(x.v)}</b></button>)}</div>
                  </>}
                </section>
                <section className="pdn-buy">
                  <h2>Закупівля <small>без ПДВ</small></h2>
                  {!pur ? <p className="pdn-small">…</p> : !pur.last ? <p className="pdn-small">Приходів ще не було.</p> : (
                    <dl>
                      <div><dt>Остання</dt><dd>{formatAmount(pur.last.unit)} ₴</dd></div>
                      {pur.lots.length > 1 && <div><dt>Середня ({pur.lots.length} партій)</dt><dd>{formatAmount(pur.avg)} ₴</dd></div>}
                      {pur.lots.length > 1 && <div><dt>Мінімум</dt><dd>{formatAmount(pur.min)} ₴</dd></div>}
                      <div><dt>Останній постачальник</dt><dd>{pur.last.supplier || '—'}</dd></div>
                      <div><dt>Документ</dt><dd>{pur.last.docNo ? `№${pur.last.docNo}, ` : ''}{dmy(pur.last.date)}</dd></div>
                    </dl>
                  )}
                </section>
              </aside>
              <div className="pdn-save">
                {err && <div role="alert" className="pdn-err">{err}</div>}
                {dirty && <span className="pdn-small">Є незбережені зміни</span>}
                <Button variant="brand" onClick={save} loading={busy} disabled={!dirty}>Зберегти зміни</Button>
              </div>
            </div>
          ))}
          {pdTab === 'batches' && <ProductBatches productId={product.id} unit={form?.unit || stock?.unit} productName={form?.name || product.name} onOpenDoc={openAnyDoc} />}
          {pdTab === 'aliases' && (aliases.length
            ? <div className="pdn-aliases">{aliases.map((a, i) => <span key={i}>{a.alias}</span>)}</div>
            : <EmptyState icon="ti-tags" title="Синонімів немає" text="Назви з документів постачальників, за якими розпізнається цей товар, з'являться тут." />)}
          {pdTab === 'movs' && <div className="tbl-wrap" style={{ border: 'none' }}>
            <table><thead><tr><th>Дата</th><th>Тип</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Ціна за од., без ПДВ</th><th>Опис</th><th>Документ</th><th aria-label="Дії" /></tr></thead>
              <tbody>{movs.map(m => <tr key={m.id}><td className="pdn-nowrap">{dmy(m.date)}</td><td>{m.type === 'in' ? 'Прихід' : m.type === 'out' ? 'Видаток' : m.type}</td><td style={{ textAlign: 'right' }}>{fmt(m.quantity)}</td>
                <td style={{ textAlign: 'right' }} title={m.type === 'in' ? 'ціна партії' : 'собівартість (FIFO)'}>{m.type === 'in' ? (pur?.units[m.id]?.unit ? formatAmount(pur.units[m.id].unit) : '—') : m.cost_price ? formatAmount(m.cost_price) : '—'}</td>
                <td><div className="trunc">{m.description}</div></td>
                <td>{m.documents
                  ? <button type="button" className="pdn-doc" onClick={() => m.documents.source === 'generated' ? setGenDoc(m.documents) : setOpenDoc(m.documents)}><i className="ti ti-file" aria-hidden="true" /> {getDocType(m.documents.type)?.label || 'документ'}</button>
                  : <span className="pdn-small">{srcLabel(m.source)} <button type="button" className="pdn-doc" onClick={() => setLinkMov(m)}>прив'язати</button></span>}</td>
                <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" iconOnly icon="ti-trash" aria-label="Видалити рух" onClick={() => delMov(m)} /></td></tr>)}</tbody>
            </table>
          </div>}
        </section>
        {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => setOpenDoc(null)} />}
        {genDoc && <GeneratedDocModal doc={genDoc} onClose={() => setGenDoc(null)} />}
        {linkMov && <DocPickerModal title="Прив'язати документ до руху" match={{ date: linkMov.date }} onClose={() => setLinkMov(null)} onPick={linkDoc} />}
        {showMove && <ManualMoveModal product={product} stock={stock} user={user} onClose={() => setShowMove(false)} onDone={() => { setShowMove(false); loadMovs(); loadStock() }} />}
        {showSplit && <SplitProductModal product={product} onClose={() => setShowSplit(false)} onDone={() => { setShowSplit(false); loadMovs(); loadStock(); supabase.from('product_aliases').select('alias').eq('product_id', product.id).then(({ data }) => setAliases(data || [])) }} />}
        {showMerge && <MergeProductModal product={product} onClose={() => setShowMerge(false)} onDone={() => { setShowMerge(false); loadMovs(); loadStock() }} />}
      </div>
    )
  }

  return (
    <div className={asPage ? undefined : 'modal-bg'} onClick={asPage ? undefined : onClose}>
      <div className={asPage ? undefined : 'modal modal-lg'} onClick={e => e.stopPropagation()}>
        {asPage ? (
          <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Link to={backTo} className="btn btn-sm"><i className="ti ti-arrow-left" /> Склад</Link>
            <h1 style={{ margin: 0, flex: 1, minWidth: 200 }}>{form?.name || product.name}</h1>
            {form?.sku && <span style={{ color: 'var(--text3)', fontSize: 14 }}>{form.sku}</span>}
          </div>
        ) : <div className="modal-header"><h2>{form?.name || product.name}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>}
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
            <div className="form-group"><label>Закупівля (за партіями, без ПДВ)</label>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', fontSize: 13, background: 'var(--surface2)', minHeight: 44 }}>
                {!pur ? <span style={{ color: 'var(--text3)' }}>…</span> : !pur.last ? <span style={{ color: 'var(--text3)' }}>приходів немає</span> : <>
                  <div>остання: <b>{fmt(pur.last.unit)}</b> <span style={{ color: 'var(--text3)' }}>({pur.last.docNo ? `№${pur.last.docNo}, ` : ''}{dmy(pur.last.date)}{pur.last.supplier ? `, ${pur.last.supplier}` : ''})</span></div>
                  {pur.stockAvg != null && <div>по залишку {fmt(pur.onHand)}: <b>{fmt(pur.stockAvg)}</b> <span style={{ color: 'var(--text3)' }}>· {fmt(pur.stockValue)} грн</span></div>}
                  {pur.lots.length > 1 && <div style={{ color: 'var(--text3)' }}>партій {pur.lots.length}: від {fmt(pur.min)} до {fmt(pur.max)}, середня {fmt(pur.avg)}</div>}
                </>}
              </div>
            </div>
            <div className="form-group"><label>Ціна продажу (без ПДВ)</label><input className="form-input" type="number" step="any" value={form.sell_price ?? ''} onChange={e => setF('sell_price', e.target.value)} /></div>
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setShowMove(true)}><i className="ti ti-plus" /> Ручний рух</button>
          <button className="btn" onClick={() => setShowMerge(true)}><i className="ti ti-arrows-join" /> Об'єднати з товаром</button>
          {['admin', 'accountant'].includes(user?.role) && <button className="btn" onClick={() => setShowSplit(true)} title="Перенести рухи іншого товару на окрему картку (виправлення помилкового об'єднання)"><i className="ti ti-arrows-split-2" /> Розділити картку</button>}
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
          {[['batches', 'Партії', 'ti-stack-2'], ['movs', 'Рухи', 'ti-arrows-up-down']].map(([k, l, ic]) => (
            <button key={k} onClick={() => setView(k)} style={{ background: 'none', border: 0, borderBottom: '2px solid ' + (view === k ? 'var(--text)' : 'transparent'), padding: '6px 12px', fontFamily: 'inherit', fontWeight: view === k ? 700 : 500, color: view === k ? 'var(--text)' : 'var(--text3)', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}><i className={`ti ${ic}`} />{l}</button>
          ))}
        </div>
        {view === 'batches' && <ProductBatches productId={product.id} unit={form?.unit || stock?.unit} productName={form?.name || product.name} onOpenDoc={openAnyDoc} />}
        {view === 'movs' && <div className="tbl-wrap" style={{ border: 'none', maxHeight: asPage ? '70vh' : 280, overflowY: 'auto' }}>
          <table><thead><tr><th>Дата</th><th>Тип</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }} title="Прихід — ціна партії без ПДВ; видаток — собівартість">Ціна / собівартість</th><th>Опис</th><th>Документ</th><th /></tr></thead>
            <tbody>{movs.map(m => <tr key={m.id}><td style={{ fontSize: 12 }}>{m.date}</td><td>{m.type === 'in' ? 'Прихід' : m.type === 'out' ? 'Видаток' : m.type}</td><td style={{ textAlign: 'right' }}>{fmt(m.quantity)}</td><td style={{ textAlign: 'right' }}>{m.type === 'in' ? (pur?.units[m.id]?.unit ? <span title={pur.units[m.id].basis}>{fmt(pur.units[m.id].unit)}</span> : '—') : m.cost_price ? fmt(m.cost_price) : '—'}</td><td><div className="trunc">{m.description}</div></td>
              <td>{m.documents
                ? <a onClick={() => m.documents.source === 'generated' ? setGenDoc(m.documents) : setOpenDoc(m.documents)} style={{ color: 'var(--blue)', cursor: 'pointer', fontSize: 12 }}><i className="ti ti-file" /> {getDocType(m.documents.type)?.label || 'документ'}</a>
                : <span style={{ color: 'var(--text3)', fontSize: 12 }}>{srcLabel(m.source)} <button className="btn" onClick={() => setLinkMov(m)} title="Прив'язати документ" style={{ padding: '0 6px' }}><i className="ti ti-link" /></button></span>}</td>
              <td style={{ textAlign: 'right' }}><button className="btn" onClick={() => delMov(m)} title="Видалити рух" style={{ padding: '0 6px', color: 'var(--red)' }}><i className="ti ti-trash" /></button></td></tr>)}</tbody>
          </table>
        </div>}
      </div>
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => setOpenDoc(null)} />}
      {genDoc && <GeneratedDocModal doc={genDoc} onClose={() => setGenDoc(null)} />}
      {linkMov && <DocPickerModal title="Прив'язати документ до руху" match={{ date: linkMov.date }} onClose={() => setLinkMov(null)} onPick={linkDoc} />}
      {showMove && <ManualMoveModal product={product} stock={stock} user={user} onClose={() => setShowMove(false)} onDone={() => { setShowMove(false); loadMovs(); loadStock() }} />}
      {showSplit && <SplitProductModal product={product} onClose={() => setShowSplit(false)} onDone={() => { setShowSplit(false); loadMovs(); loadStock(); supabase.from('product_aliases').select('alias').eq('product_id', product.id).then(({ data }) => setAliases(data || [])) }} />}
      {showMerge && <MergeProductModal product={product} onClose={() => setShowMerge(false)} onDone={() => { setShowMerge(false); loadMovs(); loadStock() }} />}
    </div>
  )
}

// Ручний складський рух (прихід/видача/встановити залишок)
function ManualMoveModal({ product, stock, user, onClose, onDone }) {
  const [kind, setKind] = useState('in') // in | out | set
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [date, setDate] = useState(todayKyiv())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const cur = Number(stock?.computed_stock) || 0

  const save = async () => {
    setBusy(true); setErr(null)
    let type = kind, quantity = Number(qty) || 0
    if (kind === 'set') {
      const target = Number(qty)
      if (Number.isNaN(target)) { setErr('Вкажіть цільовий залишок'); setBusy(false); return }
      const delta = target - cur
      if (delta === 0) { onDone(); return }
      type = delta > 0 ? 'in' : 'out'; quantity = Math.abs(delta)
    }
    if (quantity <= 0) { setErr('Кількість має бути > 0'); setBusy(false); return }
    const price = cost === '' ? null : Number(cost)
    const { error } = await qc('stock_movements').insert(withCompany({
      product_id: product.id, type, quantity, price, cost_price: price,
      date, source: 'manual', description: note.trim() || (kind === 'set' ? 'Коригування залишку' : type === 'in' ? 'Ручний прихід' : 'Ручне списання'), created_by: user?.id || null,
    }))
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Ручний рух</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{product.name} · поточний залишок {fmt(cur)} {stock?.unit || ''}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[['in', 'Прихід +'], ['out', 'Видача −'], ['set', 'Встановити залишок']].map(([k, l]) => (
            <button key={k} className="btn" onClick={() => setKind(k)} style={{ flex: 1, background: kind === k ? 'var(--blue)' : 'var(--surface)', color: kind === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)', fontSize: 12 }}>{l}</button>
          ))}
        </div>
        <div className="form-grid">
          <div className="form-group"><label>{kind === 'set' ? 'Цільовий залишок' : 'Кількість'}</label><input className="form-input" type="number" step="any" value={qty} onChange={e => setQty(e.target.value)} autoFocus /></div>
          {kind !== 'out' && <div className="form-group"><label>Собівартість/од</label><input className="form-input" type="number" step="any" value={cost} onChange={e => setCost(e.target.value)} /></div>}
          <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="form-group full"><label>Примітка</label><input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="напр. інвентаризація / коригування" /></div>
        </div>
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Зберегти рух'}</button>
        </div>
      </div>
    </div>
  )
}

// Об'єднати поточний товар з іншим (поєднати закупівлю і реалізацію)
function MergeProductModal({ product, onClose, onDone }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setRows([]); return }
    qc('product_stock').select('id, name, sku, computed_stock, status').or(`name.ilike.%${t}%,sku.ilike.%${t}%`).limit(20)
      .then(({ data }) => setRows((data || []).filter(r => r.id !== product.id)))
  }, [q])

  const doMerge = async () => {
    if (!pick) return
    setBusy(true); setErr(null)
    const res = await mergeProducts(product.id, pick.id) // все з pick → у поточний
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    onDone()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Об'єднати з товаром</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>Залишити: <b>{product.name}</b>. Обраний товар буде <b>приєднано сюди</b> (усі рухи перенесуться, назва стане синонімом, дубль — в архів).</div>
        {!pick ? (
          <>
            <input className="form-input" placeholder="Знайти товар-дубль (назва або артикул)…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
            <div style={{ border: q.trim().length >= 2 ? '1px solid var(--border)' : 'none', borderRadius: 8, marginTop: 6, maxHeight: 260, overflow: 'auto' }}>
              {rows.map(r => (
                <div key={r.id} onClick={() => setPick(r)} style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="trunc">{r.name} {r.sku ? <span style={{ color: 'var(--text3)', fontSize: 11 }}>· {r.sku}</span> : ''}{r.status === 'archived' && <span style={{ color: 'var(--text3)', fontSize: 11 }}> · архів</span>}</span>
                  <span style={{ color: r.computed_stock < 0 ? 'var(--red)' : 'var(--green)', flexShrink: 0 }}>{fmt(r.computed_stock)}</span>
                </div>
              ))}
              {q.trim().length >= 2 && rows.length === 0 && <div style={{ padding: 10, color: 'var(--text3)', fontSize: 13 }}>Нічого не знайдено</div>}
            </div>
          </>
        ) : (
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, fontSize: 13 }}>
            Приєднати <b>«{pick.name}»</b> (залишок {fmt(pick.computed_stock)}) до <b>«{product.name}»</b>?
            <div style={{ color: 'var(--text3)', marginTop: 6 }}>Після об'єднання залишок складеться (напр. закупівля + реалізація = 0).</div>
            <button className="btn" onClick={() => setPick(null)} style={{ marginTop: 8 }}>← Обрати інший</button>
          </div>
        )}
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn btn-primary" onClick={doMerge} disabled={busy || !pick}>{busy ? '…' : 'Об\'єднати'}</button>
        </div>
      </div>
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
  const [genDoc, setGenDoc] = useState(null)
  const [linkMov, setLinkMov] = useState(null)
  const load = () => {
    setLoading(true)
    let qb = qc('stock_movements').select(`id, type, quantity, cost_price, total, date, description, source, document_id, products(name), ${DOC_EMBED}`).order('date', { ascending: false }).limit(500)
    if (type !== 'all') qb = qb.eq('type', type)
    qb.then(({ data }) => { setRows(data || []); setLoading(false) })
  }
  useEffect(() => { load() }, [type])
  const linkDoc = async (docId) => {
    await qc('stock_movements').update({ document_id: docId, source: 'document' }).eq('id', linkMov.id)
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
          <option value="all">Усі рухи</option><option value="in">Прихід</option><option value="out">Видаток</option><option value="adjustment">Коригування</option>
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
                        ? <a onClick={() => m.documents.source === 'generated' ? setGenDoc(m.documents) : setOpenDoc(m.documents)} style={{ color: 'var(--blue)', cursor: 'pointer' }} title={m.documents.file_name}><i className="ti ti-file" /> {getDocType(m.documents.type)?.label || 'документ'}</a>
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
      {genDoc && <GeneratedDocModal doc={genDoc} onClose={() => setGenDoc(null)} />}
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
      let qb = qc('documents').select('id, type, file_name, amount, doc_date, created_at, contractors(name)').limit(120)
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
  const load = () => qc('assemblies').select('id, name, quantity, total_cost, assembled_at, products(name)').order('assembled_at', { ascending: false }).then(({ data }) => setRows(data || []))
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
    fetchAllData(() => qc('product_stock').select('id, name, sku, unit, computed_stock').eq('status', 'active')).then(r => ({ ...r, data: [...(r.data || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk')) })).then(({ data }) => setStock(data || []))
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

  const found = (() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    return stock.filter(s => !comps.find(c => c.productId === s.id) && ((s.name || '').toLowerCase().includes(t) || (s.sku || '').toLowerCase().includes(t))).slice(0, 12)
  })()

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
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={del} disabled={busy} style={{ color: 'var(--red)' }}><i className="ti ti-trash" /> Видалити</button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => exportAssemblyAct(a)}><i className="ti ti-file-download" /> Акт для бухгалтера (PDF)</button>
                    <button className="btn btn-primary" onClick={() => setEdit(true)}><i className="ti ti-edit" /> Редагувати</button>
                  </div>
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
                <div style={{ marginBottom: 12 }}>
                  <input className="form-input" placeholder="Додати компонент за назвою або артикулом…" value={q} onChange={e => setQ(e.target.value)} />
                  {q.trim().length >= 2 && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 6, maxHeight: 240, overflow: 'auto' }}>
                      {found.length === 0 && <div style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text3)' }}>Нічого не знайдено</div>}
                      {found.map(p => (
                        <div key={p.id} onClick={() => addComp(p)} style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                          {p.name} <span style={{ color: 'var(--text3)', fontSize: 11 }}>· {p.sku ? `${p.sku} · ` : ''}на складі {fmt(p.computed_stock)} {p.unit}</span>
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
    fetchAllData(() => qc('product_stock').select('id, name, sku, unit, computed_stock').eq('status', 'active')).then(r => ({ ...r, data: [...(r.data || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk')) })).then(({ data }) => setStock(data || []))
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

  const matches = (() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    return stock.filter(s => !components.find(c => c.productId === s.id) && ((s.name || '').toLowerCase().includes(t) || (s.sku || '').toLowerCase().includes(t))).slice(0, 12)
  })()

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>Нова збірка</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="form-group full"><label>Назва готового виробу</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="form-group"><label>Кількість</label><input className="form-input" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Компоненти зі складу</div>
        <div style={{ marginBottom: 10 }}>
          <input className="form-input" placeholder="Знайти товар за назвою або артикулом…" value={q} onChange={e => setQ(e.target.value)} />
          {q.trim().length >= 2 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 6, maxHeight: 240, overflowY: 'auto' }}>
              {matches.length === 0 && <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text3)' }}>Нічого не знайдено</div>}
              {matches.map(m => (
                <div key={m.id} onClick={() => addComp(m)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                  {m.name} <span style={{ color: 'var(--text3)' }}>· {m.sku ? `${m.sku} · ` : ''}залишок {fmt(m.computed_stock)} {m.unit}</span>
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

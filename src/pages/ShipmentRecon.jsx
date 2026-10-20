import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmtInt } from '../lib/fmt'
import { todayKyiv, daysBetween } from '../lib/dates'
import {
  loadRecon, sortDocs, HOW_LABEL, dmy, linkAdd, linkRemove, setWarehouseDate, mergeCards, unmergeCards,
  loadRecentMerges, loadCardStats, loadDocLines, loadDocFull, skuCompatible, nameScore, tableRow, loadDateMismatches, syncDocDates,
} from '../lib/shipmentRecon'
import DocModal from '../components/DocModal'
import ReconInbox from '../components/ReconInbox'
import { buildProblems } from '../lib/shipmentRecon'

// «Склад → Звірка: продаж ↔ закупівля» (макет 2026-10-20): таблиця, згрупована за видатковими — рядок-заголовок
// з підсумком накладної, під ним позиції: що продали → з якої прихідної собівартість → дати → маржа → недоліки.
// Клік по рядку з недоліком — джерело/кандидати і дії (взяти з прихідної, дата оприбуткування, об'єднати картки).
const money = (v) => `${v < 0 ? '−' : ''}${fmtInt(v)}`
const num = (v, dp = 0) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('uk-UA', { minimumFractionDigits: dp, maximumFractionDigits: dp })
const PAGE = 50
const BADGE = {
  ok: { background: 'var(--green-bg)', color: 'var(--green)' },
  warn: { background: 'var(--amber-bg)', color: 'var(--amber)' },
  bad: { background: 'var(--red-bg)', color: 'var(--red)' },
}
const CELL = { r: { background: 'var(--red-bg)', color: 'var(--red)', fontWeight: 600 }, a: { background: 'var(--amber-bg)', color: 'var(--amber)', fontWeight: 600 }, g: { color: 'var(--green)', fontWeight: 600 } }
const FLAG = { r: BADGE.bad, a: BADGE.warn, g: BADGE.ok }
const FILTERS = [['all', 'Усі'], ['bad', 'Тільки з недоліками'], ['mdate', 'Дата руху ≠ дата видаткової'], ['late', 'Прихід пізніше'], ['none', 'Немає приходу'], ['name', 'Інша назва / картка'], ['unit', 'Одиниці'], ['marg', 'Підозріла маржа'], ['vat', 'Розбіжність ПДВ'], ['broken', 'Рядок змінився']]
const COLS = [
  // [ключ сортування, заголовок, вирівнювання, група-роздільник]
  [null, '№'], ['saleName', 'Товар у видатковій'], ['qty', 'К-сть', 'r'], ['salePrice', 'Ціна прод. / од.', 'r', false, 'без ПДВ'],
  ['purName', 'Товар у прихідній', null, true], ['purDocNo', 'Прихідна · постачальник'], ['purQty', 'К-сть', 'r'], ['costUnit', 'Ціна закуп. / од.', 'r', false, 'без ПДВ'], ['vat', 'ПДВ'],
  ['inDate', 'Прихід', 'r', true], ['shipDate', 'Відвант.', 'r'], ['days', 'Днів на складі', 'r'],
  ['marginUnit', 'На од.', 'r', true], ['marginSum', 'Сума', 'r'], ['marginPct', '%', 'r'],
  [null, 'Недоліки', null, true],
]
const sep = { borderLeft: '2px solid var(--border)' }
const th = { position: 'sticky', top: 0, background: 'var(--surface2)', zIndex: 1, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--text3)', padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'left' }
const td = { padding: '7px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', fontSize: 13 }
const r = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const linkBtn = { background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--text3)', textUnderlineOffset: 2 }

export default function ShipmentRecon() {
  const { user } = useUser()
  const canEdit = ['admin', 'accountant'].includes(user?.role)
  const [params, setParams] = useSearchParams()
  const wantDoc = params.get('doc')
  const wantLine = params.get('line')   // з «Задач»: відкрити цю проблему в інбоксі
  const year = todayKyiv().slice(0, 4)
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(todayKyiv())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState(wantDoc ? 'all' : 'all')
  const [shown, setShown] = useState(PAGE)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [toast, setToast] = useState(null)
  const [closed, setClosed] = useState(() => new Set())
  const [openRow, setOpenRow] = useState(null)   // ключ рядка з розгорнутим «Джерело / дії»
  const [sort, setSort] = useState({ key: null, dir: 1 })
  const [drawer, setDrawer] = useState(null)     // { doc, mode, line, src }
  const [dialog, setDialog] = useState(null)     // { doc, type, line, src, link, log }
  const [docModal, setDocModal] = useState(null)
  const [merges, setMerges] = useState([])
  const [mism, setMism] = useState(null)        // розбіжності дат (077)
  const [datesDlg, setDatesDlg] = useState(false)
  const [tab, setTab] = useState(wantDoc ? 'table' : 'inbox')   // «Проблеми» (інбокс) | «Таблиця»

  const load = async () => {
    setLoading(true); setErr(null)
    try { setData(await loadRecon(from, to)) } catch (e) { setErr(e.message) } finally { setLoading(false) }
    loadRecentMerges().then(setMerges)
    loadDateMismatches().then(setMism)
  }
  // ?doc=… — показати цю видаткову (якщо раніша за період — розширити період)
  useEffect(() => {
    if (!wantDoc) { load(); return }
    supabase.from('documents').select('doc_date, created_at, doc_number').eq('id', wantDoc).maybeSingle().then(({ data: d }) => {
      const dd = d?.doc_date || d?.created_at?.slice(0, 10)
      if (d?.doc_number) setSearch(d.doc_number)
      if (dd && dd < from) setFrom(dd.slice(0, 4) + '-01-01')
      else load()
    })
  }, [])
  useEffect(() => { if (data || wantDoc) load() }, [from, to])

  // усі рядки (позиції) з аналізом
  const allRows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return sortDocs(data.docs)
      .filter(d => !q || `${d.number} ${d.contractor} ${d.orderNo || ''} ${d.lines.map(l => l.name).join(' ')}`.toLowerCase().includes(q))
      .flatMap(d => d.lines.map(l => tableRow(d, l)))
  }, [data, search])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, allRows.filter(x => k === 'all' || (k === 'bad' ? x.bad : x.tags[k])).length])), [allRows])
  const rows = useMemo(() => {
    let v = allRows.filter(x => filter === 'all' || (filter === 'bad' ? x.bad : x.tags[filter]))
    if (sort.key) v = v.slice().sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return (typeof x === 'string' ? x.localeCompare(y, 'uk') : x - y) * sort.dir
    })
    return v
  }, [allRows, filter, sort])
  // групи — у порядку першої появи (видаткові з проблемами — першими, далі новіші)
  const groups = useMemo(() => {
    const m = new Map()
    rows.forEach(x => { if (!m.has(x.doc.id)) m.set(x.doc.id, { doc: x.doc, items: [] }); m.get(x.doc.id).items.push(x) })
    return [...m.values()]
  }, [rows])
  const shownGroups = groups.slice(0, shown)
  const kpi = useMemo(() => ({
    n: allRows.length, bad: allRows.filter(x => x.bad).length, late: allRows.filter(x => x.tags.late).length, none: allRows.filter(x => x.tags.none).length,
    est: allRows.filter(x => x.estimated).reduce((s, x) => s + x.costSum, 0),
  }), [allRows])
  const tot = useMemo(() => {
    const rev = rows.reduce((s, x) => s + x.line.saleNet, 0), cost = rows.reduce((s, x) => s + x.costSum, 0)
    return { rev, cost, m: rev - cost }
  }, [rows])

  const problemsN = useMemo(() => data ? buildProblems((data.docs || []).flatMap(d => d.lines.map(l => tableRow(d, l))), data.acks || []).length : 0, [data])
  const toggle = (id) => setClosed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const sortBy = (k) => k && setSort(s => ({ key: k, dir: s.key === k ? -s.dir : 1 }))
  const done = async (text) => { setToast(text); setDialog(null); setDrawer(null); await load() }
  const openDoc = (id) => loadDocFull(id).then(setDocModal)

  const exportXlsx = async () => {
    const XLSX = await import('xlsx')
    const head = ['Видаткова', 'Дата', 'Клієнт', 'Замовлення', '№', 'Товар у видатковій', 'Артикул', 'К-сть', 'Од.', 'Ціна прод./од. без ПДВ', 'Сума продажу без ПДВ',
      'Товар у прихідній', 'Прихідна', 'Постачальник', 'К-сть у прихідній', 'Од. прихідної', 'Ціна закуп./од. (в од. продажу) без ПДВ', 'Собівартість', 'ПДВ у прихідній',
      'Прихід (оприбуткування)', 'Відвантаження', 'Днів на складі', 'Маржа на од.', 'Маржа сума', 'Маржа %', 'Джерело', 'Недоліки']
    const body = rows.map(x => [x.doc.number, x.doc.date, x.doc.contractor, x.doc.orderNo || '', x.lineNo, x.saleName, x.saleSku, x.qty, x.saleUnit, round2(x.salePrice), round2(x.line.saleNet),
      x.purName || '', x.purDocNo || '', x.supplier || '', x.purQty ?? '', x.purUnit || '', round2(x.costUnit), round2(x.costSum), x.vat || '',
      x.inDate || '', x.shipDate || '', x.days ?? '', round2(x.marginUnit), round2(x.marginSum), x.marginPct == null ? '' : Math.round(x.marginPct * 10) / 10,
      x.service ? 'послуга' : x.fromBatch ? (x.src?.how ? HOW_LABEL[x.src.how] || x.src.how : 'FIFO') : x.src ? 'кандидат' : '', x.flags.map(f => f.text).join('; ')])
    const ws = XLSX.utils.aoa_to_sheet([head, ...body])
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: head.length - 1 } }) }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Звірка')
    XLSX.writeFile(wb, `Звірка продаж-закупівля ${from}_${to}.xlsx`)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{tab === 'inbox' ? 'Проблеми звірки' : 'Звірка: продаж ↔ закупівля'}</h1>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}><Link to="/inventory">Склад</Link> → Звірка видаткових · згруповано за видатковими; клік по заголовку — згорнути / розгорнути</div>
        </div>
        <button className="btn" onClick={load} disabled={loading}><i className="ti ti-refresh" /> {loading ? 'Рахую… (до хвилини)' : 'Оновити'}</button>
      </div>
      {data?.needs076 && <div className="card" style={{ background: 'var(--amber-bg)', color: 'var(--amber)', marginBottom: 12 }}>Міграцію 076 ще не застосовано: ручні прив'язки, дати оприбуткування і дії недоступні; показано звичайний FIFO.</div>}
      {toast && <div className="card" style={{ background: 'var(--green-bg)', color: 'var(--green)', marginBottom: 12, display: 'flex', gap: 10 }}><span style={{ flex: 1 }}>{toast}</span><button className="btn btn-sm" onClick={() => setToast(null)}>✕</button></div>}
      {err && <div className="card" style={{ color: 'var(--red)', marginBottom: 12 }}>Помилка: {err}</div>}
      {mism && (mism.mirror?.length > 0 || mism.outs?.length > 0) && (
        <div className="card" style={{ background: 'var(--amber-bg)', color: 'var(--amber)', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>⚠ Розбіжності дат: {mism.outs.length} видатков. — дата руху складу ≠ даті видаткової (FIFO рахує на дату руху){mism.mirror.length ? `; ${mism.mirror.length} док. — дата в «Документах» ≠ надрукованій` : ''}. Звірка вже показує дату видаткової; вирівняйте, щоб так рахував і FIFO.</span>
          <button className="btn btn-sm" onClick={() => setDatesDlg(true)}>Переглянути{canEdit ? ' й вирівняти' : ''}</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        {[['inbox', `Проблеми${data ? ` (${problemsN})` : ''}`, 'ti-inbox'], ['table', 'Таблиця', 'ti-table']].map(([k, l, ic]) => (
          <button key={k} onClick={() => setTab(k)} style={{ background: 'none', border: 0, borderBottom: '2px solid ' + (tab === k ? 'var(--text)' : 'transparent'), padding: '8px 14px', font: 'inherit', fontWeight: tab === k ? 700 : 500, color: tab === k ? 'var(--text)' : 'var(--text3)', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}><i className={`ti ${ic}`} />{l}</button>
        ))}
      </div>
      {tab === 'inbox' && (data
        ? <ReconInbox data={data} initialLine={wantLine} canEdit={canEdit} reload={load} onDialog={setDialog} onDates={() => setDatesDlg(true)} onOpenDoc={openDoc} />
        : <div className="card" style={{ color: 'var(--text3)' }}>{loading ? 'Рахую сухий прогін FIFO… (до хвилини)' : 'Немає даних.'}</div>)}
      {tab === 'table' && <>
      <div className="compact" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input type="date" className="form-input" value={from} onChange={e => e.target.value && setFrom(e.target.value)} style={{ width: 150 }} title="Відвантаження з" />
        <input type="date" className="form-input" value={to} onChange={e => e.target.value && setTo(e.target.value)} style={{ width: 150 }} title="по" />
        <input className="form-input" placeholder="№, контрагент або товар…" value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE) }} style={{ width: 230 }} />
        {FILTERS.map(([k, l]) => (
          <button key={k} className={'btn btn-sm' + (filter === k ? ' btn-primary' : '')} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999 }} onClick={() => { setFilter(k); setShown(PAGE) }}>{l} ({counts[k] || 0})</button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setClosed(new Set(groups.map(g => g.doc.id)))}>Згорнути всі</button>
        <button className="btn btn-sm" onClick={() => setClosed(new Set())}>Розгорнути всі</button>
        <button className="btn btn-sm" onClick={exportXlsx} disabled={!rows.length}><i className="ti ti-download" /> Excel</button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {[[kpi.n, 'позицій'], [kpi.bad, 'з недоліками', 'var(--red)'], [kpi.late, 'прихід пізніше продажу'], [kpi.none, 'без приходу'], [money(kpi.est), 'собівартість-оцінка, грн']].map(([v, l, c]) => (
          <div key={l} className="card" style={{ padding: '8px 14px', margin: 0 }}><b style={{ display: 'block', fontSize: 17, color: c }}>{v}</b><span style={{ fontSize: 12, color: 'var(--text3)' }}>{l}</span></div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
        <span><span style={{ ...CELL.r, display: 'inline-block', width: 12, height: 12, borderRadius: 3, verticalAlign: -2, marginRight: 4 }} />помилка: прихід пізніше продажу, немає приходу, збиток, собівартість = ціні продажу, рядок змінився</span>
        <span><span style={{ ...CELL.a, display: 'inline-block', width: 12, height: 12, borderRadius: 3, verticalAlign: -2, marginRight: 4 }} />перевірити: інша назва / картка, одиниці, маржа &lt;5% або &gt;60%, оцінка ⚠, розбіжність ПДВ</span>
      </div>
      {!canEdit && <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 8 }}>Перегляд: змінювати прив'язки, дати й картки можуть лише адміністратор або бухгалтер.</div>}

      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '72vh' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 1500 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'center' }} colSpan={4}>Продаж (видаткова)</th>
              <th style={{ ...th, ...sep, textAlign: 'center' }} colSpan={5}>Закупівля (прихідна)</th>
              <th style={{ ...th, ...sep, textAlign: 'center' }} colSpan={3}>Дати</th>
              <th style={{ ...th, ...sep, textAlign: 'center' }} colSpan={3}>Маржа</th>
              <th style={{ ...th, ...sep }} />
            </tr>
            <tr>
              {COLS.map(([k, label, align, isSep, sub], i) => (
                <th key={i} onClick={() => sortBy(k)} style={{ ...th, top: 33, cursor: k ? 'pointer' : 'default', ...(align === 'r' ? { textAlign: 'right' } : {}), ...(isSep ? sep : {}) }}>
                  {label}{sort.key === k && k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}{sub && <div style={{ textTransform: 'none', fontSize: 10.5 }}>{sub}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data && loading && <tr><td colSpan={16} style={{ ...td, color: 'var(--text3)' }}>Рахую сухий прогін FIFO…</td></tr>}
            {data && !groups.length && <tr><td colSpan={16} style={{ ...td, color: 'var(--text3)' }}>Нічого не знайдено.</td></tr>}
            {shownGroups.map(g => {
              const d = g.doc, open = !closed.has(d.id)
              const rev = g.items.reduce((s, x) => s + x.line.saleNet, 0), cost = g.items.reduce((s, x) => s + x.costSum, 0), m = rev - cost
              const nb = g.items.filter(x => x.bad).length, red = g.items.some(x => x.flags.some(f => f.level === 'r'))
              return (
                <Fragment key={d.id}>
                  <tr onClick={() => toggle(d.id)} style={{ cursor: 'pointer' }}>
                    <td colSpan={16} style={{ ...td, background: 'var(--surface2)', borderBottom: '1px solid var(--border2, var(--border))' }}>
                      <div style={{ position: 'sticky', left: 10, maxWidth: 'calc(100vw - 120px)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                        <span style={{ width: 14, color: 'var(--text3)' }}>{open ? '▾' : '▸'}</span>
                        <button style={{ ...linkBtn, fontSize: 14 }} onClick={e => { e.stopPropagation(); setDrawer({ doc: d, mode: 'sale' }) }}>{d.number} від {dmy(d.date)}</button>
                        <span style={{ color: 'var(--text3)' }}>{d.contractor}{d.orderId ? <> · <Link to={`/orders/${d.orderId}`} onClick={e => e.stopPropagation()}>№{d.orderNo || '—'}</Link></> : ''} · {g.items.length} поз.</span>
                        <span style={{ flex: 1 }} />
                        <span>Продаж <b>{money(rev)}</b></span><span>Собівартість <b>{money(cost)}</b></span>
                        <span>Маржа <b style={{ color: m < 0 ? 'var(--red)' : 'var(--green)' }}>{money(m)} · {rev ? num(m / rev * 100, 1) : '—'}%</b></span>
                        {nb ? <span className="badge" style={{ ...(red ? BADGE.bad : BADGE.warn), fontWeight: 700 }}>{nb} з недоліками</span> : <span className="badge" style={{ ...BADGE.ok, fontWeight: 700 }}>✓ ок</span>}
                        <button className="btn btn-sm" style={{ padding: '2px 10px', fontSize: 12 }} onClick={e => { e.stopPropagation(); setDrawer({ doc: d, mode: 'sale' }) }}><i className="ti ti-file-text" /> Документи</button>
                      </div>
                      {open && d.tip && <div style={{ position: 'sticky', left: 10, maxWidth: 'calc(100vw - 120px)', background: 'var(--amber-bg)', color: 'var(--amber)', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, marginTop: 6 }}>{d.tip}</div>}
                      {open && d.brokenLinks?.map(l => (
                        <div key={l.id} onClick={e => e.stopPropagation()} style={{ position: 'sticky', left: 10, maxWidth: 'calc(100vw - 120px)', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, marginTop: 6, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ flex: 1 }}>⚠ Рядок прихідної/видаткової змінився — перевірте прив'язку: «{l.productName}» ← прихідна № {l.inDocNo}, {l.qty}.</span>
                          {canEdit && <button className="btn btn-sm" onClick={() => setDialog({ doc: d, type: 'unlink', link: l, line: { name: l.productName, unit: '' }, src: { docNo: l.inDocNo } })}>Зняти прив'язку</button>}
                        </div>
                      ))}
                    </td>
                  </tr>
                  {open && g.items.map(x => (
                    <Fragment key={x.key}>
                      <Row x={x} open={openRow === x.key} onToggle={() => setOpenRow(o => o === x.key ? null : x.key)}
                        onSale={() => setDrawer({ doc: d, mode: 'sale', line: x.line })} onRec={() => setDrawer({ doc: d, mode: 'rec', line: x.line, src: x.src })} />
                      {openRow === x.key && (
                        <tr><td colSpan={16} style={{ ...td, background: 'var(--surface2)' }}>
                          <div style={{ position: 'sticky', left: 10, maxWidth: 'calc(100vw - 120px)' }}>
                            <Details doc={d} line={x.line} canEdit={canEdit} onDrawer={(o) => setDrawer({ doc: d, ...o })} onDialog={(o) => setDialog({ doc: d, ...o })} />
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...td, position: 'sticky', bottom: 0, background: 'var(--surface2)', fontWeight: 700 }} colSpan={3}>Разом ({rows.length} рядків)</td>
              <td style={{ ...td, ...r, position: 'sticky', bottom: 0, background: 'var(--surface2)', fontWeight: 700 }}>{money(tot.rev)}</td>
              <td style={{ ...td, ...sep, position: 'sticky', bottom: 0, background: 'var(--surface2)' }} colSpan={3} />
              <td style={{ ...td, ...r, position: 'sticky', bottom: 0, background: 'var(--surface2)', fontWeight: 700 }}>{money(tot.cost)}</td>
              <td style={{ ...td, position: 'sticky', bottom: 0, background: 'var(--surface2)' }} />
              <td style={{ ...td, ...sep, position: 'sticky', bottom: 0, background: 'var(--surface2)' }} colSpan={3} />
              <td style={{ ...td, ...sep, position: 'sticky', bottom: 0, background: 'var(--surface2)' }} />
              <td style={{ ...td, ...r, position: 'sticky', bottom: 0, background: 'var(--surface2)', fontWeight: 700, color: tot.m < 0 ? 'var(--red)' : undefined }}>{money(tot.m)}</td>
              <td style={{ ...td, ...r, position: 'sticky', bottom: 0, background: 'var(--surface2)', fontWeight: 700 }}>{tot.rev ? num(tot.m / tot.rev * 100, 1) : '—'}%</td>
              <td style={{ ...td, ...sep, position: 'sticky', bottom: 0, background: 'var(--surface2)' }} />
            </tr>
          </tfoot>
        </table>
      </div>
      {groups.length > shown && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setShown(s => s + PAGE)}>Завантажити ще ({groups.length - shown} видаткових)</button>}
      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
        Собівартість — як буде після «Застосувати FIFO» (без ПДВ): 1) ручна прив'язка, 2) прихідна того ж замовлення, 3) FIFO на дату оприбуткування, 4) оцінка ⚠ (поточна собівартість), не 0.
        Якщо одиниці різні (км ↔ м), ціна закупівлі переведена в одиницю продажу. Клік по номеру документа — перегляд видаткової / прихідної; клік по рядку — джерело, кандидати й дії. Заголовки колонок сортують таблицю.
      </p>
      {merges.length > 0 && (
        <div className="card" style={{ marginTop: 14, fontSize: 12.5 }}>
          <b>Останні об'єднання карток</b>
          {merges.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid var(--border)' }}>
              <span>{new Date(m.created_at).toLocaleString('uk-UA')}</span>
              <span style={{ color: 'var(--text2)' }}>«{m.before?.dup?.name}» → «{m.before?.keep?.name}»</span>
              {canEdit && <button className="btn btn-sm" onClick={() => setDialog({ doc: null, type: 'unmerge', log: m })}>Скасувати об'єднання</button>}
            </div>
          ))}
        </div>
      )}
      </>}
      {datesDlg && mism && <DatesDialog mism={mism} canEdit={canEdit} onClose={() => setDatesDlg(false)} onDone={async (t) => { setDatesDlg(false); await done(t) }} />}
      {drawer && <DocsDrawer {...drawer} canEdit={canEdit} onClose={() => setDrawer(null)} onDialog={(o) => setDialog({ doc: drawer.doc, ...o })} onOpenDoc={openDoc} />}
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} onDone={done} />}
      {docModal && <DocModal user={user} existingDoc={docModal} autoOcr={false} onClose={() => setDocModal(null)} onSaved={() => { setDocModal(null); load() }} />}
    </div>
  )
}
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const sumCost = (movs) => (movs || []).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.cost_price) || 0), 0)

// ───────── Вирівняти дати: дзеркало = надрукована дата; рухи видачі = дата видаткової ─────────
function DatesDialog({ mism, canEdit, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const rowsOf = (list, kind) => list.map((x, i) => (
    <tr key={kind + i} style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '4px 6px' }}>{x.doc_number || '—'}</td>
      <td style={{ padding: '4px 6px', color: 'var(--text3)' }}>{kind === 'mirror' ? 'дата в «Документах»' : `рух складу${x.movements > 1 ? ` (${x.movements})` : ''}`}</td>
      <td style={{ padding: '4px 6px', ...r }}>{dmy(x.old_date)}</td>
      <td style={{ padding: '4px 6px', ...r, fontWeight: 600 }}>→ {dmy(x.new_date)}</td>
      <td style={{ padding: '4px 6px', color: 'var(--red)', fontSize: 12 }}>{x.closed ? 'закритий місяць — пропуск' : ''}</td>
    </tr>
  ))
  const run = async () => {
    if (!window.confirm('Вирівняти дати? Дата в «Документах» стане надрукованою датою, рухи видачі — датою видаткової. Собівартість при цьому не перераховується (лише «Застосувати FIFO»). Закриті місяці пропускаються. Дія пишеться в журнал.')) return
    setBusy(true); setErr(null)
    try { const res = await syncDocDates(); await onDone(`Дати вирівняно: документів ${res.mirror_fixed}, рухів видачі ${res.out_movements_fixed}${res.left_closed ? `; у закритих місяцях лишилось ${res.left_closed}` : ''}.`) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '96%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header"><h2 style={{ margin: 0, fontSize: 17 }}>Розбіжності дат видаткових</h2><button className="btn" onClick={onClose} disabled={busy}><i className="ti ti-x" /></button></div>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 0 }}>Дата відвантаження — дата, надрукована у видатковій. Рух складу отримує дату при створенні документа; якщо дату документа потім змінили, рух лишався зі старою — і FIFO вважав, що товар відвантажено раніше.</p>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr style={{ color: 'var(--text3)', fontSize: 12 }}><th style={{ textAlign: 'left' }}>Документ</th><th style={{ textAlign: 'left' }}>Що</th><th style={{ textAlign: 'right' }}>Було</th><th style={{ textAlign: 'right' }}>Стане</th><th /></tr></thead>
          <tbody>{rowsOf(mism.mirror || [], 'mirror')}{rowsOf(mism.outs || [], 'outs')}</tbody>
        </table>
        {err && <p style={{ color: 'var(--red)' }}>Помилка: {err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose} disabled={busy}>Закрити</button>
          {canEdit && <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Вирівнюю…' : 'Вирівняти дати'}</button>}
        </div>
      </div>
    </div>
  )
}

// ───────── Рядок таблиці ─────────
function Row({ x, open, onToggle, onSale, onRec }) {
  const c = (k) => x.cls[k] ? CELL[x.cls[k]] : {}
  const stop = (fn) => (e) => { e.stopPropagation(); fn() }
  return (
    <tr onClick={onToggle} style={{ cursor: 'pointer', background: open ? 'var(--surface2)' : undefined }} title="Джерело, кандидати й дії">
      <td style={{ ...td, ...r, paddingLeft: 22, color: 'var(--text3)', fontSize: 11.5 }}>{x.lineNo}</td>
      <td style={td}>{x.saleName}{x.saleSku && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{x.saleSku}</div>}</td>
      <td style={{ ...td, ...r }}>{num(x.qty, x.qty % 1 ? 3 : 0)} {x.saleUnit}</td>
      <td style={{ ...td, ...r }}>{num(x.salePrice, 2)}</td>
      <td style={{ ...td, ...sep, ...c('nr') }}>{x.service ? <span style={{ color: 'var(--text3)' }}>послуга</span> : x.purName ?? '—'}</td>
      <td style={{ ...td, ...c('rd') }}>{x.purDocNo ? <><button style={linkBtn} onClick={stop(onRec)}>№{x.purDocNo}</button>{!x.fromBatch && <span style={{ fontSize: 11, color: 'var(--text3)' }}> · кандидат</span>}<div style={{ fontSize: 11, color: 'var(--text3)' }}>{x.supplier}</div></> : '—'}</td>
      <td style={{ ...td, ...r, ...c('ur') }}>{x.purQty == null ? '—' : `${num(x.purQty, x.purQty % 1 ? 3 : 0)} ${x.purUnit || ''}`}</td>
      <td style={{ ...td, ...r, ...c('pc') }}>
        {x.service ? '—' : num(x.costUnit, 2)}
        {x.purUnit && x.purPriceRaw != null && x.purUnit !== x.saleUnit && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{num(x.purPriceRaw, 0)} / {x.purUnit}</div>}
        {x.estimated && <div style={{ fontSize: 11 }}>оцінка</div>}
      </td>
      <td style={{ ...td, ...c('vat') }}>{x.vat ?? '—'}</td>
      <td style={{ ...td, ...r, ...sep, ...c('dr') }}>{x.inDate ? dmy(x.inDate) : '—'}</td>
      <td style={{ ...td, ...r }}><button style={{ ...linkBtn, fontWeight: 400 }} onClick={stop(onSale)}>{dmy(x.shipDate)}</button></td>
      <td style={{ ...td, ...r, ...c('days') }}>{x.days == null ? '—' : x.days}</td>
      <td style={{ ...td, ...r, ...sep, ...c('m') }}>{x.service ? '—' : num(x.marginUnit, 2)}</td>
      <td style={{ ...td, ...r, ...c('m') }}>{money(x.marginSum)}</td>
      <td style={{ ...td, ...r, ...c('m') }}>{x.marginPct == null ? '—' : num(x.marginPct, 1) + '%'}</td>
      <td style={{ ...td, ...sep }}>
        {x.flags.length ? x.flags.map((f, i) => <span key={i} className="badge" style={{ ...FLAG[f.level], fontWeight: 700, fontSize: 11, margin: '0 3px 3px 0', display: 'inline-block' }}>{f.text}</span>)
          : <span className="badge" style={{ ...BADGE.ok, fontWeight: 700, fontSize: 11 }}>✓ ок</span>}
      </td>
    </tr>
  )
}

// ───────── Розгорнутий рядок: ПДВ / одиниці, партії-джерела, кандидати, дії ─────────
function Details({ doc, line: l, canEdit, onDrawer, onDialog }) {
  return (
    <div>
      {l.vatMismatch && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>⚠ розбіжність ПДВ: прихідні {l.vatMismatch.docs.map(d => `№ ${d.number} (${d.vat ? 'з ПДВ' : 'без ПДВ'})`).join(', ')} ↔ платежі {l.vatMismatch.pays.filter(p => p.vat !== undefined).map(p => `${dmy(p.date)} «${(p.text || '').slice(0, 60)}»`).join(', ')}. Собівартість — за прихідною.</div>}
      {l.unitIssues.length > 0 && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>⚠ одиниці виміру: {l.unitIssues.join('; ')}</div>}
      {l.sources.map((s, i) => <SourceBox key={'s' + i} doc={doc} line={l} src={s} used canEdit={canEdit} onDrawer={onDrawer} onDialog={onDialog} />)}
      {l.candidates.map((c, i) => <SourceBox key={'c' + i} doc={doc} line={l} src={c} best={i === 0} canEdit={canEdit} onDrawer={onDrawer} onDialog={onDialog} />)}
      {!l.service && !l.sources.length && !l.candidates.length && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Кандидатів немає: немає ні приходу цього товару, ні схожої картки з приходом. Проведіть прихідну на склад (Документи → «Рух на складі»).</div>}
      {l.service && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Послуга — собівартість товарів не рахується.</div>}
    </div>
  )
}

function SourceBox({ line: l, src: s, used, best, canEdit, onDrawer, onDialog }) {
  const link = used && s.how === 'manual' ? l.links.find(x => x.in_id === s.inId) : null
  return (
    <div style={{ border: (best || used ? '1px solid ' : '1px dashed ') + 'var(--border)', background: used || best ? 'var(--surface)' : 'transparent', borderRadius: 10, padding: '8px 10px', margin: '3px 0', display: 'grid', gridTemplateColumns: 'minmax(180px, 1.6fr) minmax(120px, 1fr) minmax(90px, .8fr) minmax(70px, .6fr) auto', gap: 10, alignItems: 'center', fontSize: 13 }}>
      <div>
        <span style={{ fontSize: 11, color: 'var(--text3)', display: 'block' }}>{used ? `Списано з партії · ${HOW_LABEL[s.how] || s.how}${s.qty ? ` · ${s.qty} ${l.unit}` : ''}` : s.kind === 'order' ? 'Кандидат · те саме замовлення' : s.kind === 'other' ? 'Кандидат · ⧉ інша картка' : 'Кандидат'}</span>
        {s.inDocId ? <button onClick={() => onDrawer({ mode: 'rec', line: l, src: s })} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>Прихідна № {s.docNo}</button> : <b>Прихід без документа</b>}
        {s.inLine != null && <span style={{ fontSize: 12, color: 'var(--text3)' }}> · рядок {s.inLine}</span>}
        {' · '}{s.supplier}
        {s.inDocId && <div><button onClick={() => onDrawer({ mode: 'both', line: l, src: s })} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', color: 'var(--text2)' }}><i className="ti ti-file-text" /> порівняти з видатковою</button></div>}
        {s.otherCard && <div style={{ fontSize: 12, color: 'var(--amber)' }}>⧉ на іншій картці: «{s.inProductName}»{s.inProductSku ? ` (${s.inProductSku})` : ', артикул не вказано'}</div>}
      </div>
      <div>
        <span style={{ fontSize: 11, color: 'var(--text3)', display: 'block' }}>Документ / оприбуткування</span>
        <b>{dmy(s.docDate)}</b> / <b>{dmy(s.whDate)}</b>
        <div style={{ fontSize: 12, fontWeight: 600, color: s.late ? 'var(--amber)' : 'var(--green)' }}>{s.late ? 'пізніше відвантаження' : 'раніше відвантаження'}</div>
      </div>
      <div><span style={{ fontSize: 11, color: 'var(--text3)', display: 'block' }}>Ціна без ПДВ</span><b>{money(s.unit)}</b>{!used && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>вільно {s.free}</div>}</div>
      <div><span style={{ fontSize: 11, color: 'var(--text3)', display: 'block' }}>ПДВ у прихідній</span><b>{s.vat == null ? '—' : s.vat ? 'так' : 'ні'}</b></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {used ? <>
          <span className="badge" style={{ ...BADGE.ok, fontWeight: 600 }}>✓ використано</span>
          {link && canEdit && <button className="btn btn-sm" onClick={() => onDialog({ type: 'unlink', line: l, src: s, link })}>Зняти прив'язку</button>}
        </> : canEdit && <>
          {s.otherCard
            ? <button className="btn btn-sm btn-primary" onClick={() => onDialog({ type: 'merge', line: l, src: s })}>Порівняти й об'єднати картки</button>
            : s.inDocId && <button className="btn btn-sm btn-primary" disabled={!(s.free > 0)} title={s.free > 0 ? '' : 'партію вже використано повністю'} onClick={() => onDialog({ type: 'take', line: l, src: s })}>Взяти з цієї прихідної</button>}
          {s.late && s.inDocId && !s.otherCard && <button className="btn btn-sm" onClick={() => onDialog({ type: 'date', line: l, src: s })}>Виправити дату оприбуткування</button>}
        </>}
      </div>
    </div>
  )
}

// ───────── Перегляд документів (бічна панель) ─────────
function DocsDrawer({ doc, mode: initMode, line, src, canEdit, onClose, onDialog, onOpenDoc }) {
  const [mode, setMode] = useState(initMode)
  const [sale, setSale] = useState(null)
  const [rec, setRec] = useState(null)
  useEffect(() => { loadPaper(doc.id).then(setSale) }, [doc.id])
  useEffect(() => { if (src?.inDocId) loadPaper(src.inDocId).then(setRec) }, [src?.inDocId])
  const hl = line?.name
  const recHl = src?.inProductName || line?.name
  const dates = src && [['Відвантаження', doc.shipDate], ['Документ постачальника', src.docDate], ['Оприбуткування', src.whDate]]
  const latest = dates ? dates.map(x => x[1]).sort().slice(-1)[0] : null
  return (
    <div className="modal-bg" onClick={onClose} style={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', width: 'min(1100px, 100%)', maxWidth: '100%', flexBasis: '75%', minWidth: 'min(100%, 360px)', height: '100%', overflow: 'auto', padding: '18px 20px', boxShadow: '-10px 0 30px rgba(0,0,0,.12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div><h2 style={{ margin: 0, fontSize: 18 }}>Документи</h2><div style={{ fontSize: 13, color: 'var(--text3)' }}>{line?.name || `${doc.number} від ${dmy(doc.date)}`}</div></div>
          <button className="btn" onClick={onClose}><i className="ti ti-x" /> Закрити</button>
        </div>
        <div style={{ display: 'flex', gap: 6, margin: '12px 0 14px' }}>
          {[['sale', 'Видаткова'], ...(src?.inDocId ? [['rec', 'Прихідна'], ['both', 'Поруч']] : [])].map(([k, l]) => (
            <button key={k} className={'btn btn-sm' + (mode === k ? ' btn-primary' : '')} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
        {mode === 'both' && dates && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {dates.map(([l, d]) => <div key={l} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '6px 12px', fontSize: 13, background: d === latest && dates.filter(x => x[1] === latest).length < 3 ? 'var(--amber-bg)' : undefined }}>{l}: <b>{dmy(d)}</b></div>)}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: mode === 'both' ? 'repeat(auto-fit, minmax(320px, 1fr))' : 'minmax(0, 1fr)', gap: 14 }}>
          {(mode === 'sale' || mode === 'both') && <Paper paper={sale} hl={hl} onOpenDoc={onOpenDoc} />}
          {(mode === 'rec' || mode === 'both') && <Paper paper={rec} hl={recHl} isRec src={src} onOpenDoc={onOpenDoc} />}
        </div>
        {line && src && canEdit && !src.how && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {src.otherCard
              ? <button className="btn btn-primary" onClick={() => onDialog({ type: 'merge', line, src })}>Порівняти й об'єднати картки</button>
              : <button className="btn btn-primary" disabled={!(src.free > 0)} onClick={() => onDialog({ type: 'take', line, src })}>Взяти з цієї прихідної</button>}
            {src.late && !src.otherCard && <button className="btn" onClick={() => onDialog({ type: 'date', line, src })}>Виправити дату оприбуткування</button>}
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text3)' }}>Підсвічено рядок, який звіряється.</p>
      </div>
    </div>
  )
}

async function loadPaper(docId) {
  const [d, lines] = await Promise.all([loadDocFull(docId), loadDocLines(docId)])
  let scan = null
  const path = d?.storage_path || d?.file_path
  if (path) {
    const { data: blob } = await supabase.storage.from('documents').download(path).catch(() => ({ data: null }))
    if (blob) scan = { url: URL.createObjectURL(blob), pdf: /pdf/i.test(d.file_type || blob.type || path) }
  }
  // пов'язані оплати прихідної
  let pays = []
  const { data: tds } = await supabase.from('transaction_documents').select('transaction_id, amount').eq('document_id', docId)
  const txIds = (tds || []).map(t => t.transaction_id).filter(Boolean)
  if (txIds.length) {
    const { data: txs } = await supabase.from('bank_transactions').select('id, date, amount, description').in('id', txIds)
    pays = txs || []
  }
  return { doc: d, lines, scan, pays }
}

function Paper({ paper, hl, isRec, src, onOpenDoc }) {
  const [big, setBig] = useState(false)
  if (!paper) return <div className="card" style={{ color: 'var(--text3)' }}>Завантаження…</div>
  const { doc: d, lines, scan, pays } = paper
  if (!d) return <div className="card" style={{ color: 'var(--text3)' }}>Документ не знайдено</div>
  const vat = Math.abs(Number(d.vat_amount) || 0) > 0.005
  const total = lines.reduce((s, x) => s + (Number(x.sum) || 0), 0)
  const hlName = (n) => hl && (nameScore(hl, n) >= 0.6 || n.toLowerCase().startsWith(hl.toLowerCase().slice(0, 25)))
  return (
    <div className="card" style={{ padding: 14 }}>
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{isRec ? 'Прихідна' : 'Видаткова'}</span>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>№ {d.doc_number || '—'} від {dmy(d.doc_date || d.created_at)}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: 13, marginBottom: 10 }}>
        <span style={{ color: 'var(--text3)' }}>{isRec ? 'Постачальник' : 'Покупець'}</span><b>{d.contractors?.name || '—'}</b>
        {d.ocr_data?.contract && <><span style={{ color: 'var(--text3)' }}>Договір</span><b>{String(d.ocr_data.contract)}</b></>}
        <span style={{ color: 'var(--text3)' }}>Сума</span><b>{money(Math.abs(Number(d.amount) || 0))} {vat ? `(у т.ч. ПДВ ${money(Math.abs(Number(d.vat_amount)))})` : '(без ПДВ)'}</b>
        {isRec && <><span style={{ color: 'var(--text3)' }}>Оприбуткування</span><b>{dmy(d.warehouse_date || src?.whDate || d.doc_date)}{d.warehouse_date ? ' (виправлено)' : ''}</b>
          <span style={{ color: 'var(--text3)' }}>ПДВ</span><b>{vat ? 'з ПДВ' : 'без ПДВ'}</b>
          <span style={{ color: 'var(--text3)' }}>Оплата</span><b>{pays.length ? pays.map(p => `${dmy(p.date)} на ${money(Math.abs(Number(p.amount) || 0))}`).join(', ') : 'не прив\'язано'}</b></>}
      </div>
      <div className="tbl-wrap compact"><table>
        <thead><tr><th>Товар</th><th style={{ textAlign: 'right' }}>К-сть</th><th>Од.</th><th style={{ textAlign: 'right' }}>Ціна</th><th style={{ textAlign: 'right' }}>Сума</th><th>ПДВ</th></tr></thead>
        <tbody>
          {lines.map((x, i) => (
            <tr key={i} style={hlName(x.name) ? { background: 'var(--amber-bg)' } : undefined}>
              <td>{x.name}{x.sku && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{x.sku}</div>}</td>
              <td style={{ textAlign: 'right' }}>{x.qty}</td><td>{x.unit}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(x.price)}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(x.sum)}</td>
              <td>{x.vat != null ? `${x.vat}%` : ''}</td>
            </tr>
          ))}
          {!lines.length && <tr><td colSpan={6} style={{ color: 'var(--text3)' }}>Позиції не розпізнано</td></tr>}
        </tbody>
        {lines.length > 0 && <tfoot><tr><td colSpan={4}><b>Разом (як у документі)</b></td><td style={{ textAlign: 'right' }}><b>{money(total)}</b></td><td /></tr></tfoot>}
      </table></div>
      {scan ? (
        <div style={{ marginTop: 10 }}>
          {scan.pdf
            ? <iframe src={scan.url} title="Скан" style={{ width: '100%', height: big ? '80vh' : 260, border: '1px solid var(--border)', borderRadius: 8 }} />
            : <img src={scan.url} alt="Скан" style={{ width: '100%', maxHeight: big ? '80vh' : 260, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, display: 'block' }} />}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => setBig(b => !b)}>{big ? 'Зменшити' : 'Збільшити'}</button>
            <a className="btn btn-sm" href={scan.url} target="_blank" rel="noreferrer">Відкрити в новій вкладці</a>
            <button className="btn btn-sm" onClick={() => onOpenDoc(d.id)}>Відкрити в «Документах»</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>Скану в системі немає.</span>
          <button className="btn btn-sm" onClick={() => onOpenDoc(d.id)}>Відкрити в «Документах»</button>
        </div>
      )}
    </div>
  )
}

// ───────── Вікна підтвердження дій (було → стане) ─────────
function ActionDialog({ doc, type, line, src, link, log, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [qty, setQty] = useState(() => line && src ? Math.min(line.qty, Math.max(0, src.free ?? line.qty)) : 0)
  const [date, setDate] = useState(line?.shipDate || '')
  const [cards, setCards] = useState(null)
  const [keep, setKeep] = useState(null)
  useEffect(() => {
    if (type !== 'merge') return
    Promise.all([loadCardStats(line.productId), loadCardStats(src.inProductId)]).then(cs => { setCards(cs); setKeep(cs[0].sku || !cs[1].sku ? cs[0].id : cs[1].id) })
  }, [type])
  const run = async (fn, text) => {
    setBusy(true); setErr(null)
    try { const r = await fn(); await onDone(typeof text === 'function' ? text(r) : text) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const newCost = (r) => { const m = r?.movements || []; return m.length ? ` Собівартість рядка тепер ${money(sumCost(m))} грн (без ПДВ)${m.some(x => Number(x.estimated) > 0) ? ', частина — оцінка ⚠' : ''}.` : '' }
  const box = { border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 13 }
  let body = null, action = null, title = ''
  if (type === 'take') {
    title = 'Взяти з прихідної?'
    const q = Number(qty) || 0, rest = Math.max(0, line.qty - q)
    body = <>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>Рядок видаткової буде прив'язано до рядка прихідної — незалежно від дат (ідентифікована собівартість).</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '12px 0' }}>
        <div style={box}><span style={{ fontSize: 11, color: 'var(--text3)' }}>Видаткова</span><div><b>{doc.number} від {dmy(doc.date)}</b></div><div>рядок {line.lineNo}: {line.name} · {line.qty} {line.unit} × {money(line.unitPrice)}</div></div>
        <div style={box}><span style={{ fontSize: 11, color: 'var(--text3)' }}>Прихідна</span><div><b>№ {src.docNo} від {dmy(src.docDate)}</b></div><div>{src.inLine != null ? `рядок ${src.inLine}: ` : ''}{src.inProductName || line.name} · {src.qty} × {money(src.unit)}</div><div>{src.supplier}</div><div>вільно в партії: {src.free}</div></div>
      </div>
      <div className="form-group"><label>Кількість</label><input type="number" className="form-input" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} style={{ maxWidth: 160 }} /></div>
      <div style={{ fontSize: 13 }}>Було: <b>{money(line.cost)}</b> → стане: <b>{money(q * src.unit + (line.cost / (line.qty || 1)) * rest)}</b> грн (без ПДВ; {q} × {money(src.unit)}{rest > 0 ? ` + ${rest} без джерела — оцінка/інша прихідна` : ''})</div>
      {rest > 0 && <div style={{ fontSize: 12.5, color: 'var(--amber)', marginTop: 6 }}>Без джерела лишиться {rest} {line.unit} — після цього можна додати другу прихідну.</div>}
      {q > src.free && <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 6 }}>Більше, ніж вільно в партії ({src.free}).</div>}
    </>
    action = () => run(() => linkAdd({ outMov: line.outId, inMov: src.inId, qty: q }), r => `Прив'язано: рядок ${line.lineNo} «${line.name}» ← прихідна № ${src.docNo}${src.inLine != null ? `, рядок ${src.inLine}` : ''}.${newCost(r)}`)
  } else if (type === 'unlink') {
    title = 'Зняти прив\'язку?'
    body = <div style={{ fontSize: 13 }}>
      <div>{line.name}: прихідна № {src.docNo}{src.docDate ? ` від ${dmy(src.docDate)}` : ''}, {link.qty} {line.unit}.</div>
      <div style={{ marginTop: 6 }}>Собівартість рядка повернеться до стану перед прив'язкою (або перерахується за FIFO, якщо рядок змінювали після).</div>
    </div>
    action = () => run(() => linkRemove(link.id), r => `Прив'язку знято${r?.restored_previous ? ' — повернуто попередню собівартість' : ''}.${newCost(r)}`)
  } else if (type === 'date') {
    title = 'Виправити дату оприбуткування'
    const early = date && src.docDate && daysBetween(date, src.docDate) > 30
    body = <>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>Прихідна № {src.docNo} · {src.supplier}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, marginTop: 12 }}><span>Дата документа постачальника</span><b>{dmy(src.docDate)} (не змінюється)</b></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, marginTop: 6, alignItems: 'center' }}><span>Дата оприбуткування: було {dmy(src.whDate)} → стане</span><input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 170 }} /></div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Запропоновано дату відвантаження ({dmy(line.shipDate)}). Вкажіть день, коли товар реально надійшов. Дата не скидається при перезбереженні прихідної.</div>
      {early && <div style={{ fontSize: 12.5, color: 'var(--amber)', marginTop: 6 }}>Увага: нова дата раніша за дату документа постачальника більш ніж на 30 днів.</div>}
    </>
    action = () => run(() => setWarehouseDate(src.inDocId, date, doc.id), r => `Дату оприбуткування прихідної № ${src.docNo}: ${dmy(date)}.${newCost(r)}`)
  } else if (type === 'merge') {
    title = 'Порівняти картки товару'
    const conflict = cards && !skuCompatible(cards[0].sku, cards[1].sku)
    body = !cards ? <div style={{ color: 'var(--text3)' }}>Завантаження…</div> : <>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>Об'єднуйте, лише якщо це той самий товар. Оберіть, яку картку залишити — друга піде в архів, усі її рухи, позиції замовлень і документів перейдуть на залишену. Собівартість уже записаних відвантажень не перераховується автоматично.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '12px 0' }}>
        {cards.map(c => (
          <label key={c.id} style={{ ...box, cursor: conflict ? 'default' : 'pointer', borderColor: keep === c.id ? 'var(--text)' : 'var(--border)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" disabled={conflict} checked={keep === c.id} onChange={() => setKeep(c.id)} /><span style={{ fontSize: 11, color: 'var(--text3)' }}>{keep === c.id ? 'Залишити' : 'Дубль → в архів'}</span></div>
            <b>{c.name}</b>
            {[['Артикул', c.sku || '—'], ['Одиниця', c.unit || '—'], ['Приходів', `${c.receipts} (${c.receiptsQty})`], ['Продажів', `${c.sales} (${c.salesQty})`], ['Залишок', c.stock]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: 'var(--text3)' }}>{k}</span><b>{v}</b></div>
            ))}
          </label>
        ))}
      </div>
      {conflict && <div style={{ fontSize: 13, color: 'var(--red)' }}>Артикули різні й обидва заповнені ({cards[0].sku} і {cards[1].sku}) — це різні товари, об'єднання заборонено.</div>}
    </>
    action = !cards || conflict ? null : () => {
      const dup = cards.find(c => c.id !== keep)
      return run(() => mergeCards(keep, dup.id), () => `Картки об'єднано: «${dup.name}» → «${cards.find(c => c.id === keep).name}». Скасувати можна внизу сторінки.`)
    }
  } else if (type === 'unmerge') {
    title = 'Скасувати об\'єднання карток?'
    body = <div style={{ fontSize: 13 }}>«{log.before?.dup?.name}» знову стане окремою карткою; на неї повернуться саме ті рухи, позиції й документи, що були перенесені при об'єднанні {new Date(log.created_at).toLocaleString('uk-UA')}.</div>
    action = () => run(() => unmergeCards(log.id), 'Об\'єднання скасовано.')
  }
  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose} style={{ zIndex: 1200 }}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2><button className="btn" onClick={onClose} disabled={busy}><i className="ti ti-x" /></button></div>
        {body}
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose} disabled={busy}>Скасувати</button>
          {action && <button className="btn btn-primary" onClick={action} disabled={busy || (type === 'take' && !(Number(qty) > 0)) || (type === 'date' && !date)}>{busy ? '…' : 'Підтвердити'}</button>}
          {type === 'date' && src.whDate !== src.docDate && <button className="btn" disabled={busy} onClick={() => run(() => setWarehouseDate(src.inDocId, null, doc.id), 'Дату оприбуткування повернуто до дати документа.')}>Повернути дату документа</button>}
        </div>
      </div>
    </div>
  )
}

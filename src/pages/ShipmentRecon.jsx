import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmtInt } from '../lib/fmt'
import { todayKyiv, daysBetween } from '../lib/dates'
import {
  loadRecon, sortDocs, STATUS, HOW_LABEL, dmy, linkAdd, linkRemove, setWarehouseDate, mergeCards, unmergeCards,
  loadRecentMerges, loadCardStats, loadDocLines, loadDocFull, skuCompatible, nameScore,
} from '../lib/shipmentRecon'
import DocModal from '../components/DocModal'

// «Склад → Звірка видаткових» (ТЗ 2026-10-20): видаткова → її позиції → партія, з якої списано (або кандидати),
// обидва документи поруч, дії: взяти з прихідної / виправити дату оприбуткування / об'єднати картки.
const money = (v) => `${v < 0 ? '−' : ''}${fmtInt(v)}`
const PAGE = 50
const BADGE = {
  ok: { background: 'var(--green-bg)', color: 'var(--green)' },
  warn: { background: 'var(--amber-bg)', color: 'var(--amber)' },
  bad: { background: 'var(--red-bg)', color: 'var(--red)' },
}
const Badge = ({ status, style }) => (
  <span className="badge" style={{ ...BADGE[STATUS[status].cls], fontWeight: 600, whiteSpace: 'nowrap', ...style }}>{STATUS[status].label}</span>
)
const FILTERS = [['all', 'Усі'], ['broken', '⚠ рядок змінився'], ['late', '⏱ прихід пізніше'], ['none', 'немає приходу'], ['other', '⧉ інша картка'], ['vat', '⚠ розбіжність ПДВ'], ['units', '⚠ одиниці виміру'], ['ok', '✓ ок']]
const sumCost = (movs) => (movs || []).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.cost_price) || 0), 0)

export default function ShipmentRecon() {
  const { user } = useUser()
  const canEdit = ['admin', 'accountant'].includes(user?.role)
  const [params, setParams] = useSearchParams()
  const wantDoc = params.get('doc')
  const year = todayKyiv().slice(0, 4)
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(todayKyiv())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [shown, setShown] = useState(PAGE)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [selId, setSelId] = useState(wantDoc || null)
  const [toast, setToast] = useState(null)
  const [drawer, setDrawer] = useState(null)   // { mode, line, src }
  const [dialog, setDialog] = useState(null)   // { type, line, src }
  const [docModal, setDocModal] = useState(null)
  const [merges, setMerges] = useState([])

  const load = async (keepSel = true) => {
    setLoading(true); setErr(null)
    try {
      const res = await loadRecon(from, to)
      setData(res)
      if (!keepSel || !selId || !res.docs.some(d => d.id === selId)) {
        const first = sortDocs(res.docs)[0]
        if (!(wantDoc && res.docs.some(d => d.id === wantDoc))) setSelId(first?.id || null)
      }
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
    loadRecentMerges().then(setMerges)
  }
  // ?doc=… — відкрити видаткову; якщо вона раніша за період — розширити період
  useEffect(() => {
    if (!wantDoc) { load(); return }
    supabase.from('documents').select('doc_date, created_at').eq('id', wantDoc).maybeSingle().then(({ data: d }) => {
      const dd = d?.doc_date || d?.created_at?.slice(0, 10)
      if (dd && dd < from) setFrom(dd.slice(0, 4) + '-01-01')
      else load()
      setSelId(wantDoc)
    })
  }, [])
  useEffect(() => { if (data) load() }, [from, to])
  useEffect(() => { if (wantDoc && from !== `${year}-01-01` && !data) load() }, [from])

  const docs = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return sortDocs(data.docs).filter(d => !q || `${d.number} ${d.contractor} ${d.orderNo || ''}`.toLowerCase().includes(q))
  }, [data, search])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, docs.filter(d => k === 'all' || (k === 'ok' ? d.status === 'ok' : d.flags.includes(k))).length])), [docs])
  const listed = docs.filter(d => filter === 'all' || (filter === 'ok' ? d.status === 'ok' : d.flags.includes(filter)))
  const sel = data?.docs.find(d => d.id === selId) || null
  const select = (id) => { setSelId(id); setParams(id ? { doc: id } : {}, { replace: true }) }

  const done = async (text) => { setToast(text); setDialog(null); setDrawer(null); await load(true) }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Звірка видаткових</h1>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}><Link to="/inventory">Склад</Link> → Звірка видаткових · звідки собівартість кожної позиції</div>
        </div>
        <button className="btn" onClick={() => load(true)} disabled={loading}><i className="ti ti-refresh" /> {loading ? 'Рахую… (до хвилини)' : 'Оновити'}</button>
      </div>
      {data?.needs076 && <div className="card" style={{ background: 'var(--amber-bg)', color: 'var(--amber)', marginBottom: 12 }}>Міграцію 076 ще не застосовано: ручні прив'язки, дати оприбуткування і дії недоступні; показано звичайний FIFO.</div>}
      {!canEdit && <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 10 }}>Перегляд: змінювати прив'язки, дати й картки можуть лише адміністратор або бухгалтер.</div>}
      {toast && <div className="card" style={{ background: 'var(--green-bg)', color: 'var(--green)', marginBottom: 12, display: 'flex', gap: 10 }}><span style={{ flex: 1 }}>{toast}</span><button className="btn btn-sm" onClick={() => setToast(null)}>✕</button></div>}
      {err && <div className="card" style={{ color: 'var(--red)', marginBottom: 12 }}>Помилка: {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 330px) minmax(0, 1fr)', gap: 16 }} className="recon-grid">
        <style>{`@media (max-width: 900px) { .recon-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
        {/* ── Ліва колонка: видаткові ── */}
        <div className="card" style={{ padding: 12, alignSelf: 'start' }}>
          <div className="compact" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input type="date" className="form-input" value={from} onChange={e => e.target.value && setFrom(e.target.value)} style={{ flex: 1, minWidth: 120 }} title="Відвантаження з" />
            <input type="date" className="form-input" value={to} onChange={e => e.target.value && setTo(e.target.value)} style={{ flex: 1, minWidth: 120 }} title="по" />
          </div>
          <input className="form-input" placeholder="№ або контрагент…" value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE) }} style={{ marginTop: 6 }} />
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '10px 0' }}>
            {FILTERS.map(([k, l]) => (
              <button key={k} className={'btn btn-sm' + (filter === k ? ' btn-primary' : '')} style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => { setFilter(k); setShown(PAGE) }}>{l} ({counts[k] || 0})</button>
            ))}
          </div>
          {!data && loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Рахую сухий прогін FIFO…</div>}
          {data && !listed.length && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Видаткових немає.</div>}
          {listed.slice(0, shown).map(d => (
            <button key={d.id} onClick={() => select(d.id)} style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid ' + (d.id === selId ? 'var(--text)' : 'transparent'), background: d.id === selId ? 'var(--surface2)' : 'none', borderRadius: 10, padding: '8px 10px', marginBottom: 3, cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><b style={{ fontSize: 13.5 }}>{d.number} від {dmy(d.date)}</b><Badge status={d.status} style={{ fontSize: 11 }} /></div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{d.contractor}{d.orderNo ? ` · №${d.orderNo}` : ''} · {d.lines.length} поз.</div>
            </button>
          ))}
          {listed.length > shown && <button className="btn btn-sm" style={{ width: '100%', marginTop: 6 }} onClick={() => setShown(s => s + PAGE)}>Завантажити ще ({listed.length - shown})</button>}
        </div>

        {/* ── Обрана видаткова ── */}
        <div style={{ minWidth: 0 }}>
          {wantDoc && data && !data.docs.some(d => d.id === wantDoc) && <div className="card" style={{ color: 'var(--text3)', marginBottom: 10 }}>Видаткову з посилання не знайдено в періоді або в ній немає складських рухів — змініть період.</div>}
          {sel ? (
            <ShipmentView doc={sel} canEdit={canEdit} onDrawer={setDrawer} onDialog={setDialog} onOpenDoc={(id) => loadDocFull(id).then(setDocModal)} />
          ) : data && <div className="card" style={{ color: 'var(--text3)' }}>Оберіть видаткову зліва.</div>}
          {merges.length > 0 && (
            <div className="card" style={{ marginTop: 14, fontSize: 12.5 }}>
              <b>Останні об'єднання карток</b>
              {merges.map(m => (
                <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid var(--border)' }}>
                  <span>{new Date(m.created_at).toLocaleString('uk-UA')}</span>
                  <span style={{ color: 'var(--text2)' }}>«{m.before?.dup?.name}» → «{m.before?.keep?.name}»</span>
                  {canEdit && <button className="btn btn-sm" onClick={() => setDialog({ type: 'unmerge', log: m })}>Скасувати об'єднання</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {drawer && sel && <DocsDrawer doc={sel} {...drawer} canEdit={canEdit} onClose={() => setDrawer(null)} onDialog={setDialog} onOpenDoc={(id) => loadDocFull(id).then(setDocModal)} />}
      {dialog && sel && <ActionDialog doc={sel} {...dialog} onClose={() => setDialog(null)} onDone={done} />}
      {docModal && <DocModal user={user} existingDoc={docModal} autoOcr={false} onClose={() => setDocModal(null)} onSaved={() => { setDocModal(null); load(true) }} />}
    </div>
  )
}

// ───────── Видаткова: шапка, показники, позиції з джерелами ─────────
function ShipmentView({ doc, canEdit, onDrawer, onDialog, onOpenDoc }) {
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19 }}>
              <button className="btn-link" onClick={() => onDrawer({ mode: 'sale' })} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>{doc.number} від {dmy(doc.date)}</button>
              {' '}<button className="btn btn-sm" onClick={() => onDrawer({ mode: 'sale' })}><i className="ti ti-file-text" /> Переглянути</button>
            </h2>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>
              {doc.contractor}{doc.orderId ? <> · замовлення <Link to={`/orders/${doc.orderId}`}>№{doc.orderNo || '—'}</Link></> : ' · без замовлення'} · відвантажено {dmy(doc.shipDate)}
            </div>
          </div>
          <Badge status={doc.status} style={{ fontSize: 13, padding: '4px 12px' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          {[[doc.lines.length, 'позицій'], [money(doc.cost), 'собівартість, грн без ПДВ'], [doc.needsAction, 'потребують дії']].map(([v, l]) => (
            <div key={l} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '8px 14px', minWidth: 130 }}><b style={{ display: 'block', fontSize: 18 }}>{v}</b><span style={{ fontSize: 12, color: 'var(--text3)' }}>{l}</span></div>
          ))}
        </div>
        {doc.tip && <div style={{ background: 'var(--amber-bg)', color: 'var(--amber)', borderRadius: 10, padding: '9px 12px', fontSize: 13, marginTop: 12 }}>{doc.tip}</div>}
        {doc.brokenLinks?.map(l => (
          <div key={l.id} style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '9px 12px', fontSize: 13, marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>⚠ Рядок прихідної/видаткової змінився — перевірте прив'язку: «{l.productName}» ← прихідна № {l.inDocNo}, {l.qty} (рядок документа не знайдено після редагування).</span>
            {canEdit && <button className="btn btn-sm" onClick={() => onDialog({ type: 'unlink', link: l, line: { name: l.productName, unit: '' }, src: { docNo: l.inDocNo } })}>Зняти прив'язку</button>}
          </div>
        ))}
      </div>

      <div className="tbl-wrap">
        <table>
          <thead><tr>
            <th>Товар</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Відвантаження</th>
            <th style={{ textAlign: 'right' }}>Ціна продажу</th><th style={{ textAlign: 'right' }}>Собівартість</th><th style={{ textAlign: 'right' }}>Маржа</th><th>Статус</th>
          </tr></thead>
          <tbody>
            {doc.lines.map(l => (
              <LineRows key={l.key} doc={doc} line={l} canEdit={canEdit} onDrawer={onDrawer} onDialog={onDialog} onOpenDoc={onOpenDoc} />
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
        Собівартість — як буде після «Застосувати FIFO» (без ПДВ): 1) ручна прив'язка, 2) прихідна того ж замовлення, 3) FIFO на дату оприбуткування, 4) оцінка ⚠ (поточна собівартість), не 0.
        Кожна дія відкриває вікно підтвердження і пишеться в журнал. Дата документа постачальника (від неї залежать ПДВ і борги) не змінюється — лише дата оприбуткування на складі.
      </p>
    </>
  )
}

function LineRows({ doc, line: l, canEdit, onDrawer, onDialog }) {
  const tdSrc = { background: 'var(--surface2)', padding: '8px 12px' }
  return (
    <>
      <tr>
        <td><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>рядок {l.lineNo} · </span><b>{l.name}</b>{l.sku && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{l.sku}</div>}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{l.qty} {l.unit}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{dmy(l.shipDate)}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(l.saleNet)}<div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{l.qty} × {money(l.unitPrice)}</div></td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {l.service ? <span style={{ color: 'var(--text3)' }}>послуга</span> : <>{money(l.cost)}
            {l.estQty > 0 && <div style={{ fontSize: 11.5, color: 'var(--amber)' }} title="партії немає — поточна собівартість">⚠ оцінка {l.estQty} {l.unit}</div>}
            {l.missingQty > 0 && <div style={{ fontSize: 11.5, color: 'var(--red)' }}>без собівартості {l.missingQty}</div>}
            {Math.abs(l.currentCost - l.cost) >= 1 && <div style={{ fontSize: 11, color: 'var(--text3)' }}>зараз у звіті {money(l.currentCost)}</div>}</>}
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(l.margin)}{l.marginPct != null && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{(l.marginPct * 100).toFixed(1)}%</div>}</td>
        <td><Badge status={l.status} />{l.flags.filter(f => f !== l.status).map(f => <div key={f} style={{ marginTop: 3 }}><Badge status={f} style={{ fontSize: 11 }} /></div>)}</td>
      </tr>
      <tr>
        <td colSpan={7} style={tdSrc}>
          {l.vatMismatch && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>⚠ розбіжність ПДВ: прихідні {l.vatMismatch.docs.map(d => `№ ${d.number} (${d.vat ? 'з ПДВ' : 'без ПДВ'})`).join(', ')} ↔ платежі {l.vatMismatch.pays.filter(p => p.vat !== undefined).map(p => `${dmy(p.date)} «${(p.text || '').slice(0, 60)}»`).join(', ')}. Собівартість — за прихідною.</div>}
          {l.unitIssues.length > 0 && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>⚠ одиниці виміру: {l.unitIssues.join('; ')}</div>}
          {l.sources.map((s, i) => (
            <SourceBox key={'s' + i} doc={doc} line={l} src={s} used canEdit={canEdit} onDrawer={onDrawer} onDialog={onDialog} />
          ))}
          {l.candidates.map((c, i) => (
            <SourceBox key={'c' + i} doc={doc} line={l} src={c} best={i === 0} canEdit={canEdit} onDrawer={onDrawer} onDialog={onDialog} />
          ))}
          {!l.service && !l.sources.length && !l.candidates.length && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Кандидатів немає: немає ні приходу цього товару, ні схожої картки з приходом. Проведіть прихідну на склад (Документи → «Рух на складі»).</div>}
          {l.service && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Послуга — собівартість товарів не рахується.</div>}
        </td>
      </tr>
    </>
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

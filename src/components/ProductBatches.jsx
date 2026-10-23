import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtInt } from '../lib/fmt'
import { loadProductBatches, dropBatchesCache, dmy } from '../lib/productBatches'
import { linkAdd, linkRemove, setWarehouseDate, batchLock, batchUnlock } from '../lib/shipmentRecon'
import { useUser } from '../lib/auth'

// Вкладка «Партії» в картці товару — «прихід ліворуч ↔ вихід праворуч»: кожна партія (прихідна) навпроти
// відвантажень, що з неї взяли; ціна приходу і ціна виходу в одному рядку; залишок партії; відвантаження без
// партії. Розбіжності підсвічено: червоне — продано раніше приходу / без партії / збиток; жовте — оцінка, маржа
// <5% або >60%, залишок партії при відвантаженнях без партії.
const money = (v) => v == null ? '—' : `${v < 0 ? '−' : ''}${fmtInt(v)}`
const num = (v, dp = 2) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('uk-UA', { minimumFractionDigits: dp, maximumFractionDigits: dp })
const qtyf = (v) => num(v, v % 1 ? 3 : 0)
const HOW = { manual: 'вручну', order: 'те саме замовлення', fifo: 'FIFO' }
const RED = { background: 'var(--red-bg)', color: 'var(--red)' }
const AMB = { background: 'var(--amber-bg)', color: 'var(--amber)' }
const td = { padding: '5px 6px', borderBottom: '1px solid var(--border)', fontSize: 12.5, verticalAlign: 'top', overflow: 'hidden' }
// один рядок з «…», повний текст — у підказці
const ell = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }
const r = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const sub = { fontSize: 11, color: 'var(--text3)', ...{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' } }
const sepL = { borderLeft: '2px solid var(--border)' }
const TH = { padding: '6px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const lnk = { background: 'none', border: 0, padding: 0, fontFamily: 'inherit', color: 'var(--blue)', cursor: 'pointer', textAlign: 'left' }

// розбіжності рядка «партія → відвантаження»
function shipIssues(s) {
  const out = []
  if (s.days != null && s.days < 0) out.push(['r', `продано на ${-s.days} дн. раніше приходу`])
  if (s.isSale && s.salePrice > 0) {
    const m = s.salePrice - s.takeUnit, pct = m / s.salePrice * 100
    if (m < 0) out.push(['r', 'збиток'])
    else if (Math.abs(m) < 0.5) out.push(['r', 'ціна виходу = ціні приходу'])
    else if (pct < 5) out.push(['a', `маржа ${num(pct, 1)}%`])
    else if (pct > 60) out.push(['a', `маржа ${num(pct, 1)}% — чи та партія?`])
  }
  return out
}

// назва в документі — показуємо, якщо відрізняється від назви картки
const DocName = ({ name, card }) => name && name.trim().toLowerCase() !== String(card || '').trim().toLowerCase()
  ? <div style={{ fontSize: 11.5, color: 'var(--text2)', fontStyle: 'italic', ...ell }} title={`Як товар називається в цьому документі: ${name}`}>«{name}»</div> : null

export default function ProductBatches({ productId, unit, productName, onOpenDoc }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [onlyIssues, setOnlyIssues] = useState(false)
  const { user } = useUser()
  const canEdit = ['admin', 'accountant'].includes(user?.role)
  const [relink, setRelink] = useState(null)   // { s, fromInId } — переприв'язати відвантаження
  const [toast, setToast] = useState(null)
  const reload = () => { dropBatchesCache(); return load(true) }
  const [lockBusy, setLockBusy] = useState(null)
  const lockAct = async (key, question, fn, text) => {
    if (!window.confirm(question)) return
    setLockBusy(key)
    try { await fn(); setToast(text); await reload() } catch (e) { setToast('Помилка: ' + e.message) } finally { setLockBusy(null) }
  }
  const load = async (force = false) => {
    setBusy(true); setErr(null)
    try { setData(await loadProductBatches(productId, { force })) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [productId])

  if (err) return <div style={{ color: 'var(--red)', fontSize: 13 }}>Помилка: {err}</div>
  if (!data) return <div style={{ color: 'var(--text3)', fontSize: 13 }}>Рахую партії (FIFO)… перший раз — до хвилини</div>
  const t = data.totals
  const docBtn = (id, label) => id ? <button style={lnk} onClick={() => onOpenDoc(id)}>{label}</button> : <span>{label}</span>
  const mColor = (v) => v == null ? undefined : v < 0 ? 'var(--red)' : 'var(--green)'
  const hasUnbatched = data.unbatched.length > 0
  // залишок партії при відвантаженнях без партії — підозра «прихід пізніше / не та партія»
  const leftIssue = (b) => b.left > 0.00001 && hasUnbatched

  const batches = data.batches.filter(b => !onlyIssues || leftIssue(b) || b.ships.some(s => shipIssues(s).length))
  const issuesCount = data.unbatched.length + data.batches.reduce((n, b) => n + b.ships.filter(s => shipIssues(s).length).length + (leftIssue(b) ? 1 : 0), 0)

  // права частина рядка: відвантаження (або залишок / нічого)
  const Right = ({ s }) => {
    const iss = shipIssues(s)
    const red = iss.some(x => x[0] === 'r'), amb = !red && iss.length
    const m = s.isSale ? s.salePrice - s.takeUnit : null
    const cell = red ? RED : amb ? AMB : {}
    return <>
      <td style={{ ...td, ...sepL, textAlign: 'center', ...r, ...(s.days != null && s.days < 0 ? RED : {}) }} title="днів на складі">{s.days == null ? '→' : <>{s.days}<div style={{ fontSize: 10 }}>дн.</div></>}</td>
      <td style={td}>{docBtn(s.docId, s.docNo)}<DocName name={s.docName} card={productName} /><span style={sub} title={`${s.client || ''} · ${HOW[s.how] || s.how}`}>{s.client || (s.isSale ? '' : 'не продаж')}{` · ${HOW[s.how] || s.how}`}</span></td>
      <td style={{ ...td, ...r }}>{dmy(s.date)}</td>
      <td style={{ ...td, ...r }}>{qtyf(s.takeQty)}</td>
      <td style={{ ...td, ...r, fontWeight: 600 }}>{s.isSale ? num(s.salePrice) : '—'}</td>
      <td style={{ ...td, ...r, ...cell, fontWeight: 600 }}>{m == null ? '—' : <>{num(m, 0)}<div style={{ fontSize: 10.5, fontWeight: 400 }}>{s.salePrice ? num(m / s.salePrice * 100, 1) + '%' : ''} · {money(m * s.takeQty)}</div></>}</td>
      <td style={{ ...td, fontSize: 11.5 }}>
        {iss.map(([lv, tx], i) => <span key={i} className="badge" style={{ ...(lv === 'r' ? RED : AMB), fontWeight: 700, fontSize: 10.5, display: 'inline-block', margin: '0 3px 2px 0', padding: '1px 6px', whiteSpace: 'normal' }}>{tx}</span>)}
        {canEdit && s.docId && !s.lockedBatch && <button style={{ ...lnk, fontSize: 12, marginRight: 8 }} onClick={() => setRelink({ s, fromInId: s.inId })} title="Взяти цей рядок з іншої партії">↔ переприв'язати</button>}
        {s.isSale && <Link to={`/inventory/recon?line=${s.outId}`} style={{ fontSize: 12 }}>звірка</Link>}
      </td>
    </>
  }
  const RightEmpty = ({ children, style }) => <td colSpan={7} style={{ ...td, ...sepL, ...style }}>{children}</td>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        {[['Прийшло / вийшло', `${qtyf(t.in)} / ${qtyf(t.out)} ${unit || ''}`], ['На складі за рухами', `${qtyf(t.onHand)} ${unit || ''}`],
          ['Залишки партій', `${money(t.leftValue)} грн`, hasUnbatched && t.leftValue > 0 ? 'var(--amber)' : undefined],
          ['Сер. ціна приходу / виходу', `${num(t.avgBuy)} / ${num(t.avgSale)}`], ['Маржа продажів', `${money(t.margin)} · ${t.marginPct == null ? '—' : num(t.marginPct, 1) + '%'}`, mColor(t.margin)],
          ['Розбіжностей', issuesCount, issuesCount ? 'var(--red)' : 'var(--green)'], ['Закрито партій', `${data.batches.filter(b => b.locked).length} з ${data.batches.length}`]].map(([l, v, c]) => (
          <div key={l} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '5px 10px' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div><div style={{ fontWeight: 700, fontSize: 14, color: c }}>{v}</div>
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} /> лише розбіжності</label>
        <button className="btn btn-sm" onClick={() => load(true)} disabled={busy} title="Перерахувати"><i className="ti ti-refresh" />{busy ? ' …' : ''}</button>
      </div>

      <div className="tbl-wrap" style={{ border: 'none', maxHeight: '70vh', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', minWidth: 860 }}>
          <colgroup>
            <col style={{ width: '19%' }} /><col style={{ width: 84 }} /><col style={{ width: 46 }} /><col style={{ width: 88 }} /><col style={{ width: 70 }} />
            <col style={{ width: 38 }} /><col style={{ width: '19%' }} /><col style={{ width: 84 }} /><col style={{ width: 46 }} /><col style={{ width: 88 }} /><col style={{ width: 86 }} /><col style={{ width: 150 }} />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={5} style={{ ...TH, textAlign: 'center', fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>ПРИХІД (ПАРТІЯ)</th>
              <th colSpan={7} style={{ ...TH, ...sepL, textAlign: 'center', fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>ВИХІД (КУДИ ВІДВАНТАЖЕНО)</th>
            </tr>
            <tr style={{ fontSize: 11 }}>
              <th style={TH}>Прихідна · постачальник</th><th style={{ ...TH, textAlign: 'right' }}>Дата</th><th style={{ ...TH, textAlign: 'right' }}>К-сть</th>
              <th style={{ ...TH, textAlign: 'right' }} title="Ціна партії за одиницю — без ПДВ (як собівартість)">Ціна прих., без ПДВ</th><th style={{ ...TH, textAlign: 'right' }}>Залиш.</th>
              <th style={{ ...TH, ...sepL }} title="днів на складі">дн.</th><th style={TH}>Видаткова · клієнт</th><th style={{ ...TH, textAlign: 'right' }}>Дата</th><th style={{ ...TH, textAlign: 'right' }}>К-сть</th>
              <th style={{ ...TH, textAlign: 'right' }} title="Ціна продажу за одиницю — без ПДВ">Ціна вих., без ПДВ</th>
              <th style={{ ...TH, textAlign: 'right' }} title="маржа на одиницю · % · сума">Маржа / од.</th><th style={TH}>Розбіжності</th>
            </tr>
          </thead>
          <tbody>
            {!batches.length && !hasUnbatched && <tr><td colSpan={12} style={{ ...td, color: 'var(--text3)' }}>{onlyIssues ? 'Розбіжностей немає.' : 'Приходів немає.'}</td></tr>}
            {batches.map(b => {
              const ships = onlyIssues ? b.ships.filter(s => shipIssues(s).length) : b.ships
              const showLeft = b.left > 0.00001
              const span = Math.max(ships.length + (showLeft ? 1 : 0), 1)
              const left = (
                <>
                  <td rowSpan={span} style={{ ...td, background: b.locked ? 'var(--green-bg)' : 'var(--surface2)' }}>
                    {docBtn(b.docId, `№${b.docNo}`)}<DocName name={b.docName} card={productName} /><span style={sub} title={b.supplier}>{b.supplier}</span>
                    {b.locked ? <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--green)', fontWeight: 600 }} title={`закрито ${dmy(String(b.locked.created_at || '').slice(0, 10))}${b.locked.note ? ' · ' + b.locked.note : ''}`}>
                        🔒 закрита{canEdit && <button style={{ ...lnk, fontSize: 11.5, marginLeft: 6, fontWeight: 400 }} disabled={!!lockBusy}
                          onClick={() => lockAct('u' + b.inId, `Відкрити партію №${b.docNo}? Її відвантаження знову розподілятиме FIFO (можуть змінитися).`, () => batchUnlock(b.locked.id), `Партію №${b.docNo} відкрито`)}>відкрити</button>}
                      </div>
                      : canEdit && b.inDocId && b.ships.length > 0 && !leftIssue(b) && !b.ships.some(x => shipIssues(x).length) && <div style={{ marginTop: 3 }}>
                        <button style={{ ...lnk, fontSize: 11.5 }} disabled={!!lockBusy} title="Зафіксувати розподіл: FIFO більше не змінюватиме відвантаження з цієї партії й нічого нового з неї не братиме"
                          onClick={() => lockAct('l' + b.inId, `Закрити партію №${b.docNo}? Поточний розподіл (${b.ships.length} відвант.) буде зафіксовано; FIFO більше нічого з неї не братиме${b.left > 0.00001 ? ` — залишок ${qtyf(b.left)} ${unit || ''} теж стане недоступним для відвантажень` : ''}. Відкрити можна будь-коли.`, () => batchLock(b.inId, 'перевірено'), `Партію №${b.docNo} закрито 🔒`)}>{lockBusy === 'l' + b.inId ? '…' : '🔒 закрити'}</button>
                      </div>}
                  </td>
                  <td rowSpan={span} style={{ ...td, ...r, background: 'var(--surface2)' }}>{dmy(b.whDate)}{b.whDate !== b.docDate && <div style={{ fontSize: 11, color: 'var(--text3)' }}>док. {dmy(b.docDate)}</div>}</td>
                  <td rowSpan={span} style={{ ...td, ...r, background: 'var(--surface2)' }}>{qtyf(b.qty)}</td>
                  <td rowSpan={span} style={{ ...td, ...r, background: 'var(--surface2)', fontWeight: 600 }} title={`${b.basis}; ПДВ у прихідній: ${b.vat == null ? '—' : b.vat ? 'так' : 'ні'}`}>{num(b.unit)}<div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 400 }}>{b.vat == null ? '' : b.vat ? 'прихідна з ПДВ' : 'прихідна без ПДВ'}</div></td>
                  <td rowSpan={span} style={{ ...td, ...r, background: 'var(--surface2)', ...(leftIssue(b) ? AMB : {}) }}>{showLeft ? <>{qtyf(b.left)}<div style={{ fontSize: 11 }}>{money(b.leftValue)}</div></> : <span style={{ color: 'var(--text3)' }}>0</span>}</td>
                </>
              )
              return (
                <Fragment key={b.inId}>
                  {ships.length ? ships.map((s, i) => (
                    <tr key={i}>{i === 0 && left}<Right s={{ ...s, lockedBatch: !!b.locked }} /></tr>
                  )) : <tr>{left}{!showLeft && <RightEmpty><span style={sub}>не відвантажувалась</span></RightEmpty>}{showLeft && <RightEmpty style={leftIssue(b) ? AMB : undefined}>на складі {qtyf(b.left)} {unit || ''}{leftIssue(b) ? ' — є вихід без партії (нижче): прихід пізніше?' : ''}</RightEmpty>}</tr>}
                  {ships.length > 0 && showLeft && <tr><RightEmpty style={leftIssue(b) ? AMB : { color: 'var(--text3)' }}>на складі {qtyf(b.left)} {unit || ''}{leftIssue(b) ? ' — є вихід без партії (нижче): прихід пізніше?' : ''}</RightEmpty></tr>}
                </Fragment>
              )
            })}
            {hasUnbatched && <tr><td colSpan={12} style={{ ...td, ...sub, fontWeight: 700, textTransform: 'uppercase', color: 'var(--red)', paddingTop: 14 }}>Вихід без партії — прихід не знайдено</td></tr>}
            {data.unbatched.map(s => (
              <tr key={s.outId}>
                <td colSpan={5} style={{ ...td, ...RED }}>
                  немає партії на {qtyf(s.uncovered)} з {qtyf(s.qty)} {unit || ''}
                  {s.later?.length > 0 && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>є пізніші партії з залишком: {s.later.map(l => `№${l.docNo} від ${dmy(l.whDate)} (${qtyf(l.left)})`).join(', ')} — «Виправити дату оприбуткування» або «Взяти з цієї прихідної» у звірці</div>}
                </td>
                <td style={{ ...td, ...sepL, textAlign: 'center' }}>→</td>
                <td style={td}>{docBtn(s.docId, s.docNo)}<DocName name={s.docName} card={productName} /><span style={sub} title={s.client}>{s.client}</span></td>
                <td style={{ ...td, ...r }}>{dmy(s.date)}</td>
                <td style={{ ...td, ...r }}>{qtyf(s.uncovered)}</td>
                <td style={{ ...td, ...r, fontWeight: 600 }}>{s.isSale ? num(s.salePrice) : '—'}</td>
                <td style={{ ...td, ...r }}>{s.manual ? `вручну ${num(s.costUnit)}` : s.estQty > 0 ? <span style={{ color: 'var(--amber)' }}>⚠ оцінка {num(s.costUnit)}</span> : <span style={{ color: 'var(--red)' }}>без собівартості</span>}</td>
                <td style={td}>
                  {canEdit && s.docId && <button className="btn btn-sm" style={{ padding: '1px 8px', fontSize: 12, marginBottom: 3 }} onClick={() => setRelink({ s: { ...s, takeQty: s.uncovered }, fromInId: null })}>Взяти з партії</button>}
                  {s.isSale && <div><Link to={`/inventory/recon?line=${s.outId}`} style={{ fontSize: 12 }}>у звірці</Link></div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toast && <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg, #fff)', borderRadius: 10, padding: '8px 14px', fontSize: 13, zIndex: 50, display: 'flex', gap: 10 }}>{toast}<button className="btn btn-sm" onClick={() => setToast(null)}>✕</button></div>}
      {relink && <RelinkDialog s={relink.s} fromInId={relink.fromInId} batches={data.batches} unit={unit} productName={productName}
        onClose={() => setRelink(null)} onDone={async (text) => { setRelink(null); setToast(text); await reload() }} />}
      <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8 }}>
        Курсивом «…» — як товар названо в самому документі (якщо назва відрізняється від картки). Ліворуч — партія (прихідна), праворуч — куди її відвантажено, з ціною приходу і ціною виходу в одному рядку. Розподіл — як буде після «Застосувати FIFO»: ручна прив'язка → прихідна того ж замовлення → найстаріші партії на дату оприбуткування.
        Червоне — продано раніше приходу, без партії, збиток, ціна виходу = ціні приходу; жовте — маржа &lt;5% або &gt;60%, оцінка, залишок партії при відвантаженнях без партії.
      </p>
    </div>
  )
}

// ── Переприв'язати рядок видаткової до іншої партії (ручна прив'язка 076: має пріоритет над FIFO) ──
function RelinkDialog({ s, fromInId, batches, unit, onClose, onDone }) {
  const cur = fromInId ? batches.find(b => b.inId === fromInId) : null
  const curShip = cur?.ships.find(x => x.outId === s.outId)
  const need = Number(s.takeQty || s.qty || 1)
  const [qtys, setQtys] = useState({})   // к-сть окремо для кожної партії (за замовчуванням — скільки в ній можна взяти)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const run = async (key, fn, text) => {
    setBusy(key); setErr(null)
    try { await fn(); await onDone(text) } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  // вільно в партії для цього рядка: залишок + те, що цей рядок уже бере з неї
  const freeFor = (b) => b.left + (b.ships.filter(x => x.outId === s.outId).reduce((t, x) => t + x.takeQty, 0))
  // ручна прив'язка має пріоритет над FIFO: можна взяти все, крім уже прив'язаного вручну іншими рядками
  const manualOthers = (b) => b.ships.filter(x => x.how === 'manual' && x.outId !== s.outId).reduce((t, x) => t + x.takeQty, 0)
  const list = batches.filter(b => b.inDocId && b.inId !== fromInId).map(b => ({ ...b, free: b.locked ? 0 : Math.max(freeFor(b), 0), max: b.locked ? 0 : Math.max(b.qty - manualOthers(b), 0), late: s.date && b.whDate > s.date }))
    .sort((a, b) => (b.free > 0) - (a.free > 0) || String(a.whDate).localeCompare(String(b.whDate)))
  const qOf = (b) => qtys[b.inId] ?? String(Math.min(need, b.max))
  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760, width: '96%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header"><h2 style={{ margin: 0, fontSize: 17 }}>Переприв'язати до партії</h2><button className="btn" onClick={onClose} disabled={!!busy}><i className="ti ti-x" /></button></div>
        <div style={{ fontSize: 13.5, marginBottom: 10 }}>
          Видаткова <b>{s.docNo}</b> від {dmy(s.date)} · {s.client} · ціна виходу <b>{num(s.salePrice)}</b>
          {cur ? <div style={{ color: 'var(--text3)', marginTop: 3 }}>зараз: {num(curShip?.takeQty ?? s.takeQty, 0)} {unit || ''} з партії №{cur.docNo} ({dmy(cur.whDate)}) по {num(cur.unit)} · {HOW[curShip?.how || s.how] || ''}</div>
            : <div style={{ color: 'var(--red)', marginTop: 3 }}>зараз без партії: {qtyf(s.takeQty)} {unit || ''}</div>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 8 }}>Потрібно {qtyf(need)} {unit || ''}. Можна брати з кількох партій — кожну окремо. Ручна прив'язка має пріоритет над FIFO: можна забрати й ту частину партії, яку FIFO зараз віддав іншій (пізнішій) видатковій — ту буде перерозподілено.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ color: 'var(--text3)', fontSize: 11.5 }}><th style={{ textAlign: 'left' }}>Партія</th><th style={{ textAlign: 'right' }}>Оприбутк.</th><th style={{ textAlign: 'right' }}>Ціна</th><th style={{ textAlign: 'right' }}>Вільно</th><th style={{ textAlign: 'right' }}>Маржа/од.</th><th style={{ textAlign: 'right' }}>Взяти</th><th /></tr></thead>
          <tbody>{list.map(b => {
            const m = s.salePrice ? s.salePrice - b.unit : null
            const n = Number(qOf(b)) || 0
            return (
              <tr key={b.inId} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '5px 4px' }}>№{b.docNo}{b.locked && <span style={{ color: 'var(--green)', fontSize: 11.5 }}> 🔒 закрита</span>}<div style={{ fontSize: 11, color: 'var(--text3)' }}>{b.supplier}</div></td>
                <td style={{ padding: '5px 4px', textAlign: 'right', color: b.late ? 'var(--amber)' : undefined }}>{dmy(b.whDate)}{b.late && <div style={{ fontSize: 11 }}>пізніше відвантаження</div>}</td>
                <td style={{ padding: '5px 4px', textAlign: 'right' }}>{num(b.unit)}</td>
                <td style={{ padding: '5px 4px', textAlign: 'right', color: b.free > 0 ? undefined : 'var(--text3)' }} title="вільно за FIFO / максимум для ручної прив'язки">{qtyf(b.free)}{b.max > b.free + 0.00001 && <div style={{ fontSize: 11, color: 'var(--text3)' }}>до {qtyf(b.max)}</div>}</td>
                <td style={{ padding: '5px 4px', textAlign: 'right', color: m == null ? undefined : m < 0 ? 'var(--red)' : 'var(--green)' }}>{m == null ? '—' : num(m, 0)}</td>
                <td style={{ padding: '5px 4px', textAlign: 'right' }}><input className="form-input" type="number" min="0" step="any" value={qOf(b)} onChange={e => setQtys(x => ({ ...x, [b.inId]: e.target.value }))} style={{ width: 72, height: 30, padding: '2px 6px' }} disabled={!(b.max > 0)} /></td>
                <td style={{ padding: '5px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-primary" disabled={!!busy || !(n > 0) || n > b.max + 0.00001} title={n > b.max ? 'партію вже вручну прив\'язано до інших видаткових' : n > b.free ? 'частину зараз бере інша видаткова за FIFO — її буде перерозподілено' : ''}
                    onClick={() => (n <= b.free + 0.00001 || window.confirm(`У партії №${b.docNo} вільно ${qtyf(b.free)}, решту зараз бере інша видаткова за FIFO — її буде перерозподілено на інші партії (або вона стане «без партії»). Продовжити?`))
                      && run('take' + b.inId, () => linkAdd({ outMov: s.outId, inMov: b.inId, qty: n }), `${s.docNo}: ${qtyf(n)} ${unit || ''} взято з партії №${b.docNo}`)}>{busy === 'take' + b.inId ? '…' : 'Взяти звідси'}</button>
                  {b.late && <button className="btn btn-sm" style={{ marginLeft: 4 }} disabled={!!busy} title="Якщо товар фізично прийшов раніше — дата оприбуткування = дата відвантаження"
                    onClick={() => window.confirm(`Змінити дату оприбуткування партії №${b.docNo}: ${dmy(b.whDate)} → ${dmy(s.date)}? Дата документа постачальника не змінюється.`) && run('date' + b.inId, () => setWarehouseDate(b.inDocId, s.date, s.docId), `Партія №${b.docNo}: оприбуткування ${dmy(s.date)}`)}>{busy === 'date' + b.inId ? '…' : `Дата → ${dmy(s.date)}`}</button>}
                </td>
              </tr>
            )
          })}</tbody>
        </table>
        {!list.length && <p style={{ color: 'var(--text3)' }}>Інших партій цього товару немає. Якщо прихід записано на іншу картку — «Об'єднати з товаром».</p>}
        {curShip?.linkId && <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 13 }}>
          Ця прив'язка зроблена вручну. <button className="btn btn-sm" disabled={!!busy} onClick={() => run('unlink', () => linkRemove(curShip.linkId), `${s.docNo}: ручну прив'язку знято`)}>Зняти ручну прив'язку</button>
        </div>}
        {err && <p style={{ color: 'var(--red)' }}>Помилка: {err}</p>}
        <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 10 }}>«Взяти звідси» — ручна прив'язка рядка видаткової до партії (пріоритет над FIFO, скасовується «Зняти ручну прив'язку»). Інші відвантаження перерозподіляться за FIFO. Змінювати можуть адміністратор і бухгалтер; дія пишеться в журнал.</p>
      </div>
    </div>
  )
}

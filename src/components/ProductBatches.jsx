import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtInt } from '../lib/fmt'
import { loadProductBatches, dmy } from '../lib/productBatches'

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
const lnk = { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--blue)', cursor: 'pointer', textAlign: 'left' }

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
          ['Розбіжностей', issuesCount, issuesCount ? 'var(--red)' : 'var(--green)']].map(([l, v, c]) => (
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
            <col style={{ width: '20%' }} /><col style={{ width: 74 }} /><col style={{ width: 42 }} /><col style={{ width: 86 }} /><col style={{ width: 66 }} />
            <col style={{ width: 34 }} /><col style={{ width: '20%' }} /><col style={{ width: 74 }} /><col style={{ width: 42 }} /><col style={{ width: 86 }} /><col style={{ width: 82 }} /><col />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={5} style={{ textAlign: 'center', ...sub, fontWeight: 700, textTransform: 'uppercase' }}>Прихід (партія)</th>
              <th colSpan={7} style={{ textAlign: 'center', ...sub, ...sepL, fontWeight: 700, textTransform: 'uppercase' }}>Вихід (куди відвантажено)</th>
            </tr>
            <tr style={{ fontSize: 11 }}>
              <th style={TH}>Прихідна · постачальник</th><th style={{ ...TH, textAlign: 'right' }}>Дата</th><th style={{ ...TH, textAlign: 'right' }}>К-сть</th>
              <th style={{ ...TH, textAlign: 'right' }} title="без ПДВ">Ціна прих.</th><th style={{ ...TH, textAlign: 'right' }}>Залиш.</th>
              <th style={{ ...TH, ...sepL }} title="днів на складі">дн.</th><th style={TH}>Видаткова · клієнт</th><th style={{ ...TH, textAlign: 'right' }}>Дата</th><th style={{ ...TH, textAlign: 'right' }}>К-сть</th>
              <th style={{ ...TH, textAlign: 'right' }} title="без ПДВ">Ціна вих.</th>
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
                  <td rowSpan={span} style={{ ...td, background: 'var(--surface2)' }}>{docBtn(b.docId, `№${b.docNo}`)}<DocName name={b.docName} card={productName} /><span style={sub} title={b.supplier}>{b.supplier}</span></td>
                  <td rowSpan={span} style={{ ...td, ...r, background: 'var(--surface2)' }}>{dmy(b.whDate)}{b.whDate !== b.docDate && <div style={{ fontSize: 11, color: 'var(--text3)' }}>док. {dmy(b.docDate)}</div>}</td>
                  <td rowSpan={span} style={{ ...td, ...r, background: 'var(--surface2)' }}>{qtyf(b.qty)}</td>
                  <td rowSpan={span} style={{ ...td, ...r, background: 'var(--surface2)', fontWeight: 600 }} title={`${b.basis}; ПДВ у прихідній: ${b.vat == null ? '—' : b.vat ? 'так' : 'ні'}`}>{num(b.unit)}<div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 400 }}>{b.vat == null ? '' : b.vat ? 'з ПДВ' : 'без ПДВ'}</div></td>
                  <td rowSpan={span} style={{ ...td, ...r, background: 'var(--surface2)', ...(leftIssue(b) ? AMB : {}) }}>{showLeft ? <>{qtyf(b.left)}<div style={{ fontSize: 11 }}>{money(b.leftValue)}</div></> : <span style={{ color: 'var(--text3)' }}>0</span>}</td>
                </>
              )
              return (
                <Fragment key={b.inId}>
                  {ships.length ? ships.map((s, i) => (
                    <tr key={i}>{i === 0 && left}<Right s={s} /></tr>
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
                <td style={td}>{s.isSale && <Link to={`/inventory/recon?line=${s.outId}`} style={{ fontSize: 12 }}>розібрати у звірці</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8 }}>
        Курсивом «…» — як товар названо в самому документі (якщо назва відрізняється від картки). Ліворуч — партія (прихідна), праворуч — куди її відвантажено, з ціною приходу і ціною виходу в одному рядку. Розподіл — як буде після «Застосувати FIFO»: ручна прив'язка → прихідна того ж замовлення → найстаріші партії на дату оприбуткування.
        Червоне — продано раніше приходу, без партії, збиток, ціна виходу = ціні приходу; жовте — маржа &lt;5% або &gt;60%, оцінка, залишок партії при відвантаженнях без партії.
      </p>
    </div>
  )
}

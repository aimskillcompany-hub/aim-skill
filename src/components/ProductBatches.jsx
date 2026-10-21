import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtInt } from '../lib/fmt'
import { loadProductBatches, dmy } from '../lib/productBatches'

// Вкладка «Партії» в картці товару: партії (приходи) → відвантаження з кожної, маржа партії, залишок; відвантаження без партії
const money = (v) => v == null ? '—' : `${v < 0 ? '−' : ''}${fmtInt(v)}`
const num = (v, dp = 2) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('uk-UA', { minimumFractionDigits: dp, maximumFractionDigits: dp })
const qtyf = (v) => num(v, v % 1 ? 3 : 0)
const HOW = { manual: 'вручну', order: 'те саме замовлення', fifo: 'FIFO' }
const td = { padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' }
const r = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const lnk = { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--blue)', cursor: 'pointer' }

export default function ProductBatches({ productId, unit, onOpenDoc }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(() => new Set())
  const load = async (force = false) => {
    setBusy(true); setErr(null)
    try { setData(await loadProductBatches(productId, { force })) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [productId])
  const toggle = (id) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (err) return <div style={{ color: 'var(--red)', fontSize: 13 }}>Помилка: {err}</div>
  if (!data) return <div style={{ color: 'var(--text3)', fontSize: 13 }}>Рахую партії (FIFO)… перший раз — до хвилини</div>
  const t = data.totals
  const mColor = (v) => v == null ? undefined : v < 0 ? 'var(--red)' : 'var(--green)'
  const docBtn = (id, label) => id ? <button style={lnk} onClick={() => onOpenDoc(id)}>{label}</button> : <span>{label}</span>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {[['Надійшло / вибуло', `${qtyf(t.in)} / ${qtyf(t.out)} ${unit || ''}`], ['На складі', `${qtyf(t.onHand)} ${unit || ''} · ${money(t.leftValue)} грн`],
          ['Сер. закупівля / продаж', `${num(t.avgBuy)} / ${num(t.avgSale)}`], ['Маржа продажів', `${money(t.margin)} · ${t.marginPct == null ? '—' : num(t.marginPct, 1) + '%'}`, mColor(t.margin)]].map(([l, v, c]) => (
          <div key={l} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '7px 12px' }}>
            <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{l}</div><div style={{ fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => load(true)} disabled={busy} style={{ alignSelf: 'center' }}><i className="ti ti-refresh" /> {busy ? 'Рахую…' : 'Перерахувати'}</button>
      </div>

      <div className="tbl-wrap" style={{ border: 'none', maxHeight: '65vh', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th /><th>Партія (прихідна)</th><th>Оприбутк.</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Ціна закуп. без ПДВ</th><th>ПДВ</th>
            <th style={{ textAlign: 'right' }}>Списано</th><th style={{ textAlign: 'right' }}>Залишок</th><th style={{ textAlign: 'right' }}>Продаж / собівартість</th><th style={{ textAlign: 'right' }}>Маржа</th>
          </tr></thead>
          <tbody>
            {!data.batches.length && <tr><td colSpan={10} style={{ ...td, color: 'var(--text3)' }}>Приходів немає.</td></tr>}
            {data.batches.map(b => {
              const isOpen = open.has(b.inId)
              return (
                <Fragment key={b.inId}>
                  <tr onClick={() => b.ships.length && toggle(b.inId)} style={{ cursor: b.ships.length ? 'pointer' : 'default', background: isOpen ? 'var(--surface2)' : undefined }}>
                    <td style={{ ...td, color: 'var(--text3)', width: 14 }}>{b.ships.length ? (isOpen ? '▾' : '▸') : ''}</td>
                    <td style={td} onClick={e => e.stopPropagation()}>{docBtn(b.docId, `№${b.docNo}`)}{b.docDate && <span style={{ color: 'var(--text3)' }}> від {dmy(b.docDate)}</span>}<div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{b.supplier}</div></td>
                    <td style={{ ...td, ...r }}>{dmy(b.whDate)}{b.whDate !== b.docDate && <div style={{ fontSize: 11, color: 'var(--text3)' }}>док. {dmy(b.docDate)}</div>}</td>
                    <td style={{ ...td, ...r }}>{qtyf(b.qty)}</td>
                    <td style={{ ...td, ...r }} title={b.basis}>{num(b.unit)}</td>
                    <td style={td}>{b.vat == null ? '—' : b.vat ? 'так' : 'ні'}</td>
                    <td style={{ ...td, ...r }}>{qtyf(b.used)}<div style={{ fontSize: 11, color: 'var(--text3)' }}>{b.ships.length} відвант.</div></td>
                    <td style={{ ...td, ...r, fontWeight: 600, color: b.left > 0.00001 ? 'var(--text)' : 'var(--text3)' }}>{qtyf(b.left)}{b.left > 0.00001 && <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>{money(b.leftValue)} грн</div>}</td>
                    <td style={{ ...td, ...r }}>{b.revenue ? `${money(b.revenue)} / ${money(b.costSold)}` : '—'}</td>
                    <td style={{ ...td, ...r, fontWeight: 600, color: b.revenue ? mColor(b.margin) : 'var(--text3)' }}>{b.revenue ? <>{money(b.margin)}<div style={{ fontSize: 11 }}>{num(b.marginPct, 1)}%</div></> : '—'}</td>
                  </tr>
                  {isOpen && b.ships.map((s, i) => {
                    const m = s.takeRevenue - s.takeCost
                    return (
                      <tr key={b.inId + i} style={{ background: 'var(--surface2)' }}>
                        <td style={td} />
                        <td style={{ ...td, paddingLeft: 20 }} colSpan={2}>
                          ↳ {docBtn(s.docId, s.docNo)}{s.date && <span style={{ color: 'var(--text3)' }}> від {dmy(s.date)}</span>}
                          <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{s.client}{s.client ? ' · ' : ''}{HOW[s.how] || s.how}{s.days != null ? ` · ${s.days < 0 ? `продано на ${-s.days} дн. раніше приходу` : `${s.days} дн. на складі`}` : ''}</div>
                        </td>
                        <td style={{ ...td, ...r }}>{qtyf(s.takeQty)}</td>
                        <td style={{ ...td, ...r }}>{num(s.takeUnit)}<div style={{ fontSize: 11, color: 'var(--text3)' }}>продаж {num(s.salePrice)}</div></td>
                        <td style={td} colSpan={3}>{s.isSale && <Link to={`/inventory/recon?line=${s.outId}`} style={{ fontSize: 12 }}>у звірці</Link>}</td>
                        <td style={{ ...td, ...r }}>{s.isSale ? `${money(s.takeRevenue)} / ${money(s.takeCost)}` : <span style={{ color: 'var(--text3)' }}>{s.docNo}</span>}</td>
                        <td style={{ ...td, ...r, color: s.isSale ? mColor(m) : 'var(--text3)' }}>{s.isSale ? money(m) : '—'}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {data.unbatched.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', marginBottom: 6 }}>Відвантаження без партії ({data.unbatched.length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>{data.unbatched.map(s => (
              <tr key={s.outId}>
                <td style={td}>{docBtn(s.docId, s.docNo)}{s.date && <span style={{ color: 'var(--text3)' }}> від {dmy(s.date)}</span>}<div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{s.client}</div></td>
                <td style={{ ...td, ...r }}>{qtyf(s.uncovered)} з {qtyf(s.qty)} без партії</td>
                <td style={{ ...td, ...r }}>{s.manual ? `вручну ${num(s.costUnit)}` : s.estQty > 0 ? `⚠ оцінка ${num(s.costUnit)}` : s.missingQty > 0 ? <span style={{ color: 'var(--red)' }}>без собівартості</span> : ''}</td>
                <td style={td}>{s.isSale && <Link to={`/inventory/recon?line=${s.outId}`} style={{ fontSize: 12 }}>розібрати у звірці</Link>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8 }}>
        Розподіл — як буде після «Застосувати FIFO»: ручна прив'язка → прихідна того ж замовлення → найстаріші партії на дату оприбуткування; ціна партії без ПДВ (повна — якщо постачальник без ПДВ). Клік по партії — відвантаження з неї. Дані оновлюються раз на 5 хв або кнопкою «Перерахувати».
      </p>
    </div>
  )
}

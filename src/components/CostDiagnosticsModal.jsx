import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtInt } from '../lib/fmt'
import { runCostDiagnostics, moveInDate } from '../lib/costDiagnostics'
import { todayKyiv } from '../lib/dates'

// «Діагностика собівартості» (нічого не змінює): звіт зараз → FIFO по замовленнях, база ПДВ партій,
// позиції без партій і можливі прихідні (не проведені / пізніші). CSV для перевірки.
const money = (v) => `${v < 0 ? '−' : ''}${fmtInt(v)}`
const dmy = (s) => s ? s.split('-').reverse().join('.') : '—'

function downloadCsv(name, header, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  const text = '﻿' + [header, ...rows].map(r => r.map(esc).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function CostDiagnosticsModal({ onClose }) {
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(todayKyiv())
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('orders')
  const [filter, setFilter] = useState('all')
  const [moved, setMoved] = useState({}) // inId → нова дата / помилка

  const KINDS = { later: '⏱ прихід пізніше відвантаження', unposted: '✓ непроведена прихідна', units: '⚠ одиниці виміру', none: 'джерел не знайдено' }
  const hasKind = (m, k) => k === 'all' || (k === 'none' ? !m.candidates.some(c => c.kind !== 'supplier') : m.candidates.some(c => c.kind === k))
  const missingShown = res ? res.missing.filter(m => hasKind(m, filter)) : []
  const doMove = async (c, m) => {
    const ok = window.confirm(`Змінити дату ПРИХОДУ на складі ${dmy(c.inDate)} → ${dmy(c.outDate)}?\n\nТовар: ${m.product}\nВідвантаження: ${m.doc} (замовлення ${m.order})\n\nЗмінюється лише дата руху складу (оприбуткування); дата документа постачальника лишається. Якщо пізніше перезберегти прихідну з галочкою «Рух на складі», дата руху знову стане датою документа.`)
    if (!ok) return
    try { await moveInDate(c.inId, c.outDate); setMoved(x => ({ ...x, [c.inId]: { ok: c.outDate } })) } catch (e) { setMoved(x => ({ ...x, [c.inId]: { err: e.message } })) }
  }

  const run = async () => {
    setBusy(true); setErr(null); setRes(null)
    try { setRes(await runCostDiagnostics(from, to)) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const exportOrders = () => downloadCsv(`Собівартість зараз vs FIFO ${from}_${to}.csv`,
    ['Замовлення', 'Клієнт', 'Відвантажень', 'Зараз у звіті', 'За FIFO', 'Різниця', 'К-сть без собівартості', 'К-сть з оцінкою ⚠', 'Сума оцінки', 'Ціна партій (база ПДВ)'],
    res.orderRows.map(r => [r.order, r.client, r.shipments, r.current, r.fifo, r.diff, r.missingQty, r.estQty, r.estValue, r.bases]))
  const exportMissing = () => downloadCsv(`Позиції без партій ${from}_${to}.csv`,
    ['Замовлення', 'Клієнт', 'Видаткова', 'Дата відвантаження', 'Товар', 'Артикул', 'Од.', 'К-сть у відвантаженні', 'Без собівартості', 'Оцінено ⚠', 'Ціна оцінки', 'Можливі джерела'],
    missingShown.map(m => [m.order, m.client, m.doc, m.date, m.product, m.sku, m.unit, m.qty, m.missingQty, m.estQty, m.estUnit, m.candidates.map(c => c.text).join(' | ') || 'не знайдено — немає ні приходу, ні прихідної з цим товаром']))
  const exportUnposted = () => downloadCsv(`Непроведені прихідні ${from}_${to}.csv`,
    ['Постачальник', 'Документ', 'Дата', 'Сума', 'Позиція', 'К-сть', 'Од.', 'Ціна'],
    res.unpostedDocs.flatMap(d => (d.items.length ? d.items : [{}]).map(i => [d.contractor, d.number, d.date, d.amount, i.name || '', i.quantity ?? i.qty ?? '', i.unit || '', i.unitPrice ?? i.price ?? ''])))

  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1180, width: '96%', maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>Діагностика собівартості</h2>
            <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>Нічого не змінює: FIFO рахується в тимчасових таблицях, постійні дані лише читаються. Змінити можна лише дату приходу — кнопкою з підтвердженням.</div>
          </div>
          <button className="btn" onClick={onClose} disabled={busy}><i className="ti ti-x" /></button>
        </div>
        <div className="compact" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="form-group"><label>Відвантаження з</label><input type="date" className="form-input" value={from} onChange={e => e.target.value && setFrom(e.target.value)} /></div>
          <div className="form-group"><label>по</label><input type="date" className="form-input" value={to} onChange={e => e.target.value && setTo(e.target.value)} /></div>
          <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Рахую… (до хвилини)' : 'Запустити діагностику'}</button>
        </div>
        {err && <p style={{ color: 'var(--red)' }}>Помилка: {err}</p>}
        {res && (
          <>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13.5, marginBottom: 10 }}>
              <span>Зараз у звіті: <b>{money(res.totals.current)}</b></span>
              <span>За FIFO: <b>{money(res.totals.fifo)}</b></span>
              <span>Різниця: <b style={{ color: res.totals.fifo - res.totals.current >= 0 ? 'var(--red)' : 'var(--green)' }}>{money(res.totals.fifo - res.totals.current)}</b></span>
              <span>Позицій без партій: <b>{res.missing.length}</b></span>
              {res.totals.estValue > 0 && <span>з них оцінено поточною собівартістю ⚠: <b>{money(res.totals.estValue)}</b></span>}
              <span style={{ color: 'var(--text3)' }}>Непроведених прихідних у системі: {res.unpostedCount}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <button className={'btn btn-sm' + (tab === 'orders' ? ' btn-primary' : '')} onClick={() => setTab('orders')}>По замовленнях ({res.orderRows.length})</button>
              <button className={'btn btn-sm' + (tab === 'missing' ? ' btn-primary' : '')} onClick={() => setTab('missing')}>Без партій ({res.missing.length})</button>
              <button className={'btn btn-sm' + (tab === 'unposted' ? ' btn-primary' : '')} onClick={() => setTab('unposted')}>Непроведені прихідні ({res.unpostedDocs.length})</button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={tab === 'orders' ? exportOrders : tab === 'missing' ? exportMissing : exportUnposted}><i className="ti ti-download" /> CSV</button>
            </div>
            {tab === 'missing' && <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {[['all', 'Усі'], ...Object.entries(KINDS)].map(([k, l]) => (
                <button key={k} className={'btn btn-sm' + (filter === k ? ' btn-primary' : '')} onClick={() => setFilter(k)}>{l} ({res.missing.filter(m => hasKind(m, k)).length})</button>
              ))}
            </div>}

            {tab === 'orders' ? (
              <div className="tbl-wrap"><table>
                <thead><tr><th>Замовлення</th><th>Клієнт</th><th style={{ textAlign: 'right' }}>Відвант.</th><th style={{ textAlign: 'right' }}>Зараз у звіті</th><th style={{ textAlign: 'right' }}>За FIFO</th><th style={{ textAlign: 'right' }}>Різниця</th><th style={{ textAlign: 'right' }}>Без собів.</th><th style={{ textAlign: 'right' }}>⚠ оцінка</th><th>Ціна партій</th></tr></thead>
                <tbody>
                  {res.orderRows.map(r => (
                    <tr key={r.order} style={r.neutral ? { color: 'var(--text3)' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.orderId ? <Link to={`/orders/${r.orderId}`} onClick={onClose}>№{r.order}</Link> : r.order}</td>
                      <td><div className="trunc" style={{ maxWidth: 220 }}>{r.client}</div></td>
                      <td style={{ textAlign: 'right' }}>{r.shipments}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.current)}{r.currentMissing && <i className="ti ti-alert-triangle" title="у звіті частина позицій без собівартості" style={{ color: '#B45309', marginLeft: 4 }} />}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{money(r.fifo)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: Math.abs(r.diff) < 1 ? 'var(--text3)' : undefined }}>{r.diff > 0 ? '+' : ''}{money(r.diff)}</td>
                      <td style={{ textAlign: 'right', color: r.missingQty > 0 ? 'var(--red)' : 'var(--text3)' }}>{r.missingQty > 0 ? r.missingQty : '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: r.estQty > 0 ? '#B45309' : 'var(--text3)' }} title={r.estQty > 0 ? `${r.estQty} од. без партії оцінено поточною собівартістю` : undefined}>{r.estQty > 0 ? `${r.estQty} · ${money(r.estValue)}` : '—'}</td>
                      <td style={{ fontSize: 12, color: /з ПДВ →|неплатник/.test(r.bases) ? '#B45309' : 'var(--text2)' }}>{r.bases || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : tab === 'unposted' ? (
              res.unpostedDocs.length ? res.unpostedDocs.map(d => (
                <div key={d.id} className="card" style={{ marginBottom: 10, padding: 12 }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <b>{d.contractor}</b><span>№ {d.number} від {dmy(d.date)}</span><span>на <b>{money(d.amount)}</b> грн</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>Документи → пошук «{d.number}» → відкрити → галочка «Рух на складі» → Зберегти</span>
                  </div>
                  {d.items.length ? (
                    <table style={{ width: '100%', fontSize: 13, marginTop: 8 }}>
                      <thead><tr><th style={{ textAlign: 'left' }}>Позиція</th><th style={{ textAlign: 'right' }}>К-сть</th><th>Од.</th><th style={{ textAlign: 'right' }}>Ціна</th></tr></thead>
                      <tbody>{d.items.map((i, k) => (
                        <tr key={k}><td>{i.name}</td><td style={{ textAlign: 'right' }}>{i.quantity ?? i.qty ?? ''}</td><td>{i.unit || ''}</td><td style={{ textAlign: 'right' }}>{i.unitPrice ?? i.price ?? ''}</td></tr>
                      ))}</tbody>
                    </table>
                  ) : <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 6 }}>позицій у документі немає (не розпізнано) — відкрийте документ і перевірте скан</div>}
                </div>
              )) : <p style={{ color: 'var(--text3)' }}>Непроведених прихідних немає.</p>
            ) : (
              <div className="tbl-wrap"><table>
                <thead><tr><th>Замовлення</th><th>Видаткова</th><th>Товар</th><th style={{ textAlign: 'right' }}>Без партій</th><th>Можливі джерела</th></tr></thead>
                <tbody>
                  {missingShown.map((m, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>{m.orderId ? <Link to={`/orders/${m.orderId}`} onClick={onClose}>№{m.order}</Link> : m.order}<div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{m.client}</div></td>
                      <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: 12.5 }}>{m.doc}<div style={{ fontSize: 11.5, color: 'var(--text3)' }}>відвант. {dmy(m.date)}</div></td>
                      <td style={{ verticalAlign: 'top' }}>{m.product}{m.sku && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{m.sku}</div>}</td>
                      <td style={{ textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        {m.missingQty > 0 && <div style={{ color: 'var(--red)', fontWeight: 600 }} title="без собівартості — ні партії, ні поточної собівартості">{m.missingQty}</div>}
                        {m.estQty > 0 && <div style={{ color: '#B45309', fontWeight: 600 }} title="партії немає — оцінено поточною собівартістю">⚠ {m.estQty} × {money(m.estUnit)}</div>}
                        <span style={{ color: 'var(--text3)', fontSize: 12 }}>з {m.qty} {m.unit}</span>
                      </td>
                      <td style={{ fontSize: 12.5, verticalAlign: 'top' }}>
                        {m.candidates.length ? m.candidates.map((c, j) => (
                          <div key={j} style={{ color: c.kind === 'unposted' ? 'var(--green)' : c.kind === 'later' || c.kind === 'units' ? '#B45309' : 'var(--text2)', marginBottom: 3 }}>
                            {c.kind === 'unposted' ? '✓ ' : c.kind === 'later' ? '⏱ ' : c.kind === 'units' ? '⚠ ' : '? '}{c.text}
                            {c.kind === 'later' && (moved[c.inId]?.ok
                              ? <span style={{ color: 'var(--green)', marginLeft: 6 }}>— дату змінено на {dmy(moved[c.inId].ok)}, запустіть діагностику ще раз</span>
                              : <button className="btn btn-sm" style={{ marginLeft: 6, padding: '1px 8px', fontSize: 12 }} onClick={() => doMove(c, m)}>Перенести дату приходу на {dmy(c.outDate)}</button>)}
                            {c.kind === 'later' && moved[c.inId]?.err && <span style={{ color: 'var(--red)', marginLeft: 6 }}>{moved[c.inId].err}</span>}
                          </div>
                        )) : <span style={{ color: 'var(--text3)' }}>не знайдено — немає ні приходу, ні прихідної з цим товаром</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
              «Зараз у звіті» — собівартість, яку показують P&L «Нарахування» і «Маржа по замовленнях» (з підстановками); для списань — рядок «Списання товарів» у витратах. «За FIFO» — після перебудови: прихідна того ж замовлення (навіть пізніша; також через субзамовлення) → партії без замовлення → найстаріші на дату; ціна партії без ПДВ (з ПДВ — для постачальника-неплатника або якщо ми неплатник); на що партій немає — поточна собівартість з позначкою ⚠ (не 0). Збірки нейтральні: виріб — за собівартістю компонентів, у підсумок не входять.
              Джерела: ✓ прихідна не проведена на склад і містить цей товар — проведіть її (Документи → «Рух на складі»); ⏱ прихід є, але датований пізніше відвантаження — можна перенести дату приходу; ⚠ різні одиниці виміру; ? прихідна від постачальника цієї позиції замовлення, товар у ній не розпізнано.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtInt } from '../lib/fmt'
import { runCostDiagnostics } from '../lib/costDiagnostics'
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

  const run = async () => {
    setBusy(true); setErr(null); setRes(null)
    try { setRes(await runCostDiagnostics(from, to)) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const exportOrders = () => downloadCsv(`Собівартість зараз vs FIFO ${from}_${to}.csv`,
    ['Замовлення', 'Клієнт', 'Відвантажень', 'Зараз у звіті', 'За FIFO', 'Різниця', 'К-сть без партій', 'Ціна партій (база ПДВ)'],
    res.orderRows.map(r => [r.order, r.client, r.shipments, r.current, r.fifo, r.diff, r.missingQty, r.bases]))
  const exportMissing = () => downloadCsv(`Позиції без партій ${from}_${to}.csv`,
    ['Замовлення', 'Клієнт', 'Видаткова', 'Дата відвантаження', 'Товар', 'Артикул', 'К-сть у відвантаженні', 'Без партій', 'Можливі джерела'],
    res.missing.map(m => [m.order, m.client, m.doc, m.date, m.product, m.sku, m.qty, m.missingQty, m.candidates.map(c => c.text).join(' | ') || 'не знайдено — немає ні приходу, ні прихідної з цим товаром']))

  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1180, width: '96%', maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>Діагностика собівартості</h2>
            <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>Нічого не змінює: FIFO рахується в тимчасових таблицях, постійні дані лише читаються.</div>
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
              <span style={{ color: 'var(--text3)' }}>Непроведених прихідних у системі: {res.unpostedCount}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <button className={'btn btn-sm' + (tab === 'orders' ? ' btn-primary' : '')} onClick={() => setTab('orders')}>По замовленнях ({res.orderRows.length})</button>
              <button className={'btn btn-sm' + (tab === 'missing' ? ' btn-primary' : '')} onClick={() => setTab('missing')}>Без партій ({res.missing.length})</button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={tab === 'orders' ? exportOrders : exportMissing}><i className="ti ti-download" /> CSV</button>
            </div>

            {tab === 'orders' ? (
              <div className="tbl-wrap"><table>
                <thead><tr><th>Замовлення</th><th>Клієнт</th><th style={{ textAlign: 'right' }}>Відвант.</th><th style={{ textAlign: 'right' }}>Зараз у звіті</th><th style={{ textAlign: 'right' }}>За FIFO</th><th style={{ textAlign: 'right' }}>Різниця</th><th style={{ textAlign: 'right' }}>Без партій</th><th>Ціна партій</th></tr></thead>
                <tbody>
                  {res.orderRows.map(r => (
                    <tr key={r.order}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.orderId ? <Link to={`/orders/${r.orderId}`} onClick={onClose}>№{r.order}</Link> : r.order}</td>
                      <td><div className="trunc" style={{ maxWidth: 220 }}>{r.client}</div></td>
                      <td style={{ textAlign: 'right' }}>{r.shipments}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.current)}{r.currentMissing && <i className="ti ti-alert-triangle" title="у звіті частина позицій без собівартості" style={{ color: '#B45309', marginLeft: 4 }} />}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{money(r.fifo)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: Math.abs(r.diff) < 1 ? 'var(--text3)' : undefined }}>{r.diff > 0 ? '+' : ''}{money(r.diff)}</td>
                      <td style={{ textAlign: 'right', color: r.missingQty > 0 ? 'var(--red)' : 'var(--text3)' }}>{r.missingQty > 0 ? r.missingQty : '—'}</td>
                      <td style={{ fontSize: 12, color: /з ПДВ →|неплатник/.test(r.bases) ? '#B45309' : 'var(--text2)' }}>{r.bases || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : (
              <div className="tbl-wrap"><table>
                <thead><tr><th>Замовлення</th><th>Видаткова</th><th>Товар</th><th style={{ textAlign: 'right' }}>Без партій</th><th>Можливі джерела</th></tr></thead>
                <tbody>
                  {res.missing.map((m, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>{m.orderId ? <Link to={`/orders/${m.orderId}`} onClick={onClose}>№{m.order}</Link> : m.order}<div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{m.client}</div></td>
                      <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: 12.5 }}>{m.doc}<div style={{ fontSize: 11.5, color: 'var(--text3)' }}>відвант. {dmy(m.date)}</div></td>
                      <td style={{ verticalAlign: 'top' }}>{m.product}{m.sku && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{m.sku}</div>}</td>
                      <td style={{ textAlign: 'right', verticalAlign: 'top', color: 'var(--red)', fontWeight: 600 }}>{m.missingQty} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>з {m.qty}</span></td>
                      <td style={{ fontSize: 12.5, verticalAlign: 'top' }}>
                        {m.candidates.length ? m.candidates.map((c, j) => (
                          <div key={j} style={{ color: c.kind === 'unposted' ? 'var(--green)' : c.kind === 'later' ? '#B45309' : 'var(--text2)', marginBottom: 2 }}>
                            {c.kind === 'unposted' ? '✓ ' : c.kind === 'later' ? '⏱ ' : '? '}{c.text}
                          </div>
                        )) : <span style={{ color: 'var(--text3)' }}>не знайдено — немає ні приходу, ні прихідної з цим товаром</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
              «Зараз у звіті» — собівартість, яку показують P&L «Нарахування» і «Маржа по замовленнях» (з підстановками). «За FIFO» — після перебудови: прихідна того ж замовлення → найстаріші партії на дату, ціна партії без ПДВ (з ПДВ — для постачальника-неплатника або якщо ми неплатник).
              Джерела: ✓ прихідна не проведена на склад і містить цей товар — проведіть її (Документи → «Рух на складі»); ⏱ прихід є, але датований пізніше відвантаження; ? прихідна від постачальника цієї позиції замовлення, товар у ній не розпізнано.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

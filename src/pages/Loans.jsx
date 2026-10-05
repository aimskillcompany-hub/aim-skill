import { useEffect, useState } from 'react'
import { useCompany } from '../lib/company'
import { fmtInt } from '../lib/fmt'
import { loadPfd, fifoPlan, applyAllocations, addAllocation, removeAllocation } from '../lib/pfd'

// Поворотна фінансова допомога (ПФД): отримано / повернуто / залишок.
// Дані — з транзакцій direction='ПФД'. Повернення зв'язуються з приходами (міграція 060).

const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const EPS = 0.005

const Badge = ({ color, children }) => (
  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: color + '22', color }}>{children}</span>
)

function statusBadge(r) {
  if (r.outstanding <= EPS) return <Badge color="#16A34A">Повернуто</Badge>
  if (r.covered > EPS) return <Badge color="#D97706">Частково</Badge>
  return <Badge color="#DC2626">Відкрито</Badge>
}

export default function Loans() {
  const { activeId } = useCompany()
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const reload = async () => {
    setErr(null)
    try { setState(await loadPfd()) }
    catch (e) { setErr(e.message) }
  }
  useEffect(() => { setState(null); reload() }, [activeId])

  const autoAll = async () => {
    if (!state) return
    setBusy(true); setErr(null)
    try {
      const plan = state.groups.flatMap(g => fifoPlan(g))
      await applyAllocations(plan)
      await reload()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (err) return <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}</div>
  if (!state) return <p style={{ color: 'var(--text3)' }}>Завантаження…</p>

  const { groups, totals, needsMigration } = state

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ti ti-cash-banknote" style={{ fontSize: 22 }} />
        <h1 style={{ margin: 0 }}>Поворотна фін. допомога</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
        Отримані й повернуті позики з транзакцій (напрям «ПФД»). Зв'яжіть повернення з приходами, щоб бачити, що вже погашено.
      </p>

      {needsMigration && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--amber,#D97706)', background: '#FEF3C7' }}>
          <b>Потрібна міграція 060.</b> Запустіть <code>migrations/060_loan_allocations.sql</code> у Supabase SQL Editor,
          щоб вмикнути зв'язування повернень. Поки що показано лише суми по транзакціях.
        </div>
      )}

      {/* Підсумки */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kpi label="Отримано (усього)" value={totals.received} color="var(--text)" />
        <Kpi label="Повернуто (усього)" value={totals.returned} color="var(--text)" />
        <Kpi label="Ми винні повернути" value={totals.owedByUs} color="#DC2626" big />
        {totals.owedToUs > EPS && <Kpi label="Переплата / нам винні" value={totals.owedToUs} color="#16A34A" />}
      </div>

      {!needsMigration && (
        <button className="btn" onClick={autoAll} disabled={busy} style={{ marginBottom: 14 }}>
          <i className="ti ti-wand" /> Авто-зарахування для всіх (FIFO)
        </button>
      )}

      {groups.length === 0
        ? <div className="card"><p style={{ color: 'var(--text3)' }}>Транзакцій ПФД немає. Познач у Банк/Каса напрям «ПФД» для позик.</p></div>
        : groups.map(g => <GroupCard key={g.key} group={g} allocations={state.allocations} readOnly={needsMigration} onChange={reload} />)}
    </div>
  )
}

function Kpi({ label, value, color, big }) {
  return (
    <div className="card" style={{ flex: '1 1 180px', minWidth: 160, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: big ? 24 : 20, fontWeight: 700, color }}>{fmtInt(value)} ₴</div>
    </div>
  )
}

function GroupCard({ group, allocations, readOnly, onChange }) {
  const [open, setOpen] = useState(group.net > EPS) // відкриті (ми ще винні) — розгорнуті
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [link, setLink] = useState(null) // { returnTxId, receiptTxId, amount }

  const txIds = new Set([...group.receipts.map(r => r.id), ...group.returns.map(r => r.id)])
  const groupAllocs = (allocations || []).filter(a => txIds.has(a.receipt_tx_id) && txIds.has(a.return_tx_id))
  const recById = Object.fromEntries(group.receipts.map(r => [r.id, r]))
  const retById = Object.fromEntries(group.returns.map(r => [r.id, r]))

  const run = async (fn) => {
    setBusy(true); setErr(null)
    try { await fn(); await onChange() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const auto = () => run(() => applyAllocations(fifoPlan(group)))

  const openReceipts = group.receipts.filter(r => r.outstanding > EPS)
  const openReturns = group.returns.filter(r => r.unallocated > EPS)

  const startLink = (returnTxId) => {
    const ret = retById[returnTxId]
    const rec = openReceipts[0]
    setLink({
      returnTxId,
      receiptTxId: rec?.id || '',
      amount: rec ? Math.min(ret.unallocated, rec.outstanding) : ret.unallocated,
    })
  }
  const saveLink = () => run(async () => {
    const ret = retById[link.returnTxId], rec = recById[link.receiptTxId]
    const amt = Math.min(Number(link.amount) || 0, ret.unallocated, rec.outstanding)
    if (amt <= EPS) throw new Error('Сума зарахування нульова')
    await addAllocation({ receiptTxId: link.receiptTxId, returnTxId: link.returnTxId, amount: amt })
    setLink(null)
  })

  const netColor = group.net > EPS ? '#DC2626' : group.net < -EPS ? '#16A34A' : '#16A34A'
  const netLabel = group.net > EPS ? `Ми винні ${fmtInt(group.net)} ₴`
    : group.net < -EPS ? `Переплата ${fmtInt(-group.net)} ₴` : 'Погашено'

  return (
    <div className="card" style={{ marginBottom: 12, padding: 0 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}>
        <i className={`ti ti-chevron-${open ? 'down' : 'right'}`} style={{ color: 'var(--text3)' }} />
        <div style={{ fontWeight: 600, flex: 1 }}>{group.name}</div>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          отримано {fmtInt(group.received)} · повернуто {fmtInt(group.returned)}
        </span>
        <Badge color={netColor}>{netLabel}</Badge>
      </div>

      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
          {err && <div style={{ color: 'var(--red)', fontSize: 13, margin: '10px 0' }}>{err}</div>}

          {!readOnly && openReturns.length > 0 && openReceipts.length > 0 && (
            <button className="btn" onClick={auto} disabled={busy} style={{ margin: '12px 0' }}>
              <i className="ti ti-wand" /> Авто (FIFO) для цього контрагента
            </button>
          )}

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12 }}>
            {/* Отримано */}
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>ОТРИМАНО (приходи)</div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Дата</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Сума</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Залишок</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Статус</th>
                </tr></thead>
                <tbody>
                  {group.receipts.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }} title={r.description || r.counterparty || ''}>
                      <td style={{ padding: '6px' }}>{d(r.date)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>{fmtInt(r.amount)}</td>
                      <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600 }}>{fmtInt(r.outstanding)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>{statusBadge(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Повернуто */}
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>ПОВЕРНУТО (видатки)</div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Дата</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Сума</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Незараховано</th>
                  {!readOnly && <th style={{ padding: '4px 6px' }} />}
                </tr></thead>
                <tbody>
                  {group.returns.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }} title={r.description || r.counterparty || ''}>
                      <td style={{ padding: '6px' }}>{d(r.date)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>{fmtInt(r.abs)}</td>
                      <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600, color: r.unallocated > EPS ? '#D97706' : 'var(--text3)' }}>{fmtInt(r.unallocated)}</td>
                      {!readOnly && <td style={{ padding: '6px', textAlign: 'right' }}>
                        {r.unallocated > EPS && openReceipts.length > 0 &&
                          <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => startLink(r.id)}>Зарахувати</button>}
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Форма ручного зарахування */}
          {link && (() => {
            const ret = retById[link.returnTxId]
            return (
              <div style={{ marginTop: 14, padding: 12, background: 'var(--surface2)', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12 }}>
                  <div style={{ color: 'var(--text3)' }}>Повернення {d(ret.date)} · {fmtInt(ret.abs)} ₴ (вільно {fmtInt(ret.unallocated)})</div>
                  <div style={{ marginTop: 4 }}>→ на прихід:</div>
                </div>
                <select className="form-input" value={link.receiptTxId} onChange={e => {
                  const rec = recById[e.target.value]
                  setLink(l => ({ ...l, receiptTxId: e.target.value, amount: Math.min(ret.unallocated, rec?.outstanding || 0) }))
                }} style={{ minWidth: 220 }}>
                  {openReceipts.map(rec => <option key={rec.id} value={rec.id}>{d(rec.date)} · {fmtInt(rec.amount)} (залишок {fmtInt(rec.outstanding)})</option>)}
                </select>
                <input className="form-input" type="number" value={link.amount}
                  onChange={e => setLink(l => ({ ...l, amount: e.target.value }))} style={{ width: 120 }} />
                <button className="btn btn-primary" onClick={saveLink} disabled={busy}>Зарахувати</button>
                <button className="btn" onClick={() => setLink(null)}>Скасувати</button>
              </div>
            )
          })()}

          {/* Наявні зв'язки */}
          {groupAllocs.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>ЗВ'ЯЗКИ</div>
              {groupAllocs.map(a => {
                const rec = recById[a.receipt_tx_id], ret = retById[a.return_tx_id]
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                    <span style={{ color: 'var(--text2)' }}>
                      Повернення {ret ? d(ret.date) : '?'} → прихід {rec ? d(rec.date) : '?'}: <b>{fmtInt(a.amount)} ₴</b>
                    </span>
                    {!readOnly && <button className="btn" style={{ fontSize: 11, padding: '1px 6px' }} disabled={busy}
                      onClick={() => run(() => removeAllocation(a.id))}><i className="ti ti-x" /></button>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

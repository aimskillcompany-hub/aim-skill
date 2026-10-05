import { useEffect, useState } from 'react'
import { useCompany } from '../lib/company'
import { fmtInt } from '../lib/fmt'
import { loadPfd, fifoPlan, applyAllocations, addAllocation, removeAllocation } from '../lib/pfd'

// Поворотна фінансова допомога (ПФД) в обидва боки:
//   borrower (ми позичальник) — отримали ПФД, маємо повернути;
//   lender   (ми кредитор)    — надали ПФД, нам мають повернути.
// Роль визначається per контрагент у lib/pfd.js. Дані — з транзакцій direction='ПФД'.

const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const EPS = 0.005

// Підписи колонок/статусів залежно від ролі
const LABELS = {
  borrower: { role: 'Ми позичальник', principal: 'ОТРИМАНО', settlement: 'ПОВЕРНУТО НАМИ', open: 'Ми винні', done: 'Повернуто' },
  lender:   { role: 'Ми кредитор',    principal: 'НАДАНО НАМИ', settlement: 'ПОВЕРНУТО НАМ',  open: 'Нам винні', done: 'Повернено нам' },
}

const Badge = ({ color, children }) => (
  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: color + '22', color }}>{children}</span>
)

function statusBadge(p, role) {
  if (p.outstanding <= EPS) return <Badge color="#16A34A">{role === 'lender' ? 'Повернено' : 'Повернуто'}</Badge>
  if (p.covered > EPS) return <Badge color="#D97706">Частково</Badge>
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
        Позики в обидва боки (напрям «ПФД»). Роль визначається автоматично: отримали ПФД — <b>ми позичальник</b>, надали — <b>ми кредитор</b>.
      </p>

      {needsMigration && (
        <div className="card" style={{ marginBottom: 14, borderColor: '#D97706', background: '#FEF3C7' }}>
          <b>Потрібна міграція 060.</b> Запустіть <code>migrations/060_loan_allocations.sql</code> у Supabase SQL Editor,
          щоб вмикнути зв'язування погашень. Поки що показано лише суми по транзакціях.
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kpi label="Ми винні повернути" value={totals.owedByUs} color="#DC2626" big />
        <Kpi label="Нам мають повернути" value={totals.owedToUs} color="#16A34A" big />
        <Kpi label="Отримано ПФД (усього)" value={totals.borrowedTotal} color="var(--text)" />
        <Kpi label="Надано нами (усього)" value={totals.lentTotal} color="var(--text)" />
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
  const L = LABELS[group.role]
  const [open, setOpen] = useState(group.net > EPS) // відкритий борг — розгорнуто
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [link, setLink] = useState(null) // { settlementTxId, principalTxId, amount }

  const txIds = new Set([...group.principals.map(r => r.id), ...group.settlements.map(r => r.id)])
  const groupAllocs = (allocations || []).filter(a => txIds.has(a.receipt_tx_id) && txIds.has(a.return_tx_id))
  const prById = Object.fromEntries(group.principals.map(r => [r.id, r]))
  const stById = Object.fromEntries(group.settlements.map(r => [r.id, r]))

  const run = async (fn) => {
    setBusy(true); setErr(null)
    try { await fn(); await onChange() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const auto = () => run(() => applyAllocations(fifoPlan(group)))

  const openPrincipals = group.principals.filter(r => r.outstanding > EPS)
  const openSettlements = group.settlements.filter(r => r.unallocated > EPS)

  const startLink = (settlementTxId) => {
    const st = stById[settlementTxId]
    const pr = openPrincipals[0]
    setLink({ settlementTxId, principalTxId: pr?.id || '', amount: pr ? Math.min(st.unallocated, pr.outstanding) : st.unallocated })
  }
  const saveLink = () => run(async () => {
    const st = stById[link.settlementTxId], pr = prById[link.principalTxId]
    const amt = Math.min(Number(link.amount) || 0, st.unallocated, pr.outstanding)
    if (amt <= EPS) throw new Error('Сума зарахування нульова')
    await addAllocation({ principalTxId: link.principalTxId, settlementTxId: link.settlementTxId, amount: amt })
    setLink(null)
  })

  const netColor = group.net > EPS ? (group.role === 'lender' ? '#16A34A' : '#DC2626') : '#16A34A'
  const netLabel = group.net > EPS ? `${L.open} ${fmtInt(group.net)} ₴` : 'Погашено'
  const roleColor = group.role === 'lender' ? '#2563EB' : '#7C3AED'

  return (
    <div className="card" style={{ marginBottom: 12, padding: 0 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', flexWrap: 'wrap' }}>
        <i className={`ti ti-chevron-${open ? 'down' : 'right'}`} style={{ color: 'var(--text3)' }} />
        <div style={{ fontWeight: 600, flex: 1 }}>{group.name}</div>
        <Badge color={roleColor}>{L.role}</Badge>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          {group.role === 'lender' ? 'надано' : 'отримано'} {fmtInt(group.principalTotal)} · погашено {fmtInt(group.settledTotal)}
        </span>
        <Badge color={netColor}>{netLabel}</Badge>
      </div>

      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
          {err && <div style={{ color: 'var(--red)', fontSize: 13, margin: '10px 0' }}>{err}</div>}

          {!readOnly && openSettlements.length > 0 && openPrincipals.length > 0 && (
            <button className="btn" onClick={auto} disabled={busy} style={{ margin: '12px 0' }}>
              <i className="ti ti-wand" /> Авто (FIFO) для цього контрагента
            </button>
          )}

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12 }}>
            {/* Тіло боргу */}
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>{L.principal}</div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Дата</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Сума</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Залишок</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Статус</th>
                </tr></thead>
                <tbody>
                  {group.principals.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }} title={r.description || r.counterparty || ''}>
                      <td style={{ padding: '6px' }}>{d(r.date)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>{fmtInt(r.abs)}</td>
                      <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600 }}>{fmtInt(r.outstanding)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>{statusBadge(r, group.role)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Погашення */}
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>{L.settlement}</div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Дата</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Сума</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Незараховано</th>
                  {!readOnly && <th style={{ padding: '4px 6px' }} />}
                </tr></thead>
                <tbody>
                  {group.settlements.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }} title={r.description || r.counterparty || ''}>
                      <td style={{ padding: '6px' }}>{d(r.date)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>{fmtInt(r.abs)}</td>
                      <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600, color: r.unallocated > EPS ? '#D97706' : 'var(--text3)' }}>{fmtInt(r.unallocated)}</td>
                      {!readOnly && <td style={{ padding: '6px', textAlign: 'right' }}>
                        {r.unallocated > EPS && openPrincipals.length > 0 &&
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
            const st = stById[link.settlementTxId]
            return (
              <div style={{ marginTop: 14, padding: 12, background: 'var(--surface2)', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12 }}>
                  <div style={{ color: 'var(--text3)' }}>Погашення {d(st.date)} · {fmtInt(st.abs)} ₴ (вільно {fmtInt(st.unallocated)})</div>
                  <div style={{ marginTop: 4 }}>→ на {group.role === 'lender' ? 'надане' : 'отримане'}:</div>
                </div>
                <select className="form-input" value={link.principalTxId} onChange={e => {
                  const pr = prById[e.target.value]
                  setLink(l => ({ ...l, principalTxId: e.target.value, amount: Math.min(st.unallocated, pr?.outstanding || 0) }))
                }} style={{ minWidth: 220 }}>
                  {openPrincipals.map(pr => <option key={pr.id} value={pr.id}>{d(pr.date)} · {fmtInt(pr.abs)} (залишок {fmtInt(pr.outstanding)})</option>)}
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
                const pr = prById[a.receipt_tx_id], st = stById[a.return_tx_id]
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                    <span style={{ color: 'var(--text2)' }}>
                      Погашення {st ? d(st.date) : '?'} → {group.role === 'lender' ? 'надане' : 'отримане'} {pr ? d(pr.date) : '?'}: <b>{fmtInt(a.amount)} ₴</b>
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

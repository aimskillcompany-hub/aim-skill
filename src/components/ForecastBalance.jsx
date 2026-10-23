import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '../lib/auth'
import { useCompany } from '../lib/company'
import { fmtInt } from '../lib/fmt'
import { labelForStatus, statusAccent } from '../lib/orders'
import { loadForecast, flattenForecast, currentCashByCompany, addForecastItem, removeForecastItem } from '../lib/forecast'
import { todayKyiv } from '../lib/dates'
import { useNewUi } from '../lib/uiPrefs'
import ForecastNew from './ForecastNew'
import { TableSkeleton, Callout } from './ui'

// «Прогноз»: рядки генеруються із замовлень (план − факт), тут лише перегляд.
// Вручну — тільки надходження/витрати без замовлення (оренда, зарплата…).
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const today = () => todayKyiv()
const MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const money = (v) => `${v < 0 ? '−' : ''}${fmtInt(v)}`

export default function ForecastBalance() {
  const { user } = useUser()
  const { companies } = useCompany()
  const [data, setData] = useState(null)
  const [cash, setCash] = useState(null)
  const [err, setErr] = useState(null)
  const [co, setCo] = useState('all')
  const [open, setOpen] = useState({})
  const newUi = useNewUi()

  const reload = () => {
    setErr(null)
    Promise.all([loadForecast(), currentCashByCompany().catch(() => ({}))])
      .then(([f, c]) => { setData(f); setCash(c) }).catch(e => setErr(e.message))
  }
  useEffect(() => { reload() }, [])

  const flat = useMemo(() => data ? flattenForecast(data).filter(x => co === 'all' || x.companyId === co) : [], [data, co])

  // Таблиця по місяцях: прострочене/без дати — у поточний місяць
  const months = useMemo(() => {
    const now = today().slice(0, 7)
    const map = {}
    flat.forEach(x => {
      const ym = !x.date || x.date.slice(0, 7) < now ? now : x.date.slice(0, 7)
      const m = (map[ym] ||= { ym, income: 0, expense: 0, byCo: {} })
      if (x.kind === 'income') m.income += x.amount; else m.expense += x.amount
      const c = (m.byCo[x.companyId] ||= { income: 0, expense: 0 })
      if (x.kind === 'income') c.income += x.amount; else c.expense += x.amount
    })
    const startCash = Object.entries(cash || {}).reduce((s, [cid, v]) => s + (co === 'all' || cid === co ? v : 0), 0)
    let bal = startCash
    return { startCash, rows: Object.values(map).sort((a, b) => a.ym.localeCompare(b.ym)).map(m => { bal += m.income - m.expense; return { ...m, net: m.income - m.expense, balance: bal } }) }
  }, [flat, cash, co])

  if (err) return newUi ? <Callout tone="danger" title="Не вдалося порахувати прогноз." text={err} /> : <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}</div>
  if (!data) return newUi ? <TableSkeleton rows={8} cols={6} label="Рахую прогноз…" /> : <p style={{ color: 'var(--text3)' }}>Завантаження…</p>

  const orders = data.orders.filter(o => co === 'all' || o.companyId === co)
  const manual = data.manual.filter(m => co === 'all' || m.company_id === co)
  const income = flat.filter(x => x.kind === 'income').reduce((s, x) => s + x.amount, 0)
  const expense = flat.filter(x => x.kind === 'expense').reduce((s, x) => s + x.amount, 0)
  const coList = (companies || []).filter(c => Object.keys(cash || {}).includes(c.id) || data.orders.some(o => o.companyId === c.id) || data.manual.some(m => m.company_id === c.id))
  const f = data.flags || {}
  if (newUi) return <ForecastNew months={months} orders={orders} manual={manual} flags={f} co={co} setCo={setCo} coList={coList} companies={companies} userId={user?.id} onChange={reload} />

  return (
    <div>
      {(f.no057 || f.no067 || f.no065) && (
        <div className="card" style={{ marginBottom: 14, fontSize: 13, color: 'var(--text2)', borderLeft: '4px solid #F2C07A' }}>
          <i className="ti ti-alert-triangle" style={{ color: '#B7791F' }} /> Не всі міграції застосовані — прогноз неповний:
          {f.no057 && <> <b>057</b> (факт оплат із «Реальної прибутковості» не віднімається);</>}
          {f.no065 && <> <b>065</b> («Інші витрати» замовлень);</>}
          {f.no067 && <> <b>067</b> (графік платежів і ПДВ закупівлі — дати за правилами).</>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>Юрособа:</span>
        {[{ id: 'all', short_name: 'Усі' }, ...coList].map(c => (
          <button key={c.id} className={'btn btn-sm' + (co === c.id ? ' btn-primary' : '')} style={{ minHeight: 30, padding: '4px 12px', fontSize: 12.5 }} onClick={() => setCo(c.id)}>{c.short_name || c.name}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kpi label="Гроші зараз" value={months.startCash} />
        <Kpi label="Очікувані надходження" value={income} color="#16A34A" />
        <Kpi label="Очікувані витрати" value={-expense} color="#DC2626" />
        <Kpi label="Чистий потік" value={income - expense} color="#2563EB" />
        <Kpi label="Гроші після прогнозу" value={months.startCash + income - expense} color="#2563EB" big />
      </div>

      {/* По місяцях */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Рух грошей по місяцях</div>
        {months.rows.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13, margin: 0 }}>Немає очікуваних рухів.</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <th>Місяць</th><th style={{ textAlign: 'right' }}>Надходження</th><th style={{ textAlign: 'right' }}>Витрати</th>
                <th style={{ textAlign: 'right' }}>Чистий потік</th><th style={{ textAlign: 'right' }}>Залишок грошей</th>
              </tr></thead>
              <tbody>
                <tr style={{ color: 'var(--text3)' }}><td>Зараз</td><td /><td /><td /><td style={{ textAlign: 'right' }}>{money(months.startCash)}</td></tr>
                {months.rows.map((m, i) => (
                  <Fragment key={m.ym}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{MONTHS[Number(m.ym.slice(5)) - 1]} {m.ym.slice(0, 4)}{i === 0 && <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}> · з простроченим</span>}</td>
                      <td style={{ textAlign: 'right', color: '#16A34A' }}>+{fmtInt(m.income)}</td>
                      <td style={{ textAlign: 'right', color: '#DC2626' }}>−{fmtInt(m.expense)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: m.net >= 0 ? '#16A34A' : '#DC2626' }}>{m.net >= 0 ? '+' : '−'}{fmtInt(m.net)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: m.balance < 0 ? '#DC2626' : undefined }}>{money(m.balance)}</td>
                    </tr>
                    {co === 'all' && coList.length > 1 && Object.entries(m.byCo).map(([cid, v]) => (
                      <tr key={cid} style={{ fontSize: 12, color: 'var(--text2)' }}>
                        <td style={{ paddingLeft: 22 }}>{coList.find(c => c.id === cid)?.short_name || coList.find(c => c.id === cid)?.name || '—'}</td>
                        <td style={{ textAlign: 'right' }}>+{fmtInt(v.income)}</td>
                        <td style={{ textAlign: 'right' }}>−{fmtInt(v.expense)}</td>
                        <td style={{ textAlign: 'right' }}>{v.income - v.expense >= 0 ? '+' : '−'}{fmtInt(v.income - v.expense)}</td>
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Замовлення */}
      <div className="card-title" style={{ margin: '4px 0 8px' }}>Замовлення в прогнозі ({orders.length})</div>
      {orders.length === 0 ? (
        <div className="card" style={{ marginBottom: 16 }}><p style={{ color: 'var(--text3)', margin: 0, fontSize: 13 }}>
          Немає замовлень у прогнозі. Познач замовлення <i className="ti ti-trending-up" style={{ color: '#2563EB' }} /> «в прогноз» у реєстрі <b>Замовлення</b>. Суми й дати беруться із самого замовлення (вкладка «Прибутковість» → «Графік платежів»).
        </p></div>
      ) : orders.map(o => {
        const isOpen = !!open[o.id]
        const pending = o.lines.filter(l => l.remaining > 0.5)
        return (
          <div key={o.id} className="card" style={{ marginBottom: 10, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen(s => ({ ...s, [o.id]: !s[o.id] }))}>
              <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} style={{ color: 'var(--text3)' }} />
              <Link to={`/orders/${o.id}`} onClick={e => e.stopPropagation()} style={{ fontWeight: 600 }}>№{o.number}</Link>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: (statusAccent(o.status) || '#999') + '22', color: statusAccent(o.status) || 'var(--text2)' }}>{labelForStatus(o.status)}</span>
              <span style={{ fontSize: 13, color: 'var(--text2)', flex: 1, minWidth: 120 }} className="trunc">{o.client} · {o.company}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                +{fmtInt(o.income)} · −{fmtInt(o.expense)} · нетто <b style={{ color: o.net >= 0 ? '#16A34A' : '#DC2626' }}>{money(o.net)}</b>
              </span>
            </div>
            {isOpen && (
              <div className="tbl-wrap" style={{ border: 'none', marginTop: 8 }}>
                <table>
                  <thead><tr><th>Рядок</th><th style={{ textAlign: 'right' }}>План</th><th style={{ textAlign: 'right' }}>Залишок</th><th>Дата</th><th>Стан</th></tr></thead>
                  <tbody>
                    {o.lines.map(l => {
                      const color = l.kind === 'income' ? '#16A34A' : '#DC2626'
                      const sign = l.kind === 'income' ? '+' : '−'
                      return (
                        <tr key={l.key} style={l.remaining <= 0.5 ? { color: 'var(--text3)' } : undefined}>
                          <td><span style={{ color, fontWeight: 600 }}>{l.kind === 'income' ? '↓' : '↑'}</span> {l.label}{l.flag === 'receivable' && <span style={{ fontSize: 11, color: '#B7791F' }}> · дебіторка</span>}</td>
                          <td style={{ textAlign: 'right' }}>{sign}{fmtInt(Math.abs(l.plan))}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: l.remaining > 0.5 ? color : undefined }}>{l.remaining > 0.5 ? sign + fmtInt(l.remaining) : '—'}</td>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(l.date)}{l.estimated && l.remaining > 0.5 && <span style={{ fontSize: 11, color: 'var(--text3)' }}> · орієнт.</span>}{l.overdue && <span style={{ fontSize: 11, color: '#DC2626' }}> · прострочено</span>}</td>
                          <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.remaining <= 0.5 ? (l.note || 'виконано') : l.fact > 0.5 ? 'частково оплачено' : 'план'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {pending.length === 0 && <p style={{ fontSize: 12, color: 'var(--text3)', margin: '6px 0 0' }}>Усе за замовленням уже виконано — у прогноз нічого не йде.</p>}
                <p style={{ fontSize: 12, color: 'var(--text3)', margin: '6px 0 0' }}>Редагується в замовленні: вкладка «Товари» (суми) і «Прибутковість» → «Графік платежів» (дати).</p>
              </div>
            )}
          </div>
        )
      })}

      {/* Ручні рядки без замовлення */}
      <ManualBlock items={manual} companies={coList.length ? coList : (companies || [])} defaultCompany={co !== 'all' ? co : (companies?.[0]?.id || null)} userId={user?.id} onChange={reload} />
    </div>
  )
}

function ManualBlock({ items, companies, defaultCompany, userId, onChange }) {
  const [adding, setAdding] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); await onChange() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const save = () => run(async () => {
    if (!(Number(adding.amount) > 0)) throw new Error('Вкажіть суму')
    if (!adding.companyId) throw new Error('Оберіть юрособу')
    await addForecastItem({ companyId: adding.companyId, kind: adding.kind, amount: adding.amount, expectedDate: adding.date, note: adding.note, userId })
    setAdding(null)
  })
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="card-title" style={{ margin: 0 }}>Інші витрати і надходження (без замовлення)</div>
        {!adding && <button className="btn btn-sm" onClick={() => setAdding({ kind: 'expense', amount: '', date: today(), note: '', companyId: defaultCompany })}><i className="ti ti-plus" /> Додати</button>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 8px' }}>Оренда, зарплата, податки компанії тощо — те, що не належить жодному замовленню.</p>
      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{err}</div>}
      {items.length > 0 && (
        <div className="tbl-wrap" style={{ border: 'none', marginBottom: 8 }}>
          <table>
            <tbody>
              {items.map(l => (
                <tr key={l.id}>
                  <td style={{ width: 120 }}><span style={{ fontSize: 12, fontWeight: 600, color: l.kind === 'income' ? '#16A34A' : '#DC2626' }}>{l.kind === 'income' ? '↓ Надходження' : '↑ Витрата'}</span></td>
                  <td>{l.note || '—'} <span style={{ fontSize: 12, color: 'var(--text3)' }}>· {l.company}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.kind === 'expense' ? '−' : '+'}{fmtInt(l.amount)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d(l.expected_date)}</td>
                  <td style={{ textAlign: 'right', width: 36 }}><button className="btn" style={{ padding: '2px 6px' }} disabled={busy} onClick={() => run(() => removeForecastItem(l.id))}><i className="ti ti-x" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length === 0 && !adding && <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>Немає ручних рядків.</p>}
      {adding && (
        <div className="compact" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, alignItems: 'end', background: 'var(--surface2)', padding: 10, borderRadius: 8 }}>
          <div className="form-group"><label>Тип</label>
            <select className="form-input" value={adding.kind} onChange={e => setAdding(a => ({ ...a, kind: e.target.value }))}><option value="expense">Витрата</option><option value="income">Надходження</option></select></div>
          <div className="form-group"><label>Юрособа</label>
            <select className="form-input" value={adding.companyId || ''} onChange={e => setAdding(a => ({ ...a, companyId: e.target.value }))}><option value="">—</option>{companies.map(c => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}</select></div>
          <div className="form-group"><label>Сума</label><input className="form-input" type="number" value={adding.amount} onChange={e => setAdding(a => ({ ...a, amount: e.target.value }))} autoFocus /></div>
          <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={adding.date} onChange={e => setAdding(a => ({ ...a, date: e.target.value }))} /></div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}><label>Що це</label><input className="form-input" value={adding.note} onChange={e => setAdding(a => ({ ...a, note: e.target.value }))} placeholder="напр. Оренда офісу, жовтень" /></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>Додати</button>
            <button className="btn btn-sm" onClick={() => setAdding(null)}>Скасувати</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, color, big }) {
  return (
    <div className="card" style={{ flex: '1 1 170px', minWidth: 160, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 19, fontWeight: 700, color }}>{money(value)} ₴</div>
    </div>
  )
}

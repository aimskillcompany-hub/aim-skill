// «Прогноз → Угоди в роботі» — новий інтерфейс (ТЗ редизайну 5.3; макети Forecast / ForecastMobile).
// Звіт лише для перегляду: цифри — ті самі loadForecast / currentCashByCompany; зміни — у замовленні.
// Виняток (рішення власника 23.10.2026): постійні витрати й надходження без замовлення додаються тут.
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { addForecastItem, removeForecastItem } from '../lib/forecast'
import { todayKyiv } from '../lib/dates'
import { formatAmount, plural } from '../utils/format'
import { Button, Modal, Segmented, EmptyState, Callout, Menu, InfoTip } from './ui'
import '../pages/Reports.css'
import '../pages/AnalyticsNew.css'
import './ForecastNew.css'

const n0 = (v) => formatAmount(v, { decimals: 0 })
const sg = (v) => formatAmount(v, { decimals: 0, sign: 'always' })
const dmy = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const MS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const MLOC = ['січні', 'лютому', 'березні', 'квітні', 'травні', 'червні', 'липні', 'серпні', 'вересні', 'жовтні', 'листопаді', 'грудні']
const MNOM = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']
const mIdx = (ym) => Number(ym.slice(5, 7)) - 1

// «Що заважає» (макет Forecast): етап замовлення, який тримає гроші; інакше — стан графіка платежів
const BLOCKER = { new: 'Не опрацьовано', tender: 'Тендер ще триває', needs_contract: 'Потрібен договір' }

export default function ForecastNew({ months, orders, manual, flags, co, setCo, coList, companies, userId, onChange }) {
  const [open, setOpen] = useState({})
  const [adding, setAdding] = useState(null)
  const income = months.rows.reduce((s, m) => s + m.income, 0), expense = months.rows.reduce((s, m) => s + m.expense, 0)
  const after = months.startCash + income - expense
  const last = months.rows[months.rows.length - 1]
  // касовий розрив: найнижча точка залишку після «зараз»
  const low = months.rows.reduce((a, m) => (!a || m.balance < a.balance ? m : a), null)
  const gap = low && (low.balance < 0 || (low.net < 0 && low.balance < months.startCash))
  // графік
  const pts = [{ label: 'Зараз', balance: months.startCash }, ...months.rows.map((m, i) => ({ ...m, label: `${MS[mIdx(m.ym)]} ${m.ym.slice(0, 4)}${i === 0 ? ' · з простроченим' : ''}` }))]
  const vMax = Math.max(1, ...pts.map(p => Math.abs(p.balance)), ...months.rows.map(m => Math.max(m.income, m.expense)))
  const tot = orders.reduce((a, o) => ({ inc: a.inc + o.income, exp: a.exp + o.expense, net: a.net + o.net, pNet: a.pNet + (o.plan?.net || 0), rev: a.rev + (o.plan?.revenueNet || 0) }), { inc: 0, exp: 0, net: 0, pNet: 0, rev: 0 })

  return (
    <div className="rpt fcn">
      {(flags.no057 || flags.no065 || flags.no067) && <Callout tone="warn" title="Прогноз неповний" text={`— не застосовані міграції: ${[flags.no057 && '057', flags.no065 && '065', flags.no067 && '067'].filter(Boolean).join(', ')}.`} />}
      {coList.length > 1 && <Segmented ariaLabel="Юрособа" value={co} onChange={setCo} options={[{ value: 'all', label: 'Усі' }, ...coList.map(c => ({ value: c.id, label: c.short_name || c.name }))]} />}

      {/* веб (ТЗ 5.3, рішення 23.10.2026): три картки залишку — зараз → найнижчий місяць → кінець прогнозу */}
      <section className="rpt-card fcn-three" aria-label="Гроші на рахунках по місяцях">
        <div className="fcn-three-h"><h2 className="rpt-h3">Гроші на рахунках по місяцях</h2>
          <span className="rpt-muted">прийде <b className="fcn-in">+{n0(income)}</b> · піде <b className="fcn-out">−{n0(expense)}</b> · {orders.length} {plural(orders.length, ['замовлення', 'замовлення', 'замовлень'])}</span></div>
        <div className="fcn-three-c">
          <div className="fcn-mc"><span>Зараз</span><b>{n0(months.startCash)} ₴</b><small>на всіх рахунках</small></div>
          {low && last && low !== last && <>
            <i className="ti ti-arrow-right" aria-hidden="true" />
            <div className={`fcn-mc is-low${low.balance < 0 ? ' is-neg' : ''}`}><span>{MNOM[mIdx(low.ym)][0].toUpperCase() + MNOM[mIdx(low.ym)].slice(1)}<em>найнижча точка</em></span>
              <b>{n0(low.balance)} ₴</b><small>{formatAmount(low.net, { decimals: 0, sign: 'always' })} · прийде {n0(low.income)}, піде {n0(low.expense)}</small></div>
          </>}
          {last && <>
            <i className="ti ti-arrow-right" aria-hidden="true" />
            <div className="fcn-mc is-end"><span>{MNOM[mIdx(last.ym)][0].toUpperCase() + MNOM[mIdx(last.ym)].slice(1)}<em>після прогнозу</em></span>
              <b className={after < 0 ? 'is-neg' : ''}>{n0(after)} ₴</b><small>{formatAmount(after - months.startCash, { decimals: 0, sign: 'always' })} за весь прогноз</small></div>
          </>}
        </div>
        {gap && <p className="fcn-three-gap">У {MLOC[mIdx(low.ym)]} піде {n0(low.expense)} ₴, а прийде {n0(low.income)} ₴ — у найнижчій точці {low.balance < 0 ? <>бракуватиме <b>{n0(-low.balance)} ₴</b></> : <>залишиться {n0(low.balance)} ₴</>}.</p>}
        {manual.length === 0 && <p className="fcn-three-note"><i aria-hidden="true" />Оренда, зарплата й податки без замовлення в прогноз не входять, тому залишок завищений.
          <button type="button" className="rpt-link" onClick={() => setAdding({ kind: 'expense', amount: '', date: todayKyiv(), note: '', companyId: co !== 'all' ? co : (companies?.[0]?.id || '') })}>Додати постійні витрати</button></p>}
      </section>

      <section className="fcn-hero" aria-label="Гроші після прогнозу">
        <div className="fcn-eq">
          <div><span>Гроші зараз</span><b>{n0(months.startCash)} ₴</b></div><i aria-hidden="true">+</i>
          <div><span>Прийде</span><b className="is-in">{n0(income)} ₴</b></div><i aria-hidden="true">−</i>
          <div><span>Піде</span><b className="is-out">{n0(expense)} ₴</b></div><i aria-hidden="true">=</i>
          <div className="is-res"><span>Гроші після прогнозу{last ? ` · ${MNOM[mIdx(last.ym)]}` : ''}</span><b className={after < 0 ? 'is-neg' : ''}>{n0(after)} ₴</b></div>
        </div>
        {gap && (
          <div className={`fcn-gap${low.balance < 0 ? ' is-bad' : ''}`}>
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <span><b>Касовий розрив у {MLOC[mIdx(low.ym)]}:</b> цього місяця піде {n0(low.expense)} ₴, а прийде {n0(low.income)} ₴. У найнижчій точці {low.balance < 0 ? <>бракуватиме <b>{n0(-low.balance)} ₴</b></> : <>залишиться {n0(low.balance)} ₴</>}.</span>
          </div>
        )}
      </section>

      <div className="fcn-mid">
        <section className="cfn-card fcn-chart" aria-label="Рух грошей по місяцях">
          <div className="pln-months-head"><h2>Рух грошей по місяцях</h2>
            <div className="pln-legend"><span><i className="fcn-l-in" />надходження</span><span><i className="fcn-l-out" />витрати</span><span><i className="fcn-l-bal" />залишок</span></div></div>
          {months.rows.length === 0 ? <p className="rpt-muted">Немає очікуваних рухів.</p> : (
            <div className="fcn-cols">
              <svg className="fcn-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline points={pts.map((p, i) => `${((i + 0.5) / pts.length) * 100},${50 - (p.balance / vMax) * 45}`).join(' ')} vectorEffect="non-scaling-stroke" />
              </svg>
              {pts.map((p, i) => (
                <div key={i} className="fcn-col">
                  <span className={`fcn-bal${p.balance < 0 ? ' is-neg' : ''}`} style={{ bottom: `calc(50% + ${(p.balance / vMax) * 45}%)` }}>{n0(p.balance)}</span>
                  <i className={`fcn-dot${p.balance < 0 ? ' is-neg' : ''}`} style={{ bottom: `calc(50% + ${(p.balance / vMax) * 45}% - 5px)` }} />
                  {i > 0 && <>
                    {p.income > 0 && <span className="fcn-bar is-in" style={{ height: `${(p.income / vMax) * 45}%` }} title={`+${n0(p.income)}`}><small>+{n0(p.income)}</small></span>}
                    {p.expense > 0 && <span className="fcn-bar is-out" style={{ height: `${(p.expense / vMax) * 45}%` }} title={`−${n0(p.expense)}`}><small>−{n0(p.expense)}</small></span>}
                  </>}
                  <span className="fcn-col-l">{p.label}</span>
                </div>
              ))}
            </div>
          )}
          {/* телефон (макет ForecastMobile): місяці — списком зі смужками */}
          {months.rows.length > 0 && (() => { const mx = Math.max(1, ...months.rows.map(m => Math.abs(m.balance))); return (
            <ul className="fcn-mrows">
              <li><span className="fcn-mr-l">Зараз</span><b>{n0(months.startCash)}</b></li>
              {months.rows.map((m, i) => (
                <li key={m.ym}>
                  <span className="fcn-mr-l"><b>{MS[mIdx(m.ym)]} {m.ym.slice(0, 4)}</b>{i === 0 && <small> з простроченим</small>}</span>
                  <b className={m.balance < 0 || (m.net < 0 && m === low) ? 'is-neg' : ''}>{n0(m.balance)}</b>
                  <small className="fcn-mr-d">{formatAmount(m.income, { decimals: 0, sign: 'always' })} · −{n0(m.expense)} · потік {formatAmount(m.net, { decimals: 0, sign: 'always' })}</small>
                  <span className="fcn-mr-bar"><i className={m.net < 0 ? 'is-neg' : ''} style={{ width: `${Math.min(100, (Math.abs(m.balance) / mx) * 100)}%` }} /></span>
                </li>
              ))}
            </ul>) })()}
        </section>
      </div>

      <section className="rpt-card is-flush">
        <div className="cfn-report-head"><h2 className="rpt-h3">Замовлення в прогнозі · {orders.length}</h2></div>
        {orders.length === 0 ? <EmptyState icon="ti-trending-up" title="Немає замовлень у прогнозі" text="Позначте замовлення «в прогноз» у реєстрі «Замовлення» — суми й дати візьмуться з нього." />
          : <div className="tbl-wrap rpt-table fcn-table"><table>
            <thead><tr><th>Замовлення</th><th>Клієнт</th><th className="r">Прийде</th><th className="r">Піде</th><th className="r">Заробимо</th><th className="r">Маржа</th><th>Що заважає</th></tr></thead>
            <tbody>
              {[...orders].sort((x, y) => (y.lines.some(l => l.remaining > 0.5) ? 1 : 0) - (x.lines.some(l => l.remaining > 0.5) ? 1 : 0)).map(o => {
                const pend = o.lines.filter(l => l.remaining > 0.5)
                const overdue = pend.some(l => l.overdue), est = pend.some(l => l.estimated)
                const margin = o.plan?.revenueNet ? o.plan.net / o.plan.revenueNet : null
                const isOpen = !!open[o.id]
                return (
                  <Fragment key={o.id}>
                    <tr className="is-click" onClick={() => setOpen(s => ({ ...s, [o.id]: !s[o.id] }))} aria-expanded={isOpen}>
                      <td className="c-name"><Link to={`/orders/${o.id}`} onClick={e => e.stopPropagation()} className="fcn-num">№{o.number}</Link><small className="rpt-muted">{o.company}</small></td>
                      <td className="c-client">{o.client}</td>
                      <td className="r rpt-num fcn-in" data-l="Прийде">{o.income ? `+${n0(o.income)}` : '—'}</td>
                      <td className="r rpt-num fcn-out" data-l="Піде">{o.expense ? `−${n0(o.expense)}` : '—'}</td>
                      <td className={`r rpt-num c-net${o.net < 0 ? ' rpt-late' : ''}`} data-l={`Нетто${margin == null ? '' : ' · ' + (margin * 100).toFixed(1).replace('.', ',') + '%'}`}><b>{n0(o.net)}</b></td>
                      <td className="r rpt-num">{margin == null ? '—' : `${(margin * 100).toFixed(1).replace('.', ',')}%`}</td>
                      <td className="c-st">{!pend.length ? <span className="fcn-pill is-ok">виконано</span> : BLOCKER[o.status] ? <span className="fcn-pill is-warn">{BLOCKER[o.status]}</span> : overdue ? <span className="fcn-pill is-bad">є прострочене</span> : est ? <span className="fcn-pill">дати орієнтовні</span> : <span className="fcn-pill is-ok">за графіком</span>}</td>
                    </tr>
                    {isOpen && (
                      <tr className="rpt-sub fcn-sched"><td colSpan={7}>
                        {pend.length === 0 ? <p className="rpt-muted">Усе за замовленням уже виконано — у прогноз нічого не йде.</p> : (
                          <div className="fcn-lines">
                            {pend.map(l => (
                              <div key={l.key} className={`fcn-line${l.overdue ? ' is-late' : ''}`}>
                                <span>{l.date ? `${MNOM[Number(l.date.slice(5, 7)) - 1]} ${l.date.slice(0, 4)}` : 'без дати'} · {l.key?.startsWith('sup-') ? `платимо ${l.label}` : l.label}{l.partsCount > 1 && l.partNo ? ` · частина ${l.partNo}/${l.partsCount} (${Math.round(l.sharePct)}%)` : ''}{l.ownDays ? ' · відстрочка позиції' : ''}{l.manual ? ' · дата вручну' : ''}{l.flag === 'receivable' ? ' · дебіторка' : ''}</span>
                                <b className={l.kind === 'income' ? 'fcn-in' : 'fcn-out'}>{l.kind === 'income' ? '+' : '−'}{n0(l.remaining)} ₴</b>
                                <small>{dmy(l.date)}{l.estimated ? ' · орієнтовно' : ''}{l.overdue ? ' · прострочено' : ''}{l.fact > 0.5 ? ` · вже ${n0(l.fact)}` : ''}</small>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="rpt-muted rpt-note"><Link to={`/orders/${o.id}?tab=profit`}>Змінити в замовленні →</Link><InfoTip label="Звідки суми й дати">Суми — з позицій, дати — з «Графіка платежів» замовлення.</InfoTip></p>
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot><tr><td>Разом</td><td /><td className="r rpt-num fcn-in">+{n0(tot.inc)}</td><td className="r rpt-num fcn-out">−{n0(tot.exp)}</td><td className="r rpt-num">{n0(tot.net)}</td><td className="r rpt-num">{tot.rev ? `${((tot.pNet / tot.rev) * 100).toFixed(1).replace('.', ',')}%` : '—'}</td><td /></tr></tfoot>
          </table></div>}
      </section>

      <section className={`rpt-card fcn-manual${manual.length ? '' : ' is-empty'}`} aria-label="Без замовлення">
        <div className="fcn-manual-h">
          <div><h2 className="rpt-h3">Без замовлення: оренда, зарплата, податки</h2>
            <span className="rpt-muted rpt-note">{manual.length ? `${manual.length} ${plural(manual.length, ['рядок', 'рядки', 'рядків'])} · −${n0(manual.filter(m => m.kind !== 'income').reduce((s, m) => s + Number(m.amount || 0), 0))} ₴ / +${n0(manual.filter(m => m.kind === 'income').reduce((s, m) => s + Number(m.amount || 0), 0))} ₴` : 'Поки немає жодного рядка — прогноз не враховує постійних витрат компанії'}</span></div>
          <Button variant="secondary" icon="ti-plus" onClick={() => setAdding({ kind: 'expense', amount: '', date: todayKyiv(), note: '', companyId: co !== 'all' ? co : (companies?.[0]?.id || '') })}>Додати постійну витрату</Button>
        </div>
        {manual.length > 0 && (
          <ul className="fcn-mlist">
            {manual.map(l => (
              <li key={l.id}>
                <span className={l.kind === 'income' ? 'fcn-in' : 'fcn-out'}><i className={`ti ${l.kind === 'income' ? 'ti-arrow-down-left' : 'ti-arrow-up-right'}`} aria-hidden="true" /></span>
                <span className="fcn-m-n">{l.note || '—'}<small className="rpt-muted"> · {l.company}</small></span>
                <span className="rpt-muted">{dmy(l.expected_date)}</span>
                <b className={l.kind === 'income' ? 'fcn-in' : 'fcn-out'}>{l.kind === 'income' ? '+' : '−'}{n0(l.amount)}</b>
                <Menu trigger={<Button variant="ghost" size="sm" iconOnly icon="ti-dots" aria-label="Дії" />} items={[
                  { label: 'Видалити', icon: 'ti-trash', danger: true, confirm: { title: 'Видалити рядок прогнозу?', confirmLabel: 'Видалити' }, onClick: () => removeForecastItem(l.id).then(onChange) },
                ]} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {adding && <ManualForm init={adding} companies={coList.length ? coList : (companies || [])} userId={userId} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); onChange() }} />}
    </div>
  )
}

function ManualForm({ init, companies, userId, onClose, onSaved }) {
  const [f, setF] = useState(init)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = async () => {
    if (!(Number(f.amount) > 0)) return setErr('Вкажіть суму')
    if (!f.companyId) return setErr('Оберіть юрособу')
    setBusy(true); setErr(null)
    try { await addForecastItem({ companyId: f.companyId, kind: f.kind, amount: f.amount, expectedDate: f.date, note: f.note, userId }); onSaved() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open title="Постійна витрата або надходження" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button variant="primary" icon="ti-check" loading={busy} onClick={save}>Додати</Button></>}>
      <div className="form-grid">
        <div className="form-group"><label>Тип</label><select className="form-input" value={f.kind} onChange={e => set('kind', e.target.value)}><option value="expense">Витрата</option><option value="income">Надходження</option></select></div>
        <div className="form-group"><label>Юрособа</label><select className="form-input" value={f.companyId || ''} onChange={e => set('companyId', e.target.value)}><option value="">—</option>{companies.map(c => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}</select></div>
        <div className="form-group"><label>Сума, ₴</label><input className="form-input" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} autoFocus /></div>
        <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
        <div className="form-group full"><label>Що це</label><input className="form-input" value={f.note} onChange={e => set('note', e.target.value)} placeholder="Напр. Оренда офісу, листопад" /></div>
      </div>
      {err && <p className="rpt-late">{err}</p>}
    </Modal>
  )
}

// Звіт «Кредиторка» (ТЗ редизайну 5.4 / 6.3; макет ReportsPayables): кому і скільки винні ми.
// Розрахунок — lib/payables (те саме правило, що «Баланс»). Лише читання; «Оплатити» відкриває форму платежу в «Банку»
// з уже заповненими постачальником і сумою — платіж створюється там і одразу прив'язується до документа.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '../lib/company'
import { qc } from '../lib/companyScope'
import { getDocType } from '../lib/docgen'
import { todayKyiv } from '../lib/dates'
import { loadPayablesAsOf, groupPayables } from '../lib/payables'
import { useGroupContractors } from '../lib/group'
import { exportReportXlsx, exportReportPdf } from '../lib/reportExport'
import { BUCKETS } from '../lib/receivables'
import { loadPfd } from '../lib/pfd'
import { getAccountBalances } from '../lib/accounts'
import { formatAmount, plural } from '../utils/format'
import { KpiTile, StackBar, EmptyState, TableSkeleton, Button, Callout, InfoTip } from './ui'

const dmy = (iso) => iso ? iso.split('-').reverse().join('.') : '—'
const BUCKET_COLORS = { '0-7': 'var(--brand)', '8-14': 'var(--warn-mark)', '15-30': 'var(--expense-chart)', '30+': 'var(--danger-fg)' }

// ctl — спільна шапка «Звітів»: { year, month, scope, registerExport }
export default function PayablesReport({ showGroup = true, ctl = null } = {}) {
  const grp = useGroupContractors()
  const { companies } = useCompany()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(() => new Set())
  const [orders, setOrders] = useState({})
  const [side, setSide] = useState(null)   // { loans, cash } — для підсумкової картки (макет ReportsPayables)
  useEffect(() => {
    Promise.all([loadPfd().then(r => r.totals.owedByUs).catch(() => null), getAccountBalances().then(a => a.reduce((x, b) => x + (Number(b.balance) || 0), 0)).catch(() => null)])
      .then(([loans, cash]) => setSide({ loans, cash }))
  }, [companies])
  useEffect(() => {
    if (!companies?.length) return
    setData(null); setErr(null)
    const today = todayKyiv()
    const end = ctl?.year && ctl?.month ? `${ctl.year}-${String(ctl.month).padStart(2, '0')}-${String(new Date(ctl.year, ctl.month, 0).getDate()).padStart(2, '0')}` : today
    loadPayablesAsOf(companies, end < today ? end : today).then(r => setData(r)).catch(e => setErr(e.message))
  }, [companies, ctl?.year, ctl?.month])
  // ТЗ 6.4: без операцій усередині групи — прибираємо борги перед нашими компаніями
  const scoped = useMemo(() => (data?.docs || []).filter(d => (!ctl?.scope || ctl.scope === 'all' || d.companyId === ctl.scope) && (showGroup || !grp.has(d.contractorId))), [data, showGroup, grp.ready, ctl?.scope])
  const g = useMemo(() => data ? groupPayables(scoped) : null, [data, scoped])
  useEffect(() => {
    if (!ctl?.registerExport) return
    const cols = [{ key: 'name', label: 'Постачальник' }, { key: 'doc', label: 'Документ' }, { key: 'date', label: 'Дата' }, { key: 'sum', label: 'Борг, з ПДВ', num: true }, { key: 'due', label: 'Строк оплати' }, { key: 'over', label: 'Прострочка, дн.', num: true }]
    const rows = g ? g.contractors.flatMap(c => c.docs.map(d => ({ name: c.name, doc: `${getDocType(d.type)?.label || 'Документ'} № ${d.doc_number}`, date: dmy(d.doc_date), sum: d.outstanding, due: dmy(d.dueDate), over: d.overdueDays > 0 ? d.overdueDays : '' }))) : []
    const spec = { fileName: `Кредиторка ${data?.asOf || ''}`, title: 'Кредиторка — ми винні', subtitle: `станом на ${dmy(data?.asOf)}`, sheet: 'Кредиторка', columns: cols, rows, total: g ? { name: 'Разом', sum: g.summary.total } : null }
    ctl.registerExport(g ? { xlsx: () => exportReportXlsx(spec), pdf: () => exportReportPdf(spec) } : null)
  }, [g, ctl?.registerExport])
  // номери замовлень для документів
  useEffect(() => {
    const ids = [...new Set((data?.docs || []).map(d => d.order_id).filter(Boolean))]
    if (!ids.length) return
    qc('orders').select('id, order_number').in('id', ids).then(({ data: os }) => setOrders(Object.fromEntries((os || []).map(o => [o.id, o.order_number]))))
  }, [data])

  if (err) return <Callout tone="danger" title="Не вдалося порахувати кредиторку." text={err} />
  if (!g) return <TableSkeleton rows={6} cols={5} label="Рахую кредиторку…" />
  const s = g.summary
  const docs = scoped
  const overdue = docs.filter(d => d.overdueDays > 0).reduce((a, d) => a + d.outstanding, 0)
  const prepaid = (data.overpaid || []).reduce((a, x) => a + x.over, 0)
  const toggle = (id) => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pay = (d, name) => navigate(`/bank?pay=${d.docId}&amount=${d.outstanding}&contractor=${d.contractorId}&cname=${encodeURIComponent(name || '')}&label=${encodeURIComponent(`${getDocType(d.type)?.label || 'документ'} № ${d.doc_number}`)}`)

  return (
    <div className="rpt">
      <section className="rpt-paysum" aria-label="Підсумок кредиторки">
        <div className="rpt-ps-main"><span>Ми винні постачальникам · {dmy(data.asOf)}</span><b>{formatAmount(s.total, { decimals: 0 })} ₴</b>
          <small>у т. ч. ПДВ {formatAmount(s.vat, { decimals: 0 })} ₴ · {s.debtors} {plural(s.debtors, ['постачальник', 'постачальники', 'постачальників'])}</small></div>
        <div><span>Позики отримані (ПФД)<InfoTip label="Позики отримані">Поворотна фінансова допомога у кредиторку не входить — її показано окремо.</InfoTip></span><b className="is-out">{side?.loans == null ? '…' : `${formatAmount(side.loans, { decimals: 0 })} ₴`}</b>
          <button type="button" className="rpt-link" onClick={() => navigate('/loans')}>Поворотна фін. допомога →</button></div>
        <div><span>Гроші на рахунках зараз</span><b className="is-in">{side?.cash == null ? '…' : `${formatAmount(side.cash, { decimals: 0 })} ₴`}</b>
          <small>{side?.cash != null && s.total > 0 ? (side.cash >= s.total ? `покривають кредиторку в ${Math.floor(side.cash / s.total)} ${plural(Math.floor(side.cash / s.total), ['раз', 'рази', 'разів'])}` : `покривають ${Math.round(Math.max(0, side.cash) / s.total * 100)}% кредиторки`) : ' '}</small></div>
      </section>
      <div className="rpt-kpis is-3">
        <KpiTile label="Прострочено" tone={overdue > 0 ? 'danger' : 'neutral'} value={`${formatAmount(overdue, { decimals: 0 })} ₴`} hint="строк = дата документа + відстрочка постачальника" />
        <KpiTile label="Постачальників" value={s.debtors} hint={`${s.docCount} ${plural(s.docCount, ['документ', 'документи', 'документів'])}`} />
        <KpiTile label="Передоплати постачальникам" tone={prepaid > 0 ? 'brand' : 'neutral'} value={`${formatAmount(prepaid, { decimals: 0 })} ₴`} hint="оплачено понад документ — це актив" />
      </div>
      {s.total > 0 && <section className="rpt-card"><h3 className="rpt-h3">Вік боргу</h3>
        <StackBar ariaLabel="Вік кредиторки" segments={BUCKETS.map(b => ({ label: b.label, value: s.buckets[b.key] || 0, color: BUCKET_COLORS[b.key] }))} /></section>}

      <section className="rpt-card is-flush">
        {g.contractors.length === 0 ? <EmptyState icon="ti-receipt-2" title="Ми нікому не винні" text="Усі прихідні накладні й акти оплачено." />
          : <div className="tbl-wrap rpt-table"><table>
            <thead><tr><th aria-label="Розкрити" /><th>Постачальник</th><th className="r">Документів</th><th className="r">Борг, з ПДВ</th><th>Найближчий строк</th><th className="r">Прострочка</th></tr></thead>
            <tbody>
              {g.contractors.map(c => {
                const isOpen = open.has(c.contractorId)
                const due = c.docs.map(d => d.dueDate).filter(Boolean).sort()[0]
                const maxOver = Math.max(0, ...c.docs.map(d => d.overdueDays))
                return (
                  <Fragment key={c.contractorId}>
                    <tr className="is-click" onClick={() => toggle(c.contractorId)}>
                      <td className="rpt-x"><button type="button" aria-expanded={isOpen} aria-label={isOpen ? 'Згорнути' : 'Розкрити'} onClick={e => { e.stopPropagation(); toggle(c.contractorId) }}><i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" /></button></td>
                      <td className="c-name"><b>{c.name}</b>{grp.has(c.contractorId) && <span className="grp-chip">група</span>}{c.edrpou && <small className="rpt-muted"> · {c.edrpou}</small>}</td>
                      <td className="r c-docs">{c.docs.length}</td>
                      <td className="r rpt-num c-sum"><b>{formatAmount(c.total)}</b></td>
                      <td className="c-due">{dmy(due)}</td>
                      <td className="r c-over">{maxOver > 0 ? <span className="rpt-late">{maxOver} дн.</span> : <span className="rpt-muted">—</span>}</td>
                    </tr>
                    {isOpen && c.docs.map(d => (
                      <tr key={d.docId} className="rpt-sub">
                        <td />
                        <td>{getDocType(d.type)?.label || 'Документ'} № {d.doc_number} від {dmy(d.doc_date)}
                          {d.order_id && <button type="button" className="rpt-link" onClick={() => navigate(`/orders/${d.order_id}`)}> · замовлення №{orders[d.order_id] || '…'}</button>}
                          {d.paid > 0 && <small className="rpt-muted"> · сплачено {formatAmount(d.paid)}</small>}</td>
                        <td />
                        <td className="r rpt-num">{formatAmount(d.outstanding)}</td>
                        <td>{dmy(d.dueDate)}{d.overdueDays > 0 && <span className="rpt-late"> · {d.overdueDays} дн.</span>}</td>
                        <td className="r"><Button size="sm" variant="brand" onClick={() => pay(d, c.name)}>Оплатити</Button></td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot><tr><td /><td>Разом · {s.debtors} {plural(s.debtors, ['постачальник', 'постачальники', 'постачальників'])}</td><td className="r">{s.docCount}</td><td className="r rpt-num"><b>{formatAmount(s.total)}</b></td><td colSpan={2} /></tr></tfoot>
          </table></div>}
      </section>

      {(data.overpaid || []).length > 0 && (
        <section className="rpt-card">
          <h3 className="rpt-h3">Передоплати постачальникам <small>оплачено понад суму документа</small></h3>
          <ul className="rpt-list">{data.overpaid.map(x => <li key={x.docId}><span>{x.contractorName} · {getDocType(x.type)?.label || 'документ'} № {x.doc_number}</span><b className="rpt-num">{formatAmount(x.over)} ₴</b></li>)}</ul>
        </section>
      )}
    </div>
  )
}

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
import { BUCKETS } from '../lib/receivables'
import { formatAmount, plural } from '../utils/format'
import { KpiTile, StackBar, EmptyState, TableSkeleton, Button, Callout } from './ui'

const dmy = (iso) => iso ? iso.split('-').reverse().join('.') : '—'
const BUCKET_COLORS = { '0-7': 'var(--brand)', '8-14': 'var(--warn-mark)', '15-30': 'var(--expense-chart)', '30+': 'var(--danger-fg)' }

export default function PayablesReport({ showGroup = true } = {}) {
  const grp = useGroupContractors()
  const { companies } = useCompany()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(() => new Set())
  const [orders, setOrders] = useState({})
  useEffect(() => {
    if (!companies?.length) return
    setData(null); setErr(null)
    loadPayablesAsOf(companies, todayKyiv()).then(r => setData(r)).catch(e => setErr(e.message))
  }, [companies])
  // ТЗ 6.4: без операцій усередині групи — прибираємо борги перед нашими компаніями
  const g = useMemo(() => data ? groupPayables(showGroup ? data.docs : data.docs.filter(d => !grp.has(d.contractorId))) : null, [data, showGroup, grp.ready])
  // номери замовлень для документів
  useEffect(() => {
    const ids = [...new Set((data?.docs || []).map(d => d.order_id).filter(Boolean))]
    if (!ids.length) return
    qc('orders').select('id, order_number').in('id', ids).then(({ data: os }) => setOrders(Object.fromEntries((os || []).map(o => [o.id, o.order_number]))))
  }, [data])

  if (err) return <Callout tone="danger" title="Не вдалося порахувати кредиторку." text={err} />
  if (!g) return <TableSkeleton rows={6} cols={5} label="Рахую кредиторку…" />
  const s = g.summary
  const docs = showGroup ? data.docs : data.docs.filter(d => !grp.has(d.contractorId))
  const overdue = docs.filter(d => d.overdueDays > 0).reduce((a, d) => a + d.outstanding, 0)
  const prepaid = (data.overpaid || []).reduce((a, x) => a + x.over, 0)
  const toggle = (id) => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pay = (d, name) => navigate(`/bank?pay=${d.docId}&amount=${d.outstanding}&contractor=${d.contractorId}&cname=${encodeURIComponent(name || '')}&label=${encodeURIComponent(`${getDocType(d.type)?.label || 'документ'} № ${d.doc_number}`)}`)

  return (
    <div className="rpt">
      <div className="rpt-kpis">
        <KpiTile label="Ми винні" tone={s.total > 0 ? 'warn' : 'brand'} value={`${formatAmount(s.total, { decimals: 0 })} ₴`} hint={`у т. ч. ПДВ ${formatAmount(s.vat, { decimals: 0 })} ₴ · станом на ${dmy(data.asOf)}`} />
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
      <Callout tone="info" title="Позики отримані" text="(поворотна фінансова допомога) у кредиторку не входять — їх видно в окремому розділі." action={{ label: 'Поворотна фін. допомога', to: '/loans' }} />
    </div>
  )
}

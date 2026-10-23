// «Дебіторка» — новий інтерфейс (ТЗ редизайну 5.4; макети Reports / ReportsMobile). Дані й дії — ті самі, що в
// ReceivablesReport (loadReceivables → groupReceivables, PDF, «Звіт для клієнта», позиції документа); тут лише показ.
import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BUCKETS } from '../lib/receivables'
import { loadDocItems } from '../lib/docItems'
import { formatAmount, plural } from '../utils/format'
import { Segmented, StackBar, TableSkeleton, EmptyState, Button, Callout } from './ui'

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const BUCKET_COLORS = { '0-7': 'var(--brand)', '8-14': 'var(--warn-mark)', '15-30': 'var(--expense-chart)', '30+': 'var(--danger-fg)' }
const n0 = (v) => formatAmount(v, { decimals: 0 })
const n2 = (v) => formatAmount(v)
const dmy = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'

export default function ReceivablesNew({ raw, filtered, shown, loading, err, year, setYear, month, setMonth, years, scope, setScope, companies, q, setQ, reminders, onReport, onPdf }) {
  const s = filtered?.summary
  const oldest = filtered ? Math.max(0, ...filtered.contractors.map(c => c.oldest || 0)) : 0
  // скільки найбільших боржників дають ≥ 80% боргу
  let top = 0, acc = 0
  if (s?.total > 0) for (const c of filtered.contractors) { top++; acc += c.total; if (acc >= s.total * 0.8) break }
  const max = Math.max(1, ...(shown || []).map(c => c.total))

  return (
    <div className="rpt">
      <div className="rpt-bar">
        <select className="form-input rpt-sel" aria-label="Місяць" value={month} onChange={e => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        <select className="form-input rpt-sel is-year" aria-label="Рік" value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
        {(raw?.companies || companies || []).length > 1 && (
          <Segmented ariaLabel="Юрособа" value={scope} onChange={setScope}
            options={[{ value: 'all', label: 'Усі' }, ...(raw?.companies || companies).map(c => ({ value: c.id, label: c.short_name || c.name }))]} />
        )}
        <Button variant="primary" icon="ti-file-download" onClick={onPdf} disabled={!filtered}>PDF</Button>
      </div>

      {err && <Callout tone="danger" title="Не вдалося порахувати дебіторку." text={err} />}
      {!filtered ? (loading || !err) && <TableSkeleton rows={6} cols={5} label="Рахую дебіторку…" /> : <>
        <section className="rpt-card rcv-sum" aria-label="Підсумок">
          <div className="rcv-kpis">
            <div className="rcv-main"><span>Нам винні · станом на {dmy(raw?.asOf)}</span><b>{n0(s.total)} ₴</b><small>у т. ч. ПДВ {n0(s.vat)} ₴</small></div>
            <div><span>Прострочено 30+ днів</span><b className={s.over30 > 0 ? 'is-neg' : ''}>{n0(s.over30)} ₴</b><small>{Math.round(s.over30Pct * 100)}% боргу</small></div>
            <div><span>Боржників</span><b>{s.debtors}</b><small>{s.debtors > 1 && top < s.debtors ? `${top} з них — ${Math.round((acc / s.total) * 100)}% боргу` : `${s.docCount} ${plural(s.docCount, ['документ', 'документи', 'документів'])}`}</small></div>
            <div><span>Найстаріший борг</span><b className={oldest > 30 ? 'is-neg' : ''}>{oldest} дн.</b><small>від дати документа</small></div>
          </div>
          {s.total > 0 && <StackBar ariaLabel="Вік дебіторки" segments={BUCKETS.map(b => ({ label: b.label, value: s.buckets[b.key] || 0, color: BUCKET_COLORS[b.key] }))} />}
        </section>

        <div className="rpt-bar">
          <label className="rpt-search"><i className="ti ti-search" aria-hidden="true" />
            <input className="form-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Контрагент: назва або ЄДРПОУ" aria-label="Пошук контрагента" /></label>
          {q && <span className="rpt-muted">Знайдено: {shown.length}</span>}
        </div>

        <section className="rpt-card is-flush">
          {shown.length === 0 ? <EmptyState icon="ti-receipt-2" title={q ? 'Нікого не знайдено' : 'Нам ніхто не винен'} text={q ? 'Змініть пошук.' : 'Усі видаткові й акти оплачено.'} />
            : <div className="tbl-wrap rpt-table rcv-table"><table>
              <thead><tr><th aria-label="Розкрити" /><th>Боржник</th>{scope === 'all' && <th className="c-via">Через кого</th>}<th className="r">Борг</th><th className="c-share">Частка</th><th className="r">З них 30+</th><th className="r">Найстаріший</th><th aria-label="Дії" /></tr></thead>
              <tbody>{shown.map(c => <Row key={c.contractorId} c={c} max={max} showCompany={scope === 'all'} last={reminders?.[c.contractorId]} onReport={onReport} />)}</tbody>
              <tfoot><tr><td /><td>Разом</td>{scope === 'all' && <td className="c-via" />}<td className="r rpt-num">{n0(s.total)}</td><td className="c-share" /><td className="r rpt-num rpt-late">{n0(s.over30)}</td><td colSpan={2} /></tr></tfoot>
            </table></div>}
        </section>
        <p className="rpt-muted rpt-note">Вік — від дати документа; прострочка — від строку оплати (дата документа + відстрочка з картки контрагента). Борг = сума документа − оплати. Клік по документу — товарні позиції.</p>
      </>}
    </div>
  )
}

function Row({ c, max, showCompany, last, onReport }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [openDoc, setOpenDoc] = useState({})
  const [items, setItems] = useState({})
  const toggleDoc = async (x) => {
    const on = !openDoc[x.docId]
    setOpenDoc(s => ({ ...s, [x.docId]: on }))
    if (on && !items[x.docId]) {
      const r = await loadDocItems([x]).catch(() => ({}))
      setItems(s => ({ ...s, [x.docId]: r[x.docId] || { rows: [], noItems: true } }))
    }
  }
  const via = [...new Set(c.docs.map(x => x.companyName).filter(Boolean))].join(', ')
  const age = c.oldest > 30 ? 'is-bad' : c.oldest > 14 ? 'is-warn' : ''
  const cols = showCompany ? 8 : 7
  return (
    <>
      <tr className="is-click" onClick={() => setOpen(o => !o)}>
        <td className="rpt-x"><button type="button" aria-expanded={open} aria-label={open ? 'Згорнути' : 'Розкрити'} onClick={e => { e.stopPropagation(); setOpen(o => !o) }}><i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" /></button></td>
        <td className="c-name"><b>{c.name}</b><small className="rpt-muted">{c.docs.length} док.{last ? ` · нагадування ${dmy(last.created_at)}` : ''}</small></td>
        {showCompany && <td className="c-via rpt-muted">{via}</td>}
        <td className="r rpt-num c-sum"><b>{n0(c.total)}</b></td>
        <td className="c-share"><span className="rcv-share"><i style={{ width: `${(c.total / max) * 100}%` }} /></span></td>
        <td className="r rpt-num c-over">{c.over30 > 0 ? <span className="rpt-late">{n0(c.over30)}</span> : <span className="rpt-muted">—</span>}</td>
        <td className="r c-age"><span className={`rcv-age ${age}`}>{c.oldest} дн.</span></td>
        <td className="r c-act"><Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); onReport(c) }}>Звіт для клієнта</Button></td>
      </tr>
      {open && c.docs.map(x => (
        <Fragment key={x.docId}>
          <tr className="rpt-sub is-click" onClick={() => toggleDoc(x)}>
            <td />
            <td colSpan={showCompany ? 2 : 1}>
              <i className={`ti ${openDoc[x.docId] ? 'ti-chevron-down' : 'ti-chevron-right'} rpt-muted`} aria-hidden="true" /> <b>№ {x.doc_number}</b> від {dmy(x.doc_date)}
              {showCompany && x.companyName && <small className="rpt-muted"> · {x.companyName}</small>}
              {x.order_id && <button type="button" className="rpt-link" onClick={e => { e.stopPropagation(); navigate(`/orders/${x.order_id}`) }}> · замовлення</button>}
              {!x.is_verified && <span className="rcv-flag">не звірено</span>}
              {!x.is_signed && <span className="rcv-flag">не підписано</span>}
              <small className="rpt-muted"> · сума {n0(x.amount)}{x.paid > 0 ? `, сплачено ${n0(x.paid)}` : ''}</small>
            </td>
            <td className="r rpt-num">{n0(x.outstanding)}</td>
            <td className="rpt-muted" title={`відстрочка ${x.delayDays} дн.`}>строк {dmy(x.dueDate)}</td>
            <td className="r">{x.overdueDays > 0 ? <span className="rpt-late">прострочено {x.overdueDays} дн.</span> : <span className="rpt-muted">—</span>}</td>
            <td className="r rpt-num">{x.ageDays} дн.</td>
            <td />
          </tr>
          {openDoc[x.docId] && (
            <tr className="rpt-sub"><td /><td colSpan={cols - 1}>
              {!items[x.docId] ? <span className="rpt-muted">Завантаження позицій…</span> : <>
                {items[x.docId].noItems && <div className="rcv-warn"><i className="ti ti-alert-triangle" aria-hidden="true" /> немає позицій — у звіті для клієнта буде «Згідно документа»</div>}
                {items[x.docId].mismatch && <div className="rcv-warn is-bad"><i className="ti ti-scale" aria-hidden="true" /> сума рядків відрізняється від суми документа на {n0(items[x.docId].diff)} ₴</div>}
                {!items[x.docId].noItems && (
                  <table className="rcv-items"><thead><tr><th>№</th><th>Найменування</th><th>Артикул</th><th className="r">К-сть</th><th className="r">Ціна з ПДВ</th><th className="r">Сума з ПДВ</th></tr></thead>
                    <tbody>{items[x.docId].rows.map(r => <tr key={r.n}><td>{r.n}</td><td>{r.name}</td><td className="rpt-muted">{r.sku || ''}</td><td className="r rpt-num">{r.qty} {r.unit}</td><td className="r rpt-num">{n2(r.price)}</td><td className="r rpt-num">{n2(r.sum)}</td></tr>)}</tbody></table>
                )}
                {x.payments?.length > 0 && <div className="rcv-pays">Оплати: {x.payments.map(p => `${dmy(p.date)} — ${n2(p.amount)}`).join('; ')}</div>}
              </>}
            </td></tr>
          )}
        </Fragment>
      ))}
    </>
  )
}

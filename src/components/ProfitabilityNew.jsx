// «Прибутковість реалізації» — новий інтерфейс (ТЗ редизайну 5.4; макет ReportsProfit). Дані — computeProfitability,
// агентські зберігаються тим самим saveAgent, що й раніше; тут лише показ.
import { Fragment, useEffect, useState } from 'react'
import { saveAgent, saveOrderAgentPct, setAgentPaid, computeTotals, agentCalc } from '../lib/profitability'
import { useGroupContractors } from '../lib/group'
import { exportReportXlsx, exportReportPdf } from '../lib/reportExport'
import { listDecisions } from '../lib/decisions'
import { formatAmount, plural } from '../utils/format'
import { TableSkeleton, EmptyState, Callout, useToast, PeriodMenu, InfoTip } from './ui'
import '../pages/AnalyticsNew.css'

const kindLabel = (i) => i.kind === 'act' ? 'Акт наданих послуг' : 'Видаткова накладна'
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const n0 = (v) => formatAmount(v, { decimals: 0 })
const pct = (f) => f == null ? '—' : `${f < 0 ? '−' : ''}${Math.abs(f * 100).toFixed(1).replace('.', ',')}%`
const d2 = (s) => s ? String(s).slice(8, 10) + '.' + String(s).slice(5, 7) : ''
const payLabel = (cp) => !cp ? '' : cp.state === 'paid' ? `оплачено${cp.last ? ' ' + d2(cp.last) : ''}` : cp.state === 'partial' ? `частково · борг ${n0(cp.rest)}` : 'не оплачено'

export default function ProfitabilityNew({ data, loading, err, from, to, setFrom, setTo, companies, companyId, setCompanyId, userId, onChanged, showGroup = true, ctl = null }) {
  const grp = useGroupContractors()
  // ТЗ 6.4: без продажів нашим компаніям — підсумки перераховуються тим самим computeTotals
  const all = data ? (showGroup ? data.invoices : data.invoices.filter(i => !grp.has(i.contractorId))) : []
  const t = data ? (showGroup ? data.totals : computeTotals(all)) : null
  const invoices = [...all].sort((a, b) => b.profit - a.profit)
  // компанія-продавець (наша юрособа, від якої видаткова)
  const seller = (id) => { const c = (companies || []).find(x => x.id === id); return c ? (c.short_name || c.name) : '' }
  const manySellers = new Set(invoices.map(i => i.companyId)).size > 1
  useEffect(() => {
    if (!ctl?.registerExport) return
    const spec = { fileName: `Прибутковість ${from} — ${to}`, title: 'Прибутковість реалізації', subtitle: `${from.split('-').reverse().join('.')} — ${to.split('-').reverse().join('.')} · суми без ПДВ`, sheet: 'Прибутковість',
      columns: [{ key: 'kind', label: 'Тип' }, { key: 'doc', label: 'Документ' }, { key: 'date', label: 'Дата', date: true }, { key: 'order', label: 'Замовлення' }, { key: 'seller', label: 'Продавець' }, { key: 'client', label: 'Клієнт' }, { key: 'cpay', label: 'Оплата клієнта' }, { key: 'sell', label: 'Реалізація', num: true }, { key: 'buy', label: 'Собівартість (FIFO)', num: true }, { key: 'profit', label: 'Прибуток', num: true }, { key: 'margin', label: 'Маржа, %', num: true }, { key: 'vat', label: 'ПДВ до сплати', num: true }, { key: 'tax', label: 'Податок 18%', num: true }, { key: 'agent', label: 'Агентські', num: true }, { key: 'apaid', label: 'Агентські сплачено' }, { key: 'net', label: 'Чистий', num: true }],
      rows: invoices.map(i => ({ kind: kindLabel(i), doc: i.doc_number, date: i.doc_date || '', order: i.orderNumber || '', seller: seller(i.companyId), client: i.client, cpay: payLabel(i.clientPay), apaid: i.commission > 0 ? (i.agentPaid ? 'так' : 'ні') : '', sell: i.sellSum, buy: i.buySum, profit: i.profit, margin: i.margin == null ? '' : Math.round(i.margin * 1000) / 10, vat: i.vatToPay, tax: i.tax, agent: i.commission, net: i.net })),
      total: t ? { doc: 'Разом', sell: t.sellSum, buy: r2(t.sellSum - t.profit), profit: t.profit, vat: t.vatToPay, tax: t.tax, agent: t.commission, net: t.net } : null }
    // аркуш «Товари»: кожен товар накладної — закупка (FIFO) і продаж
    const items = { sheet: 'Товари',
      columns: [{ key: 'kind', label: 'Тип' }, { key: 'doc', label: 'Документ' }, { key: 'date', label: 'Дата', date: true }, { key: 'order', label: 'Замовлення' }, { key: 'seller', label: 'Продавець' }, { key: 'client', label: 'Клієнт' }, { key: 'name', label: 'Товар / послуга' }, { key: 'qty', label: 'К-сть', num: true }, { key: 'unit', label: 'Од.' },
        { key: 'buyUnit', label: 'Собівартість, ціна', num: true }, { key: 'buySum', label: 'Собівартість, сума', num: true }, { key: 'sellUnit', label: 'Продаж, ціна', num: true }, { key: 'sellSum', label: 'Продаж, сума', num: true }, { key: 'vat', label: 'ПДВ до сплати', num: true }, { key: 'profit', label: 'Прибуток', num: true }, { key: 'margin', label: 'Маржа, %', num: true }],
      rows: invoices.flatMap(i => (i.items || []).map(x => ({ kind: kindLabel(i), doc: i.doc_number, date: i.doc_date || '', order: i.orderNumber || '', seller: seller(i.companyId), client: i.client, name: x.name, qty: x.qty, unit: x.unit,
        buyUnit: x.buyUnit, buySum: x.buySum, sellUnit: x.sellUnit, sellSum: x.sellSum, vat: x.vatToPay, profit: x.profit, margin: x.margin == null ? '' : Math.round(x.margin * 1000) / 10 }))),
      total: t ? { doc: 'Разом', buySum: r2(t.sellSum - t.profit), sellSum: t.sellSum, vat: t.vatToPay, profit: t.profit } : null }
    ctl.registerExport(data ? { xlsx: () => exportReportXlsx({ ...spec, sheets: [items] }), pdf: () => exportReportPdf(spec) } : null)
  }, [data, showGroup, ctl?.registerExport, companies])
  const noAgents = t && t.count > 0 && invoices.every(i => !(Number(i.percent) > 0))
  // Помилка 12: агентські, ухвалені в протоколах за цей період (рішення 098; для не-адміна RLS віддає порожньо)
  const [protoAgent, setProtoAgent] = useState(null)
  useEffect(() => {
    listDecisions().then(ds => {
      const a = ds.filter(d => d.category === 'agent_fee' && d.status !== 'cancelled' && (!d.due_date || (d.due_date >= from && d.due_date <= to)))
      setProtoAgent(a.length ? { sum: a.reduce((s, d) => s + Number(d.amount || 0), 0), n: a.length } : null)
    }).catch(() => setProtoAgent(null))
  }, [from, to])
  return (
    <div className="rpt">
      {!ctl && <div className="rpt-bar">
        <span className="rpt-right"><PeriodMenu year={Number(from.slice(0, 4))} month={from.slice(5) === '01-01' && to.slice(5) === '12-31' ? 0 : Number(from.slice(5, 7))}
          onChange={p => { const y = p.year, m = p.month; setFrom(m ? `${y}-${String(m).padStart(2, '0')}-01` : `${y}-01-01`); setTo(m ? `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` : `${y}-12-31`) }} /></span>
        {(companies || []).length > 1 && (
          <select className="form-input rpt-sel" aria-label="Юрособа" value={companyId || ''} onChange={e => setCompanyId(e.target.value)}>
            {companies.map(c => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}
          </select>
        )}
      </div>}
      {err && <Callout tone="danger" title="Не вдалося порахувати прибутковість." text={`${err}${/agent_commissions/.test(err) ? ' — потрібна міграція 064.' : ''}`} />}
      {!data ? (loading || !err) && <TableSkeleton rows={8} cols={7} label="Рахую прибутковість…" /> : <>
        <section className="prf-hero" aria-label="Від реалізації до чистого прибутку">
          <div className="prf-eq">
            <div><span>Реалізація без ПДВ</span><b>{n0(t.sellSum)} ₴</b></div>
            <i aria-hidden="true">−</i>
            <div><span>Собівартість (FIFO)</span><b className="is-out">{n0(t.sellSum - t.profit)} ₴</b></div>
            <i aria-hidden="true">−</i>
            <div><span>Податок на прибуток 18%</span><b className="is-out">{n0(t.tax)} ₴</b></div>
            <i aria-hidden="true">−</i>
            <div><span>Агентські</span><b className="is-out">{n0(t.commission)} ₴</b></div>
            <i aria-hidden="true">=</i>
            <div className="is-net"><span>Чистий прибуток · маржа {pct(t.margin)}</span><b className={t.net < 0 ? 'is-neg' : ''}>{n0(t.net)} ₴</b></div>
          </div>
          <div className="prf-meta">
            <span>ПДВ до сплати: <b>{n0(t.vatToPay)} ₴</b></span>
            <span>Документів: <b>{t.count}</b></span>
            <span>Збиткових: <b className={t.lossCount ? 'is-neg' : ''}>{t.lossCount}{t.lossCount ? ` · ${n0(t.lossSum)} ₴` : ''}</b></span>
            <span>Клієнти не розрахувались: <b className={t.unpaidCount ? 'is-neg' : ''}>{t.unpaidCount}{t.unpaidCount ? ` · ${n0(t.unpaidSum)} ₴ з ПДВ` : ''}</b></span>
            <span>Агентські до сплати: <b>{n0(t.agentDue)} ₴</b></span>
          </div>
        </section>
        {noAgents && <Callout tone="warn" title="Агентські в жодній накладній не вказані" text={protoAgent
          ? `— а в протоколах нарад на цей період ухвалено агентських на ${n0(protoAgent.sum)} ₴ (${protoAgent.n} ${plural(protoAgent.n, ['рішення', 'рішення', 'рішень'])}). Реальний прибуток менший: впишіть «Агент, %» у відповідних накладних.`
          : '— тож у чистому прибутку агентські не враховані. Якщо за цими накладними домовлені агентські (наприклад, рішенням наради), впишіть «Агент, %» у рядку: реальний прибуток буде меншим.'} />}
        <section className="rpt-card is-flush">
          {invoices.length === 0 ? <EmptyState icon="ti-receipt" title="Немає видаткових і актів за період" text="Змініть період або юрособу." />
            : <>
              <div className="cfn-report-head"><h2 className="rpt-h3">Видаткові накладні та акти · від найприбутковішого<InfoTip label="Як рахується прибутковість"><b>Прибуток</b> = реалізація − закупка (FIFO).<br /><b>Акт наданих послуг</b>: реалізація — сума акту без ПДВ; собівартість — вхідні акти підрядників того ж замовлення (якщо актів замовлення кілька — пропорційно сумі).<br /><b>Маржа</b> = прибуток ÷ реалізація.<br /><b>Податок на прибуток</b> = прибуток × 18% (юрособа-платник ПДВ; ФОП — 0).<br /><b>Агентські</b> = (прибуток − податок 18%) × % — від чистого прибутку (при збитку не нараховуються).<br /><b>Чистий</b> = прибуток − податок − агентські.<br /><b>ПДВ до сплати</b> = ПДВ з реалізації − вхідний ПДВ (кредит лише по закупках у платника ПДВ).</InfoTip></h2><span className="rpt-muted rpt-note">усі суми без ПДВ</span></div>
              <div className="tbl-wrap rpt-table prf-table"><table>
                <thead><tr><th>Документ</th><th>Клієнт</th><th className="r">Реалізація</th><th className="r">Прибуток</th><th className="c-scale">Маржа</th><th className="r">ПДВ до сплати</th><th className="r">Агент, % · сплата</th><th className="r">Чистий</th></tr></thead>
                <tbody>{invoices.map(inv => <Row key={`${inv.id}:${inv.percent}`} inv={inv} seller={manySellers ? seller(inv.companyId) : ''} group={grp.has(inv.contractorId)} userId={userId} onChanged={onChanged} />)}</tbody>
                <tfoot><tr><td>Разом · {t.count} док.</td><td /><td className="r rpt-num">{n0(t.sellSum)}</td><td className="r rpt-num">{n0(t.profit)}</td><td className="c-scale r">{pct(t.margin)}</td><td className="r rpt-num">{n0(t.vatToPay)}</td><td className="r rpt-num">{t.commission ? `−${n0(t.commission)}` : ''}</td><td className="r rpt-num prf-net">{n0(t.net)}</td></tr></tfoot>
              </table></div>
            </>}
        </section>
      </>}
    </div>
  )
}

function Row({ inv, group, seller, userId, onChanged }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [pctVal, setPctVal] = useState(inv.percent ? String(inv.percent) : '')
  const [agent, setAgent] = useState(inv.agentName || '')
  const [saved, setSaved] = useState({ p: Number(inv.percent) || 0, a: inv.agentName || '' })
  const loss = inv.profit <= 0
  const live = Number(pctVal) || 0
  const calc = agentCalc(inv.profit, live, inv.taxOn !== false)
  const commission = loss ? 0 : Math.round(calc.commission)
  const net = calc.net
  const persist = async () => {
    const p = Number(pctVal) || 0
    if (p === saved.p && agent === saved.a) return
    try {
      // накладна із замовленням → % пишемо в замовлення: зміниться всюди (картка, прогноз, звіт інвестору, інші накладні)
      if (inv.orderId && p !== saved.p) await saveOrderAgentPct(inv.orderId, p)
      await saveAgent(inv.id, { agentName: agent, percent: p, userId }); setSaved({ p, a: agent }); onChanged()
      if (inv.orderId && p !== saved.p) toast(`% агентських оновлено в замовленні ${inv.orderNumber || ''}`.trim())
    }
    catch (e) { toast(`Не збережено: ${e.message}`, { type: 'error' }) }
  }
  const [agentPaid, setAgentPaidState] = useState(!!inv.agentPaid)
  const togglePaid = async () => {
    const v = !agentPaid
    setAgentPaidState(v)
    try { await setAgentPaid({ ...inv, agentName: agent, percent: live }, v); onChanged() }
    catch (e) { setAgentPaidState(!v); toast(`Не збережено: ${e.message}`, { type: 'error' }) }
  }
  const m = inv.margin
  const tone = m == null ? '' : m < 0 ? 'is-bad' : m < 0.1 ? 'is-low' : ''
  const cp = inv.clientPay
  return (
    <>
      <tr className="is-click" onClick={() => setOpen(o => !o)}>
        <td className="c-name">{inv.kind === 'act' && <span className="prf-kind" title={inv.costSource ? `Собівартість: ${inv.costSource}` : 'Собівартість не знайдена: немає вхідних актів підрядників у замовленні'}>Акт</span>}<b className="prf-doc">{inv.doc_number}</b><small className="rpt-muted">{d2(inv.doc_date)}
          {inv.orderId && <> · <a className="prf-ord" href={`#/orders/${inv.orderId}`} onClick={e => e.stopPropagation()} title="Відкрити замовлення">зам. {inv.orderNumber || '—'}</a></>}</small></td>
        <td className="c-client">{inv.client}{group && <span className="grp-chip">група</span>}
          {seller && <small className="prf-seller" title="Компанія-продавець">від {seller}</small>}
          {cp && <span className={`prf-pay is-${cp.state}`} title={cp.state === 'none' ? 'Оплат, прив\'язаних до накладної, немає' : `Оплачено ${n0(cp.paid)} з ${n0(cp.amount)} ₴${cp.last ? ` · остання ${d2(cp.last)}` : ''}`}>{payLabel(cp)}</span>}</td>
        <td className="r rpt-num c-real">{n0(inv.sellSum)}</td>
        <td className={`r rpt-num c-profit${inv.profit < 0 ? ' rpt-late' : ''}`}><b>{n0(inv.profit)}</b></td>
        <td className="c-scale"><span className="mgn-scale"><span className={`mgn-track prf-track ${tone}`}><i style={{ width: `${m == null ? 0 : Math.max(2, Math.min(1, Math.abs(m) / 0.35) * 100)}%` }} /></span><b className={tone ? 'is-warn' : ''}>{pct(m)}</b></span></td>
        <td className="r rpt-num rpt-muted c-vat" title={inv.vatFree ? 'Операція без ПДВ (у документі ПДВ 0)' : undefined}>{inv.vatFree ? 'без ПДВ' : n0(inv.vatToPay)}</td>
        <td className="r c-agent" onClick={e => e.stopPropagation()}>
          {loss ? <span className="rpt-muted">збиток</span>
            : <label className="prf-pct" title={inv.orderId ? `% замовлення ${inv.orderNumber || ''} — зміна оновить його всюди` : 'Накладна без замовлення — % лише для цього звіту'}><input value={pctVal} inputMode="decimal" aria-label={`Агент, % — накладна ${inv.doc_number}`} placeholder="—"
                onChange={e => setPctVal(e.target.value.replace(/[^\d.]/g, ''))} onBlur={persist} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />%</label>}
          {!loss && commission > 0 && (
            <button type="button" className={`prf-paid${agentPaid ? ' is-on' : ''}`} onClick={togglePaid} aria-pressed={agentPaid}
              title={inv.orderId ? `Відмітка замовлення ${inv.orderNumber || ''} (як у списку замовлень)` : 'Агентські по цій накладній'}>
              <i className={`ti ${agentPaid ? 'ti-square-check-filled' : 'ti-square'}`} aria-hidden="true" />{agentPaid ? 'сплачено' : 'не сплачено'}
            </button>)}
        </td>
        <td className={`r rpt-num prf-net c-net${net < 0 ? ' is-neg' : ''}`}>{n0(net)}</td>
      </tr>
      {open && (
        <tr className="rpt-sub"><td colSpan={8}>
          <table className="rcv-items prf-items">
            <thead><tr><th>Найменування</th><th className="r">К-сть</th><th className="r">Закупка, ціна</th><th className="r">Закупка, сума</th><th className="r">Продаж, ціна</th><th className="r">Продаж, сума</th><th className="r">ПДВ до сплати</th><th className="r">Прибуток</th><th className="r">Маржа</th></tr></thead>
            <tbody>{inv.items.map((x, i) => (
              <tr key={i}><td>{x.name}</td><td className="r rpt-num">{formatAmount(x.qty, { decimals: 0 })} {x.unit}</td><td className="r rpt-num">{n0(x.buyUnit)}</td><td className="r rpt-num">{n0(x.buySum)}</td>
                <td className="r rpt-num">{n0(x.sellUnit)}</td><td className="r rpt-num">{n0(x.sellSum)}</td><td className="r rpt-num">{n0(x.vatToPay)}</td>
                <td className={`r rpt-num${x.profit < 0 ? ' rpt-late' : ''}`}>{n0(x.profit)}</td><td className="r rpt-num">{pct(x.margin)}</td></tr>
            ))}</tbody>
          </table>
          {!loss && (
            <div className="prf-agent" onClick={e => e.stopPropagation()}>
              <b>Агентські</b>
              <label>Агент <input className="form-input" value={agent} onChange={e => setAgent(e.target.value)} onBlur={persist} placeholder="Ім'я агента" /></label>
              <span className="rpt-num">({n0(inv.profit)}{calc.tax ? ` − податок 18% ${n0(calc.tax)}` : ''}) × {live}% = <b className="rpt-late">{commission ? `−${n0(commission)}` : '0'}</b></span>
              <span className="prf-agent-net">Чистий прибуток <b>{n0(net)} ₴</b></span>
            </div>
          )}
        </td></tr>
      )}
    </>
  )
}

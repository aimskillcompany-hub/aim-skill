// Замовлення ↔ Excel: вивантажити → виправити → завантажити → план «було → стало» → застосувати (lib/ordersExcel)
import { useState } from 'react'
import { useUser } from '../lib/auth'
import { loadOrdersData, exportOrdersXlsx, readOrdersFile, buildPlan, applyPlan, loadAllContractors } from '../lib/ordersExcel'
import { Button, Modal, Callout } from './ui'
import './OrdersExcelModal.css'

export default function OrdersExcelModal({ onClose, onDone }) {
  const { user } = useUser()
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [info, setInfo] = useState(null)
  const [plan, setPlan] = useState(null)
  const [data, setData] = useState(null)
  const [res, setRes] = useState(null)

  const doExport = async () => {
    setBusy('Вивантажую…'); setErr(null)
    try { const r = await exportOrdersXlsx(await loadOrdersData()); setInfo(`Вивантажено: замовлень ${r.orders}, позицій ${r.items}.`) }
    catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const doLoad = async (file) => {
    if (!file) return
    setBusy('Читаю файл…'); setErr(null); setPlan(null); setRes(null)
    try {
      const [f, d, all] = await Promise.all([readOrdersFile(file), loadOrdersData(), loadAllContractors()])
      setData(d); setPlan(buildPlan(f, d, all))   // план — на поточному стані бази
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const doApply = async () => {
    setBusy('Застосовую…'); setErr(null)
    const out = []
    try { await applyPlan(plan, data, user?.id, r => { out.push(r); setRes([...out]) }) } catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const mark = (kind, id) => { const r = res?.find(x => x.kind === kind && x.id === id); return !r ? null : r.ok ? <span className="oxl-ok">✓</span> : <span className="oxl-bad">✗ {r.error}</span> }
  const done = res && res.length === (plan?.orderChanges.length || 0) + (plan?.itemChanges.length || 0)
  const failed = res?.filter(x => !x.ok).length || 0

  return (
    <Modal open onClose={done ? onDone : onClose} size="xl" title="Замовлення ↔ Excel"
      footer={plan && plan.count > 0 && !done
        ? <><Button variant="secondary" onClick={() => setPlan(null)} disabled={!!busy}>Інший файл</Button><Button variant="brand" loading={!!busy} onClick={doApply}>Застосувати ({plan.count})</Button></>
        : done ? <Button variant="brand" onClick={onDone}>Готово</Button> : null}>
      <div className="oxl">
        <ol className="oxl-steps">
          <li>Вивантажте файл: аркуші «Замовлення», «Позиції» і «Як заповнювати».</li>
          <li>В Excel змініть потрібні поля або додайте позиції (рядок без ID з номером замовлення). Видаляти позиції — лише в замовленні.</li>
          <li>Завантажте файл — побачите, що зміниться. Нічого не записується, доки не натиснете «Застосувати».</li>
        </ol>
        <div className="oxl-acts">
          <Button variant="secondary" icon="ti-file-download" onClick={doExport} disabled={!!busy}>Вивантажити в Excel</Button>
          <label className={`btn btn-secondary${busy ? ' is-disabled' : ''}`}><i className="ti ti-file-upload" aria-hidden="true" />Завантажити зміни
            <input type="file" accept=".xlsx,.xls" hidden disabled={!!busy} onChange={e => { doLoad(e.target.files?.[0]); e.target.value = '' }} /></label>
        </div>
        {busy && <p className="oxl-muted">{busy}</p>}
        {info && <p className="oxl-ok">{info}</p>}
        {err && <Callout tone="danger" title="Не вдалося." text={err} />}
        {done && <Callout tone={failed ? 'warn' : 'brand'} title={failed ? `Застосовано з помилками: ${failed}` : 'Усі зміни застосовано.'} text="ID позицій змінених замовлень оновились — для наступних правок вивантажте файл заново." />}

        {plan && <div className="oxl-plan">
          {plan.count === 0 && !plan.errors.length && <p className="oxl-muted">Змін не знайдено — файл збігається з базою.</p>}
          {plan.errors.length > 0 && <div className="oxl-errs"><b>Пропущено ({plan.errors.length}):</b>
            <ul>{plan.errors.slice(0, 100).map((e, i) => <li key={i}>{e}</li>)}</ul>{plan.errors.length > 100 && <p>… ще {plan.errors.length - 100}</p>}</div>}
          {plan.orderChanges.length > 0 && <><h3>Замовлення · {plan.orderChanges.length}</h3>
            <table className="oxl-tbl"><thead><tr><th>№</th><th>Поле</th><th>Було</th><th>Стане</th><th /></tr></thead>
              <tbody>{plan.orderChanges.flatMap(x => x.changes.map((c, i) => (
                <tr key={x.order.id + c.f}>{i === 0 && <td rowSpan={x.changes.length}><b>{x.order.order_number}</b></td>}<td>{c.label}</td><td className="oxl-was">{String(c.from)}</td><td><b>{String(c.to)}</b></td>
                  {i === 0 && <td rowSpan={x.changes.length}>{mark('order', x.order.id)}</td>}</tr>)))}</tbody></table></>}
          {plan.itemChanges.length > 0 && <><h3>Позиції · {plan.itemChanges.length} {plan.itemChanges.length === 1 ? 'замовлення' : 'замовлень'}</h3>
            <table className="oxl-tbl"><thead><tr><th>№</th><th>Позиція</th><th>Поле</th><th>Було</th><th>Стане</th><th /></tr></thead>
              <tbody>{plan.itemChanges.map(x => {
                const rows = [
                  ...Object.entries(x.edits).flatMap(([iid, chs]) => { const it = data.items.find(i => i.id === iid); return chs.map(c => ({ k: iid + c.f, name: it?.name, c })) }),
                  ...x.adds.map((a, i) => ({ k: 'new' + i, name: a.name, c: { label: 'нова позиція', from: '', to: `${a.qty} ${a.unit || 'шт'} × ${a.unit_price}` } })),
                ]
                return rows.map((r, i) => (
                  <tr key={x.order.id + r.k}>{i === 0 && <td rowSpan={rows.length}><b>{x.order.order_number}</b></td>}<td className="oxl-name">{r.name}</td><td>{r.c.label}</td><td className="oxl-was">{String(r.c.from)}</td><td><b>{String(r.c.to)}</b></td>
                    {i === 0 && <td rowSpan={rows.length}>{mark('items', x.order.id)}</td>}</tr>))
              })}</tbody></table></>}
        </div>}
      </div>
    </Modal>
  )
}

// Контрагенти ↔ Excel: вивантажити → виправити → завантажити → план «було → стало» → застосувати (lib/contractorsExcel)
import { useState } from 'react'
import { useUser } from '../lib/auth'
import { loadContractorsData, exportContractorsXlsx, readContractorsFile, buildPlan, applyPlan } from '../lib/contractorsExcel'
import { Button, Modal, Callout } from './ui'
import './OrdersExcelModal.css'

export default function ContractorsExcelModal({ onClose, onDone }) {
  const { user } = useUser()
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [info, setInfo] = useState(null)
  const [plan, setPlan] = useState(null)
  const [res, setRes] = useState(null)

  const doExport = async () => {
    setBusy('Вивантажую…'); setErr(null)
    try { const r = await exportContractorsXlsx(await loadContractorsData()); setInfo(`Вивантажено контрагентів: ${r.count}.`) }
    catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const doLoad = async (file) => {
    if (!file) return
    setBusy('Читаю файл…'); setErr(null); setPlan(null); setRes(null)
    try { const [rows, data] = await Promise.all([readContractorsFile(file), loadContractorsData()]); setPlan(buildPlan(rows, data)) }
    catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const doApply = async () => {
    setBusy('Застосовую…'); setErr(null)
    const out = []
    try { await applyPlan(plan, user?.id, r => { out.push(r); setRes([...out]) }) } catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const mark = (kind, id) => { const r = res?.find(x => x.kind === kind && x.id === id); return !r ? null : r.ok ? <span className="oxl-ok">✓</span> : <span className="oxl-bad">✗ {r.error}</span> }
  const done = res && res.length === (plan?.updates.length || 0) + (plan?.creates.length || 0)
  const failed = res?.filter(x => !x.ok).length || 0

  return (
    <Modal open onClose={done ? onDone : onClose} size="xl" title="Контрагенти ↔ Excel"
      footer={plan && plan.count > 0 && !done
        ? <><Button variant="secondary" onClick={() => setPlan(null)} disabled={!!busy}>Інший файл</Button><Button variant="brand" loading={!!busy} onClick={doApply}>Застосувати ({plan.count})</Button></>
        : done ? <Button variant="brand" onClick={onDone}>Готово</Button> : null}>
      <div className="oxl">
        <ol className="oxl-steps">
          <li>Вивантажте файл: аркуші «Контрагенти» і «Як заповнювати».</li>
          <li>Змініть потрібні колонки або додайте нових контрагентів (рядок без ID). Видаляти й об’єднувати — лише в картці.</li>
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
        {done && <Callout tone={failed ? 'warn' : 'brand'} title={failed ? `Застосовано з помилками: ${failed}` : 'Усі зміни застосовано.'} />}

        {plan && <div className="oxl-plan">
          {plan.count === 0 && !plan.errors.length && <p className="oxl-muted">Змін не знайдено — файл збігається з базою.</p>}
          {plan.errors.length > 0 && <div className="oxl-errs"><b>Пропущено ({plan.errors.length}):</b>
            <ul>{plan.errors.slice(0, 100).map((e, i) => <li key={i}>{e}</li>)}</ul>{plan.errors.length > 100 && <p>… ще {plan.errors.length - 100}</p>}</div>}
          {plan.updates.length > 0 && <><h3>Зміни · {plan.updates.length}</h3>
            <table className="oxl-tbl"><thead><tr><th>Контрагент</th><th>Поле</th><th>Було</th><th>Стане</th><th /></tr></thead>
              <tbody>{plan.updates.flatMap(u => u.changes.map((c, i) => (
                <tr key={u.row.id + c.f}>{i === 0 && <td rowSpan={u.changes.length} className="oxl-name"><b>{u.row.name}</b>{u.row.edrpou ? <div className="oxl-muted">{u.row.edrpou}</div> : null}</td>}
                  <td>{c.label}</td><td className="oxl-was">{String(c.from)}</td><td><b>{String(c.to)}</b></td>
                  {i === 0 && <td rowSpan={u.changes.length}>{mark('update', u.row.id)}</td>}</tr>)))}</tbody></table></>}
          {plan.creates.length > 0 && <><h3>Нові · {plan.creates.length}</h3>
            <table className="oxl-tbl"><thead><tr><th>Назва</th><th>ЄДРПОУ</th><th>Тип</th><th /></tr></thead>
              <tbody>{plan.creates.map((c, i) => (
                <tr key={i}><td className="oxl-name"><b>{c.row.name}</b></td><td>{c.row.edrpou || '—'}</td>
                  <td>{[c.row.is_client && 'клієнт', c.row.is_supplier && 'постачальник'].filter(Boolean).join(', ') || '—'}</td><td>{mark('create', i)}</td></tr>))}</tbody></table></>}
        </div>}
      </div>
    </Modal>
  )
}

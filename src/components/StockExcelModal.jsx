import { useState } from 'react'
import { fmt } from '../lib/fmt'
import { loadStockData, exportStockXlsx, readCorrectionFile, buildPlan, applyPlan, TYPE_LABEL, STATUS_LABEL } from '../lib/stockExcel'

// Склад → Excel: вивантажити, виправити в Excel, завантажити ВИПРАВЛЕННЯ → план → застосувати (087 split_product)
export default function StockExcelModal({ onClose, onDone }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [info, setInfo] = useState(null)
  const [plan, setPlan] = useState(null)
  const [results, setResults] = useState(null)

  const doExport = async () => {
    setBusy('Вивантаження…'); setErr(null)
    try { const r = await exportStockXlsx(await loadStockData()); setInfo(`Вивантажено: рухів ${r.movs}, карток ${r.cards}; карток з різними назвами (⚠) — ${r.mixed}.`) }
    catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const doLoad = async (file) => {
    if (!file) return
    setBusy('Читання файлу…'); setErr(null); setPlan(null); setResults(null)
    try {
      const f = await readCorrectionFile(file)
      const data = await loadStockData()   // актуальний стан бази, а не той, що на момент вивантаження
      setPlan(buildPlan(f, data))
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const doApply = async () => {
    setBusy('Застосування…'); setErr(null)
    const out = []
    await applyPlan(plan, r => { out.push(r); setResults([...out]) })
    setBusy(null)
  }

  const tgt = (op) => op.target.id ? <>на <b>{op.target.name}</b></> : <>на <b>нову</b> «{op.target.newName}»{op.target.newSku ? ` · ${op.target.newSku}` : ''}</>
  const empty = plan && plan.ops.length === 0 && plan.cardChanges.length === 0
  const cell = { padding: '5px 6px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
  const resFor = (kind, x) => results?.find(r => r.kind === kind && (r.op === x || r.c === x))

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Склад ↔ Excel: виправлення карток</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <ol style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Вивантажте файл. Аркуш «Рухи» — кожен рух складу з назвою в документі; ⚠ — картки, де назви різні.</li>
          <li>В Excel заповніть лише «Перенести на картку» (рухи, синоніми) і за потреби «Тип» / «Статус» (картки).</li>
          <li>Завантажте файл назад — побачите план. Нічого не змінюється, доки не натиснете «Застосувати».</li>
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button className="btn" onClick={doExport} disabled={!!busy}><i className="ti ti-file-download" /> Вивантажити в Excel</button>
          <label className="btn" style={{ cursor: busy ? 'default' : 'pointer' }}><i className="ti ti-file-upload" /> Завантажити виправлення
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={!!busy} onChange={e => { doLoad(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        {busy && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{busy}</div>}
        {info && <div style={{ fontSize: 13, color: 'var(--green)', marginBottom: 8 }}>{info}</div>}

        {plan && <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
          {plan.errors.length > 0 && <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 12 }}>
            <b style={{ color: 'var(--red)' }}>Пропущено ({plan.errors.length}):</b>
            {plan.errors.slice(0, 50).map((e, i) => <div key={i}>{e}</div>)}
            {plan.errors.length > 50 && <div>… ще {plan.errors.length - 50}</div>}
          </div>}
          {empty && <div style={{ fontSize: 13, color: 'var(--text3)' }}>У файлі немає змін: колонка «Перенести на картку» порожня, тип і статус карток ті самі.</div>}
          {plan.ops.length > 0 && <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', margin: '6px 0' }}>ПЕРЕНЕСЕННЯ ({plan.ops.length})</div>
            <table style={{ width: '100%' }}><tbody>{plan.ops.map((op, i) => {
              const r = resFor('split', op)
              return <tr key={i}>
                <td style={cell}>з <b>{op.srcName}</b><br />{tgt(op)}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>рухів {op.movs.length}{op.movs.length ? ` (↓${fmt(op.inQty)} ↑${fmt(op.outQty)})` : ''}{op.aliases.length ? <><br />синонімів {op.aliases.length}</> : null}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap', color: op.leftStock < 0 ? 'var(--red)' : 'var(--text2)' }}>лишиться {fmt(op.leftStock)}{op.leftStock < 0 ? ' ⚠' : ''}</td>
                <td style={{ ...cell, width: 200 }}>{r ? (r.ok ? <span style={{ color: 'var(--green)' }}>✓ {r.data?.created ? 'створено картку' : 'перенесено'}</span> : <span style={{ color: 'var(--red)' }}>✗ {r.error}</span>) : ''}</td>
              </tr>
            })}</tbody></table>
          </>}
          {plan.cardChanges.length > 0 && <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', margin: '10px 0 6px' }}>ТИП / СТАТУС КАРТОК ({plan.cardChanges.length})</div>
            <table style={{ width: '100%' }}><tbody>{plan.cardChanges.map((c, i) => {
              const r = resFor('card', c)
              return <tr key={i}>
                <td style={cell}><b>{c.name}</b></td>
                <td style={cell}>{c.ch.product_type && <div>тип: {TYPE_LABEL[c.from.product_type] || c.from.product_type} → <b>{TYPE_LABEL[c.ch.product_type]}</b></div>}
                  {c.ch.status && <div>статус: {STATUS_LABEL[c.from.status] || c.from.status} → <b>{STATUS_LABEL[c.ch.status]}</b></div>}</td>
                <td style={{ ...cell, width: 200 }}>{r ? (r.ok ? <span style={{ color: 'var(--green)' }}>✓</span> : <span style={{ color: 'var(--red)' }}>✗ {r.error}</span>) : ''}</td>
              </tr>
            })}</tbody></table>
          </>}
        </div>}
        {results && !busy && <div style={{ fontSize: 13, marginTop: 10 }}>
          Готово: успішно {results.filter(r => r.ok).length}, з помилкою {results.filter(r => !r.ok).length}. Кожне перенесення можна скасувати в картці товару → «Розділити картку».
          Далі — «Діагностика собівартості», потім «Застосувати FIFO» (з резервною копією).
        </div>}
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={() => results ? onDone() : onClose()}>Закрити</button>
          {plan && !empty && !results && <button className="btn btn-primary" onClick={doApply} disabled={!!busy}>Застосувати ({plan.ops.length + plan.cardChanges.length})</button>}
        </div>
      </div>
    </div>
  )
}

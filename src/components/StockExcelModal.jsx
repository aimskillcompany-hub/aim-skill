import { useEffect, useState } from 'react'
import { fmt } from '../lib/fmt'
import { loadStockData, exportStockXlsx, readCorrectionFile, buildPlan, applyPlan, TYPE_LABEL, STATUS_LABEL } from '../lib/stockExcel'
import FixJournal from './FixJournal'

const dmy = (iso) => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—'
const cell = { padding: '5px 6px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const H3 = ({ children }) => <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', margin: '12px 0 6px' }}>{children}</div>
const Warn = ({ list }) => list?.length ? <div style={{ color: 'var(--orange, #b45309)', marginTop: 2 }}>{list.map((w, i) => <div key={i}>{w}</div>)}</div> : null

// Склад → Excel: вивантажити, виправити в Excel, завантажити ВИПРАВЛЕННЯ → план → застосувати; журнал зі скасуванням
export default function StockExcelModal({ onClose, onDone }) {
  const [tab, setTab] = useState('excel')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [info, setInfo] = useState(null)
  const [plan, setPlan] = useState(null)
  const [results, setResults] = useState(null)
  const [jrev, setJrev] = useState(0)

  const doExport = async () => {
    setBusy('Вивантаження…'); setErr(null)
    try {
      const r = await exportStockXlsx(await loadStockData())
      setInfo(`Вивантажено: рухів ${r.movs}, карток ${r.cards}, документів ${r.docs}, збірок ${r.asm}; карток з різними назвами (⚠) — ${r.mixed}.`)
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const doLoad = async (file) => {
    if (!file) return
    setBusy('Читання файлу…'); setErr(null); setPlan(null); setResults(null)
    try { setPlan(buildPlan(await readCorrectionFile(file), await loadStockData())) }   // план — на поточному стані бази
    catch (e) { setErr(e.message) }
    setBusy(null)
  }
  const doApply = async () => {
    setBusy('Застосування…'); setErr(null)
    const out = []
    try { await applyPlan(plan, r => { out.push(r); setResults([...out]) }) } catch (e) { setErr(e.message) }
    setBusy(null); setJrev(v => v + 1)
  }
  const res = (kind, item, what) => {
    const r = results?.filter(x => x.kind === kind && x.item === item && (!what || x.what === what))
    if (!r?.length) return null
    const bad = r.find(x => !x.ok)
    return bad ? <span style={{ color: 'var(--red)' }}>✗ {bad.error}</span> : <span style={{ color: 'var(--green)' }}>✓</span>
  }
  const tgt = (t) => t.id ? <>на <b>{t.name}</b></> : <>на <b>нову</b> «{t.newName}»{t.newSku ? ` · ${t.newSku}` : ''}</>
  const empty = plan && plan.count === 0

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 920 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Склад ↔ Excel: виправлення</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[['excel', 'Excel'], ['journal', 'Журнал (скасування)']].map(([k, l]) => (
            <button key={k} className="btn" onClick={() => setTab(k)} style={{ background: tab === k ? 'var(--blue)' : 'var(--surface)', color: tab === k ? '#fff' : 'var(--text2)', border: '1px solid var(--border)', fontSize: 12 }}>{l}</button>
          ))}
        </div>

        {tab === 'journal' ? <FixJournal key={jrev} /> : <>
          <ol style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Вивантажте файл: аркуші «Рухи», «Картки», «Документи», «Збірки», «Синоніми» і «Як заповнювати» з прикладами.</li>
            <li>В Excel заповніть лише редаговані колонки (перенесення, артикул, назва, дата, номер, порядок у дні, склад збірки, «видалити» для синоніму).</li>
            <li>Завантажте файл — побачите план. Нічого не змінюється, доки не натиснете «Застосувати». Кожну зміну потім можна скасувати у «Журналі».</li>
          </ol>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn" onClick={doExport} disabled={!!busy}><i className="ti ti-file-download" /> Вивантажити в Excel</button>
            <label className="btn" style={{ cursor: busy ? 'default' : 'pointer' }}><i className="ti ti-file-upload" /> Завантажити виправлення
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={!!busy} onChange={e => { doLoad(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          </div>
          {busy && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{busy}</div>}
          {info && <div style={{ fontSize: 13, color: 'var(--green)', marginBottom: 8 }}>{info}</div>}

          {plan && <div style={{ maxHeight: '52vh', overflow: 'auto', fontSize: 12 }}>
            {plan.errors.length > 0 && <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, marginBottom: 6 }}>
              <b style={{ color: 'var(--red)' }}>Пропущено ({plan.errors.length}):</b>
              {plan.errors.slice(0, 80).map((e, i) => <div key={i}>{e}</div>)}
              {plan.errors.length > 80 && <div>… ще {plan.errors.length - 80}</div>}
            </div>}
            {empty && <div style={{ fontSize: 13, color: 'var(--text3)' }}>У файлі немає змін.</div>}

            {plan.cards.length > 0 && <><H3>КАРТКИ ({plan.cards.length})</H3>
              <table style={{ width: '100%' }}><tbody>{plan.cards.map((c, i) => <tr key={i}>
                <td style={cell}><b>{c.name}</b><Warn list={c.warnings} /></td>
                <td style={cell}>
                  {c.sku && <div>артикул: {c.sku.from || '—'} → <b>{c.sku.to || '(порожньо)'}</b> {res('card', c, 'sku')}</div>}
                  {c.rename && <div>назва → <b>«{c.rename.to}»</b> (стара — синонім) {res('card', c, 'name')}</div>}
                  {c.ch.product_type && <div>тип: {TYPE_LABEL[c.from.product_type] || c.from.product_type} → <b>{TYPE_LABEL[c.ch.product_type]}</b></div>}
                  {c.ch.status && <div>статус: {STATUS_LABEL[c.from.status] || c.from.status} → <b>{STATUS_LABEL[c.ch.status]}</b></div>}
                  {(c.ch.product_type || c.ch.status) && res('card', c, 'type')}
                </td></tr>)}</tbody></table></>}

            {plan.docs.length > 0 && <><H3>ДОКУМЕНТИ ({plan.docs.length})</H3>
              <table style={{ width: '100%' }}><tbody>{plan.docs.map((d, i) => <tr key={i}>
                <td style={cell}><b>№{d.number || 'б/н'}</b> {dmy(d.date)}<div style={{ color: 'var(--text3)' }}>{d.contractor}</div></td>
                <td style={cell}>
                  {d.newDate && <div>дата {dmy(d.date)} → <b>{dmy(d.newDate)}</b> (документ і всі його рухи)</div>}
                  {d.align && <div>рухи вирівнюються до дати документа {dmy(d.date)}</div>}
                  {d.newNumber && <div>номер → <b>{d.newNumber}</b></div>}
                  {d.order != null && <div>порядок у дні: {d.oldOrder ?? 'авто'} → <b>{d.order}</b></div>}
                  {d.clearOrder && <div>порядок у дні: прибрати</div>}
                  <Warn list={d.warnings} />
                </td>
                <td style={{ ...cell, width: 180 }}>{res('doc', d)}</td></tr>)}</tbody></table></>}

            {plan.moves.length > 0 && <><H3>РУХИ ({plan.moves.length})</H3>
              <table style={{ width: '100%' }}><tbody>{plan.moves.map((op, i) => <tr key={i}>
                <td style={cell}>з <b>{op.srcName}</b><br />{tgt(op.target)}</td>
                <td style={cell}>{op.kind === 'part'
                  ? <>{op.type === 'in' ? 'прихід' : 'видаток'} {op.doc}: було {fmt(op.was)} → лишиться <b>{fmt(op.was - op.qty)}</b> / переїде <b>{fmt(op.qty)}</b></>
                  : <>рухів {op.movs.length} (↓{fmt(op.inQty)} ↑{fmt(op.outQty)})</>}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  <span style={{ color: op.leftStock < 0 ? 'var(--red)' : 'var(--text2)' }}>тут: {fmt(op.leftStock)}{op.leftStock < 0 ? ' ⚠' : ''}</span><br />
                  <span style={{ color: op.tgtAfter < 0 ? 'var(--red)' : 'var(--text2)' }}>там: {fmt(op.tgtAfter)}{op.tgtAfter < 0 ? ' ⚠' : ''}</span>
                </td>
                <td style={{ ...cell, width: 180 }}>{res('move', op)}</td></tr>)}</tbody></table></>}

            {plan.assemblies.length > 0 && <><H3>ЗБІРКИ ({plan.assemblies.length})</H3>
              <table style={{ width: '100%' }}><tbody>{plan.assemblies.map((a, i) => {
                const r = results?.find(x => x.kind === 'asm' && x.item === a)
                return <tr key={i}>
                  <td style={cell}><b>{a.name}</b><div style={{ color: 'var(--text3)' }}>{dmy(a.date)} · {fmt(a.qty)} шт</div></td>
                  <td style={cell}>
                    {a.newDate && <div>дата → <b>{dmy(a.newDate)}</b> (виріб і компоненти)</div>}
                    {a.newQty != null && <div>к-сть виробу {fmt(a.qty)} → <b>{fmt(a.newQty)}</b></div>}
                    {a.itemsView && <div>склад: {a.itemsView.map((x, j) => <span key={j} style={{ marginRight: 8 }}>{x.name} {x.was == null ? <b>+{fmt(x.qty)}</b> : x.qty === 0 ? <b>прибрати</b> : x.was !== x.qty ? <>{fmt(x.was)}→<b>{fmt(x.qty)}</b></> : fmt(x.qty)}</span>)}</div>}
                    {a.manualMode === 'set' && <div>ручна собівартість: <b>{fmt(a.manual)}</b>/од</div>}
                    {a.manualMode === 'auto' && <div>ручну собівартість знято — сума компонентів</div>}
                    <div>собівартість / од: було {fmt(a.oldUnit)} → стане <b>≈{fmt(a.estUnit)}</b>{r?.ok && r.data ? <> (фактично <b>{fmt(r.data.unit_cost)}</b>)</> : null}</div>
                    <Warn list={a.warnings} />
                  </td>
                  <td style={{ ...cell, width: 180 }}>{res('asm', a)}</td></tr>
              })}</tbody></table></>}

            {(plan.aliases.dedupe.length + plan.aliases.deletes.length + plan.aliases.moves.length) > 0 && <><H3>СИНОНІМИ</H3>
              <table style={{ width: '100%' }}><tbody>
                {plan.aliases.dedupe.length > 0 && <tr><td style={cell} colSpan={2}>прибрати дублі (однакові після нормалізації): <b>{plan.aliases.dedupe.reduce((s, x) => s + x.ids.length, 0)}</b> у {plan.aliases.dedupe.length} синонімах</td>
                  <td style={{ ...cell, width: 180 }}>{results?.filter(x => x.what === 'dedupe').map((x, j) => <span key={j}>{x.ok ? <span style={{ color: 'var(--green)' }}>✓</span> : <span style={{ color: 'var(--red)' }}>✗ {x.error}</span>}</span>)}</td></tr>}
                {plan.aliases.deletes.map((x, i) => <tr key={'d' + i}><td style={cell}><b>{x.card}</b></td><td style={cell}>видалити «{x.alias}»</td><td style={{ ...cell, width: 180 }}>{res('alias', x, 'delete')}</td></tr>)}
                {plan.aliases.moves.map((op, i) => <tr key={'m' + i}><td style={cell}>з <b>{op.srcName}</b></td><td style={cell}>{op.aliases.map(a => `«${a}»`).join(', ')} {tgt(op.target)}</td><td style={{ ...cell, width: 180 }}>{res('alias', op, 'move')}</td></tr>)}
              </tbody></table></>}
          </div>}
          {results && !busy && <div style={{ fontSize: 13, marginTop: 10 }}>
            Готово: успішно {results.filter(r => r.ok).length}, з помилкою {results.filter(r => !r.ok).length}. Скасувати — вкладка «Журнал».
            Далі — «Діагностика собівартості», потім «Застосувати FIFO» (з резервною копією).
          </div>}
        </>}
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={() => results ? onDone() : onClose()}>Закрити</button>
          {tab === 'excel' && plan && !empty && !results && <button className="btn btn-primary" onClick={doApply} disabled={!!busy}>Застосувати ({plan.count})</button>}
        </div>
      </div>
    </div>
  )
}

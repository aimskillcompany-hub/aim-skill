import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import { getDocType } from '../lib/docgen'
import { loadDocFull } from '../lib/shipmentRecon'
import DocModal from '../components/DocModal'
import GeneratedDocModal from '../components/GeneratedDocModal'

// «Документи → Звірка з PDF» — етап 1 об'єднання документів в одну таблицю: де картка документа (реєстр) і
// згенерований документ (PDF) розходяться. Звіт лише читає; рішення — по одному полю, кнопкою (адмін / бухгалтер).
const FIELD = { doc_date: 'Дата', doc_number: 'Номер', amount: 'Сума з ПДВ', vat_amount: 'у т.ч. ПДВ', contractor: 'Контрагент', type: 'Тип', order: 'Замовлення' }
// що змінить рішення — для вікна підтвердження
const EFFECT = {
  doc_date: 'дата змінюється і в PDF, і в рухах складу; від неї залежать FIFO, P&L, дебіторка',
  doc_number: 'номер змінюється і в PDF, і в картці',
  amount: 'сума картки — це борг клієнта / постачальнику; сума PDF — те, що надруковано',
  vat_amount: 'ПДВ картки впливає на звіти і P&L без ПДВ',
  contractor: 'контрагент картки визначає, чий це борг',
  type: 'тип визначає, чи документ — борг / реалізація',
  order: 'замовлення визначає маржу замовлення і звірку',
}
const dmy = (s) => /^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10).split('-').reverse().join('.') : s
const show = (field, v) => v == null || v === '' ? <span style={{ color: 'var(--text3)' }}>порожньо</span>
  : field === 'doc_date' ? dmy(v) : ['amount', 'vat_amount'].includes(field) ? fmt(Number(v)) : field === 'type' ? (getDocType(v)?.label || v) : field === 'order' ? `№${v}` : v

export default function DocGenRecon() {
  const { user } = useUser()
  const canEdit = ['admin', 'accountant'].includes(user?.role)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [toast, setToast] = useState(null)
  const [docModal, setDocModal] = useState(null)
  const [genModal, setGenModal] = useState(null)

  const load = async () => {
    setErr(null)
    const { data: j, error } = await supabase.rpc('doc_gen_mismatches_json')
    if (error) { setErr(/doc_gen_mismatches/.test(error.message || '') ? 'Спершу застосуйте міграцію 082 (звірка документів).' : error.message); return }
    setData(j)
  }
  useEffect(() => { load() }, [])

  // розбіжності, згруповані за документом
  const groups = useMemo(() => {
    const m = new Map()
    ;(data?.diffs || []).forEach(d => { if (!m.has(d.document_id)) m.set(d.document_id, { ...d, fields: [] }); m.get(d.document_id).fields.push(d) })
    return [...m.values()]
  }, [data])

  const resolve = async (g, f, take) => {
    const chosen = take === 'doc' ? f.doc_value : f.gen_value
    const q = `${g.number} · ${FIELD[f.field]}: правильне значення — ${take === 'doc' ? 'як у картці' : 'як у PDF'} (${chosen == null || chosen === '' ? 'порожньо' : f.field === 'doc_date' ? dmy(chosen) : chosen}).\n\nЙого буде записано і ${take === 'doc' ? 'в PDF (згенерований документ)' : 'в картку документа'}. ${EFFECT[f.field]}.`
    if (!window.confirm(q)) return
    setBusy(g.document_id + f.field)
    const { error } = await supabase.rpc('doc_gen_resolve', { p_doc: g.document_id, p_field: f.field, p_take: take })
    setBusy(null)
    if (error) { setToast('Помилка: ' + (/NO_RIGHTS/.test(error.message) ? 'лише адміністратор або бухгалтер' : /PERIOD_CLOSED/.test(error.message) ? 'документ у закритому місяці' : error.message)); return }
    setToast(`${g.number}: ${FIELD[f.field].toLowerCase()} узгоджено`)
    load()
  }
  const open = async (docId, asGen) => { const d = await loadDocFull(docId); if (!d) return; asGen ? setGenModal(d) : setDocModal(d) }

  const cell = { padding: '6px 8px', borderTop: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' }
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link to="/documents" className="btn btn-sm"><i className="ti ti-arrow-left" /> Документи</Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ marginBottom: 2 }}>Звірка: картка ↔ PDF</h1>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Етап 1 об'єднання документів в одну таблицю: де картка документа і згенерований документ (PDF) розходяться</div>
        </div>
        <button className="btn btn-sm" onClick={load}><i className="ti ti-refresh" /> Оновити</button>
      </div>
      {err && <div className="card" style={{ color: 'var(--red)' }}>{err}</div>}
      {toast && <div className="card" style={{ background: 'var(--green-bg)', color: 'var(--green)', display: 'flex', gap: 10, marginBottom: 12 }}><span style={{ flex: 1 }}>{toast}</span><button className="btn btn-sm" onClick={() => setToast(null)}>✕</button></div>}
      {!data && !err && <p style={{ color: 'var(--text3)' }}>Звіряю…</p>}
      {data && <>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {[['Згенерованих документів', data.pairs], ['З розбіжностями', groups.length, groups.length ? 'var(--red)' : 'var(--green)'], ['Без запису в реєстрі', data.orphans.length, data.orphans.length ? 'var(--amber)' : undefined],
            ['Биті посилання', data.broken.length, data.broken.length ? 'var(--amber)' : undefined], ['Дублі в реєстрі', data.duplicates.length, data.duplicates.length ? 'var(--red)' : undefined]].map(([l, v, c]) => (
            <div key={l} className="card" style={{ padding: '8px 14px', margin: 0 }}><b style={{ display: 'block', fontSize: 18, color: c }}>{v}</b><span style={{ fontSize: 12, color: 'var(--text3)' }}>{l}</span></div>
          ))}
        </div>
        {!canEdit && <p style={{ fontSize: 13, color: 'var(--text3)' }}>Перегляд: вирішувати розбіжності можуть адміністратор або бухгалтер.</p>}

        <h3 style={{ margin: '14px 0 6px' }}>Розбіжності полів</h3>
        {!groups.length ? <p style={{ color: 'var(--green)' }}>Розбіжностей немає — картки і PDF збігаються.</p> : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                <th style={{ textAlign: 'left', padding: '8px' }}>Документ</th><th style={{ textAlign: 'left' }}>Поле</th><th style={{ textAlign: 'left' }}>У картці (реєстр)</th><th style={{ textAlign: 'left' }}>У PDF (згенерований)</th><th style={{ textAlign: 'left' }}>Правильне значення</th>
              </tr></thead>
              <tbody>{groups.map(g => g.fields.map((f, i) => (
                <tr key={g.document_id + f.field}>
                  {i === 0 && <td rowSpan={g.fields.length} style={{ ...cell, background: 'var(--surface2)', minWidth: 180 }}>
                    <b>{g.number || '—'}</b> <span style={{ color: 'var(--text3)' }}>{getDocType(g.type)?.label || g.type}</span>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{g.contractor}</div>
                    <div style={{ marginTop: 4, display: 'flex', gap: 8, fontSize: 12 }}>
                      <button className="btn-link" style={{ background: 'none', border: 0, padding: 0, color: 'var(--blue)', cursor: 'pointer' }} onClick={() => open(g.document_id, false)}>картка</button>
                      <button className="btn-link" style={{ background: 'none', border: 0, padding: 0, color: 'var(--blue)', cursor: 'pointer' }} onClick={() => open(g.document_id, true)}>PDF</button>
                    </div>
                    {g.closed && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 3 }}>закритий місяць</div>}
                  </td>}
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{FIELD[f.field] || f.field}</td>
                  <td style={cell}>{show(f.field, f.doc_value)}</td>
                  <td style={cell}>{show(f.field, f.gen_value)}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    {canEdit && !g.closed ? <>
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => resolve(g, f, 'doc')} title="Правильно в картці — записати в PDF">✓ як у картці</button>{' '}
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => resolve(g, f, 'gen')} title="Правильно в PDF — записати в картку">✓ як у PDF</button>
                    </> : <span style={{ color: 'var(--text3)', fontSize: 12 }}>{g.closed ? 'місяць закрито' : '—'}</span>}
                  </td>
                </tr>
              )))}</tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text3)' }}>Дату можна також виправити в самій картці або в редакторі документа — тепер вона синхронізується в обидва боки (081). Кожне рішення пишеться в журнал.</p>

        {data.orphans.length > 0 && <>
          <h3 style={{ margin: '16px 0 6px' }}>Згенеровані без запису в реєстрі</h3>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 6px' }}>Є PDF, але немає картки — такі документи не потрапляють у борги, склад і звіти. На етапі 2 для них буде створено записи в реєстрі (або позначте, які з них — чернетки, що не мають враховуватись).</p>
          <div className="card" style={{ padding: 0 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{data.orphans.map(o => (
            <tr key={o.generated_id}><td style={cell}><b>{o.number || '—'}</b> {getDocType(o.type)?.label || o.type}</td><td style={cell}>{dmy(o.date)}</td><td style={cell}>{o.contractor}</td><td style={{ ...cell, textAlign: 'right' }}>{o.amount != null ? fmt(o.amount) : '—'}</td></tr>
          ))}</tbody></table></div>
        </>}
        {data.broken.length > 0 && <>
          <h3 style={{ margin: '16px 0 6px' }}>Картка посилається на неіснуючий PDF</h3>
          <div className="card" style={{ padding: 0 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{data.broken.map(o => (
            <tr key={o.document_id}><td style={cell}><b>{o.number || '—'}</b> {getDocType(o.type)?.label || o.type}</td><td style={cell}>{dmy(o.date)}</td><td style={{ ...cell, textAlign: 'right' }}>{o.amount != null ? fmt(o.amount) : '—'}</td>
              <td style={cell}><button className="btn btn-sm" onClick={() => open(o.document_id, false)}>картка</button></td></tr>
          ))}</tbody></table></div>
        </>}
        {data.duplicates.length > 0 && <>
          <h3 style={{ margin: '16px 0 6px', color: 'var(--red)' }}>Кілька карток на один документ</h3>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 6px' }}>Подвоюють борг і списання зі складу — зайві картки треба видалити.</p>
          <div className="card" style={{ padding: 0 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{data.duplicates.map(o => (
            <tr key={o.generated_id}><td style={cell}><b>{o.number || '—'}</b></td><td style={cell}>{(o.documents || []).length} картки</td>
              <td style={cell}>{(o.documents || []).map((id, i) => <button key={id} className="btn btn-sm" style={{ marginRight: 4 }} onClick={() => open(id, false)}>картка {i + 1}</button>)}</td></tr>
          ))}</tbody></table></div>
        </>}
      </>}
      {docModal && <DocModal user={user} existingDoc={docModal} autoOcr={false} onClose={() => { setDocModal(null); load() }} onSaved={() => { setDocModal(null); load() }} />}
      {genModal && <GeneratedDocModal doc={genModal} onClose={() => { setGenModal(null); load() }} />}
    </div>
  )
}

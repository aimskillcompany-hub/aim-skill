import { useEffect, useState } from 'react'
import { fmt } from '../lib/fmt'
import { useCompany } from '../lib/company'
import { findLinkProblems, trimPlan, applyTrim, unlink, moveTxToContractor, setContractorCode } from '../lib/linkCheck'

const dmy = (iso) => iso ? `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.${String(iso).slice(0, 4)}` : '—'
const cell = { padding: '6px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const H3 = ({ children, hint }) => <div style={{ margin: '14px 0 6px' }}><b style={{ fontSize: 13 }}>{children}</b>{hint && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{hint}</div>}</div>
const docLabel = (d) => d ? `${d.doc_number ? '№' + d.doc_number : 'б/н'} ${dmy(d.doc_date)}` : 'документ'
const txLabel = (t) => t ? `${dmy(t.date)} · ${fmt(Math.abs(Number(t.amount) || 0))} · ${t.counterparty || ''}` : 'платіж'

// «Перевірка прив'язок»: задвоєні прив'язки платежів і документів, операції не того контрагента
export default function LinkCheckModal({ onClose, onChanged = () => {} }) {
  const { companies } = useCompany()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState({})
  const load = () => { setData(null); findLinkProblems(companies.map(c => c.id)).then(setData).catch(e => setErr(e.message)) }
  useEffect(() => { load() }, [companies])

  const act = async (key, question, fn) => {
    if (question && !window.confirm(question)) return
    setBusy(key); setErr(null)
    const r = await fn()
    setBusy(null)
    if (!r.ok) { setErr(r.error); return }
    setDone(d => ({ ...d, [key]: true })); onChanged()
  }
  const Btn = ({ k, children, onClick, danger }) => done[k] ? <span style={{ color: 'var(--green)' }}>✓ виправлено</span>
    : <button className="btn btn-sm" disabled={!!busy} onClick={onClick} style={{ fontSize: 12, padding: '2px 8px', ...(danger ? { color: 'var(--red)' } : {}) }}>{busy === k ? '…' : children}</button>

  const Over = ({ p, kind }) => {
    const plan = trimPlan(p, kind)
    return <tr>
      <td style={cell}>{kind === 'tx' ? <>Платіж <b>{txLabel(p.tx)}</b></> : <>Документ <b>{docLabel(p.doc)}</b></>}
        <div style={{ color: 'var(--text3)' }}>сума {fmt(p.total)}, прив'язано {fmt(p.linked)} — <b style={{ color: 'var(--red)' }}>зайве {fmt(p.excess)}</b></div></td>
      <td style={cell}>{p.links.map(l => <div key={l.id}>{kind === 'tx' ? docLabel(l.doc) : txLabel(l.tx)}: {fmt(l.amount)}
        {!done['u' + l.id] ? <button className="btn btn-sm" disabled={!!busy} onClick={() => act('u' + l.id, 'Відв\'язати цю прив\'язку?', () => unlink(l.id))} style={{ fontSize: 11, padding: '0 6px', marginLeft: 6 }}>відв'язати</button> : <span style={{ color: 'var(--green)' }}> ✓</span>}</div>)}</td>
      <td style={{ ...cell, width: 220 }}>
        <div style={{ color: 'var(--text3)', marginBottom: 4 }}>{plan.map(x => <div key={x.id}>{kind === 'tx' ? docLabel(x.doc) : txLabel(x.tx)}: {fmt(x.from)} → <b>{x.to ? fmt(x.to) : 'відв\'язати'}</b></div>)}</div>
        <Btn k={p.key} onClick={() => act(p.key, 'Зменшити прив\'язки за планом (надлишок знімається з пізніших)?', () => applyTrim(plan))}>Виправити за планом</Btn>
      </td>
    </tr>
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Перевірка прив'язок оплат</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>Від прив'язок «платіж ↔ документ» залежать борг у картці контрагента і «Дебіторка». Кожне виправлення — після підтвердження.</div>
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}
        {!data ? <p style={{ color: 'var(--text3)' }}>Перевіряю…</p> : <div style={{ maxHeight: '64vh', overflow: 'auto' }}>
          {!data.overTx.length && !data.overDoc.length && !data.wrongContractor.length && !data.badCard.length && <p style={{ color: 'var(--green)' }}>Проблем не знайдено.</p>}

          {data.overTx.length > 0 && <><H3 hint="Одна оплата «гасить» документи на суму, більшу за саму оплату — борг за ними занижено.">Платіж прив'язано більше, ніж його сума ({data.overTx.length})</H3>
            <table style={{ width: '100%' }}><tbody>{data.overTx.map(p => <Over key={p.key} p={p} kind="tx" />)}</tbody></table></>}

          {data.overDoc.length > 0 && <><H3 hint="Документ «оплачено» більше, ніж його сума — зайва частина платежів має лишитись вільною (аванс) або йти на інший документ.">Документ оплачено більше, ніж його сума ({data.overDoc.length})</H3>
            <table style={{ width: '100%' }}><tbody>{data.overDoc.map(p => <Over key={p.key} p={p} kind="doc" />)}</tbody></table></>}

          {data.wrongContractor.length > 0 && <><H3 hint="ЄДРПОУ у виписці банку не збігається з ЄДРПОУ контрагента, якому віднесено операцію — вона потрапляє в обороти й борг не тієї компанії.">Операція віднесена не тому контрагенту ({data.wrongContractor.length})</H3>
            <table style={{ width: '100%' }}><tbody>{data.wrongContractor.map(p => <tr key={p.key}>
              <td style={cell}><b>{txLabel(p.tx)}</b><div style={{ color: 'var(--text3)' }}>у виписці ЄДРПОУ <b>{p.tx.edrpou}</b>{p.tx.article ? ` · ${p.tx.article}` : ''}</div></td>
              <td style={cell}>зараз: <b>{p.current.name}</b> ({p.current.edrpou})<br />за кодом: {p.match ? <b>{p.match.name}</b> : <span style={{ color: 'var(--text3)' }}>контрагента з таким ЄДРПОУ немає</span>}
                {p.links.length > 0 && <div style={{ color: 'var(--orange, #b45309)' }}>прив'язано до: {p.links.map(l => docLabel(l.doc)).join(', ')}</div>}</td>
              <td style={{ ...cell, width: 220 }}>{p.match
                ? <Btn k={p.key} onClick={() => act(p.key, `Перенести операцію на «${p.match.name}»?${p.links.length ? `\n\nПрив'язки до документів «${p.current.name}» (${p.links.map(l => docLabel(l.doc)).join(', ')}) буде знято.` : ''}`, () => moveTxToContractor(p.tx, p.match.id, p.links.map(l => l.id)))}>Перенести на «{p.match.name}»</Btn>
                : <span style={{ color: 'var(--text3)' }}>створіть контрагента або виправте ЄДРПОУ в картці</span>}</td>
            </tr>)}</tbody></table></>}

          {data.badCard.length > 0 && <><H3 hint="У картці контрагента ЄДРПОУ порожній або 00000000, а у виписках його платежів — справжній код.">ЄДРПОУ в картці не заповнено ({data.badCard.length})</H3>
            <table style={{ width: '100%' }}><tbody>{data.badCard.map(g => <tr key={g.key}>
              <td style={cell}><b>{g.contractor.name}</b><div style={{ color: 'var(--text3)' }}>у картці: {g.contractor.edrpou || 'порожньо'}</div></td>
              <td style={cell}>у виписках: {g.codes.map(([c, n]) => <div key={c}><b>{c}</b> — {n} операц.</div>)}</td>
              <td style={{ ...cell, width: 220 }}>{g.codes.length === 1
                ? <Btn k={g.key} onClick={() => act(g.key, `Записати ЄДРПОУ ${g.codes[0][0]} у картку «${g.contractor.name}»?\n\nПеревірте: це код самого контрагента, а не банку чи посередника.`, () => setContractorCode(g.contractor.id, g.codes[0][0]))}>Записати {g.codes[0][0]}</Btn>
                : <span style={{ color: 'var(--text3)' }}>кілька різних кодів — перевірте операції вручну</span>}</td>
            </tr>)}</tbody></table></>}
        </div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={load} disabled={!!busy}>Перевірити ще раз</button>
          <button className="btn" onClick={onClose}>Закрити</button>
        </div>
      </div>
    </div>
  )
}

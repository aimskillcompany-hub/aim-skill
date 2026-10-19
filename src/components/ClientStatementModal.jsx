import { useEffect, useMemo, useState } from 'react'
import { useUser } from '../lib/auth'
import {
  buildClientStatement, exportClientStatementXlsx, reminderText, loadTemplate, saveTemplate, DEFAULT_TEMPLATE,
  logReminder, remindersFor, money, dmy, docTitle, TITLES,
} from '../lib/clientStatement'
import { downloadClientStatementPdf } from '../lib/clientStatementPdf'
import { todayKyiv } from '../lib/dates'

// «Звіт для клієнта» по одному контрагенту: налаштування → попередній перегляд → PDF / Excel / текст.
// Якщо контрагент винен кільком нашим юрособам — окремий звіт на кожну (різні реквізити для оплати).
const todayIso = () => todayKyiv()

export default function ClientStatementModal({ group, defaultAsOf, onClose, onLogged }) {
  const { user } = useUser()
  // юрособи, яким винен контрагент (з поточного звіту)
  const cos = useMemo(() => {
    const m = {}
    group.docs.forEach(d => { const x = (m[d.companyId] ||= { id: d.companyId, name: d.companyName, total: 0 }); x.total += d.outstanding })
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [group])
  const [companyId, setCompanyId] = useState(cos[0]?.id)
  const [asOf, setAsOf] = useState(defaultAsOf && defaultAsOf < todayIso() ? defaultAsOf : todayIso())
  const [title, setTitle] = useState('reminder')
  const [withItems, setWithItems] = useState(true)
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  // менеджер — поточний користувач (лише для тексту нагадування і журналу; у PDF підпису немає)
  const mgr = { name: user?.full_name || user?.email || '', phone: user?.phone || '' }
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [tpl, setTpl] = useState(loadTemplate())
  const [log, setLog] = useState(undefined)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setBusy(true); setErr(null)
    buildClientStatement({ contractorId: group.contractorId, companyId, asOf, onlyOverdue, withItems, title })
      .then(r => { if (!cancelled) setSt(r) })
      .catch(e => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [companyId, asOf, onlyOverdue, withItems, title, group.contractorId])
  useEffect(() => { remindersFor(group.contractorId).then(setLog) }, [group.contractorId])

  const record = async (channel) => {
    if (!st) return
    const ok = await logReminder(st, { channel, userId: user?.id, userName: mgr.name })
    if (ok) { remindersFor(group.contractorId).then(setLog); onLogged?.() }
  }
  const doPdf = async () => { downloadClientStatementPdf(st); await record('pdf') }
  const doXlsx = async () => {
    try { await exportClientStatementXlsx(st); await record('xlsx') } catch (e) { setErr('Excel: ' + e.message) }
  }
  const doAllPdf = async () => {
    for (const c of cos) {
      const s = c.id === companyId && st ? st : await buildClientStatement({ contractorId: group.contractorId, companyId: c.id, asOf, onlyOverdue, withItems, title })
      if (!s.docs.length) continue
      downloadClientStatementPdf(s)
      await logReminder(s, { channel: 'pdf', userId: user?.id, userName: mgr.name })
    }
    remindersFor(group.contractorId).then(setLog); onLogged?.()
  }
  const doCopy = async () => {
    const text = reminderText(st, mgr, tpl)
    try { await navigator.clipboard.writeText(text) }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } finally { ta.remove() }
    }
    setMsg('Текст нагадування скопійовано'); setTimeout(() => setMsg(null), 2500)
    await record('text')
  }

  const empty = st && st.docs.length === 0
  const W = st?.warnings

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1060, width: '96%', maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>Звіт для клієнта</h2>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{group.name}{group.edrpou ? ` · ЄДРПОУ ${group.edrpou}` : ''}</div>
          </div>
          <button className="btn" onClick={onClose}><i className="ti ti-x" /></button>
        </div>

        {/* Налаштування */}
        {cos.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Юрособа-постачальник (окремий звіт на кожну):</span>
            {cos.map(c => (
              <button key={c.id} className={'btn btn-sm' + (c.id === companyId ? ' btn-primary' : '')} style={{ minHeight: 30, padding: '4px 12px', fontSize: 12.5 }} onClick={() => setCompanyId(c.id)}>
                {c.name} · {money(c.total)}
              </button>
            ))}
          </div>
        )}
        <div className="compact" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, alignItems: 'end', marginBottom: 10 }}>
          <div className="form-group"><label>Станом на</label><input type="date" className="form-input" value={asOf} onChange={e => e.target.value && setAsOf(e.target.value)} /></div>
          <div className="form-group"><label>Заголовок</label>
            <select className="form-input" value={title} onChange={e => setTitle(e.target.value)}>
              <option value="reminder">{TITLES.reminder}</option><option value="statement">{TITLES.statement}</option>
            </select></div>
          <div className="form-group"><label>Товари</label>
            <select className="form-input" value={withItems ? '1' : '0'} onChange={e => setWithItems(e.target.value === '1')}><option value="1">з товарами</option><option value="0">без товарів</option></select></div>
          <div className="form-group"><label>Документи</label>
            <select className="form-input" value={onlyOverdue ? '1' : '0'} onChange={e => setOnlyOverdue(e.target.value === '1')}><option value="0">усі неоплачені</option><option value="1">лише прострочені</option></select></div>
        </div>

        {/* Дії */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button className="btn btn-primary" disabled={!st || busy || empty} onClick={doPdf}><i className="ti ti-file-download" /> PDF</button>
          <button className="btn" disabled={!st || busy || empty} onClick={doXlsx}><i className="ti ti-file-spreadsheet" /> Excel</button>
          <button className="btn" disabled={!st || busy || empty} onClick={doCopy}><i className="ti ti-copy" /> Скопіювати текст нагадування</button>
          {cos.length > 1 && <button className="btn" disabled={busy} onClick={doAllPdf}><i className="ti ti-files" /> PDF для всіх юросіб ({cos.length})</button>}
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setTplOpen(o => !o)}><i className="ti ti-template" /> Шаблон тексту</button>
          {msg && <span style={{ fontSize: 12.5, color: 'var(--green)' }}><i className="ti ti-check" /> {msg}</span>}
        </div>
        {tplOpen && (
          <div style={{ marginBottom: 12, background: 'var(--surface2)', borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Змінні: {'{дата} {контрагент} {юрособа} {сума} {сума_прострочено} {кількість} {менеджер} {телефон}'}. Шаблон зберігається в цьому браузері.</div>
            <textarea className="form-input" rows={8} value={tpl} onChange={e => { setTpl(e.target.value); saveTemplate(e.target.value) }} style={{ width: '100%', fontSize: 13, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button className="btn btn-sm" onClick={() => { setTpl(DEFAULT_TEMPLATE); saveTemplate(DEFAULT_TEMPLATE) }}>Скинути до стандартного</button>
            </div>
            {st && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 8, fontFamily: 'inherit' }}>{reminderText(st, mgr, tpl)}</pre>}
          </div>
        )}

        {/* Попередження (внутрішні, у звіт не потрапляють) */}
        {W && (W.noNumber.length > 0 || W.noItems.length > 0 || W.mismatch.length > 0) && (
          <div style={{ background: '#FFF8E6', border: '1px solid #F2C07A', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, marginBottom: 12, color: '#7A4B00' }}>
            {W.noNumber.length > 0 && <div><i className="ti ti-alert-triangle" /> Без номера: {W.noNumber.map(d => `${dmy(d.doc_date)} (${money(d.outstanding)})`).join(', ')} — у звіті буде вид і дата. Краще заповнити номер у розділі «Документи».</div>}
            {W.noItems.length > 0 && <div><i className="ti ti-list" /> Немає позицій: {W.noItems.map(docTitle).join(', ')} — у звіті «Згідно документа».</div>}
            {W.mismatch.length > 0 && <div><i className="ti ti-scale" /> Сума рядків ≠ сумі документа: {W.mismatch.map(d => `${docTitle(d)} (різниця ${money(d.items.diff)})`).join(', ')}.</div>}
          </div>
        )}

        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>Помилка: {err}</div>}
        {busy && !st && <p style={{ color: 'var(--text3)' }}>Формую…</p>}
        {empty && <p style={{ color: 'var(--text3)', fontSize: 13 }}>За цими налаштуваннями неоплачених документів немає.</p>}
        {st && !empty && <Preview st={st} dim={busy} />}

        {/* Журнал */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Журнал нагадувань</div>
          {log === null ? <p style={{ fontSize: 12.5, color: 'var(--text3)', margin: 0 }}>Запустіть міграцію 068, щоб вести журнал нагадувань.</p>
            : !log?.length ? <p style={{ fontSize: 12.5, color: 'var(--text3)', margin: 0 }}>Нагадувань ще не було.</p>
            : (
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <tbody>
                  {log.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={{ padding: '4px 6px' }}>{r.created_by_name || '—'}</td>
                      <td style={{ padding: '4px 6px' }}>{{ pdf: 'PDF', xlsx: 'Excel', text: 'текст' }[r.channel] || r.channel}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.total)} грн</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap', color: Number(r.overdue) > 0 ? 'var(--red)' : 'var(--text3)' }}>{Number(r.overdue) > 0 ? `простр. ${money(r.overdue)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </div>
  )
}

// Попередній перегляд — той самий зміст, що й у PDF
function Preview({ st, dim }) {
  const td = { padding: '5px 8px', fontSize: 12.5 }
  const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 20, background: '#fff', color: '#17151F', opacity: dim ? 0.55 : 1 }}>
      <div style={{ fontSize: 11, color: '#5E5A6B', fontWeight: 700, letterSpacing: 1 }}>КОМУ</div>
      <div style={{ fontWeight: 700 }}>{st.contractor.name}</div>
      <div style={{ fontSize: 12, color: '#5E5A6B' }}>
        {st.contractor.edrpou && `ЄДРПОУ ${st.contractor.edrpou}`}
      </div>
      <div style={{ fontSize: 13, marginTop: 6 }}><span style={{ color: '#5E5A6B' }}>Заборгованість перед: </span><b>{st.company.shortName || st.company.name}</b></div>
      <div style={{ fontSize: 11.5, color: '#9AA0AE', margin: '2px 0 14px' }}>станом на {dmy(st.asOf)}</div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
          <thead><tr style={{ fontSize: 11, color: '#5E5A6B', borderBottom: '1px solid #CFCBD9' }}>
            <th style={{ ...td, textAlign: 'left' }}>Документ / товар</th><th style={{ ...td, textAlign: 'left' }}>Дата відвант.</th>
            <th style={num}>Сума, грн</th><th style={num}>Залишок, грн</th><th style={num}>Днів з відвант.</th>
          </tr></thead>
          <tbody>
            {st.docs.map((d, i) => <FragmentRows key={d.docId} d={d} st={st} td={td} num={num} first={i === 0} />)}
            <tr style={{ fontWeight: 700, borderTop: '1px solid #CFCBD9' }}>
              <td style={{ ...td, fontSize: 13.5, paddingTop: 8 }} colSpan={3}>Разом до сплати</td>
              <td style={{ ...num, fontSize: 13.5, paddingTop: 8 }}>{money(st.summary.total)}</td><td style={td} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FragmentRows({ d, st, td, num, first }) {
  const doc = { background: '#F2F2F2', fontWeight: 700 }
  return (
    <>
      {!first && <tr><td colSpan={5} style={{ height: 8, padding: 0 }} /></tr>}
      <tr style={{ ...doc, borderTop: first ? 'none' : '1px solid #CFCBD9' }}>
        <td style={td}>{docTitle(d)}</td>
        <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 400 }}>{dmy(d.doc_date)}</td>
        <td style={num}>{money(d.amount)}</td>
        <td style={num}>{money(d.outstanding)}</td>
        <td style={num}>{d.ageDays}</td>
      </tr>
      {st.withItems && (d.items?.rows || []).map(r => (
        <tr key={r.n} style={{ color: '#5E5A6B' }}>
          <td style={{ ...td, paddingLeft: 24, fontSize: 12 }} colSpan={2}>
            <span style={{ color: '#9AA0AE' }}>{r.n}.</span> {r.name}{r.sku && <span style={{ color: '#9AA0AE' }}> · арт. {r.sku}</span>}
            {r.qty != null && <span style={{ color: '#9AA0AE' }}> · {r.qty} {r.unit || ''} × {money(r.price)}</span>}
          </td>
          <td style={{ ...num, fontSize: 12 }}>{money(r.sum)}</td>
          <td style={td} /><td style={td} />
        </tr>
      ))}
      {d.payments.filter(p => p.amount > 0).map((p, i) => (
        <tr key={'p' + i} style={{ color: '#1F7A4D', fontStyle: 'italic' }}>
          <td style={{ ...td, paddingLeft: 24, fontSize: 12 }} colSpan={2}>Оплачено {p.date ? dmy(p.date) : ''}</td>
          <td style={{ ...num, fontSize: 12 }}>−{money(p.amount)}</td>
          <td style={td} colSpan={2} />
        </tr>
      ))}
    </>
  )
}

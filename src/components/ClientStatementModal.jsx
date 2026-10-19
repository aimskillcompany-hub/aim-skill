import { useEffect, useMemo, useState } from 'react'
import { useUser } from '../lib/auth'
import {
  buildClientStatement, exportClientStatementXlsx, reminderText, loadTemplate, saveTemplate, DEFAULT_TEMPLATE,
  logReminder, remindersFor, money, dmy, docTitle, TITLES,
} from '../lib/clientStatement'
import { downloadClientStatementPdf } from '../lib/clientStatementPdf'

// «Звіт для клієнта» по одному контрагенту: налаштування → попередній перегляд → PDF / Excel / текст.
// Якщо контрагент винен кільком нашим юрособам — окремий звіт на кожну (різні реквізити для оплати).
const MGR_KEY = 'recv_manager'
const loadMgr = () => { try { return JSON.parse(localStorage.getItem(MGR_KEY) || '{}') } catch { return {} } }
const saveMgr = (m) => { try { localStorage.setItem(MGR_KEY, JSON.stringify(m)) } catch { /* ignore */ } }
const todayIso = () => new Date().toISOString().slice(0, 10)

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
  const saved = loadMgr()
  const [mgr, setMgr] = useState({ name: saved.name || user?.full_name || user?.email || '', position: saved.position || 'Менеджер', phone: saved.phone || '', email: saved.email || user?.email || '' })
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

  const setM = (k, v) => setMgr(m => { const n = { ...m, [k]: v }; saveMgr(n); return n })
  const record = async (channel) => {
    if (!st) return
    const ok = await logReminder(st, { channel, userId: user?.id, userName: mgr.name })
    if (ok) { remindersFor(group.contractorId).then(setLog); onLogged?.() }
  }
  const doPdf = async () => { downloadClientStatementPdf(st, mgr); await record('pdf') }
  const doXlsx = async () => { exportClientStatementXlsx(st); await record('xlsx') }
  const doAllPdf = async () => {
    for (const c of cos) {
      const s = c.id === companyId && st ? st : await buildClientStatement({ contractorId: group.contractorId, companyId: c.id, asOf, onlyOverdue, withItems, title })
      if (!s.docs.length) continue
      downloadClientStatementPdf(s, mgr)
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
        <div className="compact" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, alignItems: 'end', marginBottom: 12 }}>
          <div className="form-group"><label>Менеджер (підпис)</label><input className="form-input" value={mgr.name} onChange={e => setM('name', e.target.value)} /></div>
          <div className="form-group"><label>Посада</label><input className="form-input" value={mgr.position} onChange={e => setM('position', e.target.value)} /></div>
          <div className="form-group"><label>Телефон</label><input className="form-input" value={mgr.phone} onChange={e => setM('phone', e.target.value)} placeholder="+380…" /></div>
          <div className="form-group"><label>Email</label><input className="form-input" value={mgr.email} onChange={e => setM('email', e.target.value)} /></div>
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
        {st && !empty && <Preview st={st} mgr={mgr} dim={busy} />}

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
function Preview({ st, mgr, dim }) {
  const c = st.company
  const td = { padding: '5px 8px', borderTop: '1px solid #EFECF5', fontSize: 12.5 }
  const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 20, background: '#fff', color: '#17151F', opacity: dim ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: '#5E5A6B' }}>
          {c.logoBase64 && <img src={c.logoBase64} alt="" style={{ height: 34, marginBottom: 6, display: 'block' }} />}
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#17151F' }}>{c.name || c.shortName}</div>
          <div>{c.edrpou && `ЄДРПОУ ${c.edrpou}`}{c.ipn && ` · ІПН ${c.ipn}`}</div>
          {c.address && <div>{c.address}</div>}
          <div>{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{st.title}</div>
          <div style={{ fontSize: 13 }}>станом на {dmy(st.asOf)}</div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid #E6E2F0', margin: '12px 0 10px' }} />
      <div style={{ fontSize: 11, color: '#5E5A6B', fontWeight: 700, letterSpacing: 1 }}>КОМУ</div>
      <div style={{ fontWeight: 700 }}>{st.contractor.name}</div>
      <div style={{ fontSize: 12, color: '#5E5A6B', marginBottom: 12 }}>
        {st.contractor.edrpou && `ЄДРПОУ ${st.contractor.edrpou}`}{st.contracts.length > 0 && ` · Договір ${st.contracts.map(x => `№ ${x.num}${x.date ? ' від ' + dmy(x.date) : ''}`).join('; ')}`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 14 }}>
        <Box label="До сплати" value={`${money(st.summary.total)} грн`} sub={st.vatPayer ? `у т.ч. ПДВ ${money(st.summary.vat)} грн` : 'Без ПДВ'} />
        <Box label="З них прострочено" value={`${money(st.summary.overdue)} грн`} sub={st.summary.overdue > 0 ? `найбільша прострочка — ${st.summary.maxOverdue} дн.` : 'прострочки немає'} red={st.summary.overdue > 0} />
        <Box label="Неоплачених документів" value={String(st.summary.count)} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse' }}>
          <thead><tr style={{ fontSize: 11, color: '#5E5A6B', background: '#F6F4FA' }}>
            <th style={{ ...td, textAlign: 'left', borderTop: 'none' }}>Документ / товар</th><th style={{ ...td, borderTop: 'none' }}>Дата відвант.</th><th style={{ ...td, borderTop: 'none' }}>Строк оплати</th>
            <th style={{ ...num, borderTop: 'none' }}>Сума, грн</th><th style={{ ...num, borderTop: 'none' }}>Оплачено</th><th style={{ ...num, borderTop: 'none' }}>Залишок</th><th style={{ ...num, borderTop: 'none' }}>Простр., дн.</th>
          </tr></thead>
          <tbody>
            {st.docs.map(d => (
              <FragmentRows key={d.docId} d={d} st={st} td={td} num={num} />
            ))}
            <tr style={{ background: '#F6F4FA', fontWeight: 700 }}>
              <td style={td} colSpan={5}>Разом до сплати</td><td style={num}>{money(st.summary.total)}</td><td style={td} />
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: '#5E5A6B', fontWeight: 700, letterSpacing: 1, margin: '16px 0 4px' }}>РЕКВІЗИТИ ДЛЯ ОПЛАТИ</div>
      <div style={{ fontSize: 12.5, display: 'grid', gridTemplateColumns: '100px 1fr', gap: '2px 8px' }}>
        <span style={{ color: '#5E5A6B' }}>Отримувач</span><span>{c.name || c.shortName}</span>
        <span style={{ color: '#5E5A6B' }}>ЄДРПОУ</span><span>{c.edrpou}</span>
        <span style={{ color: '#5E5A6B' }}>IBAN</span><span>{c.iban || <i style={{ color: 'var(--red)' }}>не заповнено в реквізитах юрособи</i>}</span>
        <span style={{ color: '#5E5A6B' }}>Банк</span><span>{c.bankName}{c.mfo ? `, МФО ${c.mfo}` : ''}</span>
        <span style={{ color: '#5E5A6B' }}>Призначення</span><span>{st.purpose}</span>
      </div>
      <div style={{ fontSize: 12.5, fontStyle: 'italic', color: '#5E5A6B', marginTop: 10 }}>Якщо оплату вже здійснено — просимо надіслати платіжне доручення.</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 18, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5 }}>
          <div style={{ color: '#5E5A6B', fontSize: 11.5 }}>{mgr.position}</div>
          <div style={{ fontWeight: 700 }}>{mgr.name}</div>
          <div style={{ color: '#5E5A6B' }}>{[mgr.phone, mgr.email].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ width: 170, borderTop: '1px solid #5E5A6B', fontSize: 10.5, color: '#9AA0AE', paddingTop: 2 }}>підпис</div>
      </div>
    </div>
  )
}

function FragmentRows({ d, st, td, num }) {
  return (
    <>
      <tr style={{ fontWeight: 600 }}>
        <td style={td}>{docTitle(d)}</td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>{dmy(d.doc_date)}</td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>{dmy(d.dueDate)}</td>
        <td style={num}>{money(d.amount)}</td>
        <td style={{ ...num, color: d.paid > 0 ? undefined : '#B8B4C4' }}>{money(d.paid)}</td>
        <td style={{ ...num, fontWeight: 700 }}>{money(d.outstanding)}</td>
        <td style={{ ...num, color: d.overdueDays > 0 ? '#C62828' : '#B8B4C4' }}>{d.overdueDays > 0 ? d.overdueDays : '—'}</td>
      </tr>
      {st.withItems && (d.items?.rows || []).map(r => (
        <tr key={r.n} style={{ color: '#5E5A6B' }}>
          <td style={{ ...td, paddingLeft: 22, borderTop: 'none', fontSize: 12 }} colSpan={3}><span style={{ color: '#9AA0AE' }}>{r.n}.</span> {r.name}{r.sku && <span style={{ color: '#9AA0AE' }}> · арт. {r.sku}</span>}</td>
          <td style={{ ...num, borderTop: 'none', fontSize: 11.5 }} colSpan={2}>{r.qty != null ? `${r.qty} ${r.unit || ''} × ${money(r.price)}` : ''}</td>
          <td style={{ ...num, borderTop: 'none', fontSize: 12 }}>{money(r.sum)}</td>
          <td style={{ ...td, borderTop: 'none' }} />
        </tr>
      ))}
      {d.payments.filter(p => p.amount > 0).map((p, i) => (
        <tr key={'p' + i} style={{ color: '#1F7A4D', fontStyle: 'italic' }}>
          <td style={{ ...td, paddingLeft: 22, borderTop: 'none', fontSize: 12 }} colSpan={4}>Оплата {p.date ? `від ${dmy(p.date)}` : ''}</td>
          <td style={{ ...num, borderTop: 'none', fontSize: 12 }}>{money(p.amount)}</td>
          <td style={{ ...td, borderTop: 'none' }} colSpan={2} />
        </tr>
      ))}
    </>
  )
}

function Box({ label, value, sub, red }) {
  return (
    <div style={{ background: '#F6F4FA', borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ fontSize: 11.5, color: '#5E5A6B' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: red ? '#C62828' : '#17151F' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#5E5A6B' }}>{sub}</div>}
    </div>
  )
}

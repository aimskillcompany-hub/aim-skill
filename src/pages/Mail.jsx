import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSort, SortTh } from '../components/Sort'

const fmtDate = (s) => s ? new Date(s).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function Mail() {
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [dir, setDir] = useState('all')        // all | in | out
  const [onlyAtt, setOnlyAtt] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState(null)
  const [open, setOpen] = useState(null)        // вибраний лист

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('emails')
      .select('id, direction, from_addr, to_addr, subject, email_date, has_attachments, attachments, order_id, body_text, body_html')
      .order('email_date', { ascending: false, nullsFirst: false }).limit(400)
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const sync = async () => {
    setSyncing(true); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/mail-sync', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Помилка ${res.status}`)
      const s = data.summary || {}
      setMsg({ ok: true, text: `Синхронізовано · нових листів: ${s.newEmails || 0}${s.truncated ? ' (є ще — натисніть ще раз)' : ''}${s.errors?.length ? ` · помилок: ${s.errors.length}` : ''}` })
      load()
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    setSyncing(false)
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows.filter(e => {
      if (dir !== 'all' && e.direction !== dir) return false
      if (onlyAtt && !e.has_attachments) return false
      if (!term) return true
      return (e.subject || '').toLowerCase().includes(term) ||
        (e.from_addr || '').toLowerCase().includes(term) || (e.to_addr || '').toLowerCase().includes(term)
    })
  }, [rows, q, dir, onlyAtt])

  const { sort, onSort, sorted } = useSort('date', 'desc')
  const view = sorted(filtered, {
    date: e => e.email_date || '',
    from: e => (e.direction === 'out' ? e.to_addr : e.from_addr) || '',
    subject: e => e.subject || '',
  })

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1>Пошта</h1>
        <button className="btn btn-primary" onClick={sync} disabled={syncing}><i className="ti ti-refresh" /> {syncing ? 'Синхронізація…' : 'Синхронізувати'}</button>
      </div>

      {msg && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 13,
          background: msg.ok ? 'var(--blue-bg, #EFF4FF)' : 'rgba(220,38,38,0.08)', color: msg.ok ? 'var(--text2)' : 'var(--red)' }}>
          <i className={`ti ${msg.ok ? 'ti-mail-check' : 'ti-alert-triangle'}`} /> {msg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" placeholder="Пошук теми/адреси…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 220px', maxWidth: 320 }} />
        <select className="form-input" value={dir} onChange={e => setDir(e.target.value)} style={{ width: 160 }}>
          <option value="all">Усі</option>
          <option value="in">Вхідні</option>
          <option value="out">Вихідні</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyAtt} onChange={e => setOnlyAtt(e.target.checked)} /> лише з вкладеннями
        </label>
      </div>

      <div className="card">
        {loading ? <p style={{ color: 'var(--text3)' }}>Завантаження…</p> : view.length === 0 ? (
          <p style={{ color: 'var(--text3)' }}>Листів немає. Натисніть «Синхронізувати», щоб підтягнути пошту за 10 днів.</p>
        ) : (
          <table className="table">
            <thead><tr>
              <th style={{ width: 40 }}></th>
              <SortTh label="Дата" k="date" sort={sort} onSort={onSort} />
              <SortTh label="Від / Кому" k="from" sort={sort} onSort={onSort} />
              <SortTh label="Тема" k="subject" sort={sort} onSort={onSort} />
              <th style={{ width: 90 }}></th>
            </tr></thead>
            <tbody>
              {view.map(e => (
                <tr key={e.id} onClick={() => setOpen(e)} style={{ cursor: 'pointer' }}>
                  <td><i className={`ti ${e.direction === 'out' ? 'ti-arrow-up-right' : 'ti-arrow-down-left'}`}
                    style={{ color: e.direction === 'out' ? 'var(--blue)' : 'var(--green, #16a34a)' }} title={e.direction === 'out' ? 'Вихідний' : 'Вхідний'} /></td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--text2)', fontSize: 13 }}>{fmtDate(e.email_date)}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.direction === 'out' ? e.to_addr : e.from_addr}>{e.direction === 'out' ? e.to_addr : e.from_addr}</td>
                  <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.subject}>
                    {e.has_attachments && <i className="ti ti-paperclip" style={{ color: 'var(--text3)', marginRight: 4 }} />}
                    {e.subject}
                  </td>
                  <td>{e.order_id && <span style={{ fontSize: 11.5, background: 'var(--blue-bg, #EFF4FF)', color: 'var(--blue)', padding: '2px 8px', borderRadius: 20 }}>заявка</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && <EmailModal email={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load() }} nav={nav} />}
    </div>
  )
}

function EmailModal({ email, onClose, onChanged, nav }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const download = async (att) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(att.storage_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const createOrder = async () => {
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/order-from-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ emailId: email.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Помилка ${res.status}`)
      nav(`/orders/${data.orderId}`)
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820, width: '95vw' }}>
        <div className="modal-header"><h2 style={{ fontSize: 18 }}>{email.subject || '(без теми)'}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>

        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.7 }}>
          <div><b>{email.direction === 'out' ? 'Кому:' : 'Від:'}</b> {email.direction === 'out' ? email.to_addr : email.from_addr}</div>
          <div><b>Дата:</b> {fmtDate(email.email_date)}</div>
        </div>

        {(email.attachments || []).length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {email.attachments.map((a, i) => (
              <button key={i} className="btn" onClick={() => download(a)} style={{ fontSize: 12.5 }}>
                <i className="ti ti-paperclip" /> {a.filename}{a.size ? ` · ${Math.round(a.size / 1024)}КБ` : ''}
              </button>
            ))}
          </div>
        )}

        <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: '48vh', overflow: 'auto' }}>
          {email.body_html
            ? <iframe title="Лист" sandbox="" srcDoc={email.body_html} style={{ width: '100%', height: '46vh', border: 'none', background: '#fff' }} />
            : <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: 14, margin: 0, fontFamily: 'inherit', fontSize: 14 }}>{email.body_text || '(порожній лист)'}</pre>}
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {email.order_id
            ? <button className="btn btn-primary" onClick={() => nav(`/orders/${email.order_id}`)}><i className="ti ti-arrow-right" /> Перейти до заявки</button>
            : <button className="btn btn-primary" onClick={createOrder} disabled={busy}><i className="ti ti-sparkles" /> {busy ? 'AI формує заявку…' : 'Створити заявку'}</button>}
        </div>
      </div>
    </div>
  )
}

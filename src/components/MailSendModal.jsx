import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getDocType } from '../lib/docgen'

// Надсилання документа клієнту через корпоративну пошту (SMTP /api/mail-send).
export default function MailSendModal({ document: doc, onClose }) {
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const label = getDocType(doc?.type)?.label || 'Документ'
  const [subject, setSubject] = useState(`${label}${doc?.doc_number ? ` №${doc.doc_number}` : ''} — ТОВ «ЕЙМ СКІЛ»`)
  const [body, setBody] = useState(`Доброго дня!\n\nНадсилаємо ${label.toLowerCase()}${doc?.doc_number ? ` №${doc.doc_number}` : ''} у вкладенні.\n\nЗ повагою,\nТОВ «ЕЙМ СКІЛ»`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  // Префіл адреси з контактів контрагента
  useEffect(() => {
    if (!doc?.contractor_id) return
    supabase.from('contractor_contacts')
      .select('email, is_signer').eq('contractor_id', doc.contractor_id).not('email', 'is', null)
      .then(({ data }) => {
        if (!data?.length) return
        const pick = data.find(c => c.is_signer && c.email) || data.find(c => c.email)
        if (pick?.email) setTo(pick.email)
      })
  }, [doc?.contractor_id])

  const send = async () => {
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Сесія недійсна, увійдіть знову')
      const res = await fetch('/api/mail-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: to.trim(), cc: cc.trim() || undefined, subject, text: body, documentId: doc.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Помилка ${res.status}`)
      setDone(true)
      setTimeout(onClose, 1200)
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '95vw' }}>
        <div className="modal-header"><h2>Надіслати email</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>

        {done ? (
          <div style={{ textAlign: 'center', padding: 28, color: 'var(--green, #16a34a)' }}>
            <i className="ti ti-circle-check" style={{ fontSize: 38 }} />
            <div style={{ marginTop: 10, fontWeight: 600 }}>Лист надіслано</div>
          </div>
        ) : (
          <div className="form-grid">
            <div style={{ fontSize: 13, color: 'var(--text2)', gridColumn: '1 / -1' }} title={doc?.file_name}>
              <i className="ti ti-paperclip" /> {doc?.file_name || 'Документ'}
            </div>
            <div className="form-group full"><label>Кому</label><input className="form-input" type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="client@example.com" /></div>
            <div className="form-group full"><label>Копія (cc)</label><input className="form-input" value={cc} onChange={e => setCc(e.target.value)} placeholder="необов'язково" /></div>
            <div className="form-group full"><label>Тема</label><input className="form-input" value={subject} onChange={e => setSubject(e.target.value)} /></div>
            <div className="form-group full"><label>Повідомлення</label><textarea className="form-input" rows={6} value={body} onChange={e => setBody(e.target.value)} style={{ resize: 'vertical' }} /></div>

            {error && <div style={{ color: 'var(--red)', fontSize: 13, gridColumn: '1 / -1' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, gridColumn: '1 / -1', marginTop: 4 }}>
              <button className="btn" onClick={onClose} disabled={busy}>Скасувати</button>
              <button className="btn btn-primary" onClick={send} disabled={busy || !to.trim()}>
                <i className="ti ti-send" /> {busy ? 'Надсилання…' : 'Надіслати'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

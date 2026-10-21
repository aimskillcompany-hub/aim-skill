import { useEffect, useState } from 'react'
import { loadFixJournal, describeFix, undoFix } from '../lib/stockExcel'

// Журнал виправлень складу (087/088): кожна зміна окремо, з кнопкою «Скасувати». productId — лише записи цієї картки.
export default function FixJournal({ productId = null, onChanged = () => {} }) {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => loadFixJournal({ productId }).then(setRows).catch(e => { setErr(e.message); setRows([]) })
  useEffect(() => { load() }, [productId])
  const undo = async (id) => {
    setBusy(id); setErr(null)
    const r = await undoFix(id)
    setBusy(null)
    if (!r.ok) { setErr(r.error); return }
    load(); onChanged()
  }
  if (!rows) return <div style={{ fontSize: 13, color: 'var(--text3)' }}>Завантаження…</div>
  if (!rows.length) return <div style={{ fontSize: 13, color: 'var(--text3)' }}>Виправлень, які можна скасувати, немає.</div>
  return (
    <div style={{ maxHeight: '50vh', overflow: 'auto', fontSize: 12 }}>
      {err && <div style={{ color: 'var(--red)', marginBottom: 6 }}>{err}</div>}
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text3)', flexShrink: 0, width: 110 }}>{new Date(r.created_at).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          <span style={{ flex: 1 }}>{describeFix(r)}</span>
          <button className="btn" disabled={!!busy} onClick={() => undo(r.id)} style={{ padding: '0 8px', fontSize: 12, flexShrink: 0 }}>{busy === r.id ? '…' : 'Скасувати'}</button>
        </div>
      ))}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qc, getUserCompanyId } from '../lib/companyScope'
import { listClosings } from '../lib/periodClose'
import { todayKyiv, monthStartIso } from '../lib/dates'

// «Перерахувати собівартість за період»: заново розподіляє відвантаження періоду по партіях (FIFO,
// пріоритет — прихідна того ж замовлення) і перезаписує збережену собівартість. Звичайні нові приходи
// собівартість минулих відвантажень НЕ змінюють — лише ця явна дія (міграція 071, recalc_cost_period).
export default function RecalcCostModal({ onClose }) {
  const [from, setFrom] = useState(monthStartIso())
  const [to, setTo] = useState(todayKyiv())
  const [closed, setClosed] = useState([])
  const [stale, setStale] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    listClosings().then(list => setClosed((list || []).filter(c => c.status === 'closed'))).catch(() => {})
    qc('stock_movements').select('id', { count: 'exact', head: true }).eq('type', 'out').eq('cost_stale', true)
      .then(({ count, error }) => setStale(error ? null : count || 0))
  }, [])

  const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`
  const closedInRange = closed.filter(c => { const k = ym(c.period_year, c.period_month); return k >= from.slice(0, 7) && k <= to.slice(0, 7) })

  const run = async () => {
    setBusy(true); setErr(null); setMsg(null)
    const { data, error } = await supabase.rpc('recalc_cost_period', { p_company: getUserCompanyId(), p_from: from, p_to: to })
    setBusy(false)
    if (error) {
      if (error.code === 'PGRST202' || /recalc_cost_period/.test(error.message || '')) setErr('Спершу запустіть міграцію 071 (партії / FIFO).')
      else setErr(/PERIOD_CLOSED/.test(error.message) ? error.message.replace(/^.*PERIOD_CLOSED:\s*/, '') : error.message)
      return
    }
    setMsg(`Перераховано відвантажень: ${data}. Звіти покажуть нову собівартість після оновлення сторінки.`)
  }

  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2>Перерахувати собівартість за період</h2>
          <button className="btn" onClick={onClose} disabled={busy}><i className="ti ti-x" /></button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 0 }}>
          Відвантаження періоду заново розподіляються по партіях: спершу прихідна того ж замовлення, далі FIFO (найстаріші партії з залишком на дату відвантаження).
          Збережена собівартість цих відвантажень буде перезаписана; маржа й P&L за період зміняться. Відвантаження поза періодом не змінюються.
        </p>
        {stale > 0 && <p style={{ fontSize: 13, color: '#B45309', background: '#FFF8E6', borderRadius: 8, padding: '8px 10px' }}><i className="ti ti-alert-triangle" /> {stale} відвантажень позначені «перерахувати» — партію, з якої вони списували, було видалено.</p>}
        <div className="compact" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="form-group"><label>З</label><input type="date" className="form-input" value={from} onChange={e => e.target.value && setFrom(e.target.value)} /></div>
          <div className="form-group"><label>По</label><input type="date" className="form-input" value={to} onChange={e => e.target.value && setTo(e.target.value)} /></div>
        </div>
        {closedInRange.length > 0 && (
          <p style={{ fontSize: 13, color: 'var(--red)', background: '#FDECEC', borderRadius: 8, padding: '8px 10px' }}>
            <i className="ti ti-lock" /> У періоді є закриті місяці: {closedInRange.map(c => ym(c.period_year, c.period_month)).join(', ')}. Їхній знімок заморожено — щоб перерахувати, спершу переоткрийте ці місяці в «Закритті періоду».
          </p>
        )}
        {err && <p style={{ color: 'var(--red)', fontSize: 13 }}>{err}</p>}
        {msg && <p style={{ color: 'var(--green)', fontSize: 13 }}><i className="ti ti-check" /> {msg}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={busy}>Закрити</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || closedInRange.length > 0 || from > to}>{busy ? 'Перераховую…' : 'Перерахувати'}</button>
        </div>
      </div>
    </div>
  )
}

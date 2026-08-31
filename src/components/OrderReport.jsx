import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUS_ORDER, labelForStatus } from '../lib/orders'
import { fmt } from '../lib/fmt'

// Звіт по замовленнях: фільтри Замовник / Статус / Період →
// таблиця з № і датами договору / видаткової / рахунку + загальна сума.
// Договір береться з прив'язаних документів (типи isContract), фолбек — з contractor_contracts.

const CONTRACT_TYPES = ['supplyAgreement', 'loanAgreement']

const d = (x) => {
  if (!x) return ''
  const s = String(x).slice(0, 10)
  const [y, m, day] = s.split('-')
  return y && m && day ? `${day}.${m}.${y}` : s
}

const pick = (arr, types) => {
  const m = arr.filter(x => types.includes(x.type))
  if (!m.length) return null
  m.sort((a, b) => (b.doc_date || b.created_at || '').localeCompare(a.doc_date || a.created_at || ''))
  return m[0]
}

export default function OrderReport() {
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    supabase.from('contractors').select('id, name').order('name')
      .then(({ data }) => setClients(data || []))
  }, [])

  async function generate() {
    setLoading(true); setErr(null)
    try {
      let query = supabase.from('orders')
        .select('id, order_number, created_at, total, status, client_id, contractors(name)')
        .is('archived_at', null)
      if (clientId) query = query.eq('client_id', clientId)
      if (status) query = query.eq('status', status)
      if (from) query = query.gte('created_at', from)
      if (to) query = query.lte('created_at', to + 'T23:59:59')
      const { data: ords, error } = await query.order('order_number')
      if (error) throw error

      const ids = (ords || []).map(o => o.id)
      let docs = []
      if (ids.length) {
        const { data } = await supabase.from('documents')
          .select('order_id, type, doc_number, doc_date, created_at')
          .in('order_id', ids)
        docs = data || []
      }
      // Фолбек договору — з реєстру договорів контрагента.
      const clientIds = [...new Set((ords || []).map(o => o.client_id).filter(Boolean))]
      let contracts = []
      if (clientIds.length) {
        const { data } = await supabase.from('contractor_contracts')
          .select('contractor_id, number, date').in('contractor_id', clientIds)
          .order('date', { ascending: false })
        contracts = data || []
      }

      const byOrder = {}
      docs.forEach(x => { (byOrder[x.order_id] ||= []).push(x) })

      const result = (ords || []).map(o => {
        const arr = byOrder[o.id] || []
        const contract = pick(arr, CONTRACT_TYPES)
        const contractFb = !contract && contracts.find(c => c.contractor_id === o.client_id)
        const waybill = pick(arr, ['waybill'])
        const invoice = pick(arr, ['invoice'])
        return {
          id: o.id,
          number: o.order_number || o.id.slice(0, 6),
          date: o.created_at,
          client: o.contractors?.name || '',
          contractNum: contract?.doc_number || contractFb?.number || '',
          contractDate: contract?.doc_date || contractFb?.date || '',
          waybillNum: waybill?.doc_number || '',
          waybillDate: waybill?.doc_date || '',
          invoiceNum: invoice?.doc_number || '',
          invoiceDate: invoice?.doc_date || '',
          total: Number(o.total) || 0,
        }
      })
      setRows(result)
    } catch (e) {
      setErr(e.message || 'Помилка формування звіту')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const total = useMemo(() => (rows || []).reduce((s, r) => s + r.total, 0), [rows])

  async function exportXlsx() {
    if (!rows?.length) return
    const XLSX = await import('xlsx')
    const head = ['№ замовлення', 'Дата', 'Замовник', 'Договір №', 'Дата договору',
      'Видаткова №', 'Дата видаткової', 'Рахунок №', 'Дата рахунку', 'Сума']
    const body = rows.map(r => [r.number, d(r.date), r.client, r.contractNum, d(r.contractDate),
      r.waybillNum, d(r.waybillDate), r.invoiceNum, d(r.invoiceDate), r.total])
    body.push(['', '', '', '', '', '', '', '', 'Загальна сума', total])
    const ws = XLSX.utils.aoa_to_sheet([head, ...body])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Замовлення')
    XLSX.writeFile(wb, `Звіт_замовлення_${from}_${to}.xlsx`)
  }

  const NumDate = ({ num, date }) => num || date ? (
    <div style={{ lineHeight: 1.3 }}>
      <div style={{ fontWeight: 500 }}>{num || '—'}</div>
      {date && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{d(date)}</div>}
    </div>
  ) : <span style={{ color: 'var(--text3)' }}>—</span>

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: 220, flex: '1 1 220px' }}>
            <label>Замовник</label>
            <select className="form-input" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">Усі замовники</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, minWidth: 180, flex: '0 1 200px' }}>
            <label>Статус</label>
            <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Усі статуси</option>
              {STATUS_ORDER.map(s => <option key={s} value={s}>{labelForStatus(s)}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Період з</label>
            <input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>по</label>
            <input className="form-input" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? 'Формування…' : <><i className="ti ti-report-search" /> Сформувати</>}
          </button>
          {rows?.length > 0 && (
            <button className="btn" onClick={exportXlsx} title="Експорт в Excel"><i className="ti ti-file-spreadsheet" /> Excel</button>
          )}
        </div>
      </div>

      {err && <div className="card" style={{ marginBottom: 16, color: 'var(--red)' }}>{err}</div>}

      {rows && (
        <div className="card">
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <th>№</th>
                <th>Дата</th>
                <th>Замовник</th>
                <th>Договір</th>
                <th>Видаткова накладна</th>
                <th>Рахунок</th>
                <th style={{ textAlign: 'right' }}>Сума</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{r.number}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{d(r.date)}</td>
                    <td><div className="trunc">{r.client}</div></td>
                    <td><NumDate num={r.contractNum} date={r.contractDate} /></td>
                    <td><NumDate num={r.waybillNum} date={r.waybillDate} /></td>
                    <td><NumDate num={r.invoiceNum} date={r.invoiceDate} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.total)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 28 }}>За вибіркою замовлень немає</td></tr>}
              </tbody>
              {rows.length > 0 && (
                <tfoot><tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                  <td colSpan={6} style={{ textAlign: 'right' }}>Загальна сума</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(total)} грн</td>
                </tr></tfoot>
              )}
            </table>
          </div>
          {rows.length > 0 && <div style={{ padding: '10px 4px 0', fontSize: 13, color: 'var(--text3)' }}>Замовлень у звіті: {rows.length}</div>}
        </div>
      )}
    </div>
  )
}

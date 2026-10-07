import { useEffect, useState } from 'react'
import { useCompany } from '../lib/company'
import { supabase } from '../lib/supabase'
import { fmt } from '../lib/fmt'
import { listOutgoingWaybills, traceOutgoing } from '../lib/accountantReport'
import { exportOutgoingReportPdf } from '../lib/outgoingReportPdf'

// Звіт для бухгалтера: по видатковій — простежити кожен товар до прихідної накладної (де/коли куплено).
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'

export default function AccountantReport() {
  const { activeId } = useCompany()
  const [tab] = useState('outgoing')
  const [list, setList] = useState(null)
  const [sel, setSel] = useState('')
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { setList(null); setReport(null); setSel(''); listOutgoingWaybills().then(setList).catch(e => setErr(e.message)) }, [activeId])

  const build = async () => {
    if (!sel) return
    setBusy(true); setErr(null); setReport(null)
    try { setReport(await traceOutgoing(sel)) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const openFile = async (path) => {
    if (!path) return
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const downloadArchive = async () => {
    if (!report) return
    setZipping(true); setErr(null)
    try {
      const { zipSync } = await import('fflate')
      const files = {}, used = {}
      const add = async (path, label) => {
        if (!path) return
        const { data } = await supabase.storage.from('documents').download(path)
        if (!data) return
        const buf = new Uint8Array(await data.arrayBuffer())
        const ext = (path.split('.').pop() || 'pdf').toLowerCase()
        let nm = label.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'doc'
        let f = `${nm}.${ext}`
        if (used[f]) { used[f]++; f = `${nm} (${used[f]}).${ext}` } else used[f] = 1
        files[f] = buf
      }
      await add(report.doc.storage_path, `Видаткова ${report.doc.doc_number}`)
      for (const pd of report.purchaseDocs) await add(pd.storage_path, `Прихідна ${pd.doc_number} ${pd.supplierName}`)
      if (!Object.keys(files).length) { setErr('Немає файлів для архіву (документи без вкладених сканів).'); return }
      const blob = new Blob([zipSync(files)], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `Звіт по видатковій ${report.doc.doc_number}.zip`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErr('Помилка архіву: ' + e.message) } finally { setZipping(false) }
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ti ti-report-analytics" style={{ fontSize: 22 }} />
        <h1 style={{ margin: 0 }}>Звіт для бухгалтера</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
        Звіт по видатковій: оберіть нашу видаткову накладну — система покаже товари й простежить кожен до прихідної накладної (де й коли куплено).
      </p>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px' }}>
          <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Видаткова накладна</label>
          <select className="form-input" value={sel} onChange={e => setSel(e.target.value)}>
            <option value="">— оберіть —</option>
            {(list || []).map(x => <option key={x.id} value={x.id}>{x.doc_number || '(без №)'} · {d(x.doc_date)} · {x.contractorName} · {fmt(x.amount)} грн</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={build} disabled={!sel || busy}>{busy ? 'Формую…' : <><i className="ti ti-player-play" /> Сформувати</>}</button>
        {report && <button className="btn" onClick={() => exportOutgoingReportPdf(report)}><i className="ti ti-file-download" /> Звіт PDF</button>}
        {report && <button className="btn" onClick={downloadArchive} disabled={zipping}><i className="ti ti-file-zip" /> {zipping ? 'Архівую…' : 'Архів звіту (.zip)'}</button>}
      </div>

      {err && <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}</div>}

      {report && (
        <>
          {/* Шапка видаткової */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              Видаткова накладна № {report.doc.doc_number} <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: 13 }}>від {d(report.doc.doc_date)}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              Покупець: <b>{report.doc.contractorName}</b>{report.doc.contractorEdrpou ? ` · ЄДРПОУ ${report.doc.contractorEdrpou}` : ''} · Сума: <b>{fmt(report.doc.amount)} грн</b>{report.doc.vat_amount ? ` (у т.ч. ПДВ ${fmt(report.doc.vat_amount)})` : ''}
            </div>
            {report.doc.storage_path && <a onClick={() => openFile(report.doc.storage_path)} style={{ color: 'var(--blue)', cursor: 'pointer', fontSize: 13 }}><i className="ti ti-file" /> Відкрити видаткову</a>}
          </div>

          {/* Товари + джерела */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="card-title" style={{ marginBottom: 10 }}>Товари та джерела закупівлі ({report.items.length})</div>
            {report.items.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>У видатковій немає складських рухів (товар не оприбутковувався/не списувався зі складу).</p>}
            {report.items.map(it => (
              <div key={it.productId} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 600 }}>{it.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>Продано: <b>{fmt(it.soldQty)} {it.unit}</b></div>
                </div>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 6 }}>
                  <thead><tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>Прихідна накладна</th>
                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>Дата</th>
                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>Постачальник</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>К-сть</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>Собівартість</th>
                    <th style={{ padding: '3px 6px' }}></th>
                  </tr></thead>
                  <tbody>
                    {it.sources.map((s, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 6px' }}>{s.docNumber}</td>
                        <td style={{ padding: '5px 6px' }}>{s.docDate ? d(s.docDate) : '—'}</td>
                        <td style={{ padding: '5px 6px' }}>{s.supplierName || '—'}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(s.qty)} {it.unit}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(s.cost)} грн</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>{s.storage_path && <a onClick={() => openFile(s.storage_path)} style={{ color: 'var(--blue)', cursor: 'pointer' }}><i className="ti ti-file" /></a>}</td>
                      </tr>
                    ))}
                    {it.sources.length === 0 && <tr><td colSpan={6} style={{ padding: '5px 6px', color: 'var(--text3)' }}>Джерело не знайдено (немає прихідних рухів).</td></tr>}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 12 }}>
            Джерело кожного товару визначається за FIFO (найраніші закупівлі списуються першими). Архів містить видаткову та всі прихідні накладні зі звіту (з вкладеними сканами).
          </p>
        </>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt } from '../lib/fmt'
import { getDocType, generatedDocBlob, previewPdf, generatePdf } from '../lib/docgen'

// Перегляд згенерованого документа: зліва прев'ю PDF (регенерація в blob), справа — інформація.
// Файлу у сховищі немає — PDF будується з даних generated_docs.
export default function GeneratedDocModal({ doc, onClose, onDeleted, onScanUploaded }) {
  const [gd, setGd] = useState(null)
  const [contractor, setContractor] = useState(null)
  const [items, setItems] = useState([])
  const [blobUrl, setBlobUrl] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | fallback
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  useEffect(() => {
    (async () => {
      try {
        const { data: g } = await supabase.from('generated_docs').select('*').eq('id', doc.generated_doc_id).maybeSingle()
        if (!g) throw new Error('Згенерований документ не знайдено')
        let c = { id: doc.contractor_id, name: doc.contractors?.name }
        if (doc.contractor_id) { const { data } = await supabase.from('contractors').select('*').eq('id', doc.contractor_id).maybeSingle(); if (data) c = data }
        const its = typeof g.items === 'string' ? JSON.parse(g.items || '[]') : (g.items || [])
        setGd(g); setContractor(c); setItems(its)
        try {
          const blob = await generatedDocBlob(g.doc_type, c, its, optsOf(g))
          setBlobUrl(URL.createObjectURL(blob)); setState('ready')
        } catch { setState('fallback') } // getBlob не вдався — покажемо кнопки
      } catch (e) { setErr(e.message); setState('fallback') }
    })()
  }, [doc.generated_doc_id])

  const optsOf = (g) => ({
    docNumber: g.doc_number, docDate: g.doc_date, notes: g.notes,
    contractNum: g.contract_num, contractDate: g.contract_date, paymentDue: g.payment_due, city: g.city,
    invoiceRef: g.invoice_ref, invoiceRefDate: g.invoice_ref_date, deliveryBasis: g.delivery_basis, deliveryAddress: g.delivery_address,
  })

  const openTab = () => gd && previewPdf(gd.doc_type, contractor, items, optsOf(gd)).catch(e => setErr(e.message))
  const download = () => gd && generatePdf(gd.doc_type, contractor, items, optsOf(gd)).catch(e => setErr(e.message))

  // Прикріпити реальний скан/PDF (напр. підписаний) до згенерованого документа → далі як звичайний
  const uploadScan = async (file) => {
    if (!file || !doc.id) return
    setBusy(true); setErr(null)
    try {
      const path = `${Date.now()}_${file.name}`.replace(/[^\w.\-/]/g, '_')
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false })
      if (upErr && !/exists/i.test(upErr.message)) throw upErr
      const upd = { storage_path: path, file_path: path, file_name: file.name, file_type: file.type }
      const { error } = await supabase.from('documents').update(upd).eq('id', doc.id)
      if (error) throw error
      onScanUploaded?.({ ...doc, ...upd })
    } catch (e) { setErr('Не вдалося завантажити скан: ' + e.message); setBusy(false) }
  }

  const deleteDoc = async () => {
    if (!confirm(`Видалити «${label}${gd?.doc_number ? ' №' + gd.doc_number : ''}»?\nЦе прибере і згенерований документ, і його запис у Документах, і пов'язані складські рухи.`)) return
    setBusy(true); setErr(null)
    try {
      const gid = doc.generated_doc_id
      if (doc.id) await supabase.from('stock_movements').delete().eq('document_id', doc.id)
      const { error: dErr } = await supabase.from('documents').delete().eq('generated_doc_id', gid)
      if (dErr) throw dErr
      const { error: gErr } = await supabase.from('generated_docs').delete().eq('id', gid)
      if (gErr) throw gErr
      ;(onDeleted || onClose)()
    } catch (e) {
      const msg = /PERIOD_CLOSED/.test(e.message) ? e.message.replace(/^.*PERIOD_CLOSED:\s*/, '') : e.message
      setErr('Не вдалося видалити: ' + msg); setBusy(false)
    }
  }

  const label = getDocType(doc.type || gd?.doc_type)?.label || doc.type || 'Документ'

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1080, width: '95vw' }}>
        <div className="modal-header"><h2>{label} {gd?.doc_number ? `№${gd.doc_number}` : ''}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Прев'ю */}
          <div style={{ flex: '1 1 420px', minWidth: 300 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Документ</div>
            {state === 'loading' && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}><i className="ti ti-loader-2" style={{ fontSize: 28 }} /><div style={{ marginTop: 8 }}>Формування PDF…</div></div>}
            {state === 'ready' && blobUrl && (
              <>
                <iframe src={blobUrl} title="PDF" style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 8 }} />
                <a href={blobUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--blue)', display: 'inline-block', marginTop: 6 }}>Відкрити в новій вкладці ↗</a>
              </>
            )}
            {state === 'fallback' && (
              <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
                <i className="ti ti-file-text" style={{ fontSize: 32, color: 'var(--text3)' }} />
                <div style={{ fontSize: 13, color: 'var(--text2)', margin: '8px 0 14px' }}>Прев'ю недоступне — відкрийте PDF у вкладці, завантажте, або прикріпіть підписаний скан.</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={openTab}><i className="ti ti-external-link" /> Відкрити</button>
                  <button className="btn" onClick={download}><i className="ti ti-file-download" /> Завантажити</button>
                  <label className="btn" style={{ cursor: busy ? 'wait' : 'pointer' }} title="Прикріпити підписаний скан/PDF — далі як звичайний документ (прев'ю + розпізнавання)">
                    <i className="ti ti-scan" /> {busy ? '…' : 'Завантажити скан'}
                    <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} disabled={busy}
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadScan(f) }} />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Інформація */}
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Інформація</div>
            {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
              <Row k="Тип" v={label} />
              <Row k="Номер" v={gd?.doc_number || doc.doc_number || '—'} />
              <Row k="Дата" v={(gd?.doc_date || doc.doc_date || '').slice(0, 10) || '—'} />
              <Row k="Контрагент" v={contractor?.name || doc.contractors?.name || '—'} />
              <Row k="Сума" v={`${fmt(gd?.total ?? doc.amount ?? 0)} грн`} />
              {(gd?.vat_amount ?? doc.vat_amount) ? <Row k="у т.ч. ПДВ" v={`${fmt(gd?.vat_amount ?? doc.vat_amount)} грн`} /> : null}
            </div>

            {items.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Позиції ({items.length})</div>
                <div className="tbl-wrap" style={{ border: 'none', maxHeight: '32vh', overflow: 'auto' }}>
                  <table>
                    <thead><tr><th>Найменування</th><th style={{ textAlign: 'right' }}>К-сть</th><th style={{ textAlign: 'right' }}>Сума</th></tr></thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 12 }}><div className="trunc" title={it.name}>{it.name}</div></td>
                          <td style={{ textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap' }}>{it.quantity ?? it.qty} {it.unit || 'шт'}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(Number(it.amount) || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn" onClick={openTab}><i className="ti ti-external-link" /> Відкрити у вкладці</button>
              <button className="btn" onClick={download}><i className="ti ti-file-download" /> Завантажити</button>
              <label className="btn" style={{ cursor: busy ? 'wait' : 'pointer' }} title="Прикріпити підписаний скан/PDF — далі як звичайний документ">
                <i className="ti ti-scan" /> Скан
                <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} disabled={busy}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadScan(f) }} />
              </label>
              <button className="btn" onClick={deleteDoc} disabled={busy} style={{ marginLeft: 'auto', color: 'var(--red)' }} title="Видалити документ">
                <i className="ti ti-trash" /> {busy ? '…' : 'Видалити'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const Row = ({ k, v }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
    <span style={{ color: 'var(--text3)' }}>{k}</span>
    <span style={{ fontWeight: 500, textAlign: 'right' }}>{v}</span>
  </div>
)

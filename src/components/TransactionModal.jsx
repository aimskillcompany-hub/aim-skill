import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(n))
const fmt2 = n => n != null ? new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n) : '—'

const DIR_COLORS = {
  'Доходи':   { bg: '#dcfce7', color: '#15803d' },
  'Витрати':  { bg: '#fee2e2', color: '#b91c1c' },
  'ПФД':      { bg: '#dbeafe', color: '#1d4ed8' },
  'Інше':     { bg: '#f3f4f6', color: '#6b7280' },
}

export default function TransactionModal({ txId, tx: initialTx, onClose }) {
  const [tx, setTx] = useState(initialTx || null)
  const [docs, setDocs] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(!initialTx)

  useEffect(() => {
    const id = txId || initialTx?.id
    if (!id) return
    setLoading(true)
    Promise.all([
      // Load full transaction with project
      supabase.from('transactions').select('*, projects(name)').eq('id', id).single(),
      supabase.from('documents').select('*').eq('transaction_id', id),
      supabase.from('transaction_items').select('*').eq('transaction_id', id),
    ]).then(([{ data: txData }, { data: docsData }, { data: itemsData }]) => {
      if (txData) setTx(txData)
      setDocs(docsData || [])
      setItems(itemsData || [])
      setLoading(false)
    })
  }, [txId, initialTx?.id])

  const downloadDoc = async (doc) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const dirStyle = tx ? (DIR_COLORS[tx.direction] || DIR_COLORS['Інше']) : {}

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background:'var(--surface)', borderRadius:12, padding:22, width:'100%', maxWidth:680, maxHeight:'90vh', overflowY:'auto' }}>
        {loading && <div style={{ textAlign:'center', padding:40, color:'var(--text2)' }}>Завантаження...</div>}

        {!loading && tx && <>
          {/* Header */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:600, marginBottom:4 }}>{tx.contractor}</div>
              <span style={{ background: dirStyle.bg, color: dirStyle.color, padding:'2px 10px', borderRadius:4, fontSize:12, fontWeight:500 }}>{tx.direction}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:22, fontWeight:700, color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric:'tabular-nums' }}>
                  {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)} грн
                </div>
                <div style={{ fontSize:12, color:'var(--text3)' }}>{tx.date}</div>
              </div>
              <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'var(--text2)', lineHeight:1, padding:2 }}>×</button>
            </div>
          </div>

          {/* Fields grid */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 20px', marginBottom:18, background:'var(--surface2)', borderRadius:8, padding:'12px 14px' }}>
            {[
              ['ПДВ', fmt(tx.vat_amount) + ' грн'],
              ['Без ПДВ', fmt(tx.amount_no_vat) + ' грн'],
              ['ЄДРПОУ', tx.edrpou],
              ['Тип документу', tx.doc_type],
              ['Номер', tx.doc_number],
              ['Стаття', tx.article],
              ['Проєкт', tx.projects?.name],
              ['Призначення', tx.description],
            ].filter(([, v]) => v).map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:1 }}>{l}</div>
                <div style={{ fontSize:13, fontWeight:500 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Items */}
          {items.length > 0 && (
            <div style={{ marginBottom:18 }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8, display:'flex', alignItems:'center', gap:6, color:'var(--text2)' }}>
                <i className="ti ti-package" style={{ fontSize:15, color:'var(--blue)' }} />
                Позиції з документу ({items.length})
              </div>
              <div style={{ overflowX:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'var(--surface2)' }}>
                      {['Назва', 'К-сть', 'Од.', 'Ціна, грн', 'Сума, грн'].map(h => (
                        <th key={h} style={{ padding:'7px 10px', textAlign: h.includes('грн') || h==='К-сть' ? 'right' : 'left', color:'var(--text2)', fontWeight:500, borderBottom:'1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                        <td style={{ padding:'7px 10px' }}>{it.name}</td>
                        <td style={{ padding:'7px 10px', textAlign:'right' }}>{fmt2(it.quantity)}</td>
                        <td style={{ padding:'7px 10px', color:'var(--text2)' }}>{it.unit || '—'}</td>
                        <td style={{ padding:'7px 10px', textAlign:'right' }}>{fmt2(it.unit_price)}</td>
                        <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:500 }}>{fmt2(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Documents */}
          <div>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8, display:'flex', alignItems:'center', gap:6, color:'var(--text2)' }}>
              <i className="ti ti-paperclip" style={{ fontSize:15, color:'var(--blue)' }} />
              Прикріплені файли ({docs.length})
            </div>
            {docs.length === 0 && (
              <p style={{ fontSize:12, color:'var(--text3)', padding:'8px 0' }}>Немає прикріплених файлів</p>
            )}
            {docs.map(doc => (
              <div key={doc.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                <i className="ti ti-file-text" style={{ fontSize:18, color:'var(--blue)', flexShrink:0 }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.file_name}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>
                    {doc.doc_role === 'incoming' ? 'Вхідний' : 'Вихідний'} · {(doc.file_size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button
                  style={{ background:'none', border:'1px solid var(--border2)', borderRadius:7, padding:'5px 10px', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', gap:4, color:'var(--text)', whiteSpace:'nowrap' }}
                  onClick={() => downloadDoc(doc)}
                >
                  <i className="ti ti-download" style={{ fontSize:13 }} />Завантажити
                </button>
              </div>
            ))}
          </div>
        </>}
      </div>
    </div>
  )
}

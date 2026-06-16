import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { extractDocumentMulti } from '../lib/ai'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'

const DIRECTIONS = ['Витрати', 'Доходи', 'ПФД', 'Внутрішні перекази', 'Відсотки банку', 'Інше']
const fmt = n => n ? new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(n)) : '—'

function buildDocFileName(docType, docNumber, contractor, date, ext) {
  const parts = [
    docType ? docType.charAt(0).toUpperCase() + docType.slice(1) : 'Документ',
    docNumber ? `№${docNumber}` : '',
    contractor ? contractor.replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/gi, 'ТОВ').replace(/ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ/gi, 'ФОП').substring(0, 30) : '',
    date || '',
  ].filter(Boolean).join(' ')
  return `${parts.replace(/[\/\\?%*:|"<>]/g, '').trim().substring(0, 100)}.${ext}`
}

// Check duplicate in DB (by doc_number + edrpou OR edrpou + amount)
async function findDbDuplicate(data) {
  if (!data) return null

  // Правило 1: точний збіг по номеру документу + ЄДРПОУ в bank_transactions
  if (data.docNumber && data.edrpou) {
    const { data: found } = await supabase
      .from('bank_transactions')
      .select('id, date, counterparty, amount, doc_number, doc_type')
      .eq('edrpou', data.edrpou.trim())
      .eq('doc_number', data.docNumber.trim())
      .eq('is_ignored', false)
      .limit(1)
    if (found?.length > 0) return { ...found[0], contractor: found[0].counterparty, rule: 'doc_number+edrpou' }
  }

  // Правило 2: ЄДРПОУ + сума ±10 грн + дата ±5 днів
  if (data.edrpou && data.totalAmount && data.date) {
    const d = new Date(data.date)
    const dMinus = new Date(d); dMinus.setDate(d.getDate() - 5)
    const dPlus  = new Date(d); dPlus.setDate(d.getDate() + 5)
    const toISO  = dt => dt.toISOString().split('T')[0]
    const amt = parseFloat(String(data.totalAmount).replace(/\s/g, '').replace(',', '.'))
    const tolerance = Math.max(10, amt * 0.001)

    const { data: found } = await supabase
      .from('bank_transactions')
      .select('id, date, counterparty, amount, doc_number, doc_type')
      .eq('edrpou', data.edrpou.trim())
      .eq('is_ignored', false)
      .gte('date', toISO(dMinus))
      .lte('date', toISO(dPlus))
      .limit(50)

    const match = (found || []).find(t => Math.abs(Math.abs(t.amount) - amt) <= tolerance)
    if (match) return { ...match, contractor: match.counterparty, rule: 'edrpou+amount+date' }
  }

  return null
}

// Check duplicate within batch
function findBatchDuplicate(card, allCards) {
  return allCards.find(other => {
    if (other.id === card.id) return false
    if (!other.data) return false
    const sameEdrpou = card.data.edrpou && other.data.edrpou &&
      card.data.edrpou.trim() === other.data.edrpou.trim()
    const sameAmt = card.data.totalAmount && other.data.totalAmount &&
      Math.abs(card.data.totalAmount - other.data.totalAmount) <= 10
    const sameDocNum = card.data.docNumber && other.data.docNumber &&
      card.data.docNumber.trim() === other.data.docNumber.trim()
    // Дублікат: однаковий номер документу + ЄДРПОУ або ЄДРПОУ + сума
    return (sameDocNum && sameEdrpou) || (sameEdrpou && sameAmt)
  })
}

export default function BatchUpload({ user, onSaved }) {
  const [cards, setCards] = useState([])
  const [projects, setProjects] = useState([])
  const [articles, setArticles] = useState([])
  const [drag, setDrag] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const fileRef = useRef()

  useEffect(() => {
    supabase.from('projects').select('id,name').eq('status','active').order('name').then(({data}) => setProjects(data||[]))
    fetchArticles().then(setArticles)
  }, [])

  const addFiles = (newFiles) => {
    const arr = Array.from(newFiles).filter(f => {
      const isHeic = /\.(heic|heif)$/i.test(f.name) || ['image/heic','image/heif'].includes(f.type)
      return !isHeic && (f.type.startsWith('image/') || f.type === 'application/pdf')
    })
    if (!arr.length) return
    const newCards = arr.map(f => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      status: 'pending', // pending | extracting | done | error | removed
      data: null,
      error: null,
      isDuplicate: false,
      duplicateOf: null,
      saved: false,
      form: {
        direction: 'Витрати', article: '', projectId: '',
        docRole: 'incoming',
      },
    }))
    setCards(prev => {
      const updated = [...prev, ...newCards]
      return updated
    })
  }

  const removeCard = (id) => setCards(prev => prev.filter(c => c.id !== id))

  const extractCard = async (cardId) => {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, status: 'extracting', error: null } : c))
    const card = cards.find(c => c.id === cardId)
    if (!card) return
    try {
      const data = await extractDocumentMulti([card.file], articles)

      // Find matching bank transaction to link document to
      const bankMatch = await findDbDuplicate(data)

      setCards(prev => {
        const updated = prev.map(c => c.id === cardId ? {
          ...c, status: 'done', data,
          bankMatch: bankMatch || null,
          form: {
            ...c.form,
            direction: data.suggestedDirection || 'Витрати',
            article: data.suggestedArticle || '',
            docRole: data.docRole || 'incoming',
          }
        } : c)
        // Check batch duplicates after extraction
        return updated.map(c => {
          if (!c.data) return c
          const dup = findBatchDuplicate(c, updated)
          return { ...c, isDuplicate: !!dup, duplicateOf: dup?.id || null }
        })
      })
    } catch(e) {
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, status: 'error', error: e.message } : c))
    }
  }

  const extractAll = async () => {
    const pending = cards.filter(c => c.status === 'pending')
    for (const card of pending) {
      await extractCard(card.id)
    }
  }

  const updateCardForm = (id, field, value) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, form: { ...c.form, [field]: value } } : c))
  }

  const saveCard = async (card) => {
    if (!card.data) return
    const d = card.data
    const total = parseFloat(String(d.totalAmount).replace(/\s/g, '').replace(',', '.')) || 0
    const signed = card.form.direction === 'Доходи' ? Math.abs(total) : -Math.abs(total)

    try {
      // Find matching bank_transaction
      const bankDup = await findDbDuplicate(d)
      const bankTxId = bankDup?.id || null

      // If found bank match — update it with article/direction
      if (bankTxId) {
        await supabase.from('bank_transactions').update({
          article: card.form.article || null,
          direction: card.form.direction,
          project_id: card.form.projectId || null,
          doc_type: d.docType || null,
          doc_number: d.docNumber || null,
        }).eq('id', bankTxId)
      }

      // Save to transactions for backward compatibility
      const { data: tx, error: txErr } = await supabase.from('transactions').insert({
        date: d.date || new Date().toISOString().split('T')[0],
        contractor: d.contractor || 'Невідомо',
        edrpou: d.edrpou || null,
        doc_type: d.docType || null,
        doc_number: d.docNumber || null,
        amount: signed,
        vat_amount: parseFloat(String(d.vatAmount || '0').replace(/\s/g, '').replace(',', '.')) || 0,
        amount_no_vat: parseFloat(String(d.amountNoVat || '0').replace(/\s/g, '').replace(',', '.')) || 0,
        direction: card.form.direction,
        article: card.form.article || null,
        project_id: card.form.projectId || null,
        description: d.description || null,
        created_by: user.id,
      }).select().single()

      if (txErr) throw txErr

      // Upload file
      const f = card.file
      const ext = f.name.split('.').pop()?.toLowerCase() || 'jpg'
      const safePath = `${tx.id}/${Date.now()}.${ext}`
      const displayName = buildDocFileName(d.docType, d.docNumber, d.contractor, d.date, ext)
      const { error: uploadErr } = await supabase.storage.from('documents').upload(safePath, f, { contentType: f.type })
      if (!uploadErr) {
        await supabase.from('documents').insert({
          transaction_id: tx.id,
          bank_transaction_id: bankTxId,
          file_name: displayName,
          file_path: safePath,
          file_type: f.type,
          file_size: f.size,
          doc_role: card.form.docRole,
          uploaded_by: user.id,
        })
      }

      // Save items (позиції документу — потрібні для складу)
      if (d.items?.length > 0) {
        const validItems = d.items.filter(it => it.name)
        if (validItems.length > 0) {
          const { error: itemsErr } = await supabase.from('transaction_items').insert(
            validItems.map(it => ({
              transaction_id: tx.id,
              bank_transaction_id: bankTxId,
              name: it.name,
              quantity: parseFloat(it.quantity) || null,
              unit: it.unit || null,
              unit_price: parseFloat(it.unitPrice) || null,
              amount: parseFloat(it.amount) || 0,
              vat_rate: parseFloat(it.vatRate) || 20,
            }))
          )
          if (itemsErr) console.error('Items save error:', itemsErr)
        }
      }

      setCards(prev => prev.map(c => c.id === card.id ? { ...c, saved: true } : c))
      return true
    } catch(e) {
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, error: e.message } : c))
      return false
    }
  }

  const saveAll = async () => {
    setSavingAll(true)
    setSavedCount(0)
    const toSave = cards.filter(c => c.status === 'done' && !c.saved && !c.isDuplicate && true)
    let count = 0
    for (const card of toSave) {
      const ok = await saveCard(card)
      if (ok) { count++; setSavedCount(count) }
    }
    setSavingAll(false)
    onSaved?.(`✓ Збережено ${count} з ${toSave.length} документів`)
  }

  const pendingCount = cards.filter(c => c.status === 'pending').length
  const doneCount = cards.filter(c => c.status === 'done').length
  const dupCount = cards.filter(c => c.isDuplicate).length
  const linkedCount = cards.filter(c => c.bankMatch).length
  const savedCards = cards.filter(c => c.saved).length
  const readyToSave = cards.filter(c => c.status === 'done' && !c.saved && !c.isDuplicate).length

  return (
    <div>
      <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <h1>Масове завантаження</h1>
          <p>Завантажте до 20 файлів — система розпізнає їх і знайде дублікати</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {pendingCount > 0 && (
            <button className="btn btn-secondary" onClick={extractAll} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <i className="ti ti-sparkles" style={{ fontSize:15 }} />
              Розпізнати всі ({pendingCount})
            </button>
          )}
          {readyToSave > 0 && (
            <button className="btn btn-primary" onClick={saveAll} disabled={savingAll} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <i className="ti ti-device-floppy" style={{ fontSize:15 }} />
              {savingAll ? `Зберігаємо... ${savedCount}/${readyToSave}` : `Зберегти всі (${readyToSave})`}
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {cards.length > 0 && (
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          <span style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', fontSize:12 }}>
            Всього: {cards.length}
          </span>
          {pendingCount > 0 && <span style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', fontSize:12, color:'var(--text2)' }}>Очікують: {pendingCount}</span>}
          {doneCount > 0 && <span style={{ background:'var(--green-bg)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', fontSize:12, color:'var(--green)' }}>Розпізнано: {doneCount}</span>}
          {dupCount > 0 && <span style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', fontSize:12, color:'var(--text2)' }}>⚠ Дублікати в пакеті: {dupCount}</span>}
          {linkedCount > 0 && <span style={{ background:'var(--green-bg)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', fontSize:12, color:'var(--green)' }}>🔗 Привʼязано до операцій: {linkedCount}</span>}
          {savedCards > 0 && <span style={{ background:'var(--blue-bg)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', fontSize:12, color:'var(--blue)' }}>✓ Збережено: {savedCards}</span>}
        </div>
      )}

      {/* Drop zone */}
      <div
        style={{
          border: `2px dashed ${drag ? 'var(--blue)' : 'var(--border2)'}`,
          borderRadius: 12, padding: cards.length > 0 ? '20px 24px' : '48px 24px',
          textAlign: 'center', cursor: 'pointer', transition: 'all .15s',
          background: drag ? 'var(--blue-bg)' : 'var(--surface2)',
          marginBottom: 16,
        }}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current.click()}
      >
        <i className="ti ti-cloud-upload" style={{ fontSize: cards.length > 0 ? 24 : 40, color: drag ? 'var(--blue)' : 'var(--text3)', display:'block', margin:'0 auto 8px' }} />
        <div style={{ fontWeight:600, fontSize: cards.length > 0 ? 13 : 15, color:'var(--text)' }}>
          {cards.length > 0 ? 'Додати ще файли' : 'Перетягніть файли або натисніть для вибору'}
        </div>
        {cards.length === 0 && <div style={{ fontSize:12, color:'var(--text2)', marginTop:4 }}>PDF, JPG, PNG, WebP · до 20 файлів одночасно</div>}
        <input ref={fileRef} type="file" accept=".pdf,image/*" multiple style={{ display:'none' }} onChange={e => addFiles(e.target.files)} />
      </div>

      {/* Cards grid */}
      {cards.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:12 }}>
          {cards.map(card => (
            <div key={card.id} style={{
              background: card.saved ? 'var(--green-bg)' : card.isDuplicate ? 'var(--surface2)' : 'var(--surface)',
              border: '1.5px solid var(--border)',
              borderRadius: 12,
              padding: 14,
              position: 'relative',
            }}>
              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <i className={`ti ${card.file.type === 'application/pdf' ? 'ti-file-type-pdf' : 'ti-photo'}`}
                   style={{ fontSize:20, color: card.saved ? 'var(--green)' : card.isDuplicate ? 'var(--amber)' : 'var(--blue)', flexShrink:0 }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{card.file.name}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{(card.file.size/1024).toFixed(0)} KB</div>
                </div>
                {!card.saved && (
                  <button onClick={() => removeCard(card.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:18, padding:'0 2px' }}>×</button>
                )}
              </div>

              {/* Status badges */}
              {card.saved && (
                <div style={{ background:'var(--green-bg)', color:'var(--green)', borderRadius:6, padding:'4px 10px', fontSize:12, fontWeight:500, marginBottom:8, display:'flex', alignItems:'center', gap:4 }}>
                  <i className="ti ti-check" style={{ fontSize:13 }} /> Збережено
                </div>
              )}
              {card.bankMatch && !card.saved && (
                <div style={{ background:'var(--green-bg)', color:'var(--green)', borderRadius:6, padding:'8px 10px', fontSize:12, fontWeight:500, marginBottom:8 }}>
                  🔗 Буде привʼязано до банківської операції
                  <div style={{ fontWeight:400, marginTop:3, fontSize:11, lineHeight:1.4, color:'var(--text2)' }}>
                    {card.bankMatch.date} · {card.bankMatch.contractor?.substring(0,30)}
                    {card.bankMatch.doc_number && ` · №${card.bankMatch.doc_number}`}
                    · {new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(card.bankMatch.amount)))} грн
                  </div>
                </div>
              )}
              {card.isDuplicate && !card.saved && (
                <div style={{ background:'var(--surface2)', color:'var(--text2)', borderRadius:6, padding:'6px 10px', fontSize:12, fontWeight:500, marginBottom:8 }}>
                  ⚠ Можливий дублікат іншого файлу в цьому пакеті
                  <div style={{ fontWeight:400, marginTop:2 }}>Перевірте і видаліть зайвий</div>
                </div>
              )}
              {card.status === 'error' && (
                <div style={{ background:'var(--red-bg)', color:'var(--red)', borderRadius:6, padding:'4px 10px', fontSize:12, marginBottom:8 }}>
                  ✗ {card.error}
                </div>
              )}

              {/* Extracting */}
              {card.status === 'extracting' && (
                <div style={{ textAlign:'center', padding:'12px 0', color:'var(--text2)', fontSize:13 }}>
                  <div className="spinner" style={{ margin:'0 auto 8px' }} />
                  Розпізнаємо...
                </div>
              )}

              {/* Pending */}
              {card.status === 'pending' && (
                <button className="btn btn-secondary" onClick={() => extractCard(card.id)} style={{ width:'100%', justifyContent:'center', display:'flex', gap:6 }}>
                  <i className="ti ti-sparkles" style={{ fontSize:14 }} /> Розпізнати
                </button>
              )}

              {/* Done — show extracted data + mini form */}
              {card.status === 'done' && card.data && !card.saved && (
                <>
                  <div style={{ fontSize:12, marginBottom:8 }}>
                    <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{card.data.contractor || '—'}</div>
                    <div style={{ display:'flex', gap:10, color:'var(--text2)', flexWrap:'wrap' }}>
                      {card.data.date && <span>{card.data.date}</span>}
                      {card.data.totalAmount && <span style={{ fontWeight:500, color: card.form.direction==='Доходи'?'var(--green)':'var(--red)' }}>{fmt(card.data.totalAmount)} грн</span>}
                      {card.data.docType && <span style={{ background:'var(--surface2)', padding:'1px 6px', borderRadius:6 }}>{card.data.docType}</span>}
                      {card.data.docNumber && <span>№{card.data.docNumber}</span>}
                    </div>
                    {card.data.edrpou && <div style={{ color:'var(--text3)', fontSize:11, marginTop:2 }}>ЄДРПОУ: {card.data.edrpou}</div>}
                  </div>

                  {/* Mini form */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:2 }}>Напрям</div>
                      <select className="form-input" style={{ fontSize:12, padding:'5px 8px' }}
                        value={card.form.direction}
                        onChange={e => updateCardForm(card.id, 'direction', e.target.value)}>
                        {DIRECTIONS.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:2 }}>Стаття</div>
                      <select className="form-input" style={{ fontSize:12, padding:'5px 8px' }}
                        value={card.form.article}
                        onChange={e => updateCardForm(card.id, 'article', e.target.value)}>
                        <option value="">— оберіть —</option>
                        {Object.entries(groupByType(articles)).map(([type, items]) =>
                          items.length > 0 ? (
                            <optgroup key={type} label={TYPE_LABELS[type]}>
                              {items.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                            </optgroup>
                          ) : null
                        )}
                      </select>
                    </div>
                    <div style={{ gridColumn:'1/-1' }}>
                      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:2 }}>Проєкт</div>
                      <select className="form-input" style={{ fontSize:12, padding:'5px 8px' }}
                        value={card.form.projectId}
                        onChange={e => updateCardForm(card.id, 'projectId', e.target.value)}>
                        <option value="">— без проєкту —</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {!card.bankMatch && (
                    <button
                      className="btn btn-primary"
                      style={{ width:'100%', justifyContent:'center', display:'flex', gap:6, fontSize:13 }}
                      onClick={() => saveCard(card)}
                    >
                      <i className="ti ti-device-floppy" style={{ fontSize:14 }} />
                      Зберегти
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {cards.length === 0 && (
        <div style={{ textAlign:'center', padding:'40px 24px', color:'var(--text3)' }}>
          <i className="ti ti-files" style={{ fontSize:48, display:'block', margin:'0 auto 12px', opacity:.3 }} />
          <div style={{ fontSize:14, fontWeight:500, marginBottom:6 }}>Завантажте файли для масової обробки</div>
          <div style={{ fontSize:12 }}>Система розпізнає всі документи, знайде дублікати і дозволить зберегти одним кліком</div>
        </div>
      )}
    </div>
  )
}

import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { extractDocumentMulti } from '../lib/ai'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import { processDocumentItems, matchProduct } from '../lib/stockService'
import { upsertContractor } from '../lib/contractors'
import DocCard from './upload/DocCard'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))

function buildDocFileName(docType, docNumber, contractor, date, ext) {
  const parts = [
    docType ? docType.charAt(0).toUpperCase() + docType.slice(1) : 'Документ',
    docNumber ? `№${docNumber}` : '',
    contractor ? contractor.replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/gi, 'ТОВ').replace(/ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ/gi, 'ФОП').substring(0, 30) : '',
    date || '',
  ].filter(Boolean).join(' ')
  return `${parts.replace(/[\/\\?%*:|"<>]/g, '').trim().substring(0, 100)}.${ext}`
}

async function findDbDuplicate(data) {
  if (!data?.edrpou?.trim() || !data?.totalAmount) return null
  const amt = parseFloat(String(data.totalAmount).replace(/\s/g, '').replace(',', '.'))
  const tolerance = Math.max(10, amt * 0.001)
  const { data: found } = await supabase.from('bank_transactions')
    .select('id, date, counterparty, amount, edrpou').eq('edrpou', data.edrpou.trim()).eq('is_ignored', false)
    .order('date', { ascending: false }).limit(50)
  return (found || []).find(t => Math.abs(Math.abs(t.amount) - amt) <= tolerance) || null
}

function findBatchDuplicate(card, allCards) {
  return allCards.find(other => {
    if (other.id === card.id || !other.data) return false
    const sameEdrpou = card.data.edrpou && other.data.edrpou && card.data.edrpou.trim() === other.data.edrpou.trim()
    const sameAmt = card.data.totalAmount && other.data.totalAmount && Math.abs(card.data.totalAmount - other.data.totalAmount) <= 10
    const sameDocNum = card.data.docNumber && other.data.docNumber && card.data.docNumber.trim() === other.data.docNumber.trim()
    return (sameDocNum && sameEdrpou) || (sameEdrpou && sameAmt)
  })
}

export default function DocumentUpload({ user, onSaved }) {
  const [cards, setCards] = useState([])
  const [projects, setProjects] = useState([])
  const [articles, setArticles] = useState([])
  const [drag, setDrag] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  const fileRef = useRef()
  const cameraRef = useRef()

  // Bank link modal
  const [linkCardId, setLinkCardId] = useState(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState([])
  const [linkSearching, setLinkSearching] = useState(false)

  useEffect(() => {
    supabase.from('projects').select('id,name').eq('status', 'active').order('name').then(({ data }) => setProjects(data || []))
    fetchArticles().then(setArticles)
  }, [])

  // ── Додати файли ──
  const addFiles = (newFiles) => {
    const arr = Array.from(newFiles).filter(f => {
      const isHeic = /\.(heic|heif)$/i.test(f.name) || ['image/heic', 'image/heif'].includes(f.type)
      return !isHeic && (f.type.startsWith('image/') || f.type === 'application/pdf')
    })
    if (!arr.length) return
    const newCards = arr.map(f => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f, status: 'pending', data: null, error: null,
      isDuplicate: false, bankMatch: null, saved: false, savedDocId: null,
      form: { date: '', contractor: '', edrpou: '', docType: '', docNumber: '', total: '', vat: '', noVat: '',
        direction: 'Витрати', article: '', projectId: '', description: '', docRole: 'incoming', items: [] },
    }))
    setCards(prev => [...prev, ...newCards])
    // Авто-розгорнути якщо один файл
    if (newCards.length === 1) setExpandedId(newCards[0].id)
  }

  // ── AI розпізнавання ──
  const extractCard = async (cardId) => {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, status: 'extracting', error: null } : c))
    const card = cards.find(c => c.id === cardId)
    if (!card) return
    try {
      const data = await extractDocumentMulti([card.file], articles)
      const bankMatch = await findDbDuplicate(data)

      // Match products
      const items = data.items || []
      for (let i = 0; i < items.length; i++) {
        if (!items[i].name) continue
        const match = await matchProduct(items[i].name)
        items[i]._match = match
        items[i]._action = match.matchType !== 'none' ? 'auto' : 'new'
        items[i]._matchedProductId = match.productId || null
        items[i].id = i
      }

      setCards(prev => {
        const updated = prev.map(c => c.id === cardId ? {
          ...c, status: 'done', data: { ...data, items }, bankMatch: bankMatch || null,
          form: {
            date: data.date || '', contractor: data.contractor || '', edrpou: data.edrpou || '',
            docType: data.docType || '', docNumber: data.docNumber || '',
            total: data.totalAmount?.toString() || '', vat: data.vatAmount?.toString() || '',
            noVat: data.amountNoVat?.toString() || '',
            direction: data.suggestedDirection || 'Витрати', article: data.suggestedArticle || '',
            description: data.description || '', docRole: data.docRole || 'incoming',
            projectId: '', items,
          },
        } : c)
        return updated.map(c => {
          if (!c.data) return c
          const dup = findBatchDuplicate(c, updated)
          return { ...c, isDuplicate: !!dup }
        })
      })
    } catch (e) {
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, status: 'error', error: e.message } : c))
    }
  }

  const extractAll = async () => {
    const pending = cards.filter(c => c.status === 'pending')
    for (const card of pending) await extractCard(card.id)
  }

  // ── Оновлення форми ──
  const updateCardForm = (cardId, field, value) => {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, form: { ...c.form, [field]: value } } : c))
  }
  const updateCardItem = (cardId, idx, field, value) => {
    setCards(prev => prev.map(c => {
      if (c.id !== cardId) return c
      const items = [...c.form.items]
      items[idx] = { ...items[idx], [field]: value }
      if (field === '_action' && value === 'new') items[idx]._matchedProductId = null
      return { ...c, form: { ...c.form, items } }
    }))
  }

  // ── Збереження ──
  const saveCard = async (card) => {
    if (!card.data) return false
    const d = card.data
    const f = card.form
    const total = parseFloat(String(f.total || d.totalAmount || '0').replace(/\s/g, '').replace(',', '.')) || 0

    try {
      // Contractor
      let contractorId = null
      if (f.contractor) {
        contractorId = await upsertContractor(supabase, { name: f.contractor, edrpou: f.edrpou, default_direction: f.direction, userId: user.id })
      }

      // Bank match
      const bankTxId = card.bankMatch?.id || null
      if (bankTxId) {
        await supabase.from('bank_transactions').update({
          article: f.article || null, direction: f.direction,
          project_id: f.projectId || null, doc_type: f.docType || null,
          doc_number: f.docNumber || null, contractor_id: contractorId,
        }).eq('id', bankTxId)
      }

      const docFolder = bankTxId || crypto.randomUUID()

      // Upload file
      const ext = card.file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const safePath = `${docFolder}/${Date.now()}.${ext}`
      const displayName = buildDocFileName(f.docType || d.docType, f.docNumber || d.docNumber, f.contractor || d.contractor, f.date || d.date, ext)
      const { error: uploadErr } = await supabase.storage.from('documents').upload(safePath, card.file, { contentType: card.file.type })
      let savedDocId = null
      if (!uploadErr) {
        const { data: docData } = await supabase.from('documents').insert({
          bank_transaction_id: bankTxId, file_name: displayName,
          file_path: safePath, file_type: card.file.type, file_size: card.file.size,
          doc_role: f.docRole, uploaded_by: user.id,
        }).select('id').single()
        savedDocId = docData?.id
      }

      // Items
      const validItems = (f.items || []).filter(it => it.name)
      if (validItems.length > 0 && bankTxId) {
        // Перевірити дублікати
        const { data: existing } = await supabase.from('transaction_items')
          .select('name').eq('bank_transaction_id', bankTxId)
        const existingNames = new Set((existing || []).map(e => e.name?.toLowerCase()))
        const newItems = validItems.filter(it => !existingNames.has(it.name?.toLowerCase()))

        if (newItems.length > 0) {
          const { data: savedItems } = await supabase.from('transaction_items').insert(
            newItems.map(it => ({
              bank_transaction_id: bankTxId, name: it.name,
              quantity: parseFloat(it.quantity) || null, unit: it.unit || null,
              unit_price: parseFloat(it.unitPrice) || null,
              amount: parseFloat(it.amount) || 0, vat_rate: parseFloat(it.vatRate) || 20,
            }))
          ).select('id, name, quantity, unit, unit_price, amount')

          if (savedItems?.length) {
            const enriched = savedItems.map((si, idx) => {
              const src = newItems[idx]
              return { ...si, _matchedProductId: src?._matchedProductId || null, _action: src?._action || 'auto' }
            })
            await processDocumentItems(enriched, {
              docType: f.docType || d.docType, docRole: f.docRole,
              bankTransactionId: bankTxId, date: f.date || d.date, userId: user.id,
            })
          }
        }
      }

      setCards(prev => prev.map(c => c.id === card.id ? { ...c, saved: true, savedDocId } : c))
      return true
    } catch (e) {
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, error: e.message } : c))
      return false
    }
  }

  const saveAll = async () => {
    setSavingAll(true); setSavedCount(0)
    const toSave = cards.filter(c => c.status === 'done' && !c.saved && !c.isDuplicate)
    let count = 0
    for (const card of toSave) {
      const ok = await saveCard(card)
      if (ok) { count++; setSavedCount(count) }
    }
    setSavingAll(false)
    onSaved?.(`✓ Збережено ${count} з ${toSave.length} документів`)
  }

  // ── Пошук банківської операції ──
  const searchBankTx = async (query) => {
    if (!query || query.length < 2) { setLinkResults([]); return }
    setLinkSearching(true)
    try {
      const isNumber = /^[\d\s,.]+$/.test(query.trim())
      let results = []
      if (isNumber) {
        const searchAmt = parseFloat(query.replace(/\s/g, '').replace(',', '.')) || 0
        if (searchAmt > 0) {
          const tolerance = Math.max(10, searchAmt * 0.01)
          const { data } = await supabase.from('bank_transactions')
            .select('id, date, counterparty, amount, edrpou').eq('is_ignored', false).order('date', { ascending: false }).limit(500)
          results = (data || []).filter(b => Math.abs(Math.abs(b.amount) - searchAmt) <= tolerance)
        }
      } else {
        const { data: byCp } = await supabase.from('bank_transactions')
          .select('id, date, counterparty, amount, edrpou').ilike('counterparty', `%${query.trim()}%`)
          .eq('is_ignored', false).order('date', { ascending: false }).limit(30)
        const { data: byCode } = await supabase.from('bank_transactions')
          .select('id, date, counterparty, amount, edrpou').ilike('edrpou', `%${query.trim()}%`)
          .eq('is_ignored', false).order('date', { ascending: false }).limit(30)
        const seen = new Set()
        results = [...(byCp || []), ...(byCode || [])].filter(b => { if (seen.has(b.id)) return false; seen.add(b.id); return true })
      }
      setLinkResults(results.slice(0, 15))
    } catch (e) { console.error(e) }
    setLinkSearching(false)
  }

  const linkToBankTx = (cardId, bankTx) => {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, bankMatch: bankTx } : c))
    setLinkCardId(null); setLinkSearch(''); setLinkResults([])
  }

  // ── Stats ──
  const pendingCount = cards.filter(c => c.status === 'pending').length
  const doneCount = cards.filter(c => c.status === 'done').length
  const savedCards = cards.filter(c => c.saved).length
  const readyToSave = cards.filter(c => c.status === 'done' && !c.saved && !c.isDuplicate).length

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Завантаження документів</h1>
          <p>Завантажте один або кілька файлів — система розпізнає і збереже</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {pendingCount > 0 && (
            <button className="btn btn-secondary" onClick={extractAll} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ti ti-sparkles" style={{ fontSize: 15 }} /> Розпізнати всі ({pendingCount})
            </button>
          )}
          {readyToSave > 0 && (
            <button className="btn btn-primary" onClick={saveAll} disabled={savingAll} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ti ti-device-floppy" style={{ fontSize: 15 }} />
              {savingAll ? `Зберігаємо... ${savedCount}/${readyToSave}` : `Зберегти всі (${readyToSave})`}
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {cards.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>Всього: {cards.length}</span>
          {pendingCount > 0 && <span style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: 'var(--text2)' }}>Очікують: {pendingCount}</span>}
          {doneCount > 0 && <span style={{ background: 'var(--green-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: 'var(--green)' }}>Розпізнано: {doneCount}</span>}
          {savedCards > 0 && <span style={{ background: 'var(--blue-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: 'var(--blue)' }}>Збережено: {savedCards}</span>}
        </div>
      )}

      {/* Drop zone */}
      <div
        style={{
          border: `2px dashed ${drag ? 'var(--blue)' : 'var(--border2)'}`,
          borderRadius: 12, padding: cards.length > 0 ? '20px 24px' : '48px 24px',
          textAlign: 'center', cursor: 'pointer', transition: 'all .15s',
          background: drag ? 'var(--blue-bg)' : 'var(--surface2)', marginBottom: 16,
        }}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current.click()}
      >
        <i className="ti ti-cloud-upload" style={{ fontSize: cards.length > 0 ? 24 : 40, color: drag ? 'var(--blue)' : 'var(--text3)', display: 'block', margin: '0 auto 8px' }} />
        <div style={{ fontWeight: 600, fontSize: cards.length > 0 ? 13 : 15, color: 'var(--text)' }}>
          {cards.length > 0 ? 'Додати ще файли' : 'Перетягніть файли або натисніть для вибору'}
        </div>
        {cards.length === 0 && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>PDF, JPG, PNG, WebP · від 1 до 20 файлів</div>}
        <input ref={fileRef} type="file" accept=".pdf,image/*" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) addFiles(e.target.files) }} />
      </div>

      {/* Camera button */}
      {cards.length === 0 && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <button className="btn btn-secondary" onClick={() => cameraRef.current.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <i className="ti ti-camera" style={{ fontSize: 16 }} /> Зробити фото
          </button>
        </div>
      )}

      {/* Cards grid */}
      {cards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: expandedId ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {cards.map(card => (
            <DocCard
              key={card.id}
              card={card}
              articles={articles}
              projects={projects}
              groupByType={groupByType}
              TYPE_LABELS={TYPE_LABELS}
              expanded={expandedId === card.id}
              onToggleExpand={() => setExpandedId(expandedId === card.id ? null : card.id)}
              onRemove={() => setCards(prev => prev.filter(c => c.id !== card.id))}
              onSave={() => saveCard(card)}
              onUpdateForm={(field, value) => updateCardForm(card.id, field, value)}
              onUpdateItem={(idx, field, value) => updateCardItem(card.id, idx, field, value)}
              onContractorSelect={c => {
                if (c._new) return
                if (c.default_direction) updateCardForm(card.id, 'direction', c.default_direction)
                if (c.default_article) updateCardForm(card.id, 'article', c.default_article)
              }}
              onLinkBank={() => { setLinkCardId(card.id); setLinkSearch(card.data?.totalAmount ? String(Math.abs(card.data.totalAmount)) : '') }}
              saving={savingAll}
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {cards.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text3)' }}>
          <i className="ti ti-files" style={{ fontSize: 48, display: 'block', margin: '0 auto 12px', opacity: .3 }} />
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Завантажте файли для обробки</div>
          <div style={{ fontSize: 12 }}>Один файл або пакет до 20 — система розпізнає, знайде дублікати і дозволить зберегти</div>
        </div>
      )}

      {/* Bank link modal */}
      {linkCardId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) { setLinkCardId(null); setLinkResults([]) } }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Привʼязати до банківської операції</div>
              <button onClick={() => { setLinkCardId(null); setLinkResults([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text3)' }}>×</button>
            </div>
            <div style={{ padding: '12px 20px' }}>
              <input className="form-input" placeholder="Введіть суму, ЄДРПОУ або контрагента..."
                value={linkSearch} onChange={e => {
                  setLinkSearch(e.target.value)
                  clearTimeout(window._docLinkTimer)
                  window._docLinkTimer = setTimeout(() => searchBankTx(e.target.value), 400)
                }} autoFocus />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
              {linkSearching && <div style={{ fontSize: 12, color: 'var(--text3)', padding: 8 }}>Пошук...</div>}
              {linkResults.map(b => (
                <div key={b.id} onClick={() => linkToBankTx(linkCardId, b)}
                  style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 8, marginBottom: 2 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{b.counterparty || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{b.date}{b.edrpou ? ` · ЄДРПОУ ${b.edrpou}` : ''}</div>
                  </div>
                  <div style={{ fontWeight: 600, color: b.amount > 0 ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                    {b.amount > 0 ? '+' : ''}{fmt(b.amount)} грн
                  </div>
                </div>
              ))}
              {linkSearch.length >= 2 && !linkSearching && linkResults.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text3)', padding: '12px 4px', textAlign: 'center' }}>Нічого не знайдено</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

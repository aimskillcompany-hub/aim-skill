import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { extractDocumentMulti } from '../lib/ai'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import ContractorSelect from './ui/ContractorSelect'
import { upsertContractor } from '../lib/contractors'
import { processDocumentItems, matchProduct } from '../lib/stockService'

const DIRECTIONS = ['Витрати', 'Доходи', 'ПФД', 'Внутрішні перекази', 'Відсотки банку', 'Інше']

const DOC_ROLES = ['incoming', 'outgoing']
const DOC_ROLE_LABELS = { incoming: 'Вхідний (від постачальника)', outgoing: 'Вихідний (від нас)' }

function buildDocFileName(docType, docNumber, contractor, date, ext) {
  const parts = [
    docType ? docType.charAt(0).toUpperCase() + docType.slice(1) : 'Документ',
    docNumber ? `№${docNumber}` : '',
    contractor ? contractor.replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/gi, 'ТОВ').replace(/ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ/gi, 'ФОП').replace(/АКЦІОНЕРНЕ ТОВАРИСТВО/gi, 'АТ').substring(0, 35) : '',
    date || '',
  ].filter(Boolean).join(' ')
  const safe = parts.replace(/[\/\\?%*:|"<>{}[\]]/g, '').replace(/\s+/g, ' ').trim().substring(0, 120)
  return `${safe}.${ext}`
}
const fmt = n => n ? new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n) : '—'

export default function AddDocument({ user, onSaved }) {
  const [step, setStep] = useState('upload') // upload | extracting | form
  const [files, setFiles] = useState([])   // multiple pages support
  const [file, setFile] = useState(null)    // keep for compatibility
  const [extracted, setExtracted] = useState(null)
  const [projects, setProjects] = useState([])
  const [articles, setArticles] = useState([])
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()
  const cameraRef = useRef()

  const [form, setForm] = useState({
    date: '', contractor: '', edrpou: '', docType: '', docNumber: '',
    total: '', vat: '', noVat: '', direction: 'Витрати',
    article: '', projectId: '', description: '',
    docRole: 'incoming', items: [],
  })
  const [contractorId, setContractorId] = useState(null)

  useEffect(() => {
    supabase.from('projects').select('id, name').eq('status', 'active').order('name')
      .then(({ data }) => setProjects(data || []))
    fetchArticles().then(data => {
      setArticles(data)
    })
  }, [])

  const handleFile = async (f) => {
    if (!f) return
    setFiles([f])
    setFile(f)
    await processFiles([f])
  }

  const handleFilesAdded = (newFiles) => {
    const all = Array.from(newFiles)
    const heic = all.filter(f => /\.(heic|heif)$/i.test(f.name) || ['image/heic','image/heif'].includes(f.type))
    if (heic.length > 0) {
      setError('Формат HEIC не підтримується. Будь ласка, сфотографуйте через кнопку "Камера" або конвертуйте фото в JPG/PNG перед завантаженням.')
      return
    }
    const arr = all.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (!arr.length) return
    setError(null)
    setFiles(prev => [...prev, ...arr])
    if (!file) setFile(arr[0])
  }

  const removeFile = (idx) => {
    setFiles(prev => {
      const next = prev.filter((_, i) => i !== idx)
      if (next.length === 0) { setFile(null); setStep('upload') }
      else setFile(next[0])
      return next
    })
  }

  const processFiles = async (filesToProcess) => {
    setError(null)
    setStep('extracting')
    try {
      const d = await extractDocumentMulti(filesToProcess, articles)
      setExtracted(d)
      setForm(prev => ({
        ...prev,
        date: d.date || '',
        contractor: d.contractor || '',
        edrpou: d.edrpou || '',
        docType: d.docType || '',
        docNumber: d.docNumber || '',
        total: d.totalAmount?.toString() || '',
        vat: d.vatAmount?.toString() || '',
        noVat: d.amountNoVat?.toString() || '',
        direction: d.suggestedDirection || 'Витрати',
        article: d.suggestedArticle || '',
        description: d.description || '',
        docRole: d.docRole || 'incoming',
        items: (d.items || []).map((it, i) => ({ ...it, id: i, _match: null, _action: 'auto' })),
      }))
      // Знайти кандидатів для кожного item
      const items = d.items || []
      for (let i = 0; i < items.length; i++) {
        if (!items[i].name) continue
        const match = await matchProduct(items[i].name)
        setForm(prev => ({
          ...prev,
          items: prev.items.map((it, j) => j === i ? {
            ...it,
            _match: match,
            _action: match.matchType === 'exact' ? 'auto' : match.matchType === 'fuzzy' ? 'auto' : 'new',
            _matchedProductId: match.productId || null,
          } : it),
        }))
      }
      setStep('form')
    } catch (e) {
      setError('Помилка розпізнавання: ' + e.message)
      setStep('upload')
    }
  }

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const [duplicate, setDuplicate] = useState(null)   // potential duplicate found
  const [bankMatch, setBankMatch] = useState(null)    // matched bank transaction
  const [similarTxs, setSimilarTxs] = useState([])   // similar transactions to attach doc to
  const [attachMode, setAttachMode] = useState(false) // show attach UI instead of save
  const [manualLinkMode, setManualLinkMode] = useState(false)
  const [manualSearch, setManualSearch] = useState('')
  const [manualResults, setManualResults] = useState([])
  const [manualSearching, setManualSearching] = useState(false)

  const searchBankTx = async (query) => {
    if (!query || query.length < 2) { setManualResults([]); return }
    setManualSearching(true)
    try {
      // Пошук по сумі, контрагенту або ЄДРПОУ
      const isNumber = /^[\d\s,.]+$/.test(query.trim())
      let results = []

      if (isNumber) {
        const searchAmt = parseFloat(query.replace(/\s/g, '').replace(',', '.')) || 0
        if (searchAmt > 0) {
          const tolerance = Math.max(10, searchAmt * 0.01)
          const { data } = await supabase.from('bank_transactions')
            .select('id, date, counterparty, amount, edrpou, iban')
            .eq('is_ignored', false)
            .order('date', { ascending: false }).limit(500)
          results = (data || []).filter(b => Math.abs(Math.abs(b.amount) - searchAmt) <= tolerance)
        }
      } else {
        const { data: byCp } = await supabase.from('bank_transactions')
          .select('id, date, counterparty, amount, edrpou, iban')
          .ilike('counterparty', `%${query.trim()}%`)
          .eq('is_ignored', false)
          .order('date', { ascending: false }).limit(50)

        const { data: byCode } = await supabase.from('bank_transactions')
          .select('id, date, counterparty, amount, edrpou, iban')
          .ilike('edrpou', `%${query.trim()}%`)
          .eq('is_ignored', false)
          .order('date', { ascending: false }).limit(50)

        const seen = new Set()
        results = [...(byCp || []), ...(byCode || [])].filter(b => {
          if (seen.has(b.id)) return false
          seen.add(b.id)
          return true
        })
      }
      setManualResults(results.slice(0, 20))
    } catch (e) {
      console.error('Manual search error:', e)
    }
    setManualSearching(false)
  }

  const handleSave = async (forceSave = false) => {
    if (saving) return // захист від подвійного натискання
    if (!form.date || !form.contractor || !form.total) {
      setError('Заповніть: Дата, Контрагент, Сума')
      return
    }
    setSaving(true)
    setError(null)

    try {
      const total = parseFloat(String(form.total).replace(/\s/g, '').replace(',', '.')) || 0
      const signed = form.direction === 'Доходи' ? Math.abs(total) : -Math.abs(total)

      // ── Пошук банківської операції для прикріплення документа ─────────
      let finalContractorId = contractorId
      if (!finalContractorId && form.contractor) {
        finalContractorId = await upsertContractor(supabase, { name: form.contractor, edrpou: form.edrpou, default_direction: form.direction, userId: user.id })
      }

      // Шукаємо банківську операцію для прикріплення документа
      const absAmt = Math.abs(total)
      const toDate = dt => new Date(dt).toISOString().split('T')[0]
      const d = new Date(form.date)
      const dMinus = new Date(d); dMinus.setDate(d.getDate() - 30)
      const dPlus = new Date(d); dPlus.setDate(d.getDate() + 30)

      let bankMatch = null

      // Допуск: 10 грн або 0.5% від суми (що більше)
      const tolerance = Math.max(10, absAmt * 0.005)
      console.log('[AddDoc] Шукаю банк.операцію: сума=', absAmt, 'ЄДРПОУ=', form.edrpou, 'дата=', form.date, 'допуск=', tolerance)

      // 1. По ЄДРПОУ + сумі (без обмеження дати)
      if (form.edrpou?.trim()) {
        const edrpouClean = form.edrpou.trim().replace(/\s/g, '')
        const { data: byCode } = await supabase.from('bank_transactions')
          .select('id, date, counterparty, amount, edrpou, documents(id)')
          .eq('edrpou', edrpouClean)
          .eq('is_ignored', false)
          .order('date', { ascending: false }).limit(200)

        console.log('[AddDoc] По ЄДРПОУ знайдено:', byCode?.length, 'записів')
        bankMatch = (byCode || []).find(b => Math.abs(Math.abs(b.amount) - absAmt) <= tolerance)
        if (!bankMatch && byCode?.length) {
          console.log('[AddDoc] Суми не збіглися. Перші 5:', byCode.slice(0,5).map(b => ({ amt: b.amount, date: b.date })))
        }
      }

      // 2. По сумі + даті (±30 днів, без перевірки знаку)
      if (!bankMatch) {
        const { data: byAmount } = await supabase.from('bank_transactions')
          .select('id, date, counterparty, amount, edrpou, documents(id)')
          .eq('is_ignored', false)
          .gte('date', toDate(dMinus))
          .lte('date', toDate(dPlus))
          .limit(200)

        console.log('[AddDoc] По даті знайдено:', byAmount?.length, 'записів')
        bankMatch = (byAmount || []).find(b => Math.abs(Math.abs(b.amount) - absAmt) <= tolerance)
        if (!bankMatch && byAmount?.length) {
          // Шукаємо найближчу суму для діагностики
          const closest = (byAmount || []).reduce((best, b) => {
            const diff = Math.abs(Math.abs(b.amount) - absAmt)
            return diff < best.diff ? { diff, amt: b.amount, date: b.date, cp: b.counterparty } : best
          }, { diff: Infinity })
          console.log('[AddDoc] Найближча сума:', closest)
        }
      }

      if (bankMatch) console.log('[AddDoc] ✓ Знайдено банк.операцію:', bankMatch.id, bankMatch.amount, bankMatch.counterparty)
      else console.log('[AddDoc] ✗ Банк.операцію НЕ знайдено')

      // Якщо знайдено банківську операцію — оновити її і прикріпити документ
      if (bankMatch) {
        setBankMatch(bankMatch)
        await supabase.from('bank_transactions').update({
          article: form.article || null,
          direction: form.direction,
          project_id: form.projectId || null,
          edrpou: form.edrpou || null,
          doc_type: form.docType || null,
          doc_number: form.docNumber || null,
          contractor_id: finalContractorId,
        }).eq('id', bankMatch.id)
      }

      // bank_transactions = єдине джерело правди, transactions не потрібна

      // 2. Save items + auto-link to products + stock movements
      const docFolder = bankMatch?.id || crypto.randomUUID()

      if (form.items.length > 0) {
        // Перевірити чи вже є позиції в цій bank_transaction
        let itemsToInsert = form.items
        if (bankMatch?.id) {
          const { data: existing } = await supabase.from('transaction_items')
            .select('name').eq('bank_transaction_id', bankMatch.id)
          const existingNames = new Set((existing || []).map(e => e.name?.toLowerCase()))
          itemsToInsert = form.items.filter(it => !existingNames.has(it.name?.toLowerCase()))
          if (itemsToInsert.length < form.items.length) {
            console.warn(`Пропущено ${form.items.length - itemsToInsert.length} дублікатів позицій`)
          }
        }
        if (itemsToInsert.length === 0) { /* всі позиції вже є */ }
        const items = itemsToInsert.map(it => ({
          bank_transaction_id: bankMatch?.id || null,
          name: it.name,
          quantity: it.quantity || null,
          unit: it.unit || null,
          unit_price: it.unitPrice || null,
          amount: it.amount || 0,
          vat_rate: it.vatRate || 20,
        }))
        const { data: savedItems } = items.length > 0
          ? await supabase.from('transaction_items').insert(items).select('id, name, quantity, unit, unit_price, amount')
          : { data: [] }

        // Через централізований stockService: resolve products + stock movements
        if (savedItems?.length) {
          // Передати _matchedProductId і _action з форми
          const enrichedItems = savedItems.map((si, idx) => {
            const formItem = form.items[idx]
            return { ...si, _matchedProductId: formItem?._matchedProductId || null, _action: formItem?._action || 'auto' }
          })
          await processDocumentItems(enrichedItems, {
            docType: form.docType,
            docRole: form.docRole,
            bankTransactionId: bankMatch?.id,
            date: form.date,
            userId: user.id,
          })
        }
      }

      // 3. Upload all files
      const filesToUpload = files.length > 0 ? files : (file ? [file] : [])
      if (filesToUpload.length > 0) {
        const mimeToExt = {
          'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
          'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic',
          'application/pdf': 'pdf',
        }
        let uploadedCount = 0
        for (let fi = 0; fi < filesToUpload.length; fi++) {
          const f = filesToUpload[fi]
          const nameParts = f.name.split('.')
          const extFromName = nameParts.length > 1 ? nameParts.pop().toLowerCase() : ''
          const ext = extFromName || mimeToExt[f.type] || 'jpg'
          const safePath = `${docFolder}/${Date.now()}-${fi}.${ext}`
          const displayName = buildDocFileName(form.docType, form.docNumber, form.contractor, form.date, ext) + (filesToUpload.length > 1 ? ` (стор. ${fi+1})` : '')

          const { error: uploadErr } = await supabase.storage
            .from('documents')
            .upload(safePath, f, { contentType: f.type || `image/${ext}` })

          if (!uploadErr) {
            await supabase.from('documents').insert({
              bank_transaction_id: bankMatch?.id || null,
              project_id: form.projectId || null,
              file_name: displayName,
              file_path: safePath,
              file_type: f.type,
              file_size: f.size,
              doc_role: form.docRole,
              uploaded_by: user.id,
            })
            uploadedCount++
          }
        }
        onSaved?.(uploadedCount > 0 ? `✓ Операцію та ${uploadedCount} файл(ів) збережено` : 'Операцію збережено (файли не прикріпились)')
      } else {
        onSaved?.('✓ Операцію збережено')
      }
      setStep('upload')
      setFile(null)
      setFiles([])
      setExtracted(null)
      setContractorId(null)
      setForm({
        date: '', contractor: '', edrpou: '', docType: '', docNumber: '',
        total: '', vat: '', noVat: '', direction: 'Витрати',
        article: '', projectId: '', description: '',
        docRole: 'incoming', items: [],
      })

    } catch (e) {
      if (e.code === '23505' || e.message?.includes('unique') || e.message?.includes('idx_unique_doc')) {
        setError('Цей документ вже є в системі — збіг по номеру документу та ЄДРПОУ. Збереження скасовано.')
      } else {
        setError('Помилка збереження: ' + e.message)
      }
    } finally {
      setSaving(false)
    }
  }

  // Прикріпити документ до існуючої транзакції
  const handleAttach = async (txId) => {
    setSaving(true)
    try {
      if (file) {
        const mimeToExt = { 'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','application/pdf':'pdf' }
        const nameParts = file.name.split('.')
        const extFromName = nameParts.length > 1 ? nameParts.pop().toLowerCase() : ''
        const ext = extFromName || mimeToExt[file.type] || 'jpg'
        const safePath = `${txId}/${Date.now()}.${ext}`
        const displayName = buildDocFileName(form.docType, form.docNumber, form.contractor, form.date, ext)

        const { error: uploadErr } = await supabase.storage.from('documents').upload(safePath, file, { contentType: file.type || `image/${ext}` })
        if (!uploadErr) {
          await supabase.from('documents').insert({
            transaction_id: txId,
            file_name: displayName,
            file_path: safePath,
            file_type: file.type,
            file_size: file.size,
            doc_role: form.docRole,
            uploaded_by: user.id,
          })
        }
      }
      setSimilarTxs([])
      setAttachMode(false)
      setStep('upload')
      setFile(null)
      setFiles([])
      setExtracted(null)
      setContractorId(null)
      setForm({ date:'', contractor:'', edrpou:'', docType:'', docNumber:'', total:'', vat:'', noVat:'', direction:'Витрати', article:'', projectId:'', description:'', docRole:'incoming', items:[] })
      onSaved?.('✓ Документ прикріплено до існуючої транзакції')
    } catch(e) {
      setError('Помилка прикріплення: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreateNew = () => {
    setSimilarTxs([])
    setAttachMode(false)
    handleSave(true)
  }

  const updateItem = (idx, field, val) => {
    setForm(p => {
      const items = [...p.items]
      items[idx] = { ...items[idx], [field]: val }
      return { ...p, items }
    })
  }

  return (
    <div>
      <div className="page-header">
        <h1>Додати документ</h1>
        <p>Завантажте PDF або фото рахунку — Claude розпізнає і заповнить поля автоматично</p>
      </div>

      {/* STEP: Upload */}
      {step === 'upload' && (
        <div className="card">
          {error && <div className="alert alert-error">{error}</div>}

          {/* Drop zone */}
          <div
            style={{
              border: '1.5px dashed var(--border2)', borderRadius: 12, padding: '40px 24px',
              textAlign: 'center', cursor: 'pointer', transition: 'all .15s',
              background: drag ? 'var(--blue-bg)' : 'var(--surface2)',
              borderColor: drag ? 'var(--blue)' : undefined,
            }}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFilesAdded(e.dataTransfer.files) }}
            onClick={() => fileRef.current.click()}
          >
            <i className="ti ti-cloud-upload" style={{ fontSize: 36, color: drag ? 'var(--blue)' : 'var(--text3)', display: 'block', marginBottom: 12 }} />
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: 'var(--text)' }}>
              Перетягніть файл(и) або натисніть для вибору
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              PDF, JPG, PNG, WebP · можна додати кілька сторінок одного документу
            </div>
            <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 4 }}>
              ⚠ iPhone: використовуйте кнопку «Камера» або конвертуйте HEIC → JPG
            </div>
          </div>

          {/* Files list */}
          {files.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                  <i className={`ti ${f.type === 'application/pdf' ? 'ti-file-type-pdf' : 'ti-photo'}`} style={{ fontSize: 20, color: 'var(--blue)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{(f.size / 1024).toFixed(1)} KB · стор. {i + 1}</div>
                  </div>
                  <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, padding: '0 4px' }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => fileRef.current.click()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ti ti-upload" style={{ fontSize: 15 }} />
              {files.length > 0 ? 'Додати ще сторінку' : 'Вибрати файл'}
            </button>
            <button className="btn btn-secondary" onClick={() => cameraRef.current.click()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ti ti-camera" style={{ fontSize: 15 }} />
              Камера
            </button>
            {files.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => processFiles(files)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', background: 'var(--green)' }}
              >
                <i className="ti ti-sparkles" style={{ fontSize: 15 }} />
                Розпізнати {files.length > 1 ? `${files.length} сторінок` : 'документ'}
              </button>
            )}
          </div>
          {files.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
              Claude розпізнає будь-який формат · для багатосторінкових документів додайте кілька фото
            </div>
          )}

          {/* Hidden inputs — multiple for file, single for camera */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => handleFilesAdded(e.target.files)} />
          <input ref={fileRef} type="file" accept=".pdf,image/*" multiple style={{ display: 'none' }} onChange={e => handleFilesAdded(e.target.files)} />
        </div>
      )}

      {/* STEP: Extracting */}
      {step === 'extracting' && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" />
          <p style={{ color: 'var(--blue)', fontWeight: 500 }}>Читаю документ...</p>
          <p style={{ color: 'var(--text2)', fontSize: 12, marginTop: 4 }}>{files.length > 1 ? `${files.length} сторінок документу` : file?.name}</p>
        </div>
      )}

      {/* STEP: Form */}
      {step === 'form' && (
        <div className="card">
          {/* File preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
            <i className="ti ti-file-text" style={{ fontSize: 22, color: 'var(--blue)', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{file?.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{file ? (file.size / 1024).toFixed(1) + ' KB' : ''}</div>
            </div>
          </div>

          {/* Extracted summary */}
          {extracted && (
            <div style={{ background: 'var(--blue-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ti ti-check" style={{ fontSize: 14 }} />
                Розпізнано Claude — перевірте та скоригуйте за потреби
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {extracted.docType && <div><div style={{ fontSize: 10.5, color: 'var(--blue)' }}>Тип документу</div><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)' }}>{extracted.docType}</div></div>}
                {extracted.date && <div><div style={{ fontSize: 10.5, color: 'var(--blue)' }}>Дата</div><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)' }}>{extracted.date}</div></div>}
                {extracted.totalAmount && <div><div style={{ fontSize: 10.5, color: 'var(--blue)' }}>Сума</div><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)' }}>{fmt(extracted.totalAmount)} грн</div></div>}
              </div>
            </div>
          )}

          {error && <div className="alert alert-error">{error}</div>}

          {/* Similar transactions — attach or create new */}
          {attachMode && similarTxs.length > 0 && (
            <div style={{ background:'var(--blue-bg)', border:'2px solid var(--border)', borderRadius:12, padding:'14px 16px', marginBottom:14 }}>
              <div style={{ fontWeight:500, fontSize:14, color:'var(--blue)', marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
                <i className="ti ti-paperclip" style={{ fontSize:18, color:'var(--blue)' }} />
                {similarTxs.length === 1 ? 'Знайдено схожу транзакцію' : `Знайдено ${similarTxs.length} схожих транзакцій`} — до якої прикріпити документ?
              </div>
              <div style={{ fontSize:12, color:'var(--blue)', marginBottom:12 }}>
                ЄДРПОУ <strong>{form.edrpou}</strong> · сума <strong>{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(parseFloat(form.total))))} грн</strong>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:12 }}>
                {similarTxs.map(tx => (
                  <div key={tx.id} style={{ display:'flex', alignItems:'center', gap:10, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>
                        {tx.contractor}
                        {tx.doc_type && <span style={{ fontSize:11, color:'var(--text2)', marginLeft:8 }}>{tx.doc_type}</span>}
                        {tx.doc_number && <span style={{ fontSize:11, color:'var(--text3)', marginLeft:4 }}>№{tx.doc_number}</span>}
                      </div>
                      <div style={{ fontSize:12, color:'var(--text2)', marginTop:2, display:'flex', gap:12 }}>
                        <span>{tx.date}</span>
                        <span style={{ fontWeight:500, color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {tx.amount >= 0 ? '+' : ''}{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(tx.amount)))} грн
                        </span>
                        <span style={{ color:'var(--text3)' }}>{tx.documents?.length || 0} документів</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize:12, padding:'6px 14px', whiteSpace:'nowrap' }}
                      onClick={() => handleAttach(tx.id)}
                      disabled={saving}
                    >
                      <i className="ti ti-paperclip" style={{ fontSize:12, marginRight:4 }} />
                      Прикріпити
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:8, borderTop:'1px solid var(--border)', paddingTop:12 }}>
                <button className="btn btn-secondary" onClick={() => { setSimilarTxs([]); setAttachMode(false) }}>
                  ← Скасувати
                </button>
                <button
                  style={{ background:'none', border:'1px solid var(--blue)', borderRadius:6, padding:'6px 14px', fontSize:12.5, cursor:'pointer', color:'var(--blue)', fontFamily:'inherit' }}
                  onClick={handleCreateNew}
                  disabled={saving}
                >
                  Створити нову транзакцію
                </button>
              </div>
            </div>
          )}

          {/* Duplicate warning */}
          {duplicate && (
            <div style={{ background: 'var(--surface2)', border: '2px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--text2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 18, color: 'var(--text2)' }} />
                Можливий дублікат — схожа операція вже є!
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
                <strong>{duplicate.date}</strong> · <strong>{duplicate.contractor}</strong>
                {duplicate.doc_number && <span> · №{duplicate.doc_number}</span>}
                · <strong>{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(duplicate.amount)))} грн</strong>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                Перевірте — якщо це справді та сама операція, натисніть «Скасувати».
                Якщо це нова окрема оплата — натисніть «Все одно зберегти».
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setDuplicate(null)}>
                  ← Скасувати (рекомендовано)
                </button>
                <button
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', fontSize: 12.5, cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}
                  onClick={() => { setDuplicate(null); handleSave(true) }}
                >
                  Все одно зберегти (нова оплата)
                </button>
              </div>
            </div>
          )}

          {/* Bank match notification */}
          {bankMatch && (
            <div style={{ background:'var(--green-bg)', border:'2px solid var(--border)', borderRadius:12, padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:12 }}>
              <i className="ti ti-building-bank" style={{ fontSize:22, color:'var(--green)', flexShrink:0 }} />
              <div>
                <div style={{ fontWeight:500, fontSize:13, color:'var(--green)', marginBottom:2 }}>
                  Привʼязано до банківської операції
                </div>
                <div style={{ fontSize:12, color:'var(--green)' }}>
                  {bankMatch.date} · {bankMatch.counterparty || 'Банк'} · {bankMatch.amount > 0 ? '+' : ''}{fmt(Math.abs(bankMatch.amount))} грн
                  {bankMatch.edrpou && <span> · ЄДРПОУ {bankMatch.edrpou}</span>}
                </div>
              </div>
              <button onClick={() => { setBankMatch(null); setManualLinkMode(true) }} style={{ marginLeft:'auto', background:'none', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', color:'var(--text2)', fontSize:11, padding:'4px 10px', fontFamily:'inherit' }}>Змінити</button>
            </div>
          )}

          {/* Manual bank link */}
          {!bankMatch && step === 'form' && (
            <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
              {!manualLinkMode ? (
                <button
                  onClick={() => setManualLinkMode(true)}
                  style={{ background:'none', border:'1px dashed var(--border)', borderRadius:8, padding:'8px 16px', width:'100%', cursor:'pointer', color:'var(--blue)', fontSize:12.5, fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}
                >
                  <i className="ti ti-link" style={{ fontSize:16 }} />
                  Привʼязати до банківської операції вручну
                </button>
              ) : (
                <div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={{ fontSize:12.5, fontWeight:500, color:'var(--text1)' }}>Пошук банківської операції</div>
                    <button onClick={() => { setManualLinkMode(false); setManualResults([]) }} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:16 }}>×</button>
                  </div>
                  <input
                    className="form-input"
                    placeholder="Введіть суму, ЄДРПОУ або назву контрагента..."
                    value={manualSearch}
                    onChange={e => {
                      setManualSearch(e.target.value)
                      clearTimeout(window._manualSearchTimer)
                      window._manualSearchTimer = setTimeout(() => searchBankTx(e.target.value), 400)
                    }}
                    style={{ marginBottom:8 }}
                    autoFocus
                  />
                  {manualSearching && <div style={{ fontSize:12, color:'var(--text3)', padding:4 }}>Пошук...</div>}
                  {manualResults.length > 0 && (
                    <div style={{ maxHeight:240, overflowY:'auto', borderRadius:8, border:'1px solid var(--border)' }}>
                      {manualResults.map(b => (
                        <div
                          key={b.id}
                          onClick={() => { setBankMatch(b); setManualLinkMode(false); setManualResults([]) }}
                          style={{ padding:'8px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', fontSize:12.5, display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--surface)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                        >
                          <div>
                            <div style={{ fontWeight:500, color:'var(--text1)' }}>{b.counterparty || '—'}</div>
                            <div style={{ fontSize:11, color:'var(--text3)' }}>
                              {b.date}{b.edrpou ? ` · ЄДРПОУ ${b.edrpou}` : ''}{b.iban ? ` · ${b.iban.substring(0,10)}...` : ''}
                            </div>
                          </div>
                          <div style={{ fontWeight:600, color: b.amount > 0 ? 'var(--green)' : 'var(--red)', whiteSpace:'nowrap', marginLeft:12 }}>
                            {b.amount > 0 ? '+' : ''}{fmt(b.amount)} грн
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {manualSearch.length >= 2 && !manualSearching && manualResults.length === 0 && (
                    <div style={{ fontSize:12, color:'var(--text3)', padding:'8px 4px' }}>Нічого не знайдено</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="form-grid">
            <div className="form-group">
              <label>Дата *</label>
              <input type="date" className="form-input" value={form.date} onChange={set('date')} />
            </div>
            <div className="form-group">
              <label>Тип документу</label>
              <input className="form-input" value={form.docType} onChange={set('docType')} placeholder="рахунок-фактура, видаткова накладна..." />
            </div>
            <div className="form-group">
              <label>Контрагент *</label>
              <ContractorSelect
                value={form.contractor}
                onChange={v => setForm(p => ({ ...p, contractor: v }))}
                onContractorSelect={c => {
                  if (c._new) return
                  setContractorId(c.id)
                  if (c.default_direction) setForm(p => ({ ...p, direction: c.default_direction }))
                  if (c.default_article) setForm(p => ({ ...p, article: c.default_article }))
                }}
              />
            </div>
            <div className="form-group">
              <label>ЄДРПОУ / ІПН</label>
              <input className="form-input" value={form.edrpou} onChange={set('edrpou')} placeholder="12345678" />
            </div>
            <div className="form-group">
              <label>Сума загальна, грн *</label>
              <input type="number" className="form-input" value={form.total} onChange={e => {
                const t = parseFloat(e.target.value) || 0
                const v = Math.round(t / 6 * 100) / 100
                setForm(p => ({ ...p, total: e.target.value, vat: v.toString(), noVat: (t - v).toFixed(2) }))
              }} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>ПДВ, грн</label>
              <input type="number" className="form-input" value={form.vat} onChange={set('vat')} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Напрям</label>
              <select className="form-input" value={form.direction} onChange={set('direction')}>
                {DIRECTIONS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Стаття</label>
              <select className="form-input" value={form.article} onChange={set('article')}>
                <option value="">— оберіть статтю —</option>
                {Object.entries(groupByType(articles)).map(([type, items]) =>
                  items.length > 0 ? (
                    <optgroup key={type} label={TYPE_LABELS[type]}>
                      {items.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                    </optgroup>
                  ) : null
                )}
              </select>
            </div>
            <div className="form-group">
              <label>Проєкт</label>
              <select className="form-input" value={form.projectId} onChange={set('projectId')}>
                <option value="">— без проєкту —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Тип документу</label>
              <select className="form-input" value={form.docRole} onChange={set('docRole')}>
                {DOC_ROLES.map(r => <option key={r} value={r}>{DOC_ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Номер документу</label>
              <input className="form-input" value={form.docNumber} onChange={set('docNumber')} placeholder="НМ-001234" />
            </div>
            <div className="form-group">
              <label>Призначення</label>
              <input className="form-input" value={form.description} onChange={set('description')} placeholder="Короткий опис" />
            </div>
          </div>

          {/* Items */}
          {form.items.length > 0 && (
            <div className="items-table">
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)', marginBottom: 6 }}>
                📦 Позиції з документу ({form.items.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 180 }}>Назва</th>
                      <th>К-сть</th>
                      <th>Од.</th>
                      <th>Ціна</th>
                      <th>Сума</th>
                      <th style={{ minWidth: 140 }}>Продукт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, i) => (
                      <tr key={i}>
                        <td><input className="form-input" value={it.name} onChange={e => updateItem(i, 'name', e.target.value)} style={{ width: '100%' }} /></td>
                        <td><input type="number" className="form-input" value={it.quantity || ''} onChange={e => updateItem(i, 'quantity', e.target.value)} style={{ width: 70 }} /></td>
                        <td><input className="form-input" value={it.unit || ''} onChange={e => updateItem(i, 'unit', e.target.value)} style={{ width: 60 }} /></td>
                        <td><input type="number" className="form-input" value={it.unitPrice || ''} onChange={e => updateItem(i, 'unitPrice', e.target.value)} style={{ width: 90 }} /></td>
                        <td style={{ fontWeight: 500 }}>{fmt(it.amount)}</td>
                        <td>
                          {it._match?.matchType === 'exact' && (
                            <span style={{ fontSize:11, background:'var(--green-bg)', color:'var(--green)', padding:'2px 6px', borderRadius:4, display:'inline-flex', alignItems:'center', gap:3 }}>
                              <i className="ti ti-check" style={{ fontSize:11 }} />{(it._match.productName || '').substring(0, 25)}
                            </span>
                          )}
                          {it._match?.matchType === 'fuzzy' && (
                            <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                              <span style={{ fontSize:10, background:'var(--amber-bg)', color:'var(--amber)', padding:'2px 5px', borderRadius:4 }} title={it._match.productName}>
                                {(it._match.productName || '').substring(0, 20)}?
                              </span>
                              <button style={{ fontSize:10, background:'var(--green-bg)', border:'none', borderRadius:4, padding:'2px 5px', cursor:'pointer', color:'var(--green)', fontFamily:'inherit' }}
                                onClick={() => updateItem(i, '_action', 'auto')}>Так</button>
                              <button style={{ fontSize:10, background:'var(--red-bg)', border:'none', borderRadius:4, padding:'2px 5px', cursor:'pointer', color:'var(--red)', fontFamily:'inherit' }}
                                onClick={() => { updateItem(i, '_action', 'new'); updateItem(i, '_matchedProductId', null) }}>Ні</button>
                            </div>
                          )}
                          {(!it._match || it._match.matchType === 'none') && (
                            <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                              {['new', 'service', 'expense'].map(act => (
                                <button key={act}
                                  style={{ fontSize:10, background: it._action === act ? (act === 'new' ? 'var(--blue-bg)' : act === 'service' ? 'var(--green-bg)' : 'var(--amber-bg)') : 'none',
                                    border:'1px solid var(--border)', borderRadius:4, padding:'2px 5px', cursor:'pointer',
                                    color: it._action === act ? (act === 'new' ? 'var(--blue)' : act === 'service' ? 'var(--green)' : 'var(--amber)') : 'var(--text3)', fontFamily:'inherit' }}
                                  onClick={() => updateItem(i, '_action', act)}>
                                  {act === 'new' ? 'Товар' : act === 'service' ? 'Послуга' : 'Госп.'}
                                </button>
                              ))}
                            </div>
                          )}
                          {it._match === null && <span style={{ fontSize:10, color:'var(--text3)' }}>...</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => handleSave(false)} disabled={saving}>
              {saving ? 'Збереження...' : '✓ Зберегти операцію'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setStep('upload'); setFile(null); setFiles([]); setExtracted(null); setError(null) }}>
              ← Назад
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

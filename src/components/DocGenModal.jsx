import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  DOCUMENT_TYPES, getNextDocNumber, generatePdf, generateXlsx,
  saveDoc, calcTotals, formatMoney
} from '../lib/docgen'

const today = () => new Date().toISOString().split('T')[0]

export default function DocGenModal({ contractor, userId, onClose, onSaved, editDoc }) {
  const isEdit = !!editDoc && !!editDoc.id
  const isFromInvoice = !!editDoc?._fromInvoice
  const [parentDocId] = useState(editDoc?._parentDocId || null)
  const [step, setStep] = useState(isEdit ? 2 : 1)
  const [docType, setDocType] = useState(editDoc?.doc_type || null)
  const [docNumber, setDocNumber] = useState(editDoc?.doc_number || '')
  const [docDate, setDocDate] = useState(editDoc?.doc_date || today())
  const [notes, setNotes] = useState(editDoc?.notes || '')
  const [contractNum, setContractNum] = useState(editDoc?.contract_num || '')
  const [contractDate, setContractDate] = useState(editDoc?.contract_date || '')
  const [paymentDue, setPaymentDue] = useState(editDoc?.payment_due || '')
  const [city, setCity] = useState(editDoc?.city || 'м. Київ')
  const [invoiceRef, setInvoiceRef] = useState(editDoc?.invoice_ref || editDoc?._fromInvoice || '')
  const [invoiceRefDate, setInvoiceRefDate] = useState(editDoc?.invoice_ref_date || '')
  const [deliveryBasis, setDeliveryBasis] = useState(editDoc?.delivery_basis || '')
  const [deliveryAddress, setDeliveryAddress] = useState(editDoc?.delivery_address || contractor?.delivery_address || '')
  const [contractsList, setContractsList] = useState([])
  const [selectedContract, setSelectedContract] = useState('')

  const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']
  const [editId] = useState(editDoc?.id || null)
  const [items, setItems] = useState(() => {
    if (editDoc?.items) {
      const parsed = typeof editDoc.items === 'string' ? JSON.parse(editDoc.items) : editDoc.items
      return parsed.length > 0 ? parsed : [{ name: '', quantity: 1, unit: 'шт', unitPrice: '', vatRate: 20, amount: '', productId: null }]
    }
    return [{ name: '', quantity: 1, unit: 'шт', unitPrice: '', vatRate: 20, amount: '', productId: null }]
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [products, setProducts] = useState([])
  const [searchIdx, setSearchIdx] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // Завантажити товари зі складу + договори контрагента
  useEffect(() => {
    supabase.from('product_stock').select('id, name, computed_stock, unit, buy_price, sell_price, product_type')
      .eq('status', 'active').order('name')
      .then(({ data }) => setProducts(data || []))
    if (contractor?.id) {
      supabase.from('contractor_contracts').select('*').eq('contractor_id', contractor.id).eq('status', 'active').order('date', { ascending: false })
        .then(({ data }) => setContractsList(data || []))
    }
  }, [])

  // Авто-нумерація при виборі типу (тільки для нових)
  useEffect(() => {
    if (docType && !isEdit) {
      getNextDocNumber(docType).then(n => setDocNumber(n))
    }
  }, [docType])

  const addItem = () => {
    setItems(prev => [...prev, { name: '', quantity: 1, unit: 'шт', unitPrice: '', vatRate: 20, amount: '', productId: null }])
    // Автоматично відкрити пошук для нового рядка
    setTimeout(() => setSearchIdx(items.length), 50)
  }

  const addProductItem = (product) => {
    const price = product.sell_price || product.buy_price || 0
    const newItem = {
      name: product.name,
      quantity: 1,
      unit: product.unit || 'шт',
      unitPrice: price,
      vatRate: 20,
      amount: price.toFixed(2),
      productId: product.id,
    }
    if (searchIdx !== null && searchIdx < items.length && !items[searchIdx].name) {
      // Замінити порожній рядок
      setItems(prev => prev.map((it, i) => i === searchIdx ? newItem : it))
    } else {
      setItems(prev => [...prev, newItem])
    }
    setSearchIdx(null)
    setSearchText('')
  }

  const searchResults = searchText.length >= 1
    ? products.filter(p => p.name.toLowerCase().includes(searchText.toLowerCase())).slice(0, 8)
    : products.slice(0, 8)

  const updateItem = (idx, field, value) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const updated = { ...it, [field]: value }
      if (field === 'quantity' || field === 'unitPrice') {
        const qty = parseFloat(field === 'quantity' ? value : it.quantity) || 0
        const price = parseFloat(field === 'unitPrice' ? value : it.unitPrice) || 0
        updated.amount = (qty * price).toFixed(2)
      }
      return updated
    }))
  }

  const removeItem = idx => setItems(prev => prev.filter((_, i) => i !== idx))

  const totals = calcTotals(items)

  const handleSave = async (andDownload) => {
    setSaving(true); setError(null)
    try {
      if (editId) {
        // Оновити існуючий документ
        const { updateDoc } = await import('../lib/docgen')
        await updateDoc(editId, {
          docNumber, docDate, items,
          subtotal: totals.subtotal, vatAmount: totals.vatAmount, total: totals.total,
          notes, contractNum, contractDate, paymentDue, city,
        })
      } else {
        // Створити новий
        await saveDoc({
          docType, docNumber, docDate,
          contractorId: contractor.id,
          contractorName: contractor.short_name || contractor.name,
          items, subtotal: totals.subtotal, vatAmount: totals.vatAmount, total: totals.total,
          notes, contractNum, contractDate, paymentDue, city, parentDocId, contractId: selectedContract || null, userId,
        })
      }
      if (andDownload === 'pdf') await generatePdf(docType, contractor, items, { docNumber, docDate, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress })
      if (andDownload === 'xlsx') await generateXlsx(docType, contractor, items, { docNumber, docDate, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress })
      onSaved?.()
      if (!andDownload) onClose()
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const handleDownloadOnly = async (format) => {
    try {
      if (format === 'pdf') await generatePdf(docType, contractor, items, { docNumber, docDate, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress })
      else await generateXlsx(docType, contractor, items, { docNumber, docDate, notes, contractNum, contractDate, paymentDue, city, invoiceRef, invoiceRefDate, deliveryBasis, deliveryAddress })
    } catch (e) { setError(e.message) }
  }

  const isContract = DOCUMENT_TYPES.find(t => t.key === docType)?.isContract
  const canProceed = step === 1 ? !!docType
    : step === 2 ? isContract ? true : items.length > 0 && items.some(it => it.name?.trim())
    : true

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxWidth: 800 }}>
        <div className="modal-header">
          <h2>{step === 1 ? 'Створити документ' : step === 2 ? (isEdit ? 'Редагування документа' : 'Позиції документа') : 'Перегляд та збереження'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* Кроки */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, padding: '0 4px' }}>
          {['Тип', 'Позиції', 'Готово'].map((label, i) => (
            <div key={i} style={{
              flex: 1, textAlign: 'center', padding: '6px 0', fontSize: 12, fontWeight: 500,
              borderBottom: `3px solid ${step > i ? 'var(--blue)' : 'var(--border)'}`,
              color: step > i ? 'var(--blue)' : 'var(--text3)',
            }}>{label}</div>
          ))}
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

        {/* Крок 1 — Вибір типу */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
              Контрагент: <strong>{contractor.short_name || contractor.name}</strong>
              {contractor.edrpou && <span style={{ color: 'var(--text3)', marginLeft: 8 }}>ЄДРПОУ: {contractor.edrpou}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {DOCUMENT_TYPES.map(dt => (
                <div key={dt.key} onClick={() => setDocType(dt.key)} style={{
                  border: docType === dt.key ? '2px solid var(--blue)' : '1.5px solid var(--border)',
                  borderRadius: 12, padding: 16, cursor: 'pointer',
                  background: docType === dt.key ? 'var(--blue-bg)' : 'var(--surface)',
                  transition: 'all .15s',
                }}>
                  <i className={`ti ${dt.icon}`} style={{ fontSize: 24, color: docType === dt.key ? 'var(--blue)' : 'var(--text3)', display: 'block', marginBottom: 8 }} />
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{dt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Префікс: {dt.prefix}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Крок 2 — Позиції */}
        {step === 2 && (
          <div>
            <div className="form-grid" style={{ marginBottom: 12 }}>
              <div className="form-group">
                <label>Номер документа</label>
                <input className="form-input" value={docNumber} onChange={e => setDocNumber(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Дата</label>
                <input type="date" className="form-input" value={docDate} onChange={e => setDocDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Місто</label>
                <input className="form-input" value={city} onChange={e => setCity(e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: contractsList.length > 0 ? 'span 2' : undefined }}>
                <label>Договір</label>
                {contractsList.length > 0 ? (
                  <select className="form-input" value={selectedContract} onChange={e => {
                    setSelectedContract(e.target.value)
                    const ct = contractsList.find(c => c.id === e.target.value)
                    if (ct) { setContractNum(ct.number); setContractDate(ct.date || '') }
                    else { setContractNum(''); setContractDate('') }
                  }}>
                    <option value="">— Без договору —</option>
                    {contractsList.map(ct => (
                      <option key={ct.id} value={ct.id}>№{ct.number}{ct.date ? ` від ${ct.date}` : ''}{ct.subject ? ` — ${ct.subject}` : ''}</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="form-input" value={contractNum} onChange={e => setContractNum(e.target.value)} placeholder="Номер" style={{ flex: 1 }} />
                    <input type="date" className="form-input" value={contractDate} onChange={e => setContractDate(e.target.value)} style={{ flex: 1 }} />
                  </div>
                )}
              </div>
              {(docType === 'serviceAct' || docType === 'waybill') && (
                <>
                  <div className="form-group">
                    <label>Рахунок №</label>
                    <input className="form-input" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="Номер рахунку" />
                  </div>
                  <div className="form-group">
                    <label>Дата рахунку</label>
                    <input type="date" className="form-input" value={invoiceRefDate} onChange={e => setInvoiceRefDate(e.target.value)} />
                  </div>
                </>
              )}
              {docType === 'invoice' && (
                <div className="form-group">
                  <label>Термін оплати</label>
                  <input className="form-input" value={paymentDue} onChange={e => setPaymentDue(e.target.value)} placeholder="5 банківських днів" />
                </div>
              )}
              {docType === 'waybill' && (
                <>
                  <div className="form-group">
                    <label>Базис поставки (Інкотермс)</label>
                    <select className="form-input" value={deliveryBasis} onChange={e => setDeliveryBasis(e.target.value)}>
                      <option value="">— Не вказано —</option>
                      {INCOTERMS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group full">
                    <label>Адреса поставки</label>
                    <input className="form-input" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Адреса доставки товару" />
                  </div>
                </>
              )}
            </div>

            {/* Спеціальні поля для договорів */}
            {DOCUMENT_TYPES.find(t => t.key === docType)?.isContract && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--bg)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text2)' }}>Умови договору</div>
                <div className="form-grid">
                  {docType === 'loanAgreement' && <>
                    <div className="form-group">
                      <label>Сума допомоги (грн)</label>
                      <input type="number" className="form-input" value={items[0]?.amount || ''} onChange={e => setItems([{ ...items[0], amount: e.target.value, name: 'Фінансова допомога', quantity: 1, unitPrice: e.target.value }])} placeholder="0.00" />
                    </div>
                    <div className="form-group">
                      <label>Строк повернення</label>
                      <input className="form-input" value={items[0]?.returnPeriod || '12 місяців'} onChange={e => setItems([{ ...items[0], returnPeriod: e.target.value }])} placeholder="12 місяців" />
                    </div>
                    <div className="form-group">
                      <label>Дата повернення (або залишити строк)</label>
                      <input type="date" className="form-input" value={items[0]?.returnDate || ''} onChange={e => setItems([{ ...items[0], returnDate: e.target.value }])} />
                    </div>
                  </>}
                  {docType === 'supplyAgreement' && <>
                    <div className="form-group">
                      <label>Строк оплати</label>
                      <input className="form-input" value={items[0]?.paymentTerms || '5 банківських днів'} onChange={e => setItems([{ ...items[0], paymentTerms: e.target.value }])} />
                    </div>
                    <div className="form-group">
                      <label>Строк поставки</label>
                      <input className="form-input" value={items[0]?.deliveryTerms || '10 робочих днів'} onChange={e => setItems([{ ...items[0], deliveryTerms: e.target.value }])} />
                    </div>
                    <div className="form-group">
                      <label>Гарантійний строк</label>
                      <input className="form-input" value={items[0]?.warrantyPeriod || '12 місяців'} onChange={e => setItems([{ ...items[0], warrantyPeriod: e.target.value }])} />
                    </div>
                  </>}
                </div>
              </div>
            )}

            {/* Завантажити документ для AI розпізнавання */}
            {!DOCUMENT_TYPES.find(t => t.key === docType)?.isContract && (
              <div style={{ marginBottom: 12, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 10, border: '1px dashed var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                    <i className="ti ti-file-upload" style={{ fontSize: 16, marginRight: 6 }} />
                    Завантажте накладну — AI заповнить позиції автоматично
                  </div>
                  <label style={{ cursor: aiLoading ? 'wait' : 'pointer' }}>
                    <span className="btn btn-sm btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, pointerEvents: aiLoading ? 'none' : 'auto' }}>
                      {aiLoading ? <><i className="ti ti-loader-2" style={{ fontSize: 14, animation: 'spin 1s linear infinite' }} /> Розпізнаю...</> : <><i className="ti ti-upload" style={{ fontSize: 14 }} /> Завантажити</>}
                    </span>
                    <input type="file" accept=".pdf,image/*" multiple style={{ display: 'none' }} disabled={aiLoading}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || [])
                        if (!files.length) return
                        setAiLoading(true)
                        try {
                          const { extractDocumentMulti } = await import('../lib/ai')
                          const { fetchArticles } = await import('../lib/articles')
                          const arts = await fetchArticles()
                          const result = await extractDocumentMulti(files, arts)
                          if (result?.items?.length > 0) {
                            const newItems = result.items.map(it => {
                              // Спробувати знайти товар на складі по назві
                              const match = products.find(p => p.name.toLowerCase() === (it.name || '').toLowerCase())
                              return {
                                name: it.name || '',
                                quantity: it.quantity || 1,
                                unit: it.unit || 'шт',
                                unitPrice: it.unitPrice || '',
                                vatRate: it.vatRate ?? 20,
                                amount: it.amount || '',
                                productId: match?.id || null,
                              }
                            })
                            setItems(newItems)
                            if (result.docNumber && !docNumber) setDocNumber(result.docNumber)
                            if (result.date) setDocDate(result.date)
                          } else {
                            alert('Не вдалося розпізнати позиції з документу')
                          }
                        } catch (err) {
                          alert('Помилка розпізнавання: ' + err.message)
                        }
                        setAiLoading(false)
                        e.target.value = ''
                      }} />
                  </label>
                </div>
              </div>
            )}

            {/* Пошук товару зі складу — тільки для НЕ-договорів */}
            {!DOCUMENT_TYPES.find(t => t.key === docType)?.isContract && <div style={{ position: 'relative', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input className="form-input" style={{ height: 36, fontSize: 13, paddingLeft: 32 }}
                    value={searchText}
                    onChange={e => { setSearchText(e.target.value); if (searchIdx === null) setSearchIdx(items.length) }}
                    onFocus={() => { if (searchIdx === null) setSearchIdx(items.length) }}
                    placeholder="Пошук товару зі складу або введіть нову назву..." />
                  <i className="ti ti-search" style={{ position: 'absolute', left: 10, top: 10, fontSize: 15, color: 'var(--text3)' }} />
                </div>
                <button className="btn btn-sm btn-secondary" onClick={() => {
                  if (searchText.trim()) {
                    // Додати як новий товар (не зі складу)
                    const newItem = { name: searchText.trim(), quantity: 1, unit: 'шт', unitPrice: '', vatRate: 20, amount: '', productId: null }
                    if (searchIdx !== null && searchIdx < items.length && !items[searchIdx].name) {
                      setItems(prev => prev.map((it, i) => i === searchIdx ? newItem : it))
                    } else {
                      setItems(prev => [...prev, newItem])
                    }
                    setSearchText(''); setSearchIdx(null)
                  } else {
                    addItem()
                  }
                }} style={{ height: 36, whiteSpace: 'nowrap' }}>
                  <i className="ti ti-plus" style={{ fontSize: 13 }} /> Додати
                </button>
              </div>
              {searchIdx !== null && searchText !== undefined && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 64, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 50, maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.15)', marginTop: 2 }}>
                  {searchResults.map(p => (
                    <div key={p.id} onClick={() => addProductItem(p)}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {p.product_type === 'service' ? 'Послуга' : p.product_type === 'expense' ? 'Витрата' : `${p.computed_stock || 0} ${p.unit || 'шт'} на складі`}
                          {p.sell_price ? ` · Ціна: ${formatMoney(p.sell_price)}` : p.buy_price ? ` · Закупка: ${formatMoney(p.buy_price)}` : ''}
                        </div>
                      </div>
                      <i className="ti ti-plus" style={{ fontSize: 14, color: 'var(--blue)', flexShrink: 0 }} />
                    </div>
                  ))}
                  {searchResults.length === 0 && searchText.length >= 2 && (
                    <div style={{ padding: 12, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                      Не знайдено. Натисніть "Додати" щоб створити нову позицію
                    </div>
                  )}
                  <div onClick={() => { setSearchIdx(null); setSearchText('') }}
                    style={{ padding: '6px 12px', textAlign: 'center', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                    Закрити
                  </div>
                </div>
              )}
            </div>}

            {!DOCUMENT_TYPES.find(t => t.key === docType)?.isContract && <>
            {/* Таблиця позицій */}
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Позиції ({items.filter(it => it.name).length})
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', minWidth: 180 }}>Назва</th>
                    <th style={{ padding: '6px 4px', width: 60 }}>К-сть</th>
                    <th style={{ padding: '6px 4px', width: 50 }}>Од.</th>
                    <th style={{ padding: '6px 4px', width: 90 }}>Ціна</th>
                    <th style={{ padding: '6px 4px', width: 50 }}>ПДВ%</th>
                    <th style={{ padding: '6px 4px', width: 90 }}>Сума</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter(it => it.name).length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--text3)' }}>
                      Знайдіть товар у пошуку вище або натисніть "Додати"
                    </td></tr>
                  )}
                  {items.map((it, i) => {
                    if (!it.name) return null
                    return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {it.productId && <i className="ti ti-package" style={{ fontSize: 12, color: 'var(--green)', flexShrink: 0 }} title="Зі складу" />}
                          <input className="form-input" style={{ height: 32, fontSize: 12 }}
                            value={it.name} onChange={e => updateItem(i, 'name', e.target.value)} />
                        </div>
                      </td>
                      <td style={{ padding: '4px 2px' }}>
                        <input type="number" className="form-input" style={{ height: 32, fontSize: 12, textAlign: 'center' }}
                          value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 2px' }}>
                        <input className="form-input" style={{ height: 32, fontSize: 12, textAlign: 'center' }}
                          value={it.unit} onChange={e => updateItem(i, 'unit', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 2px' }}>
                        <input type="number" className="form-input" style={{ height: 32, fontSize: 12, textAlign: 'right' }}
                          value={it.unitPrice} onChange={e => updateItem(i, 'unitPrice', e.target.value)} placeholder="0.00" />
                      </td>
                      <td style={{ padding: '4px 2px' }}>
                        <select className="form-input" style={{ height: 32, fontSize: 12, padding: '2px 4px' }}
                          value={it.vatRate} onChange={e => updateItem(i, 'vatRate', e.target.value)}>
                          <option value={20}>20%</option>
                          <option value={7}>7%</option>
                          <option value={0}>0%</option>
                        </select>
                      </td>
                      <td style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 500, fontSize: 12 }}>
                        {formatMoney(parseFloat(it.amount) || 0)}
                      </td>
                      <td style={{ padding: '4px 2px' }}>
                        <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 16 }}>×</button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>

            </>}

            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Примітки</label>
              <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Опціонально" />
            </div>
          </div>
        )}

        {/* Крок 3 — Превʼю */}
        {step === 3 && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Тип документа</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{DOCUMENT_TYPES.find(t => t.key === docType)?.label}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Номер / Дата</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{docNumber} від {docDate}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Контрагент</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{contractor.short_name || contractor.name}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Сума</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--blue)' }}>{formatMoney(totals.total)} грн</div>
              </div>
            </div>

            {/* Таблиця позицій */}
            <div className="tbl-wrap" style={{ marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Назва</th>
                    <th style={{ textAlign: 'right' }}>К-сть</th>
                    <th style={{ textAlign: 'right' }}>Ціна</th>
                    <th style={{ textAlign: 'right' }}>Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter(it => it.name.trim()).map((it, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ fontSize: 13 }}>{it.name}</td>
                      <td style={{ textAlign: 'right' }}>{it.quantity} {it.unit}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(parseFloat(it.unitPrice) || 0)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatMoney(parseFloat(it.amount) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td colSpan={3} style={{ fontWeight: 500 }}>Без ПДВ</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(totals.subtotal)}</td>
                  </tr>
                  {totals.vatAmount > 0 && (
                    <tr>
                      <td colSpan={3} style={{ fontWeight: 500 }}>ПДВ</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(totals.vatAmount)}</td>
                    </tr>
                  )}
                  <tr style={{ fontWeight: 600, fontSize: 14 }}>
                    <td colSpan={3}>Всього</td>
                    <td style={{ textAlign: 'right', color: 'var(--blue)' }}>{formatMoney(totals.total)} грн</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Кнопки */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 1 && (
              <button className="btn btn-secondary" onClick={() => setStep(s => s - 1)}>← Назад</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step < 3 && (
              <button className="btn btn-primary" disabled={!canProceed} onClick={() => setStep(s => s + 1)}>
                Далі →
              </button>
            )}
            {step === 3 && (
              <>
                <button className="btn btn-secondary" onClick={() => handleSave(null)} disabled={saving}>
                  <i className="ti ti-device-floppy" style={{ fontSize: 14 }} /> {saving ? '...' : 'Зберегти чернетку'}
                </button>
                <button className="btn btn-secondary" onClick={() => handleDownloadOnly('xlsx')}>
                  <i className="ti ti-file-spreadsheet" style={{ fontSize: 14 }} /> Excel
                </button>
                <button className="btn btn-primary" onClick={() => handleSave('pdf')} disabled={saving}>
                  <i className="ti ti-file-type-pdf" style={{ fontSize: 14 }} /> {saving ? '...' : 'Зберегти + PDF'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

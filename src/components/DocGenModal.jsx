import { useState, useEffect } from 'react'
import {
  DOCUMENT_TYPES, getNextDocNumber, generatePdf, generateXlsx,
  saveDoc, calcTotals, formatMoney
} from '../lib/docgen'

const today = () => new Date().toISOString().split('T')[0]

export default function DocGenModal({ contractor, userId, onClose, onSaved }) {
  const [step, setStep] = useState(1) // 1=тип, 2=дані, 3=превʼю
  const [docType, setDocType] = useState(null)
  const [docNumber, setDocNumber] = useState('')
  const [docDate, setDocDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([{ name: '', quantity: 1, unit: 'шт', unitPrice: '', vatRate: 20, amount: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Авто-нумерація при виборі типу
  useEffect(() => {
    if (docType) {
      getNextDocNumber(docType).then(n => setDocNumber(n))
    }
  }, [docType])

  const addItem = () => setItems(prev => [...prev, { name: '', quantity: 1, unit: 'шт', unitPrice: '', vatRate: 20, amount: '' }])

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
      await saveDoc({
        docType, docNumber, docDate,
        contractorId: contractor.id,
        contractorName: contractor.short_name || contractor.name,
        items, subtotal: totals.subtotal, vatAmount: totals.vatAmount, total: totals.total,
        notes, userId,
      })
      if (andDownload === 'pdf') generatePdf(docType, contractor, items, { docNumber, docDate, notes })
      if (andDownload === 'xlsx') generateXlsx(docType, contractor, items, { docNumber, docDate, notes })
      onSaved?.()
      if (!andDownload) onClose()
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const handleDownloadOnly = (format) => {
    try {
      if (format === 'pdf') generatePdf(docType, contractor, items, { docNumber, docDate, notes })
      else generateXlsx(docType, contractor, items, { docNumber, docDate, notes })
    } catch (e) { setError(e.message) }
  }

  const canProceed = step === 1 ? !!docType
    : step === 2 ? items.length > 0 && items.some(it => it.name.trim())
    : true

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxWidth: 800 }}>
        <div className="modal-header">
          <h2>{step === 1 ? 'Створити документ' : step === 2 ? 'Позиції документа' : 'Перегляд та збереження'}</h2>
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
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Позиції ({items.length})</span>
              <button className="btn btn-sm btn-secondary" onClick={addItem}>
                <i className="ti ti-plus" style={{ fontSize: 13 }} /> Додати
              </button>
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
                  {items.map((it, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 4px' }}>
                        <input className="form-input" style={{ height: 32, fontSize: 12 }}
                          value={it.name} onChange={e => updateItem(i, 'name', e.target.value)} placeholder="Назва товару/послуги" />
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
                        {items.length > 1 && (
                          <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 16 }}>×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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

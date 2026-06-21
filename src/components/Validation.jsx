import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(Math.abs(n || 0))
const fmtInt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))

export default function Validation() {
  const [txs, setTxs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [docUrl, setDocUrl] = useState(null)
  const [filter, setFilter] = useState('all') // all, pending, validated, problems
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState({ total: 0, validated: 0, withItems: 0, problems: 0 })
  const [articles, setArticles] = useState([])
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' })
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [searchText, setSearchText] = useState('')

  useEffect(() => { loadData(); fetchArticles().then(setArticles) }, [])

  const loadData = async () => {
    setLoading(true)
    const { data } = await supabase.from('bank_transactions')
      .select(`*,
        transaction_items(id, name, quantity, unit, unit_price, amount, vat_rate, is_price_with_vat, unit_price_net, amount_net),
        documents(id, file_name, file_path, file_type)
      `)
      .eq('is_ignored', false)
      .order('date', { ascending: false })

    const all = (data || []).map(tx => {
      const items = tx.transaction_items || []
      const docs = tx.documents || []
      const itemsTotal = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
      const bankAbs = Math.abs(tx.amount || 0)
      const ratio = itemsTotal > 0 ? Math.round(bankAbs / itemsTotal * 1000) / 1000 : null
      return { ...tx, _items: items, _docs: docs, _itemsTotal: itemsTotal, _ratio: ratio }
    })

    setTxs(all)
    setStats({
      total: all.length,
      validated: all.filter(t => t.is_validated).length,
      withItems: all.filter(t => t._items.length > 0).length,
      problems: all.filter(t => t._items.length > 0 && t._ratio && Math.abs(t._ratio - 1.0) > 0.01 && Math.abs(t._ratio - 1.2) > 0.01).length,
    })
    setLoading(false)
  }

  const openTx = async (tx) => {
    setSelected(tx)
    setDocUrl(null)
    if (tx._docs.length > 0) {
      const doc = tx._docs[0]
      const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 600)
      setDocUrl(data?.signedUrl || null)
    }
  }

  const markValidated = async (tx, pricesWithVat) => {
    setSaving(true)
    const bankAbs = Math.abs(tx.amount || 0)
    const items = editItems.length > 0 ? editItems : tx._items

    // Зберегти зміни в транзакції (напрям, стаття)
    if (editForm.direction || editForm.article) {
      await supabase.from('bank_transactions').update({
        direction: editForm.direction || tx.direction,
        article: editForm.article || tx.article,
      }).eq('id', tx.id)
    }

    // Зберегти зміни в items
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item._new) {
        // Нова позиція — insert
        const { data: inserted } = await supabase.from('transaction_items').insert({
          bank_transaction_id: tx.id,
          name: item.name,
          quantity: parseFloat(item.quantity) || 0,
          unit: item.unit || 'шт',
          unit_price: parseFloat(item.unit_price) || 0,
          amount: parseFloat(item.amount) || 0,
          vat_rate: parseFloat(item.vat_rate) || 0,
        }).select().single()
        if (inserted) items[i] = { ...item, id: inserted.id, _new: false }
      } else if (item.id) {
        await supabase.from('transaction_items').update({
          name: item.name,
          quantity: parseFloat(item.quantity) || 0,
          unit_price: parseFloat(item.unit_price) || 0,
          amount: parseFloat(item.amount) || 0,
          vat_rate: parseFloat(item.vat_rate) || 0,
        }).eq('id', item.id)
      }
    }

    let amountNet, vatAmount

    if (items.length > 0) {
      const itemsSum = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)

      if (pricesWithVat) {
        // items.amount = з ПДВ → net = amount / (1 + rate/100)
        amountNet = items.reduce((s, i) => {
          const amt = parseFloat(i.amount) || 0
          const r = parseFloat(i.vat_rate) || 0
          return s + (r > 0 ? amt / (1 + r / 100) : amt)
        }, 0)
        vatAmount = bankAbs - amountNet

        // Оновити items
        for (const item of items) {
          const amt = parseFloat(item.amount) || 0
          const r = parseFloat(item.vat_rate) || 0
          const netPrice = r > 0 ? (parseFloat(item.unit_price) || 0) / (1 + r / 100) : (parseFloat(item.unit_price) || 0)
          const netAmount = r > 0 ? amt / (1 + r / 100) : amt
          await supabase.from('transaction_items').update({
            is_price_with_vat: true,
            unit_price_net: Math.round(netPrice * 100) / 100,
            amount_net: Math.round(netAmount * 100) / 100,
          }).eq('id', item.id)
        }
      } else {
        // items.amount = без ПДВ → net = items sum, gross = bank
        amountNet = itemsSum
        vatAmount = bankAbs - itemsSum

        // Оновити items
        for (const item of items) {
          await supabase.from('transaction_items').update({
            is_price_with_vat: false,
            unit_price_net: parseFloat(item.unit_price) || 0,
            amount_net: parseFloat(item.amount) || 0,
          }).eq('id', item.id)
        }
      }
    } else {
      // Без items — визначаємо по вибору користувача
      if (pricesWithVat === true) {
        // Банківська сума з ПДВ 20%
        amountNet = bankAbs / 1.2
        vatAmount = bankAbs - amountNet
      } else {
        // Банківська сума без ПДВ
        amountNet = bankAbs
        vatAmount = 0
      }
    }

    await supabase.from('bank_transactions').update({
      is_validated: true,
      amount_net: Math.round(amountNet * 100) / 100,
      vat_amount: Math.round(vatAmount * 100) / 100,
    }).eq('id', tx.id)

    setSaving(false)
    await loadData()
    // Оновити selected
    const updated = txs.find(t => t.id === tx.id)
    if (updated) setSelected({ ...updated, is_validated: true })
    else setSelected(null)
  }

  const unvalidate = async (tx) => {
    await supabase.from('bank_transactions').update({
      is_validated: false, amount_net: null, vat_amount: null,
    }).eq('id', tx.id)
    await loadData()
    setSelected(null)
  }

  const filtered = txs.filter(tx => {
    if (searchText) {
      const s = searchText.toLowerCase()
      if (!(tx.counterparty || '').toLowerCase().includes(s) && !(tx.description || '').toLowerCase().includes(s)) return false
    }
    if (filter === 'pending') return !tx.is_validated
    if (filter === 'validated') return tx.is_validated
    if (filter === 'problems') return tx._items.length > 0 && tx._ratio && Math.abs(tx._ratio - 1.0) > 0.01 && Math.abs(tx._ratio - 1.2) > 0.01
    if (filter === 'no_items') return tx._items.length === 0 && !tx.is_validated
    if (filter === 'no_article') return !tx.article?.trim()
    return true
  }).sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const col = sort.col
    if (col === 'date') return dir * ((a.date || '').localeCompare(b.date || ''))
    if (col === 'counterparty') return dir * ((a.counterparty || '').localeCompare(b.counterparty || ''))
    if (col === 'amount') return dir * ((Math.abs(a.amount || 0)) - (Math.abs(b.amount || 0)))
    if (col === 'net') return dir * ((a.amount_net || 0) - (b.amount_net || 0))
    if (col === 'vat') return dir * ((a.vat_amount || 0) - (b.vat_amount || 0))
    if (col === 'article') return dir * ((a.article || '').localeCompare(b.article || ''))
    if (col === 'status') return dir * ((a.is_validated ? 1 : 0) - (b.is_validated ? 1 : 0))
    return 0
  })

  const toggleSort = (col) => setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  const SortIcon = ({ col }) => sort.col !== col
    ? <i className="ti ti-selector" style={{ fontSize: 11, opacity: .35, marginLeft: 3 }} />
    : <i className={`ti ti-sort-${sort.dir === 'asc' ? 'ascending' : 'descending'}`} style={{ fontSize: 11, color: 'var(--blue)', marginLeft: 3 }} />

  const toggleCheck = (id, e) => { e.stopPropagation(); setCheckedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  const toggleAll = () => { if (checkedIds.size === filtered.length) setCheckedIds(new Set()); else setCheckedIds(new Set(filtered.map(t => t.id))) }

  const bulkValidate = async (withVat) => {
    setBulkSaving(true)
    const ids = [...checkedIds]
    const selected = txs.filter(t => checkedIds.has(t.id))
    for (const tx of selected) {
      const bankAbs = Math.abs(tx.amount || 0)
      const net = withVat ? Math.round(bankAbs / 1.2 * 100) / 100 : bankAbs
      const vat = withVat ? Math.round((bankAbs - net) * 100) / 100 : 0
      await supabase.from('bank_transactions').update({ is_validated: true, amount_net: net, vat_amount: vat }).eq('id', tx.id)
    }
    await loadData()
    setBulkSaving(false)
    setCheckedIds(new Set())
  }

  const pct = stats.total > 0 ? Math.round(stats.validated / stats.total * 100) : 0

  const [editForm, setEditForm] = useState({})
  const [editItems, setEditItems] = useState([])
  const [vatChoice, setVatChoice] = useState(null) // true = з ПДВ, false = без ПДВ

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Завантаження...</div>

  const openForEdit = (tx) => {
    setEditForm({
      direction: tx.direction || '',
      article: tx.article || '',
      counterparty: tx.counterparty || '',
    })
    setEditItems((tx._items || []).map(i => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      amount: i.amount,
      vat_rate: i.vat_rate ?? 20,
    })))
    // Автовибір ПДВ на основі ratio
    const itemsSum = (tx._items || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    const bankAbs = Math.abs(tx.amount || 0)
    const r = itemsSum > 0 ? bankAbs / itemsSum : null
    if (r && Math.abs(r - 1.2) < 0.01) setVatChoice(false) // без ПДВ
    else if (r && Math.abs(r - 1.0) < 0.01) setVatChoice(true) // з ПДВ
    else setVatChoice(null)
    openTx(tx)
  }

  // ═══ DETAIL VIEW ═══
  if (selected) {
    const tx = selected
    const items = editItems.length > 0 ? editItems : tx._items || []
    const itemsTotal = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    const bankAbs = Math.abs(tx.amount || 0)
    const ratio = itemsTotal > 0 ? Math.round(bankAbs / itemsTotal * 1000) / 1000 : null
    const isRatio1 = ratio !== null && Math.abs(ratio - 1.0) < 0.01
    const isRatio12 = ratio !== null && Math.abs(ratio - 1.2) < 0.01
    const ratioLabel = ratio === null ? '' : isRatio1 ? 'Ціни в документі З ПДВ' : isRatio12 ? 'Ціни в документі БЕЗ ПДВ' : '⚠ Суми не збігаються'
    const ratioColor = ratio === null ? 'var(--text3)' : isRatio1 ? 'var(--blue)' : isRatio12 ? 'var(--green)' : 'var(--red)'

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => { setSelected(null); setEditItems([]) }} className="btn btn-secondary" style={{ width: 'auto', padding: '8px 14px' }}>
            <i className="ti ti-arrow-left" style={{ fontSize: 16 }} /> Назад
          </button>
          <h1 style={{ fontSize: 18, margin: 0, flex: 1 }}>Валідація: {editForm.counterparty || tx.counterparty || '—'}</h1>
          {tx.is_validated && <span style={{ fontSize: 12, background: 'var(--green-bg)', color: 'var(--green)', padding: '4px 10px', borderRadius: 6, fontWeight: 500 }}>✓ Валідовано</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: tx._docs.length > 0 ? '1fr 1fr' : '1fr', gap: 16 }}>
          {/* ЛІВА ЧАСТИНА — дані */}
          <div>
            {/* Мета — редаговане */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <div><span style={{ color: 'var(--text3)' }}>Дата:</span> <strong>{tx.date}</strong></div>
                <div>
                  <span style={{ color: 'var(--text3)' }}>Напрям: </span>
                  <select style={{ fontSize: 13, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontFamily: 'inherit',
                    color: editForm.direction === 'Доходи' ? 'var(--green)' : editForm.direction === 'Витрати' ? 'var(--red)' : 'var(--text2)' }}
                    value={editForm.direction} onChange={e => setEditForm(f => ({ ...f, direction: e.target.value }))}>
                    <option value="">—</option>
                    <option value="Доходи">Доходи</option>
                    <option value="Витрати">Витрати</option>
                    <option value="ПФД">ПФД</option>
                    <option value="Внутрішні перекази">Внутрішні перекази</option>
                    <option value="Інше">Інше</option>
                  </select>
                </div>
                <div><span style={{ color: 'var(--text3)' }}>Сума (банк):</span> <strong>{fmtInt(bankAbs)} грн</strong></div>
                <div>
                  <span style={{ color: 'var(--text3)' }}>Стаття: </span>
                  <select style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontFamily: 'inherit', maxWidth: 180,
                    color: editForm.article ? 'var(--text)' : 'var(--red)' }}
                    value={editForm.article} onChange={e => setEditForm(f => ({ ...f, article: e.target.value }))}>
                    <option value="">— без статті —</option>
                    {Object.entries(groupByType(articles)).map(([type, items]) =>
                      items.length > 0 ? <optgroup key={type} label={TYPE_LABELS[type]}>{items.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</optgroup> : null
                    )}
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}><span style={{ color: 'var(--text3)' }}>Опис:</span> <span style={{ fontSize: 12 }}>{tx.description || '—'}</span></div>
              </div>
            </div>

            {/* Items */}
            {(items.length > 0 || true) && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Позиції ({items.length})</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {ratioLabel && <span style={{ color: ratioColor, fontSize: 12, fontWeight: 500 }}>{ratioLabel}</span>}
                    <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 8px', color: 'var(--blue)', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => setEditItems(prev => [...prev, { name: '', quantity: 1, unit_price: 0, amount: 0, vat_rate: 20, _new: true }])}>
                      <i className="ti ti-plus" style={{ fontSize: 12 }} /> Додати
                    </button>
                  </div>
                </div>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Назва</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', width: 50 }}>К-сть</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', width: 80 }}>Ціна</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', width: 80 }}>Сума</th>
                      <th style={{ textAlign: 'center', padding: '4px 8px', width: 50 }}>ПДВ%</th>
                      <th style={{ width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.id || idx} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 8px' }}>
                          <input style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px', fontSize: 12, fontFamily: 'inherit' }}
                            value={it.name || ''} onChange={e => {
                              const v = e.target.value
                              setEditItems(prev => prev.map((p, i) => i === idx ? { ...p, name: v } : p))
                            }} />
                        </td>
                        <td style={{ padding: '4px 4px' }}>
                          <input type="number" style={{ width: 50, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px', fontSize: 12, textAlign: 'right', fontFamily: 'inherit' }}
                            value={it.quantity || ''} onChange={e => {
                              const q = e.target.value
                              setEditItems(prev => prev.map((p, i) => i === idx ? { ...p, quantity: q, amount: ((parseFloat(q) || 0) * (parseFloat(p.unit_price) || 0)).toFixed(2) } : p))
                            }} />
                        </td>
                        <td style={{ padding: '4px 4px' }}>
                          <input type="number" style={{ width: 75, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px', fontSize: 12, textAlign: 'right', fontFamily: 'inherit' }}
                            value={it.unit_price || ''} onChange={e => {
                              const pr = e.target.value
                              setEditItems(prev => prev.map((p, i) => i === idx ? { ...p, unit_price: pr, amount: ((parseFloat(p.quantity) || 0) * (parseFloat(pr) || 0)).toFixed(2) } : p))
                            }} />
                        </td>
                        <td style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>{fmt(it.amount)}</td>
                        <td style={{ padding: '4px 4px' }}>
                          <select style={{ width: 50, border: '1px solid var(--border)', borderRadius: 4, padding: '2px', fontSize: 11, fontFamily: 'inherit' }}
                            value={it.vat_rate || 0} onChange={e => {
                              setEditItems(prev => prev.map((p, i) => i === idx ? { ...p, vat_rate: parseFloat(e.target.value) } : p))
                            }}>
                            <option value={20}>20%</option>
                            <option value={7}>7%</option>
                            <option value={0}>0%</option>
                          </select>
                        </td>
                        <td style={{ padding: '4px 2px', textAlign: 'center' }}>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 14, padding: 2 }}
                            title="Видалити позицію"
                            onClick={async () => {
                              if (it.id) {
                                // Перевірити чи є рух на складі
                                const { data: mov } = await supabase.from('stock_movements')
                                  .select('id, product_id, quantity, type').eq('transaction_item_id', it.id).maybeSingle()
                                if (mov && mov.product_id) {
                                  // Перевірити залишок після видалення
                                  const { data: prod } = await supabase.from('product_stock')
                                    .select('computed_stock, name').eq('id', mov.product_id).maybeSingle()
                                  const currentStock = prod?.computed_stock || 0
                                  const movQty = mov.type === 'in' ? (mov.quantity || 0) : -(mov.quantity || 0)
                                  const afterDelete = currentStock - movQty
                                  if (afterDelete < 0) {
                                    if (!confirm(`Увага! Після видалення "${prod?.name || it.name}" залишок стане ${afterDelete} шт (зараз ${currentStock}). Продовжити?`)) return
                                  } else {
                                    if (!confirm(`Видалити "${it.name}"? Залишок на складі зміниться: ${currentStock} → ${afterDelete}`)) return
                                  }
                                  await supabase.from('stock_movements').delete().eq('id', mov.id)
                                } else {
                                  if (!confirm(`Видалити "${it.name}"?`)) return
                                }
                                await supabase.from('transaction_items').delete().eq('id', it.id)
                              }
                              setEditItems(prev => prev.filter((_, i) => i !== idx))
                            }}>
                            <i className="ti ti-trash" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 600 }}>
                      <td colSpan={3} style={{ padding: '6px 8px' }}>Разом</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmtInt(itemsTotal)} грн</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ padding: '4px 8px', color: 'var(--text3)' }}>Банк</td>
                      <td style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>{fmtInt(bankAbs)} грн</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ padding: '4px 8px', color: 'var(--text3)' }}>{isRatio12 ? 'ПДВ (різниця)' : 'Різниця'}</td>
                      <td style={{ textAlign: 'right', padding: '4px 8px', color: isRatio12 ? 'var(--text2)' : Math.abs(bankAbs - itemsTotal) > 1 ? 'var(--red)' : 'var(--green)', fontWeight: 500 }}>
                        {fmtInt(bankAbs - itemsTotal)} грн
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {items.length === 0 && (
              <div className="card" style={{ marginBottom: 12, color: 'var(--text3)', textAlign: 'center', padding: 20 }}>
                Немає розпізнаних позицій
              </div>
            )}

            {/* Валідовані дані */}
            {tx.is_validated && tx.amount_net != null && (
              <div className="card" style={{ marginBottom: 12, background: 'var(--green-bg)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)', marginBottom: 6 }}>✓ Валідовані дані</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 13 }}>
                  <div><span style={{ color: 'var(--text3)' }}>Без ПДВ:</span> <strong>{fmtInt(tx.amount_net)} грн</strong></div>
                  <div><span style={{ color: 'var(--text3)' }}>ПДВ:</span> <strong>{fmtInt(tx.vat_amount)} грн</strong></div>
                  <div><span style={{ color: 'var(--text3)' }}>З ПДВ:</span> <strong>{fmtInt(bankAbs)} грн</strong></div>
                </div>
              </div>
            )}

            {/* Вибір ПДВ + превʼю + валідація */}
            {!tx.is_validated && (
              <div>
                {/* Перемикач */}
                <div style={{ display: 'flex', gap: 0, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <button onClick={() => setVatChoice(false)} style={{
                    flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                    background: vatChoice === false ? 'var(--green)' : 'var(--surface)', color: vatChoice === false ? '#fff' : 'var(--text2)',
                  }}>Ціни БЕЗ ПДВ</button>
                  <button onClick={() => setVatChoice(true)} style={{
                    flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                    borderLeft: '1px solid var(--border)',
                    background: vatChoice === true ? 'var(--blue)' : 'var(--surface)', color: vatChoice === true ? '#fff' : 'var(--text2)',
                  }}>Ціни З ПДВ</button>
                </div>

                {/* Превʼю розрахунку */}
                {vatChoice !== null && (() => {
                  let previewNet, previewVat
                  if (items.length > 0) {
                    if (vatChoice) {
                      // items з ПДВ → net = item / (1 + rate/100)
                      previewNet = items.reduce((s, i) => {
                        const a = parseFloat(i.amount) || 0
                        const r = parseFloat(i.vat_rate) || 0
                        return s + (r > 0 ? a / (1 + r / 100) : a)
                      }, 0)
                    } else {
                      // items без ПДВ → net = items sum
                      previewNet = itemsTotal
                    }
                  } else {
                    previewNet = vatChoice ? bankAbs / 1.2 : bankAbs
                  }
                  previewVat = bankAbs - previewNet

                  return (
                    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8 }}>Результат перерахунку:</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Без ПДВ</div>
                          <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtInt(previewNet)} грн</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>ПДВ</div>
                          <div style={{ fontSize: 16, fontWeight: 600, color: previewVat > 0 ? 'var(--amber)' : 'var(--text3)' }}>{fmtInt(previewVat)} грн</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Сума з ПДВ</div>
                          <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtInt(previewNet + previewVat)} грн</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Банк</div>
                          <div style={{ fontSize: 16, fontWeight: 600, color: Math.abs(bankAbs - (previewNet + previewVat)) < 1 ? 'var(--green)' : 'var(--red)' }}>{fmtInt(bankAbs)} грн</div>
                          {Math.abs(bankAbs - (previewNet + previewVat)) >= 1 && (
                            <div style={{ fontSize: 10, color: 'var(--red)' }}>різниця: {fmtInt(bankAbs - (previewNet + previewVat))}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Кнопка валідації */}
                <button className="btn btn-primary" disabled={saving || vatChoice === null} onClick={() => markValidated(tx, vatChoice)} style={{ width: '100%' }}>
                  {saving ? 'Збереження...' : vatChoice === null ? 'Оберіть тип ПДВ вище' : '✓ Валідувати'}
                </button>
              </div>
            )}
            {tx.is_validated && (
              <button className="btn btn-secondary" onClick={() => unvalidate(tx)} style={{ width: '100%' }}>
                Скасувати валідацію
              </button>
            )}
          </div>

          {/* ПРАВА ЧАСТИНА — документ */}
          {tx._docs.length > 0 && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 500, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tx._docs.map((doc, i) => (
                  <button key={doc.id} onClick={async () => {
                    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 600)
                    setDocUrl(data?.signedUrl || null)
                  }} style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px',
                    cursor: 'pointer', fontSize: 11, color: 'var(--blue)', fontFamily: 'inherit',
                  }}>
                    <i className="ti ti-file-text" style={{ fontSize: 12 }} /> {doc.file_name?.substring(0, 25) || `Документ ${i + 1}`}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minHeight: 500 }}>
                {docUrl ? (
                  <iframe src={docUrl} style={{ width: '100%', height: '100%', border: 'none', minHeight: 500 }} title="Document" />
                ) : (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Завантаження документа...</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ═══ LIST VIEW ═══
  return (
    <div>
      <div className="page-header">
        <h1>Валідація даних</h1>
        <p>Перевірка та підтвердження коректності фінансових даних</p>
      </div>

      {/* Прогрес */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Прогрес валідації</span>
          <span style={{ fontSize: 13, color: pct === 100 ? 'var(--green)' : 'var(--text2)' }}>{stats.validated} / {stats.total} ({pct}%)</span>
        </div>
        <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--green)' : 'var(--blue)', borderRadius: 4, transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 12 }}>
          <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => setFilter('pending')}>
            <div className="kpi-label">Очікують</div>
            <div className="kpi-value" style={{ color: 'var(--amber)' }}>{stats.total - stats.validated}</div>
          </div>
          <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => setFilter('validated')}>
            <div className="kpi-label">Валідовано</div>
            <div className="kpi-value" style={{ color: 'var(--green)' }}>{stats.validated}</div>
          </div>
          <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => setFilter('no_items')}>
            <div className="kpi-label">Без позицій</div>
            <div className="kpi-value">{stats.total - stats.withItems}</div>
          </div>
          <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => setFilter('problems')}>
            <div className="kpi-label">Проблеми</div>
            <div className="kpi-value" style={{ color: stats.problems > 0 ? 'var(--red)' : 'var(--green)' }}>{stats.problems}</div>
          </div>
        </div>
      </div>

      {/* Пошук */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <i className="ti ti-search" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 16 }} />
        <input className="form-input" style={{ width: '100%', paddingLeft: 38 }}
          placeholder="Пошук по контрагенту..."
          value={searchText} onChange={e => { setSearchText(e.target.value); setCheckedIds(new Set()) }} />
        {searchText && <button onClick={() => { setSearchText(''); setCheckedIds(new Set()) }} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16 }}><i className="ti ti-x" /></button>}
      </div>

      {/* Фільтри */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[
          { id: 'all', label: 'Все' },
          { id: 'pending', label: 'Очікують' },
          { id: 'validated', label: 'Валідовано' },
          { id: 'problems', label: 'Проблеми' },
          { id: 'no_items', label: 'Без позицій' },
          { id: 'no_article', label: 'Без статті' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
            background: filter === f.id ? 'var(--blue)' : 'var(--surface)', color: filter === f.id ? '#fff' : 'var(--text2)',
            fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
          }}>{f.label}</button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 8, alignSelf: 'center' }}>{filtered.length} записів</span>
      </div>

      {/* Масові дії */}
      {checkedIds.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Обрано: {checkedIds.size}</span>
          <button className="btn btn-sm btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}
            onClick={() => bulkValidate(false)} disabled={bulkSaving}>
            <i className="ti ti-circle-check" style={{ fontSize: 14 }} /> Без ПДВ — валідувати
          </button>
          <button className="btn btn-sm btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => bulkValidate(true)} disabled={bulkSaving}>
            <i className="ti ti-circle-check" style={{ fontSize: 14 }} /> З ПДВ 20% — валідувати
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setCheckedIds(new Set())}>Скасувати</button>
        </div>
      )}

      {/* Таблиця */}
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 30, padding: '8px 6px' }}>
                <input type="checkbox" checked={filtered.length > 0 && checkedIds.size === filtered.length} onChange={toggleAll}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--text)' }} />
              </th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>Дата<SortIcon col="date" /></th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('counterparty')}>Контрагент<SortIcon col="counterparty" /></th>
              <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('amount')}>Банк<SortIcon col="amount" /></th>
              <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('net')}>Без ПДВ<SortIcon col="net" /></th>
              <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('vat')}>ПДВ<SortIcon col="vat" /></th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('article')}>Стаття<SortIcon col="article" /></th>
              <th style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', width: 30 }} onClick={() => toggleSort('status')}><i className="ti ti-circle-check" style={{ fontSize: 14 }} /><SortIcon col="status" /></th>
              <th>Доки</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map(tx => {
              const ratioColor = tx._ratio === null ? '' : Math.abs(tx._ratio - 1.0) < 0.01 ? 'var(--blue)' : Math.abs(tx._ratio - 1.2) < 0.01 ? 'var(--green)' : 'var(--red)'
              const isChecked = checkedIds.has(tx.id)
              return (
                <tr key={tx.id} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', background: isChecked ? 'var(--green-bg)' : '' }}
                  onClick={() => openForEdit(tx)}
                  onMouseEnter={e => { if (!isChecked) e.currentTarget.style.background = 'var(--bg)' }}
                  onMouseLeave={e => { if (!isChecked) e.currentTarget.style.background = '' }}>
                  <td style={{ padding: '8px 6px' }} onClick={e => toggleCheck(tx.id, e)}>
                    <input type="checkbox" checked={isChecked} onChange={() => {}}
                      style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--text)' }} />
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{tx.date}</td>
                  <td style={{ fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.counterparty || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500, color: tx.amount > 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                    {tx.amount > 0 ? '+' : ''}{fmtInt(tx.amount)}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text2)', fontVariantNumeric: 'tabular-nums' }}>
                    {tx.is_validated && tx.amount_net ? fmtInt(tx.amount_net) : tx._items.length > 0 ? <span style={{ color: 'var(--text3)' }}>{fmtInt(tx._itemsTotal)}</span> : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: tx.is_validated ? (tx.vat_amount > 0 ? 'var(--text2)' : 'var(--green)') : ratioColor }}>
                    {tx.is_validated ? (tx.vat_amount > 0 ? fmtInt(tx.vat_amount) : 'без ПДВ') : tx._ratio === null ? '—' : Math.abs(tx._ratio - 1.0) < 0.01 ? 'з ПДВ' : Math.abs(tx._ratio - 1.2) < 0.01 ? 'без ПДВ' : '⚠'}
                  </td>
                  <td style={{ fontSize: 12, color: tx.article ? 'var(--text2)' : 'var(--red)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tx.article || 'без статті'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {tx.is_validated
                      ? <i className="ti ti-circle-check-filled" style={{ color: 'var(--green)', fontSize: 16 }} title="Валідовано" />
                      : <i className="ti ti-circle" style={{ color: 'var(--text3)', fontSize: 16 }} title="Не валідовано" />}
                  </td>
                  <td>
                    {tx._docs.length > 0 && <i className="ti ti-file-text" style={{ color: 'var(--blue)', fontSize: 14 }} />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > 100 && <div style={{ padding: 12, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>Показано 100 з {filtered.length}</div>}
    </div>
  )
}

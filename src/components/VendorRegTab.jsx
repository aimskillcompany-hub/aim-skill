import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { VENDORS, getVendor, fillVendorForm } from '../lib/vendorForms'
import { fmt } from '../lib/fmt'

// Позиція за замовч. увімкнена: для дистриб'ютора (selectAll) — усі; інакше — ті, що містять назву вендора.
const matchInclude = (vendor, x) => vendor?.selectAll
  ? true
  : `${x.name} ${x.sku}`.toLowerCase().includes((vendor?.name || '').toLowerCase())

// Вкладка «Реєстрація у вендора»: заповнює оригінальний .xlsx-шаблон вендора даними замовлення.
// В одному замовленні можуть бути товари різних вендорів — у форму йдуть лише ОБРАНІ позиції.
// Позиції редаговані локально (назва/к-сть/додати/видалити) — не змінюють order_items.
export default function VendorRegTab({ o }) {
  const [vendorKey, setVendorKey] = useState(VENDORS[0]?.key || '')
  const [ctx, setCtx] = useState(null)      // авто-дані з замовлення
  const [form, setForm] = useState({})      // значення полів
  const [items, setItems] = useState([])    // позиції для форми (редаговані, з прапорцем include)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [includePrice, setIncludePrice] = useState(false) // ціна за замовч. порожня
  const [suppliers, setSuppliers] = useState([]) // постачальники з кодом дилера
  const vendor = getVendor(vendorKey)

  useEffect(() => {
    // Лише дилери/дистриб'ютори — постачальники із заповненим кодом дилера.
    supabase.from('contractors').select('id, name, short_name, dealer_code').eq('is_supplier', true).order('name')
      .then(({ data, error }) => { if (!error) setSuppliers((data || []).filter(s => s.dealer_code && String(s.dealer_code).trim())) })
  }, [])

  // Обрати дилера зі списку → підтягнути назву дистриб'ютора (D15) + код дилера (D3)
  const pickDealer = (id) => {
    const s = suppliers.find(x => x.id === id)
    if (!s) return
    setForm(f => ({ ...f, distributor: s.short_name || s.name || f.distributor, dealerCode: s.dealer_code || f.dealerCode }))
  }

  // Авто-дані + позиції
  useEffect(() => {
    let cancel = false
    ;(async () => {
      const [{ data: comp }, { data: client }, { data: contacts }, { data: its }, { data: subs }] = await Promise.all([
        o.company_id ? supabase.from('companies').select('short_name, name, edrpou, address').eq('id', o.company_id).maybeSingle() : { data: null },
        o.client_id ? supabase.from('contractors').select('name, edrpou, phone, email, contact_person, legal_address, address').eq('id', o.client_id).maybeSingle() : { data: null },
        o.client_id ? supabase.from('contractor_contacts').select('name, phone, email, is_signer').eq('contractor_id', o.client_id) : { data: [] },
        supabase.from('order_items').select('name, sku, qty, unit_price').eq('order_id', o.id).order('created_at'),
        supabase.from('supplier_orders').select('supplier_id, contractors:supplier_id(name)').eq('order_id', o.id),
      ])
      if (cancel) return
      const signer = (contacts || []).find(c => c.is_signer) || (contacts || [])[0]
      const contactStr = [client?.phone, client?.email].filter(Boolean).join('\n') ||
        [signer?.phone, signer?.email].filter(Boolean).join('\n') || ''
      const distributor = (subs || []).map(s => s.contractors?.name).filter(Boolean)[0] || ''
      setCtx({
        company: comp?.short_name || comp?.name || '',
        companyEdrpou: comp?.edrpou || '',
        companyAddress: comp?.address || '',
        clientName: client?.name || o.contractors?.name || '',
        clientEdrpou: client?.edrpou || '',
        clientAddress: client?.legal_address || client?.address || '',
        clientContact: contactStr,
        responsible: signer?.name || client?.contact_person || '',
        distributor,
        procurementId: o.procurement_id || '',
        procurementUrl: o.procurement_url || '',
      })
      setItems((its || []).map(x => {
        const it = { name: x.name || '', sku: x.sku || '', qty: Number(x.qty) || 0, price: Number(x.unit_price) || 0 }
        return { ...it, include: matchInclude(vendor, it) }
      }))
    })()
    return () => { cancel = true }
  }, [o.id])

  // Зміна вендора → перерахувати, які позиції за замовч. увімкнені (ручні правки назв/к-стей не втрачаються).
  useEffect(() => {
    if (!vendor) return
    setItems(arr => arr.map(x => ({ ...x, include: matchInclude(vendor, x) })))
  }, [vendorKey])

  // Форма під вендора
  useEffect(() => {
    if (!vendor || !ctx) return
    const dealerKey = `vendor_${vendor.key}_dealer_${o.company_id || ''}`
    let savedDealer = ''
    try { savedDealer = localStorage.getItem(dealerKey) || '' } catch {}
    const next = {}
    for (const f of vendor.fields) {
      if (f.auto && ctx[f.auto]) next[f.key] = ctx[f.auto]
      else if (f.key === 'dealerCode' && savedDealer) next[f.key] = savedDealer
      else next[f.key] = f.default || ''       // стале значення за замовч. (напр. договір/ОКПО Комел)
    }
    setForm(next)
  }, [vendorKey, ctx])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Редагування позицій ЛОКАЛЬНО для форми (не змінює order_items) — вибір/назва/к-сть/додати/видалити
  const setItem = (i, patch) => setItems(arr => arr.map((x, j) => j === i ? { ...x, ...patch } : x))
  const toggle = (i) => setItem(i, { include: !items[i]?.include })
  const addItem = () => setItems(arr => [...arr, { name: '', sku: '', qty: 1, price: 0, include: true }])
  const removeItem = (i) => setItems(arr => arr.filter((_, j) => j !== i))

  const selectedItems = useMemo(() => items.filter(x => x.include), [items])
  const isJoin = vendor?.items?.mode === 'join'
  const maxRows = vendor?.items?.maxRows || 4
  const overflow = selectedItems.length - maxRows

  const generate = async () => {
    setBusy(true); setMsg(null)
    try {
      const values = { ...form }
      for (const f of vendor.fields) {
        if (f.type === 'date' && values[f.key]) values[f.key] = new Date(values[f.key])
      }
      try { if (form.dealerCode) localStorage.setItem(`vendor_${vendor.key}_dealer_${o.company_id || ''}`, form.dealerCode) } catch {}
      // Ціна — лише якщо увімкнено «Вказувати ціну», інакше порожня
      const outItems = selectedItems.map(x => ({ ...x, price: includePrice ? x.price : null }))
      const blob = await fillVendorForm(vendor, values, outItems)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = vendor.fileName(o); a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg(e.message || 'Помилка формування')
    } finally { setBusy(false) }
  }

  if (!ctx) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
          <label>Вендор</label>
          <select className="form-input" value={vendorKey} onChange={e => setVendorKey(e.target.value)}>
            {VENDORS.map(v => <option key={v.key} value={v.key}>{v.name}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={busy || selectedItems.length === 0}>
          {busy ? 'Формування…' : <><i className="ti ti-file-spreadsheet" /> Сформувати {vendor?.name}</>}
        </button>
      </div>
      {msg && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}><i className="ti ti-alert-circle" /> {msg}</div>}

      {vendor.fields.some(f => f.key === 'dealerCode' || f.key === 'distributor') && (
      <div className="form-group" style={{ marginBottom: 14 }}>
        <label>Обрати дилера (дистриб'ютора) <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 11 }}>· підтягне назву й код дилера</span></label>
        <select className="form-input" defaultValue="" onChange={e => { pickDealer(e.target.value); e.target.value = '' }} style={{ maxWidth: 420 }} disabled={!suppliers.length}>
          <option value="">{suppliers.length ? '— обрати дилера —' : '— немає дилерів з кодом —'}</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{(s.short_name || s.name)} · код {s.dealer_code}</option>)}
        </select>
        {!suppliers.length && <span style={{ fontSize: 11, color: 'var(--text3)' }}>Заповніть «Код компанії у дилера» в картці постачальника — і він з'явиться тут.</span>}
      </div>
      )}

      <div className="form-grid">
        {vendor.fields.map(f => (
          <div className={`form-group ${f.type === 'text' ? 'full' : ''}`} key={f.key}>
            <label>{f.label}{f.auto && <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 11 }}> · з замовлення</span>}</label>
            {f.type === 'text'
              ? <textarea className="form-input" rows={2} value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
              : <input className="form-input" type={f.type === 'date' ? 'date' : 'text'} value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} />}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          Устаткування для {vendor.name} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· обрано {selectedItems.length}{isJoin ? '' : ` (у форму — до ${maxRows})`}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{vendor.selectAll ? 'Обрано всі товари закупівлі — зніміть зайві за потреби.' : 'Позначте позиції цього вендора (авто-підбір за назвою — перевірте).'}</span>
          {!isJoin && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)', marginLeft: 'auto', cursor: 'pointer' }}>
            <input type="checkbox" checked={includePrice} onChange={e => setIncludePrice(e.target.checked)} style={{ width: 15, height: 15 }} /> Вказувати ціну
          </label>
          )}
        </div>
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table><thead><tr><th style={{ width: 34 }}></th><th>Модель / артикул</th><th style={{ textAlign: 'right', width: 80 }}>К-сть</th>{includePrice && <th style={{ textAlign: 'right', width: 110 }}>Ціна</th>}<th style={{ width: 34 }}></th></tr></thead>
            <tbody>{items.map((x, i) => {
              const on = !!x.include
              const over = on && !isJoin && items.slice(0, i + 1).filter(y => y.include).length > maxRows // понад ліміт → не увійде
              return (
                <tr key={i} style={{ opacity: on ? 1 : 0.55 }}>
                  <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: 16 }}><input type="checkbox" checked={on} onChange={() => toggle(i)} style={{ width: 16, height: 16, cursor: 'pointer' }} /></td>
                  <td>
                    <input className="form-input" value={x.name} onChange={e => setItem(i, { name: e.target.value })} placeholder="Назва позиції" style={{ width: '100%', fontSize: 13.5, padding: '8px 10px' }} />
                    {(x.sku || over) && <div style={{ fontSize: 11, marginTop: 3 }}>{x.sku && <span style={{ color: 'var(--text3)' }}>арт. {x.sku}</span>}{over && <span style={{ color: 'var(--amber, #b45309)' }}>{x.sku ? ' · ' : ''}понад ліміт</span>}</div>}
                  </td>
                  <td style={{ textAlign: 'right', verticalAlign: 'top' }}><input className="form-input" type="number" min="0" value={x.qty} onChange={e => setItem(i, { qty: e.target.value })} style={{ width: 90, fontSize: 13.5, padding: '8px 10px', textAlign: 'right' }} /></td>
                  {includePrice && <td style={{ textAlign: 'right' }}>{fmt(x.price)}</td>}
                  <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: 10 }}><button className="btn-icon" onClick={() => removeItem(i)} title="Видалити позицію" style={{ color: 'var(--text3)' }}><i className="ti ti-x" /></button></td>
                </tr>
              )
            })}
            {items.length === 0 && <tr><td colSpan={includePrice ? 5 : 4} style={{ color: 'var(--text3)', fontSize: 12.5, padding: 10 }}>Позицій немає — додайте нижче або у вкладці «Товари».</td></tr>}
            </tbody>
          </table>
        </div>
        <button className="btn" onClick={addItem} style={{ marginTop: 8, fontSize: 12.5 }}><i className="ti ti-plus" /> Додати позицію</button>
        {!isJoin && overflow > 0 && <p style={{ fontSize: 12, color: 'var(--amber, #b45309)', marginTop: 6 }}>⚠ Обрано {selectedItems.length}, у шаблон {vendor.name} увійде лише перші {maxRows}. Решту {overflow} надішліть окремо (як зазначено у формі) або зменшіть вибір.</p>}
      </div>
    </div>
  )
}

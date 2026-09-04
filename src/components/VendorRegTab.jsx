import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { VENDORS, getVendor, fillVendorForm } from '../lib/vendorForms'
import { fmt } from '../lib/fmt'

// Вкладка «Реєстрація у вендора»: заповнює оригінальний .xlsx-шаблон вендора даними замовлення.
// В одному замовленні можуть бути товари різних вендорів — у форму йдуть лише ОБРАНІ позиції
// (авто-підбір за назвою/артикулом, що містить назву вендора; можна коригувати галочками).
export default function VendorRegTab({ o }) {
  const [vendorKey, setVendorKey] = useState(VENDORS[0]?.key || '')
  const [ctx, setCtx] = useState(null)      // авто-дані з замовлення
  const [form, setForm] = useState({})      // значення полів
  const [items, setItems] = useState([])    // усі позиції замовлення
  const [sel, setSel] = useState(new Set()) // індекси обраних позицій
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [suppliers, setSuppliers] = useState([]) // постачальники з кодом дилера
  const vendor = getVendor(vendorKey)

  useEffect(() => {
    supabase.from('contractors').select('id, name, short_name, dealer_code').eq('is_supplier', true).order('name')
      .then(({ data, error }) => { if (!error) setSuppliers(data || []) })
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
        o.company_id ? supabase.from('companies').select('short_name, name').eq('id', o.company_id).maybeSingle() : { data: null },
        o.client_id ? supabase.from('contractors').select('name, edrpou, phone, email, contact_person').eq('id', o.client_id).maybeSingle() : { data: null },
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
        clientName: client?.name || o.contractors?.name || '',
        clientEdrpou: client?.edrpou || '',
        clientContact: contactStr,
        responsible: signer?.name || client?.contact_person || '',
        distributor,
      })
      setItems((its || []).map(x => ({ name: x.name || '', sku: x.sku || '', qty: Number(x.qty) || 0, price: Number(x.unit_price) || 0 })))
    })()
    return () => { cancel = true }
  }, [o.id])

  // Авто-підбір обраних позицій під вендора (при завантаженні позицій і зміні вендора).
  // Ручні галочки не затираються (ефект не залежить від sel).
  useEffect(() => {
    if (!vendor || !items.length) { setSel(new Set()); return }
    const needle = vendor.name.toLowerCase()
    const next = new Set()
    items.forEach((x, i) => { if (`${x.name} ${x.sku}`.toLowerCase().includes(needle)) next.add(i) })
    setSel(next)
  }, [vendorKey, items])

  // Форма під вендора
  useEffect(() => {
    if (!vendor || !ctx) return
    const dealerKey = `vendor_${vendor.key}_dealer_${o.company_id || ''}`
    let savedDealer = ''
    try { savedDealer = localStorage.getItem(dealerKey) || '' } catch {}
    const next = {}
    for (const f of vendor.fields) {
      if (f.auto) next[f.key] = ctx[f.auto] || ''
      else if (f.key === 'dealerCode') next[f.key] = savedDealer
      else next[f.key] = ''
    }
    setForm(next)
  }, [vendorKey, ctx])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggle = (i) => setSel(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })

  const selectedItems = useMemo(() => items.filter((_, i) => sel.has(i)), [items, sel])
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
      const blob = await fillVendorForm(vendor, values, selectedItems)
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

      <div className="form-group" style={{ marginBottom: 14 }}>
        <label>Обрати дилера (дистриб'ютора) <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 11 }}>· підтягне назву й код дилера</span></label>
        <select className="form-input" defaultValue="" onChange={e => { pickDealer(e.target.value); e.target.value = '' }} style={{ maxWidth: 420 }}>
          <option value="">— обрати постачальника —</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{(s.short_name || s.name)}{s.dealer_code ? ` · код ${s.dealer_code}` : ''}</option>)}
        </select>
      </div>

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
          Устаткування для {vendor.name} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· обрано {selectedItems.length} (у форму — до {maxRows})</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Позначте позиції цього вендора (авто-підбір за назвою — перевірте).</div>
        {items.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--text3)' }}>У замовленні немає позицій — додайте товари у вкладці «Товари».</p>
          : (
            <div className="tbl-wrap" style={{ border: 'none' }}>
              <table><thead><tr><th style={{ width: 34 }}></th><th>Модель / артикул</th><th style={{ textAlign: 'right', width: 70 }}>К-сть</th><th style={{ textAlign: 'right', width: 110 }}>Ціна</th></tr></thead>
                <tbody>{items.map((x, i) => {
                  const on = sel.has(i)
                  const over = on && [...sel].filter(j => j <= i).length > maxRows // понад ліміт → не увійде
                  return (
                    <tr key={i} style={{ opacity: on ? 1 : 0.5 }}>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={on} onChange={() => toggle(i)} style={{ width: 16, height: 16, cursor: 'pointer' }} /></td>
                      <td>{x.name}{x.sku ? <span style={{ color: 'var(--text3)', fontSize: 11 }}> · {x.sku}</span> : ''}{over && <span style={{ color: 'var(--amber, #b45309)', fontSize: 11 }}> · понад ліміт</span>}</td>
                      <td style={{ textAlign: 'right' }}>{x.qty}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(x.price)}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
        {overflow > 0 && <p style={{ fontSize: 12, color: 'var(--amber, #b45309)', marginTop: 6 }}>⚠ Обрано {selectedItems.length}, у шаблон Canon увійде лише перші {maxRows}. Решту {overflow} надішліть окремо (як зазначено у формі) або зменшіть вибір.</p>}
      </div>
    </div>
  )
}

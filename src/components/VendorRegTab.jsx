import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { VENDORS, getVendor, fillVendorForm } from '../lib/vendorForms'
import { fmt } from '../lib/fmt'

// Вкладка «Реєстрація у вендора»: заповнює оригінальний .xlsx-шаблон вендора даними замовлення.
export default function VendorRegTab({ o }) {
  const [vendorKey, setVendorKey] = useState(VENDORS[0]?.key || '')
  const [ctx, setCtx] = useState(null)      // авто-дані з замовлення
  const [form, setForm] = useState({})      // значення полів (авто + ручні)
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const vendor = getVendor(vendorKey)

  // Зібрати авто-дані: компанія, клієнт (ЄДРПОУ/контакт/відповідальний), дистриб'ютор, позиції
  useEffect(() => {
    let cancel = false
    ;(async () => {
      const [{ data: comp }, { data: client }, { data: contacts }, { data: its }, { data: subs }] = await Promise.all([
        o.company_id ? supabase.from('companies').select('short_name, name').eq('id', o.company_id).maybeSingle() : { data: null },
        o.client_id ? supabase.from('contractors').select('name, edrpou, phone, email, contact_person').eq('id', o.client_id).maybeSingle() : { data: null },
        o.client_id ? supabase.from('contractor_contacts').select('name, phone, email, is_signer').eq('contractor_id', o.client_id) : { data: [] },
        supabase.from('order_items').select('name, qty, unit_price, vat_rate, price_includes_vat').eq('order_id', o.id).order('created_at'),
        supabase.from('supplier_orders').select('supplier_id, contractors:supplier_id(name)').eq('order_id', o.id),
      ])
      if (cancel) return
      const signer = (contacts || []).find(c => c.is_signer) || (contacts || [])[0]
      const contactStr = [client?.phone, client?.email].filter(Boolean).join('\n') ||
        [signer?.phone, signer?.email].filter(Boolean).join('\n') || ''
      const distributor = (subs || []).map(s => s.contractors?.name).filter(Boolean)[0] || ''
      const auto = {
        company: comp?.short_name || comp?.name || '',
        clientName: client?.name || o.contractors?.name || '',
        clientEdrpou: client?.edrpou || '',
        clientContact: contactStr,
        responsible: signer?.name || client?.contact_person || '',
        distributor,
      }
      setCtx(auto)
      // Позиції: ціна = unit_price (ціна продажу з рядка)
      setItems((its || []).map(x => ({ name: x.name, qty: Number(x.qty) || 0, price: Number(x.unit_price) || 0 })))
    })()
    return () => { cancel = true }
  }, [o.id])

  // Ініціалізувати форму під обраного вендора (авто-поля з ctx, ручні — з памʼяті/порожні)
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

  const shownItems = useMemo(() => items.slice(0, vendor?.items?.maxRows || 4), [items, vendor])
  const overflow = items.length - shownItems.length

  const generate = async () => {
    setBusy(true); setMsg(null)
    try {
      // Ручні дати → Date; текст лишаємо як є
      const values = { ...form }
      for (const f of vendor.fields) {
        if (f.type === 'date' && values[f.key]) values[f.key] = new Date(values[f.key])
      }
      // Памʼятаємо код дилера на компанію
      try { if (form.dealerCode) localStorage.setItem(`vendor_${vendor.key}_dealer_${o.company_id || ''}`, form.dealerCode) } catch {}
      const blob = await fillVendorForm(vendor, values, items)
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
          <label>Вендор</label>
          <select className="form-input" value={vendorKey} onChange={e => setVendorKey(e.target.value)}>
            {VENDORS.map(v => <option key={v.key} value={v.key}>{v.name}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={busy} style={{ alignSelf: 'flex-end' }}>
          {busy ? 'Формування…' : <><i className="ti ti-file-spreadsheet" /> Сформувати {vendor?.name}</>}
        </button>
      </div>
      {msg && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}><i className="ti ti-alert-circle" /> {msg}</div>}

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
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Устаткування <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(з товарів замовлення, до {vendor.items.maxRows} рядків)</span></div>
        {shownItems.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--text3)' }}>У замовленні немає позицій — додайте товари у вкладці «Товари».</p>
          : (
            <div className="tbl-wrap" style={{ border: 'none' }}>
              <table><thead><tr><th>Модель</th><th style={{ textAlign: 'right', width: 70 }}>К-сть</th><th style={{ textAlign: 'right', width: 110 }}>Ціна</th></tr></thead>
                <tbody>{shownItems.map((x, i) => (
                  <tr key={i}><td>{x.name}</td><td style={{ textAlign: 'right' }}>{x.qty}</td><td style={{ textAlign: 'right' }}>{fmt(x.price)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        {overflow > 0 && <p style={{ fontSize: 12, color: 'var(--amber, #b45309)', marginTop: 6 }}>⚠ У шаблоні {vendor.items.maxRows} рядки — решта {overflow} позицій не увійде. Надішліть конфігурацію окремо (як зазначено у формі Canon) або залиште основні позиції.</p>}
      </div>
    </div>
  )
}

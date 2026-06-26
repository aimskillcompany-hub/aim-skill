import { useEffect, useRef, useState } from 'react'
import { fmt } from '../../lib/fmt'
import { queryPrices } from '../../lib/priceLists'

const priceLabel = (v) => (v != null && v > 0 ? fmt(v) : 'за запитом')

// Модалка підбору позиції з прайсів постачальників.
// onPick(priceRow) — повертає обраний рядок supplier_prices.
export default function PricePickerModal({ onPick, onClose }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const timerRef = useRef(null)

  const fetch = async (term) => {
    setLoading(true)
    setRows(await queryPrices({ q: term, page: 0, pageSize: 60 }))
    setLoading(false)
  }
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fetch(q), 300)
    return () => clearTimeout(timerRef.current)
  }, [q]) // eslint-disable-line

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>Підбір з прайсів</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>

        <input className="form-input" autoFocus placeholder="Назва товару або артикул…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 12 }} />

        <div className="tbl-wrap" style={{ border: 'none', maxHeight: 420, overflow: 'auto' }}>
          <table>
            <thead><tr>
              <th>Найменування</th><th>Артикул</th><th>Постачальник</th>
              <th style={{ textAlign: 'right' }}>Закупівля</th><th style={{ textAlign: 'right' }}>Роздріб</th><th>Наявність</th><th />
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ color: 'var(--text3)', padding: 16 }}>Завантаження…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--text3)', textAlign: 'center', padding: 16 }}>Нічого не знайдено.</td></tr>}
              {!loading && rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onPick(r)}>
                  <td><div className="trunc" title={r.name}>{r.name}</div></td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.sku || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.contractors?.name || '—'}</td>
                  <td style={{ textAlign: 'right', color: r.price > 0 ? undefined : 'var(--text3)' }}>{priceLabel(r.price)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{priceLabel(r.retail_price)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.in_stock || '—'}</td>
                  <td style={{ textAlign: 'right' }}><i className="ti ti-plus" style={{ color: 'var(--blue)' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Клік по рядку додає позицію в замовлення з ціною роздробу (її можна змінити).</p>
      </div>
    </div>
  )
}

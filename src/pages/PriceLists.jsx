import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import {
  FIELDS, CURRENCY_MODES, CURRENCY_RULES, parsePriceFile, guessMapping, guessCurrency,
  guessHeaderRow, importPriceList, loadPriceListMeta, queryPrices, offersForSku,
} from '../lib/priceLists'

const PAGE = 100
const priceLabel = (v) => (v != null && v > 0 ? fmt(v) : 'за запитом')

export default function PriceLists() {
  const [tab, setTab] = useState('search') // search | import
  const [meta, setMeta] = useState([])
  const loadMeta = () => loadPriceListMeta().then(setMeta)
  useEffect(() => { loadMeta() }, [])

  return (
    <div>
      <div className="page-header"><h1>Прайси постачальників</h1></div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
        {[['search', 'Пошук / порівняння', 'ti-search'], ['import', 'Імпорт прайсу', 'ti-upload']].map(([id, lbl, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: tab === id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab === id ? 'var(--blue)' : 'var(--text2)',
          }}><i className={`ti ${icon}`} />{lbl}</button>
        ))}
      </div>

      {tab === 'search' ? <SearchPanel meta={meta} /> : <ImportPanel meta={meta} onImported={loadMeta} />}
    </div>
  )
}

// ───────── Перегляд / пошук / порівняння ─────────
function SearchPanel({ meta }) {
  const [q, setQ] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const timerRef = useRef(null)

  const suppliers = useMemo(() => {
    const m = new Map()
    meta.forEach(x => { if (x.supplier_id && !m.has(x.supplier_id)) m.set(x.supplier_id, x.contractors?.name || '—') })
    return [...m.entries()]
  }, [meta])
  const totalRows = meta.reduce((s, m) => s + (m.rows_count || 0), 0)

  const fetchPage = async (p, { append } = {}) => {
    setLoading(true)
    const data = await queryPrices({ q, supplierId, page: p, pageSize: PAGE })
    setRows(prev => append ? [...prev, ...data] : data)
    setHasMore(data.length === PAGE)
    setLoading(false)
  }

  // дебаунс при зміні запиту/постачальника
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { setPage(0); fetchPage(0) }, 300)
    return () => clearTimeout(timerRef.current)
  }, [q, supplierId]) // eslint-disable-line

  const loadMore = () => { const n = page + 1; setPage(n); fetchPage(n, { append: true }) }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="form-input" autoFocus placeholder="Назва товару або артикул…" value={q}
          onChange={e => setQ(e.target.value)} style={{ flex: '1 1 280px', maxWidth: 420 }} />
        <select className="form-input" value={supplierId} onChange={e => setSupplierId(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">Усі постачальники</option>
          {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalRows ? `${totalRows.toLocaleString('uk')} позицій у ${meta.length} прайсах` : 'прайси ще не імпортовані'}</span>
      </div>

      {loading && rows.length === 0 ? (
        <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>
      ) : rows.length === 0 ? (
        <div className="card"><p style={{ color: 'var(--text3)', textAlign: 'center', padding: 24 }}>{q ? 'Нічого не знайдено.' : 'Прайси ще не імпортовані.'}</p></div>
      ) : (
        <div className="card">
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <th>Найменування</th><th>Артикул</th><th>Бренд</th><th>Постачальник</th>
                <th style={{ textAlign: 'right' }}>Закупівля</th><th style={{ textAlign: 'right' }}>Роздріб</th><th>Гарантія</th><th>Наявність</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(r)}>
                    <td><div className="trunc" title={r.name}>{r.name}</div>{r.category && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.category}</div>}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.sku || '—'}{r.uktzed && <div style={{ fontSize: 11, color: 'var(--text3)' }}>УКТЗД {r.uktzed}</div>}</td>
                    <td style={{ fontSize: 12 }}>{r.brand || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.contractors?.name || '—'}</td>
                    <td style={{ textAlign: 'right', color: r.price > 0 ? undefined : 'var(--text3)' }}>
                      {priceLabel(r.price)}
                      {r.currency === 'USD' && r.price_original != null && r.price > 0 && <div style={{ fontSize: 11, color: 'var(--text3)' }}>${r.price_original}</div>}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{priceLabel(r.retail_price)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{[r.warranty, r.warranty_term].filter(Boolean).join(' ') || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.in_stock || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && <div style={{ textAlign: 'center', marginTop: 12 }}><button className="btn" onClick={loadMore} disabled={loading}>{loading ? 'Завантаження…' : 'Показати ще'}</button></div>}
          <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Клік по рядку — деталі та порівняння за артикулом. «За запитом» — ціни немає у прайсі.</p>
        </div>
      )}

      {selected && <PriceDetailModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ───────── Картка позиції прайсу ─────────
function PriceDetailModal({ row, onClose }) {
  const [offers, setOffers] = useState(null)
  useEffect(() => { offersForSku(row.sku).then(setOffers) }, [row.sku])

  const Field = ({ label, value }) => (
    <div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div><div style={{ fontSize: 14 }}>{value || '—'}</div></div>
  )

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header"><h2 style={{ fontSize: 16 }}>{row.name}</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Field label="Артикул" value={row.sku} />
          <Field label="Код УКТЗД" value={row.uktzed} />
          <Field label="Бренд" value={row.brand} />
          <Field label="Категорія" value={row.category} />
          <Field label="Постачальник" value={row.contractors?.name} />
          <Field label="Одиниця" value={row.unit} />
          <Field label="Закупівля" value={row.price > 0 ? `${fmt(row.price)} грн${row.currency === 'USD' && row.price_original ? ` ($${row.price_original})` : ''}` : 'за запитом'} />
          <Field label="Роздріб" value={row.retail_price > 0 ? `${fmt(row.retail_price)} грн` : 'за запитом'} />
          <Field label="ПДВ" value={row.vat_rate != null ? `${row.vat_rate}%` : '—'} />
          <Field label="Гарантія" value={[row.warranty, row.warranty_term].filter(Boolean).join(' ')} />
          <Field label="Наявність" value={row.in_stock} />
        </div>

        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Пропозиції за артикулом {row.sku || ''}</div>
        {offers == null ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Завантаження…</p>
          : offers.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Інших пропозицій з ціною немає.</p>
          : (
            <div className="tbl-wrap" style={{ border: 'none' }}>
              <table>
                <thead><tr><th>Постачальник</th><th style={{ textAlign: 'right' }}>Закупівля</th><th style={{ textAlign: 'right' }}>Роздріб</th><th>Наявність</th></tr></thead>
                <tbody>
                  {offers.map((o, i) => (
                    <tr key={o.id}>
                      <td style={{ fontSize: 13 }}>{o.contractors?.name || '—'}{i === 0 && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>найдешевше</span>}</td>
                      <td style={{ textAlign: 'right', fontWeight: i === 0 ? 600 : 400, color: i === 0 ? 'var(--green)' : undefined }}>{fmt(o.price)}{o.currency === 'USD' && o.price_original ? <span style={{ fontSize: 11, color: 'var(--text3)' }}> (${o.price_original})</span> : ''}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{priceLabel(o.retail_price)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{o.in_stock || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}

// ───────── Імпорт ─────────
function ImportPanel({ meta, onImported }) {
  const { user } = useUser()
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [fileName, setFileName] = useState('')
  const [aoa, setAoa] = useState(null)
  const [headerRow, setHeaderRow] = useState(0)
  const [map, setMap] = useState({})
  const [usdRate, setUsdRate] = useState('')
  const [vatRate, setVatRate] = useState('20')
  const [currency, setCurrency] = useState({ mode: 'uah', col: null, rule: 'one_is_uah' })
  const [defaultUnit, setDefaultUnit] = useState('шт')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('contractors').select('id, name').eq('is_supplier', true).order('name').then(({ data }) => setSuppliers(data || []))
  }, [])

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setError(null); setResult(null)
    setFileName(f.name)
    try {
      const rows = await parsePriceFile(f)
      const hr = guessHeaderRow(rows)
      setAoa(rows)
      setHeaderRow(hr)
      setMap(guessMapping(rows[hr] || []))
      setCurrency(guessCurrency(rows[hr] || []))
    } catch (err) { setError('Не вдалося прочитати файл: ' + err.message) }
  }

  // Якщо для постачальника вже є збережений мапінг — підставити його
  useEffect(() => {
    if (!supplierId || !aoa) return
    const prev = meta.find(m => m.supplier_id === supplierId)?.column_map
    if (prev) {
      const { headerRow: hr, currency: cur, defaultUnit: du, ...m } = prev
      if (hr != null) setHeaderRow(hr)
      if (cur) setCurrency(cur)
      if (du != null) setDefaultUnit(du)
      setMap(m)
    }
  }, [supplierId]) // eslint-disable-line

  const headers = aoa?.[headerRow] || []
  const preview = aoa ? aoa.slice(headerRow + 1, headerRow + 6) : []
  const colOptions = headers.map((h, i) => ({ i, label: `${i + 1}. ${h || '(без назви)'}` }))

  const needsRate = currency.mode === 'usd' || currency.mode === 'column'
  const canImport = supplierId && aoa && map.name != null && !busy && !(needsRate && !Number(usdRate))

  const doImport = async () => {
    setBusy(true); setError(null); setResult(null); setProgress({ done: 0, total: 0 })
    try {
      const res = await importPriceList(
        { supplierId, fileName, map, headerRow, rows: aoa, userId: user?.id, usdRate, vatRate, currency, defaultUnit },
        (done, total) => setProgress({ done, total })
      )
      setResult(res); setAoa(null); setFileName(''); setMap({}); onImported()
    } catch (err) { setError('Помилка імпорту: ' + err.message) }
    setBusy(false); setProgress(null)
  }

  const delList = async (id) => {
    await supabase.from('supplier_price_lists').delete().eq('id', id)
    onImported()
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Завантажити прайс (Excel)</div>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div className="form-group"><label>Постачальник *</label>
            <select className="form-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">— оберіть —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Файл .xlsx / .xls</label>
            <input className="form-input" type="file" accept=".xlsx,.xls" onChange={onFile} />
          </div>
        </div>

        {aoa && (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}><label>Рядок заголовків</label>
                <input className="form-input" type="number" min={1} value={headerRow + 1} onChange={e => setHeaderRow(Math.max(0, (Number(e.target.value) || 1) - 1))} style={{ width: 100 }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Усього рядків у файлі: {aoa.length.toLocaleString('uk')}</div>
            </div>

            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Валюта, курс і ПДВ</div>
            <div className="form-grid" style={{ marginBottom: 6 }}>
              <div className="form-group"><label>Валюта ціни закупівлі</label>
                <select className="form-input" value={currency.mode} onChange={e => setCurrency(c => ({ ...c, mode: e.target.value }))}>
                  {CURRENCY_MODES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              {currency.mode === 'column' && <>
                <div className="form-group"><label>Колонка-ознака валюти</label>
                  <select className="form-input" value={currency.col ?? ''} onChange={e => setCurrency(c => ({ ...c, col: e.target.value === '' ? null : Number(e.target.value) }))}>
                    <option value="">— оберіть —</option>
                    {colOptions.map(c => <option key={c.i} value={c.i}>{c.label}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Правило</label>
                  <select className="form-input" value={currency.rule} onChange={e => setCurrency(c => ({ ...c, rule: e.target.value }))}>
                    {CURRENCY_RULES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
              </>}
              <div className="form-group"><label>Курс USD→UAH{needsRate ? ' *' : ''}</label>
                <input className="form-input" type="number" step="0.01" placeholder="напр. 42.00" value={usdRate} onChange={e => setUsdRate(e.target.value)} disabled={currency.mode === 'uah'} />
              </div>
              <div className="form-group"><label>Ставка ПДВ, %</label>
                <input className="form-input" type="number" step="1" placeholder="20" value={vatRate} onChange={e => setVatRate(e.target.value)} />
              </div>
              <div className="form-group"><label>Одиниця за замовчуванням</label>
                <input className="form-input" placeholder="шт" value={defaultUnit} onChange={e => setDefaultUnit(e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Застосовується, якщо колонку «Одиниця» не вказано або клітинка порожня.</div>
              </div>
            </div>

            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, marginTop: 6 }}>Відповідність колонок</div>
            <div className="form-grid" style={{ marginBottom: 14 }}>
              {FIELDS.map(f => (
                <div className="form-group" key={f.key}>
                  <label>{f.label}{f.required ? ' *' : ''}</label>
                  <select className="form-input" value={map[f.key] ?? ''} onChange={e => setMap(m => ({ ...m, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                    <option value="">— немає —</option>
                    {colOptions.map(c => <option key={c.i} value={c.i}>{c.label}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {preview.length > 0 && (
              <div className="tbl-wrap" style={{ marginBottom: 14, maxHeight: 220, overflow: 'auto' }}>
                <table>
                  <thead><tr>{FIELDS.filter(f => map[f.key] != null).map(f => <th key={f.key}>{f.label}</th>)}</tr></thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i}>{FIELDS.filter(f => map[f.key] != null).map(f => <td key={f.key} style={{ fontSize: 12 }}><div className="trunc">{r[map[f.key]]}</div></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={doImport} disabled={!canImport}>
                {busy ? (progress ? `Імпорт… ${progress.done.toLocaleString('uk')}${progress.total ? '/' + progress.total.toLocaleString('uk') : ''}` : 'Імпорт…') : 'Імпортувати'}
              </button>
              {!supplierId && <span style={{ fontSize: 12, color: 'var(--text3)' }}>оберіть постачальника</span>}
              {map.name == null && <span style={{ fontSize: 12, color: 'var(--red)' }}>вкажіть колонку «Найменування»</span>}
              {needsRate && !Number(usdRate) && <span style={{ fontSize: 12, color: 'var(--red)' }}>вкажіть курс USD</span>}
            </div>
          </>
        )}

        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{error}</div>}
        {result && <div style={{ color: 'var(--green)', fontSize: 13, marginTop: 10 }}>Імпортовано {result.count.toLocaleString('uk')} позицій.</div>}
      </div>

      <div className="card">
        <div className="card-title">Завантажені прайси</div>
        {meta.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: 13 }}>Ще немає жодного прайсу.</p> : (
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>Постачальник</th><th>Файл</th><th style={{ textAlign: 'right' }}>Позицій</th><th style={{ textAlign: 'right' }}>Курс</th><th style={{ textAlign: 'right' }}>ПДВ</th><th>Оновлено</th><th /></tr></thead>
              <tbody>
                {meta.map(m => (
                  <tr key={m.id}>
                    <td>{m.contractors?.name || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}><div className="trunc">{m.file_name}</div></td>
                    <td style={{ textAlign: 'right' }}>{(m.rows_count || 0).toLocaleString('uk')}</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{m.usd_rate ? Number(m.usd_rate).toFixed(2) : '—'}</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{m.vat_rate != null ? m.vat_rate + '%' : '—'}</td>
                    <td style={{ fontSize: 12 }}>{(m.imported_at || '').slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}><button className="btn" onClick={() => delList(m.id)} title="Видалити прайс" style={{ color: 'var(--red)' }}><i className="ti ti-trash" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

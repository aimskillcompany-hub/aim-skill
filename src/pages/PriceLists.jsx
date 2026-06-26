import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt } from '../lib/fmt'
import {
  FIELDS, parsePriceFile, guessMapping, importPriceList, loadPriceListMeta, searchPrices,
} from '../lib/priceLists'

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

// ───────── Пошук / порівняння ─────────
function SearchPanel({ meta }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = async (term) => {
    setQ(term)
    if (term.trim().length < 2) { setRows(null); return }
    setLoading(true)
    setRows(await searchPrices(term))
    setLoading(false)
  }

  const totalRows = meta.reduce((s, m) => s + (m.rows_count || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="form-input" autoFocus placeholder="Назва товару або артикул…" value={q}
          onChange={e => run(e.target.value)} style={{ flex: '1 1 320px', maxWidth: 480 }} />
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalRows ? `${totalRows.toLocaleString('uk')} позицій у ${meta.length} прайсах` : 'прайси ще не імпортовані'}</span>
      </div>

      {rows == null ? (
        <div className="card"><p style={{ color: 'var(--text3)', textAlign: 'center', padding: 24 }}>Введіть назву або артикул для пошуку по всіх прайсах.</p></div>
      ) : loading ? (
        <div className="card"><p style={{ color: 'var(--text3)' }}>Пошук…</p></div>
      ) : rows.length === 0 ? (
        <div className="card"><p style={{ color: 'var(--text3)', textAlign: 'center', padding: 24 }}>Нічого не знайдено.</p></div>
      ) : (
        <div className="card">
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr>
                <th>Найменування</th><th>Артикул</th><th>Бренд</th><th>Постачальник</th>
                <th style={{ textAlign: 'right' }}>Закупівля</th><th style={{ textAlign: 'right' }}>Роздріб</th><th>Наявність</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td><div className="trunc" title={r.name}>{r.name}</div>{r.category && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.category}</div>}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.sku || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.brand || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.contractors?.name || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: i === 0 && r.price ? 600 : 400, color: i === 0 && r.price ? 'var(--green)' : undefined }}>{r.price != null ? fmt(r.price) : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{r.retail_price != null ? fmt(r.retail_price) : '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.in_stock || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Відсортовано за ціною закупівлі (найдешевше — зверху). Показано до 80 позицій.</p>
        </div>
      )}
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
      setAoa(rows)
      setHeaderRow(0)
      setMap(guessMapping(rows[0] || []))
    } catch (err) { setError('Не вдалося прочитати файл: ' + err.message) }
  }

  // Якщо для постачальника вже є збережений мапінг — підставити його
  useEffect(() => {
    if (!supplierId || !aoa) return
    const prev = meta.find(m => m.supplier_id === supplierId)?.column_map
    if (prev) {
      const { headerRow: hr, ...m } = prev
      if (hr != null) setHeaderRow(hr)
      setMap(m)
    }
  }, [supplierId]) // eslint-disable-line

  const headers = aoa?.[headerRow] || []
  const preview = aoa ? aoa.slice(headerRow + 1, headerRow + 6) : []
  const colOptions = headers.map((h, i) => ({ i, label: `${i + 1}. ${h || '(без назви)'}` }))

  const canImport = supplierId && aoa && map.name != null && !busy

  const doImport = async () => {
    setBusy(true); setError(null); setResult(null); setProgress({ done: 0, total: 0 })
    try {
      const res = await importPriceList(
        { supplierId, fileName, map, headerRow, rows: aoa, userId: user?.id },
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

            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Відповідність колонок</div>
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
              <thead><tr><th>Постачальник</th><th>Файл</th><th style={{ textAlign: 'right' }}>Позицій</th><th>Оновлено</th><th /></tr></thead>
              <tbody>
                {meta.map(m => (
                  <tr key={m.id}>
                    <td>{m.contractors?.name || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}><div className="trunc">{m.file_name}</div></td>
                    <td style={{ textAlign: 'right' }}>{(m.rows_count || 0).toLocaleString('uk')}</td>
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

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useCompany } from '../lib/company'
import { supabase } from '../lib/supabase'
import { fmt } from '../lib/fmt'
import { listOutgoingDocs, traceOutgoing } from '../lib/accountantReport'
import { exportOutgoingReportPdf } from '../lib/outgoingReportPdf'

// Звіт для бухгалтера: по видатковій — простежити кожен товар до прихідної накладної (де/коли куплено).
const d = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'

const TH = { textAlign: 'left', padding: '6px 8px' }
const TD = { padding: '6px 8px' }
const COST_LABEL = { serviceAct: 'Вхідний акт', incomingWaybill: 'Прихідна', other: 'Документ' }

// Рядок нестачі: кількість, на яку не вистачило прихідних
function ShortRow({ qty, unit, pad }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)', background: '#FDECEC' }}>
      <td colSpan={3} style={{ padding: '5px 6px', paddingLeft: pad, color: 'var(--red)', fontWeight: 600 }}><i className="ti ti-alert-triangle" /> Нестача — не покрито прихідними</td>
      <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--red)', fontWeight: 600 }}>{fmt(qty)} {unit}</td>
      <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text3)' }}>—</td>
      <td />
    </tr>
  )
}

// Рекурсивний рядок джерела: прихідна накладна АБО розкрита збірка (компоненти → їх прихідні)
function SourceRows({ s, unit, openFile, indent }) {
  const pad = 6 + indent * 18
  if (s.type === 'assembly') {
    return (
      <>
        <tr style={{ borderTop: '1px solid var(--border)', background: '#F4F2FA' }}>
          <td style={{ padding: '5px 6px', paddingLeft: pad, fontWeight: 600, color: '#5B2FD6' }} colSpan={3}><i className="ti ti-tool" /> {s.docNumber || 'Збірка'}</td>
          <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(s.qty)} {unit}</td>
          <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(s.cost)} грн</td>
          <td />
        </tr>
        {(s.components || []).map((c, ci) => (
          <Fragment key={'c' + ci}>
            <tr style={{ background: '#FAFAFE' }}>
              <td style={{ padding: '4px 6px', paddingLeft: pad + 18, fontStyle: 'italic', color: 'var(--text2)' }} colSpan={3}>↳ {c.name} <span style={{ color: 'var(--text3)' }}>· {fmt(c.qty)} {c.unit}</span></td>
              <td /><td /><td />
            </tr>
            {c.sources.map((cs, csi) => <SourceRows key={'cs' + csi} s={cs} unit={c.unit} openFile={openFile} indent={indent + 2} />)}
            {c.shortQty > 0 && <ShortRow qty={c.shortQty} unit={c.unit} pad={pad + 36} />}
            {c.sources.length === 0 && !(c.shortQty > 0) && <tr><td colSpan={6} style={{ padding: '4px 6px', paddingLeft: pad + 36, color: 'var(--text3)', fontSize: 12 }}>джерело не знайдено</td></tr>}
          </Fragment>
        ))}
      </>
    )
  }
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 6px', paddingLeft: pad, color: s.type === 'doc' ? 'var(--text)' : 'var(--text3)' }}>{s.docNumber}</td>
      <td style={{ padding: '5px 6px' }}>{s.docDate ? d(s.docDate) : '—'}</td>
      <td style={{ padding: '5px 6px' }}>{s.supplierName || '—'}</td>
      <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(s.qty)} {unit}</td>
      <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(s.cost)} грн</td>
      <td style={{ padding: '5px 6px', textAlign: 'right' }}>{s.storage_path && <a onClick={() => openFile(s.storage_path)} style={{ color: 'var(--blue)', cursor: 'pointer' }}><i className="ti ti-file" /></a>}</td>
    </tr>
  )
}

export default function AccountantReport() {
  const { activeId } = useCompany()
  const [list, setList] = useState(null)
  const [sel, setSel] = useState('')
  // фільтри пошуку документа
  const [fType, setFType] = useState('all')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fContr, setFContr] = useState('')
  const [fQ, setFQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { setList(null); setReport(null); setSel(''); listOutgoingDocs().then(setList).catch(e => setErr(e.message)) }, [activeId])

  const contractors = useMemo(() => [...new Set((list || []).map(x => x.contractorName))].sort((a, b) => a.localeCompare(b, 'uk')), [list])
  const filtered = useMemo(() => {
    const q = fQ.trim().toLowerCase()
    const qNum = Number(q.replace(/\s/g, '').replace(',', '.'))
    return (list || []).filter(x => {
      if (fType !== 'all' && x.type !== fType) return false
      if (fFrom && (x.doc_date || '') < fFrom) return false
      if (fTo && (x.doc_date || '') > fTo) return false
      if (fContr && x.contractorName !== fContr) return false
      if (q) {
        const hit = (x.doc_number || '').toLowerCase().includes(q) || x.contractorName.toLowerCase().includes(q)
          || (qNum && Math.abs((Number(x.amount) || 0) - qNum) < 1)
        if (!hit) return false
      }
      return true
    })
  }, [list, fType, fFrom, fTo, fContr, fQ])
  useEffect(() => { setShowAll(false) }, [fType, fFrom, fTo, fContr, fQ])
  const LIMIT = 50
  const shown = showAll ? filtered : filtered.slice(0, LIMIT)
  const hasFilters = fType !== 'all' || fFrom || fTo || fContr || fQ
  const resetFilters = () => { setFType('all'); setFFrom(''); setFTo(''); setFContr(''); setFQ('') }
  const setPeriod = (kind) => {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth()
    const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    if (kind === 'month') { setFFrom(iso(new Date(y, m, 1))); setFTo(iso(new Date(y, m + 1, 0))) }
    if (kind === 'prev') { setFFrom(iso(new Date(y, m - 1, 1))); setFTo(iso(new Date(y, m, 0))) }
    if (kind === 'quarter') { const q0 = Math.floor(m / 3) * 3; setFFrom(iso(new Date(y, q0, 1))); setFTo(iso(new Date(y, q0 + 3, 0))) }
    if (kind === 'year') { setFFrom(`${y}-01-01`); setFTo(`${y}-12-31`) }
  }

  const build = async (id = sel) => {
    if (!id) return
    setSel(id)
    setBusy(true); setErr(null); setReport(null)
    try { setReport(await traceOutgoing(id)) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const openFile = async (path) => {
    if (!path) return
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const downloadArchive = async () => {
    if (!report) return
    setZipping(true); setErr(null)
    try {
      const { zipSync } = await import('fflate')
      const files = {}, used = {}
      const add = async (path, label) => {
        if (!path) return
        const { data } = await supabase.storage.from('documents').download(path)
        if (!data) return
        const buf = new Uint8Array(await data.arrayBuffer())
        const ext = (path.split('.').pop() || 'pdf').toLowerCase()
        let nm = label.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'doc'
        let f = `${nm}.${ext}`
        if (used[f]) { used[f]++; f = `${nm} (${used[f]}).${ext}` } else used[f] = 1
        files[f] = buf
      }
      await add(report.doc.storage_path, `${report.doc.isAct ? 'Акт' : 'Видаткова'} ${report.doc.doc_number}`)
      for (const pd of report.purchaseDocs) await add(pd.storage_path, `Прихідна ${pd.doc_number} ${pd.supplierName}`)
      for (const cd of (report.orderCostDocs || [])) await add(cd.storage_path, `${COST_LABEL[cd.type] || 'Вхідний'} ${cd.doc_number || ''} ${cd.supplierName}`)
      if (!Object.keys(files).length) { setErr('Немає файлів для архіву (документи без вкладених сканів).'); return }
      const blob = new Blob([zipSync(files)], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `Звіт по ${report.doc.isAct ? 'акту' : 'видатковій'} ${report.doc.doc_number}.zip`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErr('Помилка архіву: ' + e.message) } finally { setZipping(false) }
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ti ti-report-analytics" style={{ fontSize: 22 }} />
        <h1 style={{ margin: 0 }}>Звіт для бухгалтера</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
        Оберіть видаткову накладну або акт — система простежить кожен товар до прихідної накладної (де й коли куплено).
      </p>

      <div className="card compact" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div className="form-group">
            <label>Тип документа</label>
            <select className="form-input" value={fType} onChange={e => setFType(e.target.value)}>
              <option value="all">Усі</option>
              <option value="waybill">Видаткові накладні</option>
              <option value="serviceAct">Акти наданих послуг</option>
            </select>
          </div>
          <div className="form-group">
            <label>Дата з</label>
            <input type="date" className="form-input" value={fFrom} onChange={e => setFFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Дата по</label>
            <input type="date" className="form-input" value={fTo} onChange={e => setFTo(e.target.value)} />
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Покупець</label>
            <select className="form-input" value={fContr} onChange={e => setFContr(e.target.value)}>
              <option value="">Усі контрагенти</option>
              {contractors.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Пошук</label>
            <input className="form-input" placeholder="№ документа, контрагент або сума" value={fQ} onChange={e => setFQ(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0 10px', fontSize: 12 }}>
          <span style={{ color: 'var(--text3)', marginRight: 2 }}>Період:</span>
          {[['month', 'Цей місяць'], ['prev', 'Минулий місяць'], ['quarter', 'Квартал'], ['year', 'Рік']].map(([k, l]) => (
            <button key={k} className="btn btn-sm" style={{ minHeight: 28, padding: '4px 10px', fontSize: 12 }} onClick={() => setPeriod(k)}>{l}</button>
          ))}
          {hasFilters && <button className="btn btn-sm" style={{ minHeight: 28, padding: '4px 10px', fontSize: 12 }} onClick={resetFilters}><i className="ti ti-x" /> Скинути</button>}
          <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{list ? `Знайдено: ${filtered.length}` : 'Завантаження…'}</span>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--text3)', fontSize: 11, position: 'sticky', top: 0, background: 'var(--bg2, #fff)' }}>
              <th style={TH}>Тип</th><th style={TH}>№</th><th style={TH}>Дата</th><th style={TH}>Покупець</th><th style={{ ...TH, textAlign: 'right' }}>Сума</th>
            </tr></thead>
            <tbody>
              {shown.map(x => (
                <tr key={x.id} onClick={() => build(x.id)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', background: sel === x.id ? '#F4F2FA' : undefined }}>
                  <td style={TD}><span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: x.type === 'serviceAct' ? '#E8F4EC' : '#EEF0FB', color: x.type === 'serviceAct' ? '#2E7D4F' : '#3B4BA8' }}>{x.type === 'serviceAct' ? 'Акт' : 'Видаткова'}</span></td>
                  <td style={{ ...TD, fontWeight: sel === x.id ? 700 : 500 }}>{x.doc_number || '(без №)'}</td>
                  <td style={TD}>{d(x.doc_date)}</td>
                  <td style={TD}>{x.contractorName}</td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(x.amount)} грн</td>
                </tr>
              ))}
              {list && !filtered.length && <tr><td colSpan={5} style={{ ...TD, color: 'var(--text3)', textAlign: 'center' }}>Нічого не знайдено за цими фільтрами</td></tr>}
            </tbody>
          </table>
        </div>
        {!showAll && filtered.length > LIMIT && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>Показати всі {filtered.length}</button>}

      </div>

      {busy && <div className="card" style={{ marginBottom: 14, fontSize: 13, color: 'var(--text2)' }}><i className="ti ti-loader-2" /> Формую звіт…</div>}
      {err && <div className="card" style={{ color: 'var(--red)' }}>Помилка: {err}</div>}

      {report && (
        <>
          {/* Шапка видаткової */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {report.doc.isAct ? 'Акт наданих послуг' : 'Видаткова накладна'} № {report.doc.doc_number} <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: 13 }}>від {d(report.doc.doc_date)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={() => exportOutgoingReportPdf(report)}><i className="ti ti-file-download" /> Звіт PDF</button>
                <button className="btn btn-sm" onClick={downloadArchive} disabled={zipping}><i className="ti ti-file-zip" /> {zipping ? 'Архівую…' : 'Архів (.zip)'}</button>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              Покупець: <b>{report.doc.contractorName}</b>{report.doc.contractorEdrpou ? ` · ЄДРПОУ ${report.doc.contractorEdrpou}` : ''} · Сума: <b>{fmt(report.doc.amount)} грн</b>{report.doc.vat_amount ? ` (у т.ч. ПДВ ${fmt(report.doc.vat_amount)})` : ''}
            </div>
            {report.doc.storage_path && <a onClick={() => openFile(report.doc.storage_path)} style={{ color: 'var(--blue)', cursor: 'pointer', fontSize: 13 }}><i className="ti ti-file" /> Відкрити документ</a>}
          </div>

          {/* Нестача — окремий блок */}
          {report.shortages?.length > 0 && (
            <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid var(--red)', background: '#FFF6F6' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>
                <i className="ti ti-alert-triangle" /> Нестача: {report.shortages.length} {report.shortages.length === 1 ? 'позиція' : 'позицій'} без прихідних
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                На цю кількість не вистачило оприбуткованих прихідних (мінусовий залишок або прихідна не проведена на склад). Собівартість по ній у звіті не врахована.
              </div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <tbody>
                  {report.shortages.map((s, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 6px' }}>{s.name}{s.via && <span style={{ color: 'var(--text3)' }}> · компонент збірки «{s.via}»</span>}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--red)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(s.qty)} {s.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Товари + джерела (для акту — лише якщо є складські рухи) */}
          {(!report.doc.isAct || report.items.length > 0) && <div className="card" style={{ overflowX: 'auto', marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 10 }}>Товари та джерела закупівлі ({report.items.length})</div>
            {report.items.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>У документі немає складських рухів (товар не оприбутковувався/не списувався зі складу).</p>}
            {report.items.map(it => (
              <div key={it.productId} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 600 }}>{it.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>Продано: <b>{fmt(it.soldQty)} {it.unit}</b></div>
                </div>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 6 }}>
                  <thead><tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>Прихідна накладна</th>
                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>Дата</th>
                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>Постачальник</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>К-сть</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>Собівартість</th>
                    <th style={{ padding: '3px 6px' }}></th>
                  </tr></thead>
                  <tbody>
                    {it.sources.map((s, i) => <SourceRows key={i} s={s} unit={it.unit} openFile={openFile} indent={0} />)}
                    {it.shortQty > 0 && <ShortRow qty={it.shortQty} unit={it.unit} pad={6} />}
                    {it.sources.length === 0 && !(it.shortQty > 0) && <tr><td colSpan={6} style={{ padding: '5px 6px', color: 'var(--text3)' }}>Джерело не знайдено (немає прихідних рухів).</td></tr>}
                  </tbody>
                </table>
              </div>
            ))}
          </div>}

          {/* Позиції без складського руху: послуги акту / несписані рядки видаткової */}
          {report.services?.length > 0 && (
            <div className="card" style={{ overflowX: 'auto', marginBottom: 14 }}>
              <div className="card-title" style={{ marginBottom: 4 }}>{report.doc.isAct ? 'Послуги за актом' : 'Позиції без складського руху'} ({report.services.length})</div>
              {!report.doc.isAct && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Рядки видаткової, для яких не знайдено списання зі складу (послуги або товар, не проведений на склад).</div>}
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                  <th style={TH}>Найменування</th><th style={{ ...TH, textAlign: 'right' }}>К-сть</th><th style={{ ...TH, textAlign: 'right' }}>Сума</th>
                </tr></thead>
                <tbody>
                  {report.services.map((sv, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={TD}>{sv.name}</td>
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{sv.qty != null ? `${fmt(sv.qty)} ${sv.unit}` : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(sv.amount)} грн</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.doc.isAct && !report.services?.length && !report.items.length && (
            <div className="card" style={{ marginBottom: 14, fontSize: 13, color: 'var(--text3)' }}>У акті немає розпізнаних позицій — відкрийте документ і натисніть «Розпізнати», щоб побачити перелік послуг.</div>
          )}

          {/* Для акту: вхідні документи витрат по замовленню */}
          {report.doc.isAct && (
            <div className="card" style={{ overflowX: 'auto', marginBottom: 14 }}>
              <div className="card-title" style={{ marginBottom: 4 }}>Витрати по замовленню (вхідні документи)</div>
              {!report.doc.order_id
                ? <div style={{ fontSize: 13, color: 'var(--text3)' }}>Акт не прив'язаний до замовлення — вхідні документи витрат визначити неможливо.</div>
                : !report.orderCostDocs?.length
                  ? <div style={{ fontSize: 13, color: 'var(--text3)' }}>У замовленні немає вхідних актів / прихідних накладних.</div>
                  : <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      <thead><tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                        <th style={TH}>Документ</th><th style={TH}>Дата</th><th style={TH}>Постачальник</th><th style={{ ...TH, textAlign: 'right' }}>Сума</th><th style={TH}></th>
                      </tr></thead>
                      <tbody>
                        {report.orderCostDocs.map(cd => (
                          <tr key={cd.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={TD}>{COST_LABEL[cd.type] || 'Документ'} № {cd.doc_number || '—'}</td>
                            <td style={TD}>{d(cd.doc_date)}</td>
                            <td style={TD}>{cd.supplierName}</td>
                            <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(cd.amount)} грн</td>
                            <td style={{ ...TD, textAlign: 'right' }}>{cd.storage_path && <a onClick={() => openFile(cd.storage_path)} style={{ color: 'var(--blue)', cursor: 'pointer' }}><i className="ti ti-file" /></a>}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                          <td style={TD} colSpan={3}>Разом витрат</td>
                          <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(report.orderCostDocs.reduce((t, x) => t + (Number(x.amount) || 0), 0))} грн</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>}
            </div>
          )}

          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 12 }}>
            Джерело кожного товару визначається за FIFO (найраніші закупівлі списуються першими). Архів містить сам документ, усі прихідні накладні зі звіту{report.doc.isAct ? ' та вхідні документи витрат по замовленню' : ''} (з вкладеними сканами).
          </p>
        </>
      )}
    </div>
  )
}

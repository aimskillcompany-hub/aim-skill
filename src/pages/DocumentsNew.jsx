// «Документи» в новому інтерфейсі (ТЗ редизайну 4.6; макети Documents / DocumentsMobile): список ліворуч,
// швидкий перегляд праворуч, «Відкрити документ повністю» — наявне вікно документа (DocModal).
// Дані й фільтри — з Documents.jsx. Позначки «Перевірено» / «Підписано» — ті самі поля й правила, що у вікні.
// Проблеми видно в рядку: «номер двічі» (помилка 4 ТЗ 6.6), «ПДВ у договорі позики» (помилка 5).
import { useEffect, useMemo, useState } from 'react'
import { useGroupContractors } from '../lib/group'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { qc } from '../lib/companyScope'
import { useUser } from '../lib/auth'
import { getDocType } from '../lib/docgen'
import { kyivDateOfTs } from '../lib/dates'
import { formatAmount, plural } from '../utils/format'
import { Button, Menu, Segmented, EmptyState, TableSkeleton, useToast } from '../components/ui'
import './DocumentsNew.css'

const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']
const dateOf = (d) => d.doc_date ? String(d.doc_date).slice(0, 10) : kyivDateOfTs(d.created_at)
const dm = (iso) => iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : ''
const dmy = (iso) => iso ? iso.split('-').reverse().join('.') : '—'
const TYPE_TONE = { waybill: 'brand', incomingWaybill: 'info', invoice: 'warn', serviceAct: 'group', loanAgreement: 'exp', supplyAgreement: 'neutral', commercialProposal: 'neutral' }
const isIncoming = (d) => (getDocType(d.type)?.direction === 'incoming') || d.direction === 'payable'
const hasScan = (d) => d.storage_path && !/^generated\//.test(d.storage_path)

// Періоди для швидкого вибору
function periodRange(k) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth()
  const pad = (x) => String(x).padStart(2, '0'), last = (yy, mm) => new Date(yy, mm + 1, 0).getDate()
  if (k === 'month') return [`${y}-${pad(m + 1)}-01`, `${y}-${pad(m + 1)}-${pad(last(y, m))}`]
  if (k === 'quarter') { const q0 = Math.floor(m / 3) * 3; return [`${y}-${pad(q0 + 1)}-01`, `${y}-${pad(q0 + 3)}-${pad(last(y, q0 + 2))}`] }
  if (k === 'year') return [`${y}-01-01`, `${y}-12-31`]
  return ['', '']
}

export default function DocumentsNew({ rows, loading, q, setQ, typeFilter, setTypeFilter, signedFilter, setSignedFilter, verFilter, setVerFilter,
  dateFrom, dateTo, setDateFrom, setDateTo, filtered, onOpen, onUploadScan, onUploadBatch, onCreate, onRecognize, reload }) {
  const grp = useGroupContractors()
  const [period, setPeriod] = useState(() => dateFrom || dateTo ? 'custom' : 'all')
  const [selId, setSelId] = useState(null)
  const [shown, setShown] = useState(60)
  const [checked, setChecked] = useState(() => new Set())   // масовий вибір
  const [bulkBusy, setBulkBusy] = useState('')
  const { user } = useUser()
  const toast = useToast()
  // широкий екран: панель перегляду постійна (макет Documents) — відкриваємо перший документ списку
  const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1280px)').matches
  useEffect(() => { if (wide && !loading && filtered.length && !filtered.some(d => d.id === selId)) setSelId(filtered[0].id) }, [wide, loading, filtered])
  useEffect(() => { setChecked(new Set()) }, [filtered])
  const toggle = (id) => setChecked(c => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n })
  // ті самі оновлення, що й кнопки у швидкому перегляді, — для кількох документів
  const bulk = async (kind) => {
    const ids = [...checked].filter(id => kind === 'v' || !isIncoming(rows.find(d => d.id === id) || {}))
    if (!ids.length) return
    setBulkBusy(kind)
    const upd = kind === 'v' ? { is_verified: true, verified_at: new Date().toISOString(), verified_by: user?.id || null } : { is_signed: true }
    let done = 0, lastErr = null
    for (const id of ids) {
      const d = rows.find(x => x.id === id)
      const { error } = await qc('documents').update(kind === 's' ? { ...upd, signed_scan_url: d?.storage_path || d?.file_path || null } : upd).eq('id', id)
      if (error) lastErr = error; else done++
    }
    setBulkBusy('')
    toast(lastErr ? `Позначено ${done} із ${ids.length}: ${lastErr.message}` : `Позначено ${done} ${plural(done, ['документ', 'документи', 'документів'])}`, lastErr ? { type: 'error' } : undefined)
    setChecked(new Set()); reload()
  }
  const pickPeriod = (k) => { setPeriod(k); if (k !== 'custom') { const [a, b] = periodRange(k); setDateFrom(a); setDateTo(b) } }
  const state = verFilter === 'unverified' ? 'unverified' : signedFilter === 'unsigned' ? 'unsigned' : 'all'
  const setState = (v) => { setVerFilter(v === 'unverified' ? 'unverified' : 'all'); setSignedFilter(v === 'unsigned' ? 'unsigned' : 'all') }

  // Дублі номера в межах типу й року — лише для документів, які нумеруємо ми (вихідні); номер прихідної
  // ставить постачальник, і в різних постачальників він законно збігається. Список уже в межах юрособи.
  const dupes = useMemo(() => {
    const m = new Map()
    rows.forEach(d => { if (!d.doc_number || isIncoming(d)) return; const k = `${d.type}|${String(d.doc_number).trim().toUpperCase()}|${dateOf(d).slice(0, 4)}`; m.set(k, (m.get(k) || 0) + 1) })
    return (d) => d.doc_number && !isIncoming(d) && m.get(`${d.type}|${String(d.doc_number).trim().toUpperCase()}|${dateOf(d).slice(0, 4)}`) > 1
  }, [rows])
  const types = useMemo(() => {
    const c = {}; rows.forEach(d => { const t = d.type || 'other'; c[t] = (c[t] || 0) + 1 })
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [rows])
  const groups = useMemo(() => {
    const g = new Map()
    filtered.slice(0, shown).forEach(d => { const k = dateOf(d).slice(0, 7); if (!g.has(k)) g.set(k, []); g.get(k).push(d) })
    return [...g.entries()]
  }, [filtered, shown])
  const sel = rows.find(d => d.id === selId) || null

  return (
    <div className="dcn">
      <div className="dcn-head">
        <div><h1 className="dcn-h1">Документи</h1>
          <p className="dcn-sub">{rows.length} {plural(rows.length, ['документ', 'документи', 'документів'])}<span className="dcn-hide-sm"> · рахунки, накладні, акти, договори</span></p></div>
        <div className="dcn-actions">
          <Link className="btn btn-secondary dcn-hide-sm" to="/documents/gen-recon">Звірка з PDF</Link>
          <button type="button" className="dcn-cam" onClick={onUploadScan} aria-label="Сфотографувати або завантажити скан"><i className="ti ti-camera" aria-hidden="true" /></button>
          <span className="dcn-hide-sm"><Menu trigger={<Button variant="secondary" icon="ti-upload">Завантажити<i className="ti ti-chevron-down" aria-hidden="true" /></Button>} items={[
            { label: 'Скан з розпізнаванням', icon: 'ti-scan', onClick: onUploadScan },
            { label: 'Кілька файлів одразу', icon: 'ti-stack-2', onClick: onUploadBatch },
          ]} /></span>
          <Button variant="brand" icon="ti-plus" onClick={onCreate}>Створити</Button>
        </div>
      </div>

      <div className="dcn-toolbar">
        <label className="dcn-search"><i className="ti ti-search" aria-hidden="true" /><input type="search" className="form-input" placeholder="Номер, контрагент або файл" aria-label="Пошук документів" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Segmented ariaLabel="Період" className="dcn-per" value={period} onChange={pickPeriod} options={[{ value: 'month', label: 'Місяць' }, { value: 'quarter', label: 'Квартал' }, { value: 'year', label: 'Рік' }, { value: 'all', label: 'Усі' }, { value: 'custom', label: 'Період…' }]} />
        <Segmented ariaLabel="Стан" className="is-chips-sm" value={state} onChange={setState} options={[{ value: 'all', label: 'Усі' }, { value: 'unverified', label: 'Неперевірені' }, { value: 'unsigned', label: 'Без підпису' }]} />
      </div>
      {period === 'custom' && (
        <div className="dcn-period">
          <label>з <input type="date" className="form-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
          <label>по <input type="date" className="form-input" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
        </div>
      )}
      {types.length > 1 && (
        <div className="dcn-types" role="group" aria-label="Тип документа">
          <button type="button" className="dcn-type" aria-pressed={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>Усі</button>
          {types.map(([t, n]) => (
            <button key={t} type="button" className={`dcn-type is-${TYPE_TONE[t] || 'neutral'}`} aria-pressed={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}>
              <span className="dcn-dot" aria-hidden="true" />{getDocType(t)?.label || 'Інше'}<small>{n}</small></button>
          ))}
        </div>
      )}

      <div className={`dcn-body${sel ? ' has-sel' : ''}`}>
        <section className="dcn-list">
          {checked.size > 0 && (
            <div className="dcn-bulk" role="region" aria-label="Дії з вибраними">
              <b>Вибрано {checked.size}</b>
              <Button size="sm" variant="brand" icon="ti-check" loading={bulkBusy === 'v'} onClick={() => bulk('v')}>Позначити перевіреними</Button>
              <Button size="sm" variant="secondary" loading={bulkBusy === 's'} onClick={() => bulk('s')}>Позначити підписаними</Button>
              <button type="button" className="dcn-bulk-x" onClick={() => setChecked(new Set())}>Скасувати</button>
            </div>
          )}
          {loading ? <TableSkeleton rows={8} cols={2} label="Завантаження документів…" />
            : filtered.length === 0 ? <EmptyState icon="ti-files" title="Документів не знайдено" text="Змініть пошук, період або тип." />
            : <>
              {groups.map(([ym, items]) => (
                <div key={ym} className="dcn-group">
                  <div className="dcn-group-head"><span>{MONTHS[Number(ym.slice(5, 7)) - 1]} {ym.slice(0, 4)}</span><span>{items.length} док.</span></div>
                  {items.map(d => {
                    const t = getDocType(d.type)
                    const loanVat = d.type === 'loanAgreement' && Number(d.vat_amount) > 0
                    return (
                      <div key={d.id} className={`dcn-rw${d.id === selId ? ' is-on' : ''}${checked.has(d.id) ? ' is-chk' : ''}`}>
                      <input type="checkbox" className="dcn-cb" checked={checked.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Вибрати ${t?.label || 'документ'} ${d.doc_number || ''}`} />
                      <button type="button" className={`dcn-row${d.id === selId ? ' is-on' : ''}`} onClick={() => setSelId(d.id)} aria-current={d.id === selId ? 'true' : undefined}>
                        <span className={`dcn-ico is-${TYPE_TONE[d.type] || 'neutral'}`} aria-hidden="true">{t?.prefix || 'ДОК'}</span>
                        <span className="dcn-row-main">
                          <span className="dcn-row-title"><b>{d.doc_number || 'без номера'}</b><span>{t?.label || 'Документ'}</span></span>
                          <span className="dcn-row-cp">{d.contractors?.name || <i>контрагент не вказано</i>}{d.contractor_id && grp.has(d.contractor_id) && <span className="grp-chip">група</span>}</span>
                          <span className="dcn-tags">
                            {isIncoming(d) ? <span className="dcn-tag">вхідний</span> : !d.is_signed && <span className="dcn-tag is-warn">не підписано</span>}
                            {d.is_verified ? <span className="dcn-tag is-ok">перевірено</span> : <span className="dcn-tag">не перевірено</span>}
                            {dupes(d) && <span className="dcn-tag is-danger">номер {d.doc_number} двічі</span>}
                            {loanVat && <span className="dcn-tag is-danger">ПДВ у договорі позики</span>}
                            {(!d.type || d.amount == null || !d.contractor_id) && <span className="dcn-tag is-info">не розпізнано</span>}
                          </span>
                        </span>
                        <span className="dcn-row-side">
                          <b>{d.amount != null ? `${formatAmount(d.amount)} ₴` : '—'}</b>
                          {Number(d.vat_amount) > 0 && <small>ПДВ {formatAmount(d.vat_amount)}</small>}
                          <small>{dm(dateOf(d))}</small>
                        </span>
                      </button>
                      </div>
                    )
                  })}
                </div>
              ))}
              {filtered.length > shown && <div className="dcn-more"><Button variant="secondary" onClick={() => setShown(n => n + 60)}>Показати ще</Button></div>}
            </>}
        </section>
        {sel && <QuickView d={sel} dupe={dupes(sel)} onClose={() => setSelId(null)} onOpen={() => onOpen(sel)} onRecognize={() => onRecognize(sel)} reload={reload} />}
      </div>
      <button type="button" className="dcn-fab" onClick={onUploadScan} aria-label="Завантажити документ"><i className="ti ti-plus" aria-hidden="true" /></button>
    </div>
  )
}

function QuickView({ d, dupe, onClose, onOpen, onRecognize, reload }) {
  const { user } = useUser()
  const toast = useToast()
  const [url, setUrl] = useState(null)
  const [order, setOrder] = useState(null)
  const [busy, setBusy] = useState('')
  const t = getDocType(d.type)
  const path = hasScan(d) ? (d.storage_path || d.file_path) : null
  const isPdf = /\.pdf$/i.test(d.file_name || path || '') || d.file_type === 'application/pdf'
  useEffect(() => {
    setUrl(null)
    if (!path) return
    supabase.storage.from('documents').createSignedUrl(path, 600).then(({ data }) => setUrl(data?.signedUrl || null))
  }, [path])
  useEffect(() => {
    setOrder(null)
    qc('documents').select('order_id').eq('id', d.id).maybeSingle().then(({ data }) => {
      if (data?.order_id) qc('orders').select('id, order_number, status, total, paid_transaction_id').eq('id', data.order_id).maybeSingle().then(({ data: o }) => setOrder(o || null))
    })
  }, [d.id])

  // Ті самі оновлення, що й кнопки у вікні документа (DocModal): перевірено — з датою й автором; підписано — з посиланням на скан
  const setVerified = async (next) => {
    setBusy('v')
    const { error } = await qc('documents').update({ is_verified: next, verified_at: next ? new Date().toISOString() : null, verified_by: next ? (user?.id || null) : null }).eq('id', d.id)
    setBusy('')
    if (error) { toast('Не збережено: ' + error.message, { type: 'error' }); return }
    toast(next ? 'Позначено перевіреним' : 'Позначку знято'); reload()
  }
  const setSigned = async (next) => {
    setBusy('s')
    const { error } = await qc('documents').update({ is_signed: next, signed_scan_url: next ? (d.storage_path || d.file_path || null) : null }).eq('id', d.id)
    setBusy('')
    if (error) { toast('Не збережено: ' + error.message, { type: 'error' }); return }
    toast(next ? 'Позначено підписаним' : 'Позначку знято'); reload()
  }

  return (
    <aside className="dcn-qv" aria-label="Швидкий перегляд документа">
      <div className="dcn-qv-head">
        <div><span className="dcn-qv-type">{t?.label || 'Документ'}</span><h2>№ {d.doc_number || '—'}</h2></div>
        <div className="dcn-qv-btns">
          {url && <a className="btn btn-secondary btn-sm btn-icon" href={url} target="_blank" rel="noreferrer" aria-label="Відкрити файл у новій вкладці"><i className="ti ti-external-link" aria-hidden="true" /></a>}
          <Button size="sm" variant="secondary" iconOnly icon="ti-x" aria-label="Закрити перегляд" onClick={onClose} className="dcn-qv-close" />
        </div>
      </div>
      <div className="dcn-preview">
        {url ? (isPdf ? <object data={url} type="application/pdf" aria-label="Скан документа"><a href={url} target="_blank" rel="noreferrer">Відкрити PDF</a></object>
          : <img src={url} alt={`Скан: ${t?.label || 'документ'} ${d.doc_number || ''}`} />)
          : <div className="dcn-preview-empty"><i className="ti ti-file-text" aria-hidden="true" /><span>{d.source === 'generated' || d.generated_doc_id ? 'Документ сформовано в системі — друкована форма у вікні документа' : 'Скан не завантажено'}</span></div>}
      </div>
      <Button variant="primary" className="dcn-wide" onClick={onOpen}>Відкрити документ повністю <i className="ti ti-arrow-right" aria-hidden="true" /></Button>
      <p className="dcn-note">Скан поруч із розпізнаними полями, позиції, склад і проведення</p>
      <div className="dcn-qv-acts">
        <Button variant="secondary" size="sm" loading={busy === 'v'} onClick={() => setVerified(!d.is_verified)} className={d.is_verified ? '' : 'dcn-go'}>{d.is_verified ? 'Зняти «перевірено»' : 'Позначити перевіреним'}</Button>
        {!isIncoming(d) && <Button variant="secondary" size="sm" loading={busy === 's'} onClick={() => setSigned(!d.is_signed)} className={d.is_signed ? '' : 'dcn-warn'}>{d.is_signed ? 'Зняти «підписано»' : 'Позначити підписаним'}</Button>}
        {(!d.type || d.amount == null || !d.contractor_id) && path && <Button variant="secondary" size="sm" icon="ti-scan" onClick={onRecognize}>Розпізнати</Button>}
      </div>
      {dupe && <p className="dcn-alert">Номер {d.doc_number} трапляється двічі в цьому році для цього типу — перевірте нумерацію.</p>}
      {d.type === 'loanAgreement' && Number(d.vat_amount) > 0 && <p className="dcn-alert">У договорі позики вказано ПДВ {formatAmount(d.vat_amount)} ₴ — позика ПДВ не обкладається.</p>}
      <dl className="dcn-fields">
        <div className="is-wide"><dt>Контрагент</dt><dd>{d.contractor_id ? <Link to={`/contractors/${d.contractor_id}`}>{d.contractors?.name || '—'}</Link> : '—'}</dd></div>
        <div><dt>Сума з ПДВ</dt><dd className="is-big">{d.amount != null ? `${formatAmount(d.amount)} ₴` : '—'}</dd></div>
        <div><dt>у т. ч. ПДВ</dt><dd>{Number(d.vat_amount) > 0 ? `${formatAmount(d.vat_amount)} ₴` : 'без ПДВ'}</dd></div>
        <div><dt>Дата</dt><dd>{dmy(dateOf(d))}</dd></div>
        <div><dt>Файл</dt><dd className="dcn-file">{d.file_name || '—'}</dd></div>
      </dl>
      {order && (
        <div className="dcn-linked">
          <span className="dcn-small">Пов'язане</span>
          <Link to={`/orders/${order.id}`} className="dcn-order"><b>Замовлення №{order.order_number}</b><span>{formatAmount(order.total)} ₴</span></Link>
          {!order.paid_transaction_id && d.type === 'waybill' && <Link to={`/orders/${order.id}?tab=finance`} className="dcn-unpaid">Оплату ще не отримано <b>прив'язати</b></Link>}
        </div>
      )}
    </aside>
  )
}

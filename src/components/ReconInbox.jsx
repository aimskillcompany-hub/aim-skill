import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { addDaysIso, todayKyiv } from '../lib/dates'
import { fmtInt } from '../lib/fmt'
import {
  dmy, tableRow, buildProblems, explainProblem, PROBLEM_KINDS, unitFactor, linkAdd, linkRemove, setWarehouseDate,
  setManualCost, reconAck, reconUnack, searchIncomingLines,
} from '../lib/shipmentRecon'

// «Проблеми звірки» (макет «інбокс»): кожен рядок видаткової з недоліком — окрема проблема; розбираються по одній,
// як пошта: пояснення простими словами, продаж ↔ закупівля, кнопки виправлення, «не помилка — перевірено», «Скасувати».
const num = (v, dp = 0) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('uk-UA', { minimumFractionDigits: dp, maximumFractionDigits: dp })
const money = (v) => `${v < 0 ? '−' : ''}${fmtInt(v)}`
const SEV = {
  err: { background: 'var(--red-bg)', color: 'var(--red)' },
  warn: { background: 'var(--amber-bg)', color: 'var(--amber)' },
}
const badge = (sev) => ({ ...SEV[sev], alignSelf: 'flex-start', display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 })

// дії за видом проблеми: [код, підпис] — перша основна
const ACTIONS = {
  none: [['link', 'Прив\'язати прихідну'], ['manual', 'Зберегти собівартість вручну']],
  nocost: [['link', 'Прив\'язати прихідну'], ['manual', 'Зберегти собівартість вручну']],
  late: [['date', 'Виправити дату прихідної'], ['link', 'Прив\'язати іншу прихідну'], ['ack', 'Це передпродаж — все правильно']],
  loss: [['fixprice', 'Виправити ціну в прихідній'], ['link', 'Прив\'язати іншу прихідну'], ['ack', 'Збиток підтверджую']],
  high: [['manual', 'Зберегти повну собівартість'], ['link', 'Прив\'язати прихідну'], ['ack', 'Маржа правильна']],
  low: [['ack', 'Маржа правильна'], ['link', 'Прив\'язати іншу прихідну']],
  eq: [['manual', 'Зберегти собівартість'], ['link', 'Прив\'язати іншу прихідну'], ['ack', 'Продаж без націнки — так задумано']],
  other: [['merge', 'Порівняти й об\'єднати картки'], ['link', 'Прив\'язати іншу прихідну']],
  unit: [['units', 'Перерахувати одиниці'], ['link', 'Прив\'язати іншу прихідну']],
  vat: [['fixprice', 'Відкрити прихідну'], ['ack', 'ПДВ правильний']],
  mdate: [['dates', 'Вирівняти дати']],
  broken: [['unlink', 'Зняти прив\'язку']],
}
const NEEDS_INPUT = new Set(['link', 'manual', 'units', 'date'])

export default function ReconInbox({ data, canEdit, reload, onDialog, onDates, onOpenDoc, onDrawer, initialLine = null }) {
  const [filter, setFilter] = useState('all')
  const [sel, setSel] = useState(initialLine)
  // завдання, створені з проблем звірки (розділ «Задачі», source = 'recon'); рядок — за посиланням у деталях
  const [tasks, setTasks] = useState([])
  const loadTasks = () => supabase.from('tasks').select('id, title, description, due_date, status, priority, created_at').eq('source', 'recon')
    .then(({ data: t }) => setTasks(t || []))
  useEffect(() => { loadTasks() }, [])
  const [mode, setMode] = useState(null)        // дія з полем вводу, відкрита в картці
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [toast, setToast] = useState(null)      // { text, undo }
  const [fixed, setFixed] = useState(() => new Set())   // рядки, виправлені в цьому сеансі
  const nextRef = useRef(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const rows = useMemo(() => (data?.docs || []).flatMap(d => d.lines.map(l => tableRow(d, l))), [data])
  const problems = useMemo(() => buildProblems(rows, data?.acks || []), [rows, data])
  const visible = problems.filter(p => filter === 'all' || p.kind === filter)
  const counts = useMemo(() => {
    const c = {}; problems.forEach(p => { c[p.kind] = (c[p.kind] || 0) + 1 }); return c
  }, [problems])
  // виправлено = позначено перевіреним (у періоді) + зникло після дії в цьому сеансі
  const ackLines = useMemo(() => new Set((data?.acks || []).map(a => a.out_movement_id).filter(id => rows.some(x => x.line.outId === id))), [data, rows])
  const fixedNow = [...fixed].filter(id => !problems.some(p => p.id === id) && !ackLines.has(id)).length
  const doneN = ackLines.size + fixedNow
  const total = problems.length + doneN

  // після перезавантаження — відкрити наступну
  useEffect(() => {
    if (!problems.length) { setSel(null); return }
    const want = nextRef.current || (initialLine && !sel ? initialLine : null)
    if (want && visible.some(p => p.id === want)) { setSel(want); nextRef.current = null; return }
    if (!sel || !visible.some(p => p.id === sel)) setSel(visible[0]?.id || null)
  }, [problems, filter])

  const cur = visible.find(p => p.id === sel) || null
  const pos = cur ? visible.indexOf(cur) + 1 : 0
  const go = (d) => { if (!visible.length) return; const i = cur ? visible.indexOf(cur) : -1; setSel(visible[(i + d + visible.length) % visible.length].id); setMode(null); setErr(null) }

  const showToast = (text, undo) => {
    clearTimeout(timer.current)
    setToast({ text, undo })
    timer.current = setTimeout(() => setToast(null), 6000)
  }
  // виконати дію: проблема зникає, відкривається наступна; тост із «Скасувати»
  const run = async (fn, text, makeUndo) => {
    if (!cur) return
    setBusy(true); setErr(null)
    try {
      const r = await fn()
      const i = visible.indexOf(cur)
      nextRef.current = (visible[i + 1] || visible[i - 1] || {}).id || null
      setFixed(s => new Set(s).add(cur.id))
      setMode(null)
      const label = `${cur.row.doc.number}, рядок ${cur.row.lineNo}: ${typeof text === 'function' ? text(r) : text}`
      showToast(label, makeUndo ? makeUndo(r) : null)
      await reload()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const undo = async () => {
    if (!toast?.undo) return
    const u = toast.undo
    clearTimeout(timer.current); setToast(null); setBusy(true)
    try { await u(); await reload() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const ack = (kind, note) => run(() => reconAck(cur.id, kind, note), 'позначено перевіреним', (r) => r?.id ? () => reconUnack(r.id) : null)
  const doAction = (code, label) => {
    setErr(null)
    if (NEEDS_INPUT.has(code)) { setMode(m => m === code ? null : code); return }
    const x = cur.row
    if (code === 'ack') return ack(cur.kind, label)
    if (code === 'fixprice') { if (x.purDocId) onOpenDoc(x.purDocId); else setErr('У рядка немає прихідної — спершу прив\'яжіть її.'); return }
    if (code === 'merge') { if (x.src?.otherCard) onDialog({ doc: x.doc, type: 'merge', line: x.line, src: x.src }); else setErr('Прихід на іншій картці не знайдено.'); return }
    if (code === 'dates') { onDates(); return }
    if (code === 'unlink') {
      const l = (x.doc.brokenLinks || []).find(b => b.out_product_id === x.line.productId) || (x.doc.brokenLinks || [])[0]
      if (l) onDialog({ doc: x.doc, type: 'unlink', link: l, line: { name: l.productName, unit: '' }, src: { docNo: l.inDocNo } })
      return
    }
  }

  if (!data) return null
  const chipStyle = (on) => ({ fontSize: 13, padding: '5px 13px', borderRadius: 999 })
  const chips = [['all', 'Усі', problems.length], ...Object.keys(PROBLEM_KINDS).filter(k => counts[k] || k === filter).map(k => [k, PROBLEM_KINDS[k][0], counts[k] || 0])]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text3)' }}>{dmy(data.from)} – {dmy(data.to)} · розбирайте по одній, як пошту</div>
        <div style={{ minWidth: 260, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
            <span><b style={{ fontSize: 19 }}>{problems.length}</b> залишилось</span>
            <span style={{ color: 'var(--text3)' }}>виправлено {doneN} з {total}</span>
          </div>
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${total ? Math.round(doneN / total * 100) : 100}%`, background: 'var(--green)', borderRadius: 99 }} />
          </div>
        </div>
      </div>
      {data.needs078 && <div className="card" style={{ background: 'var(--amber-bg)', color: 'var(--amber)', marginBottom: 12 }}>Спершу застосуйте міграцію 078: без неї не працюють «позначити перевіреним» і ручна собівартість (решта дій — працює).</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {chips.map(([k, l, n]) => (
          <button key={k} className={'btn btn-sm' + (filter === k ? ' btn-primary' : '')} style={chipStyle(filter === k)} onClick={() => { setFilter(k); setSel(null); setMode(null) }}>{l} <span style={{ opacity: 0.7 }}>{n}</span></button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {/* ── список ── */}
        <div style={{ flex: '1 1 320px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '78vh', overflowY: 'auto' }}>
          {visible.map(p => (
            <button key={p.id} onClick={() => { setSel(p.id); setMode(null); setErr(null) }}
              style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 5, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: 'inherit', background: 'var(--surface)', border: p.id === sel ? '1px solid var(--text)' : '1px solid var(--border)', boxShadow: p.id === sel ? '0 0 0 1px var(--text)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={badge(p.sev)}>{p.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', color: p.sev === 'err' ? 'var(--red)' : 'var(--amber)' }}>{p.metric}</span>
              </div>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.row.saleName}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.row.doc.number} від {dmy(p.row.doc.date)} · рядок {p.row.lineNo} · {p.row.doc.contractor}</div>
            </button>
          ))}
          {!visible.length && <div className="card" style={{ border: '1px dashed var(--border)', textAlign: 'center', color: 'var(--text3)' }}>{problems.length ? 'У цьому фільтрі все виправлено' : 'Проблем немає'}</div>}
        </div>

        {/* ── картка проблеми ── */}
        <div style={{ flex: '999 1 560px', minWidth: 0, position: 'sticky', top: 16 }}>
          {cur ? (
            <ProblemCard key={cur.id} p={cur} pos={pos} n={visible.length} canEdit={canEdit} busy={busy} err={err} mode={mode}
              tasks={tasks.filter(t => (t.description || '').includes(reconLineToken(cur.row.line.outId)))} onTaskCreated={loadTasks}
              onPrev={() => go(-1)} onNext={() => go(1)} onClose={() => setSel(null)} onAction={doAction} onAck={() => ack(cur.kind, 'Не помилка — позначено перевіреним')}
              run={run} onOpenDoc={onOpenDoc} onDrawer={onDrawer} />
          ) : (
            <div className="card" style={{ border: '1px dashed var(--border)', textAlign: 'center', padding: '44px 20px' }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{!problems.length ? 'Усі проблеми виправлено' : !visible.length ? 'У цьому фільтрі все виправлено' : 'Виберіть проблему зі списку'}</div>
              <div style={{ fontSize: 14, color: 'var(--text3)', marginTop: 6 }}>{!problems.length ? 'Звірка чиста — можна застосовувати FIFO.' : 'Деталі й кнопки виправлення відкриються тут.'}</div>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--surface)', borderRadius: 12, padding: '10px 10px 10px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, boxShadow: '0 8px 24px rgba(0,0,0,.2)', maxWidth: 'calc(100% - 32px)', zIndex: 50 }}>
          <i className="ti ti-check" style={{ color: 'var(--green)' }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.text}</span>
          {toast.undo && <button className="btn btn-sm" onClick={undo} disabled={busy}>Скасувати</button>}
        </div>
      )}
    </div>
  )
}

function ProblemCard({ p, pos, n, canEdit, busy, err, mode, onPrev, onNext, onClose, onAction, onAck, run, onOpenDoc, onDrawer, tasks = [], onTaskCreated }) {
  const x = p.row, s = x.src
  const { explain, hint } = explainProblem(p)
  const acts = ACTIONS[p.kind] || []
  const hl = (sev) => SEV[sev]
  const mColor = x.marginSum < 0 ? 'var(--red)' : p.sev === 'warn' && ['high', 'low', 'eq'].includes(p.kind) ? 'var(--amber)' : undefined
  const big = { fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  const cell = { padding: '9px 14px' }
  const buyHl = (keys) => keys.includes(p.kind) ? { ...cell, ...hl(p.sev), fontWeight: 600 } : cell
  const lnk = { background: 'none', border: 0, padding: 0, fontFamily: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }
  // перегляд документів: бічна панель «Видаткова / Прихідна / Поруч» (як у таблиці); без неї — картка документа
  const view = (mode) => {
    if (onDrawer) onDrawer({ doc: x.doc, mode, line: x.line, src: s || null })
    else onOpenDoc(mode === 'rec' && s?.inDocId ? s.inDocId : x.doc.id)
  }
  const rows = [
    ['Документ', <button onClick={() => view('sale')} style={lnk} title="Переглянути видаткову">{x.doc.number} від {dmy(x.doc.date)}</button>, s?.docNo ? <button onClick={() => s.inDocId && view('rec')} style={lnk} title="Переглянути прихідну">№{s.docNo}{!x.fromBatch && ' (кандидат)'}</button> : 'не знайдено', ['none', 'nocost', 'other']],
    ['Товар', x.saleName, s ? s.inProductName || x.saleName : '—', ['other']],
    ['Контрагент', x.doc.contractor, s?.supplier || '—', []],
    ['Дата', dmy(x.shipDate), s ? `${dmy(x.inDate)}${s.docDate && s.docDate !== x.inDate ? ` (документ ${dmy(s.docDate)})` : ''}` : '—', ['late', 'mdate']],
    ['Кількість', `${num(x.qty, x.qty % 1 ? 3 : 0)} ${x.saleUnit}`, x.purQty != null ? `${num(x.purQty, x.purQty % 1 ? 3 : 0)} ${x.purUnit || ''}` : '—', ['unit']],
    ['Ціна / од. без ПДВ', num(x.salePrice, 2), x.service ? '—' : `${num(x.costUnit, 2)}${x.estimated ? ' (оцінка)' : ''}${x.line.manualUnit != null ? ' (вручну)' : ''}${x.purUnit && x.purPriceRaw != null && x.purUnit !== x.saleUnit ? ` · ${num(x.purPriceRaw, 2)} / ${x.purUnit}` : ''}`, ['loss', 'high', 'low', 'eq', 'none', 'nocost', 'unit']],
    ['ПДВ у прихідній', '', x.vat ?? '—', ['vat']],
  ]
  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
        <span style={{ fontSize: 13, color: 'var(--text3)', flex: 1 }}>Проблема {pos} з {n}</span>
        <button className="btn btn-sm" onClick={onPrev}>← Попередня</button>
        <button className="btn btn-sm" onClick={onNext}>Наступна →</button>
        <button className="btn btn-sm" onClick={onClose} aria-label="Закрити"><i className="ti ti-x" /></button>
      </div>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={badge(p.sev)}>{p.label}</span>
          <h2 style={{ margin: 0, fontSize: 21, lineHeight: 1.3 }}>{x.saleName}{x.saleSku && <span style={{ fontSize: 14, color: 'var(--text3)', fontWeight: 400 }}> ({x.saleSku})</span>}</h2>
          <div style={{ fontSize: 14, color: 'var(--text3)' }}>{x.doc.number} від {dmy(x.doc.date)} · рядок {x.lineNo} · {x.doc.contractor}{x.doc.orderNo ? ` · замовлення №${x.doc.orderNo}` : ''}</div>
          {p.others.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>також: {p.others.map(k => PROBLEM_KINDS[k][0].toLowerCase()).join(', ')}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <button className="btn btn-sm" onClick={() => view('sale')}><i className="ti ti-file-text" /> Видаткова {x.doc.number}</button>
            {s?.inDocId && <button className="btn btn-sm" onClick={() => view('rec')}><i className="ti ti-file-download" /> Прихідна №{s.docNo}</button>}
            {s?.inDocId && <button className="btn btn-sm" onClick={() => view('both')}><i className="ti ti-columns" /> Поруч</button>}
            <button className="btn btn-sm" onClick={() => onOpenDoc(x.doc.id)} title="Відкрити картку видаткової (редагування, скан)"><i className="ti ti-external-link" /> Картка видаткової</button>
          </div>
        </div>

        <div style={{ ...hl(p.sev), display: 'flex', flexDirection: 'column', gap: 5, padding: 14, borderRadius: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Що не так</div>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text)' }}>{explain}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          {[['Продаж / од.', num(x.salePrice, 2)], ['Закупівля / од.', x.service ? '—' : num(x.costUnit, 2), ['loss', 'high', 'low', 'eq', 'none', 'unit'].includes(p.kind) ? mColor : undefined],
            ['Маржа, грн', money(x.marginSum), mColor], ['Маржа, %', x.marginPct == null ? '—' : num(x.marginPct, 1) + '%', mColor]].map(([l, v, c]) => (
            <div key={l} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{l}</div>
              <div style={{ ...big, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 480 }}>
            <thead><tr style={{ background: 'var(--surface2)', textAlign: 'left' }}>
              <th style={{ ...cell, fontSize: 12, color: 'var(--text3)', width: '22%' }} />
              <th style={{ ...cell, fontSize: 12, color: 'var(--text3)' }}>ПРОДАЖ (ВИДАТКОВА)</th>
              <th style={{ ...cell, fontSize: 12, color: 'var(--text3)' }}>ЗАКУПІВЛЯ (ПРИХІДНА)</th>
            </tr></thead>
            <tbody>
              {rows.map(([l, sale, buy, keys]) => (
                <tr key={l} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...cell, color: 'var(--text3)' }}>{l}</td>
                  <td style={{ ...cell, fontWeight: keys.includes(p.kind) && l === 'Дата' ? 600 : undefined }}>{sale}</td>
                  <td style={buyHl(keys)}>{buy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text3)' }}>Як виправити</div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>{hint}</div>
          {mode === 'link' && <LinkPicker p={p} busy={busy} run={run} />}
          {mode === 'manual' && <ManualCost p={p} busy={busy} run={run} />}
          {mode === 'units' && <UnitsRecalc p={p} busy={busy} run={run} />}
          {mode === 'date' && <WhDate p={p} busy={busy} run={run} />}
        </div>

        <TaskBlock p={p} explain={explain} hint={hint} tasks={tasks} onCreated={onTaskCreated} />

        {err && <div style={{ color: 'var(--red)', fontSize: 13.5 }}>Помилка: {err}</div>}
        {canEdit ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              {acts.map(([code, label], i) => (
                <button key={code + i} className={'btn' + (i === 0 ? ' btn-primary' : '')} style={{ minHeight: 42 }} disabled={busy}
                  onClick={() => onAction(code, label)}>{label}{NEEDS_INPUT.has(code) ? (mode === code ? ' ▴' : ' ▾') : ''}</button>
              ))}
              <button className="btn" style={{ minHeight: 42, background: 'transparent', border: 0, color: 'var(--text3)', textDecoration: 'underline' }} disabled={busy} onClick={onAck}>Не помилка — позначити перевіреним</button>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Після дії проблема зникне зі списку й одразу відкриється наступна.</div>
          </>
        ) : <div style={{ fontSize: 13, color: 'var(--text3)', paddingTop: 14, borderTop: '1px solid var(--border)' }}>Перегляд: виправляти можуть лише адміністратор або бухгалтер.</div>}
      </div>
    </section>
  )
}

// посилання на проблему в деталях завдання (по ньому завдання показується в картці й відкриває проблему з «Задач»)
export const reconLineToken = (outId) => `/inventory/recon?line=${outId}`

// ── Завдання на усунення проблеми → розділ «Задачі» ──
function TaskBlock({ p, explain, hint, tasks, onCreated }) {
  const { user } = useUser()
  const x = p.row
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState('normal')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(null)
  useEffect(() => { setOpen(false); setSaved(null); setErr(null) }, [p.id])
  const start = () => {
    setTitle(`Звірка: ${p.label.toLowerCase()} — ${x.saleName}`.slice(0, 200))
    setDesc([
      `${x.doc.number} від ${dmy(x.doc.date)}, рядок ${x.lineNo} · ${x.doc.contractor}${x.doc.orderNo ? ` · замовлення №${x.doc.orderNo}` : ''}`,
      x.src?.docNo ? `Прихідна №${x.src.docNo}${x.src.supplier ? ` (${x.src.supplier})` : ''}` : 'Прихідну не знайдено',
      `Що не так: ${explain}`,
      `Як виправити: ${hint}`,
    ].join('\n'))
    setDue(addDaysIso(todayKyiv(), p.sev === 'err' ? 2 : 5))
    setPriority(p.sev === 'err' ? 'high' : 'normal')
    setOpen(true); setErr(null)
  }
  const save = async () => {
    if (!title.trim()) { setErr('Вкажіть, що зробити'); return }
    setBusy(true); setErr(null)
    const base = { title: title.trim(), description: `${desc.trim()}\n\nЗвірка: ${reconLineToken(x.line.outId)}`, due_date: due || null, priority,
      created_by: user?.id || null, source: 'recon' }
    let { data, error } = await supabase.from('tasks').insert({ ...base, assignee_id: user?.id || null, status: 'new',
      entity_type: 'reconciliation', entity_ref: reconLineToken(x.line.outId) }).select('id').single()
    if (error && /column|schema cache/.test(error.message || '')) ({ data, error } = await supabase.from('tasks').insert({ ...base, status: 'open' }).select('id').single())   // до 092
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSaved(data?.id || true); setOpen(false); onCreated?.()
  }
  const PR = { high: 'Високий', normal: 'Звичайний', low: 'Низький' }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text3)', flex: 1 }}>Завдання</div>
        {!open && <button className="btn btn-sm" onClick={start}><i className="ti ti-checklist" /> Створити завдання</button>}
      </div>
      {tasks.length > 0 ? tasks.map(t => (
        <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
          <i className={`ti ${t.status === 'done' ? 'ti-circle-check' : 'ti-circle'}`} style={{ color: t.status === 'done' ? 'var(--green)' : 'var(--text3)' }} />
          <span style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none', flex: 1, minWidth: 160 }}>{t.title}</span>
          {t.due_date && <span style={{ color: t.status !== 'done' && t.due_date < todayKyiv() ? 'var(--red)' : 'var(--text3)' }}>до {dmy(t.due_date)}</span>}
          <Link to="/tasks" style={{ fontSize: 12.5 }}>у «Задачах»</Link>
        </div>
      )) : !open && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Завдань немає. Якщо виправити зараз не вийде (треба запросити документ, уточнити ціну в постачальника) — створіть завдання, воно з'явиться в розділі «Задачі» з посиланням на цю проблему.</div>}
      {saved && <div style={{ fontSize: 13, color: 'var(--green)' }}>Завдання створено — воно в розділі <Link to="/tasks">«Задачі»</Link>.</div>}
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="form-group"><label>Що зробити</label><input className="form-input" value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div className="form-group"><label>Деталі</label><textarea className="form-input" rows={5} value={desc} onChange={e => setDesc(e.target.value)} style={{ resize: 'vertical', fontSize: 13 }} /></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group"><label>Термін</label><input type="date" className="form-input" value={due} onChange={e => setDue(e.target.value)} /></div>
            <div className="form-group"><label>Пріоритет</label>
              <select className="form-input" value={priority} onChange={e => setPriority(e.target.value)}>{Object.entries(PR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </div>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Скасувати</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Створюю…' : 'Створити завдання'}</button>
          </div>
          {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>Помилка: {err}</div>}
        </div>
      )}
    </div>
  )
}

// ── Прив'язати прихідну: кандидати рядка + пошук ──
function LinkPicker({ p, busy, run }) {
  const x = p.row
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  const [searching, setSearching] = useState(false)
  const [qty, setQty] = useState({})
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setFound(null); return }
    const h = setTimeout(() => { setSearching(true); searchIncomingLines(t).then(setFound).catch(() => setFound([])).finally(() => setSearching(false)) }, 350)
    return () => clearTimeout(h)
  }, [q])
  const cands = x.line.candidates || []
  const list = [...cands, ...(found || []).filter(f => !cands.some(c => c.inId === f.inId))]
  const take = (c) => {
    const n = Number(qty[c.inId] ?? Math.min(x.qty, Math.max(0, c.free ?? x.qty)))
    if (!(n > 0)) return
    run(() => linkAdd({ outMov: x.line.outId, inMov: c.inId, qty: n }),
      (r) => `прив'язано прихідну №${c.docNo}${r?.movements?.length ? ` — собівартість ${money(r.movements.reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.cost_price) || 0), 0))}` : ''}`,
      (r) => r?.link_id ? () => linkRemove(r.link_id) : null)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 13, color: 'var(--text3)' }}>Знайти прихідну</label>
      <input className="form-input" type="search" placeholder="№ прихідної, постачальник або товар" value={q} onChange={e => setQ(e.target.value)} style={{ minHeight: 42 }} />
      {searching && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Шукаю…</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
        {list.map(c => (
          <div key={c.inId} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <b>№{c.docNo}</b> від {dmy(c.docDate)}{c.whDate && c.whDate !== c.docDate ? ` (оприбутк. ${dmy(c.whDate)})` : ''} · {c.supplier}
              <div style={{ color: 'var(--text3)' }}>{c.inProductName}{c.inLine != null ? ` · рядок ${c.inLine}` : ''} · {num(c.qty, c.qty % 1 ? 3 : 0)} {c.inUnit} × {num(c.unit, 2)} без ПДВ · ПДВ {c.vat == null ? '—' : c.vat ? 'так' : 'ні'} · вільно {num(c.free, c.free % 1 ? 3 : 0)}</div>
              {c.whDate > x.shipDate && <div style={{ fontSize: 12, color: 'var(--amber)' }}>пізніше відвантаження — прив'язка діє незалежно від дат</div>}
            </div>
            <input className="form-input" type="number" min="0" step="any" style={{ width: 90 }} value={qty[c.inId] ?? Math.min(x.qty, Math.max(0, c.free ?? x.qty))} onChange={e => setQty(s => ({ ...s, [c.inId]: e.target.value }))} />
            <button className="btn btn-sm btn-primary" disabled={busy || !(c.free > 0)} title={c.free > 0 ? '' : 'партію вже використано'} onClick={() => take(c)}>Прив'язати</button>
          </div>
        ))}
        {!list.length && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{q.trim().length >= 2 && !searching ? 'Нічого не знайдено.' : 'Кандидатів немає — скористайтесь пошуком.'}</div>}
      </div>
    </div>
  )
}

// ── Ручна собівартість за од. (без ПДВ) ──
function ManualCost({ p, busy, run }) {
  const x = p.row
  const [v, setV] = useState('')
  const save = () => {
    const unit = Number(String(v).replace(/\s/g, '').replace(',', '.'))
    if (!(unit > 0)) return
    run(() => setManualCost(x.line.outId, unit, PROBLEM_KINDS[p.kind][0]), `собівартість ${num(unit, 2)} вказано вручну`,
      (r) => () => setManualCost(x.line.outId, r?.prev_unit ?? null))
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxWidth: 300 }}>
        <label style={{ fontSize: 13, color: 'var(--text3)' }}>Собівартість за од., грн без ПДВ</label>
        <input className="form-input" inputMode="decimal" placeholder={x.costUnit ? num(x.costUnit, 2) : ''} value={v} onChange={e => setV(e.target.value)} style={{ minHeight: 42 }} autoFocus />
      </div>
      <button className="btn btn-primary" disabled={busy || !(Number(String(v).replace(/\s/g, '').replace(',', '.')) > 0)} onClick={save}>Зберегти</button>
    </div>
  )
}

// ── Перерахувати одиниці: 1 од. продажу = N од. закупівлі ──
function UnitsRecalc({ p, busy, run }) {
  const x = p.row
  const k = x.purUnit ? unitFactor(x.purUnit, x.saleUnit) : null
  const [nIn, setN] = useState(k != null && k !== 1 ? String(k) : '')
  const n = Number(String(nIn).replace(',', '.'))
  const price = x.purPriceRaw
  const unit = price != null && n > 0 ? price * n : null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 13, color: 'var(--text3)' }}>1 {x.saleUnit} продажу = N {x.purUnit || 'од.'} закупівлі</label>
        <input className="form-input" inputMode="decimal" value={nIn} onChange={e => setN(e.target.value)} style={{ minHeight: 42, width: 160 }} placeholder="напр. 0,001" />
      </div>
      <div style={{ fontSize: 13.5, paddingBottom: 10 }}>{unit != null ? <>собівартість: {num(price, 2)} × {nIn} = <b>{num(unit, 2)}</b> / {x.saleUnit}</> : price == null ? 'немає ціни закупівлі' : ''}</div>
      <button className="btn btn-primary" disabled={busy || unit == null} onClick={() => run(() => setManualCost(x.line.outId, Math.round(unit * 10000) / 10000, `одиниці: 1 ${x.saleUnit} = ${nIn} ${x.purUnit}`),
        `одиниці перераховано: ${num(unit, 2)} / ${x.saleUnit}`, (r) => () => setManualCost(x.line.outId, r?.prev_unit ?? null))}>Зберегти</button>
    </div>
  )
}

// ── Дата оприбуткування прихідної ──
function WhDate({ p, busy, run }) {
  const x = p.row, s = x.src
  const [d, setD] = useState(x.shipDate || '')
  if (!s?.inDocId) return <div style={{ fontSize: 13, color: 'var(--text3)' }}>Прихідної немає — спершу прив'яжіть її.</div>
  const prev = s.whDate && s.whDate !== s.docDate ? s.whDate : null
  const early = s.docDate && d && (new Date(s.docDate) - new Date(d)) / 864e5 > 30
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13.5 }}>Прихідна №{s.docNo} · {s.supplier}. Дата документа постачальника {dmy(s.docDate)} — <b>не змінюється</b>.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--text3)' }}>Дата оприбуткування на складі</label>
        <input type="date" className="form-input" value={d} onChange={e => setD(e.target.value)} style={{ width: 170 }} />
        <button className="btn btn-primary" disabled={busy || !d} onClick={() => run(() => setWarehouseDate(s.inDocId, d, x.doc.id), `дату оприбуткування №${s.docNo}: ${dmy(d)}`, () => () => setWarehouseDate(s.inDocId, prev, x.doc.id))}>Зберегти</button>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Запропоновано дату відвантаження. Вкажіть день, коли товар реально надійшов.</div>
      {early && <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>⚠ Нова дата раніша за документ постачальника більш ніж на 30 днів — перевірте.</div>}
    </div>
  )
}

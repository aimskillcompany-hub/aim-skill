import { useState, useEffect } from 'react'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { qc } from '../lib/companyScope'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import { listClosings, periodStatus, runChecklist, closePeriod, reopenPeriod, computeCompleteness, computeGoodsReport } from '../lib/periodClose'
import { getDocType } from '../lib/docgen'
import DocModal from '../components/DocModal'
import { CashFlowView, PLView, BalanceView } from './Analytics'

const DIRECTIONS = ['Доходи', 'Витрати', 'Інше', 'ПФД', 'ОЗ']
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']

const STATUS = {
  open: { label: 'Відкритий', color: 'var(--text3)', bg: 'var(--surface2)' },
  closed: { label: 'Закритий', color: '#fff', bg: 'var(--green)' },
  reopened: { label: 'Переоткритий', color: '#fff', bg: 'var(--amber, #d97706)' },
}

// Три канонічні звіти, на основі яких приймається рішення про закриття.
const REPORTS = [
  { key: 'cashflow', icon: 'ti-arrows-exchange', title: 'Cash Flow — рух грошей',
    hint: 'Усі фактичні рухи коштів за місяць (прямий метод, валідовані й ні). Натисни на будь-яку цифру — побачиш і зможеш виправити конкретні транзакції.' },
  { key: 'pl', icon: 'ti-report-money', title: 'P&L — прибутки та збитки',
    hint: 'Фінансовий результат за підтвердженими грошима (касовий метод). Натисни на цифру — операції, з яких складається стаття.' },
  { key: 'balance', icon: 'ti-scale', title: 'Управлінський баланс',
    hint: 'Стан на кінець місяця: активи (гроші + склад + дебіторка) та пасиви (кредиторка + власний капітал).' },
]

export default function PeriodClose() {
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [closings, setClosings] = useState([])
  const [sel, setSel] = useState(null) // month 1..12
  const [check, setCheck] = useState(null)
  const [comp, setComp] = useState(null) // повнота даних
  const [refreshKey, setRefreshKey] = useState(0) // форс-перезавантаження вбудованих звітів після правок
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState(null)
  const [grouped, setGrouped] = useState({})
  const [openDoc, setOpenDoc] = useState(null) // документ для звірки (DocModal)
  const [confirmed, setConfirmed] = useState({ completeness: false, cashflow: false, pl: false, balance: false })

  const load = async () => setClosings(await listClosings())
  useEffect(() => { load(); fetchArticles().then(a => setGrouped(groupByType(a))) }, [])

  const rowFor = (m) => closings.find(c => c.period_year === year && c.period_month === m)

  // Перерахувати чек-лист + повноту даних для обраного місяця (після будь-якої правки транзакцій)
  const reloadGates = async (m = sel) => {
    setBusy('check'); setErr(null)
    try { const [ch, co] = await Promise.all([runChecklist(year, m), computeCompleteness(year, m)]); setCheck(ch); setComp(co) }
    catch (e) { setErr(e.message) }
    setBusy('')
    setRefreshKey(k => k + 1) // звіти перечитають дані після можливих правок
  }

  // Відкрив місяць → автоматично зчитуємо чек-лист + повноту (звіти вантажаться самі).
  const openMonth = async (m) => {
    setSel(m); setErr(null); setCheck(null); setComp(null)
    setConfirmed({ completeness: false, cashflow: false, pl: false, balance: false })
    const r = rowFor(m)
    if (r?.status === 'closed') return
    await reloadGates(m)
  }

  const doCheck = () => reloadGates()

  const selRow = sel ? rowFor(sel) : null
  const selStatus = sel ? periodStatus(closings, year, sel) : null
  const isClosed = selStatus === 'closed'
  const savedConfirmed = selRow?.snapshot?.reportsConfirmed || null

  const blockers = check?.blockers
  const allConfirmed = confirmed.completeness && confirmed.cashflow && confirmed.pl && confirmed.balance
  const canClose = blockers === 0 && allConfirmed

  const doClose = async () => {
    if (!canClose) return
    if (!confirm(`Закрити ${MONTHS[sel - 1]} ${year}? Дані періоду буде заблоковано для змін.`)) return
    setBusy('close'); setErr(null)
    try {
      await closePeriod(year, sel, user?.id, {
        reportsConfirmed: { completeness: true, cashflow: true, pl: true, balance: true, at: new Date().toISOString(), by: user?.id || null },
      })
      await load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const doReopen = async () => {
    if (!confirm(`Переоткрити ${MONTHS[sel - 1]} ${year}? Блокування знімається, дані знову можна редагувати.`)) return
    setBusy('reopen'); setErr(null)
    try { await reopenPeriod(year, sel, user?.id); await load() } catch (e) { setErr(e.message) }
    setBusy('')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ margin: 0 }}>Закриття періоду</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn" onClick={() => { setYear(y => y - 1); setSel(null) }}>←</button>
          <b style={{ minWidth: 54, textAlign: 'center' }}>{year}</b>
          <button className="btn" onClick={() => { setYear(y => y + 1); setSel(null) }}>→</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {MONTHS.map((name, i) => {
            const m = i + 1
            const st = periodStatus(closings, year, m)
            const s = STATUS[st]
            const isFuture = year > now.getFullYear() || (year === now.getFullYear() && m > now.getMonth() + 1)
            return (
              <div key={m} onClick={() => !isFuture && openMonth(m)}
                style={{
                  border: `1px solid ${sel === m ? 'var(--blue)' : 'var(--border)'}`, borderRadius: 10, padding: '10px 12px',
                  cursor: isFuture ? 'default' : 'pointer', opacity: isFuture ? 0.4 : 1,
                  background: sel === m ? 'var(--blueBg, #eff4ff)' : 'var(--surface)',
                }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{name}</div>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, color: s.color, background: s.bg }}>{s.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {err && <div className="card" style={{ color: 'var(--red)', marginBottom: 16 }}>{err}</div>}

      {sel && (
        <>
          {/* Шапка періоду + статус + дії */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ margin: 0 }}>{MONTHS[sel - 1]} {year}</h2>
              {isClosed && isAdmin && (
                <button className="btn" onClick={doReopen} disabled={busy === 'reopen'} style={{ color: 'var(--red)' }}>
                  <i className="ti ti-lock-open" /> {busy === 'reopen' ? '…' : 'Переоткрити'}
                </button>
              )}
            </div>

            {isClosed && selRow && (
              <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 8 }}>
                🔒 Закрито {selRow.closed_at?.slice(0, 10)}{selRow.reopened_at ? ` · переоткривалось ${selRow.reopened_at.slice(0, 10)}` : ''}
                {savedConfirmed && <span> · підтверджені звіти: Cash Flow ✓ · P&amp;L ✓ · Баланс ✓</span>}
              </div>
            )}

            {!isClosed && (
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 8 }}>
                Переглянь три звіти нижче, звір цифри (кожну можна розкрити до операцій) і підтверди кожен. Коли всі три підтверджені й немає блокерів — період можна закрити.
              </div>
            )}

            {/* Чек-лист готовності (блокери якості даних) */}
            {!isClosed && check && <Checklist check={check} grouped={grouped} onClassified={doCheck} onOpenDoc={setOpenDoc} />}
            {!isClosed && busy === 'check' && !check && <div style={{ marginTop: 12, color: 'var(--text3)' }}>Перевірка готовності…</div>}
          </div>

          {/* Повнота даних: що НЕ потрапляє у звіти і чому */}
          {!isClosed && comp && (
            <CompletenessPanel comp={comp} grouped={grouped}
              confirmed={confirmed.completeness}
              onConfirm={v => setConfirmed(c => ({ ...c, completeness: v }))}
              onChanged={doCheck} />
          )}
          {isClosed && savedConfirmed?.completeness && (
            <div className="card" style={{ marginBottom: 16, fontSize: 13, color: 'var(--green)' }}>
              <i className="ti ti-check" /> Повнота даних переглянута й підтверджена при закритті.
            </div>
          )}

          {/* Три канонічні звіти */}
          {REPORTS.map(rep => (
            <ReportCard key={rep.key} icon={rep.icon} title={rep.title} hint={rep.hint}
              confirmed={isClosed ? !!savedConfirmed?.[rep.key] : confirmed[rep.key]}
              readOnly={isClosed}
              onConfirm={v => setConfirmed(c => ({ ...c, [rep.key]: v }))}>
              {rep.key === 'cashflow' && <CashFlowView key={refreshKey} fixedYear={year} fixedMonth={sel} />}
              {rep.key === 'pl' && <PLView key={refreshKey} fixedYear={year} fixedMonth={sel} />}
              {rep.key === 'balance' && <BalanceView key={refreshKey} fixedYear={year} fixedMonth={sel} />}
            </ReportCard>
          ))}

          {/* Рух товарів за період: куплено / продано / залишок (інформативно) */}
          <ReportCard icon="ti-package" title="Товари — рух запасів за період"
            hint="Що куплено, що продано і що лишилось на складі. Ціни — без ПДВ (базова облікова). Залишкова вартість = к-сть × остання ціна закупівлі.">
            <GoodsReportView key={refreshKey} year={year} month={sel} />
          </ReportCard>

          {/* Дія закриття */}
          {!isClosed && (
            <div className="card" style={{ marginBottom: 16 }}>
              {blockers > 0 && (
                <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>
                  <i className="ti ti-alert-circle" /> Спершу усуньте блокери якості ({blockers}) у чек-листі вгорі.
                </div>
              )}
              {blockers === 0 && !allConfirmed && (
                <div style={{ color: 'var(--amber, #d97706)', fontSize: 13, marginBottom: 10 }}>
                  <i className="ti ti-info-circle" /> Підтвердіть повноту даних і всі три звіти (Cash Flow, P&amp;L, Баланс), щоб закрити період.
                </div>
              )}
              {canClose && (
                <div style={{ color: 'var(--green)', fontSize: 13, marginBottom: 10 }}>
                  <i className="ti ti-circle-check" /> Усі звіти підтверджені, блокерів немає — період готовий до закриття.
                </div>
              )}
              <button className="btn btn-primary" onClick={doClose} disabled={!canClose || busy === 'close'}>
                <i className="ti ti-lock" /> {busy === 'close' ? 'Закриття…' : 'Закрити період'}
              </button>
            </div>
          )}
        </>
      )}

      {openDoc && (
        <DocModal user={user} existingDoc={openDoc} autoOcr={false}
          onClose={() => setOpenDoc(null)}
          onSaved={() => { setOpenDoc(null); doCheck() }} />
      )}
    </div>
  )
}

// Картка-обгортка звіту з галочкою підтвердження
function ReportCard({ icon, title, hint, confirmed, onConfirm, readOnly, children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: hint ? 4 : 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className={`ti ${icon}`} style={{ color: 'var(--blue)' }} />{title}
        </h3>
        {!onConfirm ? null : readOnly
          ? (confirmed && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap' }}><i className="ti ti-check" /> Підтверджено при закритті</span>)
          : (
            <label style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', userSelect: 'none',
              color: confirmed ? 'var(--green)' : 'var(--text2)', padding: '5px 10px', borderRadius: 8,
              border: `1px solid ${confirmed ? 'var(--green)' : 'var(--border)'}`, whiteSpace: 'nowrap',
            }}>
              <input type="checkbox" checked={confirmed} onChange={e => onConfirm(e.target.checked)} />
              {confirmed ? 'Переглянув і підтверджено' : 'Переглянув і підтверджую'}
            </label>
          )}
      </div>
      {hint && <p style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 12px' }}>{hint}</p>}
      {children}
    </div>
  )
}

// Три колонки руху товарів поряд: куплено / продано / залишок (клік по товару → документ приходу)
function GoodsReportView({ year, month }) {
  const { user } = useUser()
  const [d, setD] = useState(null)
  const [openDoc, setOpenDoc] = useState(null)
  useEffect(() => { setD(null); computeGoodsReport(year, month).then(setD) }, [year, month])
  const openById = async (id) => { if (!id) return; const { data } = await qc('documents').select('*').eq('id', id).maybeSingle(); if (data) setOpenDoc(data) }
  if (!d) return <p style={{ color: 'var(--text3)' }}>Завантаження…</p>
  const t = d.totals

  const Item = ({ r, children }) => (
    <div onClick={() => openById(r.docId)} title={r.docId ? 'Відкрити документ для звірки' : 'Документ не знайдено'}
      style={{ padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: r.docId ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 12.5, fontWeight: 500, display: 'flex', gap: 4, alignItems: 'baseline', color: r.docId ? 'var(--blue)' : 'var(--text)' }}>
        {r.docId && <i className="ti ti-paperclip" style={{ fontSize: 11, flexShrink: 0 }} />}
        <span>{r.name?.slice(0, 70)}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{children}</div>
    </div>
  )
  const Col = ({ title, color, sub, rows, render }) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, minWidth: 0 }}>
      <div style={{ fontWeight: 700, color }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text3)', margin: '2px 0 8px' }}>{sub}</div>
      {rows.length === 0 ? <div style={{ color: 'var(--text3)', fontSize: 12.5, padding: '8px 0' }}>немає</div>
        : rows.map(r => <Item key={r.product_id} r={r}>{render(r)}</Item>)}
    </div>
  )

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, alignItems: 'start' }}>
        <Col title={`Куплено (${d.purchased.length})`} color="var(--red)" sub={`на ${fmtInt(t.purchasedSum)} грн`} rows={d.purchased}
          render={r => <>{fmt(r.qty)} шт · {fmt(r.price)} грн/од · Σ <b style={{ color: 'var(--text2)' }}>{fmtInt(r.sum)}</b></>} />
        <Col title={`Продано (${d.sold.length})`} color="var(--green)" sub={`виручка ${fmtInt(t.soldRevenue)} · маржа ${fmtInt(t.soldMargin)} грн`} rows={d.sold}
          render={r => <>{fmt(r.qty)} шт · закуп {fmt(r.cost)} → продаж {fmt(r.price)} · маржа <b style={{ color: r.margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{r.margin < 0 ? '−' : ''}{fmtInt(r.margin)}</b></>} />
        <Col title={`Залишок на кінець (${d.remaining.length})`} color="var(--text)" sub={`на ${fmtInt(t.remainingValue)} грн`} rows={d.remaining}
          render={r => <>{fmt(r.qty)} шт · {fmt(r.unitCost)} грн/од · Σ <b style={{ color: 'var(--text2)' }}>{fmtInt(r.value)}</b></>} />
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 10, marginBottom: 0 }}>
        <i className="ti ti-paperclip" /> Клік по товару відкриває документ: у «Куплено» й «Залишок» — прихідну накладну, у «Продано» — вашу видаткову. Щоб звірити ціни з оригіналом. Ціни без ПДВ.
      </p>
      {openDoc && <DocModal user={user} existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => setOpenDoc(null)} />}
    </>
  )
}

function Checklist({ check, grouped, onClassified, onOpenDoc }) {
  const ok = check.blockers === 0
  const [openTx, setOpenTx] = useState(false)
  const [openDocs, setOpenDocs] = useState(false)
  const [openUnposted, setOpenUnposted] = useState(false)
  const nTx = check.unclassifiedTx
  const nUnver = check.unverifiedDocs || 0
  const unposted = check.unpostedStock || []
  return (
    <div style={{ marginTop: 14, border: `1px solid ${ok ? 'var(--green)' : 'var(--red)'}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10, color: ok ? 'var(--green)' : 'var(--red)' }}>
        {ok ? '✅ Якість даних: період готовий до закриття' : `⚠️ Блокери якості: ${check.blockers}`}
      </div>
      <Row bad={check.negativeStock.length > 0} label="Мінусові залишки складу"
        val={check.negativeStock.length ? `${check.negativeStock.length} товар(ів)` : 'немає'} />
      {check.negativeStock.slice(0, 8).map(n => (
        <div key={n.id} style={{ fontSize: 12, color: 'var(--red)', marginLeft: 24 }}>• {n.name?.slice(0, 55)} = {n.qty}</div>
      ))}
      <Row bad={check.docsNoAmount.length > 0} label="Документи без суми"
        val={check.docsNoAmount.length ? `${check.docsNoAmount.length} шт` : 'немає'} />

      {/* Неперевірені документи — блокер: клік відкриває документ (скан+поля) для звірки */}
      <div onClick={() => nUnver && setOpenDocs(o => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, cursor: nUnver ? 'pointer' : 'default' }}>
        <span><i className={`ti ${nUnver ? 'ti-alert-circle' : 'ti-check'}`} style={{ color: nUnver ? 'var(--red)' : 'var(--green)', marginRight: 6 }} />Неперевірені документи (блокує закриття)</span>
        <b style={{ color: nUnver ? 'var(--red)' : undefined }}>{nUnver ? `${nUnver} шт ${openDocs ? '▴' : '▾'}` : 'усі перевірені'}</b>
      </div>
      {openDocs && (check.unverifiedList || []).map(d => (
        <div key={d.id} onClick={() => onOpenDoc(d)}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '5px 0 5px 24px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
          title="Відкрити для звірки скану й полів">
          <span><i className="ti ti-file-search" style={{ marginRight: 4, color: 'var(--blue)' }} />{getDocType(d.type)?.label || d.type} №{d.doc_number || '—'} · {d.contractors?.name || '—'}</span>
          <span style={{ color: 'var(--text3)', whiteSpace: 'nowrap' }}>{d.amount ? fmt(d.amount) : 'без суми'} · {d.doc_date}</span>
        </div>
      ))}

      {/* Накладні з позиціями, але не проведені на склад — попередження (не блокує) */}
      <div onClick={() => unposted.length && setOpenUnposted(o => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, cursor: unposted.length ? 'pointer' : 'default' }}>
        <span><i className={`ti ${unposted.length ? 'ti-alert-triangle' : 'ti-check'}`} style={{ color: unposted.length ? 'var(--amber, #d97706)' : 'var(--green)', marginRight: 6 }} />Накладні не проведені на склад <span style={{ color: 'var(--text3)', fontSize: 11 }}>(позиції є, руху складу немає)</span></span>
        <b style={{ color: unposted.length ? 'var(--amber, #d97706)' : undefined }}>{unposted.length ? `${unposted.length} шт ${openUnposted ? '▴' : '▾'}` : 'усі проведені'}</b>
      </div>
      {openUnposted && unposted.map(d => (
        <div key={d.id} onClick={() => onOpenDoc(d)}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '5px 0 5px 24px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
          title="Відкрити документ → увімкни «Рух на складі» і збережи, щоб оприбуткувати">
          <span><i className="ti ti-package-import" style={{ marginRight: 4, color: 'var(--amber, #d97706)' }} />{getDocType(d.type)?.label || d.type} №{d.doc_number || '—'} · {d.contractors?.name || '—'}</span>
          <span style={{ color: 'var(--text3)', whiteSpace: 'nowrap' }}>{(d.ocr_data?.items?.length || 0)} поз. · {d.doc_date}</span>
        </div>
      ))}

      <div onClick={() => nTx && setOpenTx(o => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, cursor: nTx ? 'pointer' : 'default' }}>
        <span><i className={`ti ${nTx ? 'ti-alert-circle' : 'ti-check'}`} style={{ color: nTx ? 'var(--red)' : 'var(--green)', marginRight: 6 }} />Невалідовані транзакції (блокує закриття)</span>
        <b style={{ color: nTx ? 'var(--red)' : undefined }}>{nTx ? `${nTx} шт ${openTx ? '▴' : '▾'}` : 'усі валідовані'}</b>
      </div>
      {openTx && (check.unclassifiedList || []).map(tx => (
        <TxClassify key={tx.id} tx={tx} grouped={grouped} onDone={onClassified} />
      ))}
    </div>
  )
}

function TxClassify({ tx, grouped, onDone, allowIgnore = true, unignoreOnSave = false, saveLabel = 'Підтвердити' }) {
  const [dir, setDir] = useState(tx.direction || (tx.amount >= 0 ? 'Доходи' : 'Витрати'))
  const [art, setArt] = useState(tx.article || '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const article = Object.values(grouped).flat().find(a => a.name === art)
    const upd = { direction: dir || null, article: art || null, article_id: article?.id || null, is_validated: true }
    if (unignoreOnSave) upd.is_ignored = false
    await qc('bank_transactions').update(upd).eq('id', tx.id)
    setBusy(false); onDone()
  }
  const ignore = async () => { setBusy(true); await qc('bank_transactions').update({ is_ignored: true }).eq('id', tx.id); setBusy(false); onDone() }
  const unignore = async () => { setBusy(true); await qc('bank_transactions').update({ is_ignored: false }).eq('id', tx.id); setBusy(false); onDone() }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, margin: '8px 0 8px 24px', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
        <span style={{ color: 'var(--text2)' }}>{tx.date} · {(tx.counterparty || tx.description || '').slice(0, 45)}</span>
        <b style={{ color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>{tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)}</b>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-input" value={dir} onChange={e => setDir(e.target.value)} style={{ width: 120 }}>
          {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="form-input" value={art} onChange={e => setArt(e.target.value)} style={{ flex: '1 1 180px', minWidth: 160 }}>
          <option value="">— стаття —</option>
          {Object.entries(grouped).map(([type, arts]) => (
            <optgroup key={type} label={TYPE_LABELS[type] || type}>
              {arts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button className="btn btn-primary" onClick={save} disabled={busy || !dir}><i className="ti ti-check" /> {saveLabel}</button>
        {allowIgnore && <button className="btn" onClick={ignore} disabled={busy} style={{ color: 'var(--text3)' }} title="Ігнорувати">✕</button>}
        {unignoreOnSave && <button className="btn" onClick={unignore} disabled={busy} style={{ color: 'var(--text3)', fontSize: 12 }} title="Лише повернути, без статті">Лише повернути</button>}
      </div>
    </div>
  )
}

// ── Панель повноти даних: звіряльний місток + підсвічені виключені суми з діями ──
function CompletenessPanel({ comp, grouped, confirmed, onConfirm, onChanged }) {
  const clean = comp.needsReview === 0
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-list-check" style={{ color: 'var(--blue)' }} />Повнота даних за період
        </h3>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', userSelect: 'none',
          color: confirmed ? 'var(--green)' : 'var(--text2)', padding: '5px 10px', borderRadius: 8,
          border: `1px solid ${confirmed ? 'var(--green)' : 'var(--border)'}`, whiteSpace: 'nowrap',
        }}>
          <input type="checkbox" checked={confirmed} onChange={e => onConfirm(e.target.checked)} />
          {confirmed ? 'Переглянув і підтверджено' : 'Я переглянув повноту даних'}
        </label>
      </div>

      {/* Звіряльний місток */}
      <div style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 12px', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
        Усі рухи грошей за місяць (неігноровані): <b>{comp.active.n} тр · {fmtInt(comp.active.sum)} грн</b>.
        З них <b style={{ color: 'var(--green)' }}>у P&amp;L увійшло: {comp.inPL.n} тр · {fmtInt(comp.inPL.sum)} грн</b>.
        {clean
          ? <span style={{ color: 'var(--green)' }}> Усі інші рухи — свідомо поза P&amp;L (нижче). Нічого не загубилось.</span>
          : <span style={{ color: 'var(--amber, #d97706)' }}> Решта не увійшла у P&amp;L — перегляньте нижче й вирішіть, що з ними зробити.</span>}
      </div>

      <CompBucket title="Ігноровані транзакції" hint="Приховані з УСІХ звітів (Cash Flow, P&L, Баланс). «Прийняти» — повернути й класифікувати."
        bucket={comp.ignored} color="var(--red)" grouped={grouped} onChanged={onChanged}
        txProps={{ allowIgnore: false, unignoreOnSave: true, saveLabel: 'Прийняти' }} />

      <CompBucket title="Валідовані без статті" hint="Є у Cash Flow як «Без статті», але ВИПАДАЮТЬ з P&L. Призначте статтю — і сума ввійде у P&L."
        bucket={comp.noArticle} color="var(--amber, #d97706)" grouped={grouped} onChanged={onChanged}
        txProps={{ allowIgnore: true }} />

      <CompBucket title="Невалідовані транзакції" hint="Є у Cash Flow, але не у P&L. Класифікуйте, щоб увійшли (також блокер у чек-листі вгорі)."
        bucket={comp.unvalidated} color="var(--amber, #d97706)" grouped={grouped} onChanged={onChanged}
        txProps={{ allowIgnore: true }} />

      {/* Інше / ПФД — свідомо поза P&L, лише інформативно */}
      {comp.otherFin.n > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <i className="ti ti-info-circle" style={{ marginRight: 6 }} />
          Напрям «Інше / ПФД»: {comp.otherFin.n} тр · {fmtInt(comp.otherFin.sum)} грн — свідомо поза P&amp;L (фінансова діяльність/перекази), але враховані у Cash Flow і Балансі. Це нормально.
        </div>
      )}
    </div>
  )
}

function CompBucket({ title, hint, bucket, color, grouped, onChanged, txProps }) {
  const [open, setOpen] = useState(false)
  const n = bucket?.n || 0
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
      <div onClick={() => n && setOpen(o => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, cursor: n ? 'pointer' : 'default' }}>
        <span>
          <i className={`ti ${n ? 'ti-alert-circle' : 'ti-check'}`} style={{ color: n ? color : 'var(--green)', marginRight: 6 }} />
          {title}
          <span style={{ color: 'var(--text3)', fontSize: 12, marginLeft: 6 }}>{hint}</span>
        </span>
        <b style={{ color: n ? color : undefined, whiteSpace: 'nowrap' }}>
          {n ? `${n} тр · ${fmtInt(bucket.sum)} грн ${open ? '▴' : '▾'}` : 'немає'}
        </b>
      </div>
      {open && (bucket.items || []).map(tx => (
        <TxClassify key={tx.id} tx={tx} grouped={grouped} onDone={onChanged} {...txProps} />
      ))}
    </div>
  )
}

const Row = ({ bad, warn, label, val }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
    <span><i className={`ti ${bad ? 'ti-x' : warn ? 'ti-alert-triangle' : 'ti-check'}`} style={{ color: bad ? 'var(--red)' : warn ? 'var(--amber, #d97706)' : 'var(--green)', marginRight: 6 }} />{label}</span>
    <b>{val}</b>
  </div>
)

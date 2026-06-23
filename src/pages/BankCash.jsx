import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import { parseStatement } from '../lib/statements'
import { classifyBatch, classifyTransaction, resetClassifyCache } from '../lib/autoClassify'
import { getAccountBalances } from '../lib/accounts'
import ContractorSelect from '../components/ui/ContractorSelect'

const DIRECTIONS = ['Доходи', 'Витрати', 'Інше', 'ПФД']

export default function BankCash() {
  const [tab, setTab] = useState('transactions')
  const [accounts, setAccounts] = useState([])

  const loadAccounts = async () => { setAccounts(await getAccountBalances()) }
  useEffect(() => { loadAccounts() }, [])

  return (
    <div>
      <div className="page-header"><h1>Банк / Каса</h1></div>

      {/* Рахунки: Залишок (головний) + Надходження / Витрати за період */}
      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        {accounts.map(a => (
          <div className="kpi" key={a.id}>
            <div className="kpi-label"><i className={`ti ${a.type === 'cash' ? 'ti-cash' : 'ti-building-bank'}`} style={{ marginRight: 6 }} />{a.name}</div>
            <div className="kpi-value" style={{ color: a.balance >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {fmtInt(a.balance)} <span style={{ fontSize: 14, color: 'var(--text3)' }}>грн</span>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--green)' }}><i className="ti ti-arrow-down-left" /> {fmtInt(a.inflow)}</span>
              <span style={{ color: 'var(--red)' }}><i className="ti ti-arrow-up-right" /> {fmtInt(a.outflow)}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
        {[['transactions', 'Транзакції', 'ti-list'], ['import', 'Імпорт виписки', 'ti-upload'], ['transfer', 'Внутрішній переказ', 'ti-arrows-exchange']].map(([id, lbl, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}><i className={`ti ${icon}`} style={{ fontSize: 15 }} />{lbl}</button>
        ))}
      </div>

      {tab === 'transactions' && <TransactionsTab accounts={accounts} onChange={loadAccounts} />}
      {tab === 'import' && <ImportTab accounts={accounts} onDone={() => { loadAccounts(); setTab('transactions') }} />}
      {tab === 'transfer' && <TransferTab accounts={accounts} onDone={() => { loadAccounts(); setTab('transactions') }} />}
    </div>
  )
}

const tabStyle = (active) => ({
  padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
  fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
  borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent', color: active ? 'var(--blue)' : 'var(--text2)',
})

// ───────── Транзакції + валідація ─────────
function TransactionsTab({ accounts, onChange }) {
  const [rows, setRows] = useState([])
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('unconfirmed') // unconfirmed | all
  const [acc, setAcc] = useState('all')
  const [linkTx, setLinkTx] = useState(null)

  const load = async () => {
    setLoading(true)
    let qb = supabase.from('bank_transactions')
      .select('id, date, amount, counterparty, description, edrpou, direction, article, article_id, contractor_id, account_id, is_validated')
      .eq('is_ignored', false).order('date', { ascending: false }).limit(500)
    if (status === 'unconfirmed') qb = qb.eq('is_validated', false)
    if (acc !== 'all') qb = qb.eq('account_id', acc)
    const { data } = await qb
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { fetchArticles().then(setArticles) }, [])
  useEffect(() => { load() }, [status, acc])

  const grouped = useMemo(() => groupByType(articles), [articles])

  // авто-класифікація видимих непідтверджених
  const autoFill = async () => {
    resetClassifyCache()
    const updated = await Promise.all(rows.map(async r => {
      if (r.is_validated) return r
      const s = await classifyTransaction(r)
      return { ...r, direction: r.direction || s.direction, article: r.article || s.article, contractor_id: r.contractor_id || s.contractor_id, _suggested: true }
    }))
    setRows(updated)
  }

  const patch = (id, p) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...p } : r))

  const validate = async (r) => {
    const article = articles.find(a => a.name === r.article)
    await supabase.from('bank_transactions').update({
      direction: r.direction, article: r.article || null, article_id: article?.id || null,
      contractor_id: r.contractor_id || null, is_validated: true,
    }).eq('id', r.id)
    load(); onChange()
  }
  const ignore = async (r) => { await supabase.from('bank_transactions').update({ is_ignored: true }).eq('id', r.id); load(); onChange() }

  if (loading) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-input" value={status} onChange={e => setStatus(e.target.value)} style={{ width: 200 }}>
          <option value="unconfirmed">Непідтверджені</option>
          <option value="all">Всі</option>
        </select>
        <select className="form-input" value={acc} onChange={e => setAcc(e.target.value)} style={{ width: 180 }}>
          <option value="all">Всі рахунки</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {status === 'unconfirmed' && rows.length > 0 && <button className="btn" onClick={autoFill}><i className="ti ti-wand" /> Авто-класифікація</button>}
        <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 13 }}>{rows.length} транзакцій</span>
      </div>

      <div className="card">
        {rows.length === 0 ? <p style={{ color: 'var(--text3)', textAlign: 'center', padding: 20 }}>Немає транзакцій</p> : rows.map(r => (
          <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: r.is_validated ? 0 : 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text3)', width: 84 }}>{r.date}</span>
              <span style={{ flex: 1, fontWeight: 500 }} className="trunc">{r.counterparty || r.description || '—'}</span>
              <span className={r.amount >= 0 ? 'amt-pos' : 'amt-neg'} style={{ fontWeight: 600 }}>{r.amount >= 0 ? '+' : ''}{fmt(r.amount)}</span>
              {r.is_validated && <span style={{ fontSize: 11, color: 'var(--green)' }}><i className="ti ti-check" /> {r.direction}{r.article ? ` · ${r.article}` : ''}</span>}
              <button className="btn" onClick={() => setLinkTx(r)} title="Прив'язати до документа/замовлення" style={{ padding: '2px 8px' }}><i className="ti ti-link" /></button>
            </div>
            {!r.is_validated && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingLeft: 94 }}>
                <div style={{ width: 200 }}>
                  <ContractorSelect value={r._cname || ''} placeholder="Контрагент"
                    onChange={(v) => patch(r.id, { _cname: v })}
                    onContractorSelect={(c) => patch(r.id, { contractor_id: c.id, _cname: c.name })} />
                </div>
                <select className="form-input" value={r.direction || ''} onChange={e => patch(r.id, { direction: e.target.value })} style={{ width: 120 }}>
                  <option value="">Напрям</option>
                  {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="form-input" value={r.article || ''} onChange={e => patch(r.id, { article: e.target.value })} style={{ width: 220 }}>
                  <option value="">Стаття</option>
                  {Object.entries(grouped).map(([type, arts]) => (
                    <optgroup key={type} label={TYPE_LABELS[type] || type}>
                      {arts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <button className="btn btn-primary" onClick={() => validate(r)} disabled={!r.direction}><i className="ti ti-check" /> Підтвердити</button>
                <button className="btn" onClick={() => ignore(r)} title="Ігнорувати"><i className="ti ti-eye-off" /></button>
              </div>
            )}
          </div>
        ))}
      </div>

      {linkTx && <TxLinkModal tx={linkTx} onClose={() => setLinkTx(null)} onSaved={() => setLinkTx(null)} />}
    </div>
  )
}

// ───────── Прив'язка транзакції до документів (many-to-many) ─────────
function TxLinkModal({ tx, onClose }) {
  const [docs, setDocs] = useState([])
  const [linked, setLinked] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data: tdocs } = await supabase.from('transaction_documents')
      .select('id, amount, document_id, documents(id, type, file_name, amount, order_id)')
      .eq('transaction_id', tx.id)
    setLinked(tdocs || [])
    let qb = supabase.from('documents').select('id, type, file_name, amount, contractor_id, order_id').order('created_at', { ascending: false }).limit(50)
    if (tx.contractor_id) qb = qb.eq('contractor_id', tx.contractor_id)
    const { data } = await qb
    setDocs(data || [])
  }
  useEffect(() => { load() }, [tx.id])

  const linkedIds = new Set(linked.map(l => l.document_id))
  const remaining = Math.abs(Number(tx.amount) || 0) - linked.reduce((s, l) => s + (Number(l.amount) || 0), 0)

  const attach = async (doc) => {
    setBusy(true)
    const cover = Math.min(Math.abs(remaining) || Math.abs(doc.amount) || 0, Math.abs(doc.amount) || Math.abs(remaining) || 0) || Math.abs(tx.amount)
    await supabase.from('transaction_documents').insert({ transaction_id: tx.id, document_id: doc.id, amount: cover })
    setBusy(false); load()
  }
  const detach = async (l) => { await supabase.from('transaction_documents').delete().eq('id', l.id); load() }

  const filtered = docs.filter(d => {
    if (linkedIds.has(d.id)) return false
    const t = q.trim().toLowerCase()
    if (!t) return true
    return (d.file_name || '').toLowerCase().includes(t) || (d.type || '').toLowerCase().includes(t)
  })

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>Прив'язати транзакцію</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
          {tx.date} · {tx.counterparty || tx.description} · <b>{fmt(tx.amount)} грн</b> · непокрито: <b style={{ color: remaining > 0.5 ? 'var(--red)' : 'var(--green)' }}>{fmt(remaining)}</b>
        </div>

        {linked.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Прив'язані документи</div>
            {linked.map(l => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ flex: 1 }}>{getDocLabel(l.documents)}{l.documents?.order_id && <i className="ti ti-shopping-cart" title="замовлення" style={{ marginLeft: 6, color: 'var(--blue)' }} />}</span>
                <span>{fmt(l.amount)} грн</span>
                <button className="btn" onClick={() => detach(l)} style={{ padding: '2px 8px' }}><i className="ti ti-unlink" /></button>
              </div>
            ))}
          </div>
        )}

        <input className="form-input" placeholder="Пошук документа…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {filtered.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Немає документів для прив'язки{tx.contractor_id ? ' по цьому контрагенту' : ''}.</p>}
          {filtered.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{getDocLabel(d)}</span>
              <span style={{ color: 'var(--text2)' }}>{d.amount ? fmt(d.amount) + ' грн' : '—'}</span>
              <button className="btn btn-primary" onClick={() => attach(d)} disabled={busy} style={{ padding: '4px 10px' }}><i className="ti ti-link" /> Прив'язати</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
const getDocLabel = (d) => d ? `${d.type || 'документ'}${d.file_name ? ' · ' + d.file_name : ''}` : '—'

// ───────── Імпорт виписки ─────────
function ImportTab({ accounts, onDone }) {
  const { user } = useUser()
  const [accId, setAccId] = useState('')
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { if (accounts.length && !accId) setAccId(accounts[0].id) }, [accounts])

  const onFile = async (file) => {
    if (!file) return
    setBusy(true); setError(null); setParsed(null)
    try {
      const txs = await parseStatement(file)
      if (!txs.length) throw new Error('Не вдалося розпізнати транзакції у файлі')
      const classified = await classifyBatch(txs)
      setParsed(classified)
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  const doImport = async () => {
    setBusy(true)
    const rows = parsed.map(t => ({
      account_id: accId || null,
      date: t.date, amount: t.amount,
      counterparty: t.counterparty || null, description: t.description || null,
      reference: t.reference || null, edrpou: t.edrpou || null,
      bank_name: t._bank || null,
      direction: t._auto?.direction || null, article: t._auto?.article || null,
      contractor_id: t._auto?.contractor_id || null,
      is_validated: false, is_ignored: false, imported_by: user?.id || null,
    }))
    const { error } = await supabase.from('bank_transactions').insert(rows)
    setBusy(false)
    resetClassifyCache()
    if (error) { setError(error.message); return }
    onDone()
  }

  return (
    <div className="card">
      <div className="form-group" style={{ maxWidth: 280, marginBottom: 16 }}>
        <label>Рахунок виписки</label>
        <select className="form-input" value={accId} onChange={e => setAccId(e.target.value)}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {!parsed && (
        <label style={{ display: 'block', border: '2px dashed var(--border)', borderRadius: 12, padding: 32, textAlign: 'center', cursor: 'pointer' }}>
          <i className="ti ti-file-spreadsheet" style={{ fontSize: 40, color: 'var(--blue)', display: 'block', marginBottom: 10 }} />
          <div style={{ fontWeight: 600 }}>{busy ? 'Обробка…' : 'Оберіть файл виписки'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>CSV, XLS, XLSX, PDF · ПУМБ, Monobank та інші</div>
          <input type="file" accept=".csv,.xls,.xlsx,.txt,.pdf" style={{ display: 'none' }} onChange={e => onFile(e.target.files[0])} disabled={busy} />
        </label>
      )}
      {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}

      {parsed && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>Розпізнано {parsed.length} транзакцій</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setParsed(null)}>Скасувати</button>
              <button className="btn btn-primary" onClick={doImport} disabled={busy}>{busy ? '…' : 'Імпортувати'}</button>
            </div>
          </div>
          <div className="tbl-wrap" style={{ border: 'none', maxHeight: 400, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Дата</th><th>Контрагент</th><th style={{ textAlign: 'right' }}>Сума</th><th>Авто-стаття</th></tr></thead>
              <tbody>
                {parsed.map((t, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12 }}>{t.date}</td>
                    <td><div className="trunc">{t.counterparty || t.description}</div></td>
                    <td className={t.amount >= 0 ? 'amt-pos' : 'amt-neg'} style={{ textAlign: 'right' }}>{fmt(t.amount)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{t._auto?.article || '—'} {t._auto?.confidence === 'high' && <i className="ti ti-circle-check" style={{ color: 'var(--green)' }} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ───────── Внутрішній переказ ─────────
function TransferTab({ accounts, onDone }) {
  const { user } = useUser()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    if (!from || !to || from === to) { setError('Оберіть різні рахунки'); return }
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Вкажіть суму'); return }
    setBusy(true); setError(null)
    const fromName = accounts.find(a => a.id === from)?.name
    const toName = accounts.find(a => a.id === to)?.name
    const { error } = await supabase.from('bank_transactions').insert([
      { account_id: from, date, amount: -amt, direction: 'Інше', description: `Переказ на ${toName}`, is_validated: true, is_ignored: false, imported_by: user?.id || null },
      { account_id: to, date, amount: amt, direction: 'Інше', description: `Переказ з ${fromName}`, is_validated: true, is_ignored: false, imported_by: user?.id || null },
    ])
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone()
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>Переказ між рахунками — не дохід і не витрата (не потрапляє в P&L).</p>
      <div className="form-group"><label>З рахунку</label>
        <select className="form-input" value={from} onChange={e => setFrom(e.target.value)}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </div>
      <div className="form-group"><label>На рахунок</label>
        <select className="form-input" value={to} onChange={e => setTo(e.target.value)}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </div>
      <div className="form-group"><label>Сума</label><input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
      <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      {error && <div style={{ color: 'var(--red)', fontSize: 13, margin: '8px 0' }}>{error}</div>}
      <button className="btn btn-primary" onClick={save} disabled={busy} style={{ marginTop: 8 }}>{busy ? '…' : 'Створити переказ'}</button>
    </div>
  )
}

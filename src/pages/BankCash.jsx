import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUser } from '../lib/auth'
import { fmt, fmtInt } from '../lib/fmt'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import { parseStatement } from '../lib/statements'
import { classifyBatch, classifyTransaction, resetClassifyCache } from '../lib/autoClassify'
import { getContractorMatcher } from '../lib/contractorMatch'
import { getAccountBalances } from '../lib/accounts'
import { getDocType } from '../lib/docgen'
import { matchScore, confidentMatch } from '../lib/docMatch'
import ContractorSelect from '../components/ui/ContractorSelect'
import DocModal from '../components/DocModal'
import { useSort, SortTh } from '../components/Sort'

// поля документа для DocModal
const DOC_FIELDS = 'id, type, doc_number, doc_date, file_name, amount, vat_amount, is_signed, created_at, direction, contractor_id, storage_path, file_path, file_type, doc_role, contractors(name)'

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
  const [q, setQ] = useState('')
  const [linkTx, setLinkTx] = useState(null)
  const [editTx, setEditTx] = useState(null)
  const [openDoc, setOpenDoc] = useState(null)
  const [linkMsg, setLinkMsg] = useState(null)
  const [linking, setLinking] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const load = async () => {
    setLoading(true)
    let qb = supabase.from('bank_transactions')
      .select('id, date, amount, counterparty, description, edrpou, direction, article, article_id, contractor_id, account_id, is_validated')
      .eq('is_ignored', false).order('date', { ascending: false }).limit(500)
    if (status === 'unconfirmed') qb = qb.eq('is_validated', false)
    if (acc !== 'all') qb = qb.eq('account_id', acc)
    const term = q.trim()
    if (term) {
      const esc = term.replace(/[%,()]/g, ' ')
      qb = qb.or(`counterparty.ilike.%${esc}%,edrpou.ilike.%${esc}%,description.ilike.%${esc}%`)
    }
    const { data } = await qb
    const list = data || []
    // Авто-матч контрагента для непідтверджених без прив'язки (при відкритті списку)
    const matcher = await getContractorMatcher()
    list.forEach(r => {
      if (!r.is_validated && !r.contractor_id) {
        const m = matcher(r)
        if (m) { r.contractor_id = m.contractor.id; r._cname = m.contractor.name; r._matchedBy = m.by }
      }
    })
    // прив'язані документи по кожній транзакції
    const ids = list.map(r => r.id)
    if (ids.length) {
      const { data: tds } = await supabase.from('transaction_documents')
        .select(`transaction_id, documents(${DOC_FIELDS})`).in('transaction_id', ids)
      const byTx = {}
      ;(tds || []).forEach(t => { if (t.documents) (byTx[t.transaction_id] ||= []).push(t.documents) })
      list.forEach(r => { r._docs = byTx[r.id] || [] })
    }
    setRows(list)
    setLoading(false)
  }
  useEffect(() => { fetchArticles().then(setArticles) }, [])
  useEffect(() => { const t = setTimeout(load, q ? 350 : 0); return () => clearTimeout(t) }, [status, acc, q])

  const grouped = useMemo(() => groupByType(articles), [articles])
  const { sort, onSort, sorted } = useSort('date', 'desc')
  const view = sorted(rows, {
    counterparty: r => r.counterparty || '',
    amount: r => Number(r.amount) || 0,
    doc: r => r._docs?.[0] ? (getDocType(r._docs[0].type)?.label || r._docs[0].type) : '',
  })

  // авто-класифікація видимих непідтверджених
  const autoFill = async () => {
    resetClassifyCache()
    const matcher = await getContractorMatcher()
    const updated = await Promise.all(rows.map(async r => {
      if (r.is_validated) return r
      const s = await classifyTransaction(r)
      const m = matcher(r)
      const contractor_id = m?.contractor.id || r.contractor_id || s.contractor_id || null
      return {
        ...r,
        direction: r.direction || s.direction,
        article: r.article || s.article,
        contractor_id,
        _cname: m?.contractor.name || r._cname,
        _suggested: true,
      }
    }))
    setRows(updated)
  }

  // Масова авто-прив'язка: контрагент + сума (±1%) + дата (±15 днів), єдиний впевнений збіг
  const autoLink = async () => {
    setLinking(true); setLinkMsg(null)
    try {
      const [{ data: txs }, { data: docs }, { data: tdocs }] = await Promise.all([
        supabase.from('bank_transactions').select('id, amount, date, direction, contractor_id').eq('is_ignored', false).not('contractor_id', 'is', null),
        supabase.from('documents').select('id, contractor_id, amount, direction, type, doc_date, created_at').not('amount', 'is', null).not('contractor_id', 'is', null),
        supabase.from('transaction_documents').select('transaction_id, document_id, amount'),
      ])
      const covByDoc = {}, covByTx = {}
      ;(tdocs || []).forEach(t => {
        covByDoc[t.document_id] = (covByDoc[t.document_id] || 0) + Math.abs(Number(t.amount) || 0)
        covByTx[t.transaction_id] = (covByTx[t.transaction_id] || 0) + Math.abs(Number(t.amount) || 0)
      })
      const docsByContractor = {}
      ;(docs || []).forEach(d => { (docsByContractor[d.contractor_id] ||= []).push(d) })

      const inserts = []
      for (const t of (txs || [])) {
        const uncovered = Math.abs(Number(t.amount) || 0) - (covByTx[t.id] || 0)
        if (uncovered <= 0.5) continue
        const cand = confidentMatch(t, docsByContractor[t.contractor_id] || [], covByDoc)
        if (!cand) continue
        const amt = Math.min(uncovered, cand.outstanding)
        inserts.push({ transaction_id: t.id, document_id: cand.doc.id, amount: amt })
        covByDoc[cand.doc.id] = (covByDoc[cand.doc.id] || 0) + amt // не лінкувати той самий документ двічі
        covByTx[t.id] = (covByTx[t.id] || 0) + amt
      }
      let linked = 0
      for (let i = 0; i < inserts.length; i += 100) {
        const chunk = inserts.slice(i, i + 100)
        const { error } = await supabase.from('transaction_documents').upsert(chunk, { onConflict: 'transaction_id,document_id', ignoreDuplicates: true })
        if (!error) linked += chunk.length
      }
      setLinkMsg(`Прив'язано ${linked} ${inserts.length !== linked ? `(зі спроб ${inserts.length})` : ''}. Решта — без впевненого збігу, прив'яжи вручну.`)
      load(); onChange()
    } catch (e) { setLinkMsg('Помилка: ' + e.message) }
    setLinking(false)
  }


  if (loading) return <div className="card"><p style={{ color: 'var(--text3)' }}>Завантаження…</p></div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" placeholder="Пошук: контрагент або ЄДРПОУ…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 240px', maxWidth: 340 }} />
        <select className="form-input" value={status} onChange={e => setStatus(e.target.value)} style={{ width: 180 }}>
          <option value="unconfirmed">Непідтверджені</option>
          <option value="all">Всі</option>
        </select>
        <select className="form-input" value={acc} onChange={e => setAcc(e.target.value)} style={{ width: 180 }}>
          <option value="all">Всі рахунки</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><i className="ti ti-plus" /> Додати операцію</button>
        {status === 'unconfirmed' && rows.length > 0 && <button className="btn" onClick={autoFill}><i className="ti ti-wand" /> Авто-класифікація</button>}
        <button className="btn" onClick={autoLink} disabled={linking} title="Прив'язати документи за контрагентом + сумою + датою (±15 днів)"><i className="ti ti-link" /> {linking ? 'Прив\'язую…' : 'Авто-прив\'язка'}</button>
        <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 13 }}>{rows.length} транзакцій</span>
      </div>
      {linkMsg && <div style={{ background: 'var(--green-bg)', color: 'var(--green)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>{linkMsg}</div>}

      <div className="card">
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead><tr>
              <SortTh label="Дата" k="date" sort={sort} onSort={onSort} />
              <SortTh label="Контрагент" k="counterparty" sort={sort} onSort={onSort} />
              <SortTh label="Сума" k="amount" sort={sort} onSort={onSort} align="right" />
              <SortTh label="Напрям" k="direction" sort={sort} onSort={onSort} />
              <SortTh label="Стаття" k="article" sort={sort} onSort={onSort} />
              <SortTh label="Документ" k="doc" sort={sort} onSort={onSort} />
              <th></th>
            </tr></thead>
            <tbody>
              {view.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setEditTx(r)}>
                  <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{r.date}</td>
                  <td>
                    <div className="trunc" style={{ fontWeight: 500 }}>{r.counterparty || '—'}</div>
                    {r.description && <div className="trunc" style={{ fontSize: 11, color: 'var(--text3)' }}>{r.description}</div>}
                  </td>
                  <td className={r.amount >= 0 ? 'amt-pos' : 'amt-neg'} style={{ textAlign: 'right', fontWeight: 600 }}>{r.amount >= 0 ? '+' : ''}{fmt(r.amount)}</td>
                  <td style={{ fontSize: 13 }}>{r.direction || <span style={{ color: 'var(--red)' }}>—</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}><div className="trunc">{r.article || '—'}</div></td>
                  <td style={{ fontSize: 12 }}>
                    {r._docs?.length
                      ? <a onClick={(e) => { e.stopPropagation(); setOpenDoc(r._docs[0]) }} style={{ color: 'var(--blue)', cursor: 'pointer' }} title={r._docs.map(d => getDocLabel(d)).join('\n')}>
                          <i className="ti ti-file-check" /> {getDocType(r._docs[0].type)?.label || 'документ'}{r._docs.length > 1 ? ` +${r._docs.length - 1}` : ''}
                        </a>
                      : <span style={{ color: 'var(--text3)' }}>не прив'язано</span>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.is_validated
                      ? <span style={{ color: 'var(--green)', marginRight: 8 }} title="Підтверджено"><i className="ti ti-check" /></span>
                      : <span style={{ color: '#D97706', marginRight: 8 }} title="Потребує підтвердження">●</span>}
                    <button className="btn" onClick={(e) => { e.stopPropagation(); setLinkTx(r) }} title="Прив'язати документ" style={{ padding: '2px 8px' }}><i className="ti ti-link" /></button>
                  </td>
                </tr>
              ))}
              {view.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Немає транзакцій</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddTxModal accounts={accounts} grouped={grouped} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); onChange() }} />}
      {editTx && <TxModal tx={editTx} grouped={grouped} onClose={() => setEditTx(null)} onSaved={() => { setEditTx(null); load(); onChange() }} onLink={() => { setLinkTx(editTx); setEditTx(null) }} onOpenDoc={(d) => { setOpenDoc(d); setEditTx(null) }} />}
      {linkTx && <TxLinkModal tx={linkTx} onClose={() => setLinkTx(null)} onSaved={() => { setLinkTx(null); load() }} />}
      {openDoc && <DocModal existingDoc={openDoc} autoOcr={false} onClose={() => setOpenDoc(null)} onSaved={() => { setOpenDoc(null); load() }} />}
    </div>
  )
}

// ───────── Ручне додавання операції (надходження / витрата) ─────────
function AddTxModal({ accounts, grouped, onClose, onSaved }) {
  const { user } = useUser()
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({
    account_id: accounts[0]?.id || '', date: today, kind: 'in', amount: '',
    direction: 'Доходи', article: '', contractor_id: null, cname: '', description: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  // при зміні типу — підставити логічний напрям за замовчуванням
  const setKind = (kind) => setF(s => ({ ...s, kind, direction: kind === 'in' ? 'Доходи' : 'Витрати' }))

  const save = async () => {
    const sum = Number(f.amount)
    if (!f.account_id) { setError('Оберіть рахунок'); return }
    if (!sum || sum <= 0) { setError('Вкажіть суму'); return }
    setBusy(true); setError(null)
    const arts = Object.values(grouped).flat()
    const article = arts.find(a => a.name === f.article)
    const signed = f.kind === 'in' ? Math.abs(sum) : -Math.abs(sum)
    const { error } = await supabase.from('bank_transactions').insert({
      account_id: f.account_id, date: f.date, amount: signed,
      direction: f.direction || null, article: f.article || null, article_id: article?.id || null,
      contractor_id: f.contractor_id || null, counterparty: f.cname || null, description: f.description || null,
      is_validated: true, is_ignored: false, imported_by: user?.id || null,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header"><h2>Додати операцію</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div className="form-grid">
          <div className="form-group"><label>Рахунок *</label>
            <select className="form-input" value={f.account_id} onChange={e => set('account_id', e.target.value)}>
              <option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Дата</label><input className="form-input" type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
          <div className="form-group"><label>Тип</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" onClick={() => setKind('in')} style={{ flex: 1, background: f.kind === 'in' ? 'var(--green)' : 'var(--surface)', color: f.kind === 'in' ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>Надходження</button>
              <button className="btn" onClick={() => setKind('out')} style={{ flex: 1, background: f.kind === 'out' ? 'var(--red)' : 'var(--surface)', color: f.kind === 'out' ? '#fff' : 'var(--text2)', border: '1px solid var(--border)' }}>Витрата</button>
            </div>
          </div>
          <div className="form-group"><label>Сума *</label><input className="form-input" type="number" min="0" step="0.01" value={f.amount} onChange={e => set('amount', e.target.value)} /></div>
          <div className="form-group"><label>Напрям (P&L)</label>
            <select className="form-input" value={f.direction} onChange={e => set('direction', e.target.value)}>
              {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Стаття</label>
            <select className="form-input" value={f.article} onChange={e => set('article', e.target.value)}>
              <option value="">—</option>
              {Object.entries(grouped).map(([type, arts]) => (
                <optgroup key={type} label={TYPE_LABELS[type] || type}>
                  {arts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="form-group full"><label>Контрагент</label>
            <ContractorSelect value={f.cname} placeholder="Контрагент (необов'язково)"
              onChange={(v) => set('cname', v)}
              onContractorSelect={(c) => setF(s => ({ ...s, contractor_id: c.id, cname: c.name }))} />
          </div>
          <div className="form-group full"><label>Опис</label><input className="form-input" value={f.description} onChange={e => set('description', e.target.value)} /></div>
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}><i className="ti ti-check" /> {busy ? '…' : 'Зберегти'}</button>
        </div>
      </div>
    </div>
  )
}

// ───────── Модалка транзакції: класифікація / підтвердження / ігнор / прив'язка ─────────
function TxModal({ tx, grouped, onClose, onSaved, onLink, onOpenDoc }) {
  const [f, setF] = useState({ contractor_id: tx.contractor_id || null, cname: tx._cname || tx.counterparty || '', direction: tx.direction || '', article: tx.article || '' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  const persist = async (validate) => {
    setBusy(true)
    const arts = Object.values(grouped).flat()
    const article = arts.find(a => a.name === f.article)
    await supabase.from('bank_transactions').update({
      direction: f.direction || null, article: f.article || null, article_id: article?.id || null,
      contractor_id: f.contractor_id || null, ...(validate ? { is_validated: true } : {}),
    }).eq('id', tx.id)
    setBusy(false); onSaved()
  }
  const ignore = async () => { setBusy(true); await supabase.from('bank_transactions').update({ is_ignored: true }).eq('id', tx.id); setBusy(false); onSaved() }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header"><h2>Транзакція</h2><button onClick={onClose} className="modal-close"><i className="ti ti-x" /></button></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>{tx.date} · {tx.counterparty || tx.description}</div>
          <div className={tx.amount >= 0 ? 'amt-pos' : 'amt-neg'} style={{ fontSize: 20, fontWeight: 700 }}>{tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)} грн</div>
        </div>
        {tx.description && tx.counterparty && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>{tx.description}</div>}

        {/* Прив'язані документи */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Документи</div>
          {tx._docs?.length ? tx._docs.map(d => (
            <div key={d.id} onClick={() => onOpenDoc(d)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
              <span style={{ color: 'var(--blue)' }}><i className="ti ti-file-check" /> {getDocLabel(d)}</span>
              <span style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>{d.amount ? fmt(d.amount) + ' грн' : ''} <i className="ti ti-external-link" style={{ fontSize: 12 }} /></span>
            </div>
          )) : <div style={{ fontSize: 13, color: 'var(--text3)' }}>Документ не прив'язано. <a onClick={onLink} style={{ color: 'var(--blue)', cursor: 'pointer' }}>Прив'язати</a></div>}
        </div>

        <div className="form-grid">
          <div className="form-group full"><label>Контрагент</label>
            <ContractorSelect value={f.cname} placeholder="Контрагент"
              onChange={(v) => set('cname', v)}
              onContractorSelect={(c) => setF(s => ({ ...s, contractor_id: c.id, cname: c.name }))} />
          </div>
          <div className="form-group"><label>Напрям</label>
            <select className="form-input" value={f.direction} onChange={e => set('direction', e.target.value)}>
              <option value="">—</option>{DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Стаття</label>
            <select className="form-input" value={f.article} onChange={e => set('article', e.target.value)}>
              <option value="">—</option>
              {Object.entries(grouped).map(([type, arts]) => (
                <optgroup key={type} label={TYPE_LABELS[type] || type}>
                  {arts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={ignore} disabled={busy} style={{ color: 'var(--text3)' }}><i className="ti ti-eye-off" /> Ігнорувати</button>
            <button className="btn" onClick={onLink}><i className="ti ti-link" /> Документи</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => persist(false)} disabled={busy}>Зберегти</button>
            <button className="btn btn-primary" onClick={() => persist(true)} disabled={busy || !f.direction}><i className="ti ti-check" /> Підтвердити</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ───────── Прив'язка транзакції до документів (many-to-many) ─────────
function TxLinkModal({ tx, onClose }) {
  const [docs, setDocs] = useState([])
  const [linked, setLinked] = useState([])
  const [cov, setCov] = useState({}) // document_id → вже покрито з усіх транзакцій
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data: tdocs } = await supabase.from('transaction_documents')
      .select('id, amount, document_id, documents(id, type, file_name, amount, order_id)')
      .eq('transaction_id', tx.id)
    setLinked(tdocs || [])
    let qb = supabase.from('documents').select('id, type, file_name, amount, contractor_id, order_id, direction, doc_date, created_at').order('created_at', { ascending: false }).limit(100)
    if (tx.contractor_id) qb = qb.eq('contractor_id', tx.contractor_id)
    const { data } = await qb
    setDocs(data || [])
    // покриття кандидатів з УСІХ транзакцій (для коректного залишку при частковій оплаті)
    const ids = (data || []).map(d => d.id)
    if (ids.length) {
      const { data: allTd } = await supabase.from('transaction_documents').select('document_id, amount').in('document_id', ids)
      const m = {}; (allTd || []).forEach(t => { m[t.document_id] = (m[t.document_id] || 0) + Math.abs(Number(t.amount) || 0) })
      setCov(m)
    }
  }
  useEffect(() => { load() }, [tx.id])

  const linkedIds = new Set(linked.map(l => l.document_id))
  const remaining = Math.abs(Number(tx.amount) || 0) - linked.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const outstandingOf = (doc) => Math.abs(Number(doc.amount) || 0) - (cov[doc.id] || 0)

  const attach = async (doc) => {
    setBusy(true)
    const txRemaining = Math.abs(remaining) > 0.01 ? Math.abs(remaining) : Math.abs(Number(tx.amount) || 0)
    const docOut = outstandingOf(doc)
    const cover = Math.round(Math.min(txRemaining, docOut > 0.01 ? docOut : Math.abs(Number(doc.amount) || 0)) * 100) / 100
    await supabase.from('transaction_documents').insert({ transaction_id: tx.id, document_id: doc.id, amount: cover })
    setBusy(false); load()
  }
  const detach = async (l) => { await supabase.from('transaction_documents').delete().eq('id', l.id); load() }

  const scored = docs
    .filter(d => !linkedIds.has(d.id))
    .filter(d => {
      const t = q.trim().toLowerCase()
      if (!t) return true
      return (d.file_name || '').toLowerCase().includes(t) || (getDocType(d.type)?.label || d.type || '').toLowerCase().includes(t)
    })
    .map(d => ({ doc: d, ...matchScore(tx, d, outstandingOf(d)) }))
    .sort((a, b) => b.score - a.score)

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
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {scored.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Немає документів для прив'язки{tx.contractor_id ? ' по цьому контрагенту' : ''}.</p>}
          {scored.map(({ doc: d, amountClose, dateClose, daysDiff }) => {
            const best = amountClose && dateClose
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13, background: best ? 'var(--green-bg)' : undefined }}>
                <div style={{ flex: 1 }}>
                  <div>{getDocLabel(d)}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                    {amountClose && <span style={badge('var(--green-bg)', 'var(--green)')}>сума ✓</span>}
                    {dateClose && <span style={badge('var(--green-bg)', 'var(--green)')}>дата ±{daysDiff}дн</span>}
                    {!dateClose && Number.isFinite(daysDiff) && daysDiff < 900 && <span style={badge('var(--surface2)', 'var(--text3)')}>{daysDiff}дн</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--text2)' }}>{d.amount ? fmt(d.amount) + ' грн' : '—'}</div>
                  {(cov[d.id] || 0) > 0.01 && <div style={{ fontSize: 11, color: outstandingOf(d) > 0.01 ? '#D97706' : 'var(--green)' }}>залишок {fmt(outstandingOf(d))}</div>}
                </div>
                <button className="btn btn-primary" onClick={() => attach(d)} disabled={busy} style={{ padding: '4px 10px' }}><i className="ti ti-link" /> Прив'язати</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
const getDocLabel = (d) => d ? `${getDocType(d.type)?.label || d.type || 'документ'}${d.file_name ? ' · ' + d.file_name : ''}` : '—'
const badge = (bg, color) => ({ background: bg, color, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' })

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
      // Авто-матч контрагента по ЄДРПОУ/назві (пріоритетніше за класифікатор)
      const matcher = await getContractorMatcher()
      classified.forEach(t => {
        const m = matcher(t)
        if (m) { t._auto = { ...t._auto, contractor_id: m.contractor.id }; t._matchName = m.contractor.name }
      })
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
                    <td><div className="trunc">{t._matchName || t.counterparty || t.description}{t._matchName && <i className="ti ti-link" style={{ color: 'var(--green)', marginLeft: 4 }} title="Знайдено контрагента" />}</div></td>
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

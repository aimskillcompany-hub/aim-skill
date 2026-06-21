import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'
import { fetchArticles, groupByType, TYPE_LABELS } from '../lib/articles'
import ContractorSelect from './ui/ContractorSelect'
import { upsertContractor } from '../lib/contractors'
import { fmtInt as fmt } from '../lib/fmt'

const USE_PROXY = !import.meta.env.DEV
const API_KEY = import.meta.env.VITE_ANTHROPIC_KEY

// ── Пряме читання XLSX/XLS (SheetJS) ─────────────────────────────────────────
async function readXlsx(file) {
  try {
    const buf = await file.arrayBuffer()
    const data = new Uint8Array(buf)
    const wb = XLSX.read(data, {
      type: 'array',
      codepage: 1251,
      cellText: true,
      cellDates: false,
      cellNF: false,
    })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    return rows
  } catch (e) {
    console.error('[Bank] readXlsx error:', e.message)
    throw e
  }
}

// ── Детектор форматів ─────────────────────────────────────────────────────────
function detectFormat(rows) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const h = (rows[i] || []).map(c => (c||'').toString().toLowerCase().trim())
    const joined = h.join(' ')

    // Monobank Business / Universalbank — є "вид операції"
    if (joined.includes('вид операц')) return 'monobank'

    // ПУМБ — "дебет"/"кредит" АБО "зараховано"/"списано" АБО "єдрпоу" + ("платник" або "одержувач")
    if ((joined.includes('дебет') || joined.includes('зарахован') || joined.includes('списан')) &&
        (joined.includes('кредит') || joined.includes('зарахован') || joined.includes('списан')) &&
        h.filter(c => c.includes('дебет') || c.includes('кредит') || c.includes('зарахован') || c.includes('списан')).length >= 2) return 'pumb'

    // Fallback: if row has "єдрпоу" and "платник" or "рахунок" — it's ПУМБ
    if (joined.includes('дрпоу') && (joined.includes('платник') || joined.includes('рахунок'))) return 'pumb'
  }

  return 'unknown'
}

// ── Парсер Monobank Business (Universalbank MFO 322001) ───────────────────────
// Cols(0-based): 0-дата, 2-тип, 3-опис, 4-контрагент, 5-ЄДРПОУ, 6-IBAN, 7-сума, 14-референс
function parseMonobank(rows) {
  const txs = []
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    const dateStr = row[0]?.toString().trim()
    const amtStr  = row[7]?.toString().trim()
    if (!dateStr || !amtStr) continue

    const parts = dateStr.split('.')
    if (parts.length !== 3) continue
    const date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`

    const amount = parseFloat(amtStr.replace(/\s/g,'').replace(',','.')) || 0
    if (amount === 0) continue

    const desc = (row[3]||'').toString().trim()
    const refMatch = desc.match(/[№#№]\s*([\w\/-]+)/)
    const docRef = row[14]?.toString().trim() || refMatch?.[1] || null

    txs.push({
      date, amount,
      counterparty: row[4]?.toString().trim() || null,
      description:  desc.substring(0, 200),
      reference:    docRef,
      account:      row[6]?.toString().trim() || null,
      edrpou:       row[5]?.toString().trim() || null,
    })
  }
  return txs
}

// ── Парсер ПУМБ (FUIB) ────────────────────────────────────────────────────────
// ПУМБ має окремі колонки Дебет і Кредит
// Типовий порядок: Дата, Дата вал., Документ №, Призначення, Партнер, МФО, Рахунок, Дебет, Кредит, Залишок
function parsePUMB(rows) {
  // Знаходимо рядок заголовків (може бути на рядку 0-10)
  let headerIdx = -1
  let cols = {}
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] || []
    const h = row.map(c => (c||'').toString().toLowerCase().trim())
    // Шукаємо дебет/кредит АБО зараховано/списано (часткові збіги для кодування)
    const hasDebit  = h.findIndex(c => c.includes('дебет') || c.includes('списан'))
    const hasCredit = h.findIndex(c => c.includes('кредит') || c.includes('зарахован'))
    if (hasDebit >= 0 && hasCredit >= 0) {
      headerIdx = i
      cols.date        = h.findIndex(c => c.includes('дат') && !c.includes('вал'))
      cols.desc        = h.findIndex(c => c.includes('призначен') || c.includes('детал') || c.includes('опис'))
      cols.counterparty= h.findIndex(c => c.includes('платник') || c.includes('одержувач') || c.includes('партнер') || c.includes('контрагент'))
      cols.edrpou      = h.findIndex(c => c.includes('дрпоу') || c.includes('іпн'))
      cols.bank        = h.findIndex(c => c.includes('банк') && !c.includes('мфо'))
      cols.mfo         = h.findIndex(c => c.includes('мфо'))
      cols.account     = h.findIndex(c => c.includes('рахунок') || c.includes('iban'))
      cols.debit       = hasDebit
      cols.credit      = hasCredit
      cols.docNum      = h.findIndex(c => c.includes('документ') || c.includes('доручен') || c.includes('номер'))
      break
    }
  }
  if (headerIdx < 0) return []

  const txs = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row[cols.date]) continue
    const dateStr = row[cols.date]?.toString().trim()
    if (!dateStr) continue

    // Дата: DD.MM.YYYY або MM/DD/YYYY або YYYY-MM-DD
    let date = dateStr
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
      const [d,m,y] = dateStr.split('.')
      date = `${y}-${m}-${d}`
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [d,m,y] = dateStr.split('/')
      date = `${y}-${m}-${d}`
    }

    // Parse amount: handle "1,151,647.67" (commas as thousands) and "1 151 647,67" (spaces + comma decimal)
    const parseAmt = s => {
      if (!s) return 0
      let str = s.toString().trim()
      // If has dot as decimal and commas as thousands: 1,151,647.67
      if (str.includes('.') && str.includes(',')) {
        str = str.replace(/,/g, '')
      }
      // If only commas, could be decimal: 1647,67 → 1647.67
      else if (str.includes(',') && !str.includes('.')) {
        str = str.replace(/,/g, '.')
      }
      str = str.replace(/\s/g, '')
      return parseFloat(str) || 0
    }
    const debitVal  = parseAmt(row[cols.debit])
    const creditVal = parseAmt(row[cols.credit])
    if (debitVal === 0 && creditVal === 0) continue

    // Зараховано = надходження (плюс), Списано = витрата (мінус)
    const amount = creditVal > 0 ? creditVal : -debitVal

    const desc   = cols.desc >= 0 ? (row[cols.desc]||'').toString().trim() : ''
    const docNum = cols.docNum >= 0 ? (row[cols.docNum]||'').toString().trim() : ''

    txs.push({
      date, amount,
      counterparty: cols.counterparty >= 0 ? (row[cols.counterparty]||'').toString().trim() || null : null,
      description:  desc.substring(0, 200),
      reference:    docNum || null,
      account:      cols.account >= 0 ? (row[cols.account]||'').toString().trim() || null : null,
      edrpou:       cols.edrpou >= 0 ? (row[cols.edrpou]||'').toString().trim() || null : null,
      bank_name:    cols.bank >= 0 ? (row[cols.bank]||'').toString().trim() || null : null,
      mfo:          cols.mfo >= 0 ? (row[cols.mfo]||'').toString().trim() || null : null,
    })
  }
  return txs
}

// ── CSV з кодуванням ──────────────────────────────────────────────────────────
async function readCsvText(file) {
  const tryEnc = enc => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsText(file, enc)
  })
  const utf8 = await tryEnc('utf-8')
  const garbled = (utf8.match(/[À-ÿ]{3,}/g) || []).length > 3 || utf8.includes('\uFFFD')
  return garbled ? tryEnc('windows-1251') : utf8
}

// ── Claude fallback для PDF та невідомих CSV ──────────────────────────────────
const PARSE_PROMPT = `Ти парсер банківських виписок українських банків. Поверни ТІЛЬКИ JSON масив:
[{"date":"YYYY-MM-DD","amount":число_зі_знаком,"counterparty":"назва або null","description":"опис до 150 символів","reference":"номер або null","account":"IBAN або null"}]
Суми зі знаком: надходження +, витрати -. Якщо не виписка — [].`

async function parseWithClaude(content, fileName, isPDF = false) {
  const messages = isPDF
    ? [{ role:'user', content:[
        { type:'document', source:{ type:'base64', media_type:'application/pdf', data:content } },
        { type:'text', text:`Файл: ${fileName}. Розпізнай виписку та поверни JSON.` }
      ]}]
    : [{ role:'user', content:`Банківська виписка (${fileName}):\n\n${content.substring(0, 28000)}` }]

  const requestBody = { model:'claude-sonnet-4-6', max_tokens:4096, system:PARSE_PROMPT, messages }
  let res
  if (USE_PROXY) {
    res = await fetch('/api/ai', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(requestBody) })
  } else {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key': API_KEY, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true' },
      body: JSON.stringify(requestBody)
    })
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  const txt = data.content?.find(b => b.type==='text')?.text || '[]'
  return JSON.parse(txt.replace(/```json|```/g,'').trim())
}

// ── Головна функція парсингу ──────────────────────────────────────────────────
async function parseStatement(file) {
  const ext = file.name.split('.').pop().toLowerCase()

  // XLSX / XLS — читаємо через SheetJS
  if (ext === 'xlsx' || ext === 'xls') {
    const rows = await readXlsx(file)
    const format = detectFormat(rows)

    if (format === 'monobank') {
      const txs = parseMonobank(rows)
      if (txs.length > 0) return txs
    }
    if (format === 'pumb') {
      const txs = parsePUMB(rows)
      if (txs.length > 0) return txs
    }

    // Невідомий XLSX — конвертуємо в CSV і кидаємо Claude
    const buf = await file.arrayBuffer()
    const wb2 = XLSX.read(buf, { type: 'array', codepage: 1251 })
    const csv = XLSX.utils.sheet_to_csv(Object.values(wb2.Sheets)[0])
    return parseWithClaude(csv, file.name)
  }

  // PDF — через Claude
  if (ext === 'pdf') {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file)
    })
    return parseWithClaude(b64, file.name, true)
  }

  // CSV / TXT — через Claude з правильним кодуванням
  const text = await readCsvText(file)
  return parseWithClaude(text, file.name)
}

function findMatch(btx, existingTxs) {
  const bankAmt = Math.abs(btx.amount)
  const bankDate = new Date(btx.date)
  const sign = btx.amount > 0 ? 1 : -1
  const candidates = existingTxs.filter(tx => {
    const sameSign = (tx.amount > 0) === (sign > 0)
    const amtMatch = Math.abs(Math.abs(tx.amount) - bankAmt) < 2
    const daysDiff = Math.abs((new Date(tx.date) - bankDate) / 86400000)
    return sameSign && amtMatch && daysDiff <= 5
  })
  return candidates.sort((a, b) =>
    Math.abs((new Date(a.date) - bankDate) / 86400000) - Math.abs((new Date(b.date) - bankDate) / 86400000)
  )[0] || null
}

const DIRS = ['Витрати','Доходи','ПФД','Внутрішні перекази','Відсотки банку','Інше']

export default function Bank({ user }) {
  const [tab, setTab] = useState('import')
  const [unmatched, setUnmatched] = useState([])
  const [allBankTxs, setAllBankTxs] = useState([])
  const [linkedTxDetail, setLinkedTxDetail] = useState(null)   // full transaction details
  const [linkedTxDocs, setLinkedTxDocs] = useState([])
  const [linkedTxItems, setLinkedTxItems] = useState([])
  const [linkedTxLoading, setLinkedTxLoading] = useState(false)
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)

  const [parseError, setParseError] = useState(null)
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState(null)  // {txs, matches}
  const [bankName, setBankName] = useState('')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef()

  // Action modals
  const [createFrom, setCreateFrom] = useState(null)
  const [linkFor, setLinkFor] = useState(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState([])
  const [createForm, setCreateForm] = useState({})
  const [createSaving, setCreateSaving] = useState(false)

  // Filters for unmatched
  const [filter, setFilter] = useState({ search: '', direction: '', dateFrom: '', dateTo: '' })

  // Reconcile tab state
  const [reconcileItems, setReconcileItems] = useState([])   // [{bankTx, docTx, rule, confidence}]
  const [reconcileLoading, setReconcileLoading] = useState(false)
  const [reconcileRun, setReconcileRun] = useState(false)
  const [confirmingSingle, setConfirmingSingle] = useState(null)
  // Filters for all bank txs
  const [allFilter, setAllFilter] = useState({ search: '', status: '', direction: '', dateFrom: '', dateTo: '' })

  // Multi-select + bulk create
  const [selected, setSelected] = useState(new Set())
  const [bulkForm, setBulkForm] = useState({ direction: 'Витрати', article: '', projectId: '' })
  const [bulkSaving, setBulkSaving] = useState(false)
  const [showBulk, setShowBulk] = useState(false)

  useEffect(() => {
    supabase.from('projects').select('id,name').order('name').then(({ data }) => setProjects(data || []))
    fetchArticles().then(setArticlesList)
  }, [])

  const [articlesList, setArticlesList] = useState([])

  useEffect(() => {
    if (tab === 'unmatched') loadUnmatched()
    if (tab === 'all') loadAll()
  }, [tab])

  const openLinkedTx = async (txId) => {
    if (!txId) return
    setLinkedTxLoading(true)
    setLinkedTxDetail(null)
    const [{ data: tx }, { data: docs }, { data: items }] = await Promise.all([
      supabase.from('bank_transactions').select('*').eq('id', txId).single(),
      supabase.from('documents').select('*').eq('bank_transaction_id', txId),
      supabase.from('transaction_items').select('*').eq('bank_transaction_id', txId),
    ])
    setLinkedTxDetail(tx)
    setLinkedTxDocs(docs || [])
    setLinkedTxItems(items || [])
    setLinkedTxLoading(false)
  }

  const downloadDoc = async (doc) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const loadUnmatched = async () => {
    setLoading(true)
    const { data } = await supabase.from('bank_transactions')
      .select('*').eq('is_matched', false).eq('is_ignored', false)
      .order('date', { ascending: false })
    setUnmatched(data || [])
    setLoading(false)
  }

  const loadAll = async () => {
    setLoading(true)
    const { data } = await supabase.from('bank_transactions')
      .select('*, transactions(id, contractor, date, amount, direction, article, doc_type, doc_number, edrpou)').order('date', { ascending: false }).limit(200)
    setAllBankTxs(data || [])
    setLoading(false)
  }

  // ── IMPORT ──────────────────────────────────────────────────────────────────
  const handleFile = async (f) => {
    if (!f) return
    setFile(f)
    setParsed(null)
    setParseError(null)
    setParsing(true)
    try {
      const txs = await parseStatement(f)

      if (!txs || !Array.isArray(txs)) {
        throw new Error('Некоректний формат відповіді. Спробуйте ще раз.')
      }

      if (!txs.length) {
        throw new Error(
          `Транзакцій не знайдено у файлі "${f.name}".\n\n` +
          `Можливі причини:\n` +
          `• Файл порожній або містить лише заголовки\n` +
          `• Нестандартний формат виписки\n` +
          `• Спробуйте зберегти виписку як CSV (не XLS) і завантажити знову`
        )
      }

      // Load existing bank_transactions to detect duplicates
      const { data: existingBank } = await supabase
        .from('bank_transactions')
        .select('date,amount,counterparty,reference')

      const withMatches = txs.map(tx => {
        // Check for duplicate in bank_transactions
        const isDuplicate = (existingBank || []).some(b => {
          const sameAmt = Math.abs(b.amount - tx.amount) < 0.01
          const sameDate = b.date === tx.date
          const sameRef = tx.reference && b.reference && tx.reference === b.reference
          const sameName = b.counterparty && tx.counterparty &&
            b.counterparty.toLowerCase().trim() === tx.counterparty.toLowerCase().trim()
          return sameRef || (sameAmt && sameDate && sameName) || (sameAmt && sameDate && !tx.counterparty)
        })
        return {
          ...tx,
          _match: null,
          _selected: !isDuplicate, // дублікати знімаємо з вибору автоматично
          _isDuplicate: isDuplicate,
        }
      })
      // Авто-класифікація
      const { classifyBatch } = await import('../lib/autoClassify')
      const classified = await classifyBatch(withMatches)
      setParsed({ txs: classified, fileName: f.name })
    } catch (e) {
      setParseError(e.message)
    } finally {
      setParsing(false)
    }
  }

  const toggleSelect = (i) => {
    setParsed(p => ({ ...p, txs: p.txs.map((t, j) => j === i ? { ...t, _selected: !t._selected } : t) }))
  }

  const handleImport = async () => {
    if (!parsed) return
    setImporting(true)

    // Upsert contractors with IBAN from bank statement
    const selected = parsed.txs.filter(t => t._selected)
    const seenNames = new Set()
    for (const t of selected) {
      if (!t.counterparty || seenNames.has(t.counterparty.toLowerCase())) continue
      seenNames.add(t.counterparty.toLowerCase())
      await upsertContractor(supabase, {
        name: t.counterparty,
        edrpou: t.edrpou,
        iban: t.account,
        bank_name: t.bank_name,
        mfo: t.mfo,
        default_direction: t.amount > 0 ? 'Доходи' : 'Витрати',
        userId: user.id,
      })
    }

    // Load all contractors to auto-fill direction/article from defaults
    const { data: allContractors } = await supabase.from('contractors').select('name, default_article, default_direction, edrpou, id')
    const contractorMap = {}
    ;(allContractors || []).forEach(c => {
      if (c.name) contractorMap[c.name.trim().toLowerCase()] = c
    })

    const toInsert = selected.map(t => {
      const ct = contractorMap[t.counterparty?.trim().toLowerCase()] || {}
      const auto = t._auto || {}
      return {
        bank_name: bankName || null,
        date: t.date,
        amount: t.amount,
        counterparty: t.counterparty,
        description: t.description,
        reference: t.reference,
        account: t.account,
        imported_by: user.id,
        // Авто-класифікація → contractor defaults → amount sign
        direction: t._userDirection || auto.direction || ct.default_direction || (t.amount > 0 ? 'Доходи' : 'Витрати'),
        article: t._userArticle || auto.article || ct.default_article || null,
        edrpou: t.edrpou || ct.edrpou || null,
        contractor_id: auto.contractor_id || ct.id || null,
      }
    })
    const { error } = await supabase.from('bank_transactions').insert(toInsert)
    if (error) { alert('Помилка імпорту: ' + error.message); setImporting(false); return }
    setImporting(false)
    setParsed(null)
    setFile(null)
    setTab('unmatched')
    loadUnmatched()
  }

  // ── UNMATCHED ACTIONS ────────────────────────────────────────────────────────
  const handleIgnore = async (id) => {
    // Перевірити чи є складські рухи
    const { data: movs } = await supabase.from('stock_movements').select('id, product_id, quantity, type')
      .eq('bank_transaction_id', id)
    const hasStock = movs && movs.length > 0
    const msg = hasStock
      ? `Ігнорувати цю транзакцію? Є ${movs.length} складських рухів — вони також будуть видалені.`
      : 'Ігнорувати цю транзакцію? Вона зникне зі списку.'
    if (!confirm(msg)) return
    if (hasStock) {
      await supabase.from('stock_movements').delete().eq('bank_transaction_id', id)
    }
    await supabase.from('bank_transactions').update({ is_ignored: true }).eq('id', id)
    setUnmatched(u => u.filter(t => t.id !== id))
    setSelected(s => { const ns = new Set(s); ns.delete(id); return ns })
  }

  const handleBulkIgnore = async () => {
    if (!selected.size) return
    if (!confirm(`Ігнорувати ${selected.size} транзакцій?`)) return
    const ids = [...selected]
    await supabase.from('bank_transactions').update({ is_ignored: true }).in('id', ids)
    setUnmatched(u => u.filter(t => !ids.includes(t.id)))
    setSelected(new Set())
  }

  const handleBulkCreate = async () => {
    if (!selected.size) return
    setBulkSaving(true)
    const toProcess = unmatched.filter(t => selected.has(t.id))
    for (const btx of toProcess) {
      const amt = btx.amount || 0
      const signed = bulkForm.direction === 'Доходи' ? Math.abs(amt) : -Math.abs(amt)
      // Find ЄДРПОУ from contractors
      let edrpou = null
      if (btx.counterparty) {
        const { data } = await supabase.from('contractors').select('edrpou').ilike('name', btx.counterparty.trim()).maybeSingle()
        if (data?.edrpou) edrpou = data.edrpou
      }
      const contractorId = await upsertContractor(supabase, { name: btx.counterparty, edrpou, iban: btx.account, default_direction: bulkForm.direction, userId: user.id })
      await supabase.from('bank_transactions').update({
        direction: bulkForm.direction,
        article: bulkForm.article || null,
        project_id: bulkForm.projectId || null,
        edrpou: edrpou || null,
        contractor_id: contractorId,
      }).eq('id', btx.id)
    }
    setBulkSaving(false)
    setShowBulk(false)
    setSelected(new Set())
    loadUnmatched()
  }

  const openCreate = async (btx) => {
    setCreateFrom(btx)
    // Try to find ЄДРПОУ from contractors by name
    let edrpou = btx.edrpou || ''
    if (!edrpou && btx.counterparty) {
      const { data } = await supabase.from('contractors').select('edrpou').ilike('name', btx.counterparty.trim()).maybeSingle()
      if (data?.edrpou) edrpou = data.edrpou
    }
    setCreateForm({
      date: btx.date, contractor: btx.counterparty || '',
      amount: Math.abs(btx.amount).toString(),
      direction: btx.amount > 0 ? 'Доходи' : 'Витрати',
      description: btx.description || '', projectId: '',
      article: '',
      edrpou, docType: '', docNumber: btx.reference || '',
    })
  }

  const handleCreateDoc = async () => {
    setCreateSaving(true)
    const amt = parseFloat(createForm.amount) || 0
    const signed = createForm.direction === 'Доходи' ? Math.abs(amt) : -Math.abs(amt)
    const contractorId = await upsertContractor(supabase, { name: createForm.contractor, edrpou: createForm.edrpou, iban: createFrom?.account, default_direction: createForm.direction, userId: user.id })
    const { error } = await supabase.from('bank_transactions').update({
      direction: createForm.direction,
      article: createForm.article || null,
      project_id: createForm.projectId || null,
      edrpou: createForm.edrpou || null,
      contractor_id: contractorId,
      doc_type: createForm.docType || null,
      doc_number: createForm.docNumber || null,
    }).eq('id', createFrom.id)
    if (!error) {
      setUnmatched(u => u.filter(t => t.id !== createFrom.id))
      setCreateFrom(null)
    }
    setCreateSaving(false)
  }

  const openLink = async (btx) => {
    setLinkFor(btx)
    setLinkSearch('')
    // Показати інші bank_transactions для можливої привʼязки
    setLinkResults([])
  }

  const searchLink = async (q) => {
    setLinkSearch(q)
    if (q.length < 2) { setLinkResults([]); return }
    const { data } = await supabase.from('generated_docs')
      .select('id, doc_type, doc_number, doc_date, total, contractor_name, bank_transaction_id')
      .is('bank_transaction_id', null)
      .or(`doc_number.ilike.%${q}%,contractor_name.ilike.%${q}%`)
      .order('doc_date', { ascending: false }).limit(20)
    setLinkResults(data || [])
  }

  const handleLink = async (docId) => {
    await supabase.from('generated_docs').update({ bank_transaction_id: linkFor.id }).eq('id', docId)
    setUnmatched(u => u.filter(t => t.id !== linkFor.id))
    setLinkFor(null)
  }

  // ── RECONCILE ────────────────────────────────────────────────────────────────
  const runReconcile = async () => {
    setReconcileLoading(true)
    setReconcileRun(true)
    // Знайти unmatched bank_transactions і порівняти з unpaid generated_docs
    const { data: unmatchedTxs } = await supabase.from('bank_transactions')
      .select('id, date, counterparty, amount, direction, edrpou')
      .eq('is_matched', false).eq('is_ignored', false).limit(200)
    const { data: unpaidDocs } = await supabase.from('generated_docs')
      .select('id, doc_type, doc_number, doc_date, total, contractor_name, contractor_id, bank_transaction_id')
      .is('bank_transaction_id', null).neq('status', 'cancelled')

    const matches = []
    ;(unmatchedTxs || []).forEach(tx => {
      const amt = Math.abs(tx.amount || 0)
      const match = (unpaidDocs || []).find(d => {
        const docAmt = parseFloat(d.total) || 0
        return Math.abs(docAmt - amt) < 1 && !matches.some(m => m.doc.id === d.id)
      })
      if (match) matches.push({ bankTx: tx, doc: match, confidence: 'amount' })
    })
    setReconcileItems(matches)
    setReconcileLoading(false)
  }

  const confirmMatch = async (item) => {
    await supabase.from('generated_docs').update({ bank_transaction_id: item.bankTx.id }).eq('id', item.doc.id)
    await supabase.from('bank_transactions').update({ is_matched: true }).eq('id', item.bankTx.id)
    setReconcileItems(prev => prev.filter(i => i.bankTx.id !== item.bankTx.id))
  }

  const rejectMatch = (item) => {
    setReconcileItems(prev => prev.filter(i => i.bankTx.id !== item.bankTx.id))
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // ── RENDER ───────────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'import', label: 'Імпорт виписки', icon: 'ti-upload' },
    { id: 'unmatched', label: `Непривʼязані${unmatched.length ? ` (${unmatched.length})` : ''}`, icon: 'ti-link-off' },
    { id: 'all', label: 'Всі банківські', icon: 'ti-building-bank' },
    { id: 'reconcile', label: `Звірка${reconcileItems.length ? ` (${reconcileItems.length})` : ''}`, icon: 'ti-arrows-diff' },
  ]

  return (
    <div>
      <div className="page-header">
        <h1>Банківська звірка</h1>
        <p>Завантажте виписку — система знайде збіги з документами автоматично</p>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', marginBottom:20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'10px 18px', border:'none', background:'none', cursor:'pointer',
            fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6,
            borderBottom: tab===t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab===t.id ? 'var(--blue)' : 'var(--text2)', fontFamily:'inherit'
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize:15 }} />{t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: IMPORT ── */}
      {tab === 'import' && (
        <div>
          {parseError && (
            <div style={{ background:'var(--red-bg)', border:'1px solid #E2E8F0', borderRadius:12, padding:'14px 16px', marginBottom:14 }}>
              <div style={{ fontWeight:600, color:'var(--red)', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
                <i className="ti ti-alert-circle" style={{ fontSize:16 }} />
                Не вдалося розпарсити файл
              </div>
              <pre style={{ fontSize:12.5, color:'var(--red)', whiteSpace:'pre-wrap', marginBottom:12, fontFamily:'inherit' }}>{parseError}</pre>
              <button className="btn btn-sm btn-secondary" onClick={() => { setParseError(null); setFile(null) }}>
                Спробувати інший файл
              </button>
            </div>
          )}

          {!parsed && !parsing && !parseError && (
            <div className="card">
              <div style={{ marginBottom:14 }}>
                <div className="form-group" style={{ maxWidth:300 }}>
                  <label>Банк (необовʼязково)</label>
                  <select className="form-input" value={bankName} onChange={e => setBankName(e.target.value)}>
                    <option value="">— оберіть або залиште порожнім —</option>
                    {['Приватбанк','ПУМБ','Монобанк','Ощадбанк','Укрсиббанк','Універсал банк','Райффайзен','А-Банк','Кристалбанк','Інший'].map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
              </div>
              <div
                className="drop-zone"
                onClick={() => fileRef.current.click()}
                style={{ cursor:'pointer' }}
              >
                <i className="ti ti-file-spreadsheet" style={{ fontSize:40, color:'var(--blue)', display:'block', marginBottom:10 }} />
                <div style={{ fontWeight:600, fontSize:15, marginBottom:4 }}>Завантажте банківську виписку</div>
                <div style={{ fontSize:12.5, color:'var(--text2)' }}>CSV, XLS, XLSX · Приватбанк, ПУМБ, Монобанк, Ощадбанк та інші</div>
                <div style={{ fontSize:11.5, color:'var(--text3)', marginTop:4 }}>Claude розпізнає будь-який формат автоматично</div>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx,.txt,.pdf" style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
            </div>
          )}

          {parsing && (
            <div className="card" style={{ textAlign:'center', padding:48 }}>
              <div className="spinner" />
              <p style={{ color:'var(--blue)', fontWeight:500, marginTop:8 }}>Парсинг виписки...</p>
              <p style={{ color:'var(--text2)', fontSize:12, marginTop:4 }}>{file?.name}</p>
            </div>
          )}

          {parsed && (
            <div>
              <div className="card" style={{ marginBottom:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <div>
                    <div style={{ fontWeight:600 }}>
                      Знайдено {parsed.txs.length} транзакцій
                      {parsed.txs.filter(t=>t._match).length > 0 && <span style={{ color:'var(--green)', marginLeft:8 }}>· {parsed.txs.filter(t=>t._match).length} з автозбігом</span>}
                      {parsed.txs.filter(t=>t._isDuplicate).length > 0 && <span style={{ color:'#6B6B6B', marginLeft:8 }}>· {parsed.txs.filter(t=>t._isDuplicate).length} дублікатів</span>}
                    </div>
                    <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>{parsed.fileName}</div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="btn btn-secondary" onClick={() => { setParsed(null); setFile(null) }}>Скасувати</button>
                    <button className="btn btn-primary" onClick={handleImport} disabled={importing || !parsed.txs.some(t=>t._selected)}>
                      {importing ? 'Імпортую...' : `Імпортувати (${parsed.txs.filter(t=>t._selected).length})`}
                    </button>
                  </div>
                </div>

                <div className="alert alert-info" style={{ marginBottom:12, fontSize:12 }}>
                  <i className="ti ti-info-circle" style={{ marginRight:6 }} />
                  Зелені рядки — знайдено відповідний документ. <strong>Помаранчеві — вже імпортовані раніше</strong>, знято з вибору автоматично.
                </div>

                <div className="tbl-wrap" style={{ maxHeight:500 }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width:36 }}>
                          <input type="checkbox" checked={parsed.txs.every(t=>t._selected)}
                            onChange={e => setParsed(p => ({ ...p, txs: p.txs.map(t => ({ ...t, _selected: e.target.checked })) }))} />
                        </th>
                        <th>Дата</th>
                        <th>Контрагент</th>
                        <th style={{ textAlign:'right' }}>Сума</th>
                        <th>Напрям</th>
                        <th>Стаття</th>
                        <th style={{ width: 60 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.txs.map((tx, i) => {
                        const auto = tx._auto || {}
                        const confIcon = auto.confidence === 'high' ? { icon: 'ti-circle-check', color: 'var(--green)' }
                          : auto.confidence === 'medium' ? { icon: 'ti-help-circle', color: 'var(--amber)' }
                          : auto.confidence === 'low' ? { icon: 'ti-info-circle', color: 'var(--text3)' }
                          : null
                        return (
                        <tr key={i} style={{
                          background: tx._isDuplicate ? '#F0F2F5' : tx._match ? '#EFF5EF' : undefined,
                          opacity: tx._isDuplicate ? 0.75 : 1,
                        }}>
                          <td><input type="checkbox" checked={tx._selected} onChange={() => toggleSelect(i)} /></td>
                          <td style={{ color:'var(--text2)', whiteSpace:'nowrap', fontSize:12 }}>{tx.date}</td>
                          <td style={{ fontSize:12.5 }}>
                            <div style={{ wordBreak:'break-word' }} title={tx.counterparty}>{tx.counterparty || '—'}</div>
                          </td>
                          <td style={{ textAlign:'right', fontWeight:600, color: tx.amount > 0 ? 'var(--green)' : 'var(--red)', whiteSpace:'nowrap', fontSize:12 }}>
                            {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
                          </td>
                          <td>
                            <select style={{ fontSize:11, border:'1px solid var(--border)', borderRadius:4, padding:'2px 4px', fontFamily:'inherit',
                              background: auto.direction ? (auto.direction === 'Доходи' ? 'var(--green-bg)' : 'var(--red-bg)') : 'var(--surface)',
                              color: auto.direction === 'Доходи' ? 'var(--green)' : auto.direction === 'Витрати' ? 'var(--red)' : 'var(--text2)',
                            }}
                              value={tx._userDirection || auto.direction || ''}
                              onChange={e => setParsed(p => ({ ...p, txs: p.txs.map((t, j) => j === i ? { ...t, _userDirection: e.target.value } : t) }))}>
                              <option value="">—</option>
                              <option value="Доходи">Доходи</option>
                              <option value="Витрати">Витрати</option>
                              <option value="ПФД">ПФД</option>
                              <option value="Інше">Інше</option>
                            </select>
                          </td>
                          <td>
                            <input style={{ fontSize:11, border:'1px solid var(--border)', borderRadius:4, padding:'2px 6px', width:100, fontFamily:'inherit',
                              background: auto.article ? 'var(--blue-bg)' : 'var(--surface)',
                            }}
                              value={tx._userArticle || auto.article || ''}
                              onChange={e => setParsed(p => ({ ...p, txs: p.txs.map((t, j) => j === i ? { ...t, _userArticle: e.target.value } : t) }))}
                              placeholder="Стаття"
                              title={auto.rule ? `Правило: ${auto.rule}` : ''} />
                          </td>
                          <td>
                            {confIcon && <i className={`ti ${confIcon.icon}`} style={{ fontSize:14, color: confIcon.color }} title={`${auto.confidence} (${auto.rule})`} />}
                            {tx._isDuplicate && <span style={{ fontSize:10, color:'var(--text3)' }}>дубль</span>}
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: UNMATCHED ── */}
      {tab === 'unmatched' && (
        <div>
          {loading && <div style={{ textAlign:'center', padding:40, color:'var(--text2)' }}>Завантаження...</div>}
          {!loading && unmatched.length === 0 && (
            <div className="card">
              <div className="empty">
                <i className="ti ti-circle-check" style={{ fontSize:48, color:'var(--green)', display:'block', margin:'0 auto 12px' }} />
                <p style={{ fontWeight:600, color:'var(--green)' }}>Всі транзакції привʼязані!</p>
                <p style={{ marginTop:4, fontSize:13 }}>Немає непривʼязаних банківських операцій.</p>
              </div>
            </div>
          )}
          {!loading && unmatched.length > 0 && (() => {
            // ── Фільтрація ──────────────────────────────────────────────────
            const filtered = unmatched.filter(btx => {
              if (filter.search) {
                const q = filter.search.toLowerCase()
                if (!(btx.counterparty||'').toLowerCase().includes(q) &&
                    !(btx.description||'').toLowerCase().includes(q)) return false
              }
              if (filter.direction === 'in'  && btx.amount <= 0) return false
              if (filter.direction === 'out' && btx.amount >= 0) return false
              if (filter.dateFrom && btx.date < filter.dateFrom) return false
              if (filter.dateTo   && btx.date > filter.dateTo)   return false
              return true
            })

            const allSelected = filtered.length > 0 && filtered.every(t => selected.has(t.id))
            const someSelected = filtered.some(t => selected.has(t.id))
            const selectedCount = filtered.filter(t => selected.has(t.id)).length

            const toggleAll = () => {
              if (allSelected) {
                setSelected(s => { const ns = new Set(s); filtered.forEach(t => ns.delete(t.id)); return ns })
              } else {
                setSelected(s => { const ns = new Set(s); filtered.forEach(t => ns.add(t.id)); return ns })
              }
            }

            return (
              <div>
                {/* Filters */}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
                  <div style={{ position:'relative', flex:1, minWidth:200 }}>
                    <i className="ti ti-search" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:14 }} />
                    <input className="form-input" style={{ width:'100%', paddingLeft:32 }}
                      placeholder="Контрагент або призначення..."
                      value={filter.search} onChange={e => setFilter(f=>({...f,search:e.target.value}))} />
                  </div>
                  <select className="form-input" style={{ width:150 }} value={filter.direction} onChange={e => setFilter(f=>({...f,direction:e.target.value}))}>
                    <option value="">Всі операції</option>
                    <option value="in">Тільки надходження (+)</option>
                    <option value="out">Тільки витрати (−)</option>
                  </select>
                  <input type="date" className="form-input" style={{ width:140 }} value={filter.dateFrom} onChange={e => setFilter(f=>({...f,dateFrom:e.target.value}))} />
                  <input type="date" className="form-input" style={{ width:140 }} value={filter.dateTo} onChange={e => setFilter(f=>({...f,dateTo:e.target.value}))} />
                  {(filter.search||filter.direction||filter.dateFrom||filter.dateTo) && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setFilter({search:'',direction:'',dateFrom:'',dateTo:''})} style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <i className="ti ti-x" style={{ fontSize:13 }} />Скинути
                    </button>
                  )}
                </div>

                {/* Bulk action bar */}
                {someSelected && (
                  <div style={{ display:'flex', alignItems:'center', gap:10, background:'#EFF4FF', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 14px', marginBottom:12 }}>
                    <i className="ti ti-checkbox" style={{ fontSize:16, color:'var(--blue)' }} />
                    <span style={{ fontWeight:600, color:'var(--blue)', marginRight:4 }}>{selectedCount} обрано</span>
                    <button className="btn btn-primary btn-sm" style={{ display:'flex', alignItems:'center', gap:5 }} onClick={() => setShowBulk(true)}>
                      <i className="ti ti-file-plus" style={{ fontSize:13 }} />Створити всі ({selectedCount})
                    </button>
                    <button className="btn btn-secondary btn-sm" style={{ display:'flex', alignItems:'center', gap:5 }} onClick={handleBulkIgnore}>
                      <i className="ti ti-eye-off" style={{ fontSize:13 }} />Ігнорувати всі
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())} style={{ marginLeft:'auto' }}>
                      Скасувати вибір
                    </button>
                  </div>
                )}

                <div style={{ fontSize:12, color:'var(--text2)', marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>{filtered.length} з {unmatched.length} операцій{filtered.length < unmatched.length && ' (фільтр активний)'}</span>
                  <button className="btn btn-sm btn-secondary" style={{ display:'flex', alignItems:'center', gap:4 }}
                    onClick={async () => {
                      const { classifyBatch } = await import('../lib/autoClassify')
                      const noArticle = unmatched.filter(t => !t.article?.trim())
                      if (noArticle.length === 0) { alert('Всі транзакції вже мають статтю'); return }
                      const classified = await classifyBatch(noArticle)
                      const updates = classified.filter(t => t._auto?.article && t._auto.confidence !== 'none')
                      if (updates.length === 0) { alert('Не вдалось класифікувати жодну транзакцію'); return }
                      if (!confirm(`Авто-рознести ${updates.length} транзакцій?`)) return
                      for (const t of updates) {
                        await supabase.from('bank_transactions').update({
                          direction: t._auto.direction || t.direction,
                          article: t._auto.article,
                          contractor_id: t._auto.contractor_id || t.contractor_id,
                        }).eq('id', t.id)
                      }
                      alert(`Рознесено: ${updates.length} транзакцій`)
                      loadUnmatched()
                    }}>
                    <i className="ti ti-sparkles" style={{ fontSize:13 }} /> Авто-рознести
                  </button>
                </div>

                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width:36 }}>
                          <input type="checkbox" checked={allSelected} ref={el => el && (el.indeterminate = !allSelected && someSelected)}
                            onChange={toggleAll} title="Вибрати всі видимі" />
                        </th>
                        <th>Дата</th>
                        <th>Контрагент банку</th>
                        <th style={{ textAlign:'right' }}>Сума</th>
                        <th>Призначення</th>
                        <th>Дії</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(btx => (
                        <tr key={btx.id} style={{ background: selected.has(btx.id) ? '#f0f9ff' : undefined }}>
                          <td>
                            <input type="checkbox" checked={selected.has(btx.id)}
                              onChange={e => setSelected(s => { const ns = new Set(s); e.target.checked ? ns.add(btx.id) : ns.delete(btx.id); return ns })} />
                          </td>
                          <td style={{ color:'var(--text2)', whiteSpace:'nowrap', fontSize:12 }}>{btx.date}</td>
                          <td>
                            <div style={{ wordBreak:'break-word', fontSize:13 }} title={btx.counterparty}>{btx.counterparty || '—'}</div>
                          </td>
                          <td style={{ textAlign:'right', fontWeight:600, color: btx.amount > 0 ? 'var(--green)' : 'var(--red)', whiteSpace:'nowrap' }}>
                            {btx.amount > 0 ? '+' : ''}{fmt(btx.amount)} грн
                          </td>
                          <td style={{ fontSize:11.5, color:'var(--text2)', wordBreak:'break-word' }} title={btx.description}>{btx.description}</td>
                          <td>
                            <div style={{ display:'flex', gap:4, flexWrap:'nowrap' }}>
                              <button className="btn btn-sm btn-primary" style={{ whiteSpace:'nowrap', fontSize:11, padding:'4px 8px', display:'flex', alignItems:'center', gap:3 }} onClick={() => openCreate(btx)}>
                                <i className="ti ti-file-plus" style={{ fontSize:12 }} />Створити
                              </button>
                              <button className="btn btn-sm btn-secondary" style={{ whiteSpace:'nowrap', fontSize:11, padding:'4px 8px', display:'flex', alignItems:'center', gap:3 }} onClick={() => openLink(btx)}>
                                <i className="ti ti-link" style={{ fontSize:12 }} />Привʼязати
                              </button>
                              <button
                                style={{ background:'none', border:'1px solid var(--border2)', borderRadius:6, width:28, height:28, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)' }}
                                onClick={() => handleIgnore(btx.id)} title="Ігнорувати"
                              ><i className="ti ti-eye-off" style={{ fontSize:13 }} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={6} style={{ textAlign:'center', padding:24, color:'var(--text3)' }}>Нічого не знайдено за фільтром</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── TAB: ALL ── */}
      {tab === 'all' && (
        <div>
          {loading && <div style={{ textAlign:'center', padding:40, color:'var(--text2)' }}>Завантаження...</div>}
          {!loading && (() => {
            const filteredAll = allBankTxs.filter(btx => {
              if (allFilter.search) {
                const q = allFilter.search.toLowerCase()
                if (!(btx.counterparty||'').toLowerCase().includes(q) &&
                    !(btx.description||'').toLowerCase().includes(q)) return false
              }
              if (allFilter.direction === 'in'  && btx.amount <= 0) return false
              if (allFilter.direction === 'out' && btx.amount >= 0) return false
              if (allFilter.status === 'matched'   && !btx.is_matched) return false
              if (allFilter.status === 'unmatched' && (btx.is_matched || btx.is_ignored)) return false
              if (allFilter.status === 'ignored'   && !btx.is_ignored) return false
              if (allFilter.dateFrom && btx.date < allFilter.dateFrom) return false
              if (allFilter.dateTo   && btx.date > allFilter.dateTo)   return false
              return true
            })

            const hasFilter = allFilter.search || allFilter.direction || allFilter.status || allFilter.dateFrom || allFilter.dateTo
            const totalIn  = filteredAll.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0)
            const totalOut = filteredAll.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0)

            return (
              <>
                {/* Filters */}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
                  <div style={{ position:'relative', flex:1, minWidth:200 }}>
                    <i className="ti ti-search" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:14 }} />
                    <input className="form-input" style={{ width:'100%', paddingLeft:32 }}
                      placeholder="Контрагент або призначення..."
                      value={allFilter.search} onChange={e => setAllFilter(f=>({...f,search:e.target.value}))} />
                  </div>
                  <select className="form-input" style={{ width:160 }} value={allFilter.status} onChange={e => setAllFilter(f=>({...f,status:e.target.value}))}>
                    <option value="">Всі статуси</option>
                    <option value="matched">✓ Прив'язано</option>
                    <option value="unmatched">✗ Неприв'язано</option>
                    <option value="ignored">Ігноровано</option>
                  </select>
                  <select className="form-input" style={{ width:160 }} value={allFilter.direction} onChange={e => setAllFilter(f=>({...f,direction:e.target.value}))}>
                    <option value="">Всі операції</option>
                    <option value="in">Надходження (+)</option>
                    <option value="out">Витрати (−)</option>
                  </select>
                  <input type="date" className="form-input" style={{ width:140 }} value={allFilter.dateFrom} onChange={e => setAllFilter(f=>({...f,dateFrom:e.target.value}))} />
                  <input type="date" className="form-input" style={{ width:140 }} value={allFilter.dateTo} onChange={e => setAllFilter(f=>({...f,dateTo:e.target.value}))} />
                  {hasFilter && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setAllFilter({search:'',status:'',direction:'',dateFrom:'',dateTo:''})} style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <i className="ti ti-x" style={{ fontSize:13 }} />Скинути
                    </button>
                  )}
                </div>

                {/* Summary chips */}
                <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap', alignItems:'center' }}>
                  <span style={{ fontSize:12, color:'var(--text2)' }}>{filteredAll.length} з {allBankTxs.length} операцій{hasFilter ? ' (фільтр)' : ''}</span>
                  {totalIn > 0 && <span style={{ fontSize:12, background:'var(--green-bg)', color:'var(--green)', border:'1px solid #E2E8F0', borderRadius:6, padding:'2px 8px', fontWeight:500 }}>+{fmt(totalIn)} грн надходжень</span>}
                  {totalOut > 0 && <span style={{ fontSize:12, background:'var(--red-bg)', color:'var(--red)', border:'1px solid #E2E8F0', borderRadius:6, padding:'2px 8px', fontWeight:500 }}>−{fmt(totalOut)} грн витрат</span>}
                </div>

                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Контрагент</th>
                        <th style={{ textAlign:'right' }}>Сума</th>
                        <th>Призначення</th>
                        <th>Статус</th>
                        <th>Документ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAll.map(btx => (
                        <tr key={btx.id}>
                          <td style={{ color:'var(--text2)', fontSize:12, whiteSpace:'nowrap' }}>{btx.date}</td>
                          <td style={{ fontSize:12.5 }}>
                            <div style={{ wordBreak:'break-word' }}>{btx.counterparty || '—'}</div>
                          </td>
                          <td style={{ textAlign:'right', fontWeight:600, color: btx.amount > 0 ? 'var(--green)' : 'var(--red)', whiteSpace:'nowrap' }}>
                            {btx.amount > 0 ? '+' : ''}{fmt(btx.amount)} грн
                          </td>
                          <td style={{ fontSize:11.5, color:'var(--text2)', wordBreak:'break-word' }}>{btx.description}</td>
                          <td>
                            {btx.is_ignored
                              ? <span style={{ fontSize:11, background:'#F0F2F5', color:'var(--text3)', padding:'2px 8px', borderRadius:6 }}>Ігнор</span>
                              : btx.is_matched
                                ? <span style={{ fontSize:11, background:'#EFF5EF', color:'var(--green)', padding:'2px 8px', borderRadius:6, fontWeight:500 }}><i className="ti ti-check" style={{ marginRight:3, fontSize:11 }} />Прив'язано</span>
                                : <span style={{ fontSize:11, background:'#F5EDED', color:'var(--red)', padding:'2px 8px', borderRadius:6, fontWeight:500 }}>Неприв'язано</span>
                            }
                          </td>
                          <td style={{ fontSize:12 }}>
                            {btx.transactions?.contractor ? (
                              <button
                                onClick={() => openLinkedTx(btx.matched_transaction_id)}
                                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--blue)', fontSize:12, padding:0, textAlign:'left', textDecoration:'underline', fontFamily:'inherit' }}
                                title="Переглянути деталі операції"
                              >
                                {btx.transactions.contractor.substring(0,30)}
                              </button>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                      {filteredAll.length === 0 && (
                        <tr><td colSpan={6} style={{ textAlign:'center', padding:24, color:'var(--text3)' }}>Нічого не знайдено</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ── MODAL: Create doc from bank tx ── */}
      {createFrom && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setCreateFrom(null)}>
          <div className="modal">
            <div className="modal-header">
              <h2>Створити документ з транзакції</h2>
              <button className="modal-close" onClick={() => setCreateFrom(null)}>×</button>
            </div>
            <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12.5 }}>
              <div style={{ display:'flex', gap:16 }}>
                <div><div style={{ fontSize:11, color:'var(--text3)' }}>Банк</div><strong>{createFrom.date}</strong></div>
                <div><div style={{ fontSize:11, color:'var(--text3)' }}>Сума</div><strong style={{ color: createFrom.amount > 0 ? 'var(--green)' : 'var(--red)' }}>{createFrom.amount > 0 ? '+' : ''}{fmt(createFrom.amount)} грн</strong></div>
                <div style={{ flex:1 }}><div style={{ fontSize:11, color:'var(--text3)' }}>Контрагент банку</div><strong>{createFrom.counterparty}</strong></div>
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Дата *</label><input type="date" className="form-input" value={createForm.date} onChange={e => setCreateForm(f=>({...f,date:e.target.value}))}/></div>
              <div className="form-group"><label>Контрагент *</label>
                <ContractorSelect
                  value={createForm.contractor}
                  onChange={v => setCreateForm(f=>({...f,contractor:v}))}
                  onContractorSelect={c => {
                    if (c._new) return
                    if (c.default_direction) setCreateForm(f=>({...f,direction:c.default_direction}))
                    if (c.default_article) setCreateForm(f=>({...f,article:c.default_article}))
                    if (c.edrpou) setCreateForm(f=>({...f,edrpou:c.edrpou}))
                  }}
                />
              </div>
              <div className="form-group"><label>Сума, грн *</label><input type="number" className="form-input" value={createForm.amount} onChange={e => setCreateForm(f=>({...f,amount:e.target.value}))}/></div>
              <div className="form-group"><label>Напрям</label><select className="form-input" value={createForm.direction} onChange={e => setCreateForm(f=>({...f,direction:e.target.value}))}>{DIRS.map(d=><option key={d}>{d}</option>)}</select></div>
              <div className="form-group"><label>Стаття</label>
                <select className="form-input" value={createForm.article} onChange={e => setCreateForm(f=>({...f,article:e.target.value}))}>
                  <option value="">— оберіть статтю —</option>
                  {Object.entries(groupByType(articlesList)).map(([type, items]) =>
                    items.length > 0 ? (
                      <optgroup key={type} label={TYPE_LABELS[type]}>
                        {items.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                      </optgroup>
                    ) : null
                  )}
                </select>
              </div>
              <div className="form-group"><label>Проєкт</label><select className="form-input" value={createForm.projectId} onChange={e => setCreateForm(f=>({...f,projectId:e.target.value}))}><option value="">— без проєкту —</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="form-group"><label>Тип документу</label><input className="form-input" value={createForm.docType} onChange={e => setCreateForm(f=>({...f,docType:e.target.value}))} placeholder="рахунок-фактура..."/></div>
              <div className="form-group"><label>Номер документу</label><input className="form-input" value={createForm.docNumber} onChange={e => setCreateForm(f=>({...f,docNumber:e.target.value}))}/></div>
              <div className="form-group full"><label>Призначення</label><textarea className="form-input" rows={2} value={createForm.description} onChange={e => setCreateForm(f=>({...f,description:e.target.value}))}/></div>
            </div>
            <div className="alert alert-info" style={{ fontSize:12, marginTop:12 }}>
              <i className="ti ti-info-circle" style={{ marginRight:6 }} />
              Після збереження можете прикріпити PDF документу через Реєстр → знайти цю операцію → редагувати.
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleCreateDoc} disabled={createSaving}>{createSaving ? 'Збереження...' : 'Зберегти операцію'}</button>
              <button className="btn btn-secondary" onClick={() => setCreateFrom(null)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Link to existing transaction ── */}
      {linkFor && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setLinkFor(null)}>
          <div className="modal modal-xl">
            <div className="modal-header">
              <h2>Привʼязати до документу</h2>
              <button className="modal-close" onClick={() => setLinkFor(null)}>×</button>
            </div>
            <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 14px', marginBottom:14 }}>
              <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginBottom: linkFor.description ? 6 : 0 }}>
                <strong style={{ fontSize:13 }}>{linkFor.date}</strong>
                <strong style={{ color: linkFor.amount > 0 ? 'var(--green)' : 'var(--red)', fontSize:13 }}>{linkFor.amount > 0 ? '+' : ''}{fmt(linkFor.amount)} грн</strong>
                <span style={{ color:'var(--text2)', fontSize:13 }}>{linkFor.counterparty}</span>
                {linkFor.edrpou && <span style={{ fontSize:11, color:'var(--text3)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 6px' }}>ЄДРПОУ: {linkFor.edrpou}</span>}
              </div>
              {linkFor.description && (
                <div style={{ fontSize:12, color:'var(--text2)', borderTop:'1px solid var(--border)', paddingTop:6, marginTop:2 }}>
                  <span style={{ fontWeight:500, color:'var(--text3)', marginRight:6 }}>Призначення:</span>
                  {linkFor.description}
                </div>
              )}
            </div>
            <div style={{ position:'relative', marginBottom:12 }}>
              <i className="ti ti-search" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:16 }} />
              <input className="form-input" style={{ width:'100%', paddingLeft:34 }} placeholder="Пошук по контрагенту..." value={linkSearch} onChange={e => searchLink(e.target.value)} />
            </div>
            <div className="tbl-wrap" style={{ maxHeight:'calc(80vh - 200px)' }}>
              <table>
                <thead><tr><th>Контрагент</th><th style={{ textAlign:'right' }}>Сума</th><th>Напрям</th><th>Документ / Дата</th><th>Стаття</th><th style={{ textAlign:'center' }}>📄</th><th></th></tr></thead>
                <tbody>
                  {linkResults.map(tx => (
                    <tr key={tx.id}>
                      <td style={{ fontSize:12.5, maxWidth:220, minWidth:160 }}>
                        <div style={{ fontWeight:500 }}>{tx.contractor}</div>
                        {tx.edrpou && <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>ЄДРПОУ: {tx.edrpou}</div>}
                      </td>
                      <td style={{ textAlign:'right', fontWeight:600, color: tx.amount > 0 ? 'var(--green)' : 'var(--red)', whiteSpace:'nowrap' }}>
                        {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)} грн
                      </td>
                      <td style={{ fontSize:12, color:'var(--text2)' }}>{tx.direction}</td>
                      <td style={{ fontSize:11, color:'var(--text2)', minWidth:130 }}>
                        {tx.doc_type && <div style={{ fontWeight:500 }}>{tx.doc_type}</div>}
                        {tx.doc_number && <div style={{ color:'var(--blue)', fontWeight:500 }}>№{tx.doc_number}</div>}
                        <div style={{ color:'var(--text3)', marginTop:1 }}>{tx.date}</div>
                      </td>
                      <td style={{ fontSize:11, color:'var(--text2)', minWidth:140, maxWidth:200 }}>
                        <div style={{ wordBreak:'break-word' }}>{tx.article || <span style={{ color:'var(--text3)' }}>—</span>}</div>
                      </td>
                      <td style={{ textAlign:'center', fontSize:13 }}>
                        {tx.documents?.length > 0 ? <span title={`${tx.documents.length} документів`}>📄{tx.documents.length > 1 ? tx.documents.length : ''}</span> : <span style={{ color:'var(--text3)', fontSize:11 }}>—</span>}
                      </td>
                      <td>
                        <button className="btn btn-sm btn-primary" style={{ fontSize:11, padding:'4px 10px' }} onClick={() => handleLink(tx.id)}>
                          Привʼязати
                        </button>
                      </td>
                    </tr>
                  ))}
                  {linkResults.length === 0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:20, color:'var(--text3)', fontSize:12 }}>Введіть пошуковий запит або перегляньте список</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Bulk create ── */}
      {showBulk && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowBulk(false)}>
          <div className="modal">
            <div className="modal-header">
              <div>
                <h2>Групове створення операцій</h2>
                <div style={{ fontSize:12.5, color:'var(--text2)', marginTop:2 }}>
                  {[...selected].length} банківських транзакцій → стануть операціями в реєстрі
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowBulk(false)}>×</button>
            </div>

            <div style={{ background:'var(--blue-bg)', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12.5, color:'var(--blue)' }}>
              <i className="ti ti-info-circle" style={{ marginRight:6 }} />
              Оберіть напрям і статтю — вони застосуються до всіх обраних транзакцій. Дату, суму і контрагента система візьме з банківської виписки.
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Напрям *</label>
                <select className="form-input" value={bulkForm.direction} onChange={e => setBulkForm(f=>({...f,direction:e.target.value}))}>
                  {DIRS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Стаття</label>
                <select className="form-input" value={bulkForm.article} onChange={e => setBulkForm(f=>({...f,article:e.target.value}))}>
                  <option value="">— оберіть статтю —</option>
                  {Object.entries(groupByType(articlesList)).map(([type, items]) =>
                    items.length > 0 ? (
                      <optgroup key={type} label={TYPE_LABELS[type]}>
                        {items.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                      </optgroup>
                    ) : null
                  )}
                </select>
              </div>
              <div className="form-group full">
                <label>Проєкт (необовʼязково)</label>
                <select className="form-input" value={bulkForm.projectId} onChange={e => setBulkForm(f=>({...f,projectId:e.target.value}))}>
                  <option value="">— без проєкту —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleBulkCreate} disabled={bulkSaving} style={{ display:'flex', alignItems:'center', gap:6 }}>
                {bulkSaving
                  ? <><div style={{ width:14, height:14, border:'2px solid #fff', borderTopColor:'transparent', borderRadius:'50%', animation:'spin .7s linear infinite' }} />Створюю...</>
                  : <><i className="ti ti-file-plus" style={{ fontSize:15 }} />Створити {[...selected].length} операцій</>
                }
              </button>
              <button className="btn btn-secondary" onClick={() => setShowBulk(false)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
      {/* ── TAB: RECONCILE ── */}
      {tab === 'reconcile' && (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, flexWrap:'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={runReconcile}
              disabled={reconcileLoading}
              style={{ display:'flex', alignItems:'center', gap:6 }}
            >
              <i className={`ti ${reconcileLoading ? 'ti-loader-2' : 'ti-arrows-diff'}`} style={{ fontSize:15 }} />
              {reconcileLoading ? 'Звіряємо...' : 'Звірити всі'}
            </button>
            {reconcileRun && !reconcileLoading && (
              <span style={{ fontSize:13, color:'var(--text2)' }}>
                {reconcileItems.length > 0
                  ? `Знайдено ${reconcileItems.length} можливих збігів — перевірте та підтвердіть`
                  : '✓ Нових збігів не знайдено'}
              </span>
            )}
            <div style={{ marginLeft:'auto', display:'flex', gap:8, fontSize:12 }}>
              <span style={{ background:'#EFF5EF', color:'#4A7C59', border:'1px solid #E2E8F0', borderRadius:6, padding:'3px 10px', fontWeight:500 }}>
                🟢 Правило 1: ЄДРПОУ + сума ±10 грн
              </span>
              <span style={{ background:'#F0F2F5', color:'#6B6B6B', border:'1px solid #E2E8F0', borderRadius:6, padding:'3px 10px', fontWeight:500 }}>
                🟡 Правило 2: Сума ±10 грн + дата ±30 днів
              </span>
            </div>
          </div>

          {reconcileItems.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {reconcileItems.map((item, i) => (
                <div key={item.bankTx.id} className="reconcile-card" style={{
                  background:'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius:12,
                  padding:'14px 16px',
                  display:'grid',
                  gridTemplateColumns:'1fr auto 1fr auto',
                  gap:16,
                  alignItems:'center',
                }}>
                  {/* Bank tx */}
                  <div>
                    <div style={{ fontSize:11, color:'var(--text3)', marginBottom:3, fontWeight:600, textTransform:'uppercase', letterSpacing:.5 }}>Банк</div>
                    <div style={{ fontSize:13, fontWeight:600 }}>{item.bankTx.counterparty || '—'}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', marginTop:2, display:'flex', gap:10 }}>
                      <span>{item.bankTx.date}</span>
                      <span style={{ fontWeight:600, color: item.bankTx.amount > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {item.bankTx.amount > 0 ? '+' : ''}{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(item.bankTx.amount)))} грн
                      </span>
                      {item.bankTx.edrpou && <span style={{ color:'var(--text3)' }}>ЄДРПОУ: {item.bankTx.edrpou}</span>}
                    </div>
                    {item.bankTx.description && (
                      <div style={{ fontSize:11, color:'var(--text3)', marginTop:3, wordBreak:'break-word' }}>{item.bankTx.description}</div>
                    )}
                  </div>

                  {/* Match indicator */}
                  <div style={{ textAlign:'center' }}>
                    <div style={{
                      width:32, height:32, borderRadius:'50%',
                      background: item.confidence === 'high' ? '#EFF5EF' : '#F0F2F5',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      margin:'0 auto 4px',
                    }}>
                      <i className="ti ti-arrows-right-left" style={{ fontSize:16, color: item.confidence === 'high' ? '#4A7C59' : '#6B6B6B' }} />
                    </div>
                    <div style={{ fontSize:10, fontWeight:600, color: item.confidence === 'high' ? '#4A7C59' : '#6B6B6B', whiteSpace:'nowrap' }}>
                      Правило {item.rule}
                    </div>
                  </div>

                  {/* Doc tx */}
                  <div>
                    <div style={{ fontSize:11, color:'var(--text3)', marginBottom:3, fontWeight:600, textTransform:'uppercase', letterSpacing:.5 }}>Документ</div>
                    <div style={{ fontSize:13, fontWeight:600 }}>{item.docTx.contractor}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', marginTop:2, display:'flex', gap:10, flexWrap:'wrap' }}>
                      <span>{item.docTx.date}</span>
                      <span style={{ fontWeight:600, color: item.docTx.amount > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {item.docTx.amount > 0 ? '+' : ''}{new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(item.docTx.amount)))} грн
                      </span>
                      {item.docTx.edrpou && <span style={{ color:'var(--text3)' }}>ЄДРПОУ: {item.docTx.edrpou}</span>}
                    </div>
                    {(item.docTx.doc_type || item.docTx.doc_number) && (
                      <div style={{ fontSize:11, color:'var(--text3)', marginTop:3 }}>
                        {item.docTx.doc_type} {item.docTx.doc_number ? `№${item.docTx.doc_number}` : ''}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize:12, display:'flex', alignItems:'center', gap:4, whiteSpace:'nowrap' }}
                      onClick={() => confirmMatch(item)}
                    >
                      <i className="ti ti-check" style={{ fontSize:13 }} />
                      Підтвердити
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize:12, display:'flex', alignItems:'center', gap:4, whiteSpace:'nowrap' }}
                      onClick={() => rejectMatch(item)}
                    >
                      <i className="ti ti-x" style={{ fontSize:13 }} />
                      Відхилити
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!reconcileRun && (
            <div style={{ textAlign:'center', padding:'60px 24px', color:'var(--text3)' }}>
              <i className="ti ti-arrows-diff" style={{ fontSize:48, display:'block', margin:'0 auto 16px', opacity:.3 }} />
              <div style={{ fontSize:15, fontWeight:500, marginBottom:6 }}>Автоматична звірка</div>
              <div style={{ fontSize:13 }}>Натисніть "Звірити всі" щоб система знайшла можливі збіги між банківськими транзакціями і документами</div>
            </div>
          )}
        </div>
      )}

      {/* Linked transaction detail modal */}
      {(linkedTxDetail || linkedTxLoading) && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setLinkedTxDetail(null)} style={{ zIndex:1200 }}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2 style={{ fontSize:15 }}>{linkedTxDetail?.contractor || 'Завантаження...'}</h2>
              <button className="modal-close" onClick={() => { setLinkedTxDetail(null); setLinkedTxDocs([]); setLinkedTxItems([]) }}>×</button>
            </div>
            {linkedTxLoading ? (
              <div style={{ textAlign:'center', padding:40 }}><div className="spinner" style={{ margin:'0 auto' }} /></div>
            ) : linkedTxDetail && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16, fontSize:13 }}>
                  {[
                    ['Дата', linkedTxDetail.date],
                    ['Сума', (linkedTxDetail.amount>0?'+':'')+new Intl.NumberFormat('uk-UA').format(Math.round(Math.abs(linkedTxDetail.amount)))+' грн'],
                    ['ЄДРПОУ', linkedTxDetail.edrpou],
                    ['Тип документу', linkedTxDetail.doc_type],
                    ['Номер', linkedTxDetail.doc_number],
                    ['Напрям', linkedTxDetail.direction],
                    ['Стаття', linkedTxDetail.article],
                    ['Проєкт', linkedTxDetail.projects?.name],
                    ['Призначення', linkedTxDetail.description],
                  ].filter(([,v]) => v).map(([l,v]) => (
                    <div key={l}>
                      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:1 }}>{l}</div>
                      <div style={{ fontWeight:500 }}>{v}</div>
                    </div>
                  ))}
                </div>

                {linkedTxItems.length > 0 && (
                  <div style={{ marginBottom:16 }}>
                    <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>📦 Позиції ({linkedTxItems.length})</div>
                    <div style={{ overflowX:'auto' }}>
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                        <thead>
                          <tr style={{ background:'var(--surface2)' }}>
                            {['Назва','К-сть','Од.','Ціна','Сума'].map(h => (
                              <th key={h} style={{ padding:'6px 8px', textAlign:'left', borderBottom:'1px solid var(--border)', fontWeight:500, color:'var(--text2)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {linkedTxItems.map(it => (
                            <tr key={it.id} style={{ borderBottom:'1px solid #F0F2F5' }}>
                              <td style={{ padding:'6px 8px' }}>{it.name}</td>
                              <td style={{ padding:'6px 8px', textAlign:'right' }}>{it.quantity}</td>
                              <td style={{ padding:'6px 8px' }}>{it.unit||'—'}</td>
                              <td style={{ padding:'6px 8px', textAlign:'right' }}>{it.unit_price}</td>
                              <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:500 }}>{it.amount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {linkedTxDocs.length > 0 && (
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>📎 Файли ({linkedTxDocs.length})</div>
                    {linkedTxDocs.map(doc => (
                      <div key={doc.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                        <i className="ti ti-file-text" style={{ fontSize:20, color:'var(--blue)', flexShrink:0 }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:500 }}>{doc.file_name}</div>
                          <div style={{ fontSize:11, color:'var(--text3)' }}>{doc.doc_role==='incoming'?'Вхідний':'Вихідний'} · {doc.file_size ? (doc.file_size/1024).toFixed(0)+' KB' : ''}</div>
                        </div>
                        <button className="btn btn-sm btn-secondary" style={{ display:'flex', alignItems:'center', gap:4 }} onClick={() => downloadDoc(doc)}>
                          <i className="ti ti-download" style={{ fontSize:13 }} />Завантажити
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

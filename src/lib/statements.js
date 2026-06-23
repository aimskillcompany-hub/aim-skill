// Парсинг банківських виписок: ПУМБ / Monobank (SheetJS) + Claude-fallback для PDF/невідомих.
// Винесено зі старого Bank.jsx для переюзу новою сторінкою Банк/Каса.
import * as XLSX from 'xlsx'
import { callClaude } from './ai'

async function readXlsx(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 1251, cellText: true, cellDates: false, cellNF: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
}

function detectFormat(rows) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const h = (rows[i] || []).map(c => (c || '').toString().toLowerCase().trim())
    const joined = h.join(' ')
    if (joined.includes('вид операц')) return 'monobank'
    if ((joined.includes('дебет') || joined.includes('зарахован') || joined.includes('списан')) &&
        (joined.includes('кредит') || joined.includes('зарахован') || joined.includes('списан')) &&
        h.filter(c => c.includes('дебет') || c.includes('кредит') || c.includes('зарахован') || c.includes('списан')).length >= 2) return 'pumb'
    if (joined.includes('дрпоу') && (joined.includes('платник') || joined.includes('рахунок'))) return 'pumb'
  }
  return 'unknown'
}

// Monobank Business: 0-дата,2-тип,3-опис,4-контрагент,5-ЄДРПОУ,6-IBAN,7-сума,14-референс
function parseMonobank(rows) {
  const txs = []
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    const dateStr = row[0]?.toString().trim()
    const amtStr = row[7]?.toString().trim()
    if (!dateStr || !amtStr) continue
    const parts = dateStr.split('.')
    if (parts.length !== 3) continue
    const date = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    const amount = parseFloat(amtStr.replace(/\s/g, '').replace(',', '.')) || 0
    if (amount === 0) continue
    const desc = (row[3] || '').toString().trim()
    const refMatch = desc.match(/[№#]\s*([\w/-]+)/)
    txs.push({
      date, amount,
      counterparty: row[4]?.toString().trim() || null,
      description: desc.substring(0, 200),
      reference: row[14]?.toString().trim() || refMatch?.[1] || null,
      account: row[6]?.toString().trim() || null,
      edrpou: row[5]?.toString().trim() || null,
      _bank: 'Monobank',
    })
  }
  return txs
}

// ПУМБ: окремі колонки Дебет/Кредит
function parsePUMB(rows) {
  let headerIdx = -1, cols = {}
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const h = (rows[i] || []).map(c => (c || '').toString().toLowerCase().trim())
    const hasDebit = h.findIndex(c => c.includes('дебет') || c.includes('списан'))
    const hasCredit = h.findIndex(c => c.includes('кредит') || c.includes('зарахован'))
    if (hasDebit >= 0 && hasCredit >= 0) {
      headerIdx = i
      cols = {
        date: h.findIndex(c => c.includes('дат') && !c.includes('вал')),
        desc: h.findIndex(c => c.includes('призначен') || c.includes('детал') || c.includes('опис')),
        counterparty: h.findIndex(c => c.includes('платник') || c.includes('одержувач') || c.includes('партнер') || c.includes('контрагент')),
        edrpou: h.findIndex(c => c.includes('дрпоу') || c.includes('іпн')),
        bank: h.findIndex(c => c.includes('банк') && !c.includes('мфо')),
        mfo: h.findIndex(c => c.includes('мфо')),
        account: h.findIndex(c => c.includes('рахунок') || c.includes('iban')),
        debit: hasDebit, credit: hasCredit,
        docNum: h.findIndex(c => c.includes('документ') || c.includes('доручен') || c.includes('номер')),
      }
      break
    }
  }
  if (headerIdx < 0) return []

  const parseAmt = s => {
    if (!s) return 0
    let str = s.toString().trim()
    if (str.includes('.') && str.includes(',')) str = str.replace(/,/g, '')
    else if (str.includes(',') && !str.includes('.')) str = str.replace(/,/g, '.')
    return parseFloat(str.replace(/\s/g, '')) || 0
  }

  const txs = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row[cols.date]) continue
    let dateStr = row[cols.date]?.toString().trim()
    if (!dateStr) continue
    let date = dateStr
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) { const [d, m, y] = dateStr.split('.'); date = `${y}-${m}-${d}` }
    else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) { const [d, m, y] = dateStr.split('/'); date = `${y}-${m}-${d}` }
    const debitVal = parseAmt(row[cols.debit])
    const creditVal = parseAmt(row[cols.credit])
    if (debitVal === 0 && creditVal === 0) continue
    const amount = creditVal > 0 ? creditVal : -debitVal
    txs.push({
      date, amount,
      counterparty: cols.counterparty >= 0 ? (row[cols.counterparty] || '').toString().trim() || null : null,
      description: (cols.desc >= 0 ? (row[cols.desc] || '').toString().trim() : '').substring(0, 200),
      reference: cols.docNum >= 0 ? (row[cols.docNum] || '').toString().trim() || null : null,
      account: cols.account >= 0 ? (row[cols.account] || '').toString().trim() || null : null,
      edrpou: cols.edrpou >= 0 ? (row[cols.edrpou] || '').toString().trim() || null : null,
      bank_name: cols.bank >= 0 ? (row[cols.bank] || '').toString().trim() || null : null,
      mfo: cols.mfo >= 0 ? (row[cols.mfo] || '').toString().trim() || null : null,
      _bank: 'ПУМБ',
    })
  }
  return txs
}

async function readCsvText(file) {
  const tryEnc = enc => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file, enc)
  })
  const utf8 = await tryEnc('utf-8')
  const garbled = (utf8.match(/[À-ÿ]{3,}/g) || []).length > 3 || utf8.includes('�')
  return garbled ? tryEnc('windows-1251') : utf8
}

const PARSE_PROMPT = `Ти парсер банківських виписок українських банків. Поверни ТІЛЬКИ JSON масив:
[{"date":"YYYY-MM-DD","amount":число_зі_знаком,"counterparty":"назва або null","description":"опис до 150 символів","reference":"номер або null","account":"IBAN або null","edrpou":"код або null"}]
Суми зі знаком: надходження +, витрати -. Якщо не виписка — [].`

async function parseWithClaude(content, fileName, isPDF = false) {
  const messages = isPDF
    ? [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content } },
        { type: 'text', text: `Файл: ${fileName}. Розпізнай виписку та поверни JSON.` },
      ] }]
    : [{ role: 'user', content: `Банківська виписка (${fileName}):\n\n${content.substring(0, 28000)}` }]
  const body = { model: 'claude-sonnet-4-6', max_tokens: 4096, system: PARSE_PROMPT, messages }
  const data = await callClaude(body) // авто-повтор на overloaded/rate-limit
  const txt = data.content?.find(b => b.type === 'text')?.text || '[]'
  return JSON.parse(txt.replace(/```json|```/g, '').trim())
}

// Головна функція: файл → масив транзакцій { date, amount, counterparty, description, reference, account, edrpou, _bank }
export async function parseStatement(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'xlsx' || ext === 'xls') {
    const rows = await readXlsx(file)
    const format = detectFormat(rows)
    if (format === 'monobank') { const t = parseMonobank(rows); if (t.length) return t }
    if (format === 'pumb') { const t = parsePUMB(rows); if (t.length) return t }
    const buf = await file.arrayBuffer()
    const wb2 = XLSX.read(buf, { type: 'array', codepage: 1251 })
    const csv = XLSX.utils.sheet_to_csv(Object.values(wb2.Sheets)[0])
    return parseWithClaude(csv, file.name)
  }
  if (ext === 'pdf') {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file)
    })
    return parseWithClaude(b64, file.name, true)
  }
  const text = await readCsvText(file)
  return parseWithClaude(text, file.name)
}

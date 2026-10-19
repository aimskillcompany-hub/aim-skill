// Звіт по дебіторці для ОДНОГО контрагента перед ОДНІЄЮ нашою юрособою — «Нагадування про заборгованість»
// або «Виписка по розрахунках». Борг — та сама логіка, що й у звіті «Дебіторка» (loadReceivablesAsOf),
// тож суми збігаються з Балансом. Звіт іде клієнту: без внутрішніх позначок (не звірено / не підписано).
import { supabase } from './supabase'
import { loadReceivablesAsOf } from './receivables'
import { loadDocItems } from './docItems'
import { getCompanyById } from './companyConfig'
import { createWorkbook, downloadXlsx } from './docgen/xlsxBuilder'
import * as XLSX from 'xlsx'

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
export const dmy = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const _m = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const money = (v) => _m.format(r2(v)).replace(/ /g, ' ')

export const TITLES = { reminder: 'Нагадування про заборгованість', statement: 'Виписка по розрахунках' }
export const DOC_KIND = { waybill: 'Видаткова накладна', serviceAct: 'Акт наданих послуг', incomingWaybill: 'Накладна', other: 'Документ' }
export const docKind = (t) => DOC_KIND[t] || 'Документ'
// Назва документа для клієнта: вид + номер; без номера — вид + дата
export const docTitle = (d) => `${docKind(d.type)} ${d.hasNumber ? d.doc_number : `від ${dmy(d.doc_date)}`}`

export async function buildClientStatement({ contractorId, companyId, asOf, onlyOverdue = false, withItems = true, title = 'reminder' }) {
  const [company, { data: contractor }] = await Promise.all([
    getCompanyById(companyId),
    supabase.from('contractors').select('id, name, short_name, edrpou, payment_delay_days').eq('id', contractorId).maybeSingle(),
  ])
  if (!company) throw new Error('Юрособу не знайдено')
  const { docs: all, ageRef } = await loadReceivablesAsOf([{ id: companyId, name: company.shortName || company.name }], asOf)
  let docs = all.filter(d => d.contractorId === contractorId)
  if (onlyOverdue) docs = docs.filter(d => d.overdueDays > 0)
  docs.sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || '') || (a.doc_number || '').localeCompare(b.doc_number || ''))

  const items = await loadDocItems(docs) // рядки потрібні завжди: Excel і звірка сум; «без товарів» лише ховає їх у PDF
  docs = docs.map(d => ({ ...d, items: items[d.docId] || null, vatOut: d.amount ? r2(d.vat * d.outstanding / d.amount) : 0 }))

  // договір — з документів (згенеровані документи зберігають номер/дату договору)
  const contracts = [...new Map(docs.map(d => d.items?.contract).filter(c => c?.num).map(c => [c.num, c])).values()]

  const total = r2(docs.reduce((s, d) => s + d.outstanding, 0))
  const overdueDocs = docs.filter(d => d.overdueDays > 0)
  const summary = {
    total, vat: r2(docs.reduce((s, d) => s + d.vatOut, 0)),
    overdue: r2(overdueDocs.reduce((s, d) => s + d.outstanding, 0)),
    overdueCount: overdueDocs.length,
    maxOverdue: overdueDocs.reduce((m, d) => Math.max(m, d.overdueDays), 0),
    count: docs.length,
  }
  const vatPayer = company.isVatPayer !== false && summary.vat > 0.005
  const allActs = docs.length && docs.every(d => d.type === 'serviceAct')
  const anyAct = docs.some(d => d.type === 'serviceAct')
  const what = allActs ? 'послуги' : anyAct ? 'товари/послуги' : 'товар'
  const refs = docs.length <= 5
    ? docs.map(d => `${d.hasNumber ? d.doc_number : docKind(d.type).toLowerCase()} від ${dmy(d.doc_date)}`).join(', ')
    : `${docs.length} документів (перелік у виписці)`
  const purpose = `Оплата за ${what} згідно ${refs}, ${vatPayer ? `у т.ч. ПДВ ${money(summary.vat)} грн` : 'без ПДВ'}`

  return {
    company, contractor: contractor || { id: contractorId, name: docs[0]?.contractorName || '—', edrpou: docs[0]?.edrpou || '' },
    contracts, asOf: ageRef, requestedAsOf: asOf, generatedAt: new Date().toISOString(),
    title: TITLES[title] || TITLES.reminder, titleKey: title, withItems, onlyOverdue,
    docs, summary, vatPayer, purpose,
    warnings: {
      noNumber: docs.filter(d => !d.hasNumber),
      noItems: docs.filter(d => d.items?.noItems),
      mismatch: docs.filter(d => d.items?.mismatch),
    },
  }
}

// ── Текст нагадування для месенджера / email (шаблон редагується, зберігається в браузері) ──
export const DEFAULT_TEMPLATE = `Доброго дня!

Станом на {дата} за {контрагент} рахується заборгованість перед {юрособа} на суму {сума} грн,
з них прострочено {сума_прострочено} грн за {кількість} документами.
Деталізація по відвантаженнях — у вкладенні.

Просимо здійснити оплату або повідомити орієнтовну дату.
З повагою, {менеджер}, {телефон}`
const TPL_KEY = 'recv_reminder_template'
export function loadTemplate() { try { return localStorage.getItem(TPL_KEY) || DEFAULT_TEMPLATE } catch { return DEFAULT_TEMPLATE } }
export function saveTemplate(t) { try { if (!t || t === DEFAULT_TEMPLATE) localStorage.removeItem(TPL_KEY); else localStorage.setItem(TPL_KEY, t) } catch { /* приватний режим */ } }

export function reminderText(st, manager, template = loadTemplate()) {
  const vars = {
    'дата': dmy(st.asOf), 'контрагент': st.contractor.short_name || st.contractor.name, 'юрособа': st.company.shortName || st.company.name,
    'сума': money(st.summary.total), 'сума_прострочено': money(st.summary.overdue), 'кількість': String(st.summary.overdueCount),
    'менеджер': manager?.name || '', 'телефон': manager?.phone || '',
  }
  // без прострочки рядок «з них прострочено 0,00 грн за 0 документами» не має сенсу — прибираємо його
  const tpl = st.summary.overdue > 0 ? template : template.split('\n').filter(l => !l.includes('{сума_прострочено}')).join('\n').replace(/ на суму \{сума\} грн,\s*$/m, ' на суму {сума} грн.')
  return tpl.replace(/\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m))
}

// ── Excel: один аркуш, один рядок = одна товарна позиція з реквізитами документа; суми — числа ──
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
export const fileBase = (st) => `${safeName(st.contractor.short_name || st.contractor.name)}_${dmy(st.asOf)}`

export function exportClientStatementXlsx(st) {
  const head = ['Юрособа', 'Контрагент', 'ЄДРПОУ', 'Документ', '№ документа', 'Дата', 'Строк оплати', 'Прострочка, дн.',
    'Сума документа', 'Оплачено', 'Залишок', '№ поз.', 'Найменування', 'Артикул', 'К-сть', 'Од.', 'Ціна з ПДВ', 'Сума з ПДВ']
  const rows = [head]
  const dateCell = (s) => s ? new Date(s + 'T00:00:00Z') : null
  st.docs.forEach(d => {
    const base = [st.company.shortName || st.company.name, st.contractor.name, st.contractor.edrpou || '', docKind(d.type), d.hasNumber ? d.doc_number : '',
      dateCell(d.doc_date), dateCell(d.dueDate), d.overdueDays, r2(d.amount), r2(d.paid), r2(d.outstanding)]
    const lines = d.items?.rows?.length ? d.items.rows : [{ n: 1, name: 'Згідно документа', sku: null, qty: null, unit: '', price: null, sum: d.amount }]
    lines.forEach(r => rows.push([...base, r.n, r.name, r.sku || '', r.qty ?? null, r.unit || '', r.price ?? null, r.sum ?? null]))
  })
  const wb = createWorkbook()
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true })
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = 1; R <= range.e.r; R++) {
    for (const C of [5, 6]) { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c) c.z = 'dd.mm.yyyy' }
    for (const C of [8, 9, 10, 16, 17]) { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c && c.t === 'n') c.z = '#,##0.00' }
  }
  ws['!cols'] = [18, 30, 11, 20, 14, 11, 12, 10, 14, 12, 14, 6, 50, 16, 8, 6, 14, 14].map(w => ({ wch: w }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r, c: range.e.c } }) }
  XLSX.utils.book_append_sheet(wb, ws, 'Дебіторка')
  downloadXlsx(wb, `Дебіторка_${fileBase(st)}.xlsx`)
}

// ── Журнал нагадувань (міграція 068) ──
export async function logReminder(st, { channel, userId, userName }) {
  const { error } = await supabase.from('receivable_reminders').insert({
    company_id: st.company.id, contractor_id: st.contractor.id, as_of: st.asOf,
    total: st.summary.total, overdue: st.summary.overdue, doc_count: st.summary.count,
    channel, created_by: userId || null, created_by_name: userName || null,
  })
  return !error
}

// Останнє нагадування по кожному контрагенту: { [contractorId]: { created_at, total, created_by_name, channel } }
export async function lastReminders() {
  const { data, error } = await supabase.from('receivable_reminders').select('contractor_id, company_id, created_at, total, overdue, created_by_name, channel').order('created_at', { ascending: false }).limit(2000)
  if (error) return null
  const out = {}
  ;(data || []).forEach(r => { if (!out[r.contractor_id]) out[r.contractor_id] = r })
  return out
}
export async function remindersFor(contractorId) {
  const { data, error } = await supabase.from('receivable_reminders').select('*').eq('contractor_id', contractorId).order('created_at', { ascending: false }).limit(50)
  return error ? null : (data || [])
}

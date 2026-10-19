// Звіт по дебіторці для ОДНОГО контрагента перед ОДНІЄЮ нашою юрособою — «Нагадування про заборгованість»
// або «Виписка по розрахунках». Борг — та сама логіка, що й у звіті «Дебіторка» (loadReceivablesAsOf),
// тож суми збігаються з Балансом. Звіт іде клієнту: без внутрішніх позначок (не звірено / не підписано).
import { supabase } from './supabase'
import { loadReceivablesAsOf } from './receivables'
import { loadDocItems } from './docItems'
import { getCompanyById } from './companyConfig'

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
З повагою, {менеджер}`
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
    .replace(/,\s*,/g, ',').replace(/,\s*$/gm, '') // порожні {менеджер}/{телефон} не лишають «, ,» у кінці
}

// ── Excel (ExcelJS — зі стилями): як PDF — рядок документа жирний із сірою заливкою, товари з відступом ──
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
export const fileBase = (st) => `${safeName(st.contractor.short_name || st.contractor.name)}_${dmy(st.asOf)}`

export async function exportClientStatementXlsx(st) {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Дебіторка', { views: [{ state: 'frozen', ySplit: 5 }] })
  ws.columns = [
    { width: 58 }, { width: 16 }, { width: 9 }, { width: 6 }, { width: 14 }, { width: 13 }, { width: 15 }, { width: 14 }, { width: 11 },
  ]
  const NUM = '#,##0.00'
  ws.addRow([`${st.title} — ${st.contractor.name}${st.contractor.edrpou ? ' (ЄДРПОУ ' + st.contractor.edrpou + ')' : ''}`]).font = { bold: true, size: 13 }
  ws.addRow([`Постачальник: ${st.company.name || st.company.shortName}${st.company.edrpou ? ', ЄДРПОУ ' + st.company.edrpou : ''}`])
  ws.addRow([`Станом на ${dmy(st.asOf)}`])
  ws.addRow([])
  const head = ws.addRow(['Документ / товар', 'Артикул', 'К-сть', 'Од.', 'Ціна з ПДВ', 'Дата відвант.', 'Сума, грн', 'Залишок, грн', 'Днів з відвант.'])
  head.font = { bold: true, color: { argb: 'FF5E5A6B' } }
  head.eachCell(c => { c.border = { bottom: { style: 'thin', color: { argb: 'FFCFCBD9' } } } })

  const dateOf = (iso) => iso ? new Date(iso + 'T00:00:00Z') : null
  st.docs.forEach(d => {
    const r = ws.addRow([docTitle(d), null, null, null, null, dateOf(d.doc_date), r2(d.amount), r2(d.outstanding), d.ageDays])
    r.font = { bold: true }
    for (let c = 1; c <= 9; c++) {
      const cell = r.getCell(c)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
      cell.border = { top: { style: 'thin', color: { argb: 'FFCFCBD9' } } }
    }
    r.getCell(6).numFmt = 'dd.mm.yyyy'; r.getCell(7).numFmt = NUM; r.getCell(8).numFmt = NUM
    if (st.withItems) {
      ;(d.items?.rows || []).forEach(it => {
        const ir = ws.addRow([`${it.n}. ${it.name}`, it.sku || null, it.qty ?? null, it.unit || null, it.price ?? null, null, it.sum ?? null, null, null])
        ir.font = { size: 10, color: { argb: 'FF5E5A6B' } }
        ir.getCell(1).alignment = { indent: 1, wrapText: true }
        ir.getCell(5).numFmt = NUM; ir.getCell(7).numFmt = NUM
      })
    }
    d.payments.filter(p => p.amount > 0).forEach(p => {
      const pr = ws.addRow([`Оплачено ${p.date ? dmy(p.date) : ''}`, null, null, null, null, dateOf(p.date), -r2(p.amount), null, null])
      pr.font = { size: 10, italic: true, color: { argb: 'FF1F7A4D' } }
      pr.getCell(1).alignment = { indent: 1 }
      pr.getCell(6).numFmt = 'dd.mm.yyyy'; pr.getCell(7).numFmt = NUM
    })
  })
  const tot = ws.addRow(['Разом до сплати', null, null, null, null, null, null, r2(st.summary.total), null])
  tot.font = { bold: true, size: 12 }
  tot.getCell(8).numFmt = NUM
  tot.eachCell(c => { c.border = { top: { style: 'medium', color: { argb: 'FF17151F' } } } })

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = `Дебіторка_${fileBase(st)}.xlsx`
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
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

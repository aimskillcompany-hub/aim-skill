// Дані для звіту «Дебіторка» (receivable) по всіх юрособах, станом на кінець періоду.
// Борг = сума документа − оплати (transaction_documents) з датою ≤ кінця періоду. Лише боргові
// документи клієнту (видаткова/акт, countsAsDebt), direction='receivable'.
import { qc, getActiveCompanyId, setActiveCompanyId } from './companyScope'
import { clearCompanyCache } from './companyConfig'
import { countsAsDebt, debtDate } from './debts'
import { supabase } from './supabase'

export const BUCKETS = [
  { key: '0-7', label: '0–7 дн.', from: 0, to: 7, color: '#D6D1E6' },
  { key: '8-14', label: '8–14 дн.', from: 8, to: 14, color: '#F2C07A' },
  { key: '15-30', label: '15–30 дн.', from: 15, to: 30, color: '#E8803C' },
  { key: '30+', label: '30+ дн.', from: 31, to: Infinity, color: '#C62828' },
]
const bucketOf = (age) => BUCKETS.find(b => age >= b.from && age <= b.to)?.key || '30+'
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const addDaysIso = (iso, n) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + (Number(n) || 0)); return x.toISOString().slice(0, 10) }
const lastDay = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

let _lock = Promise.resolve()

// Повертає плаский список боргових документів по всіх компаніях + мета компаній (станом на кінець місяця).
export function loadReceivables(companies, year, month) {
  return loadReceivablesAsOf(companies, lastDay(year, month))
}

// Те саме станом на довільну дату (YYYY-MM-DD) — для звіту по контрагенту.
// Строк оплати = дата документа + відстрочка контрагента (contractors.payment_delay_days, інакше 0);
// прострочка = дата відліку − строк оплати (не менше 0). Вік — від дати документа.
export async function loadReceivablesAsOf(companies, asOf) {
  const run = async () => {
    // Вік боргу — до сьогодні (для поточного/майбутнього періоду) або до кінця минулого періоду.
    // Склад боргів (документи/оплати ≤ asOf) не змінюється — щоб сума збігалась із Балансом.
    const todayIso = new Date().toISOString().slice(0, 10)
    const ageRef = asOf < todayIso ? asOf : todayIso
    const asOfMs = new Date(ageRef).getTime()
    const saved = getActiveCompanyId()
    const docsOut = []
    const companyMeta = []
    try {
      // контрагенти (не скоуплені) — один раз
      const { data: contractors } = await supabase.from('contractors').select('id, name, edrpou, payment_delay_days')
      const cName = {}, cEdr = {}, cDelay = {}
      ;(contractors || []).forEach(c => { cName[c.id] = c.name; cEdr[c.id] = c.edrpou; cDelay[c.id] = Number(c.payment_delay_days) || 0 })

      for (const comp of companies) {
        setActiveCompanyId(comp.id); clearCompanyCache()
        companyMeta.push({ id: comp.id, name: comp.short_name || comp.name })

        // боргові документи клієнту до кінця періоду
        const { data: docs } = await qc('documents')
          .select('id, doc_number, type, doc_date, amount, vat_amount, is_signed, is_verified, contractor_id, storage_path, order_id, created_at, direction, generated_doc_id')
          .eq('direction', 'receivable').not('amount', 'is', null)
        const relevant = (docs || []).filter(d => countsAsDebt(d.type) && debtDate(d) <= asOf)
        const ids = relevant.map(d => d.id)
        if (!ids.length) continue

        // оплати ≤ кінця періоду (transaction_documents → bank_transactions.date)
        const paidByDoc = {}, paysByDoc = {}
        const tds = []
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await supabase.from('transaction_documents').select('document_id, amount, transaction_id').in('document_id', ids.slice(i, i + 200))
          ;(data || []).forEach(x => tds.push(x))
        }
        const ptxIds = [...new Set(tds.map(x => x.transaction_id).filter(Boolean))]
        const ptxDate = {}
        for (let i = 0; i < ptxIds.length; i += 200) {
          const { data } = await supabase.from('bank_transactions').select('id, date').in('id', ptxIds.slice(i, i + 200))
          ;(data || []).forEach(x => ptxDate[x.id] = x.date)
        }
        tds.forEach(x => {
          const pd = ptxDate[x.transaction_id]
          if (pd && pd > asOf) return // оплата пізніше кінця періоду
          paidByDoc[x.document_id] = (paidByDoc[x.document_id] || 0) + Math.abs(Number(x.amount) || 0)
          ;(paysByDoc[x.document_id] ||= []).push({ date: pd || null, amount: r2(Math.abs(Number(x.amount) || 0)) })
        })

        relevant.forEach(d => {
          const amount = Math.abs(Number(d.amount) || 0)
          const paid = r2(paidByDoc[d.id] || 0)
          const outstanding = r2(amount - paid)
          if (outstanding <= 0.5) return
          const dd = debtDate(d)
          const ageDays = dd ? Math.max(0, Math.floor((asOfMs - new Date(dd).getTime()) / 864e5)) : 0
          const delayDays = cDelay[d.contractor_id] || 0
          const dueDate = dd ? addDaysIso(dd, delayDays) : null
          const overdueDays = dueDate ? Math.max(0, Math.floor((asOfMs - new Date(dueDate).getTime()) / 864e5)) : 0
          docsOut.push({
            companyId: comp.id, companyName: comp.short_name || comp.name,
            docId: d.id, doc_number: d.doc_number || '—', hasNumber: !!(d.doc_number || '').trim(), type: d.type, doc_date: dd,
            amount, paid, outstanding, ageDays, bucket: bucketOf(ageDays),
            delayDays, dueDate, overdueDays, payments: (paysByDoc[d.id] || []).sort((a, b) => (a.date || '').localeCompare(b.date || '')),
            generated_doc_id: d.generated_doc_id || null,
            contractorId: d.contractor_id || 'unknown',
            contractorName: cName[d.contractor_id] || 'Без контрагента',
            edrpou: cEdr[d.contractor_id] || '',
            is_signed: !!d.is_signed, is_verified: !!d.is_verified,
            storage_path: d.storage_path || null, order_id: d.order_id || null, vat: Math.abs(Number(d.vat_amount) || 0),
          })
        })
      }
    } finally {
      setActiveCompanyId(saved); clearCompanyCache()
    }
    return { docs: docsOut, companies: companyMeta, asOf, ageRef }
  }
  const result = _lock.then(run, run)
  _lock = result.then(() => {}, () => {})
  return result
}

// Групування боргових документів за контрагентом + підсумки (чиста функція).
export function groupReceivables(docs) {
  const byC = {}
  docs.forEach(d => {
    const g = (byC[d.contractorId] ||= {
      contractorId: d.contractorId, name: d.contractorName, edrpou: d.edrpou,
      total: 0, over30: 0, oldest: 0, docs: [],
      buckets: Object.fromEntries(BUCKETS.map(b => [b.key, 0])),
    })
    g.total = r2(g.total + d.outstanding)
    g.buckets[d.bucket] = r2(g.buckets[d.bucket] + d.outstanding)
    if (d.bucket === '30+') g.over30 = r2(g.over30 + d.outstanding)
    if (d.ageDays > g.oldest) g.oldest = d.ageDays
    g.docs.push(d)
  })
  const contractors = Object.values(byC).map(g => {
    g.docs.sort((a, b) => b.ageDays - a.ageDays)
    return g
  }).sort((a, b) => b.total - a.total)

  const buckets = Object.fromEntries(BUCKETS.map(b => [b.key, 0]))
  let total = 0
  docs.forEach(d => { total = r2(total + d.outstanding); buckets[d.bucket] = r2(buckets[d.bucket] + d.outstanding) })
  const over30 = buckets['30+']
  const summary = {
    total, over30, over30Pct: total ? over30 / total : 0,
    debtors: contractors.length, docCount: docs.length, buckets,
    vat: r2(docs.reduce((s, d) => s + (d.vat || 0), 0)),
  }
  return { contractors, summary }
}

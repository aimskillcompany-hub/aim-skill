// Поворотна фінансова допомога (ПФД) — контроль отриманих/повернутих позик.
// Джерело — транзакції bank_transactions з direction='ПФД':
//   amount > 0 — ОТРИМАНО нами (нам дали в борг);
//   amount < 0 — ПОВЕРНУТО нами (ми віддали).
// Зв'язок повернень з приходами (many-to-many) — у таблиці loan_allocations (міграція 060).
import { qc, withCompany } from './companyScope'
import { supabase } from './supabase'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const EPS = 0.005

// Ключ групування за контрагентом: id якщо є, інакше нормалізована назва.
function groupKey(t) {
  if (t.contractor_id) return 'c:' + t.contractor_id
  const n = (t.counterparty || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return 'n:' + (n || '—')
}

// Завантажити весь стан ПФД, згрупований за контрагентом, з розрахунком покриття.
export async function loadPfd() {
  const [{ data: txs }, allocRes, { data: contractors }] = await Promise.all([
    qc('bank_transactions')
      .select('id, date, amount, counterparty, description, contractor_id, account_id')
      .eq('is_ignored', false).eq('direction', 'ПФД').order('date'),
    qc('loan_allocations').select('id, receipt_tx_id, return_tx_id, amount'),
    supabase.from('contractors').select('id, name'),
  ])

  // Таблиця ще не створена (міграція не запущена) → працюємо без зв'язків.
  const needsMigration = !!(allocRes.error && /loan_allocations/.test(allocRes.error.message || ''))
  const allocs = allocRes.data || []

  const cName = {}; (contractors || []).forEach(c => cName[c.id] = c.name)

  const allocByReceipt = {}, allocByReturn = {}
  allocs.forEach(a => {
    allocByReceipt[a.receipt_tx_id] = r2((allocByReceipt[a.receipt_tx_id] || 0) + Math.abs(a.amount))
    allocByReturn[a.return_tx_id] = r2((allocByReturn[a.return_tx_id] || 0) + Math.abs(a.amount))
  })

  const groups = {}
  const ensure = (t) => {
    const k = groupKey(t)
    if (!groups[k]) groups[k] = {
      key: k,
      name: (t.contractor_id && cName[t.contractor_id]) || t.counterparty || '—',
      contractorId: t.contractor_id || null,
      receipts: [], returns: [],
      received: 0, returned: 0,
    }
    return groups[k]
  }

  ;(txs || []).forEach(t => {
    const g = ensure(t)
    const amt = Number(t.amount) || 0
    if (amt > 0) {
      const covered = r2(allocByReceipt[t.id] || 0)
      g.receipts.push({ ...t, amount: amt, covered, outstanding: r2(amt - covered) })
      g.received = r2(g.received + amt)
    } else if (amt < 0) {
      const abs = r2(-amt)
      const allocated = r2(allocByReturn[t.id] || 0)
      g.returns.push({ ...t, amount: amt, abs, allocated, unallocated: r2(abs - allocated) })
      g.returned = r2(g.returned + abs)
    }
  })

  const list = Object.values(groups).map(g => {
    g.net = r2(g.received - g.returned) // >0 — ми винні повернути; <0 — переплатили/нам винні
    g.openReceipts = g.receipts.filter(x => x.outstanding > EPS).length
    g.unallocatedReturns = r2(g.returns.reduce((s, x) => s + x.unallocated, 0))
    return g
  }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

  const totals = list.reduce((s, g) => ({
    received: r2(s.received + g.received),
    returned: r2(s.returned + g.returned),
    net: r2(s.net + g.net),
  }), { received: 0, returned: 0, net: 0 })

  // Залишок «ми винні» (лише додатні сальдо) та «нам винні / переплата» (від'ємні).
  totals.owedByUs = r2(list.reduce((s, g) => s + Math.max(0, g.net), 0))
  totals.owedToUs = r2(list.reduce((s, g) => s + Math.max(0, -g.net), 0))

  return { groups: list, totals, needsMigration, allocations: allocs }
}

// FIFO-план для однієї групи: гасимо найстаріші приходи найстарішими поверненнями.
// Повертає масив { receipt_tx_id, return_tx_id, amount } — лише НОВІ зарахування
// (поверх уже наявних), враховуючи залишки.
export function fifoPlan(group) {
  const receipts = group.receipts.map(x => ({ id: x.id, rem: r2(x.outstanding) })).filter(x => x.rem > EPS)
  const returns = group.returns.map(x => ({ id: x.id, rem: r2(x.unallocated) })).filter(x => x.rem > EPS)
  const plan = []
  let ri = 0
  for (const ret of returns) {
    let left = ret.rem
    while (left > EPS && ri < receipts.length) {
      const rec = receipts[ri]
      if (rec.rem <= EPS) { ri++; continue }
      const take = r2(Math.min(left, rec.rem))
      if (take > EPS) plan.push({ receipt_tx_id: rec.id, return_tx_id: ret.id, amount: take })
      rec.rem = r2(rec.rem - take)
      left = r2(left - take)
      if (rec.rem <= EPS) ri++
    }
  }
  return plan
}

export async function applyAllocations(plan) {
  if (!plan.length) return { count: 0 }
  const { error } = await qc('loan_allocations').insert(plan.map(p => withCompany(p)))
  if (error) throw error
  return { count: plan.length }
}

export async function addAllocation({ receiptTxId, returnTxId, amount }) {
  const { error } = await qc('loan_allocations').insert(withCompany({
    receipt_tx_id: receiptTxId, return_tx_id: returnTxId, amount: r2(amount),
  }))
  if (error) throw error
}

export async function removeAllocation(id) {
  const { error } = await qc('loan_allocations').delete().eq('id', id)
  if (error) throw error
}

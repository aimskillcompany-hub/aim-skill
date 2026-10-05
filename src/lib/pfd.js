// Поворотна фінансова допомога (ПФД) — контроль позик в ОБИДВА боки.
// Джерело — транзакції bank_transactions з direction='ПФД'. Знак суми: + гроші до нас, − гроші від нас.
// Роль визначається per контрагент за ПЕРШИМ рухом:
//   перший рух + (гроші прийшли) → МИ ПОЗИЧАЛЬНИК (borrower): отримали ПФД, маємо повернути;
//   перший рух − (гроші пішли)   → МИ КРЕДИТОР  (lender):   надали ПФД, нам мають повернути.
// «Тіло» (principal) — рух, що створює борг (borrower: надходження; lender: видаток).
// «Погашення» (settlement) — зворотний рух. Зв'язок тіло↔погашення — у loan_allocations (міграція 060):
//   receipt_tx_id = тіло, return_tx_id = погашення (назви колонок історичні, семантика — тіло/погашення).
import { qc, withCompany } from './companyScope'
import { supabase } from './supabase'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const EPS = 0.005

function groupKey(t) {
  if (t.contractor_id) return 'c:' + t.contractor_id
  const n = (t.counterparty || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return 'n:' + (n || '—')
}

export async function loadPfd() {
  const [{ data: txs }, allocRes, { data: contractors }] = await Promise.all([
    qc('bank_transactions')
      .select('id, date, amount, counterparty, description, contractor_id, account_id')
      .eq('is_ignored', false).eq('direction', 'ПФД').order('date'),
    qc('loan_allocations').select('id, receipt_tx_id, return_tx_id, amount'),
    supabase.from('contractors').select('id, name'),
  ])

  const needsMigration = !!(allocRes.error && /loan_allocations/.test(allocRes.error.message || ''))
  const allocs = allocRes.data || []
  const cName = {}; (contractors || []).forEach(c => cName[c.id] = c.name)

  const allocByPrincipal = {}, allocBySettlement = {}
  allocs.forEach(a => {
    allocByPrincipal[a.receipt_tx_id] = r2((allocByPrincipal[a.receipt_tx_id] || 0) + Math.abs(a.amount))
    allocBySettlement[a.return_tx_id] = r2((allocBySettlement[a.return_tx_id] || 0) + Math.abs(a.amount))
  })

  // Зібрати рухи по контрагентах
  const groups = {}
  ;(txs || []).forEach(t => {
    const amt = Number(t.amount) || 0
    if (amt === 0) return
    const k = groupKey(t)
    if (!groups[k]) groups[k] = {
      key: k,
      name: (t.contractor_id && cName[t.contractor_id]) || t.counterparty || '—',
      contractorId: t.contractor_id || null,
      movements: [],
    }
    groups[k].movements.push(t)
  })

  const list = Object.values(groups).map(g => {
    // перший рух визначає роль (транзакції вже відсортовані за датою)
    const first = g.movements[0]
    g.role = (Number(first?.amount) || 0) > 0 ? 'borrower' : 'lender'
    const principalIsPositive = g.role === 'borrower' // тіло боргу: borrower=+, lender=−

    g.principals = []; g.settlements = []
    g.principalTotal = 0; g.settledTotal = 0
    g.movements.forEach(t => {
      const amt = Number(t.amount) || 0
      const abs = r2(Math.abs(amt))
      const isPrincipal = principalIsPositive ? amt > 0 : amt < 0
      if (isPrincipal) {
        const covered = r2(allocByPrincipal[t.id] || 0)
        g.principals.push({ ...t, abs, covered, outstanding: r2(abs - covered) })
        g.principalTotal = r2(g.principalTotal + abs)
      } else {
        const allocated = r2(allocBySettlement[t.id] || 0)
        g.settlements.push({ ...t, abs, allocated, unallocated: r2(abs - allocated) })
        g.settledTotal = r2(g.settledTotal + abs)
      }
    })

    g.net = r2(g.principalTotal - g.settledTotal) // >0 — борг ще відкритий
    g.openPrincipals = g.principals.filter(x => x.outstanding > EPS).length
    g.unallocatedSettlements = r2(g.settlements.reduce((s, x) => s + x.unallocated, 0))
    return g
  }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

  const totals = {
    // Ми винні повернути (отримані ПФД, ще не повернуті) — лише borrower-групи з відкритим боргом
    owedByUs: r2(list.filter(g => g.role === 'borrower').reduce((s, g) => s + Math.max(0, g.net), 0)),
    // Нам мають повернути (надані нами ПФД, ще не повернуті) — lender-групи з відкритим боргом
    owedToUs: r2(list.filter(g => g.role === 'lender').reduce((s, g) => s + Math.max(0, g.net), 0)),
    borrowedTotal: r2(list.filter(g => g.role === 'borrower').reduce((s, g) => s + g.principalTotal, 0)),
    lentTotal: r2(list.filter(g => g.role === 'lender').reduce((s, g) => s + g.principalTotal, 0)),
  }

  return { groups: list, totals, needsMigration, allocations: allocs }
}

// FIFO-план для групи: гасимо найстаріші тіла найстарішими погашеннями.
export function fifoPlan(group) {
  const principals = group.principals.map(x => ({ id: x.id, rem: r2(x.outstanding) })).filter(x => x.rem > EPS)
  const settlements = group.settlements.map(x => ({ id: x.id, rem: r2(x.unallocated) })).filter(x => x.rem > EPS)
  const plan = []
  let pi = 0
  for (const s of settlements) {
    let left = s.rem
    while (left > EPS && pi < principals.length) {
      const p = principals[pi]
      if (p.rem <= EPS) { pi++; continue }
      const take = r2(Math.min(left, p.rem))
      if (take > EPS) plan.push({ receipt_tx_id: p.id, return_tx_id: s.id, amount: take })
      p.rem = r2(p.rem - take)
      left = r2(left - take)
      if (p.rem <= EPS) pi++
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

export async function addAllocation({ principalTxId, settlementTxId, amount }) {
  const { error } = await qc('loan_allocations').insert(withCompany({
    receipt_tx_id: principalTxId, return_tx_id: settlementTxId, amount: r2(amount),
  }))
  if (error) throw error
}

export async function removeAllocation(id) {
  const { error } = await qc('loan_allocations').delete().eq('id', id)
  if (error) throw error
}

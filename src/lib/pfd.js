// Поворотна фінансова допомога (ПФД) — контроль позик в ОБИДВА боки, з класифікацією за СТАТТЕЮ.
// Джерело — транзакції bank_transactions з direction='ПФД'. Знак суми: + гроші до нас, − гроші від нас.
//
// Один контрагент може одночасно бути і позичальником, і кредитором (напр. ЛИПСАН: ми давали і нам давали).
// Тому роль визначається НЕ за знаком, а за СТАТТЕЮ кожної транзакції:
//   «ПФД отримано»        → borrower / тіло   (ми отримали позику, +)
//   «ПФД повернено нами»  → borrower / погашення (ми повернули, −)
//   «ПФД надана нами»     → lender   / тіло   (ми дали позику, −)
//   «ПФД повернено нам»   → lender   / погашення (нам повернули, +)
// Кожен контрагент дає до 2 незалежних «леджерів» (borrower і lender) + окремий кошик «без статті».
// Зв'язок тіло↔погашення — loan_allocations (receipt_tx_id=тіло, return_tx_id=погашення; назви історичні).
import { qc, withCompany } from './companyScope'
import { supabase } from './supabase'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const EPS = 0.005

function cpKey(t) {
  if (t.contractor_id) return 'c:' + t.contractor_id
  const n = (t.counterparty || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return 'n:' + (n || '—')
}

// Класифікація транзакції ПФД за статтею + знаком суми → { ledger, kind }.
// ledger: 'borrower' | 'lender' | null (null = стаття не розпізнана → кошик «без статті»).
// kind:   'principal' (тіло боргу) | 'settlement' (погашення).
// ВАЖЛИВО: «поверн…» перевіряємо ПЕРШИМ (бо назва може містити і «надані/отримані»),
// а роль погашення визначаємо за ЗНАКОМ: гроші до нас (+) → нам повернули (lender);
// гроші від нас (−) → ми повернули (borrower). Це надійніше, ніж нам/нами у назві.
export function classifyPfd(article, amount = 0) {
  const a = (article || '').toLowerCase()
  if (/поверн/.test(a)) {
    return Number(amount) > 0
      ? { ledger: 'lender', kind: 'settlement' }      // повернено НАМ (нам віддали надане)
      : { ledger: 'borrower', kind: 'settlement' }    // повернено НАМИ (ми віддали отримане)
  }
  if (/надан|видан/.test(a)) return { ledger: 'lender', kind: 'principal' }   // ПФД надана нами
  if (/отриман|залучен/.test(a)) return { ledger: 'borrower', kind: 'principal' } // ПФД отримано
  return { ledger: null, kind: null }
}

export async function loadPfd() {
  const [{ data: txs }, allocRes, { data: contractors }] = await Promise.all([
    qc('bank_transactions')
      .select('id, date, amount, counterparty, description, article, contractor_id, account_id')
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

  // Групуємо за (контрагент + леджер). Леджер з класифікації; null → 'untagged'.
  const groups = {}
  const ensure = (t, ledger) => {
    const k = cpKey(t) + '|' + (ledger || 'untagged')
    if (!groups[k]) groups[k] = {
      key: k,
      name: (t.contractor_id && cName[t.contractor_id]) || t.counterparty || '—',
      contractorId: t.contractor_id || null,
      role: ledger || 'untagged',
      principals: [], settlements: [], movements: [],
      principalTotal: 0, settledTotal: 0,
    }
    return groups[k]
  }

  ;(txs || []).forEach(t => {
    const amt = Number(t.amount) || 0
    if (amt === 0) return
    const { ledger, kind } = classifyPfd(t.article, amt)
    const g = ensure(t, ledger)
    const abs = r2(Math.abs(amt))
    if (!ledger) { g.movements.push({ ...t, amount: amt, abs }); return }
    if (kind === 'principal') {
      const covered = r2(allocByPrincipal[t.id] || 0)
      g.principals.push({ ...t, abs, covered, outstanding: r2(abs - covered) })
      g.principalTotal = r2(g.principalTotal + abs)
    } else {
      const allocated = r2(allocBySettlement[t.id] || 0)
      g.settlements.push({ ...t, abs, allocated, unallocated: r2(abs - allocated) })
      g.settledTotal = r2(g.settledTotal + abs)
    }
  })

  const list = Object.values(groups).map(g => {
    if (g.role === 'untagged') {
      g.net = r2(g.movements.reduce((s, m) => s + m.amount, 0)) // сальдо знакове
      g.untaggedCount = g.movements.length
      return g
    }
    g.net = r2(g.principalTotal - g.settledTotal) // >0 — борг ще відкритий
    g.openPrincipals = g.principals.filter(x => x.outstanding > EPS).length
    g.unallocatedSettlements = r2(g.settlements.reduce((s, x) => s + x.unallocated, 0))
    return g
  }).sort((a, b) => {
    // спершу з відкритим боргом, кошик «без статті» — в кінець
    if ((a.role === 'untagged') !== (b.role === 'untagged')) return a.role === 'untagged' ? 1 : -1
    return Math.abs(b.net) - Math.abs(a.net)
  })

  const totals = {
    owedByUs: r2(list.filter(g => g.role === 'borrower').reduce((s, g) => s + Math.max(0, g.net), 0)),
    owedToUs: r2(list.filter(g => g.role === 'lender').reduce((s, g) => s + Math.max(0, g.net), 0)),
    borrowedTotal: r2(list.filter(g => g.role === 'borrower').reduce((s, g) => s + g.principalTotal, 0)),
    lentTotal: r2(list.filter(g => g.role === 'lender').reduce((s, g) => s + g.principalTotal, 0)),
    untagged: list.filter(g => g.role === 'untagged').reduce((s, g) => s + g.untaggedCount, 0),
  }

  return { groups: list, totals, needsMigration, allocations: allocs }
}

// FIFO-план для одного леджера: гасимо найстаріші тіла найстарішими погашеннями.
export function fifoPlan(group) {
  if (group.role === 'untagged') return []
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

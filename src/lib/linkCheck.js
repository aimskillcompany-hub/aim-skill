// Перевірка прив'язок «платіж ↔ документ» і контрагентів операцій (2026-10-22).
// Від цих прив'язок залежать картка контрагента і «Дебіторка» (одне правило), тож вони мають бути чисті:
//   1) платіж прив'язано на більшу суму, ніж він сам;   2) документ «оплачено» більше, ніж його сума;
//   3) ЄДРПОУ з виписки ≠ ЄДРПОУ контрагента операції (операцію віднесено не тому контрагенту);
//   4) у картці контрагента ЄДРПОУ порожній / 00000000, а у виписці — справжній код.
// Лише читання; виправлення — окремими функціями нижче (кожна — після підтвердження в інтерфейсі).
import { supabase } from './supabase'
import { fetchAll, fetchAllIn } from './fetchAll'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const code = (s) => String(s ?? '').replace(/\D/g, '')
const badCode = (s) => !code(s) || /^0+$/.test(code(s))

export async function findLinkProblems(companyIds) {
  const txQ = () => {
    const q = supabase.from('bank_transactions').select('id, date, amount, counterparty, edrpou, contractor_id, direction, article, company_id').eq('is_ignored', false)
    return companyIds?.length ? q.in('company_id', companyIds) : q
  }
  const [txs, links, contractors, { data: companies }] = await Promise.all([
    fetchAll(txQ),
    fetchAll(() => supabase.from('transaction_documents').select('id, transaction_id, document_id, amount')),
    fetchAll(() => supabase.from('contractors').select('id, name, edrpou')),
    supabase.from('companies').select('edrpou, ipn'),
  ])
  const txById = new Map(txs.map(t => [t.id, t]))
  const myLinks = links.filter(l => txById.has(l.transaction_id))
  const docIds = [...new Set(myLinks.map(l => l.document_id))]
  const docs = docIds.length ? await fetchAllIn(() => supabase.from('documents').select('id, doc_number, type, amount, doc_date, contractor_id'), 'id', docIds) : []
  const docById = new Map(docs.map(d => [d.id, d]))
  const cById = new Map(contractors.map(c => [c.id, c]))
  const own = new Set((companies || []).flatMap(c => [code(c.edrpou), code(c.ipn)]).filter(Boolean))

  const view = (l) => ({ id: l.id, amount: r2(Math.abs(Number(l.amount) || 0)), tx: txById.get(l.transaction_id), doc: docById.get(l.document_id) })
  const byTx = new Map(), byDoc = new Map()
  for (const l of myLinks) {
    (byTx.get(l.transaction_id) || byTx.set(l.transaction_id, []).get(l.transaction_id)).push(view(l))
    ;(byDoc.get(l.document_id) || byDoc.set(l.document_id, []).get(l.document_id)).push(view(l))
  }
  const overTx = [], overDoc = []
  for (const [id, ls] of byTx) {
    const t = txById.get(id), total = Math.abs(Number(t.amount) || 0), linked = ls.reduce((s, l) => s + l.amount, 0)
    if (linked > total + 0.01) overTx.push({ key: 'tx:' + id, tx: t, total: r2(total), linked: r2(linked), excess: r2(linked - total), links: ls })
  }
  for (const [id, ls] of byDoc) {
    const d = docById.get(id); if (!d || d.amount == null) continue
    const total = Math.abs(Number(d.amount) || 0), linked = ls.reduce((s, l) => s + l.amount, 0)
    if (linked > total + 0.01) overDoc.push({ key: 'doc:' + id, doc: d, total: r2(total), linked: r2(linked), excess: r2(linked - total), links: ls })
  }

  // контрагент операції vs ЄДРПОУ з виписки
  const byCode = new Map()
  for (const c of contractors) if (!badCode(c.edrpou)) { const k = code(c.edrpou); if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(c) }
  const wrongContractor = [], badCard = new Map()
  for (const t of txs) {
    const k = code(t.edrpou)
    if (!k || /^0+$/.test(k) || own.has(k) || !t.contractor_id) continue
    const c = cById.get(t.contractor_id); if (!c) continue
    if (badCode(c.edrpou)) {
      const g = badCard.get(c.id) || { key: 'card:' + c.id, contractor: c, codes: new Map(), txs: [] }
      g.codes.set(k, (g.codes.get(k) || 0) + 1); g.txs.push(t); badCard.set(c.id, g)
      continue
    }
    if (code(c.edrpou) !== k) {
      wrongContractor.push({ key: 'wc:' + t.id, tx: t, current: c, match: (byCode.get(k) || [])[0] || null, links: (byTx.get(t.id) || []) })
    }
  }
  return {
    overTx: overTx.sort((a, b) => b.excess - a.excess),
    overDoc: overDoc.sort((a, b) => b.excess - a.excess),
    wrongContractor: wrongContractor.sort((a, b) => String(b.tx.date).localeCompare(String(a.tx.date))),
    badCard: [...badCard.values()].map(g => ({ ...g, codes: [...g.codes.entries()].sort((a, b) => b[1] - a[1]) })),
  }
}

// План виправлення переповнення: сума розподіляється по прив'язках у хронологічному порядку
// (для платежу — за датою документа; для документа — за датою платежу); надлишок знімається з пізніших.
export function trimPlan(problem, kind) {
  const keyDate = (l) => kind === 'tx' ? (l.doc?.doc_date || '') : (l.tx?.date || '')
  let left = problem.total
  return [...problem.links].sort((a, b) => String(keyDate(a)).localeCompare(String(keyDate(b))))
    .map(l => { const amount = r2(Math.max(0, Math.min(l.amount, left))); left = r2(left - amount); return { id: l.id, from: l.amount, to: amount, doc: l.doc, tx: l.tx } })
    .filter(x => x.to !== x.from)
}

export async function applyTrim(plan) {
  for (const x of plan) {
    const { error } = x.to <= 0.005
      ? await supabase.from('transaction_documents').delete().eq('id', x.id)
      : await supabase.from('transaction_documents').update({ amount: x.to }).eq('id', x.id)
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function unlink(linkId) {
  const { error } = await supabase.from('transaction_documents').delete().eq('id', linkId)
  return { ok: !error, error: error?.message }
}

// Перенести операцію на іншого контрагента. Прив'язки до документів старого контрагента знімаються (за згодою),
// бо інакше платіж нового контрагента «гаситиме» борг чужого.
export async function moveTxToContractor(tx, contractorId, linkIds = []) {
  for (const id of linkIds) { const r = await unlink(id); if (!r.ok) return r }
  const { error } = await supabase.from('bank_transactions').update({ contractor_id: contractorId }).eq('id', tx.id)
  return { ok: !error, error: error && (/PERIOD_CLOSED/.test(error.message) ? 'операція в закритому місяці' : error.message) }
}

export async function setContractorCode(contractorId, edrpou) {
  const { error } = await supabase.from('contractors').update({ edrpou }).eq('id', contractorId)
  return { ok: !error, error: error?.message }
}

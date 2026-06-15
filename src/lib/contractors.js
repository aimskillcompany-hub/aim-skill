// Upsert contractor — find by edrpou or name, create if not found
// Returns contractor id
export async function upsertContractor(supabase, { name, edrpou, iban, bank_name, mfo, type, default_direction, userId }) {
  if (!name?.trim()) return null
  const cleanName = name.trim()

  // Try find by edrpou first (most reliable), then by name
  let existing = null
  if (edrpou?.trim()) {
    const { data } = await supabase.from('contractors').select('id').eq('edrpou', edrpou.trim()).maybeSingle()
    existing = data
  }
  if (!existing) {
    const { data } = await supabase.from('contractors').select('id').ilike('name', cleanName).maybeSingle()
    existing = data
  }

  if (existing) {
    // Update only empty fields
    const updates = {}
    if (iban) updates.iban = iban
    if (bank_name) updates.bank_name = bank_name
    if (mfo) updates.mfo = mfo
    if (edrpou?.trim()) updates.edrpou = edrpou.trim()
    if (Object.keys(updates).length > 0) {
      await supabase.from('contractors').update(updates).eq('id', existing.id)
    }
    return existing.id
  }

  // Create new
  const { data } = await supabase.from('contractors').insert({
    name: cleanName,
    edrpou: edrpou?.trim() || null,
    iban: iban || null,
    bank_name: bank_name || null,
    mfo: mfo || null,
    type: type || (default_direction === 'Доходи' ? 'client' : default_direction === 'Витрати' ? 'supplier' : 'other'),
    default_direction: default_direction || null,
    created_by: userId || null,
  }).select('id').single()

  return data?.id || null
}

// Sync all contractor stats + IBAN via ЄДРПОУ matching
export async function syncContractorStats(supabase) {
  const [{ data: contractors }, { data: txs }, { data: bankTxs }] = await Promise.all([
    supabase.from('contractors').select('id, name, iban, edrpou'),
    supabase.from('transactions').select('id, contractor, edrpou, amount, direction, date'),
    supabase.from('bank_transactions').select('counterparty, account, matched_transaction_id'),
  ])
  if (!contractors?.length) return 0
  console.log('[Sync] Contractors:', contractors?.length, 'Transactions:', txs?.length, 'Bank txs:', bankTxs?.length)

  // Build map: transaction_id → bank account (IBAN)
  const txIdToIban = {}
  ;(bankTxs || []).forEach(b => {
    if (b.matched_transaction_id && b.account) {
      txIdToIban[b.matched_transaction_id] = b.account
    }
  })

  // Build map: edrpou → IBAN (from bank_transactions via matched transactions)
  const edrpouToIban = {}
  ;(txs || []).forEach(t => {
    if (t.edrpou && t.id && txIdToIban[t.id]) {
      edrpouToIban[t.edrpou.trim()] = txIdToIban[t.id]
    }
  })

  // Also build: contractor name → IBAN directly from bank_transactions
  const nameToIban = {}
  ;(bankTxs || []).forEach(b => {
    if (b.counterparty && b.account) {
      nameToIban[b.counterparty.trim().toLowerCase()] = b.account
    }
  })

  console.log('[Sync] ЄДРПОУ→IBAN map:', Object.keys(edrpouToIban).length, '| Name→IBAN map:', Object.keys(nameToIban).length)

  let synced = 0
  let ibanFilled = 0
  let edrpouFilled = 0
  for (const c of contractors) {
    const nameLower = c.name?.trim().toLowerCase()
    const myTxs = (txs || []).filter(t => t.contractor?.trim().toLowerCase() === nameLower)
    const income = myTxs.filter(t => t.direction === 'Доходи').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const expense = myTxs.filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const count = myTxs.length
    const lastDate = myTxs.reduce((max, t) => t.date > (max || '') ? t.date : max, null)

    const updates = {
      total_income: income,
      total_expense: expense,
      operations_count: count,
      last_operation_date: lastDate,
    }

    // Fill ЄДРПОУ from transactions
    if (!c.edrpou) {
      const txEdrpou = myTxs.find(t => t.edrpou)?.edrpou
      if (txEdrpou) { updates.edrpou = txEdrpou; edrpouFilled++ }
    }

    // Fill IBAN: try by ЄДРПОУ first, then by name
    if (!c.iban) {
      const edrpou = c.edrpou || updates.edrpou
      let foundIban = null
      if (edrpou && edrpouToIban[edrpou.trim()]) {
        foundIban = edrpouToIban[edrpou.trim()]
        console.log('[Sync]', c.name, '→ IBAN by ЄДРПОУ:', edrpou, '=', foundIban)
      } else if (nameToIban[nameLower]) {
        foundIban = nameToIban[nameLower]
        console.log('[Sync]', c.name, '→ IBAN by name match =', foundIban)
      }
      if (foundIban) { updates.iban = foundIban; ibanFilled++ }
    }

    await supabase.from('contractors').update(updates).eq('id', c.id)
    synced++
  }
  console.log('[Sync] Done:', synced, 'synced,', ibanFilled, 'IBAN filled,', edrpouFilled, 'ЄДРПОУ filled')
  return synced
}

// Import unique contractors from transactions that don't exist yet
export async function importMissingContractors(supabase, userId) {
  const [{ data: txs }, { data: existing }] = await Promise.all([
    supabase.from('transactions').select('contractor, edrpou, direction').not('contractor', 'is', null),
    supabase.from('contractors').select('name'),
  ])

  const existingNames = new Set((existing || []).map(c => c.name?.trim().toLowerCase()))
  const seen = new Set()
  let imported = 0

  for (const tx of (txs || [])) {
    const name = tx.contractor?.trim()
    if (!name || existingNames.has(name.toLowerCase()) || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())

    await supabase.from('contractors').insert({
      name,
      edrpou: tx.edrpou || null,
      type: tx.direction === 'Доходи' ? 'client' : tx.direction === 'Витрати' ? 'supplier' : 'other',
      default_direction: tx.direction || null,
      created_by: userId,
    })
    imported++
  }
  return imported
}

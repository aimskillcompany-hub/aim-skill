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

// Sync all contractor stats from transactions + IBAN from bank_transactions
export async function syncContractorStats(supabase) {
  const [{ data: contractors }, { data: txs }, { data: bankTxs }] = await Promise.all([
    supabase.from('contractors').select('id, name, iban, edrpou'),
    supabase.from('transactions').select('contractor, edrpou, amount, direction, date'),
    supabase.from('bank_transactions').select('counterparty, edrpou, account'),
  ])
  if (!contractors?.length) return 0

  let synced = 0
  for (const c of contractors) {
    const nameLower = c.name?.trim().toLowerCase()
    const myTxs = (txs || []).filter(t => t.contractor?.trim().toLowerCase() === nameLower)
    const income = myTxs.filter(t => t.direction === 'Доходи').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const expense = myTxs.filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const count = myTxs.length
    const lastDate = myTxs.reduce((max, t) => t.date > (max || '') ? t.date : max, null)

    // Find IBAN and ЄДРПОУ from bank_transactions if missing
    const bankMatch = (bankTxs || []).find(b =>
      b.counterparty?.trim().toLowerCase() === nameLower ||
      (c.edrpou && b.edrpou && b.edrpou.trim() === c.edrpou.trim())
    )

    const updates = {
      total_income: income,
      total_expense: expense,
      operations_count: count,
      last_operation_date: lastDate,
    }
    if (!c.iban && bankMatch?.account) updates.iban = bankMatch.account
    if (!c.edrpou && bankMatch?.edrpou) updates.edrpou = bankMatch.edrpou
    // Also check transactions for edrpou
    if (!c.edrpou && !bankMatch?.edrpou) {
      const txEdrpou = myTxs.find(t => t.edrpou)?.edrpou
      if (txEdrpou) updates.edrpou = txEdrpou
    }

    await supabase.from('contractors').update(updates).eq('id', c.id)
    synced++
  }
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

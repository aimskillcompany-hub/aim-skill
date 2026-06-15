// Upsert contractor — find by ЄДРПОУ (primary), then name (fallback)
export async function upsertContractor(supabase, { name, edrpou, iban, bank_name, mfo, type, default_direction, userId }) {
  if (!name?.trim()) return null
  const cleanName = name.trim()
  const cleanEdrpou = edrpou?.trim() || null

  // Find by ЄДРПОУ first (most reliable)
  let existing = null
  if (cleanEdrpou) {
    const { data } = await supabase.from('contractors').select('id').eq('edrpou', cleanEdrpou).maybeSingle()
    existing = data
  }
  // Fallback: find by exact name
  if (!existing) {
    const { data } = await supabase.from('contractors').select('id').ilike('name', cleanName).maybeSingle()
    existing = data
  }

  if (existing) {
    const updates = {}
    if (iban) updates.iban = iban
    if (bank_name) updates.bank_name = bank_name
    if (mfo) updates.mfo = mfo
    if (cleanEdrpou) updates.edrpou = cleanEdrpou
    if (Object.keys(updates).length > 0) {
      await supabase.from('contractors').update(updates).eq('id', existing.id)
    }
    return existing.id
  }

  // Create new
  const { data } = await supabase.from('contractors').insert({
    name: cleanName,
    edrpou: cleanEdrpou,
    iban: iban || null,
    bank_name: bank_name || null,
    mfo: mfo || null,
    type: type || (default_direction === 'Доходи' ? 'client' : default_direction === 'Витрати' ? 'supplier' : 'other'),
    default_direction: default_direction || null,
    created_by: userId || null,
  }).select('id').single()

  return data?.id || null
}

// ═══════════════════════════════════════════
// SYNC — all matching by ЄДРПОУ, not by name
// ═══════════════════════════════════════════
export async function syncContractorStats(supabase) {
  const [{ data: contractors }, { data: txs }, { data: bankTxs }] = await Promise.all([
    supabase.from('contractors').select('id, name, iban, edrpou'),
    supabase.from('transactions').select('id, contractor, edrpou, amount, direction, date'),
    supabase.from('bank_transactions').select('counterparty, account, matched_transaction_id'),
  ])
  if (!contractors?.length) return 0

  // ── Build ЄДРПОУ maps from transactions ──
  // edrpou → { name, txs[], iban }
  const edrpouMap = {}
  ;(txs || []).forEach(t => {
    const code = t.edrpou?.trim()
    if (!code) return
    if (!edrpouMap[code]) edrpouMap[code] = { names: new Set(), txs: [], iban: null }
    if (t.contractor) edrpouMap[code].names.add(t.contractor.trim())
    edrpouMap[code].txs.push(t)
  })

  // Add IBAN from bank_transactions via matched_transaction_id
  const txIdToEdrpou = {}
  ;(txs || []).forEach(t => {
    if (t.id && t.edrpou?.trim()) txIdToEdrpou[t.id] = t.edrpou.trim()
  })
  ;(bankTxs || []).forEach(b => {
    if (b.matched_transaction_id && b.account) {
      const code = txIdToEdrpou[b.matched_transaction_id]
      if (code && edrpouMap[code]) {
        edrpouMap[code].iban = b.account
      }
    }
  })

  // Also direct IBAN from bank_transactions by counterparty name → find edrpou
  ;(bankTxs || []).forEach(b => {
    if (!b.counterparty || !b.account) return
    // Find edrpou for this counterparty from transactions
    const tx = (txs || []).find(t =>
      t.contractor?.trim().toLowerCase() === b.counterparty.trim().toLowerCase() && t.edrpou?.trim()
    )
    if (tx) {
      const code = tx.edrpou.trim()
      if (edrpouMap[code] && !edrpouMap[code].iban) {
        edrpouMap[code].iban = b.account
      }
    }
  })

  console.log('[Sync] Contractors:', contractors.length, '| ЄДРПОУ in transactions:', Object.keys(edrpouMap).length)

  let synced = 0
  let ibanFilled = 0
  let edrpouFilled = 0
  let nameFilled = 0

  for (const c of contractors) {
    const cEdrpou = c.edrpou?.trim()
    const hasEdrpou = cEdrpou && cEdrpou.length > 3
    const hasIban = c.iban && c.iban.trim().length > 5

    // ── Step 1: If contractor has no ЄДРПОУ, try to find it by name in transactions ──
    let resolvedEdrpou = hasEdrpou ? cEdrpou : null
    if (!resolvedEdrpou) {
      const nameLower = c.name?.trim().toLowerCase()
      const txMatch = (txs || []).find(t =>
        t.edrpou?.trim() && t.contractor?.trim().toLowerCase() === nameLower
      )
      if (txMatch) {
        resolvedEdrpou = txMatch.edrpou.trim()
      }
    }

    // ── Step 2: Get all data from ЄДРПОУ map ──
    const mapData = resolvedEdrpou ? edrpouMap[resolvedEdrpou] : null

    // Stats: by ЄДРПОУ if available, otherwise by name
    let myTxs
    if (mapData) {
      myTxs = mapData.txs
    } else {
      const nameLower = c.name?.trim().toLowerCase()
      myTxs = (txs || []).filter(t => t.contractor?.trim().toLowerCase() === nameLower)
    }

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

    // Fill ЄДРПОУ
    if (!hasEdrpou && resolvedEdrpou) {
      updates.edrpou = resolvedEdrpou
      edrpouFilled++
      console.log('[Sync] ЄДРПОУ filled:', c.name, '→', resolvedEdrpou)
    }

    // Fill IBAN via ЄДРПОУ
    if (!hasIban && mapData?.iban) {
      updates.iban = mapData.iban
      ibanFilled++
      console.log('[Sync] IBAN filled:', c.name, '→', mapData.iban)
    }

    await supabase.from('contractors').update(updates).eq('id', c.id)
    synced++
  }

  console.log('[Sync] Done:', synced, 'synced |', edrpouFilled, 'ЄДРПОУ |', ibanFilled, 'IBAN')
  return synced
}

// Import contractors from transactions that don't exist yet — by ЄДРПОУ
export async function importMissingContractors(supabase, userId) {
  const [{ data: txs }, { data: existing }] = await Promise.all([
    supabase.from('transactions').select('contractor, edrpou, direction').not('contractor', 'is', null),
    supabase.from('contractors').select('name, edrpou'),
  ])

  const existingEdrpous = new Set((existing || []).filter(c => c.edrpou?.trim()).map(c => c.edrpou.trim()))
  const existingNames = new Set((existing || []).map(c => c.name?.trim().toLowerCase()))
  const seen = new Set()
  let imported = 0

  for (const tx of (txs || [])) {
    const name = tx.contractor?.trim()
    if (!name) continue

    // Skip if already exists by ЄДРПОУ or name
    const code = tx.edrpou?.trim()
    if (code && existingEdrpous.has(code)) continue
    if (existingNames.has(name.toLowerCase())) continue

    const key = code || name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    await supabase.from('contractors').insert({
      name,
      edrpou: code || null,
      type: tx.direction === 'Доходи' ? 'client' : tx.direction === 'Витрати' ? 'supplier' : 'other',
      default_direction: tx.direction || null,
      created_by: userId,
    })
    imported++
  }
  return imported
}

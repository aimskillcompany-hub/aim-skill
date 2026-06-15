// Normalize contractor name to canonical form
export function normalizeName(name) {
  if (!name) return ''
  return name
    .replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/gi, 'ТОВ')
    .replace(/ФІЗИЧНА ОСОБА[\s-]*ПІДПРИЄМЕЦЬ/gi, 'ФОП')
    .replace(/АКЦІОНЕРНЕ ТОВАРИСТВО/gi, 'АТ')
    .replace(/ПРИВАТНЕ ПІДПРИЄМСТВО/gi, 'ПП')
    .replace(/[«»""''`]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

// Upsert contractor — find by ЄДРПОУ (primary), then name (fallback)
export async function upsertContractor(supabase, { name, edrpou, iban, bank_name, mfo, type, default_direction, userId }) {
  if (!name?.trim()) return null
  const cleanName = normalizeName(name)
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
  const existingNames = new Set((existing || []).map(c => normalizeName(c.name).toLowerCase()))
  const seen = new Set()
  let imported = 0

  for (const tx of (txs || [])) {
    const name = normalizeName(tx.contractor)
    if (!name) continue

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

// Merge duplicate contractors by ЄДРПОУ — keep oldest, transfer references, delete rest
export async function mergeDuplicates(supabase) {
  const { data: all } = await supabase.from('contractors').select('*').order('created_at')
  if (!all?.length) return 0

  // Group by ЄДРПОУ
  const byCode = {}
  all.forEach(c => {
    const code = c.edrpou?.trim()
    if (!code) return
    if (!byCode[code]) byCode[code] = []
    byCode[code].push(c)
  })

  let merged = 0
  for (const [code, group] of Object.entries(byCode)) {
    if (group.length <= 1) continue

    // Keep the one with most data (most non-null fields), or oldest
    const scored = group.map(c => ({
      ...c,
      _score: [c.iban, c.bank_name, c.mfo, c.email, c.phone, c.address, c.legal_address, c.contact_person]
        .filter(v => v && v.trim()).length
    })).sort((a, b) => b._score - a._score || new Date(a.created_at) - new Date(b.created_at))

    const keep = scored[0]
    const duplicates = scored.slice(1)
    const dupIds = duplicates.map(d => d.id)

    console.log('[Merge]', code, '| keep:', keep.name, '| remove:', duplicates.map(d => d.name).join(', '))

    // Merge data from duplicates into keep (fill empty fields)
    const updates = {}
    for (const dup of duplicates) {
      for (const field of ['iban','bank_name','mfo','email','phone','address','legal_address','actual_address','contact_person','contact_position','website','city','region','postal_code','legal_form','tax_system','vat_certificate','notes']) {
        if (!keep[field] && dup[field]?.trim()) {
          updates[field] = dup[field]
          keep[field] = dup[field] // prevent overwriting from next dup
        }
      }
    }

    // Normalize the name
    if (keep.name) updates.name = normalizeName(keep.name)

    if (Object.keys(updates).length > 0) {
      await supabase.from('contractors').update(updates).eq('id', keep.id)
    }

    // Transfer contractor_id references
    for (const dupId of dupIds) {
      await supabase.from('transactions').update({ contractor_id: keep.id }).eq('contractor_id', dupId)
      await supabase.from('bank_transactions').update({ contractor_id: keep.id }).eq('contractor_id', dupId)
      await supabase.from('cash_transactions').update({ contractor_id: keep.id }).eq('contractor_id', dupId)
    }

    // Delete duplicates
    await supabase.from('contractors').delete().in('id', dupIds)
    merged += dupIds.length
  }

  console.log('[Merge] Done: removed', merged, 'duplicates')
  return merged
}

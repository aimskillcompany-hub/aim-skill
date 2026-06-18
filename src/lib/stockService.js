import { supabase } from './supabase'

// ── Маппінг типу документу → напрям складського руху ──
const DOC_TYPE_STOCK_MAP = {
  'прибуткова накладна': 'in',
  'рахунок-фактура': 'in',
  'рахунок': 'in',
  'акт прийому-передачі': 'in',
  'товарна накладна': 'in',     // incoming by default
  'повернення від клієнта': 'in',
  'видаткова накладна': 'out',
  'акт наданих послуг': 'out',
  'акт виконаних робіт': 'out',
  'повернення постачальнику': 'out',
}

// ── Нормалізація назви продукту ──
export function normalizeName(name) {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[«»""''"`]/g, '')       // прибрати лапки
    .replace(/[()[\]{},;:!?]/g, ' ')  // пунктуація → пробіл
    .replace(/[\/\\]/g, ' ')          // слеші → пробіл
    .replace(/\s+/g, ' ')             // колапс пробілів
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()                           // сортувати слова (порядок не важливий)
    .join(' ')
}

// ── Визначити напрям руху на складі ──
// docRole = головний індикатор (incoming = ми отримали = прихід, outgoing = ми видали = видача)
// docType використовується тільки як fallback коли docRole не вказаний
export function getMovementType(docType, docRole) {
  // docRole — джерело правди
  // "Видаткова накладна" від постачальника (incoming) = прихід на склад
  // "Видаткова накладна" від нас клієнту (outgoing) = видача зі складу
  if (docRole === 'outgoing') return 'out'
  if (docRole === 'incoming') return 'in'

  // Fallback на docType (тільки коли docRole не вказаний)
  if (docType) {
    const normalized = docType.toLowerCase().trim()
    if (DOC_TYPE_STOCK_MAP[normalized]) return DOC_TYPE_STOCK_MAP[normalized]
    for (const [key, direction] of Object.entries(DOC_TYPE_STOCK_MAP)) {
      if (normalized.includes(key) || key.includes(normalized)) return direction
    }
  }

  return 'in' // default = прихід
}

// ── Порівняти два нормалізовані рядки (нечітко) ──
function fuzzyMatch(a, b) {
  if (a === b) return true
  // Один містить інший (коротший ≥ 80% довшого)
  const wordsA = a.split(' ')
  const wordsB = b.split(' ')
  const longer = wordsA.length >= wordsB.length ? wordsA : wordsB
  const shorter = wordsA.length < wordsB.length ? wordsA : wordsB
  // Мінімум 3 спільних слова і ≥ 75% збіг
  const common = shorter.filter(w => longer.includes(w))
  return common.length >= 3 && common.length >= shorter.length * 0.75
}

// ── Знайти продукт по назві (НЕ створює!) — для підтвердження ──
export async function matchProduct(name) {
  if (!name?.trim()) return { matchType: 'none' }

  const normalized = normalizeName(name)
  if (!normalized) return { matchType: 'none' }

  // 1. Точний збіг по aliases
  const { data: alias } = await supabase
    .from('product_aliases')
    .select('product_id')
    .eq('normalized', normalized)
    .maybeSingle()

  if (alias?.product_id) {
    const { data: prod } = await supabase.from('products')
      .select('id, name, product_type').eq('id', alias.product_id).maybeSingle()
    if (prod) return { productId: prod.id, productName: prod.name, productType: prod.product_type, matchType: 'exact' }
  }

  // 2. Fuzzy збіг по aliases
  const { data: allAliases } = await supabase
    .from('product_aliases')
    .select('product_id, normalized')

  const fuzzyHit = (allAliases || []).find(a => fuzzyMatch(normalized, a.normalized))
  if (fuzzyHit?.product_id) {
    const { data: prod } = await supabase.from('products')
      .select('id, name, product_type').eq('id', fuzzyHit.product_id).maybeSingle()
    if (prod) return { productId: prod.id, productName: prod.name, productType: prod.product_type, matchType: 'fuzzy' }
  }

  // 3. Пошук по назві продукту
  const { data: existing } = await supabase.from('products')
    .select('id, name, product_type').eq('status', 'active')
    .ilike('name', name.trim()).maybeSingle()

  if (existing) return { productId: existing.id, productName: existing.name, productType: existing.product_type, matchType: 'fuzzy' }

  return { matchType: 'none' }
}

// ── Знайти або створити продукт по назві (через aliases) ──
export async function resolveProduct(name, unit, price, userId) {
  if (!name?.trim()) return null

  const normalized = normalizeName(name)
  if (!normalized) return null

  // 1. Точний збіг по aliases
  const { data: alias } = await supabase
    .from('product_aliases')
    .select('product_id')
    .eq('normalized', normalized)
    .maybeSingle()

  if (alias?.product_id) {
    if (price) {
      await supabase.from('products').update({ buy_price: price })
        .eq('id', alias.product_id).is('buy_price', null)
    }
    return { productId: alias.product_id, isNew: false }
  }

  // 2. Нечіткий збіг по aliases (для варіацій назви від AI)
  const { data: allAliases } = await supabase
    .from('product_aliases')
    .select('product_id, normalized')

  const fuzzyHit = (allAliases || []).find(a => fuzzyMatch(normalized, a.normalized))
  if (fuzzyHit?.product_id) {
    // Записати новий alias для цього продукту
    await supabase.from('product_aliases').upsert({
      product_id: fuzzyHit.product_id,
      alias: name.trim(),
      normalized,
    }, { onConflict: 'normalized', ignoreDuplicates: true })

    if (price) {
      await supabase.from('products').update({ buy_price: price })
        .eq('id', fuzzyHit.product_id).is('buy_price', null)
    }
    return { productId: fuzzyHit.product_id, isNew: false }
  }

  // 3. Пошук по назві продукту (fallback для старих продуктів без aliases)
  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('status', 'active')
    .ilike('name', name.trim())
    .maybeSingle()

  if (existing?.id) {
    await supabase.from('product_aliases').upsert({
      product_id: existing.id, alias: name.trim(), normalized,
    }, { onConflict: 'normalized', ignoreDuplicates: true })

    if (price) {
      await supabase.from('products').update({ buy_price: price })
        .eq('id', existing.id).is('buy_price', null)
    }
    return { productId: existing.id, isNew: false }
  }

  // 4. Створити новий продукт + alias
  const { data: newProd } = await supabase.from('products').insert({
    name: name.trim(),
    unit: unit || 'шт',
    buy_price: price || null,
    status: 'active',
    created_by: userId,
  }).select('id').single()

  if (!newProd?.id) return null

  await supabase.from('product_aliases').upsert({
    product_id: newProd.id, alias: name.trim(), normalized,
  }, { onConflict: 'normalized', ignoreDuplicates: true })

  return { productId: newProd.id, isNew: true }
}

// ── FIFO собівартість: розрахувати cost_price для OUT руху ──
export async function getFifoCost(productId, quantity) {
  if (!productId || !quantity) return null

  // Всі IN рухи по даті (FIFO)
  const { data: inMovs } = await supabase.from('stock_movements')
    .select('id, quantity, price, date')
    .eq('product_id', productId).eq('type', 'in')
    .order('date').order('created_at')

  // Всі OUT рухи з cost_price (вже розподілені)
  const { data: outMovs } = await supabase.from('stock_movements')
    .select('id, quantity, cost_price')
    .eq('product_id', productId).eq('type', 'out')
    .not('cost_price', 'is', null)

  if (!inMovs?.length) return null

  // Розрахувати скільки з кожного IN вже спожито
  const consumed = {} // inMov.id → consumed qty
  ;(inMovs || []).forEach(m => { consumed[m.id] = 0 })

  // Розподілити існуючі OUT по IN (FIFO)
  let outRemaining = (outMovs || []).map(m => ({ ...m, remaining: parseFloat(m.quantity) || 0 }))
  for (const inMov of inMovs) {
    const inQty = parseFloat(inMov.quantity) || 0
    let available = inQty
    for (const out of outRemaining) {
      if (out.remaining <= 0) continue
      const take = Math.min(available, out.remaining)
      consumed[inMov.id] += take
      out.remaining -= take
      available -= take
      if (available <= 0) break
    }
  }

  // Тепер розподілити нові quantity по залишках IN (FIFO)
  let needQty = parseFloat(quantity)
  let totalCost = 0
  let totalQty = 0

  for (const inMov of inMovs) {
    if (needQty <= 0) break
    const inQty = parseFloat(inMov.quantity) || 0
    const available = inQty - (consumed[inMov.id] || 0)
    if (available <= 0) continue

    const take = Math.min(available, needQty)
    const unitPrice = parseFloat(inMov.price) || 0
    totalCost += take * unitPrice
    totalQty += take
    needQty -= take
  }

  if (totalQty <= 0) return null
  return totalCost / totalQty // середньозважена FIFO ціна
}

// ── Створити складський рух (ідемпотентно) ──
export async function createStockMovement({
  productId, type, quantity, price, total,
  bankTransactionId, transactionItemId, date, description, userId
}) {
  if (!productId || !quantity || quantity <= 0) return null
  // Не створювати сироти без bank_transaction (крім ручних рухів)
  if (!bankTransactionId && transactionItemId) {
    console.warn('Пропущено stock_movement без bank_transaction_id для item:', transactionItemId)
    return null
  }

  // Перевірити дублікат по transaction_item_id
  if (transactionItemId) {
    const { data: existing } = await supabase
      .from('stock_movements')
      .select('id')
      .eq('transaction_item_id', transactionItemId)
      .maybeSingle()
    if (existing) return existing // вже створений
  }

  // Для OUT рухів — розрахувати FIFO собівартість
  let costPrice = null
  if (type === 'out') {
    costPrice = await getFifoCost(productId, quantity)
  }

  const { data: movement, error } = await supabase.from('stock_movements').insert({
    product_id: productId,
    type: type || 'in',
    quantity,
    price: price || null,
    total: total || null,
    cost_price: costPrice,
    bank_transaction_id: bankTransactionId || null,
    transaction_item_id: transactionItemId || null,
    date: date || new Date().toISOString().split('T')[0],
    description: description || null,
    created_by: userId,
  }).select('id').single()

  if (error) {
    if (error.code === '23505') return null
    console.warn('Stock movement error:', error.message)
    return null
  }

  return movement
}

// ── Перерахувати cost_price для всіх існуючих OUT рухів (FIFO) ──
export async function backfillCostPrices() {
  // Отримати всі продукти з OUT рухами
  const { data: products } = await supabase.from('products')
    .select('id').eq('status', 'active')

  let updated = 0, errors = 0

  for (const prod of (products || [])) {
    try {
      // Всі IN рухи (FIFO по даті)
      const { data: inMovs } = await supabase.from('stock_movements')
        .select('id, quantity, price')
        .eq('product_id', prod.id).eq('type', 'in')
        .order('date').order('created_at')

      if (!inMovs?.length) continue

      // Всі OUT рухи (по даті)
      const { data: outMovs } = await supabase.from('stock_movements')
        .select('id, quantity')
        .eq('product_id', prod.id).eq('type', 'out')
        .order('date').order('created_at')

      if (!outMovs?.length) continue

      // FIFO розподіл
      const inQueue = inMovs.map(m => ({ price: parseFloat(m.price) || 0, remaining: parseFloat(m.quantity) || 0 }))

      for (const out of outMovs) {
        let needQty = parseFloat(out.quantity) || 0
        let totalCost = 0, totalQty = 0

        for (const inItem of inQueue) {
          if (needQty <= 0) break
          if (inItem.remaining <= 0) continue
          const take = Math.min(inItem.remaining, needQty)
          totalCost += take * inItem.price
          totalQty += take
          inItem.remaining -= take
          needQty -= take
        }

        const costPrice = totalQty > 0 ? totalCost / totalQty : null
        if (costPrice !== null) {
          await supabase.from('stock_movements')
            .update({ cost_price: costPrice })
            .eq('id', out.id)
          updated++
        }
      }
    } catch (e) {
      console.warn('backfill error:', prod.id, e.message)
      errors++
    }
  }

  return { updated, errors }
}

// ── Складська збірка ──
export async function assembleProduct({ name, resultProductId, quantity, components, date, notes, userId }) {
  // 1. Створити або знайти готовий виріб
  let productId = resultProductId
  if (!productId) {
    const { data: newProd } = await supabase.from('products').insert({
      name, unit: 'шт', product_type: 'goods', status: 'active', created_by: userId,
    }).select('id').single()
    if (!newProd) return { error: 'Не вдалося створити продукт' }
    productId = newProd.id
    // Alias
    const normalized = normalizeName(name)
    if (normalized) {
      await supabase.from('product_aliases').upsert({
        product_id: productId, alias: name.trim(), normalized,
      }, { onConflict: 'normalized', ignoreDuplicates: true })
    }
  }

  // 2. Розрахувати FIFO собівартість компонентів
  let totalCost = 0
  const enrichedComponents = []
  for (const comp of components) {
    const compQty = comp.qty || comp.quantity || 0
    const costPrice = await getFifoCost(comp.productId, compQty * quantity) || comp.costPrice || 0
    const total = compQty * quantity * costPrice
    totalCost += total
    enrichedComponents.push({ ...comp, qty: compQty, costPrice, total })
  }

  // 3. Зберегти assembly
  const { data: assembly, error: aErr } = await supabase.from('assemblies').insert({
    name, result_product_id: productId, quantity,
    total_cost: totalCost, notes: notes || null,
    assembled_at: date || new Date().toISOString().split('T')[0],
    created_by: userId,
  }).select('id').single()

  if (aErr || !assembly) return { error: aErr?.message || 'Помилка збереження збірки' }

  // 4. Зберегти assembly_items
  await supabase.from('assembly_items').insert(
    enrichedComponents.map(c => ({
      assembly_id: assembly.id, product_id: c.productId,
      quantity: (c.qty || c.quantity) * quantity, cost_price: c.costPrice, total: c.total,
    }))
  )

  // 5. Списати компоненти (OUT)
  for (const c of enrichedComponents) {
    await supabase.from('stock_movements').insert({
      product_id: c.productId, type: 'out',
      quantity: (c.qty || c.quantity) * quantity, price: c.costPrice, total: c.total,
      date: date || new Date().toISOString().split('T')[0],
      description: `Збірка: ${name}`, created_by: userId,
    })
  }

  // 6. Оприбуткувати готовий виріб (IN)
  const unitCost = quantity > 0 ? totalCost / quantity : totalCost
  await supabase.from('stock_movements').insert({
    product_id: productId, type: 'in',
    quantity, price: unitCost, total: totalCost,
    date: date || new Date().toISOString().split('T')[0],
    description: `Збірка: ${name} (${enrichedComponents.length} компонентів)`,
    created_by: userId,
  })

  // Оновити buy_price готового виробу
  await supabase.from('products').update({ buy_price: unitCost }).eq('id', productId)

  return { assemblyId: assembly.id, productId, totalCost }
}

// ── Обробити всі позиції документа: resolve + movement ──
export async function processDocumentItems(savedItems, {
  docType, docRole, bankTransactionId, date, userId
}) {
  const movementType = getMovementType(docType, docRole)
  let processed = 0, created = 0, errors = []

  for (const item of savedItems) {
    if (!item.name || !item.quantity) continue
    const qty = parseFloat(item.quantity) || 0
    if (qty <= 0) continue

    try {
      // Якщо позначено як послуга — пропустити
      if (item._action === 'service') {
        processed++
        continue
      }

      // 1. Знайти або створити продукт
      let result
      if (item._matchedProductId) {
        // Підтверджений продукт з UI
        result = { productId: item._matchedProductId, isNew: false }
        // Додати alias для цієї назви
        const normalized = normalizeName(item.name)
        if (normalized) {
          await supabase.from('product_aliases').upsert({
            product_id: item._matchedProductId, alias: item.name.trim(), normalized,
          }, { onConflict: 'normalized', ignoreDuplicates: true })
        }
      } else {
        result = await resolveProduct(item.name, item.unit, item.unit_price, userId)
      }
      if (!result) {
        errors.push(`Не вдалося створити продукт: ${item.name}`)
        continue
      }

      // 2. Привʼязати item до продукту
      if (item.id) {
        await supabase.from('transaction_items')
          .update({ product_id: result.productId })
          .eq('id', item.id)
      }

      // 3. Перевірити product_type — послуги/ліцензії не потребують складського руху
      const { data: prodInfo } = await supabase.from('products')
        .select('product_type').eq('id', result.productId).maybeSingle()
      if (prodInfo?.product_type === 'service' || prodInfo?.product_type === 'expense') {
        processed++
        if (result.isNew) created++
        continue // пропустити stock_movement
      }

      // 4. Створити складський рух
      await createStockMovement({
        productId: result.productId,
        type: movementType,
        quantity: qty,
        price: item.unit_price || null,
        total: item.amount || null,
        bankTransactionId,
        transactionItemId: item.id || null,
        date,
        description: item.name,
        userId,
      })

      processed++
      if (result.isNew) created++
    } catch (e) {
      console.warn('processDocumentItems error:', item.name, e.message)
      errors.push(`${item.name}: ${e.message}`)
    }
  }

  return { processed, created, errors }
}

// ── Міграція: заповнити aliases для існуючих продуктів ──
export async function migrateProductAliases() {
  const { data: products } = await supabase
    .from('products')
    .select('id, name')
    .eq('status', 'active')

  let added = 0, skipped = 0
  for (const p of (products || [])) {
    if (!p.name) continue
    const normalized = normalizeName(p.name)
    if (!normalized) continue

    const { error } = await supabase.from('product_aliases').upsert({
      product_id: p.id,
      alias: p.name.trim(),
      normalized,
    }, { onConflict: 'normalized', ignoreDuplicates: true })

    if (error) skipped++
    else added++
  }
  return { added, skipped, total: (products || []).length }
}

// ── Обʼєднати дублікати продуктів по нормалізованій назві (з fuzzy) ──
export async function mergeProductDuplicates() {
  const { data: products } = await supabase
    .from('products')
    .select('id, name, buy_price, sell_price, category, created_at')
    .eq('status', 'active')
    .order('created_at')

  // Групувати по нормалізованій назві + fuzzy
  const groups = {}
  const groupKeys = [] // для fuzzy match
  ;(products || []).forEach(p => {
    const key = normalizeName(p.name)
    if (!key) return

    // Точний збіг
    if (groups[key]) {
      groups[key].push(p)
      return
    }

    // Fuzzy збіг з існуючою групою
    const matchKey = groupKeys.find(k => fuzzyMatch(key, k))
    if (matchKey) {
      groups[matchKey].push(p)
      return
    }

    // Нова група
    groups[key] = [p]
    groupKeys.push(key)
  })

  let merged = 0, removedMovements = 0

  for (const [, group] of Object.entries(groups)) {
    if (group.length <= 1) continue
    const keep = group[0]
    const duplicates = group.slice(1)

    for (const dup of duplicates) {
      // Перенести stock_movements
      await supabase.from('stock_movements').update({ product_id: keep.id }).eq('product_id', dup.id)
      // Перенести transaction_items
      await supabase.from('transaction_items').update({ product_id: keep.id }).eq('product_id', dup.id)
      // Перенести aliases
      await supabase.from('product_aliases').update({ product_id: keep.id }).eq('product_id', dup.id)
      // Архівувати дублікат
      await supabase.from('products').update({ status: 'archived' }).eq('id', dup.id)
      merged++
    }

    // Оновити keep з кращими даними
    const upd = {}
    if (!keep.buy_price) { const bp = group.find(p => p.buy_price); if (bp) upd.buy_price = bp.buy_price }
    if (!keep.sell_price) { const sp = group.find(p => p.sell_price); if (sp) upd.sell_price = sp.sell_price }
    if (!keep.category) { const ct = group.find(p => p.category); if (ct) upd.category = ct.category }
    if (Object.keys(upd).length > 0) await supabase.from('products').update(upd).eq('id', keep.id)
  }

  // Видалити дубльовані stock_movements (по transaction_item_id)
  const { data: allMovs } = await supabase.from('stock_movements')
    .select('id, transaction_item_id').order('id')
  const seen = new Map()
  const toDelete = []
  ;(allMovs || []).forEach(m => {
    if (!m.transaction_item_id) return
    if (seen.has(m.transaction_item_id)) toDelete.push(m.id)
    else seen.set(m.transaction_item_id, m.id)
  })
  for (let i = 0; i < toDelete.length; i += 50) {
    const chunk = toDelete.slice(i, i + 50)
    await supabase.from('stock_movements').delete().in('id', chunk)
    removedMovements += chunk.length
  }

  return { merged, removedMovements }
}

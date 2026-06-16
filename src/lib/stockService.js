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

// ── Створити складський рух (ідемпотентно) ──
export async function createStockMovement({
  productId, type, quantity, price, total,
  bankTransactionId, transactionItemId, date, description, userId
}) {
  if (!productId || !quantity || quantity <= 0) return null

  // Перевірити дублікат по transaction_item_id
  if (transactionItemId) {
    const { data: existing } = await supabase
      .from('stock_movements')
      .select('id')
      .eq('transaction_item_id', transactionItemId)
      .maybeSingle()
    if (existing) return existing // вже створений
  }

  const { data: movement, error } = await supabase.from('stock_movements').insert({
    product_id: productId,
    type: type || 'in',
    quantity,
    price: price || null,
    total: total || null,
    bank_transaction_id: bankTransactionId || null,
    transaction_item_id: transactionItemId || null,
    date: date || new Date().toISOString().split('T')[0],
    description: description || null,
    created_by: userId,
  }).select('id').single()

  if (error) {
    // Unique constraint on transaction_item_id — вже існує
    if (error.code === '23505') return null
    console.warn('Stock movement error:', error.message)
    return null
  }

  return movement
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
      // 1. Знайти або створити продукт
      const result = await resolveProduct(
        item.name, item.unit, item.unit_price, userId
      )
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

      // 3. Створити складський рух
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

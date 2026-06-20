// ── Автоматична класифікація банківських транзакцій ──
import { supabase } from './supabase'

// Кеш історії (завантажується один раз)
let historyCache = null

async function loadHistory() {
  if (historyCache) return historyCache

  const [{ data: txs }, { data: contractors }] = await Promise.all([
    supabase.from('bank_transactions')
      .select('edrpou, counterparty, direction, article, contractor_id')
      .eq('is_ignored', false)
      .not('direction', 'is', null)
      .not('article', 'is', null),
    supabase.from('contractors')
      .select('id, name, short_name, edrpou, default_direction, default_article, type')
      .eq('status', 'active'),
  ])

  // Історія по ЄДРПОУ: найчастіша пара (direction, article)
  const byEdrpou = {}
  ;(txs || []).forEach(tx => {
    const key = tx.edrpou?.trim()
    if (!key) return
    if (!byEdrpou[key]) byEdrpou[key] = {}
    const pair = `${tx.direction}|||${tx.article}`
    byEdrpou[key][pair] = (byEdrpou[key][pair] || 0) + 1
  })

  // Історія по імені контрагента
  const byName = {}
  ;(txs || []).forEach(tx => {
    const key = tx.counterparty?.trim().toLowerCase()
    if (!key) return
    if (!byName[key]) byName[key] = { contractor_id: tx.contractor_id, pairs: {} }
    const pair = `${tx.direction}|||${tx.article}`
    byName[key].pairs[pair] = (byName[key].pairs[pair] || 0) + 1
    if (tx.contractor_id) byName[key].contractor_id = tx.contractor_id
  })

  // Контрагенти по ЄДРПОУ і назві
  const contByEdrpou = {}
  const contByName = {}
  ;(contractors || []).forEach(c => {
    if (c.edrpou?.trim()) contByEdrpou[c.edrpou.trim()] = c
    contByName[c.name.toLowerCase()] = c
    if (c.short_name) contByName[c.short_name.toLowerCase()] = c
  })

  historyCache = { byEdrpou, byName, contByEdrpou, contByName }
  return historyCache
}

// Знайти найчастішу пару з обʼєкта лічильників
function topPair(pairsObj) {
  if (!pairsObj) return null
  const entries = Object.entries(pairsObj)
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1])
  const [pair, count] = entries[0]
  const [direction, article] = pair.split('|||')
  return { direction, article, count, total: entries.reduce((s, e) => s + e[1], 0) }
}

/**
 * Класифікувати одну транзакцію
 * @param {object} tx — { counterparty, description, edrpou, amount }
 * @returns {{ direction, article, contractor_id, confidence, rule }}
 */
export async function classifyTransaction(tx) {
  const h = await loadHistory()
  const edrpou = tx.edrpou?.trim()
  const name = tx.counterparty?.trim().toLowerCase()

  // ── Правило 1: ЄДРПОУ → контрагент з defaults ──
  if (edrpou && h.contByEdrpou[edrpou]) {
    const c = h.contByEdrpou[edrpou]
    if (c.default_direction && c.default_article) {
      return {
        direction: c.default_direction,
        article: c.default_article,
        contractor_id: c.id,
        confidence: 'high',
        rule: 'contractor_defaults',
      }
    }
  }

  // ── Правило 2: Історія по ЄДРПОУ ──
  if (edrpou && h.byEdrpou[edrpou]) {
    const top = topPair(h.byEdrpou[edrpou])
    if (top && top.count >= 2) {
      const c = h.contByEdrpou[edrpou]
      return {
        direction: top.direction,
        article: top.article,
        contractor_id: c?.id || null,
        confidence: top.count >= 3 ? 'high' : 'medium',
        rule: 'history_edrpou',
      }
    }
  }

  // ── Правило 3: Історія по імені контрагента ──
  if (name && h.byName[name]) {
    const entry = h.byName[name]
    const top = topPair(entry.pairs)
    if (top) {
      const c = h.contByName[name]
      return {
        direction: top.direction,
        article: top.article,
        contractor_id: c?.id || entry.contractor_id || null,
        confidence: top.count >= 3 ? 'high' : 'medium',
        rule: 'history_name',
      }
    }
  }

  // ── Правило 4: Контрагент без історії але з defaults ──
  if (name && h.contByName[name]) {
    const c = h.contByName[name]
    if (c.default_direction) {
      return {
        direction: c.default_direction,
        article: c.default_article || null,
        contractor_id: c.id,
        confidence: 'medium',
        rule: 'contractor_type',
      }
    }
  }

  // ── Правило 5: По знаку суми ──
  const direction = tx.amount > 0 ? 'Доходи' : tx.amount < 0 ? 'Витрати' : null

  // Ключові слова в описі
  const desc = (tx.description || '').toLowerCase()
  let article = null
  if (desc.includes('зарплат') || desc.includes('заробітн')) article = 'Зарплата'
  else if (desc.includes('оренд')) article = 'Оренда'
  else if (desc.includes('комісі') || desc.includes('обслуговув')) article = 'Банківські комісії'
  else if (desc.includes('пдв') || desc.includes('податк')) article = 'Податки: ПДВ'
  else if (desc.includes('єсв')) article = 'Податки: ЄСВ'
  else if (desc.includes('пдфо')) article = 'Податки: ПДФО'
  else if (desc.includes('військов')) article = 'Податки: військовий збір'
  else if (desc.includes('відсот') || desc.includes('процент')) article = 'Відсотки банку'

  return {
    direction,
    article,
    contractor_id: null,
    confidence: article ? 'low' : 'none',
    rule: article ? 'keywords' : 'amount_sign',
  }
}

/**
 * Класифікувати масив транзакцій
 */
export async function classifyBatch(transactions) {
  // Скинути кеш щоб отримати свіжі дані
  historyCache = null

  const results = []
  for (const tx of transactions) {
    const result = await classifyTransaction(tx)
    results.push({ ...tx, _auto: result })
  }
  return results
}

/**
 * Скинути кеш (після імпорту нових транзакцій)
 */
export function resetClassifyCache() {
  historyCache = null
}

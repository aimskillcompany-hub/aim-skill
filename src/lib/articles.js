import { supabase } from './supabase'

// Кеш статей щоб не робити зайвих запитів
let cache = null
let cacheTime = 0
const CACHE_TTL = 60000 // 1 хв

export async function fetchArticles() {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache
  const { data } = await supabase
    .from('articles')
    .select('*')
    .eq('is_active', true)
    .order('type')
    .order('sort_order')
  cache = data || []
  cacheTime = Date.now()
  return cache
}

export function invalidateCache() {
  cache = null
}

export function groupByType(articles) {
  return {
    expense:  articles.filter(a => a.type === 'expense'),
    income:   articles.filter(a => a.type === 'income'),
    transfer: articles.filter(a => a.type === 'transfer'),
    other:    articles.filter(a => a.type === 'other'),
  }
}

export const TYPE_LABELS = {
  expense:  'Витрати',
  income:   'Доходи',
  transfer: 'Перекази / ПФД',
  other:    'Інше',
}

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

// ── P&L ієрархія по pl_level ──
export const PL_ORDER = ['revenue', 'cogs', '_gp', 'opex', '_ebit', 'other_income', '_np', 'below_line', '_net']

export const PL_LABELS = {
  revenue:      'Виручка',
  cogs:         'Собівартість (COGS)',
  _gp:          'Валовий прибуток (GP)',
  opex:         'Операційні витрати (OpEx)',
  _ebit:        'Операційний прибуток (EBIT)',
  other_income: 'Інші доходи / витрати',
  _np:          'Чистий прибуток (до податків)',
  below_line:   'Податки та обовʼязкові платежі',
  _net:         'Чистий прибуток (Net)',
}

// Знак секції: revenue додатній, cogs/opex/below_line від'ємний
export const PL_SIGN = {
  revenue: +1,
  cogs: -1,
  opex: -1,
  other_income: +1, // може бути і + і -, direction визначає
  below_line: -1,
}

export function groupByPlLevel(articles) {
  const result = {}
  PL_ORDER.filter(k => !k.startsWith('_')).forEach(level => { result[level] = [] })
  articles.forEach(a => {
    const level = a.pl_level || 'none'
    if (result[level]) result[level].push(a)
  })
  return result
}

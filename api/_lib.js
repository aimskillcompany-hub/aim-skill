// Спільні серверні утиліти для api/*.js (адмін-клієнт, перевірка користувача, номер замовлення).
// Файли з префіксом "_" Vercel НЕ вважає роутами.
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

// Адмін-клієнт (service-role) — обходить RLS, для серверних операцій без юзера.
export function getAdmin() {
  if (!URL || !SERVICE) throw new Error('Supabase service env не налаштовано (VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY)')
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Атомна генерація номера замовлення. RPC next_order_number() (послідовність у БД,
// міграція 031) — стійка до гонок і видалень. Фолбек — max+1 (не count+1), поки
// міграцію не запущено. admin = service-role клієнт (getAdmin()).
export async function nextOrderNumber(admin) {
  const { data, error } = await admin.rpc('next_order_number')
  if (!error && data) return data
  const { data: rows } = await admin.from('orders').select('order_number')
  const max = (rows || []).reduce((m, r) => {
    const n = parseInt(String(r.order_number || '').replace(/\D/g, ''), 10)
    return isNaN(n) ? m : Math.max(m, n)
  }, 0)
  return String(max + 1).padStart(4, '0')
}

// Перевірка JWT користувача з заголовка Authorization: Bearer <access_token>.
// Повертає user або null.
export async function verifyUser(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || !URL || !ANON) return null
  try {
    const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.getUser(token)
    if (error) return null
    return data?.user || null
  } catch { return null }
}

// Створення користувача адміністратором (самореєстрація вимкнена).
// Лише admin: перевіряємо роль викликача, тоді через service-role створюємо акаунт
// з підтвердженим email і проставляємо роль у profiles.
import { getAdmin, verifyUser } from './_lib.js'

const VALID_ROLES = ['admin', 'accountant', 'manager', 'viewer']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const caller = await verifyUser(req)
  if (!caller) return res.status(401).json({ error: 'Потрібна авторизація' })

  const admin = getAdmin()
  // Лише адміністратор може додавати користувачів
  const { data: me } = await admin.from('profiles').select('role').eq('id', caller.id).single()
  if (me?.role !== 'admin') return res.status(403).json({ error: 'Лише адміністратор може додавати користувачів' })

  const { email, password, full_name, role } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Вкажіть email і пароль' })
  if (String(password).length < 6) return res.status(400).json({ error: 'Пароль — мінімум 6 символів' })
  const r = VALID_ROLES.includes(role) ? role : 'viewer'
  const name = (full_name || '').trim() || String(email).split('@')[0]

  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name },
  })
  if (error) return res.status(400).json({ error: error.message })

  const id = created?.user?.id
  // Профіль створює тригер handle_new_user; upsert проставляє роль/ім'я (і як фолбек, якщо тригера нема)
  if (id) await admin.from('profiles').upsert({ id, email, full_name: name, role: r })
  return res.status(200).json({ ok: true, id })
}

import { supabase } from './supabase'

// Логування змін для аудит-трейлу
// Таблиця: audit_log (entity_type, entity_id, action, changes, user_id, created_at)

let _tableExists = null

async function checkTable() {
  if (_tableExists !== null) return _tableExists
  const { error } = await supabase.from('audit_log').select('id').limit(0)
  _tableExists = !error
  return _tableExists
}

export async function logAction(entityType, entityId, action, changes = null, userId = null) {
  if (!await checkTable()) return // таблиця ще не створена — тихо пропускаємо
  try {
    await supabase.from('audit_log').insert({
      entity_type: entityType,     // 'bank_transaction', 'product', 'contractor', etc.
      entity_id: String(entityId),
      action,                      // 'create', 'update', 'delete', 'validate', 'merge', 'ignore'
      changes: changes ? JSON.stringify(changes) : null,
      user_id: userId,
    })
  } catch {} // не блокуємо основну операцію при помилці логування
}

export async function getAuditLog(entityType, entityId, limit = 50) {
  if (!await checkTable()) return []
  const { data } = await supabase.from('audit_log')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', String(entityId))
    .order('created_at', { ascending: false })
    .limit(limit)
  return data || []
}

export async function getRecentActivity(limit = 100) {
  if (!await checkTable()) return []
  const { data } = await supabase.from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data || []
}

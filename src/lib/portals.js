// Портали постачальників (міграція 107): посилання, логін, примітка — у таблиці; пароль — лише в Supabase Vault.
// Пароль видає portal_get_password (усі ролі, крім «перегляду»; кожен перегляд — у журнал), записує portal_set_password.
import { supabase } from './supabase'

const missing = (e) => /supplier_portals|portal_get_password|portal_set_password|schema cache/.test(e?.message || '')
const err = (e) => new Error(missing(e) ? 'Потрібна міграція 107 (портали постачальників)' : /PORTAL_FORBIDDEN/.test(e?.message || '') ? 'Немає доступу до паролів' : e.message)

export async function loadPortals(contractorId = null) {
  let q = supabase.from('supplier_portals').select('id, contractor_id, title, url, login, note, has_password, updated_at, contractors(name)').order('title')
  if (contractorId) q = q.eq('contractor_id', contractorId)
  const { data, error } = await q
  if (error) throw err(error)
  return data || []
}

export async function savePortal({ id, contractor_id, title, url, login, note }, password, userId) {
  const row = { contractor_id: contractor_id || null, title: title.trim(), url: normUrl(url), login: login?.trim() || null, note: note?.trim() || null }
  let pid = id
  if (id) { const { error } = await supabase.from('supplier_portals').update(row).eq('id', id); if (error) throw err(error) }
  else { const { data, error } = await supabase.from('supplier_portals').insert({ ...row, created_by: userId || null }).select('id').single(); if (error) throw err(error); pid = data.id }
  // undefined — пароль не чіпаємо; '' — прибрати; рядок — записати
  if (password !== undefined) { const { error } = await supabase.rpc('portal_set_password', { p_portal: pid, p_password: password }); if (error) throw err(error) }
  return pid
}

export async function deletePortal(id) {
  const { error } = await supabase.from('supplier_portals').delete().eq('id', id)
  if (error) throw err(error)
}

export async function getPortalPassword(id) {
  const { data, error } = await supabase.rpc('portal_get_password', { p_portal: id })
  if (error) throw err(error)
  return data || ''
}

export function normUrl(u) {
  const t = String(u || '').trim()
  if (!t) return t
  return /^https?:\/\//i.test(t) ? t : 'https://' + t
}

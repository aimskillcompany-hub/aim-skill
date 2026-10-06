// Протоколи нарад — групові (не per company). Рішення у decisions (jsonb).
import { supabase } from './supabase'

export async function listMinutes() {
  const { data, error } = await supabase.from('meeting_minutes')
    .select('id, meeting_date, title, participants, notes, decisions, created_at, updated_at')
    .order('meeting_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createMinute({ meeting_date, title, participants, notes, decisions, userId }) {
  const { data, error } = await supabase.from('meeting_minutes').insert({
    meeting_date, title: title.trim(), participants: participants || null,
    notes: notes || null, decisions: decisions || [], created_by: userId || null,
  }).select('id').single()
  if (error) throw error
  return data.id
}

export async function updateMinute(id, { meeting_date, title, participants, notes, decisions }) {
  const { error } = await supabase.from('meeting_minutes').update({
    meeting_date, title: title.trim(), participants: participants || null,
    notes: notes || null, decisions: decisions || [], updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
}

export async function deleteMinute(id) {
  const { error } = await supabase.from('meeting_minutes').delete().eq('id', id)
  if (error) throw error
}

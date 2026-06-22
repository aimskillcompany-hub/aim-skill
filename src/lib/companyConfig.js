// Реквізити нашої компанії
// Зберігаються в Supabase (profiles.settings) з fallback на localStorage
import { supabase } from './supabase'

const DEFAULTS = {
  name: 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ "ЕЙМ СКІЛ"',
  shortName: 'ТОВ "ЕЙМ СКІЛ"',
  edrpou: '45505924',
  ipn: '455059226514',
  address: 'Україна, 04052, місто Київ, вул. Глибочицька, будинок 72, офіс 320/1',
  iban: 'UA353220010000026009700001305',
  bankName: 'ПУБЛІЧНЕ АКЦІОНЕРНЕ ТОВАРИСТВО "УНІВЕРСАЛ БАНК"',
  mfo: '322001',
  phone: '+380737007758',
  email: 'office@aim-skill.com.ua',
  director: 'Редько Дмитро Вікторович',
  directorPosition: 'Директор',
  isVatPayer: false,
}

const STORAGE_KEY = 'company_config'
let _cached = null

function loadLocal() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return { ...DEFAULTS, ...JSON.parse(saved) }
  } catch {}
  return { ...DEFAULTS }
}

export let COMPANY = loadLocal()

export async function getCompany() {
  if (_cached) return _cached
  // Try Supabase first
  try {
    const { data: user } = await supabase.auth.getUser()
    if (user?.user?.id) {
      const { data } = await supabase.from('profiles')
        .select('settings').eq('id', user.user.id).maybeSingle()
      if (data?.settings?.company) {
        _cached = { ...DEFAULTS, ...data.settings.company }
        COMPANY = _cached
        // Sync to localStorage as backup
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_cached))
        return _cached
      }
    }
  } catch {}
  // Fallback to localStorage
  _cached = loadLocal()
  return _cached
}

export async function saveCompany(data) {
  const merged = { ...DEFAULTS, ...data }
  // Save to localStorage immediately
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  COMPANY = merged
  _cached = merged
  // Try to save to Supabase
  try {
    const { data: user } = await supabase.auth.getUser()
    if (user?.user?.id) {
      const { data: profile } = await supabase.from('profiles')
        .select('settings').eq('id', user.user.id).maybeSingle()
      const settings = { ...(profile?.settings || {}), company: merged }
      await supabase.from('profiles').update({ settings }).eq('id', user.user.id)
    }
  } catch {}
  return merged
}

export const COMPANY_FIELDS = [
  { key: 'name', label: 'Повна назва', full: true },
  { key: 'shortName', label: 'Коротка назва' },
  { key: 'edrpou', label: 'ЄДРПОУ' },
  { key: 'ipn', label: 'ІПН' },
  { key: 'address', label: 'Адреса', full: true },
  { key: 'iban', label: 'IBAN', full: true },
  { key: 'bankName', label: 'Банк' },
  { key: 'mfo', label: 'МФО' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
  { key: 'director', label: 'Директор (ПІБ)' },
  { key: 'directorPosition', label: 'Посада директора' },
]

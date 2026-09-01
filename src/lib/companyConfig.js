// Реквізити нашої компанії.
// Мультикомпанійність: getCompany() повертає реквізити АКТИВНОЇ компанії
// з таблиці companies (за companyScope). Fallback — стара конфігурація
// (profiles.settings / localStorage), якщо активної компанії ще нема.
import { supabase } from './supabase'
import { getActiveCompanyId } from './companyScope'

// Рядок таблиці companies (snake_case) → форма реквізитів для docgen (camelCase).
function mapRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    shortName: row.short_name || '',
    edrpou: row.edrpou || '',
    ipn: row.ipn || '',
    address: row.address || '',
    iban: row.iban || '',
    bankName: row.bank_name || '',
    mfo: row.mfo || '',
    phone: row.phone || '',
    email: row.email || '',
    director: row.director || '',
    directorPosition: row.director_position || 'Директор',
    isVatPayer: !!row.is_vat_payer,
    isFop: !!row.is_fop,
    taxGroup: row.tax_group || 'tov_vat',
    logoBase64: row.logo_base64 || null,
    docTheme: row.doc_theme || null, // тема документів (clean|bit|aim), null=авто
    // AiM-брендинг документів — лише для ЕЙМ СКІЛ (за ЄДРПОУ / фіксованим id).
    isAim: row.edrpou === '45505924' || row.id === '00000000-0000-0000-0000-000000000001',
  }
}

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
let _cachedId = null // id активної компанії, для якої закешовано _cached

// Скинути кеш реквізитів (при перемиканні/редагуванні компанії).
export function clearCompanyCache() { _cached = null; _cachedId = null }

export async function getCompany() {
  const activeId = getActiveCompanyId()
  // Мультикомпанійність: реквізити активної компанії з таблиці companies.
  if (activeId) {
    if (_cached && _cachedId === activeId) return _cached
    try {
      const { data } = await supabase.from('companies').select('*').eq('id', activeId).maybeSingle()
      if (data) { _cached = mapRow(data); _cachedId = activeId; COMPANY = _cached; return _cached }
    } catch {}
  }
  // Fallback (стара однокомпанійна конфігурація) — до застосування мультикомпанійності.
  if (_cached && _cachedId === null) return _cached
  try {
    const { data: user } = await supabase.auth.getUser()
    if (user?.user?.id) {
      const { data } = await supabase.from('profiles')
        .select('settings').eq('id', user.user.id).maybeSingle()
      if (data?.settings?.company) {
        _cached = { ...DEFAULTS, ...data.settings.company }; _cachedId = null
        COMPANY = _cached
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_cached))
        return _cached
      }
    }
  } catch {}
  _cached = loadLocal(); _cachedId = null
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

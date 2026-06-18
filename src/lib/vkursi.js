// ── Vkursi API інтеграція ──
// Документація: https://github.com/vkursi-pro/API

const BASE = 'https://vkursi-api.azurewebsites.net/api/1.0'

let cachedToken = null
let tokenExpiry = 0

// ── Авторизація ──
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const email = localStorage.getItem('vkursi_email')
  const password = localStorage.getItem('vkursi_password')
  if (!email || !password) throw new Error('Вкурсі: не налаштовано логін/пароль')

  const res = await fetch(`${BASE}/token/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) throw new Error(`Vkursi auth error: ${res.status}`)
  const data = await res.json()

  if (!data.token && typeof data === 'string') {
    cachedToken = data
  } else {
    cachedToken = data.token || data
  }
  tokenExpiry = Date.now() + 55 * 60 * 1000 // 55 хвилин
  return cachedToken
}

// ── Отримати дані по ЄДРПОУ ──
export async function fetchByEdrpou(edrpou) {
  if (!edrpou?.trim()) throw new Error('ЄДРПОУ не вказано')
  const code = edrpou.trim()
  const token = await getToken()

  const res = await fetch(`${BASE}/organizations/getadvancedorganization`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ Code: code }),
  })

  if (!res.ok) {
    if (res.status === 401) {
      cachedToken = null
      throw new Error('Vkursi: токен протермінований, спробуйте ще раз')
    }
    throw new Error(`Vkursi error: ${res.status}`)
  }

  const raw = await res.json()
  return parseResponse(raw)
}

// ── Парсинг відповіді в формат contractors ──
function parseResponse(raw) {
  const d = raw.data || raw

  // Контакти
  const contacts = d.contacts || {}
  const phones = contacts.phones || contacts.phone || []
  const phone = Array.isArray(phones) ? phones[0] : phones
  const phone2 = Array.isArray(phones) && phones.length > 1 ? phones[1] : null
  const email = contacts.email || contacts.Email || null
  const website = contacts.website || contacts.web_site || null

  // Адреса
  const address = d.address || null

  // Директор
  const heads = d.heads || []
  const director = heads.length > 0 ? heads[0] : null

  // Засновники
  const founders = d.founders || []

  // КВЕДи
  const activities = d.activity_kinds || d.activities || []
  const primaryActivity = activities.find(a => a.is_primary || a.isPrimary) || activities[0]

  // ПДВ
  const registrations = d.registrations || []
  const vatReg = registrations.find(r =>
    (r.name || '').toLowerCase().includes('пдв') ||
    (r.description || '').toLowerCase().includes('пдв')
  )
  const isVatPayer = !!vatReg || d.isVatPayer || false

  // Статутний капітал
  const capital = d.authorised_capital || {}

  return {
    // Основні
    name: d.name || null,
    short_name: d.short || d.short_name || null,
    edrpou: d.code || d.edrpou || null,
    legal_form: d.olf_name || null,

    // Контакти
    phone: phone || null,
    phone2: phone2 || null,
    email: email || null,
    website: website || null,

    // Адреси
    address: address || null,
    legal_address: address || null,

    // ПДВ
    is_vat_payer: isVatPayer,
    ipn: d.inn || d.ipn || null,

    // Додатково (для відображення)
    _director: director ? (director.name || director.full_name) : null,
    _directorRole: director ? (director.role || director.position) : null,
    _founders: founders.map(f => f.name || f.full_name).filter(Boolean),
    _primaryActivity: primaryActivity ? `${primaryActivity.code || ''} ${primaryActivity.name || ''}`.trim() : null,
    _capital: capital.value || capital.amount || null,
    _registrationDate: d.registration?.date || null,
    _state: d.state_text || d.state || null,
  }
}

// ── Налаштування ──
export function getVkursiCredentials() {
  return {
    email: localStorage.getItem('vkursi_email') || '',
    password: localStorage.getItem('vkursi_password') || '',
  }
}

export function setVkursiCredentials(email, password) {
  localStorage.setItem('vkursi_email', email)
  localStorage.setItem('vkursi_password', password)
  cachedToken = null
}

export function isVkursiConfigured() {
  return !!(localStorage.getItem('vkursi_email') && localStorage.getItem('vkursi_password'))
}

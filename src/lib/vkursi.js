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

  // Судова аналітика
  const court = d.courtAnalytic || {}
  const courtCount = court.count || court.totalCount || court.total || 0

  // Виконавчі провадження
  const enforcements = d.open_enforcements || []

  // Express Score
  const score = d.expressScore || null

  // Поштовий індекс, місто, область з адреси
  const parts = d.parts || {}
  const postalCode = parts.zip || parts.postal_code || null
  const city = parts.city || parts.settlement || null
  const region = parts.region || parts.area || null

  // Засновники як рядок
  const foundersStr = founders
    .map(f => {
      const name = f.name || f.full_name || ''
      const role = f.role || ''
      const capital_part = f.capital ? ` (${f.capital})` : ''
      return `${name}${role ? ' — ' + role : ''}${capital_part}`
    })
    .filter(Boolean)
    .join('; ')

  // КВЕДи
  const allKveds = activities
    .map(a => `${a.code || ''} ${a.name || ''}`.trim())
    .filter(Boolean)

  return {
    // Основні — зберігаються в contractors
    name: d.name || null,
    short_name: d.short || d.short_name || null,
    edrpou: d.code || d.edrpou || null,
    ipn: d.inn || d.ipn || null,
    legal_form: d.olf_name || null,
    state: d.state_text || (d.state === 1 ? 'Зареєстровано' : d.state_text) || null,
    registration_date: d.registration?.date || null,

    // Контакти
    phone: phone || null,
    phone2: phone2 || null,
    email: email || null,
    website: website || null,

    // Адреси
    address: address || null,
    legal_address: address || null,
    city: city || null,
    region: region || null,
    postal_code: postalCode || null,

    // ПДВ
    is_vat_payer: isVatPayer,

    // Керівництво
    director: director ? (director.name || director.full_name) : null,
    director_position: director ? (director.role || director.position) : null,
    contact_person: director ? (director.name || director.full_name) : null,
    contact_position: director ? (director.role || director.position) : null,

    // Засновники
    founders: foundersStr || null,

    // КВЕД
    primary_kved: primaryActivity ? `${primaryActivity.code || ''} ${primaryActivity.name || ''}`.trim() : null,

    // Фінанси
    capital: capital.value || capital.amount || null,

    // Ризики
    court_cases_count: courtCount || null,
    enforcement_count: enforcements.length || null,
    express_score: score,

    // Сирі дані для майбутнього використання
    vkursi_data: {
      heads: heads.map(h => ({ name: h.name || h.full_name, role: h.role || h.position, date: h.date })),
      founders: founders.map(f => ({ name: f.name || f.full_name, role: f.role, capital: f.capital })),
      kveds: allKveds,
      branches: (d.branches || []).map(b => b.name || b.address).filter(Boolean),
      registrations: registrations.map(r => ({ name: r.name, date: r.date })),
      bankruptcy: d.bankruptcy || null,
      termination: d.termination || null,
    },
    vkursi_updated_at: new Date().toISOString(),
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

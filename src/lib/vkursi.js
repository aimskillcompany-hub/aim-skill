// ── Vkursi API інтеграція ──
// Документація: https://github.com/vkursi-pro/API
// Запити йдуть через /api/vkursi (Vercel serverless) щоб обійти CORS

const PROXY = '/api/vkursi'

let cachedToken = null
let tokenExpiry = 0

// ── Авторизація ──
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const email = localStorage.getItem('vkursi_email')
  const password = localStorage.getItem('vkursi_password')
  if (!email || !password) throw new Error('Вкурсі: не налаштовано логін/пароль')

  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'authorize', email, password }),
  })

  if (!res.ok) throw new Error(`Vkursi auth error: ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)

  cachedToken = data.token
  tokenExpiry = Date.now() + 55 * 60 * 1000 // 55 хвилин
  return cachedToken
}

// ── Отримати дані по ЄДРПОУ ──
// 1. Vkursi (якщо налаштовано і є кредити)
// 2. Безкоштовний ЄДР як fallback
export async function fetchByEdrpou(edrpou) {
  if (!edrpou?.trim()) throw new Error('ЄДРПОУ не вказано')
  const code = edrpou.trim()

  // Спробувати Vkursi якщо налаштовано
  if (isVkursiConfigured()) {
    try {
      const token = await getToken()
      const res = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getorganization', token, code }),
      })
      if (res.ok) {
        const raw = await res.json()
        if (!raw.error) {
          if (raw.source === 'advanced') return parseAdvancedResponse(raw.data)
          return parseBasicResponse(raw.data)
        }
      }
    } catch (e) {
      console.warn('Vkursi failed, falling back to EDR:', e.message)
    }
  }

  // Fallback — безкоштовний ЄДР
  return fetchFromEdr(code)
}

// ── Пошук через API податкової (cabinet.tax.gov.ua) ──
async function fetchFromEdr(code) {
  const taxToken = localStorage.getItem('tax_api_token') || ''
  const res = await fetch('/api/edr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, token: taxToken }),
  })

  if (!res.ok) throw new Error(`ЄДР error: ${res.status}`)
  const raw = await res.json()
  if (raw.error) throw new Error(raw.error)

  return parseEdrResponse(raw.data, raw.source)
}

// ── Парсинг відповіді від ЄДР ──
function parseEdrResponse(d, source) {
  return {
    _source: source || 'edr',
    name: d.name || d.full_name || d.officialName || null,
    short_name: d.short_name || d.shortName || null,
    edrpou: d.edrpou || d.code || null,
    ipn: d.inn || d.ipn || null,
    state: d.state || d.status || null,
    director: d.director || d.head || d.ceo || null,
    contact_person: d.director || d.head || d.ceo || null,
    legal_address: d.address || d.location || null,
    address: d.address || d.location || null,
    primary_kved: d.kved || d.activity || d.primaryActivity || null,
    registration_date: d.registration_date || d.registrationDate || null,
    // Поля недоступні в безкоштовному ЄДР
    phone: null, phone2: null, email: null, website: null,
    city: null, region: null, postal_code: null,
    legal_form: null, is_vat_payer: false,
    founders: null, capital: null,
    director_position: null, contact_position: null,
    court_cases_count: null, enforcement_count: null,
    express_score: null,
    vkursi_data: null,
    vkursi_updated_at: new Date().toISOString(),
  }
}

// ── Парсинг ADVANCED відповіді (повні дані) ──
function parseAdvancedResponse(d) {
  const contacts = d.contacts || {}
  const phones = contacts.phones || contacts.phone || []
  const phone = Array.isArray(phones) ? phones[0] : phones
  const phone2 = Array.isArray(phones) && phones.length > 1 ? phones[1] : null
  const email = contacts.email || contacts.Email || null
  const website = contacts.website || contacts.web_site || null
  const address = d.address || null
  const heads = d.heads || []
  const director = heads.length > 0 ? heads[0] : null
  const founders = d.founders || []
  const activities = d.activity_kinds || d.activities || []
  const primaryActivity = activities.find(a => a.is_primary || a.isPrimary) || activities[0]
  const registrations = d.registrations || []
  const vatReg = registrations.find(r =>
    (r.name || '').toLowerCase().includes('пдв') ||
    (r.description || '').toLowerCase().includes('пдв')
  )
  const isVatPayer = !!vatReg || d.isVatPayer || false
  const capital = d.authorised_capital || {}
  const court = d.courtAnalytic || {}
  const courtCount = court.count || court.totalCount || court.total || 0
  const enforcements = d.open_enforcements || []
  const score = d.expressScore || null
  const parts = d.parts || {}

  const foundersStr = founders
    .map(f => {
      const name = f.name || f.full_name || ''
      const role = f.role || ''
      const cp = f.capital ? ` (${f.capital})` : ''
      return `${name}${role ? ' — ' + role : ''}${cp}`
    })
    .filter(Boolean).join('; ')

  const allKveds = activities.map(a => `${a.code || ''} ${a.name || ''}`.trim()).filter(Boolean)

  return {
    _source: 'advanced',
    name: d.name || null,
    short_name: d.short || d.short_name || null,
    edrpou: d.code || d.edrpou || null,
    ipn: d.inn || d.ipn || null,
    legal_form: d.olf_name || null,
    state: d.state_text || (d.state === 1 ? 'Зареєстровано' : d.state_text) || null,
    registration_date: d.registration?.date || null,
    phone: phone || null,
    phone2: phone2 || null,
    email: email || null,
    website: website || null,
    address: address || null,
    legal_address: address || null,
    city: parts.city || parts.settlement || null,
    region: parts.region || parts.area || null,
    postal_code: parts.zip || parts.postal_code || null,
    is_vat_payer: isVatPayer,
    director: director ? (director.name || director.full_name) : null,
    director_position: director ? (director.role || director.position) : null,
    contact_person: director ? (director.name || director.full_name) : null,
    contact_position: director ? (director.role || director.position) : null,
    founders: foundersStr || null,
    primary_kved: primaryActivity ? `${primaryActivity.code || ''} ${primaryActivity.name || ''}`.trim() : null,
    capital: capital.value || capital.amount || null,
    court_cases_count: courtCount || null,
    enforcement_count: enforcements.length || null,
    express_score: score,
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

// ── Парсинг BASIC відповіді (getorganizations — менше полів) ──
function parseBasicResponse(d) {
  // Єдиний податок
  const stp = d.singleTaxPayer || d.SingleTaxPayer || {}
  const isVatPayer = !!(d.DateRegInn || d.dateRegInn) && !(d.DateCanceledInn || d.dateCanceledInn)
  const taxGroup = stp.group || stp.Group
  const taxSystem = taxGroup ? `Спрощена гр.${taxGroup}` : (isVatPayer ? 'Загальна' : null)

  return {
    _source: 'basic',
    name: d.Name || d.name || null,
    short_name: d.ShortName || d.shortName || null,
    edrpou: d.Edrpou || d.edrpou || null,
    ipn: d.Inn || d.inn || null,
    state: d.State || d.state || null,
    is_vat_payer: isVatPayer,
    tax_system: taxSystem,
    director: d.ChiefName || d.chiefName || null,
    contact_person: d.ChiefName || d.chiefName || null,
    enforcement_count: d.Introduction || d.introduction || null,
    express_score: d.ExpressScore || d.expressScore || null,
    primary_kved: stp.kindOfActivity || stp.KindOfActivity || null,
    // Ці поля недоступні в basic
    phone: null, phone2: null, email: null, website: null,
    address: null, legal_address: null, city: null, region: null, postal_code: null,
    founders: null, capital: null, court_cases_count: null,
    legal_form: null, registration_date: null,
    director_position: null, contact_position: null,
    vkursi_data: {
      hasBorg: d.HasBorg ?? d.hasBorg ?? null,
      inSanctions: d.InSanctions ?? d.inSanctions ?? null,
      singleTaxPayer: stp,
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

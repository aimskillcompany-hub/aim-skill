// Реквізити нашої компанії
// Зберігаються в localStorage, редагуються в Налаштування → Реквізити

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

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return { ...DEFAULTS, ...JSON.parse(saved) }
  } catch {}
  return { ...DEFAULTS }
}

export let COMPANY = load()

export function getCompany() {
  return load()
}

export function saveCompany(data) {
  const merged = { ...DEFAULTS, ...data }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  COMPANY = merged
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

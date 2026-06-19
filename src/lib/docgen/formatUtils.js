// ── Утиліти форматування для документів ──

const fmt = n => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)

export function formatMoney(n) { return fmt(n) }
export function formatDate(d) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
export function formatDateLong(d) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Сума прописом (українською) ──
const ONES = ['', 'одна', 'дві', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"]
const ONES_M = ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"]
const TEENS = ['десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', "п'ятнадцять",
  'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять"]
const TENS = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"]
const HUNDREDS = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"]

function threeDigits(n, feminine) {
  const ones = feminine ? ONES : ONES_M
  const parts = []
  const h = Math.floor(n / 100)
  const t = Math.floor((n % 100) / 10)
  const o = n % 10
  if (h > 0) parts.push(HUNDREDS[h])
  if (t === 1) { parts.push(TEENS[o]); return parts.join(' ') }
  if (t > 1) parts.push(TENS[t])
  if (o > 0) parts.push(ones[o])
  return parts.join(' ')
}

function declension(n, one, two, five) {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs >= 11 && abs <= 19) return five
  if (last === 1) return one
  if (last >= 2 && last <= 4) return two
  return five
}

export function amountInWords(amount) {
  if (!amount || amount === 0) return 'нуль гривень 00 копійок'

  const abs = Math.abs(amount)
  const hrn = Math.floor(abs)
  const kop = Math.round((abs - hrn) * 100)

  const parts = []

  if (hrn === 0) {
    parts.push('нуль')
  } else {
    const millions = Math.floor(hrn / 1000000)
    const thousands = Math.floor((hrn % 1000000) / 1000)
    const rest = hrn % 1000

    if (millions > 0) {
      parts.push(threeDigits(millions, false))
      parts.push(declension(millions, 'мільйон', 'мільйони', 'мільйонів'))
    }
    if (thousands > 0) {
      parts.push(threeDigits(thousands, true))
      parts.push(declension(thousands, 'тисяча', 'тисячі', 'тисяч'))
    }
    if (rest > 0) {
      parts.push(threeDigits(rest, true))
    }
  }

  const hrnWord = declension(hrn, 'гривня', 'гривні', 'гривень')
  const kopStr = String(kop).padStart(2, '0')
  const kopWord = declension(kop, 'копійка', 'копійки', 'копійок')

  let result = parts.join(' ') + ' ' + hrnWord + ' ' + kopStr + ' ' + kopWord
  return result.charAt(0).toUpperCase() + result.slice(1)
}

// ── Розрахунок підсумків ──
export function calcTotals(items) {
  let subtotal = 0
  let vatAmount = 0
  const vatByRate = {} // { '20': 1234.56, '7': 100.00 }
  for (const item of items) {
    const amount = parseFloat(item.amount) || (parseFloat(item.quantity || 0) * parseFloat(item.unitPrice || 0))
    const vatRate = parseFloat(item.vatRate) || 0
    const vat = vatRate > 0 ? amount * vatRate / 100 : 0
    subtotal += amount
    vatAmount += vat
    if (vatRate > 0) {
      const key = String(vatRate)
      vatByRate[key] = (vatByRate[key] || 0) + vat
    }
  }
  return { subtotal, vatAmount, total: subtotal + vatAmount, vatByRate }
}

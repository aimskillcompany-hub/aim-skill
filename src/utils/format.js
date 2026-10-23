// Форматування для дизайн-системи: гроші й дати в одному стилі на всіх сторінках.
// Київський час: дата «сьогодні / завтра / вчора» рахується за Europe/Kyiv, а не за часовим поясом браузера.

// ТЗ редизайну, розділ 2: роздільник тисяч — вузький нерозривний пробіл (U+202F), мінус — «−» (U+2212),
// цифри — tabular-nums (у CSS). Знак ніколи не губиться і не замінюється дужками.
export const MINUS = '\u2212'
export const NNBSP = '\u202F'
const fmtCache = new Map()
const nf = (d) => {
  if (!fmtCache.has(d)) fmtCache.set(d, new Intl.NumberFormat('uk-UA', { minimumFractionDigits: d, maximumFractionDigits: d }))
  return fmtCache.get(d)
}
// Число → рядок: абсолютне значення з вузькими пробілами (будь-які пробіли uk-UA → U+202F)
const abs = (n, d) => nf(d).format(Math.abs(n)).replace(/[\s\u00A0\u202F]/g, NNBSP)

// Сума у стилі ТЗ.
//   decimals — 2 (за замовчуванням) або 0; sign: 'auto' (лише «−» для від'ємних) | 'always' (ще й «+» для додатних);
//   currency — додати « ₴». null / '' / нечислове → «—».
export function formatAmount(v, { decimals = 2, sign = 'auto', currency = false } = {}) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10 ** decimals) / 10 ** decimals          // −0,00 → 0,00
  const pre = r < 0 ? MINUS : (sign === 'always' && r > 0 ? '+' : '')
  return pre + abs(r, decimals) + (currency ? NNBSP + '₴' : '')
}

// 2816143.75 → «2 816 143,75»; завжди 2 знаки після коми; від'ємні — з «−».
export const formatMoney = (v) => formatAmount(v)

const KYIV = 'Europe/Kyiv'
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV })        // YYYY-MM-DD
const kyivYmd = (d) => ymd.format(d)
const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру']
const WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

// Дата для людей: «Сьогодні» / «Завтра» / «Вчора» / «1 вер» / «пн, 26 жов»; рік — лише якщо не поточний («1 вер 2025»).
//   iso — 'YYYY-MM-DD' або повний ISO-час; opts.withWeekday — додати день тижня; opts.now — «сьогодні» для тестів.
// Без крапок у скороченнях (усі крапки прибираються).
export function formatDate(iso, { withWeekday = false, now = new Date() } = {}) {
  if (!iso) return '—'
  const s = String(iso)
  let day = s
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dt = new Date(s)
    if (Number.isNaN(dt.getTime())) return '—'
    day = kyivYmd(dt)
  }
  const today = kyivYmd(now)
  const diff = Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5)
  if (diff === 0) return 'Сьогодні'
  if (diff === 1) return 'Завтра'
  if (diff === -1) return 'Вчора'
  const [y, m, d] = day.split('-').map(Number)
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  let out = `${d} ${MONTHS[m - 1]}`
  if (String(y) !== today.slice(0, 4)) out += ` ${y}`
  if (withWeekday) out = `${wd}, ${out}`
  return out.replace(/\./g, '')
}

// Коротка сума для плиток: 641 000 → «641 тис», 2 700 000 → «2,7 млн», 20 534 000 → «20,5 млн», 950 → «950».
// Знак «−» зберігається. Точна сума — у підказці / таблиці.
export function formatShort(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n), pre = n < 0 ? MINUS : ''
  const one = (x) => nf(x < 100 ? 1 : 0).format(x).replace(/,0$/, '').replace(/[\s  ]/g, NNBSP)
  if (a >= 1e9) return pre + one(a / 1e9) + NNBSP + 'млрд'
  if (a >= 1e6) return pre + one(a / 1e6) + NNBSP + 'млн'
  if (a >= 1e3) return pre + nf(0).format(Math.round(a / 1e3)) + NNBSP + 'тис'
  return pre + nf(0).format(Math.round(a))
}

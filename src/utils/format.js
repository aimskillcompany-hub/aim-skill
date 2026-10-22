// Форматування для дизайн-системи: гроші й дати в одному стилі на всіх сторінках.
// Київський час: дата «сьогодні / завтра / вчора» рахується за Europe/Kyiv, а не за часовим поясом браузера.

const MONEY = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 2816143.75 → «2 816 143,75»; завжди 2 знаки після коми. null / '' / нечислове → «—».
export function formatMoney(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  // uk-UA розділяє тисячі нерозривним пробілом (U+00A0 / U+202F) — лишаємо як є: так сума не переноситься
  return MONEY.format(n)
}

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

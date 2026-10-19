// Дати бізнесу — за київським часом (Europe/Kyiv), незалежно від часового поясу комп'ютера чи сервера.
// Раніше «сьогодні» бралось як UTC-дата (toISOString), і з 00:00 до 02:00–03:00 за Києвом
// документи/транзакції отримували вчорашню дату, а 1-го числа — попередній місяць (аудит 2026-10-19).
export const KYIV_TZ = 'Europe/Kyiv'

const fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

// 'YYYY-MM-DD' — календарна дата в Києві для моменту (за замовчуванням зараз)
export const kyivDate = (d = new Date()) => fmtYmd.format(d instanceof Date ? d : new Date(d))
export const todayKyiv = () => kyivDate(new Date())

// Київська дата для timestamptz-рядка (created_at тощо); null/'' → ''
export const kyivDateOfTs = (ts) => (ts ? kyivDate(new Date(ts)) : '')

// Арифметика над 'YYYY-MM-DD' без часових поясів (UTC-північ) — без зсувів через перехід на літній час
const toUtc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
export const daysBetween = (fromIso, toIso) => Math.round((toUtc(toIso) - toUtc(fromIso)) / 864e5)
export const addDaysIso = (iso, n) => new Date(toUtc(iso) + (Number(n) || 0) * 864e5).toISOString().slice(0, 10)
export const monthStartIso = (iso = todayKyiv()) => iso.slice(0, 8) + '01'

// Початок київської доби 'YYYY-MM-DD' як ISO-мітка (для фільтрів по timestamptz-колонках created_at)
export function kyivDayStartTs(iso) {
  for (const off of ['+03:00', '+02:00']) {
    const d = new Date(`${iso}T00:00:00${off}`)
    if (kyivDate(d) === iso && kyivDate(new Date(d.getTime() - 1)) !== iso) return d.toISOString()
  }
  return new Date(`${iso}T00:00:00+02:00`).toISOString()
}

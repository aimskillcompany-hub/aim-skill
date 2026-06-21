// Форматування чисел — єдине джерело для всіх компонентів
const ua = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 })
const uaInt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const uaShort = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1, notation: 'compact' })

export const fmt = n => ua.format(Math.abs(n || 0))
export const fmtInt = n => uaInt.format(Math.round(Math.abs(n || 0)))
export const fmtS = n => uaShort.format(Math.abs(n || 0))
export const fmtSigned = n => (n >= 0 ? '+' : '-') + ua.format(Math.abs(n || 0))

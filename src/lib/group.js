// Компанії групи й операції всередині групи (ТЗ редизайну 6.4).
// Контрагент — «компанія групи», якщо його ЄДРПОУ / ІПН збігається з ЄДРПОУ / ІПН однієї з наших юросіб
// (таблиця companies). Окремого прапорця в БД немає — позначка виводиться автоматично (рішення власника 23.10.2026).
// Позики (ПФД) між компаніями групи не чіпаємо (рішення власника) — вони вже сумуються чистими у зведеному балансі.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const digits = (s) => String(s || '').replace(/\D/g, '')
let cache = null, cacheAt = 0

// → { byContractor: Map<contractorId, { companyId, name }>, codes: Map<code, company> }
export async function loadGroupContractors() {
  if (cache && Date.now() - cacheAt < 5 * 60 * 1000) return cache
  const { data: cos } = await supabase.from('companies').select('id, name, short_name, edrpou, ipn')
  const codes = new Map()
  ;(cos || []).forEach(c => [c.edrpou, c.ipn].map(digits).filter(x => x.length >= 8).forEach(code => codes.set(code, c)))
  const byContractor = new Map()
  if (codes.size) {
    const { data: cs } = await supabase.from('contractors').select('id, edrpou').in('edrpou', [...codes.keys()])
    ;(cs || []).forEach(k => { const c = codes.get(digits(k.edrpou)); if (c) byContractor.set(k.id, { companyId: c.id, name: c.short_name || c.name }) })
  }
  cache = { byContractor, codes }; cacheAt = Date.now()
  return cache
}

export const isGroupCode = (g, edrpou) => !!g?.codes.has(digits(edrpou))

// Хук для позначки «група» у списках: { has(contractorId) → bool, byEdrpou(code) → bool }
export function useGroupContractors() {
  const [g, setG] = useState(cache)
  useEffect(() => { let on = true; loadGroupContractors().then(x => on && setG(x)).catch(() => {}); return () => { on = false } }, [])
  return {
    ready: !!g,
    has: (contractorId) => !!g?.byContractor.has(contractorId),
    byEdrpou: (code) => isGroupCode(g, code),
  }
}

// Чиста функція: прибрати внутрішньогрупові дебіторку / кредиторку з рядків зведеного балансу.
//   rows — [{ id, recv, pay, assets, equity, … }]; ig — { [companyId]: { recv, pay } } (частка боргів перед групою)
// Повертає нові rows, total і mismatch = Σ recv_ig − Σ pay_ig: на скільки змінився капітал групи.
// Якщо обидві сторони обліковані однаково, mismatch = 0 (капітал групи не змінюється — перевірка коректності).
export function eliminateIntragroup(rows, ig) {
  const out = rows.map(r => {
    const x = ig[r.id] || { recv: 0, pay: 0 }
    const recv = r.recv - x.recv, pay = r.pay - x.pay
    const assets = r.assets - x.recv
    return { ...r, recv, pay, assets, equity: assets - pay - r.loans, igRecv: x.recv, igPay: x.pay }
  })
  const s = (k, list) => Math.round(list.reduce((t, r) => t + (r[k] || 0), 0) * 100) / 100
  const total = Object.fromEntries(['cash', 'stock', 'recv', 'fa', 'assets', 'pay', 'loans', 'equity'].map(k => [k, s(k, out)]))
  const mismatch = Math.round((s('igRecv', out) - s('igPay', out)) * 100) / 100
  return { rows: out, total, mismatch }
}

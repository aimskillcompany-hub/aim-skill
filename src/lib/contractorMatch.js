// Авто-матч контрагента з банківської транзакції.
// 1) ЄДРПОУ (8 цифр) з поля edrpou або з description → точний збіг у contractors.
// 2) Якщо ні — нечіткий пошук по назві (без регістру, ігнор ТОВ/ФОП/АТ тощо).
import { supabase } from './supabase'

let _cache = null, _t = 0
async function loadContractors() {
  if (_cache && Date.now() - _t < 120000) return _cache
  const { data } = await supabase.from('contractors').select('id, name, short_name, edrpou')
  _cache = data || []; _t = Date.now()
  return _cache
}
export function resetContractorMatchCache() { _cache = null }

// нормалізація назви: без форми власності, лапок, пунктуації, регістру
function stripForm(s) {
  return (s || '').toLowerCase()
    .replace(/товариство з обмеженою відповідальністю/g, ' ')
    .replace(/фізична особа[\s-]*підприємець/g, ' ')
    .replace(/акціонерне товариство/g, ' ')
    .replace(/приватне підприємство/g, ' ')
    .replace(/приватне акціонерне товариство/g, ' ')
    .replace(/публічне акціонерне товариство/g, ' ')
    .replace(/\b(тов|фоп|ат|пп|пат|прат|кп|дп|то)\b/g, ' ')
    .replace(/[«»"'`]/g, ' ')
    .replace(/[^a-zа-яіїєґ0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

// 8 цифр (ЄДРПОУ) або 10 (ІПН/ФОП), що не є частиною довшого числа
function extractEdrpou(text) {
  if (!text) return null
  const m = String(text).match(/(?<!\d)(\d{8}|\d{10})(?!\d)/)
  return m ? m[1] : null
}

// ЄДРПОУ/ІПН транзакції: з поля edrpou, або витягнутий з опису/контрагента
export function txEdrpou(tx) {
  return (tx.edrpou && String(tx.edrpou).trim()) || extractEdrpou(tx.description) || extractEdrpou(tx.counterparty) || null
}

// Синхронний матч однієї транзакції проти попередньо завантажених контрагентів
export function matchOne(tx, contractors) {
  const code = txEdrpou(tx)
  // 1) ЄДРПОУ — точний збіг
  if (code) {
    const byCode = contractors.find(c => c.edrpou && String(c.edrpou).trim() === code)
    if (byCode) return { contractor: byCode, by: 'edrpou', code }
  }
  // 2) Нечіткий пошук по назві (counterparty пріоритетніше за description)
  for (const raw of [tx.counterparty, tx.description].filter(Boolean)) {
    const norm = stripForm(raw)
    if (norm.length < 4) continue
    // точний нормалізований збіг
    let hit = contractors.find(c => {
      const cn = stripForm(c.name), sn = stripForm(c.short_name)
      return (cn.length >= 4 && cn === norm) || (sn.length >= 4 && sn === norm)
    })
    if (hit) return { contractor: hit, by: 'name' }
    // всі значущі слова назви контрагента присутні в тексті
    hit = contractors.find(c => {
      const words = stripForm(c.name).split(' ').filter(w => w.length > 3)
      if (!words.length) return false
      return words.every(w => norm.includes(w))
    })
    if (hit) return { contractor: hit, by: 'name' }
  }
  return null
}

// Повертає функцію-матчер (контрагенти завантажені один раз, з кешем)
export async function getContractorMatcher() {
  const contractors = await loadContractors()
  return (tx) => matchOne(tx, contractors)
}

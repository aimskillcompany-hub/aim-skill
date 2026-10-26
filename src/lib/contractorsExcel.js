// Контрагенти ↔ Excel (рішення власника 27.10.2026, як «Замовлення ↔ Excel»): вивантажити всіх контрагентів,
// виправити в Excel, завантажити назад. Правити наявних і додавати нових (рядок без ID); видалення й об'єднання —
// лише в інтерфейсі. Перед застосуванням — план «було → стало»; нічого не пишеться до «Застосувати».
// Назва «Товариство з обмеженою відповідальністю…» скорочується до «ТОВ …» тригером у базі (104).
import { supabase } from './supabase'
import { fetchAll } from './fetchAll'
import { toISO } from './stockExcel'

// [поле, заголовок, ширина, тип] — тип: text | bool | int | date | edrpou
export const C_FIELDS = [
  ['name', 'Назва', 44, 'text'], ['short_name', 'Коротка назва', 24, 'text'], ['edrpou', 'ЄДРПОУ', 12, 'edrpou'], ['ipn', 'ІПН', 14, 'text'],
  ['is_client', 'Клієнт', 8, 'bool'], ['is_supplier', 'Постачальник', 11, 'bool'], ['is_vat_payer', 'Платник ПДВ', 11, 'bool'],
  ['legal_form', 'Орг.-правова форма', 18, 'text'], ['tax_system', 'Система оподаткування', 18, 'text'],
  ['iban', 'IBAN', 32, 'text'], ['bank_name', 'Банк', 24, 'text'], ['mfo', 'МФО', 8, 'text'],
  ['legal_address', 'Юридична адреса', 40, 'text'], ['city', 'Місто', 16, 'text'], ['region', 'Область', 16, 'text'], ['postal_code', 'Індекс', 8, 'text'],
  ['email', 'Email', 24, 'text'], ['phone', 'Телефон', 16, 'text'], ['website', 'Сайт', 20, 'text'],
  ['director', 'Директор (ПІБ)', 28, 'text'], ['director_position', 'Посада директора', 18, 'text'],
  ['payment_delay_days', 'Відстрочка, дн.', 10, 'int'], ['price_type', 'Тип ціни (net / gross)', 12, 'text'],
  ['contract_valid_until', 'Договір дійсний до', 13, 'date'], ['default_article', 'Стаття за замовч.', 22, 'text'],
]
const ID_H = 'ID контрагента'
const s = (v) => String(v ?? '').trim()
const yes = (v) => /^(так|yes|true|1|\+|✓)$/i.test(s(v))
const no = (v) => /^(ні|no|false|0|-|)$/i.test(s(v))
const dmy = (iso) => iso ? `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.${String(iso).slice(0, 4)}` : ''
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadContractorsData() {
  const rows = await fetchAll(() => supabase.from('contractors').select('*'), { order: 'name' })
  // колонки, яких ще немає в базі (старі міграції), не вивантажуємо
  const have = new Set(rows.flatMap(r => Object.keys(r)))
  const fields = rows.length ? C_FIELDS.filter(f => have.has(f[0])) : C_FIELDS.filter(f => ['name', 'edrpou', 'is_client', 'is_supplier', 'iban', 'bank_name', 'payment_delay_days'].includes(f[0]))
  return { rows, fields }
}

const cell = (f, v) => f[3] === 'bool' ? (v ? 'так' : 'ні') : f[3] === 'date' ? dmy(v) : (v ?? '')
export function buildRows(data) {
  return [...data.rows].sort((a, b) => s(a.name).localeCompare(s(b.name), 'uk'))
    .map(r => ({ [ID_H]: r.id, ...Object.fromEntries(data.fields.map(f => [f[1], cell(f, r[f[0]])])) }))
}

const HELP = (fields) => [
  ['Контрагенти ↔ Excel'],
  [''],
  ['1. Правте потрібні колонки. «ID контрагента» не змінюйте.'],
  ['2. Новий контрагент — рядок з порожнім ID і назвою (ЄДРПОУ бажано). Якщо такий ЄДРПОУ вже є — рядок пропуститься.'],
  ['3. Видаляти й об’єднувати контрагентів тут не можна — лише в картці контрагента.'],
  ['4. Завантажте файл назад — побачите «було → стало». Нічого не зміниться, доки не натиснете «Застосувати».'],
  [''],
  ['Колонки «Клієнт», «Постачальник», «Платник ПДВ»:', 'так / ні'],
  ['ЄДРПОУ:', '8 цифр (юрособа) або 10 (ФОП, ІПН)'],
  ['Дати:', 'ДД.ММ.РРРР'],
  ['Колонки у файлі:', fields.map(f => f[1]).join(' · ')],
]

export async function exportContractorsXlsx(data) {
  const XLSX = await import('xlsx')
  const rows = buildRows(data)
  const header = [ID_H, ...data.fields.map(f => f[1])]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows, { header })
  ws['!cols'] = [{ wch: 38 }, ...data.fields.map(f => ({ wch: f[2] }))]
  if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(HELP(data.fields)), 'Як заповнювати')
  XLSX.utils.book_append_sheet(wb, ws, 'Контрагенти')
  XLSX.writeFile(wb, `Контрагенти_${new Date().toISOString().slice(0, 10)}.xlsx`)
  return { count: rows.length }
}

export async function readContractorsFile(file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const sh = wb.Sheets['Контрагенти']
  if (!sh) throw new Error('У файлі немає аркуша «Контрагенти» — завантажте файл, вивантажений із контрагентів')
  return XLSX.utils.sheet_to_json(sh, { defval: '' })
}

// Значення з клітинки → { v } або { error }
function parse(f, raw) {
  const t = s(raw)
  switch (f[3]) {
    case 'bool': return yes(raw) ? { v: true } : no(raw) ? { v: false } : { error: `«${f[1]}» — так або ні` }
    case 'int': { if (t === '') return { v: null }; const n = Number(t.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n >= -366 && n <= 366 ? { v: Math.round(n) } : { error: `«${f[1]}» — ціле число днів` } }
    case 'date': { if (t === '') return { v: null }; const d = toISO(raw); return d ? { v: d } : { error: `«${f[1]}» — ДД.ММ.РРРР` } }
    // ЄДРПОУ числом (Excel з’їдає нуль на початку) — доповнюємо до 8 цифр
    case 'edrpou': { if (t === '') return { v: null }; const d = typeof raw === 'number' && t.length < 8 ? t.padStart(8, '0') : t.replace(/\s/g, ''); return /^\d{8}$|^\d{10}$/.test(d) ? { v: d } : { error: `«${f[1]}» — 8 або 10 цифр` } }
    default: return { v: t === '' ? null : t }
  }
}
const same = (f, a, b) => f[3] === 'bool' ? !!a === !!b : f[3] === 'date' ? s(a).slice(0, 10) === s(b) : f[3] === 'int' ? (a ?? null) === (b ?? null) || Number(a) === Number(b) : s(a) === s(b)
const show = (f, v) => f[3] === 'bool' ? (v ? 'так' : 'ні') : f[3] === 'date' ? (dmy(v) || '—') : (v ?? '') === '' ? '—' : v

// План (чиста функція)
export function buildPlan(fileRows, data) {
  const errors = [], updates = [], creates = []
  const byId = Object.fromEntries(data.rows.map(r => [r.id, r]))
  const byEdr = {}; data.rows.forEach(r => { if (r.edrpou) (byEdr[r.edrpou] ||= []).push(r) })
  const seenEdr = {}
  fileRows.forEach((r, idx) => {
    const line = `рядок ${idx + 2}`
    const id = s(r[ID_H])
    const name = s(r['Назва'])
    if (!id && !name) return
    const vals = {}, errs = []
    data.fields.forEach(f => { if (!(f[1] in r)) return; const p = parse(f, r[f[1]]); if (p.error) errs.push(p.error); else vals[f[0]] = p.v })
    const who = name || byId[id]?.name || id
    if (errs.length) { errors.push(`${line} («${who}»): ${errs.join('; ')}`); return }
    if ('name' in vals && !vals.name) { errors.push(`${line}: назва не може бути порожньою`); return }
    const edr = vals.edrpou
    if (edr) { if (seenEdr[edr]) { errors.push(`${line} («${who}»): ЄДРПОУ ${edr} уже є в рядку ${seenEdr[edr]} цього файлу`); return } seenEdr[edr] = idx + 2 }
    if (id) {
      const cur = byId[id]
      if (!cur || !UUID.test(id)) { errors.push(`${line}: контрагента ${id} не знайдено`); return }
      if (edr && (byEdr[edr] || []).some(x => x.id !== id)) { errors.push(`${line} («${who}»): ЄДРПОУ ${edr} уже має «${byEdr[edr].find(x => x.id !== id).name}» — об’єднайте в картці`); return }
      const ch = data.fields.filter(f => f[0] in vals && !same(f, cur[f[0]], vals[f[0]])).map(f => ({ f: f[0], label: f[1], from: show(f, cur[f[0]]), to: show(f, vals[f[0]]), val: vals[f[0]] }))
      if (ch.length) updates.push({ row: cur, changes: ch })
    } else {
      if (edr && byEdr[edr]) { errors.push(`${line} («${name}»): ЄДРПОУ ${edr} уже є — «${byEdr[edr][0].name}»; щоб змінити, правте його рядок`); return }
      const exists = data.rows.find(x => s(x.name).toLowerCase() === name.toLowerCase())
      if (exists && !edr) { errors.push(`${line} («${name}»): контрагент з такою назвою вже є — додайте ЄДРПОУ або правте наявний рядок`); return }
      const row = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== null && v !== ''))
      if (row.payment_delay_days == null && data.fields.some(f => f[0] === 'payment_delay_days')) row.payment_delay_days = 0
      creates.push({ row })
    }
  })
  return { updates, creates, errors, count: updates.reduce((a, x) => a + x.changes.length, 0) + creates.length }
}

export async function applyPlan(plan, userId, onStep = () => {}) {
  for (const u of plan.updates) {
    const upd = Object.fromEntries(u.changes.map(c => [c.f, c.val]))
    const { error } = await supabase.from('contractors').update(upd).eq('id', u.row.id)
    onStep({ kind: 'update', id: u.row.id, ok: !error, error: error?.message })
  }
  for (let i = 0; i < plan.creates.length; i++) {
    const { error } = await supabase.from('contractors').insert({ ...plan.creates[i].row, created_by: userId || null })
    onStep({ kind: 'create', id: i, ok: !error, error: error?.message })
  }
}

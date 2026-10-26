// Замовлення ↔ Excel (рішення власника 27.10.2026): вивантажити всі замовлення й позиції, виправити в Excel,
// завантажити назад. Правити наявне й додавати позиції (рядок без ID); видалення — лише в інтерфейсі.
// Закриті / архівні замовлення не змінюються. Перед застосуванням — план «було → стало», нічого не пишеться,
// доки не натиснуть «Застосувати». Позиції замовлення зберігаються так само, як кнопка «Зберегти» у «Товарах»
// (RPC replace_order_items, 070) — сума замовлення перераховується.
import { supabase } from './supabase'
import { qc } from './companyScope'
import { fetchAll, fetchAllIn } from './fetchAll'
import { toISO } from './stockExcel'
import { savePaymentPlanEntry } from './forecast'
import { takeSnapshot, supersedeSnapshot, isMissingSnapTable } from './snapshots'
import { resolveProduct } from './stockService'

export const STATUSES = [
  ['new', 'Новий'], ['tender', 'Тендер'], ['processing', 'В опрацюванні'], ['needs_contract', 'Потребує договір'],
  ['ordering_supplier', 'Замовлення у дистрибютора'], ['shipped', 'Відвантажено'], ['needs_payment', 'Потребує оплати'],
  ['paid', 'Оплачено'], ['closed', 'Закрито'],
]
const TYPE = { trade: 'Торгівля', service: 'Послуги', agent: 'Агентське' }

// Колонки: [ключ, заголовок, ширина, редагована?]
export const O_COLS = [
  ['id', 'ID замовлення', 38], ['number', '№', 8], ['type', 'Тип', 11], ['created', 'Створено', 11],
  ['client', 'Клієнт', 34, 1], ['clientEdrpou', 'ЄДРПОУ клієнта', 12], ['status', 'Статус', 22, 1], ['manager', 'Менеджер', 22, 1],
  ['description', 'Опис', 30, 1], ['subject', 'Предмет закупівлі', 30, 1], ['inForecast', 'В прогнозі', 10, 1], ['agentPct', 'Агентські, %', 11, 1],
  ['shipDate', 'Дата відвантаження', 13, 1], ['clientDays', 'Клієнт платить через, дн.', 12, 1],
  ['total', 'Сума з ПДВ', 14], ['items', 'Позицій', 8], ['state', 'Стан', 12],
]
export const I_COLS = [
  ['id', 'ID позиції', 38], ['orderNo', '№ замовлення', 10], ['name', 'Назва', 50, 1], ['chars', 'Характеристики', 30, 1], ['sku', 'Артикул', 14, 1],
  ['unit', 'Од.', 6, 1], ['qty', 'К-сть', 8, 1], ['cost', 'Закупка за од.', 13, 1], ['costVat', 'ПДВ закупки, %', 10, 1],
  ['price', 'Ціна продажу за од.', 14, 1], ['vat', 'ПДВ, %', 7, 1], ['incl', 'Ціни з ПДВ', 9, 1],
  ['supplier', 'Постачальник', 32, 1], ['payDays', 'Відстрочка позиції, дн.', 11, 1], ['shipDate', 'Відвантаження позиції', 13, 1],
  ['total', 'Сума з ПДВ', 14],
]
const H = (cols) => Object.fromEntries(cols.map(([k, h]) => [k, h]))
const OH = H(O_COLS), IH = H(I_COLS)

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const s = (v) => String(v ?? '').trim()
const norm = (v) => s(v).toLowerCase().replace(/[«»"“”„'’ʼ`]/g, '').replace(/товариство з обмеженою відповідальністю/g, 'тов').replace(/\s+/g, ' ')
const dmy = (iso) => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : ''
const yes = (v) => /^(так|yes|true|1|\+|✓)$/i.test(s(v))
const no = (v) => /^(ні|no|false|0|-|)$/i.test(s(v))
const num = (v) => { if (typeof v === 'number') return v; const t = s(v).replace(/\s/g, '').replace(',', '.'); return t === '' ? null : (isNaN(Number(t)) ? NaN : Number(t)) }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const itemGross = (it) => { const p = Number(it.unit_price) || 0, v = Number(it.vat_rate) || 0; return r2((it.price_includes_vat ? p : p * (1 + v / 100)) * (Number(it.qty) || 0)) }

export async function loadOrdersData() {
  const orders = await fetchAll(() => qc('orders').select('id, order_number, type, status, created_at, client_id, manager_id, description, procurement_subject, in_forecast, agent_commission_pct, total, archived_at, outcome'), { order: 'created_at' })
  const ids = orders.map(o => o.id)
  const [items, plans, profs] = await Promise.all([
    ids.length ? fetchAllIn(() => supabase.from('order_items').select('*').order('created_at'), 'order_id', ids) : [],
    ids.length ? fetchAllIn(() => supabase.from('order_payment_plan').select('order_id, kind, plan_date, days, supplier_id'), 'order_id', ids).catch(() => []) : [],
    supabase.from('profiles').select('id, full_name, email').then(r => r.data || []),
  ])
  const cIds = [...new Set([...orders.map(o => o.client_id), ...items.map(i => i.supplier_id)].filter(Boolean))]
  const known = cIds.length ? await fetchAllIn(() => supabase.from('contractors').select('id, name, edrpou'), 'id', cIds) : []
  return { orders, items, plans, profs, contractors: known }
}

export function buildRows(data) {
  const cById = Object.fromEntries(data.contractors.map(c => [c.id, c]))
  const pById = Object.fromEntries(data.profs.map(p => [p.id, p]))
  const itemsBy = {}; data.items.forEach(i => (itemsBy[i.order_id] ||= []).push(i))
  const planBy = {}; data.plans.forEach(p => (planBy[p.order_id] ||= []).push(p))
  const oRows = [], iRows = []
  ;[...data.orders].sort((a, b) => String(a.order_number || '').localeCompare(String(b.order_number || ''), 'uk', { numeric: true })).forEach(o => {
    const pl = planBy[o.id] || []
    const ship = pl.find(x => x.kind === 'ship'), cli = pl.find(x => x.kind === 'client')
    oRows.push({
      [OH.id]: o.id, [OH.number]: o.order_number || '', [OH.type]: TYPE[o.type] || o.type || '', [OH.created]: dmy(o.created_at?.slice(0, 10)),
      [OH.client]: cById[o.client_id]?.name || '', [OH.clientEdrpou]: cById[o.client_id]?.edrpou || '',
      [OH.status]: STATUSES.find(x => x[0] === o.status)?.[1] || o.status || '', [OH.manager]: pById[o.manager_id]?.full_name || pById[o.manager_id]?.email || '',
      [OH.description]: o.description || '', [OH.subject]: o.procurement_subject || '', [OH.inForecast]: o.in_forecast ? 'так' : 'ні',
      [OH.agentPct]: o.agent_commission_pct ?? '', [OH.shipDate]: dmy(ship?.plan_date || ''), [OH.clientDays]: cli?.days ?? '',
      [OH.total]: r2(o.total), [OH.items]: (itemsBy[o.id] || []).length,
      [OH.state]: o.archived_at ? (o.outcome === 'lost' ? 'архів · програно' : 'архів') : o.status === 'closed' ? 'закрито' : 'в роботі',
    })
    ;(itemsBy[o.id] || []).forEach(i => iRows.push({
      [IH.id]: i.id, [IH.orderNo]: o.order_number || '', [IH.name]: i.name || '', [IH.chars]: i.characteristics || '', [IH.sku]: i.sku || '',
      [IH.unit]: i.unit || 'шт', [IH.qty]: Number(i.qty) || 0, [IH.cost]: Number(i.cost_price) || 0, [IH.costVat]: i.cost_vat_rate ?? '',
      [IH.price]: Number(i.unit_price) || 0, [IH.vat]: Number(i.vat_rate) || 0, [IH.incl]: i.price_includes_vat ? 'так' : 'ні',
      [IH.supplier]: cById[i.supplier_id]?.name || '', [IH.payDays]: i.pay_days ?? '', [IH.shipDate]: dmy(i.ship_date || ''), [IH.total]: itemGross(i),
    }))
  })
  return { oRows, iRows }
}

const HELP = [
  ['Замовлення ↔ Excel'],
  [''],
  ['1. Правте лише колонки з позначкою «✎» у заголовку довідки нижче. ID і сірі колонки не змінюйте.'],
  ['2. Нова позиція: порожній «ID позиції», заповнений «№ замовлення» і назва. Видаляти позиції тут не можна — лише в замовленні.'],
  ['3. Закриті й архівні замовлення не змінюються (рядки пропускаються).'],
  ['4. Завантажте файл назад — побачите перелік «було → стало». Нічого не зміниться, доки не натиснете «Застосувати».'],
  ['5. Після застосування ID позицій змінених замовлень оновлюються — для наступних правок вивантажте файл заново.'],
  [''],
  ['Аркуш «Замовлення», редагуються:', 'Клієнт (назва або ЄДРПОУ), Статус, Менеджер (ПІБ), Опис, Предмет закупівлі, В прогнозі (так / ні), Агентські %, Дата відвантаження (ДД.ММ.РРРР, порожньо — орієнтовно), Клієнт платить через, дн.'],
  ['Аркуш «Позиції», редагуються:', 'Назва, Характеристики, Артикул, Од., К-сть, Закупка за од., ПДВ закупки % (порожньо — як продаж), Ціна продажу за од., ПДВ %, Ціни з ПДВ (так / ні), Постачальник (назва або ЄДРПОУ), Відстрочка позиції дн., Відвантаження позиції (дата)'],
  [''],
  ['Статуси:', STATUSES.map(x => x[1]).join(' · ')],
]

export async function exportOrdersXlsx(data) {
  const XLSX = await import('xlsx')
  const { oRows, iRows } = buildRows(data)
  const wb = XLSX.utils.book_new()
  const sheet = (rows, cols) => {
    const header = cols.map(c => c[1])
    const ws = XLSX.utils.json_to_sheet(rows, { header })
    ws['!cols'] = cols.map(c => ({ wch: c[2] }))
    if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) }
    return ws
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(HELP), 'Як заповнювати')
  XLSX.utils.book_append_sheet(wb, sheet(oRows, O_COLS), 'Замовлення')
  XLSX.utils.book_append_sheet(wb, sheet(iRows, I_COLS), 'Позиції')
  XLSX.writeFile(wb, `Замовлення_${new Date().toISOString().slice(0, 10)}.xlsx`)
  return { orders: oRows.length, items: iRows.length }
}

export async function readOrdersFile(file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const rows = (n) => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }) : null
  const f = { oRows: rows('Замовлення'), iRows: rows('Позиції') }
  if (!f.oRows && !f.iRows) throw new Error('У файлі немає аркушів «Замовлення» і «Позиції» — завантажте файл, вивантажений із замовлень')
  return { oRows: f.oRows || [], iRows: f.iRows || [] }
}

// Пошук контрагента: ЄДРПОУ → точна назва (без лапок і регістру). allContractors — усі контрагенти.
function findContractor(text, all) {
  const t = s(text); if (!t) return { id: null }
  if (/^\d{8,10}$/.test(t)) { const c = all.find(x => x.edrpou === t); return c ? { id: c.id, name: c.name } : { error: `контрагента з ЄДРПОУ ${t} не знайдено` } }
  const n = norm(t), list = all.filter(x => norm(x.name) === n)
  if (list.length === 1) return { id: list[0].id, name: list[0].name }
  if (list.length > 1) return { error: `«${t}» — кілька контрагентів з такою назвою, вкажіть ЄДРПОУ` }
  return { error: `контрагента «${t}» не знайдено` }
}

// План змін (чиста функція): data — поточний стан бази, allContractors — для пошуку назв
export function buildPlan(file, data, allContractors) {
  const errors = [], orderChanges = [], itemChanges = []
  const oById = Object.fromEntries(data.orders.map(o => [o.id, o]))
  const oByNo = {}; data.orders.forEach(o => { if (o.order_number) oByNo[s(o.order_number)] = o })
  const iById = Object.fromEntries(data.items.map(i => [i.id, i]))
  const cById = Object.fromEntries(allContractors.map(c => [c.id, c]))
  const planBy = {}; data.plans.forEach(p => (planBy[p.order_id] ||= []).push(p))
  const locked = (o) => !!o.archived_at || o.status === 'closed'
  const profByName = (t) => { const n = norm(t); return data.profs.filter(p => norm(p.full_name) === n || norm(p.email) === n) }

  // ── Замовлення ──
  file.oRows.forEach((r, idx) => {
    const line = `«Замовлення», рядок ${idx + 2}`
    const id = s(r[OH.id]); if (!id) return
    const o = oById[id]; if (!o) { errors.push(`${line}: замовлення ${id} не знайдено`); return }
    const ch = []
    const pl = planBy[o.id] || [], ship = pl.find(x => x.kind === 'ship'), cli = pl.find(x => x.kind === 'client')
    if (OH.client in r) { const t = s(r[OH.client]), cur = cById[o.client_id]
      if (t !== s(cur?.name) && !(cur && t === cur.edrpou)) { const c = findContractor(t, allContractors); if (c.error) errors.push(`${line} (№${o.order_number}): ${c.error}`); else if (c.id !== o.client_id) ch.push({ f: 'client_id', label: 'Клієнт', from: cur?.name || '—', to: c.name || '—', val: c.id }) } }
    if (OH.status in r) { const t = s(r[OH.status]); const st = STATUSES.find(x => x[1].toLowerCase() === t.toLowerCase() || x[0] === t)
      if (t && !st) errors.push(`${line} (№${o.order_number}): невідомий статус «${t}»`)
      else if (st && st[0] !== o.status) ch.push({ f: 'status', label: 'Статус', from: STATUSES.find(x => x[0] === o.status)?.[1] || o.status, to: st[1], val: st[0] }) }
    if (OH.manager in r) { const t = s(r[OH.manager]); const cur = data.profs.find(p => p.id === o.manager_id)
      if (t !== s(cur?.full_name) && t !== s(cur?.email)) {
        if (!t) { if (o.manager_id) ch.push({ f: 'manager_id', label: 'Менеджер', from: cur?.full_name || '—', to: '—', val: null }) }
        else { const m = profByName(t); if (m.length !== 1) errors.push(`${line} (№${o.order_number}): менеджера «${t}» ${m.length ? 'знайдено кілька' : 'не знайдено'}`); else if (m[0].id !== o.manager_id) ch.push({ f: 'manager_id', label: 'Менеджер', from: cur?.full_name || '—', to: m[0].full_name || m[0].email, val: m[0].id }) } } }
    const txt = (key, f, label) => { if (!(OH[key] in r)) return; const t = s(r[OH[key]]); if (t !== s(o[f])) ch.push({ f, label, from: s(o[f]) || '—', to: t || '—', val: t || null }) }
    txt('description', 'description', 'Опис'); txt('subject', 'procurement_subject', 'Предмет закупівлі')
    if (OH.inForecast in r) { const t = r[OH.inForecast]; const v = yes(t) ? true : no(t) ? false : undefined
      if (v === undefined) errors.push(`${line} (№${o.order_number}): «В прогнозі» — так або ні`)
      else if (v !== !!o.in_forecast) ch.push({ f: 'in_forecast', label: 'В прогнозі', from: o.in_forecast ? 'так' : 'ні', to: v ? 'так' : 'ні', val: v }) }
    if (OH.agentPct in r) { const v = num(r[OH.agentPct])
      if (Number.isNaN(v) || (v != null && (v < 0 || v > 100))) errors.push(`${line} (№${o.order_number}): «Агентські, %» — число від 0 до 100`)
      else if ((v ?? null) !== (o.agent_commission_pct == null ? null : Number(o.agent_commission_pct))) ch.push({ f: 'agent_commission_pct', label: 'Агентські, %', from: o.agent_commission_pct ?? '—', to: v ?? '—', val: v }) }
    if (OH.shipDate in r) { const raw = r[OH.shipDate]; const v = s(raw) === '' ? null : toISO(raw)
      if (v === undefined) errors.push(`${line} (№${o.order_number}): «Дата відвантаження» — ДД.ММ.РРРР`)
      else if ((v || null) !== (ship?.plan_date || null)) ch.push({ f: 'plan:ship', label: 'Дата відвантаження', from: dmy(ship?.plan_date) || 'орієнтовно', to: dmy(v) || 'орієнтовно', val: v }) }
    if (OH.clientDays in r) { const v = num(r[OH.clientDays])
      if (Number.isNaN(v) || (v != null && (v < -366 || v > 366))) errors.push(`${line} (№${o.order_number}): «Клієнт платить через» — ціле число днів`)
      else if ((v ?? null) !== (cli?.days ?? null)) ch.push({ f: 'plan:client', label: 'Клієнт платить через, дн.', from: cli?.days ?? 'типово', to: v ?? 'типово', val: v == null ? null : Math.round(v) }) }
    if (!ch.length) return
    if (locked(o)) { errors.push(`№${o.order_number}: замовлення ${o.archived_at ? 'в архіві' : 'закрите'} — зміни пропущено`); return }
    orderChanges.push({ order: o, changes: ch, ship: ship || null, cli: cli || null })
  })

  // ── Позиції ──
  const byOrder = {}   // orderId → { order, edits: { itemId: [ch] }, adds: [row] }
  const slot = (o) => (byOrder[o.id] ||= { order: o, edits: {}, adds: [] })
  file.iRows.forEach((r, idx) => {
    const line = `«Позиції», рядок ${idx + 2}`
    const id = s(r[IH.id])
    const name = s(r[IH.name])
    if (!id && !name) return
    const parseRow = (base) => {
      const out = {}, errs = []
      const t = (key, f) => { if (IH[key] in r) out[f] = s(r[IH[key]]) || null }
      t('name', 'name'); t('chars', 'characteristics'); t('sku', 'sku'); t('unit', 'unit')
      const n = (key, f, { min = 0, max = 1e12, int = false, nullable = false } = {}) => {
        if (!(IH[key] in r)) return
        const v = num(r[IH[key]])
        if (v == null) { if (nullable) out[f] = null; else if (!base) out[f] = 0; return }
        if (Number.isNaN(v) || v < min || v > max) { errs.push(`«${IH[key]}» — число${min < 0 ? '' : ' ≥ ' + min}`); return }
        out[f] = int ? Math.round(v) : v
      }
      n('qty', 'qty'); n('cost', 'cost_price'); n('costVat', 'cost_vat_rate', { max: 100, nullable: true }); n('price', 'unit_price'); n('vat', 'vat_rate', { max: 100 })
      n('payDays', 'pay_days', { min: -366, max: 366, int: true, nullable: true })
      if (IH.incl in r) { const v = r[IH.incl]; if (yes(v)) out.price_includes_vat = true; else if (no(v)) out.price_includes_vat = false; else errs.push('«Ціни з ПДВ» — так або ні') }
      if (IH.shipDate in r) { const raw = r[IH.shipDate]; const v = s(raw) === '' ? null : toISO(raw); if (v === undefined) errs.push('«Відвантаження позиції» — ДД.ММ.РРРР'); else out.ship_date = v }
      if (IH.supplier in r) {
        const t = s(r[IH.supplier]), cur = base ? cById[base.supplier_id] : null
        if (!(base && (t === s(cur?.name) || (cur && t === cur.edrpou)))) { const c = findContractor(t, allContractors); if (c.error) errs.push(c.error); else { out.supplier_id = c.id; out._supplierName = c.name || '—' } }
      }
      return { out, errs }
    }
    if (id) {
      const base = iById[id]
      if (!base || !UUID.test(id)) { errors.push(`${line}: позицію ${id} не знайдено (можливо, файл старий — вивантажте заново)`); return }
      const o = oById[base.order_id]; if (!o) return
      const { out, errs } = parseRow(base)
      if (errs.length) { errors.push(`${line} (№${o.order_number}, «${base.name}»): ${errs.join('; ')}`); return }
      const LBL = { name: 'Назва', characteristics: 'Характеристики', sku: 'Артикул', unit: 'Од.', qty: 'К-сть', cost_price: 'Закупка', cost_vat_rate: 'ПДВ закупки, %', unit_price: 'Ціна продажу', vat_rate: 'ПДВ, %', price_includes_vat: 'Ціни з ПДВ', supplier_id: 'Постачальник', pay_days: 'Відстрочка позиції', ship_date: 'Відвантаження позиції' }
      const ch = []
      Object.keys(LBL).forEach(f => {
        if (!(f in out)) return
        const was = base[f] ?? null, now = out[f] ?? null
        const same = typeof now === 'number' || typeof was === 'number' ? Number(was ?? NaN) === Number(now ?? NaN) || (was == null && now == null) : f === 'ship_date' ? String(was || '').slice(0, 10) === String(now || '') : s(was) === s(now)
        if (same) return
        const show = (f2, v, isNow) => f2 === 'supplier_id' ? (isNow ? out._supplierName : cById[v]?.name) || '—' : f2 === 'price_includes_vat' ? (v ? 'так' : 'ні') : f2 === 'ship_date' ? dmy(String(v || '').slice(0, 10)) || '—' : v ?? '—'
        ch.push({ f, label: LBL[f], from: show(f, was, false), to: show(f, now, true), val: now })
      })
      if (!ch.length) return
      if (locked(o)) { errors.push(`№${o.order_number}, «${base.name}»: замовлення ${o.archived_at ? 'в архіві' : 'закрите'} — пропущено`); return }
      slot(o).edits[id] = ch
    } else {
      const no2 = s(r[IH.orderNo]); const o = oByNo[no2]
      if (!o) { errors.push(`${line}: нова позиція «${name}» — замовлення №${no2 || '?'} не знайдено`); return }
      if (locked(o)) { errors.push(`${line}: нова позиція «${name}» — замовлення №${o.order_number} ${o.archived_at ? 'в архіві' : 'закрите'}`); return }
      const { out, errs } = parseRow(null)
      if (errs.length) { errors.push(`${line} (№${o.order_number}, «${name}»): ${errs.join('; ')}`); return }
      if (!(out.qty > 0)) { errors.push(`${line} (№${o.order_number}, «${name}»): вкажіть кількість`); return }
      slot(o).adds.push({ unit: 'шт', vat_rate: 20, price_includes_vat: true, cost_price: 0, unit_price: 0, ...out })
    }
  })
  Object.values(byOrder).forEach(x => itemChanges.push(x))
  const count = orderChanges.reduce((a, x) => a + x.changes.length, 0) + itemChanges.reduce((a, x) => a + Object.values(x.edits).reduce((b, c) => b + c.length, 0) + x.adds.length, 0)
  return { orderChanges, itemChanges, errors, count }
}

// Застосування: замовлення (поля + графік + знімок прогнозу) → позиції (повний список замовлення через RPC)
export async function applyPlan(plan, data, userId, onStep = () => {}) {
  for (const x of plan.orderChanges) {
    const o = x.order
    try {
      const upd = {}
      x.changes.filter(c => !c.f.startsWith('plan:')).forEach(c => { upd[c.f] = c.val })
      if ('status' in upd) { if (upd.status === 'closed') upd.closed_at = new Date().toISOString(); else if (o.status === 'closed') upd.closed_at = null }
      if (Object.keys(upd).length) { const { error } = await qc('orders').update(upd).eq('id', o.id); if (error) throw error }
      const ship = x.changes.find(c => c.f === 'plan:ship'), cli = x.changes.find(c => c.f === 'plan:client')
      if (ship) await savePaymentPlanEntry(o.id, { kind: 'ship', planDate: ship.val, days: x.ship?.days ?? null })
      if (cli) await savePaymentPlanEntry(o.id, { kind: 'client', days: cli.val, planDate: x.cli?.plan_date || null })
      if ('in_forecast' in upd) { try { if (upd.in_forecast) await takeSnapshot(o.id); else await supersedeSnapshot(o.id) } catch (e) { if (!isMissingSnapTable(e)) throw e } }
      onStep({ kind: 'order', id: o.id, ok: true })
    } catch (e) { onStep({ kind: 'order', id: o.id, ok: false, error: e.message }) }
  }
  for (const x of plan.itemChanges) {
    const o = x.order
    try {
      const cur = data.items.filter(i => i.order_id === o.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      const list = cur.map(i => {
        const ch = x.edits[i.id]
        const it = { ...i }
        ;(ch || []).forEach(c => { it[c.f] = c.val })
        return it
      })
      for (const a of x.adds) {
        const { _supplierName, ...row } = a
        const v = Number(row.vat_rate) || 0, netCost = row.price_includes_vat && v > 0 ? row.cost_price / (1 + v / 100) : row.cost_price
        const res = await resolveProduct(row.name, row.unit, netCost || null, userId, row.sku || null).catch(() => null)
        list.push({ ...row, order_id: o.id, product_id: res?.productId || null })
      }
      const items = list.map(({ id, created_at, contractors, _supplierName, ...it }) => ({ ...it, total: itemGross(it) }))
      const total = r2(items.reduce((a, i) => a + (Number(i.total) || 0), 0))
      const { error } = await supabase.rpc('replace_order_items', { p_order_id: o.id, p_items: items, p_total: total })
      if (error) throw error
      onStep({ kind: 'items', id: o.id, ok: true })
    } catch (e) { onStep({ kind: 'items', id: o.id, ok: false, error: e.message }) }
  }
}

export async function loadAllContractors() {
  return fetchAll(() => supabase.from('contractors').select('id, name, edrpou'))
}

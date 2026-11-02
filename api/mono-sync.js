// Автоматична виписка monobank для юросіб (corp-api.monobank.ua, специфікація client-specification.yaml; міграція 108).
// Виклик:
//   • pg_cron щогодини — Authorization: Bearer <app_secrets.mono_sync> → усі юрособи з токеном;
//   • кнопка «Синхронізувати зараз» — JWT адміна / бухгалтера, body { company_id, from? } → одна юрособа.
// Токен API — app_secrets 'mono_token:<company_id>' (лише сервер). Рахунки — за IBAN (accounts.iban).
// Операції: GET /ext/v1/statement/{iban}/{from}/{to}?limit=500 (сторінки за часом), лише status DONE.
// Як імпорт файлу: дублікати пропускаються (референс = id операції monobank; для старих рядків без нього — дата+сума+ЄДРПОУ),
// контрагент — за ЄДРПОУ (немає — створюється), стаття / напрям — як найчастіше в історії цього ЄДРПОУ, інакше за знаком суми.
// Нові операції — непідтверджені (is_validated = false), їх підтверджують у «Банку».
import { getAdmin, verifyUser } from './_lib.js'

export const config = { maxDuration: 60 }

const BASE = 'https://corp-api.monobank.ua'
const PAGE = 500
const DAY = 86400
const kyivDate = (sec) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date(sec * 1000))
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function mono(path, token) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(BASE + path, { headers: { accept: 'application/json', 'x-token': token } })
    if (r.status === 429) {
      const wait = Number(r.headers.get('x-rate-limit-retry-after-seconds') || r.headers.get('x-rate-Limit-retry-after-seconds') || 10)
      if (wait > 20) throw new Error(`monobank: ліміт запитів, повторіть через ${wait} с`)
      await sleep(wait * 1000); continue
    }
    const text = await r.text()
    let body; try { body = text ? JSON.parse(text) : null } catch { body = text }
    if (!r.ok) throw new Error(`monobank ${r.status}: ${(body && (body.errorDescription || body.message || body.error)) || String(text).slice(0, 200)}`)
    return body
  }
  throw new Error('monobank: ліміт запитів')
}

async function authorize(req, admin) {
  const auth = String(req.headers['authorization'] || '')
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return { cron: true }
  const { data } = await admin.from('app_secrets').select('value').eq('key', 'mono_sync').maybeSingle()
  if (data?.value && auth === `Bearer ${data.value}`) return { cron: true }
  const user = await verifyUser(req)
  if (!user) return null
  const { data: p } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return ['admin', 'accountant'].includes(p?.role) ? { user } : null
}

// стаття / напрям за історією ЄДРПОУ у цій юрособі
async function historyByEdrpou(admin, companyId, codes) {
  const out = {}
  if (!codes.length) return out
  for (let i = 0; i < codes.length; i += 100) {
    const { data } = await admin.from('bank_transactions').select('edrpou, direction, article')
      .eq('company_id', companyId).eq('is_ignored', false).not('article', 'is', null).not('direction', 'is', null)
      .in('edrpou', codes.slice(i, i + 100)).limit(5000)
    ;(data || []).forEach(t => { const m = (out[t.edrpou] ||= {}); const k = t.direction + '|||' + t.article; m[k] = (m[k] || 0) + 1 })
  }
  const best = {}
  Object.entries(out).forEach(([code, m]) => { const [k] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; const [direction, article] = k.split('|||'); best[code] = { direction, article } })
  return best
}

async function syncCompany(admin, companyId, token, { fromDate = null } = {}) {
  const report = { company_id: companyId, accounts: [], added: 0, skipped: 0, errors: [] }
  const monoAccs = await mono('/ext/v1/accounts', token)
  const { data: ours } = await admin.from('accounts').select('id, name, iban, mono_synced_at, company_id, is_active').eq('company_id', companyId)
  const byIban = {}; (ours || []).forEach(a => { if (a.iban) byIban[a.iban.replace(/\s/g, '').toUpperCase()] = a })
  const { data: co } = await admin.from('companies').select('edrpou').eq('id', companyId).maybeSingle()
  const ownCodes = new Set([co?.edrpou].filter(Boolean))
  const nowSec = Math.floor(Date.now() / 1000)

  for (const ma of monoAccs || []) {
    const iban = String(ma.iban || '').toUpperCase()
    const acc = byIban[iban]
    if (!acc) { report.accounts.push({ iban, skipped: 'немає рахунку з цим IBAN у «Налаштування → Рахунки»' }); continue }
    if (acc.is_active === false) { report.accounts.push({ iban, account: acc.name, skipped: 'рахунок вимкнено' }); continue }
    if (Number(ma.currency) !== 980) { report.accounts.push({ iban, account: acc.name, skipped: `валюта ${ma.currency} — поки лише гривневі рахунки` }); continue }
    let added = 0, skipped = 0, error = null
    try {
      // з останньої синхронізації (з запасом 2 дні — операції проводяться із запізненням) або з вибраної дати / 30 днів
      const from = fromDate ? Math.floor(Date.parse(fromDate + 'T00:00:00+02:00') / 1000)
        : acc.mono_synced_at ? Math.floor(Date.parse(acc.mono_synced_at) / 1000) - 2 * DAY : nowSec - 30 * DAY
      const items = []
      let cursor = from
      for (let page = 0; page < 40; page++) {
        const batch = await mono(`/ext/v1/statement/${encodeURIComponent(iban)}/${cursor}/${nowSec}?limit=${PAGE}`, token)
        const list = Array.isArray(batch) ? batch : []
        items.push(...list)
        if (list.length < PAGE) break
        const last = Math.max(...list.map(x => Number(x.time) || 0))
        if (!last || last <= cursor) break
        cursor = last
      }
      const seen = new Set()
      const done = items.filter(x => x.status === 'DONE' && !x.reverse && x.id && !seen.has(x.id) && seen.add(x.id))
      if (done.length) {
        // дублікати: за референсом (id операції) …
        const ids = done.map(x => x.id)
        const have = new Set()
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await admin.from('bank_transactions').select('reference').in('reference', ids.slice(i, i + 200))
          ;(data || []).forEach(r => have.add(r.reference))
        }
        // … і для рядків, завантажених раніше файлом (інший референс або без нього): рахунок + дата + сума + ЄДРПОУ
        const dates = done.map(x => kyivDate(x.completedTime || x.time)).sort()
        const { data: old } = await admin.from('bank_transactions').select('date, amount, edrpou, reference')
          .eq('account_id', acc.id).gte('date', dates[0]).lte('date', dates[dates.length - 1])
        const oldKeys = new Map()
        ;(old || []).filter(r => !(r.reference && UUIDISH.test(r.reference))).forEach(r => {
          const k = `${r.date}|${Number(r.amount).toFixed(2)}|${r.edrpou || ''}`; oldKeys.set(k, (oldKeys.get(k) || 0) + 1)
        })
        const fresh = []
        for (const x of done) {
          if (have.has(x.id)) { skipped++; continue }
          const date = kyivDate(x.completedTime || x.time), amount = Math.round(Number(x.amount)) / 100
          const k = `${date}|${amount.toFixed(2)}|${x.counterEdrpou || ''}`
          if (oldKeys.get(k) > 0) { oldKeys.set(k, oldKeys.get(k) - 1); skipped++; continue }
          fresh.push({ x, date, amount })
        }
        if (fresh.length) {
          // контрагенти за ЄДРПОУ (немає — створюємо, крім власної юрособи)
          const codes = [...new Set(fresh.map(f => String(f.x.counterEdrpou || '').trim()).filter(Boolean))]
          const byCode = {}
          for (let i = 0; i < codes.length; i += 200) {
            const { data } = await admin.from('contractors').select('id, edrpou, default_direction, default_article').in('edrpou', codes.slice(i, i + 200))
            ;(data || []).forEach(c => { byCode[String(c.edrpou).trim()] = c })
          }
          const toCreate = codes.filter(c => !byCode[c] && !ownCodes.has(c)).map(c => {
            const f = fresh.find(y => String(y.x.counterEdrpou || '').trim() === c)
            return { name: (f.x.counterName || '').trim() || `Контрагент ${c}`, edrpou: c, is_supplier: f.amount < 0, is_client: f.amount > 0 }
          })
          if (toCreate.length) {
            const { data: created, error: cErr } = await admin.from('contractors').insert(toCreate).select('id, edrpou, default_direction, default_article')
            if (cErr) report.errors.push(`контрагенти: ${cErr.message}`)
            ;(created || []).forEach(c => { byCode[String(c.edrpou).trim()] = c })
          }
          const hist = await historyByEdrpou(admin, companyId, codes)
          const rows = fresh.map(({ x, date, amount }) => {
            const code = String(x.counterEdrpou || '').trim()
            const c = byCode[code], h = hist[code]
            const direction = h?.direction || c?.default_direction || (amount > 0 ? 'Доходи' : 'Витрати')
            return {
              company_id: companyId, account_id: acc.id, date, amount,
              counterparty: (x.counterName || '').trim() || null, description: (x.description || '').trim() || null,
              reference: x.id, edrpou: code || null, bank_name: 'Monobank',
              direction, article: h?.article || c?.default_article || null, contractor_id: c?.id || null,
              is_validated: false, is_ignored: false, imported_by: null,
            }
          })
          // партіями; якщо партія впала (напр. закритий місяць) — по одній, щоб решта зайшла
          for (let i = 0; i < rows.length; i += 200) {
            const part = rows.slice(i, i + 200)
            const { error: insErr } = await admin.from('bank_transactions').insert(part)
            if (!insErr) { added += part.length; continue }
            for (const r of part) {
              const { error: e1 } = await admin.from('bank_transactions').insert(r)
              if (e1) { skipped++; if (!error) error = e1.message } else added++
            }
          }
        }
      }
      await admin.from('accounts').update({ mono_synced_at: new Date(nowSec * 1000).toISOString() }).eq('id', acc.id)
    } catch (e) { error = e.message }
    await admin.from('bank_sync_log').insert({ company_id: companyId, account_id: acc.id, added, skipped, error })
    report.accounts.push({ iban, account: acc.name, added, skipped, error })
    report.added += added; report.skipped += skipped
    if (error) report.errors.push(`${acc.name}: ${error}`)
  }
  return report
}

export default async function handler(req, res) {
  let admin
  try { admin = getAdmin() } catch (e) { return res.status(500).json({ error: e.message }) }
  const who = await authorize(req, admin)
  if (!who) return res.status(401).json({ error: 'Немає доступу (лише адміністратор або бухгалтер)' })
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body) } catch { return {} } })() : (req.body || {})

  const { data: secrets } = await admin.from('app_secrets').select('key, value').like('key', 'mono_token:%')
  let list = (secrets || []).map(s => ({ companyId: s.key.slice('mono_token:'.length), token: s.value }))
  if (!who.cron) {
    if (!body.company_id) return res.status(400).json({ error: 'Не вказано юрособу' })
    list = list.filter(x => x.companyId === body.company_id)
    if (!list.length) return res.status(400).json({ error: 'Для цієї юрособи не задано токен monobank' })
  }
  const from = typeof body.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : null
  const results = []
  for (const x of list) {
    try { results.push(await syncCompany(admin, x.companyId, x.token, { fromDate: who.cron ? null : from })) }
    catch (e) {
      await admin.from('bank_sync_log').insert({ company_id: x.companyId, error: e.message })
      results.push({ company_id: x.companyId, error: e.message })
    }
  }
  return res.status(200).json({ ok: true, results })
}

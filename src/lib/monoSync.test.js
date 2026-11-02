// Синхронізація monobank (api/mono-sync.js): дублі, контрагенти, стаття з історії, рахунок за IBAN, закритий місяць.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const DB = {}
let failDate = null   // дата, вставка якої «падає» (закритий місяць)
function q(table) {
  const st = { f: [], op: 'select', payload: null, single: false }
  const rows = () => (DB[table] ||= []).filter(r => st.f.every(fn => fn(r)))
  const b = {
    select: () => b, order: () => b, limit: () => b,
    eq: (k, v) => { st.f.push(r => r[k] === v); return b },
    in: (k, v) => { st.f.push(r => v.includes(r[k])); return b },
    gte: (k, v) => { st.f.push(r => r[k] >= v); return b },
    lte: (k, v) => { st.f.push(r => r[k] <= v); return b },
    not: (k, _op, v) => { st.f.push(r => r[k] !== v && r[k] != null); return b },
    like: (k, v) => { const p = v.replace('%', ''); st.f.push(r => String(r[k]).startsWith(p)); return b },
    maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
    insert: (p) => {
      const list = Array.isArray(p) ? p : [p]
      if (table === 'bank_transactions' && list.some(r => r.date === failDate)) { st.res = { data: null, error: { message: 'PERIOD_CLOSED' } }; return b }
      const made = list.map((r, i) => ({ id: `${table}-${(DB[table] ||= []).length + i + 1}`, ...r }))
      DB[table].push(...made); st.res = { data: made, error: null }; return b
    },
    update: (p) => { st.op = 'update'; st.payload = p; return b },
    then: (res, rej) => {
      if (st.res) return Promise.resolve(st.res).then(res, rej)
      if (st.op === 'update') { rows().forEach(r => Object.assign(r, st.payload)); return Promise.resolve({ data: null, error: null }).then(res, rej) }
      return Promise.resolve({ data: rows(), error: null }).then(res, rej)
    },
  }
  return b
}
vi.mock('../../api/_lib.js', () => ({ getAdmin: () => ({ from: q }), verifyUser: async () => null }))
const { default: handler } = await import('../../api/mono-sync.js')

const IBAN = 'UA213223130000026007233566001', CO = 'co1'
const t = (iso) => Math.floor(Date.parse(iso) / 1000)
const op = (id, iso, amount, edrpou, name, extra = {}) => ({ id, time: t(iso), completedTime: t(iso), amount, counterEdrpou: edrpou, counterName: name, description: 'опл', status: 'DONE', reverse: false, currencyCode: '980', ...extra })
const call = async () => { let out; await handler({ headers: { authorization: 'Bearer S' }, body: {} }, { status: () => ({ json: (j) => { out = j } }) }); return out }

beforeEach(() => {
  for (const k of Object.keys(DB)) delete DB[k]
  failDate = null
  DB.app_secrets = [{ key: 'mono_sync', value: 'S' }, { key: 'mono_token:' + CO, value: 'TOK' }]
  DB.accounts = [{ id: 'acc1', name: 'Моно', iban: IBAN, company_id: CO, is_active: true, mono_synced_at: null }]
  DB.companies = [{ id: CO, edrpou: '45505924' }]
  DB.contractors = [{ id: 'c-mti', edrpou: '12345678', default_direction: null, default_article: null }]
  DB.bank_transactions = [
    { id: 'old1', company_id: CO, account_id: 'acc1', date: '2026-10-20', amount: -5000, edrpou: '12345678', reference: 'REF-FILE-1', direction: 'Витрати', article: 'Закупівля товару', is_ignored: false },
  ]
  DB.bank_sync_log = []
  globalThis.fetch = vi.fn(async (url) => {
    const body = url.includes('/ext/v1/accounts') ? [{ iban: IBAN, currency: 980, balance: 1 }, { iban: 'UA000000000000000000000000000', currency: 980 }]
      : [
        op('11111111-1111-1111-1111-111111111111', '2026-10-20T10:00:00Z', -500000, '12345678', 'ТОВ МТІ'),            // уже є з файлу → пропуск
        op('22222222-2222-2222-2222-222222222222', '2026-10-21T10:00:00Z', -120000, '12345678', 'ТОВ МТІ'),            // новий, стаття з історії
        op('33333333-3333-3333-3333-333333333333', '2026-10-22T10:00:00Z', 3000000, '87654321', 'ТОВ НОВИЙ КЛІЄНТ'),   // новий контрагент
        op('44444444-4444-4444-4444-444444444444', '2026-10-22T11:00:00Z', -100, '87654321', 'x', { status: 'PENDING' }),
        op('55555555-5555-5555-5555-555555555555', '2026-09-30T10:00:00Z', -777, '12345678', 'ТОВ МТІ'),               // закритий місяць
      ]
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) }
  })
})

describe('monobank → Банк', () => {
  it('нові операції, дублі, контрагенти, стаття з історії, закритий місяць', async () => {
    failDate = '2026-09-30'
    const out = await call()
    const rep = out.results[0]
    expect(rep.added).toBe(2)
    expect(rep.skipped).toBe(2)          // дубль із файлу + закритий місяць
    const add = DB.bank_transactions.filter(r => r.bank_name === 'Monobank')
    const r2 = add.find(r => r.reference.startsWith('2222'))
    expect(r2).toMatchObject({ date: '2026-10-21', amount: -1200, contractor_id: 'c-mti', direction: 'Витрати', article: 'Закупівля товару', is_validated: false, account_id: 'acc1' })
    const r3 = add.find(r => r.reference.startsWith('3333'))
    expect(r3).toMatchObject({ amount: 30000, direction: 'Доходи', article: null })
    expect(DB.contractors.find(c => c.edrpou === '87654321')).toMatchObject({ name: 'ТОВ НОВИЙ КЛІЄНТ', is_client: true })
    expect(rep.accounts.find(a => a.iban.startsWith('UA0000')).skipped).toMatch(/немає рахунку/)
    expect(DB.accounts[0].mono_synced_at).toBeTruthy()
  })
  it('повторний запуск нічого не дублює', async () => {
    await call()
    const n = DB.bank_transactions.length
    const out = await call()
    expect(out.results[0].added).toBe(0)
    expect(DB.bank_transactions.length).toBe(n)
  })
})

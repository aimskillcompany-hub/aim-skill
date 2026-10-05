// Прогноз майбутнього балансу (грошей) по угодах у роботі — для інвестора.
// Для кожного ВІДКРИТОГО замовлення рахуємо, які грошові потоки ще попереду:
//   clientDue    = виручка (orders.total) − вже отримано від клієнта → очікуване НАДХОДЖЕННЯ;
//   supplierDue  = собівартість (позиції) − вже сплачено постачальнику → очікувана ВИПЛАТА.
// Прогнозні гроші = поточні гроші + Σ надходжень − Σ виплат (по всіх юрособах).
// Два сценарії користувача:
//   (A) оплатив постачальнику, чекаю товар → supplierDue=0, clientDue=виручка (попереду лише надходження);
//   (B) ще не оплатив → і виплата постачальнику, і надходження від клієнта попереду.
import { qc, getActiveCompanyId, setActiveCompanyId } from './companyScope'
import { getAccountBalances } from './accounts'
import { clearCompanyCache } from './companyConfig'
import { supabase } from './supabase'

// Законтрактовані стадії (угода реально в роботі, не просто лід)
const COMMITTED = new Set(['needs_contract', 'ordering_supplier', 'shipped', 'needs_payment', 'paid'])
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export async function computeForecast(companies, { committedOnly = true } = {}) {
  const saved = getActiveCompanyId()
  let nowCash = 0
  const rows = []
  try {
    for (const c of companies) {
      setActiveCompanyId(c.id); clearCompanyCache()

      // Поточні гроші компанії
      const accs = await getAccountBalances()
      nowCash += (accs || []).reduce((s, a) => s + (Number(a.balance) || 0), 0)

      // Відкриті замовлення
      const { data: ords } = await qc('orders')
        .select('id, order_number, status, outcome, total, paid_transaction_id, contractors(name)')
        .neq('status', 'closed')
      const open = (ords || []).filter(o => o.outcome !== 'lost' && (!committedOnly || COMMITTED.has(o.status)))
      const ids = open.map(o => o.id)
      if (!ids.length) continue

      // Собівартість із позицій
      const costByOrder = {}
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from('order_items').select('order_id, qty, cost_price').in('order_id', ids.slice(i, i + 200))
        ;(data || []).forEach(it => { costByOrder[it.order_id] = (costByOrder[it.order_id] || 0) + (Number(it.cost_price) || 0) * (Number(it.qty) || 0) })
      }
      // Оплата постачальнику (supplier_orders: total + status='paid')
      const supPaid = {}, supTotal = {}
      const { data: sos } = await qc('supplier_orders').select('order_id, total, status').in('order_id', ids)
      ;(sos || []).forEach(s => {
        supTotal[s.order_id] = (supTotal[s.order_id] || 0) + (Number(s.total) || 0)
        if (s.status === 'paid') supPaid[s.order_id] = (supPaid[s.order_id] || 0) + (Number(s.total) || 0)
      })

      open.forEach(o => {
        const rev = Number(o.total) || 0
        const cost = costByOrder[o.id] || supTotal[o.id] || 0
        const clientReceived = o.paid_transaction_id ? rev : 0 // є прив'язана оплата → вважаємо отриманою
        const clientDue = Math.max(0, r2(rev - clientReceived))
        const supplierDue = Math.max(0, r2(cost - (supPaid[o.id] || 0)))
        if (clientDue <= 0.5 && supplierDue <= 0.5) return // нічого не очікується
        rows.push({
          id: o.id, company: c.short_name || c.name,
          number: o.order_number || o.id.slice(0, 6),
          client: o.contractors?.name || '—', status: o.status,
          rev, cost, clientDue, supplierDue, margin: r2(rev - cost),
        })
      })
    }
  } finally {
    setActiveCompanyId(saved); clearCompanyCache()
  }

  const sum = (k) => r2(rows.reduce((s, r) => s + (r[k] || 0), 0))
  const totals = {
    nowCash: r2(nowCash),
    clientDue: sum('clientDue'),
    supplierDue: sum('supplierDue'),
    margin: sum('margin'),
  }
  totals.projectedCash = r2(totals.nowCash + totals.clientDue - totals.supplierDue)
  rows.sort((a, b) => (b.clientDue + b.supplierDue) - (a.clientDue + a.supplierDue))
  return { rows, totals }
}

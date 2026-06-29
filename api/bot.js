// API для Telegram-бота. Один ендпоінт, дії через body.action.
// Авторизація: заголовок  Authorization: Bearer <BOT_API_TOKEN>  (env BOT_API_TOKEN).
// Усі операції — service-role (обходить RLS). Тримати BOT_API_TOKEN у Vercel env.
import { getAdmin } from './_lib.js'

const FLOW = {
  trade: ['new', 'proposal_sent', 'confirmed', 'contract_signed', 'invoiced', 'paid_partial',
    'ordering_supplier', 'in_transit', 'ready_to_ship', 'shipped', 'docs_received', 'closed'],
  service: ['new', 'invoiced', 'paid', 'closed'],
  agent: ['new', 'client_transferred', 'deal_done', 'invoiced', 'closed'],
}
const STATUS_LABEL = {
  new: 'Новий', proposal_sent: 'КП надіслано', confirmed: 'Підтверджено', contract_signed: 'Договір підписано',
  invoiced: 'Рахунок виставлено', paid_partial: 'Часткова оплата', ordering_supplier: 'Замовлення дистриб.',
  in_transit: 'В дорозі', ready_to_ship: 'Готово до відправки', shipped: 'Відвантажено',
  docs_received: 'Документи отримано', closed: 'Закрито', paid: 'Оплачено',
  client_transferred: 'Клієнт переданий', deal_done: 'Угода закрита',
}
const VALID_TYPES = ['trade', 'service', 'agent']
const nextStatus = (type, status) => {
  const f = FLOW[type] || FLOW.trade
  const i = f.indexOf(status)
  return i >= 0 && i < f.length - 1 ? f[i + 1] : status
}
const grossUnit = (r) => {
  const p = Number(r.unit_price) || 0, v = Number(r.vat_rate) || 0
  return r.price_includes_vat ? p : p * (1 + v / 100)
}

function checkAuth(req) {
  const token = process.env.BOT_API_TOKEN
  if (!token) return false
  const auth = req.headers['authorization'] || req.headers['Authorization'] || ''
  return auth.startsWith('Bearer ') && auth.slice(7) === token
}

async function recalcTotal(admin, orderId) {
  const { data } = await admin.from('order_items').select('qty, unit_price, vat_rate, price_includes_vat').eq('order_id', orderId)
  const total = (data || []).reduce((s, r) => s + grossUnit(r) * (Number(r.qty) || 0), 0)
  await admin.from('orders').update({ total }).eq('id', orderId)
  return total
}

async function findOrCreateClient(admin, c) {
  if (c?.id) return c.id
  if (c?.edrpou) {
    const { data } = await admin.from('contractors').select('id').eq('edrpou', c.edrpou).maybeSingle()
    if (data) return data.id
  }
  if (c?.name) {
    const { data } = await admin.from('contractors').select('id').ilike('name', c.name).maybeSingle()
    if (data) return data.id
  }
  const { data: created, error } = await admin.from('contractors')
    .insert({ name: c?.name || 'Клієнт з бота', edrpou: c?.edrpou || null, email: c?.email || null, phone: c?.phone || null, is_client: true })
    .select('id').single()
  if (error) throw new Error(error.message)
  return created.id
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { action, ...p } = req.body || {}
  const admin = getAdmin()
  try {
    switch (action) {

      // ── Список заявок ──
      case 'listOrders': {
        let q = admin.from('orders').select('id, order_number, type, status, total, created_at, contractors(name)')
        if (!p.includeArchived) q = q.is('archived_at', null)
        if (p.status) q = q.eq('status', p.status)
        else if (!p.includeClosed) q = q.neq('status', 'closed')
        if (p.clientId) q = q.eq('client_id', p.clientId)
        const { data, error } = await q.order('created_at', { ascending: false }).limit(p.limit || 50)
        if (error) throw error
        return res.json({ ok: true, orders: (data || []).map(o => ({ ...o, statusLabel: STATUS_LABEL[o.status] || o.status, client: o.contractors?.name })) })
      }

      // ── Картка заявки ──
      case 'getOrder': {
        const [{ data: order }, { data: items }, { data: props }, { data: subs }] = await Promise.all([
          admin.from('orders').select('*, contractors(name, edrpou)').eq('id', p.orderId).single(),
          admin.from('order_items').select('*').eq('order_id', p.orderId).order('created_at'),
          admin.from('commercial_proposals').select('id, version, total, status, sent_at').eq('order_id', p.orderId).order('version', { ascending: false }),
          admin.from('supplier_orders').select('*, contractors(name)').eq('order_id', p.orderId),
        ])
        if (!order) return res.status(404).json({ error: 'Замовлення не знайдено' })
        return res.json({ ok: true, order: { ...order, statusLabel: STATUS_LABEL[order.status] || order.status }, items: items || [], proposals: props || [], supplierOrders: subs || [] })
      }

      // ── Створити заявку ──
      case 'createOrder': {
        const type = VALID_TYPES.includes(p.type) ? p.type : 'trade'
        const clientId = await findOrCreateClient(admin, p.client || { id: p.clientId })
        const { count } = await admin.from('orders').select('id', { count: 'exact', head: true })
        const order_number = String((count || 0) + 1).padStart(4, '0')
        const { data: order, error } = await admin.from('orders').insert({
          order_number, type, status: 'new', client_id: clientId,
          total: 0, description: p.description || null,
          procurement_type: p.procurementType || 'direct',
        }).select('id, order_number').single()
        if (error) throw error
        if (Array.isArray(p.items) && p.items.length) {
          await admin.from('order_items').insert(p.items.map(it => ({
            order_id: order.id, name: it.name, sku: it.sku || null, unit: it.unit || 'шт',
            qty: Number(it.qty) || 0, unit_price: Number(it.unit_price) || 0,
            vat_rate: it.vat_rate ?? 20, price_includes_vat: it.price_includes_vat ?? false,
            cost_price: Number(it.cost_price) || 0, supplier_id: it.supplier_id || null,
            total: (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
          })))
          await recalcTotal(admin, order.id)
        }
        return res.json({ ok: true, orderId: order.id, orderNumber: order.order_number })
      }

      // ── Додати товари ──
      case 'addItems': {
        if (!p.orderId || !Array.isArray(p.items)) return res.status(400).json({ error: 'orderId та items обовʼязкові' })
        const { error } = await admin.from('order_items').insert(p.items.map(it => ({
          order_id: p.orderId, name: it.name, sku: it.sku || null, unit: it.unit || 'шт',
          qty: Number(it.qty) || 0, unit_price: Number(it.unit_price) || 0,
          vat_rate: it.vat_rate ?? 20, price_includes_vat: it.price_includes_vat ?? false,
          cost_price: Number(it.cost_price) || 0, supplier_id: it.supplier_id || null,
          total: (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
        })))
        if (error) throw error
        const total = await recalcTotal(admin, p.orderId)
        return res.json({ ok: true, total })
      }

      // ── Наступний статус ──
      case 'advance': {
        const { data: o } = await admin.from('orders').select('type, status').eq('id', p.orderId).single()
        if (!o) return res.status(404).json({ error: 'Замовлення не знайдено' })
        const ns = nextStatus(o.type, o.status)
        const upd = { status: ns }
        if (ns === 'closed') upd.closed_at = new Date().toISOString()
        await admin.from('orders').update(upd).eq('id', p.orderId)
        return res.json({ ok: true, status: ns, statusLabel: STATUS_LABEL[ns] || ns })
      }

      // ── Встановити конкретний статус ──
      case 'setStatus': {
        const upd = { status: p.status }
        if (p.status === 'closed') upd.closed_at = new Date().toISOString()
        const { error } = await admin.from('orders').update(upd).eq('id', p.orderId)
        if (error) throw error
        return res.json({ ok: true, status: p.status, statusLabel: STATUS_LABEL[p.status] || p.status })
      }

      // ── Пошук клієнта ──
      case 'findClient': {
        const term = (p.q || '').trim()
        if (term.length < 2) return res.json({ ok: true, clients: [] })
        const { data } = await admin.from('contractors').select('id, name, edrpou')
          .or(`name.ilike.%${term}%,edrpou.ilike.%${term}%`).eq('is_client', true).limit(10)
        return res.json({ ok: true, clients: data || [] })
      }

      // ── Пошук товару в прайсах ──
      case 'searchPrices': {
        const tokens = (p.q || '').trim().split(/[\s,'"`’ʼ()«»]+/).map(t => t.replace(/[%(),]/g, '')).filter(t => t.length >= 2).slice(0, 12)
        if (!tokens.length) return res.json({ ok: true, prices: [] })
        let q = admin.from('supplier_prices').select('id, sku, name, price, retail_price, in_stock, supplier_id, contractors(name)')
        for (const tok of tokens) q = q.or(`name.ilike.%${tok}%,sku.ilike.%${tok}%`)
        const { data } = await q.limit(p.limit || 30)
        return res.json({ ok: true, prices: (data || []).map(r => ({ ...r, supplier: r.contractors?.name })) })
      }

      // ── Прострочення (для сповіщень) ──
      case 'overdue': {
        const cutoff = new Date(Date.now() - 48 * 3600e3).toISOString()
        const today = new Date().toISOString().slice(0, 10)
        const [{ data: late }, { data: due }] = await Promise.all([
          admin.from('commercial_proposals').select('order_id, sent_at, total').eq('status', 'sent').lt('sent_at', cutoff),
          admin.from('supplier_orders').select('order_id, supplier_id, payment_due_date, total, contractors(name)').neq('status', 'paid').lt('payment_due_date', today),
        ])
        return res.json({ ok: true, proposalsOverdue: late || [], paymentsOverdue: due || [] })
      }

      default:
        return res.status(400).json({ error: 'Невідома дія: ' + action })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

# Інтеграція Telegram-бота із системою AiM Skill

Документ для проєктування Telegram-бота, що працює з **заявками (замовленнями)**.
Орієнтований на розробника бота: модель даних, статуси, готові приклади запитів.

> Стан системи: див. `CONTEXT.md`. Загальний опис: `ОПИС_СИСТЕМИ.md`.

---

## 1. Підключення

- **База:** Supabase (Postgres + REST / JS-клієнт)
- **URL:** `https://ivhfwdojjaflvdbdmttf.supabase.co`
- **Ключ для бота:** **service-role** (Supabase → Settings → API). Обходить RLS — бот працює як сервер.
- Зберігати ключ лише на сервері бота (env), не в коді/репозиторії.

```js
// server-side (бот)
import { createClient } from '@supabase/supabase-js'
const sb = createClient(
  process.env.SUPABASE_URL,            // https://ivhfwdojjaflvdbdmttf.supabase.co
  process.env.SUPABASE_SERVICE_KEY,    // service-role ключ
  { auth: { persistSession: false } }
)
```

> **Рекомендована архітектура:** бот ходить не напряму в базу, а у **серверний ендпоінт** системи (як `api/order-from-email.js`). Це безпечніше (валідація, єдина бізнес-логіка). Прямий доступ у базу — швидший старт, але дублює логіку. Нижче — приклади для прямого доступу; їх легко перенести в ендпоінт.

---

## 2. Модель даних (заявки)

### `orders` — заявка
| Поле | Тип | Нотатка |
|---|---|---|
| `id` | uuid | PK (default) |
| `order_number` | text | «0001»… = `padStart(count+1, 4, '0')` |
| `type` | text | `trade` \| `service` \| `agent` |
| `status` | text | поточний статус (див. §3) |
| `client_id` | uuid | FK `contractors.id` |
| `total` | numeric | Σ товарів з ПДВ (синхронізується) |
| `description` | text | опис |
| `procurement_type` | text | `direct` \| `tender` |
| `created_by` | uuid | FK `profiles.id` (опц.) |
| `created_at` | timestamptz | default now() |
| `closed_at` | timestamptz | ставиться при `closed` |
| `archived_at` | timestamptz | не null → в архіві |
| `reminder_sent_at` | timestamptz | для нагадувань |

### `order_items` — товари заявки
`id, order_id, product_id?, name, sku, unit, qty, unit_price, vat_rate (0|20), price_includes_vat (bool), cost_price, supplier_id?, total, created_at`
- `price_includes_vat`: `true` — ціна вже з ПДВ; `false` — ПДВ зверху.
- `supplier_id` — з чийого прайсу позиція (для авто-субзамовлень).

### `commercial_proposals` — КП
`id, order_id, version, items(jsonb), total, status (draft|sent|accepted|rejected), sent_at, created_by, created_at`
- `items` = `[{ name, qty, price, vat, incl }]` (price з ПДВ; `incl` — чи в ціні ПДВ).

### `supplier_orders` — субзамовлення
`id, order_id, supplier_id, status (new|ordered|in_transit|received|paid), total, payment_delay_days, payment_due_date, source (auto|manual), created_at`

### `supplier_order_items`
`id, supplier_order_id, product_id, name, sku, unit, qty, cost_price, assembly_id, created_at`

### `documents` (прив'язка до заявки)
`documents.order_id` → документ належить заявці. Борг створюють лише накладні/акти (не рахунок/КП).

### `contractors` (клієнти/постачальники)
Ключове: `id, name, short_name, edrpou, is_client, is_supplier, legal_address, address, phone, email`.

---

## 3. Статуси (воронки за `type`)

```
trade:   new → proposal_sent → confirmed → contract_signed → invoiced →
         paid_partial → ordering_supplier → in_transit → ready_to_ship →
         shipped → docs_received → closed
service: new → invoiced → paid → closed
agent:   new → client_transferred → deal_done → invoiced → closed
```

Хелпер «наступний статус»:

```js
const FLOW = {
  trade: ['new','proposal_sent','confirmed','contract_signed','invoiced','paid_partial',
          'ordering_supplier','in_transit','ready_to_ship','shipped','docs_received','closed'],
  service: ['new','invoiced','paid','closed'],
  agent: ['new','client_transferred','deal_done','invoiced','closed'],
}
const STATUS_LABEL = {
  new:'Новий', proposal_sent:'КП надіслано', confirmed:'Підтверджено',
  contract_signed:'Договір підписано', invoiced:'Рахунок виставлено',
  paid_partial:'Часткова оплата', ordering_supplier:'Замовлення дистриб.',
  in_transit:'В дорозі', ready_to_ship:'Готово до відправки', shipped:'Відвантажено',
  docs_received:'Документи отримано', closed:'Закрито',
  paid:'Оплачено', client_transferred:'Клієнт переданий', deal_done:'Угода закрита',
}
function nextStatus(type, status) {
  const f = FLOW[type] || FLOW.trade
  const i = f.indexOf(status)
  return i >= 0 && i < f.length - 1 ? f[i + 1] : status
}
```

---

## 4. Готові операції бота

### 4.1 Список активних заявок
```js
const { data } = await sb.from('orders')
  .select('id, order_number, type, status, total, contractors(name)')
  .is('archived_at', null).neq('status', 'closed')
  .order('created_at', { ascending: false })
```

### 4.2 Заявки конкретного клієнта
```js
const { data } = await sb.from('orders')
  .select('*').eq('client_id', clientId).order('created_at', { ascending: false })
```

### 4.3 Картка заявки (з усім)
```js
const [{ data: order }, { data: items }, { data: props }, { data: subs }] = await Promise.all([
  sb.from('orders').select('*, contractors(name, edrpou)').eq('id', orderId).single(),
  sb.from('order_items').select('*').eq('order_id', orderId).order('created_at'),
  sb.from('commercial_proposals').select('*').eq('order_id', orderId).order('version', { ascending: false }),
  sb.from('supplier_orders').select('*, contractors(name)').eq('order_id', orderId),
])
```

### 4.4 Знайти або створити клієнта
```js
async function findOrCreateClient({ name, edrpou, email, phone }) {
  if (edrpou) {
    const { data } = await sb.from('contractors').select('id').eq('edrpou', edrpou).maybeSingle()
    if (data) return data.id
  }
  const { data: byName } = await sb.from('contractors').select('id').ilike('name', name).maybeSingle()
  if (byName) return byName.id
  const { data: created } = await sb.from('contractors')
    .insert({ name, edrpou: edrpou || null, email: email || null, phone: phone || null, is_client: true })
    .select('id').single()
  return created.id
}
```

### 4.5 Створити заявку
```js
async function createOrder({ type = 'trade', clientId, description, createdBy = null }) {
  const { count } = await sb.from('orders').select('id', { count: 'exact', head: true })
  const order_number = String((count || 0) + 1).padStart(4, '0')
  const { data } = await sb.from('orders').insert({
    order_number, type, status: 'new', client_id: clientId,
    total: 0, description: description || null, created_by: createdBy,
  }).select('id, order_number').single()
  return data
}
```

### 4.6 Додати товари + оновити суму
```js
async function addItems(orderId, items) {
  // item: { name, sku?, unit?, qty, unit_price, vat_rate?, price_includes_vat?, cost_price?, supplier_id? }
  const rows = items.map(it => ({
    order_id: orderId, name: it.name, sku: it.sku || null, unit: it.unit || 'шт',
    qty: Number(it.qty) || 0, unit_price: Number(it.unit_price) || 0,
    vat_rate: it.vat_rate ?? 20, price_includes_vat: it.price_includes_vat ?? false,
    cost_price: Number(it.cost_price) || 0, supplier_id: it.supplier_id || null,
    total: (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
  }))
  await sb.from('order_items').insert(rows)
  // сума з ПДВ
  const { data: all } = await sb.from('order_items').select('qty, unit_price, vat_rate, price_includes_vat').eq('order_id', orderId)
  const total = (all || []).reduce((s, r) => {
    const p = Number(r.unit_price) || 0, q = Number(r.qty) || 0, v = Number(r.vat_rate) || 0
    const gross = r.price_includes_vat ? p : p * (1 + v / 100)
    return s + gross * q
  }, 0)
  await sb.from('orders').update({ total }).eq('id', orderId)
}
```

### 4.7 Перевести статус («наступна дія»)
```js
async function advance(orderId) {
  const { data: o } = await sb.from('orders').select('type, status').eq('id', orderId).single()
  const ns = nextStatus(o.type, o.status)
  const upd = { status: ns }
  if (ns === 'closed') upd.closed_at = new Date().toISOString()
  await sb.from('orders').update(upd).eq('id', orderId)
  return ns
}
```

### 4.8 Пошук товару в прайсах (для підбору)
```js
const tokens = q.trim().split(/[\s,'"`’ʼ()«»]+/).filter(t => t.length >= 2).slice(0, 12)
let query = sb.from('supplier_prices')
  .select('id, sku, name, price, retail_price, in_stock, supplier_id, contractors(name)')
for (const tok of tokens) query = query.or(`name.ilike.%${tok}%,sku.ilike.%${tok}%`)
const { data } = await query.limit(50)
// price = закупівля (грн), retail_price = роздріб; додавати в order_items:
// unit_price = retail_price, cost_price = price, supplier_id = row.supplier_id, price_includes_vat = true
```

### 4.9 Прострочення (для сповіщень)
```js
// КП без відповіді > 48 год
const { data: late } = await sb.from('commercial_proposals')
  .select('order_id, sent_at').eq('status', 'sent')
  .lt('sent_at', new Date(Date.now() - 48 * 3600e3).toISOString())
// Прострочена оплата постачальнику
const today = new Date().toISOString().slice(0, 10)
const { data: duePay } = await sb.from('supplier_orders')
  .select('order_id, supplier_id, payment_due_date').neq('status', 'paid').lt('payment_due_date', today)
```

### 4.10 Створити заявку з повідомлення (як з листа)
Готова логіка вже є серверно в `api/order-from-email.js` (AI → клієнт+позиції+документи). Для бота:
- або викликати аналогічний ендпоінт,
- або: розпарсити текст → `findOrCreateClient` → `createOrder` → `addItems`.

---

## 5. Що бот НЕ робить напряму
- **PDF-документи** (рахунок/накладна/КП/замовлення постачальнику) генеруються в браузері (pdfmake). Бот може створювати **записи** (`generated_docs` + дзеркало в `documents`), але сам PDF — окремим шаблоном на сервері бота або лишити генерацію в застосунку.
- При створенні дзеркала в `documents`: обов'язково `file_path` (NOT NULL), `source='generated'`, не дублювати за (contractor_id+type+doc_number) — інакше задвоїться борг.

## 6. Правила, які треба памʼятати
- Борг = накладні/акти − платежі (рахунок/КП/замовлення борг НЕ створюють).
- ПДВ — на рівні позиції (`vat_rate`, `price_includes_vat`).
- `archived_at` — м'яке приховування; видалення заявки каскадить КП/субзамовлення, документи відв'язуються.
- Усі суми в гривні; валюта прайсу конвертується при імпорті (бот працює вже з грн-цінами).

## 7. Ідеї сценаріїв бота
- **Сповіщення:** нові заявки, прострочені КП/оплати, зміна статусу.
- **Кнопки:** «Наступна дія», «Закрити», «Архівувати».
- **Створення заявки** з пересланого повідомлення/файлу (AI-парсинг).
- **Підбір товару** з прайсів і додавання в заявку.
- **Дайджест:** активні заявки по менеджеру/клієнту, сума в роботі.

---

*Поля звірені з реальною схемою бази станом на 2026-06-29.*

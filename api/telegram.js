// Telegram-бот для AiM Skill (вебхук). Працює 24/7 у Vercel.
// Налаштування webhook (один раз):
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://aim-skill.vercel.app/api/telegram
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_IDS (через кому), TELEGRAM_OWNER_ID, APP_URL
import { getAdmin } from './_lib.js'

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim()
const ALLOWED = (process.env.TELEGRAM_ALLOWED_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
const OWNER = (process.env.TELEGRAM_OWNER_ID || '').trim()
const APP_URL = process.env.APP_URL || 'https://aim-skill.vercel.app'
const orderUrl = (id) => `${APP_URL}/#/orders/${id}`

const STATUS_LABEL = {
  new: 'Новий', proposal_sent: 'КП надіслано', confirmed: 'Підтверджено', contract_signed: 'Договір підписано',
  invoiced: 'Рахунок виставлено', paid_partial: 'Часткова оплата', ordering_supplier: 'Замовлення дистриб.',
  in_transit: 'В дорозі', ready_to_ship: 'Готово до відправки', shipped: 'Відвантажено',
  docs_received: 'Документи отримано', closed: 'Закрито', paid: 'Оплачено',
  client_transferred: 'Клієнт переданий', deal_done: 'Угода закрита',
}
const SOURCE_LABEL = { recommendation: 'Рекомендація', tender: 'Тендер', cold: 'Холодний', other: 'Інше' }
const DOC_TYPE_LABEL = {
  invoice: 'Рахунок на оплату', waybill: 'Видаткова накладна', serviceAct: 'Акт наданих послуг',
  incomingWaybill: 'Прихідна накладна', commercialProposal: 'Комерційна пропозиція',
  loanAgreement: 'Договір фін. допомоги', supplyAgreement: 'Договір поставки',
  purchaseOrder: 'Замовлення постачальнику', salesOrder: 'Замовлення від клієнта',
}
const fmt = (n) => (Number(n) || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Telegram API ──
async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  return r.json()
}
const send = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
const answer = (id, text) => tg('answerCallbackQuery', { callback_query_id: id, text: text || '' })

// ── Сесія діалогу (bot_sessions) ──
async function getSession(admin, tgId) {
  const { data } = await admin.from('bot_sessions').select('state').eq('telegram_id', tgId).maybeSingle()
  return data?.state || null
}
const setSession = (admin, tgId, state) => admin.from('bot_sessions').upsert({ telegram_id: tgId, state, updated_at: new Date().toISOString() })
const clearSession = (admin, tgId) => admin.from('bot_sessions').delete().eq('telegram_id', tgId)

const isAllowed = (id) => ALLOWED.length === 0 ? false : ALLOWED.includes(String(id))

// ── Створення заявки (клієнта НЕ створюємо автоматично) ──
async function createOrder(admin, s) {
  const { count } = await admin.from('orders').select('id', { count: 'exact', head: true })
  const order_number = String((count || 0) + 1).padStart(4, '0')
  const desc = [
    s.need,
    !s.clientId && s.company ? `Клієнт (не призначений): ${s.company}` : null,
    s.contact ? `Контакт: ${s.contact}` : null,
    s.phone ? `Тел./email: ${s.phone}` : null,
  ].filter(Boolean).join('\n')
  const { data } = await admin.from('orders').insert({
    order_number, type: 'trade', status: 'new', client_id: s.clientId || null,
    total: 0, description: desc || null, lead_source: s.source || null,
  }).select('id, order_number').single()
  return data
}

// ── Тексти ──
const MAIN_KB = { keyboard: [['➕ Нова заявка'], ['📋 Заявки', '🔍 Пошук']], resize_keyboard: true }
const cancelKb = { inline_keyboard: [[{ text: '✖️ Скасувати', callback_data: 'cancel' }]] }
const sourceKb = {
  inline_keyboard: [
    [{ text: 'Рекомендація', callback_data: 'src:recommendation' }, { text: 'Тендер', callback_data: 'src:tender' }],
    [{ text: 'Холодний', callback_data: 'src:cold' }, { text: 'Інше', callback_data: 'src:other' }],
  ],
}

function orderCardText(order, items, props, subs) {
  const lines = [
    `<b>Заявка ${order.order_number}</b> — ${STATUS_LABEL[order.status] || order.status}`,
    `Клієнт: ${order.contractors?.name || '—'}`,
    order.lead_source ? `Джерело: ${SOURCE_LABEL[order.lead_source] || order.lead_source}` : null,
    `Сума: ${fmt(order.total)} грн`,
    `Дата: ${(order.created_at || '').slice(0, 10)}`,
    order.description ? `\n${order.description}` : null,
  ].filter(Boolean)
  if (items.length) lines.push('\n<b>Товари:</b>\n' + items.map(i => `• ${i.name} — ${i.qty} ${i.unit || 'шт'}`).join('\n'))
  if (props.length) lines.push(`\nКП: версія ${props[0].version} (${props[0].status})`)
  if (subs.length) lines.push(`Субзамовлень: ${subs.length}`)
  return lines.join('\n')
}

async function showList(admin, chatId, offset = 0) {
  const limit = 8
  const { data } = await admin.from('orders').select('id, order_number, status, total, contractors(name)')
    .is('archived_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (!data || !data.length) return send(chatId, offset ? 'Більше заявок немає.' : 'Заявок ще немає.', { reply_markup: MAIN_KB })
  const rows = data.map(o => [{ text: `№${o.order_number} · ${o.contractors?.name || '—'} · ${STATUS_LABEL[o.status] || o.status}`, callback_data: `order:${o.id}` }])
  if (data.length === limit) rows.push([{ text: '⬇️ Ще', callback_data: `page:${offset + limit}` }])
  return send(chatId, '<b>Заявки:</b>', { reply_markup: { inline_keyboard: rows } })
}

async function showCard(admin, chatId, orderId) {
  const [{ data: order }, { data: items }, { data: props }, { data: subs }, { data: docs }] = await Promise.all([
    admin.from('orders').select('*, contractors(name)').eq('id', orderId).single(),
    admin.from('order_items').select('name, qty, unit').eq('order_id', orderId).order('created_at'),
    admin.from('commercial_proposals').select('id, version, status, storage_path').eq('order_id', orderId).order('version', { ascending: false }),
    admin.from('supplier_orders').select('id').eq('order_id', orderId),
    admin.from('documents').select('id').eq('order_id', orderId),
  ])
  if (!order) return send(chatId, 'Заявку не знайдено.')
  const kb = [[{ text: '🔗 Відкрити в системі', url: orderUrl(orderId) }]]
  if ((props || []).length) kb.unshift([{ text: `📑 КП (${props.length})`, callback_data: `kps:${orderId}` }])
  if ((docs || []).length) kb.unshift([{ text: `📄 Документи (${docs.length})`, callback_data: `docs:${orderId}` }])
  return send(chatId, orderCardText(order, items || [], props || [], subs || []), { reply_markup: { inline_keyboard: kb } })
}

async function showDocs(admin, chatId, orderId) {
  const { data } = await admin.from('documents').select('id, type, doc_number, file_name, storage_path').eq('order_id', orderId).order('created_at', { ascending: false })
  if (!data || !data.length) return send(chatId, 'Документів немає.')
  const rows = data.map(d => [{
    text: `${DOC_TYPE_LABEL[d.type] || d.type}${d.doc_number ? ` №${d.doc_number}` : ''}${d.storage_path ? '' : ' (без файлу)'}`.slice(0, 60),
    callback_data: d.storage_path ? `doc:${d.id}` : `nofile:${d.id}`,
  }])
  return send(chatId, '<b>Документи заявки:</b>', { reply_markup: { inline_keyboard: rows } })
}

async function showKps(admin, chatId, orderId) {
  const { data } = await admin.from('commercial_proposals').select('id, version, total, status, storage_path').eq('order_id', orderId).order('version', { ascending: false })
  if (!data || !data.length) return send(chatId, 'КП немає.')
  const rows = data.map(p => [{
    text: `Версія ${p.version} · ${fmt(p.total)} грн · ${p.status}${p.storage_path ? '' : ' (без файлу)'}`.slice(0, 60),
    callback_data: p.storage_path ? `kp:${p.id}` : 'kpnofile',
  }])
  return send(chatId, '<b>Комерційні пропозиції:</b>', { reply_markup: { inline_keyboard: rows } })
}

async function sendKp(admin, chatId, kpId) {
  const { data: p } = await admin.from('commercial_proposals').select('storage_path, version').eq('id', kpId).single()
  if (!p?.storage_path) return send(chatId, 'Файл КП не збережено — відкрийте «Переглянути» в системі.')
  const { data: signed } = await admin.storage.from('documents').createSignedUrl(p.storage_path, 600)
  if (!signed?.signedUrl) return send(chatId, 'Не вдалося отримати файл.')
  return tg('sendDocument', { chat_id: chatId, document: signed.signedUrl, caption: `Комерційна пропозиція, версія ${p.version}` })
}

async function sendDoc(admin, chatId, docId) {
  const { data: d } = await admin.from('documents').select('storage_path, file_name, type, doc_number').eq('id', docId).single()
  if (!d?.storage_path) return send(chatId, 'Файл недоступний — відкрийте в системі.')
  const { data: signed } = await admin.storage.from('documents').createSignedUrl(d.storage_path, 600)
  if (!signed?.signedUrl) return send(chatId, 'Не вдалося отримати файл.')
  const caption = `${DOC_TYPE_LABEL[d.type] || d.type}${d.doc_number ? ` №${d.doc_number}` : ''}`
  return tg('sendDocument', { chat_id: chatId, document: signed.signedUrl, caption })
}

// ── Головний обробник ──
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true })
  if (!TOKEN) return res.status(200).json({ ok: false, error: 'no token' })
  const admin = getAdmin()
  const upd = req.body || {}

  try {
    // Callback-кнопки
    if (upd.callback_query) {
      const cq = upd.callback_query
      const chatId = cq.message.chat.id
      const fromId = cq.from.id
      if (!isAllowed(fromId)) { await answer(cq.id, 'Немає доступу'); return res.json({ ok: true }) }
      const data = cq.data || ''
      await answer(cq.id)

      if (data === 'cancel') { await clearSession(admin, fromId); await send(chatId, 'Скасовано.', { reply_markup: MAIN_KB }); return res.json({ ok: true }) }
      if (data.startsWith('client:')) {
        const s = (await getSession(admin, fromId)) || {}
        if (s.step !== 'pickClient') { await send(chatId, 'Сесія застаріла. Почніть знову: ➕ Нова заявка'); return res.json({ ok: true }) }
        const v = data.slice(7)
        if (v === 'none') { s.clientId = null }
        else { s.clientId = v; const { data: c } = await admin.from('contractors').select('name').eq('id', v).maybeSingle(); if (c) s.company = c.name }
        s.step = 'contact'; await setSession(admin, fromId, s)
        await send(chatId, '👤 <b>Контактна особа</b> (або «-»):', { reply_markup: cancelKb })
        return res.json({ ok: true })
      }
      if (data.startsWith('order:')) { await showCard(admin, chatId, data.slice(6)); return res.json({ ok: true }) }
      if (data.startsWith('docs:')) { await showDocs(admin, chatId, data.slice(5)); return res.json({ ok: true }) }
      if (data.startsWith('doc:')) { await sendDoc(admin, chatId, data.slice(4)); return res.json({ ok: true }) }
      if (data.startsWith('nofile:')) { await send(chatId, 'Для цього документа файл не збережено — відкрийте заявку в системі.'); return res.json({ ok: true }) }
      if (data.startsWith('kps:')) { await showKps(admin, chatId, data.slice(4)); return res.json({ ok: true }) }
      if (data.startsWith('kp:')) { await sendKp(admin, chatId, data.slice(3)); return res.json({ ok: true }) }
      if (data === 'kpnofile') { await send(chatId, 'Файл КП не збережено. Відкрийте КП → «Переглянути» в системі, щоб зберегти.'); return res.json({ ok: true }) }
      if (data.startsWith('page:')) { await showList(admin, chatId, Number(data.slice(5)) || 0); return res.json({ ok: true }) }
      if (data.startsWith('src:')) {
        const s = (await getSession(admin, fromId)) || {}
        if (s.step !== 'source') { await send(chatId, 'Сесія застаріла. Почніть знову: ➕ Нова заявка'); return res.json({ ok: true }) }
        s.source = data.slice(4)
        const order = await createOrder(admin, s)
        await clearSession(admin, fromId)
        const note = s.clientId ? '' : '\n⚠️ Клієнта не призначено — оберіть/додайте в системі.'
        await send(chatId, `✅ Заявку <b>${order.order_number}</b> створено.${note}`, { reply_markup: MAIN_KB })
        // Сповіщення власнику
        if (OWNER && String(OWNER) !== String(fromId)) {
          const txt = [`🆕 <b>Нова заявка ${order.order_number}</b>`,
            `Клієнт: ${s.company}${s.clientId ? '' : ' (не призначений у базі)'}`,
            s.contact ? `Контакт: ${s.contact}` : null, s.phone ? `Тел./email: ${s.phone}` : null,
            s.need ? `Потреба: ${s.need}` : null, `Джерело: ${SOURCE_LABEL[s.source] || s.source}`,
            `Від: ${cq.from.first_name || ''} @${cq.from.username || fromId}`].filter(Boolean).join('\n')
          await send(OWNER, txt, { reply_markup: { inline_keyboard: [[{ text: '🔗 Відкрити', url: orderUrl(order.id) }]] } })
        }
        return res.json({ ok: true })
      }
      return res.json({ ok: true })
    }

    // Повідомлення
    const msg = upd.message
    if (!msg || !msg.text) return res.json({ ok: true })
    const chatId = msg.chat.id
    const fromId = msg.from.id
    const text = msg.text.trim()

    if (!isAllowed(fromId)) {
      await send(chatId, `Немає доступу. Ваш Telegram ID: <code>${fromId}</code>\nПередайте його власнику для додавання.`)
      return res.json({ ok: true })
    }

    // Команди / кнопки головного меню
    if (text === '/start') {
      await clearSession(admin, fromId)
      await send(chatId, 'Вітаю в боті AiM Skill 👋\nОберіть дію:', { reply_markup: MAIN_KB })
      return res.json({ ok: true })
    }
    if (text === '➕ Нова заявка' || text === '/new') {
      await setSession(admin, fromId, { step: 'company' })
      await send(chatId, '🏢 Введіть <b>назву компанії клієнта</b>:', { reply_markup: cancelKb })
      return res.json({ ok: true })
    }
    if (text === '📋 Заявки' || text === '/orders') { await showList(admin, chatId, 0); return res.json({ ok: true }) }
    if (text === '🔍 Пошук' || text === '/find') {
      await setSession(admin, fromId, { step: 'search' })
      await send(chatId, '🔍 Введіть <b>номер заявки</b> або <b>назву клієнта</b>:', { reply_markup: cancelKb })
      return res.json({ ok: true })
    }

    // Майстер за станом
    const s = await getSession(admin, fromId)
    if (s?.step === 'search') {
      await clearSession(admin, fromId)
      const term = text
      let { data } = await admin.from('orders').select('id, order_number, status, contractors(name)').ilike('order_number', `%${term}%`).limit(10)
      if (!data?.length) {
        const { data: cl } = await admin.from('contractors').select('id').ilike('name', `%${term}%`).limit(20)
        const ids = (cl || []).map(c => c.id)
        if (ids.length) data = (await admin.from('orders').select('id, order_number, status, contractors(name)').in('client_id', ids).limit(20)).data
      }
      if (!data?.length) { await send(chatId, 'Нічого не знайдено.', { reply_markup: MAIN_KB }); return res.json({ ok: true }) }
      const rows = data.map(o => [{ text: `№${o.order_number} · ${o.contractors?.name || '—'} · ${STATUS_LABEL[o.status] || o.status}`, callback_data: `order:${o.id}` }])
      await send(chatId, '<b>Знайдено:</b>', { reply_markup: { inline_keyboard: rows } })
      return res.json({ ok: true })
    }
    if (s?.step === 'company') {
      s.company = text
      const { data: matches } = await admin.from('contractors').select('id, name, edrpou').ilike('name', `%${text}%`).eq('is_client', true).limit(8)
      if (matches && matches.length) {
        s.step = 'pickClient'; await setSession(admin, fromId, s)
        const rows = matches.map(c => [{ text: `${c.name}${c.edrpou ? ` (${c.edrpou})` : ''}`.slice(0, 60), callback_data: `client:${c.id}` }])
        rows.push([{ text: '➕ Новий клієнт (вкажу в системі)', callback_data: 'client:none' }])
        rows.push([{ text: '✖️ Скасувати', callback_data: 'cancel' }])
        await send(chatId, `Знайдено в базі за «${text}». Оберіть клієнта або «Новий»:`, { reply_markup: { inline_keyboard: rows } })
      } else {
        s.clientId = null; s.step = 'contact'; await setSession(admin, fromId, s)
        await send(chatId, 'Збігів у базі немає — клієнта призначиш у системі.\n👤 <b>Контактна особа</b> (або «-»):', { reply_markup: cancelKb })
      }
      return res.json({ ok: true })
    }
    if (s?.step === 'contact') { s.contact = text === '-' ? '' : text; s.step = 'phone'; await setSession(admin, fromId, s); await send(chatId, '📞 <b>Телефон або email</b> (або «-»):', { reply_markup: cancelKb }); return res.json({ ok: true }) }
    if (s?.step === 'phone') { s.phone = text === '-' ? '' : text; s.step = 'need'; await setSession(admin, fromId, s); await send(chatId, '📝 <b>Що потрібно клієнту?</b> (вільний текст):', { reply_markup: cancelKb }); return res.json({ ok: true }) }
    if (s?.step === 'need') { s.need = text; s.step = 'source'; await setSession(admin, fromId, s); await send(chatId, '📍 <b>Звідки контакт?</b>', { reply_markup: sourceKb }); return res.json({ ok: true }) }

    await send(chatId, 'Оберіть дію з меню нижче 👇', { reply_markup: MAIN_KB })
    return res.json({ ok: true })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message })
  }
}

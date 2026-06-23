// Спільні серверні утиліти для поштових ендпоінтів (api/mail-*.js).
// Файли з префіксом "_" Vercel НЕ вважає роутами.
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

// Адмін-клієнт (service-role) — обходить RLS, для серверних операцій без юзера.
export function getAdmin() {
  if (!URL || !SERVICE) throw new Error('Supabase service env не налаштовано (VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY)')
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Перевірка JWT користувача з заголовка Authorization: Bearer <access_token>.
// Повертає user або null.
export async function verifyUser(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || !URL || !ANON) return null
  try {
    const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.getUser(token)
    if (error) return null
    return data?.user || null
  } catch { return null }
}

// Налаштування пошти з env (з дефолтами під Hostinger).
export function mailConfig() {
  return {
    imap: {
      host: process.env.MAIL_IMAP_HOST || 'imap.hostinger.com',
      port: Number(process.env.MAIL_IMAP_PORT || 993),
      secure: true,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    },
    smtp: {
      host: process.env.MAIL_SMTP_HOST || 'smtp.hostinger.com',
      port: Number(process.env.MAIL_SMTP_PORT || 465),
      secure: Number(process.env.MAIL_SMTP_PORT || 465) === 465,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    },
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
  }
}

// ── Серверний OCR: розпізнавання документа з буферів файлів через Anthropic ──
// Дзеркалить логіку src/lib/ai.js (extractDocumentMulti), але працює з Buffer.
const SUPPORTED_IMG = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function systemPrompt(articles) {
  return `Ти бухгалтерський асистент. Аналізуй українські первинні документи.
Якщо документ на кількох сторінках — збери дані з усіх сторінок разом.

ВАЖЛИВО — визначення напряму документу:
Наша компанія: ТОВ "ЕЙМ СКІЛ", ЄДРПОУ 45505924.
- Якщо ПОСТАЧАЛЬНИК = наша компанія → ВИХІДНИЙ документ: "contractor" = ПОКУПЕЦЬ, "suggestedDirection" = "Доходи", "docRole" = "outgoing".
- Якщо ПОСТАЧАЛЬНИК = інша компанія → ВХІДНИЙ документ: "contractor" = ПОСТАЧАЛЬНИК, "suggestedDirection" = "Витрати", "docRole" = "incoming".

СТАТТІ ОБЛІКУ — обирай ТІЛЬКИ з цього списку:
${articles?.length ? articles.map(a => `- ${a.name} (${a.type})`).join('\n') : '(статті не задані — вкажи null)'}

Поверни ТІЛЬКИ валідний JSON без markdown:
{
  "docType": "рахунок-фактура|видаткова накладна|акт наданих послуг|прибуткова накладна|інше",
  "docNumber": "номер або null",
  "date": "YYYY-MM-DD або null",
  "contractor": "назва контрагента (не наша компанія)",
  "edrpou": "ЄДРПОУ/ІПН контрагента або null",
  "totalAmount": число_без_знаку,
  "vatAmount": число_без_знаку_або_0,
  "amountNoVat": число_без_знаку,
  "currency": "UAH",
  "description": "опис до 100 символів",
  "suggestedDirection": "Витрати|Доходи|Інше",
  "suggestedArticle": "назва статті зі списку або null",
  "docRole": "incoming|outgoing"
}
Суми завжди позитивні. Якщо поле невідоме — null.`
}

export async function ocrFromAttachments(attachments, articles) {
  const apiKey = process.env.VITE_ANTHROPIC_KEY || process.env.ANTHROPIC_KEY
  if (!apiKey) throw new Error('ANTHROPIC_KEY не налаштовано')

  const content = []
  for (const a of attachments) {
    const b64 = a.content.toString('base64')
    if (a.contentType === 'application/pdf' || /\.pdf$/i.test(a.filename || '')) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } })
    } else {
      const mt = SUPPORTED_IMG.includes(a.contentType) ? a.contentType : 'image/jpeg'
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } })
    }
  }
  content.push({ type: 'text', text: 'Розпізнай цей документ та поверни JSON.' })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, system: systemPrompt(articles), messages: [{ role: 'user', content }] }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  let text = data.content?.find(b => b.type === 'text')?.text || ''
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (m) text = m[0]
  return JSON.parse(text)
}

// Тип документа з OCR (дзеркалить typeFromOcr у DocModal.jsx)
export function typeFromOcr(docType, docRole) {
  const t = (docType || '').trim().toLowerCase()
  if (t.startsWith('акт')) return 'serviceAct'
  if (t.includes('рахунок')) return 'invoice'
  if (t.includes('накладна')) return docRole === 'outgoing' ? 'waybill' : 'incomingWaybill'
  return docRole === 'outgoing' ? 'waybill' : 'incomingWaybill'
}

export const dirFromRole = (role) => (role === 'outgoing' ? 'receivable' : 'payable')

// Проста нормалізація назви для матчингу контрагента
function normName(s) {
  return (s || '').toLowerCase().replace(/тов|пп|фоп|ат|приватне підприємство|товариство з обмеженою відповідальністю|"|«|»|'/g, '').replace(/\s+/g, ' ').trim()
}

// Матч контрагента: спершу за ЄДРПОУ, потім за нормалізованою назвою.
export function matchContractor(contractors, name, edrpou) {
  if (edrpou) {
    const e = String(edrpou).replace(/\D/g, '')
    const byEdr = contractors.find(c => c.edrpou && String(c.edrpou).replace(/\D/g, '') === e)
    if (byEdr) return byEdr
  }
  const n = normName(name)
  if (!n) return null
  return contractors.find(c => {
    const cn = normName(c.name)
    return cn && (cn === n || cn.includes(n) || n.includes(cn))
  }) || null
}

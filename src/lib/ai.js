// API key тепер на сервері — виклики через /api/ai proxy
const USE_PROXY = !import.meta.env.DEV // В dev режимі fallback на прямий доступ
const API_KEY = import.meta.env.VITE_ANTHROPIC_KEY

// Виклик Claude з авто-повтором на тимчасових помилках (overloaded 529 / rate limit 429 / 503).
export async function callClaude(requestBody, { retries = 4 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = USE_PROXY
      ? await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) })
      : await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify(requestBody),
        })
    let data = null
    try { data = await res.json() } catch {}
    if (res.ok && data && !data.error) return data

    if (res.status === 413) throw new Error('Файл завеликий для розпізнавання. Зменшіть роздільність фото або розділіть PDF на сторінки й спробуйте знову.')
    const errType = data?.error?.type || ''
    const msg = data?.error?.message || `HTTP ${res.status}`
    const transient = [429, 500, 502, 503, 529].includes(res.status) ||
      /overload|rate.?limit/i.test(errType) || /overload|rate.?limit/i.test(msg)
    lastErr = new Error(/overload/i.test(msg) ? 'Сервери Claude перевантажені. Зачекайте і спробуйте ще раз.' : msg)
    if (!transient || attempt === retries) throw lastErr
    await new Promise(r => setTimeout(r, 1200 * 2 ** attempt + Math.random() * 400)) // 1.2s, 2.4s, 4.8s, 9.6s
  }
  throw lastErr
}

// Нормалізуємо зображення перед OCR: HEIC/HEIF → JPEG + зменшення великих фото
// (проксі /api/ai має ліміт ~4.5МБ на тіло; фото з телефону + base64 його перевищують → HTTP 413).
const OCR_MAX_DIM = 2200   // максимальний довший бік (тексту вистачає для розпізнавання)
const OCR_JPEG_Q = 0.82
async function normalizeImage(file) {
  const isHeic = ['image/heic', 'image/heif'].includes(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name)
  const isImage = isHeic || file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(file.name)
  if (!isImage) return file  // PDF та інше — не чіпаємо
  // Маленькі JPEG не переганяємо (щоб не втрачати якість зайвий раз)
  if (!isHeic && file.type === 'image/jpeg' && file.size < 1_800_000) return file

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
        const scale = Math.min(1, OCR_MAX_DIM / Math.max(w, h))
        const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw; canvas.height = ch
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          if (blob) {
            const newName = (file.name || 'photo').replace(/\.(heic|heif|png|webp|gif)$/i, '.jpg')
            resolve(new File([blob], /\.jpe?g$/i.test(newName) ? newName : newName + '.jpg', { type: 'image/jpeg' }))
          } else resolve(file)  // фолбек — оригінал
        }, 'image/jpeg', OCR_JPEG_Q)
      } catch { URL.revokeObjectURL(url); resolve(file) }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(isHeic
        ? 'Формат HEIC не підтримується браузером. Збережіть фото як JPEG або PNG.'
        : 'Не вдалося прочитати зображення. Збережіть як JPEG або PNG.'))
    }
    img.src = url
  })
}

// Один файл — зворотня сумісність
export async function extractDocument(file, articles) {
  return extractDocumentMulti([file], articles)
}

// Кілька файлів — всі сторінки в одному запиті
export async function extractDocumentMulti(files, articles) {
  if (!files?.length) throw new Error('Немає файлів')

  const contentBlocks = []

  for (let file of files) {
    // Конвертуємо HEIC → JPEG якщо потрібно
    file = await normalizeImage(file)

    const base64 = await toBase64(file)
    const isImage = file.type.startsWith('image/')
    const isPDF = file.type === 'application/pdf'

    if (!isImage && !isPDF) {
      throw new Error(`Непідтримуваний формат: ${file.name}`)
    }

    // Anthropic підтримує: jpeg, png, gif, webp
    const supportedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    const mediaType = supportedImageTypes.includes(file.type) ? file.type : 'image/jpeg'

    if (isPDF) {
      contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })
    } else {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } })
    }
  }

  // Додаємо текстовий запит в кінці
  contentBlocks.push({
    type: 'text',
    text: files.length > 1
      ? `Це ${files.length} сторінок одного документу. Розпізнай як єдиний документ та поверни JSON з усіма позиціями.`
      : 'Розпізнай цей документ та поверни JSON з усіма позиціями.'
  })

  const systemPrompt = `Ти бухгалтерський асистент. Аналізуй українські первинні документи.
Якщо документ на кількох сторінках — збери дані з усіх сторінок разом.

ВАЖЛИВО — визначення напряму документу:
Наша компанія: ТОВ "ЕЙМ СКІЛ", ЄДРПОУ 45505924.
- Якщо в документі ПОСТАЧАЛЬНИК = наша компанія (ЄДРПОУ 45505924 або "ЕЙМ СКІЛ") → це ВИХІДНИЙ документ від нас до клієнта. В полі "contractor" вкажи ПОКУПЦЯ (не нашу компанію), "suggestedDirection" = "Доходи", "docRole" = "outgoing".
- Якщо в документі ПОСТАЧАЛЬНИК = інша компанія → це ВХІДНИЙ документ. В полі "contractor" вкажи ПОСТАЧАЛЬНИКА, "suggestedDirection" = "Витрати", "docRole" = "incoming".

СТАТТІ ОБЛІКУ — обирай ТІЛЬКИ з цього списку:
${articles?.length ? articles.map(a => `- ${a.name} (${a.type})`).join('\n') : '(статті не задані — вкажи null)'}

Для поля "suggestedArticle" обери найбільш відповідну статтю ТІЛЬКИ з наведеного списку вище. Якщо жодна не підходить — вкажи null. НЕ ВИГАДУЙ нових назв статтей.

Поверни ТІЛЬКИ валідний JSON без markdown та пояснень:
{
  "docType": "рахунок-фактура|видаткова накладна|акт наданих послуг|прибуткова накладна|інше",
  "docNumber": "номер або null",
  "date": "YYYY-MM-DD або null",
  "contractor": "назва контрагента (покупця або постачальника — залежно від напряму)",
  "edrpou": "ЄДРПОУ/ІПН контрагента (не наш) або null",
  "totalAmount": число_без_знаку,
  "vatAmount": число_без_знаку_або_0,
  "amountNoVat": число_без_знаку,
  "currency": "UAH",
  "description": "опис товарів/послуг до 100 символів",
  "suggestedDirection": "Витрати|Доходи|Інше",
  "suggestedArticle": "назва статті зі списку вище або null",
  "docRole": "incoming|outgoing",
  "invoiceRef": "номер пов'язаного рахунку (якщо в накладній вказано 'згідно рахунку №...') або null",
  "invoiceRefDate": "YYYY-MM-DD дата рахунку або null",
  "contractNum": "номер договору (якщо вказано 'згідно договору №...') або null",
  "contractDate": "YYYY-MM-DD дата договору або null",
  "items": [
    {
      "name": "назва товару або послуги",
      "sku": "артикул/код товару або null",
      "quantity": число_або_null,
      "unit": "шт|кг|л|м|компл|грн|null",
      "unitPrice": число_або_null,
      "amount": число_без_знаку,
      "vatRate": 20
    }
  ]
}
Суми завжди позитивні числа. Якщо поле невідоме — null.
Витягни ВСІ позиції з документу — кожен рядок товару/послуги окремо.`

  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: contentBlocks }],
  }

  const data = await callClaude(requestBody)
  const text = data.content?.find(b => b.type === 'text')?.text || ''

  // Очищаємо відповідь від markdown та зайвого тексту
  let clean = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // Витягуємо JSON якщо є зайвий текст навколо
  const jsonMatch = clean.match(/\{[\s\S]*\}/)
  if (jsonMatch) clean = jsonMatch[0]

  try {
    return JSON.parse(clean)
  } catch(e) {
    console.error('AI response:', text)
    throw new Error('Не вдалось розпізнати документ. Спробуйте ще раз або введіть дані вручну.')
  }
}

// ── Розпізнати ВИТЯГ з ЄДР → реквізити компанії (для профілю контрагента) ──
export async function extractCompanyExtract(files) {
  if (!files?.length) throw new Error('Немає файлів')
  const contentBlocks = []
  const supported = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
  for (let file of files) {
    file = await normalizeImage(file)
    const base64 = await toBase64(file)
    const isPDF = file.type === 'application/pdf'
    if (!isPDF && !file.type.startsWith('image/')) throw new Error(`Непідтримуваний формат: ${file.name}`)
    if (isPDF) contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })
    else contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: supported.includes(file.type) ? file.type : 'image/jpeg', data: base64 } })
  }
  contentBlocks.push({ type: 'text', text: 'Розпізнай цей витяг з ЄДР та поверни JSON з реквізитами компанії.' })

  const systemPrompt = `Ти розпізнаєш дані компанії з витягу (відомостей) з Єдиного державного реєстру (ЄДР) України. Збери реквізити з усіх сторінок.

ВАЖЛИВО:
- "director" — бери ЛИШЕ з рядка «Відомості про керівника юридичної особи» (виконавчий орган). НЕ плутай із засновниками/учасниками та кінцевими бенефіціарними власниками (КБВ) — це інші люди.
- "name" — коротка офіційна форма з абревіатурою орг.-правової форми в лапках, напр. \`ТОВ "ТД "ДИСКОН"\` (НЕ довга великими літерами «ТОВАРИСТВО З ОБМЕЖЕНОЮ...»).
- "short_name" — назва без форми, у лапках, напр. \`ТД "ДИСКОН"\`.
- "legal_address" — рядок «Місцезнаходження юридичної особи» повністю.
- "phone" — ПЕРШИЙ номер із переліку контактних телефонів.
- "director_position" — з блоку «Органи управління» (виконавчий), напр. Директор.
- "is_vat_payer" — true лише якщо явно вказано що платник ПДВ; інакше null.

Поверни ТІЛЬКИ валідний JSON без markdown:
{
  "name": "ТОВ \\"Назва\\" або null",
  "short_name": "коротка назва в лапках або null",
  "edrpou": "ідентифікаційний код (8 цифр) або null",
  "ipn": "ІПН/індивідуальний податковий номер або null",
  "legal_form": "організаційно-правова форма або null",
  "tax_system": "система оподаткування якщо вказано або null",
  "is_vat_payer": true/false/null,
  "legal_address": "повна юридична адреса одним рядком або null",
  "postal_code": "поштовий індекс (5 цифр) або null",
  "city": "місто/населений пункт або null",
  "region": "область або null",
  "director": "ПІБ керівника (виконавчий орган) або null",
  "director_position": "посада керівника або null",
  "phone": "перший телефон або null",
  "email": "email або null",
  "website": "сайт або null",
  "iban": "IBAN якщо вказано або null",
  "bank_name": "назва банку або null",
  "mfo": "МФО або null",
  "kved": "основний КВЕД (код + опис) або null"
}
Якщо поле відсутнє — null. Не вигадуй дані.`

  const data = await callClaude({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: systemPrompt, messages: [{ role: 'user', content: contentBlocks }] })
  let text = data.content?.find(b => b.type === 'text')?.text || ''
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (m) text = m[0]
  try { return JSON.parse(text) } catch { throw new Error('Не вдалось розпізнати витяг. Спробуйте інший файл.') }
}

// ── Розпізнати реквізити компанії з тексту ──
export async function parseCompanyFromText(text) {
  if (!USE_PROXY && !API_KEY) throw new Error('API ключ не налаштовано')
  if (!text?.trim()) throw new Error('Вставте текст з реквізитами')

  const systemPrompt = `Ти розпізнаєш реквізити українських компаній з будь-якого тексту.
Текст може містити реквізити з документів, листів, сайтів, візиток тощо.
Поверни ТІЛЬКИ валідний JSON без markdown:
{
  "name": "повна офіційна назва компанії або null",
  "short_name": "скорочена назва (ТОВ/АТ/ФОП + коротка назва) або null",
  "edrpou": "код ЄДРПОУ (8 цифр) або РНОКПП (10 цифр) або null",
  "ipn": "ІПН/індивідуальний податковий номер (12 цифр) або null",
  "legal_form": "ТОВ/АТ/ПП/ФОП або null",
  "legal_address": "юридична адреса (повна, з індексом та містом) або null",
  "address": "те саме що legal_address",
  "iban": "IBAN (UA + 27 цифр) або null",
  "bank_name": "назва банку або null",
  "mfo": "МФО (6 цифр) або null",
  "phone": "телефон або null",
  "email": "email або null",
  "website": "сайт або null",
  "contact_person": "ПІБ директора або контактної особи або null",
  "contact_position": "посада (Директор тощо) або null",
  "is_vat_payer": true якщо є ІПН з 12 цифр або згадка ПДВ або свідоцтво ПДВ,
  "vat_certificate": "ІПН (12 цифр) = це і є номер свідоцтва ПДВ, або null",
  "type": "client/supplier/other"
}
ВАЖЛИВО:
- Якщо є ІПН з 12 цифр — це платник ПДВ, is_vat_payer=true, vat_certificate = цей ІПН
- Адресу завжди клади і в address і в legal_address
- Директора/керівника клади в contact_person + contact_position
- Якщо поле невідоме — null. НЕ вигадуй дані.`

  const requestBody = { model: 'claude-sonnet-4-6', max_tokens: 1000, system: systemPrompt, messages: [{ role: 'user', content: text.trim() }] }
  let res
  if (USE_PROXY) {
    res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) })
  } else {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(requestBody),
    })
  }

  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  const responseText = data.content?.find(b => b.type === 'text')?.text || ''

  let clean = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const jsonMatch = clean.match(/\{[\s\S]*\}/)
  if (jsonMatch) clean = jsonMatch[0]

  try {
    return JSON.parse(clean)
  } catch {
    throw new Error('Не вдалось розпізнати реквізити. Спробуйте ще раз.')
  }
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const API_KEY = import.meta.env.VITE_ANTHROPIC_KEY

// Конвертуємо HEIC/HEIF → JPEG через canvas
async function normalizeImage(file) {
  const isHeic = ['image/heic', 'image/heif'].includes(file.type.toLowerCase()) ||
    /\.(heic|heif)$/i.test(file.name)

  if (!isHeic) return file

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          if (blob) {
            const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg')
            resolve(new File([blob], newName, { type: 'image/jpeg' }))
          } else {
            // Якщо canvas не спрацював — передаємо оригінал з jpeg типом
            resolve(new File([file], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' }))
          }
        }, 'image/jpeg', 0.92)
      } catch(e) {
        URL.revokeObjectURL(url)
        // Fallback — передаємо з jpeg media_type
        resolve(new File([file], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' }))
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      // Safari може не вміти відображати HEIC через img tag — передаємо як є з jpeg типом
      resolve(new File([file], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' }))
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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `Ти бухгалтерський асистент. Аналізуй українські первинні документи.
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
Витягни ВСІ позиції з документу — кожен рядок товару/послуги окремо.`,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
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

// ── Розпізнати реквізити компанії з тексту ──
export async function parseCompanyFromText(text) {
  if (!API_KEY) throw new Error('API ключ не налаштовано')
  if (!text?.trim()) throw new Error('Вставте текст з реквізитами')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `Ти розпізнаєш реквізити українських компаній з будь-якого тексту.
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
- Якщо поле невідоме — null. НЕ вигадуй дані.`,
      messages: [{ role: 'user', content: text.trim() }],
    }),
  })

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

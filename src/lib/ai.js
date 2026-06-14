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
export async function extractDocument(file) {
  return extractDocumentMulti([file])
}

// Кілька файлів — всі сторінки в одному запиті
export async function extractDocumentMulti(files) {
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
  "suggestedArticle": "назва статті або null",
  "docRole": "incoming|outgoing",
  "items": [
    {
      "name": "назва товару або послуги",
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

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

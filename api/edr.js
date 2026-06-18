// Vercel serverless function — пошук компанії по ЄДРПОУ (безкоштовно)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code } = req.body
  if (!code?.trim()) {
    return res.status(200).json({ error: 'ЄДРПОУ не вказано' })
  }

  const edrpou = code.trim()
  const errors = []

  try {
    // Спосіб 1: YouControl (публічна сторінка)
    const yc = await tryYouControl(edrpou)
    if (yc) return res.status(200).json({ source: 'youcontrol', data: yc })
    errors.push('youcontrol: no data')

    // Спосіб 2: ring.org.ua
    const ring = await tryRing(edrpou)
    if (ring) return res.status(200).json({ source: 'ring', data: ring })
    errors.push('ring: no data')

    return res.status(200).json({ error: `Компанію з ЄДРПОУ ${edrpou} не знайдено (${errors.join(', ')})` })
  } catch (e) {
    return res.status(200).json({ error: `Помилка: ${e.message}` })
  }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.5',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  })
  if (!r.ok) return null
  return r.text()
}

async function tryYouControl(edrpou) {
  try {
    const html = await fetchHtml(`https://youcontrol.com.ua/catalog/company_details/${edrpou}/`)
    if (!html) return null
    return parseYouControl(html, edrpou)
  } catch { return null }
}

async function tryRing(edrpou) {
  try {
    const html = await fetchHtml(`https://ring.org.ua/edr/uk/company/${edrpou}`)
    if (!html) return null
    return parseRing(html, edrpou)
  } catch { return null }
}

function strip(s) {
  return s ? s.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim() : null
}

function parseYouControl(html, edrpou) {
  // og:title — "НАЗВА КОМПАНІЇ — YouControl"
  const titleMatch = html.match(/property="og:title"\s*content="([^"]+)"/i)
    || html.match(/<title>([^<]+)<\/title>/i)
  let name = null
  if (titleMatch) {
    name = titleMatch[1].replace(/\s*[—–-]\s*YouControl.*/i, '').replace(/\s*\|\s*YouControl.*/i, '').trim()
  }
  if (!name || name.length < 3) return null

  // og:description часто містить "Директор: ..., Адреса: ..., КВЕД: ..."
  const descMatch = html.match(/property="og:description"\s*content="([^"]+)"/i)
  const desc = descMatch ? descMatch[1] : ''

  let director = null, address = null, kved = null, state = null, capital = null, regDate = null

  // Парсимо description
  const dirMatch = desc.match(/(?:Директор|Керівник)[:\s]*([^,;.]+)/i)
  if (dirMatch) director = dirMatch[1].trim()

  const addrMatch = desc.match(/(?:Адреса|Юридична адреса)[:\s]*([^.;]+)/i)
  if (addrMatch) address = addrMatch[1].trim()

  const kvedMatch = desc.match(/(?:КВЕД|Основний вид)[:\s]*([^.;]+)/i)
  if (kvedMatch) kved = kvedMatch[1].trim()

  // Шукаємо в HTML
  const stateMatch = html.match(/Стан[^<]*<[^>]*>\s*<[^>]*>([^<]+)/i)
    || html.match(/status[^>]*>([^<]+)</i)
  if (stateMatch) state = strip(stateMatch[1])

  const capMatch = html.match(/Статутний капітал[^<]*<[^>]*>\s*([^<]+)/i)
    || desc.match(/капітал[:\s]*([\d\s,]+)/i)
  if (capMatch) capital = strip(capMatch[1])

  const regMatch = html.match(/Дата реєстрації[^<]*<[^>]*>\s*([^<]+)/i)
    || desc.match(/реєстрац[іи][яї][:\s]*([\d.]+)/i)
  if (regMatch) regDate = strip(regMatch[1])

  // ІПН
  const ipnMatch = html.match(/ІПН[:\s]*(\d{10,12})/i)
  const ipn = ipnMatch ? ipnMatch[1] : null

  // ПДВ
  const isVatPayer = /платник пдв/i.test(html) || /ПДВ/i.test(desc)

  return {
    name, edrpou, ipn,
    director, address, state, kved, capital,
    registration_date: regDate,
    is_vat_payer: isVatPayer,
  }
}

function parseRing(html, edrpou) {
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  const name = h1 ? strip(h1[1]) : null
  if (!name || name.length < 3) return null

  const director = extractAfterLabel(html, 'Керівник')
  const address = extractAfterLabel(html, 'Адреса')
  const state = extractAfterLabel(html, 'Стан')
  const kved = extractAfterLabel(html, 'КВЕД') || extractAfterLabel(html, 'Основний вид')

  return { name, edrpou, director, address, state, kved }
}

function extractAfterLabel(html, label) {
  const re = new RegExp(label + '[^<]*</[^>]+>\\s*<[^>]+>([^<]+)', 'i')
  const m = html.match(re)
  return m ? strip(m[1]) : null
}

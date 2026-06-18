// Vercel serverless function — пошук компанії по ЄДРПОУ (безкоштовно)
// Парсить відкриту сторінку opendatabot.ua

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code } = req.body
  if (!code?.trim()) {
    return res.status(200).json({ error: 'ЄДРПОУ не вказано' })
  }

  const edrpou = code.trim()

  try {
    // Спосіб 1: opendatabot.ua публічна сторінка
    const odbResult = await tryOpendatabot(edrpou)
    if (odbResult) return res.status(200).json({ source: 'opendatabot', data: odbResult })

    // Спосіб 2: clarity-project.info публічна сторінка
    const clarityResult = await tryClarity(edrpou)
    if (clarityResult) return res.status(200).json({ source: 'clarity', data: clarityResult })

    return res.status(200).json({ error: `Компанію з ЄДРПОУ ${edrpou} не знайдено` })
  } catch (e) {
    return res.status(200).json({ error: `Помилка: ${e.message}` })
  }
}

async function tryOpendatabot(edrpou) {
  try {
    const r = await fetch(`https://opendatabot.ua/c/${edrpou}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'uk-UA,uk;q=0.9',
      },
    })
    if (!r.ok) return null
    const html = await r.text()
    return parseOdb(html, edrpou)
  } catch { return null }
}

async function tryClarity(edrpou) {
  try {
    const r = await fetch(`https://clarity-project.info/edr/${edrpou}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'uk-UA,uk;q=0.9',
      },
    })
    if (!r.ok) return null
    const html = await r.text()
    return parseClarity(html, edrpou)
  } catch { return null }
}

function extractBetween(html, before, after) {
  const i = html.indexOf(before)
  if (i === -1) return null
  const start = i + before.length
  const end = html.indexOf(after, start)
  if (end === -1) return null
  return html.substring(start, end).replace(/<[^>]+>/g, '').trim()
}

function extractMeta(html, prop) {
  const re = new RegExp(`property="${prop}"[^>]*content="([^"]*)"`, 'i')
  const m = html.match(re)
  return m ? m[1].trim() : null
}

function parseOdb(html, edrpou) {
  // og:title зазвичай містить назву компанії
  const title = extractMeta(html, 'og:title')
  const desc = extractMeta(html, 'og:description')

  // Шукаємо назву в <h1>
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  const name = h1Match ? h1Match[1].trim() : title

  if (!name || name.includes('Opendatabot') || name.includes('404')) return null

  // Парсимо з description
  let director = null, address = null, state = null, kved = null
  if (desc) {
    const dirMatch = desc.match(/Керівник[:\s]*([^,.]+)/i)
    if (dirMatch) director = dirMatch[1].trim()
    const addrMatch = desc.match(/Адреса[:\s]*([^.]+)/i)
    if (addrMatch) address = addrMatch[1].trim()
  }

  // Шукаємо дані в HTML
  const stateMatch = html.match(/Стан[^<]*<[^>]*>([^<]+)/i)
  if (stateMatch) state = stateMatch[1].trim()

  const kvedMatch = html.match(/КВЕД[^<]*<[^>]*>[^<]*<[^>]*>([^<]+)/i)
    || html.match(/Основний вид діяльності[^<]*<[^>]*>([^<]+)/i)
  if (kvedMatch) kved = kvedMatch[1].trim()

  const addrMatch2 = html.match(/Адреса[^<]*<[^>]*>[^<]*<[^>]*>([^<]+)/i)
  if (addrMatch2 && !address) address = addrMatch2[1].trim()

  const dirMatch2 = html.match(/Керівник[^<]*<[^>]*>[^<]*<[^>]*>([^<]+)/i)
  if (dirMatch2 && !director) director = dirMatch2[1].trim()

  const pdvMatch = html.match(/Платник ПДВ/i)
  const isVatPayer = !!pdvMatch

  return {
    name, edrpou, director, address, state, kved,
    is_vat_payer: isVatPayer,
  }
}

function parseClarity(html, edrpou) {
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  const name = h1Match ? h1Match[1].trim() : null
  if (!name || name.includes('404') || name.includes('Clarity')) return null

  const director = extractBetween(html, 'Керівник', '</') || null
  const address = extractBetween(html, 'Адреса', '</') || null
  const state = extractBetween(html, 'Стан', '</') || null
  const kved = extractBetween(html, 'КВЕД', '</') || null

  return { name, edrpou, director, address, state, kved }
}

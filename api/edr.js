// Vercel serverless function — пошук компанії в ЄДР (безкоштовно)
// Використовує відкритий API ЄДР через ProZorro/data.gov.ua

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
    // Спосіб 1: ЄДР через ProZorro (безкоштовно)
    const proZorroUrl = `https://api.iit.com.ua/edr/legal/${edrpou}`
    const r1 = await fetch(proZorroUrl, {
      headers: { 'Accept': 'application/json' },
    })

    if (r1.ok) {
      const data = await r1.json()
      if (data && (data.name || data.full_name)) {
        return res.status(200).json({ source: 'iit', data })
      }
    }

    // Спосіб 2: data.gov.ua ЄДР dataset
    const dataGovUrl = `https://data.gov.ua/api/3/action/package_search?q=${edrpou}&rows=1`
    const r2 = await fetch(dataGovUrl)

    if (r2.ok) {
      const data = await r2.json()
      if (data?.result?.results?.length > 0) {
        return res.status(200).json({ source: 'datagov', data: data.result.results[0] })
      }
    }

    // Спосіб 3: Парсинг usr.minjust.gov.ua через їх внутрішній API
    const usrUrl = `https://usr.minjust.gov.ua/ua/freesearch?search_type=1&search_code=${edrpou}&search_type_code=1`
    const r3 = await fetch(usrUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AimSkill/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    if (r3.ok) {
      const html = await r3.text()
      // Парсимо базові дані з HTML
      const parsed = parseUsrHtml(html, edrpou)
      if (parsed) {
        return res.status(200).json({ source: 'usr', data: parsed })
      }
    }

    return res.status(200).json({ error: `Компанію з ЄДРПОУ ${edrpou} не знайдено` })
  } catch (e) {
    return res.status(200).json({ error: `Помилка: ${e.message}` })
  }
}

function parseUsrHtml(html, edrpou) {
  // Простий парсинг HTML відповіді ЄДР
  const getName = (h) => {
    const m = h.match(/Повне найменування[^<]*<[^>]*>([^<]+)</i)
      || h.match(/class="uo_name"[^>]*>([^<]+)/i)
      || h.match(/<h2[^>]*>([^<]+)/i)
    return m ? m[1].trim() : null
  }

  const getField = (h, label) => {
    const re = new RegExp(label + '[^<]*<[^>]*>\\s*([^<]+)', 'i')
    const m = h.match(re)
    return m ? m[1].trim() : null
  }

  const name = getName(html)
  if (!name) return null

  return {
    name,
    edrpou,
    short_name: getField(html, 'Скорочене найменування'),
    address: getField(html, 'Місцезнаходження'),
    director: getField(html, 'Керівник') || getField(html, 'ПІБ'),
    state: getField(html, 'Стан'),
    kved: getField(html, 'Основний вид діяльності'),
    registration_date: getField(html, 'Дата реєстрації'),
  }
}

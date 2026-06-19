// Vercel serverless function — пошук компанії по ЄДРПОУ
// 1. cabinet.tax.gov.ua (безкоштовний API податкової)
// 2. YouControl fallback (парсинг публічної сторінки)

const TAX_BASE = 'https://cabinet.tax.gov.ua/ws/api/public/registers'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { code, token } = req.body
  if (!code?.trim()) return res.status(200).json({ error: 'ЄДРПОУ не вказано' })

  const edrpou = code.trim()

  // 1. Спробувати API податкової
  if (token?.trim()) {
    const taxResult = await tryTaxApi(edrpou, token.trim())
    if (taxResult) return res.status(200).json({ source: 'tax.gov.ua', data: taxResult })
  }

  // 2. Fallback — YouControl
  const ycResult = await tryYouControl(edrpou)
  if (ycResult) return res.status(200).json({ source: 'youcontrol', data: ycResult })

  return res.status(200).json({ error: `Компанію з ЄДРПОУ ${edrpou} не знайдено` })
}

// ═══ API Податкової ═══
async function tryTaxApi(edrpou, token) {
  try {
    // Реєстрація
    const regR = await fetch(`${TAX_BASE}/registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tins: edrpou, token }),
    })
    const regData = regR.ok ? await regR.json() : null
    if (regData?.error) return null // "воєнний стан" або інша помилка

    // ПДВ
    const pdvR = await fetch(`${TAX_BASE}/pdv_act/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tinList: edrpou, token }),
    })
    const pdvData = pdvR.ok ? await pdvR.json() : null
    if (pdvData?.error && !regData) return null

    if (!regData && !pdvData) return null

    const reg = regData && !regData.error ? (Array.isArray(regData) ? regData[0] : regData.data?.[0] || regData) : null
    const pdv = pdvData && !pdvData.error ? (Array.isArray(pdvData) ? pdvData[0] : pdvData.data?.[0] || pdvData) : null

    return {
      name: reg?.name || reg?.full_name || pdv?.name || null,
      edrpou,
      ipn: pdv?.kodPdv || pdv?.tin || null,
      address: reg?.address || null,
      is_vat_payer: !!pdv && !pdv.datAnul,
      state: reg?.state || null,
      registration_date: reg?.datReg || pdv?.datReestr || null,
      vat_certificate: pdv?.kodPdvs || null,
    }
  } catch { return null }
}

// ═══ YouControl (парсинг публічної сторінки) ═══
async function tryYouControl(edrpou) {
  try {
    const r = await fetch(`https://youcontrol.com.ua/catalog/company_details/${edrpou}/`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'uk-UA,uk;q=0.9' },
      redirect: 'follow',
    })
    if (!r.ok) return null
    const html = await r.text()

    // og:description містить назву, ЄДРПОУ, адресу
    const descMatch = html.match(/property="og:description"\s*content="([^"]+)"/i)
    const titleMatch = html.match(/property="og:title"\s*content="([^"]+)"/i)

    if (!descMatch && !titleMatch) return null

    const desc = descMatch ? descMatch[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&') : ''
    const title = titleMatch ? titleMatch[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&') : ''

    // Назва з title: "НАЗВА КОМПАНІЇ — YouControl" або з desc
    let name = null
    const nameFromTitle = title.replace(/\s*[—–-]\s*YouControl.*$/i, '').trim()
    if (nameFromTitle && nameFromTitle.length > 3 && !nameFromTitle.includes('YouControl')) {
      name = nameFromTitle
    }
    // Або з desc: "НАЗВА КОМПАНІЇ, код ЄДРПОУ ..."
    if (!name) {
      const nameFromDesc = desc.match(/^([^,]+),\s*код\s*ЄДРПОУ/i)
      if (nameFromDesc) name = nameFromDesc[1].trim()
    }

    if (!name) return null

    // Адреса з другого meta content
    let address = null
    const allDescs = html.match(/content="([^"]*ЄДРПОУ[^"]*)"/gi) || []
    for (const m of allDescs) {
      const val = m.match(/content="([^"]+)"/i)?.[1]?.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
      if (val && val.includes('Україна')) {
        // Витягнути адресу після ЄДРПОУ
        const addrMatch = val.match(/Україна[^"]+/)
        if (addrMatch) address = addrMatch[0].replace(/\*+/g, '').trim()
      }
    }

    // Директор
    let director = null
    const dirMatch = desc.match(/(?:Директор|Керівник)[:\s]*([^,;.]+)/i)
      || html.match(/Керівник[^<]*<[^>]*>([^<]+)/i)
    if (dirMatch) director = dirMatch[1].trim()

    // ПДВ
    const isVatPayer = /платник\s*ПДВ/i.test(html)

    return { name, edrpou, address, director, is_vat_payer: isVatPayer, contact_person: director }
  } catch { return null }
}

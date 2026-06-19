// Vercel serverless function — пошук компанії по ЄДРПОУ
// Джерело: cabinet.tax.gov.ua (безкоштовний API податкової)

const TAX_BASE = 'https://cabinet.tax.gov.ua/ws/api/public/registers'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code, token } = req.body
  if (!code?.trim()) {
    return res.status(200).json({ error: 'ЄДРПОУ не вказано' })
  }
  if (!token?.trim()) {
    return res.status(200).json({ error: 'Токен податкової не вказано. Отримайте його в Електронному кабінеті → Налаштування → Токени відкритої частини' })
  }

  const edrpou = code.trim()

  try {
    // 1. Дані реєстрації (назва, адреса, тип)
    const regData = await fetchTaxApi(`${TAX_BASE}/registration`, {
      tins: edrpou,
      token: token.trim(),
    })

    // 2. Дані ПДВ (чи платник, ІПН)
    const pdvData = await fetchTaxApi(`${TAX_BASE}/pdv_act/list`, {
      tinList: edrpou,
      token: token.trim(),
    })

    if (!regData && !pdvData) {
      return res.status(200).json({ error: `Компанію з ЄДРПОУ ${edrpou} не знайдено в реєстрах податкової` })
    }

    const result = parseResult(regData, pdvData, edrpou)
    return res.status(200).json({ source: 'tax.gov.ua', data: result })
  } catch (e) {
    return res.status(200).json({ error: `Помилка: ${e.message}` })
  }
}

async function fetchTaxApi(url, body) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    const data = await r.json()
    return data
  } catch {
    return null
  }
}

function parseResult(regData, pdvData, edrpou) {
  // Реєстраційні дані
  let reg = null
  if (regData) {
    // Може бути масив або обʼєкт
    const items = Array.isArray(regData) ? regData : regData.data || regData.items || regData.result || [regData]
    reg = Array.isArray(items) ? items[0] : items
  }

  // ПДВ дані
  let pdv = null
  if (pdvData) {
    const items = Array.isArray(pdvData) ? pdvData : pdvData.data || pdvData.items || pdvData.result || [pdvData]
    pdv = Array.isArray(items) ? items[0] : items
  }

  const name = reg?.name || reg?.full_name || reg?.nameUr || pdv?.name || null
  const address = reg?.address || reg?.addressUr || null
  const isVatPayer = !!pdv && !pdv.datAnul && !pdv.kodAnul
  const ipn = pdv?.kodPdv || pdv?.tin || null

  return {
    name,
    edrpou,
    ipn,
    address,
    legal_address: address,
    is_vat_payer: isVatPayer,
    state: reg?.state || reg?.status || (pdv?.datAnul ? 'Анульовано ПДВ' : isVatPayer ? 'Платник ПДВ' : null),
    registration_date: reg?.datReg || reg?.registrationDate || pdv?.datReestr || null,
    tax_office: reg?.nameDpi || reg?.taxOfficeName || null,
    // Додаткові з ПДВ
    vat_registration_date: pdv?.datReestr || null,
    vat_certificate: pdv?.kodPdvs || null,
  }
}

// Vercel serverless function — proxy for Vkursi API (avoids CORS)
const BASE = 'https://vkursi-api.azurewebsites.net/api/1.0'

async function vkursiFetch(url, token, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  return { ok: r.ok, status: r.status, text }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { action, email, password, code, token } = req.body

  try {
    if (action === 'authorize') {
      if (!email || !password) {
        return res.status(200).json({ error: 'Email та пароль обовʼязкові' })
      }

      const r = await fetch(`${BASE}/token/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const text = await r.text()

      if (!r.ok) {
        return res.status(200).json({ error: `Помилка авторизації Vkursi (${r.status}): ${text.substring(0, 200)}` })
      }

      let tokenValue
      try {
        const parsed = JSON.parse(text)
        tokenValue = parsed.token || parsed.Token || parsed
      } catch {
        tokenValue = text
      }

      if (typeof tokenValue === 'string') {
        tokenValue = tokenValue.replace(/^"|"$/g, '').trim()
      }

      return res.status(200).json({ token: tokenValue })
    }

    if (action === 'getorganization') {
      if (!token) return res.status(200).json({ error: 'Token не вказано' })
      if (!code) return res.status(200).json({ error: 'ЄДРПОУ не вказано' })

      // Спочатку пробуємо getadvancedorganization (більше даних)
      const adv = await vkursiFetch(
        `${BASE}/organizations/getadvancedorganization`,
        token, { Code: code }
      )

      if (adv.ok) {
        try {
          const data = JSON.parse(adv.text)
          return res.status(200).json({ source: 'advanced', data })
        } catch {}
      }

      // Fallback на getorganizations (дешевший)
      const basic = await vkursiFetch(
        `${BASE}/organizations/getorganizations`,
        token, { code: [code] }
      )

      if (basic.ok) {
        try {
          const data = JSON.parse(basic.text)
          const org = Array.isArray(data) ? data[0] : data
          return res.status(200).json({ source: 'basic', data: org })
        } catch {}
      }

      return res.status(200).json({
        error: `Vkursi: не вдалось отримати дані (advanced: ${adv.status}, basic: ${basic.status})`
      })
    }

    // Legacy support
    if (action === 'getadvancedorganization') {
      if (!token) return res.status(200).json({ error: 'Token не вказано' })
      if (!code) return res.status(200).json({ error: 'ЄДРПОУ не вказано' })

      const r = await vkursiFetch(
        `${BASE}/organizations/getadvancedorganization`,
        token, { Code: code }
      )

      if (!r.ok) return res.status(200).json({ error: `Vkursi API (${r.status}): ${r.text.substring(0, 200)}` })

      try {
        return res.status(200).json(JSON.parse(r.text))
      } catch {
        return res.status(200).json({ error: 'Невалідна відповідь від Vkursi' })
      }
    }

    return res.status(200).json({ error: `Невідома дія: ${action}` })
  } catch (e) {
    return res.status(200).json({ error: `Серверна помилка: ${e.message}` })
  }
}

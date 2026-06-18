// Vercel serverless function — proxy for Vkursi API (avoids CORS)
const BASE = 'https://vkursi-api.azurewebsites.net/api/1.0'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { action, email, password, code, token } = req.body

  try {
    if (action === 'authorize') {
      if (!email || !password) {
        return res.status(400).json({ error: 'Email та пароль обовʼязкові' })
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

      // Токен може прийти як JSON {"token":"..."} або як рядок в лапках "token..."
      let tokenValue
      try {
        const parsed = JSON.parse(text)
        tokenValue = parsed.token || parsed.Token || parsed
      } catch {
        tokenValue = text
      }

      // Прибрати лапки якщо є
      if (typeof tokenValue === 'string') {
        tokenValue = tokenValue.replace(/^"|"$/g, '').trim()
      }

      return res.status(200).json({ token: tokenValue })
    }

    if (action === 'getadvancedorganization') {
      if (!token) return res.status(200).json({ error: 'Token не вказано' })
      if (!code) return res.status(200).json({ error: 'ЄДРПОУ не вказано' })

      const r = await fetch(`${BASE}/organizations/getadvancedorganization`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ Code: code }),
      })

      if (!r.ok) {
        const text = await r.text()
        return res.status(200).json({ error: `Vkursi API (${r.status}): ${text.substring(0, 200)}` })
      }

      const data = await r.json()
      return res.status(200).json(data)
    }

    return res.status(200).json({ error: `Невідома дія: ${action}` })
  } catch (e) {
    return res.status(200).json({ error: `Серверна помилка: ${e.message}` })
  }
}

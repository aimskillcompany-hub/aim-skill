// Vercel serverless function — proxy for Vkursi API (avoids CORS)
const BASE = 'https://vkursi-api.azurewebsites.net/api/1.0'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { action, email, password, code } = req.body

  try {
    if (action === 'authorize') {
      const r = await fetch(`${BASE}/token/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!r.ok) return res.status(r.status).json({ error: `Auth error: ${r.status}` })
      const data = await r.text()
      return res.status(200).json({ token: data.replace(/^"|"$/g, '') })
    }

    if (action === 'getadvancedorganization') {
      const { token } = req.body
      if (!token) return res.status(400).json({ error: 'Token required' })

      const r = await fetch(`${BASE}/organizations/getadvancedorganization`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ Code: code }),
      })
      if (!r.ok) return res.status(r.status).json({ error: `API error: ${r.status}` })
      const data = await r.json()
      return res.status(200).json(data)
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

// Vercel serverless function — proxy for Anthropic API
// Keeps API key on server, never exposed to browser

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' })
  }

  try {
    const { model, max_tokens, system, messages } = req.body

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: max_tokens || 2000,
        system,
        messages,
      }),
    })

    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // для PDF/зображень в base64
    },
  },
}

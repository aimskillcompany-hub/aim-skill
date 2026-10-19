// Vercel serverless function — proxy for Anthropic API
// Keeps API key on server, never exposed to browser.
// Лише для залогінених користувачів (JWT Supabase); модель і max_tokens обмежуються на сервері,
// щоб чужий запит не міг крутити дорогу модель на рахунку компанії (аудит 2026-10-19).
import { verifyUser } from './_lib.js'

const ALLOWED_MODELS = new Set(['claude-sonnet-4-6'])
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS_CAP = 4000

// Simple in-memory rate limiting (per serverless instance)
const rateMap = new Map()
const RATE_LIMIT = 20 // requests per minute
const RATE_WINDOW = 60000 // 1 minute

function checkRateLimit(ip) {
  const now = Date.now()
  const entry = rateMap.get(ip)
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateMap.set(ip, { start: now, count: 1 })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'Потрібен вхід у систему' })

  // Rate limiting (на користувача, а не на IP)
  if (!checkRateLimit(user.id)) {
    return res.status(429).json({ error: 'Забагато запитів. Спробуйте через хвилину.' })
  }

  const apiKey = process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' })
  }

  try {
    const { model, max_tokens, system, messages } = req.body || {}
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' })
    const useModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL
    const useMax = Math.min(Math.max(1, Number(max_tokens) || 2000), MAX_TOKENS_CAP)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: useModel,
        max_tokens: useMax,
        system,
        messages,
      }),
    })

    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    res.status(500).json({ error: 'AI proxy error' })
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

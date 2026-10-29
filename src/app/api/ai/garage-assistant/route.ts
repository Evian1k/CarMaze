import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '@/lib/format'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are CARMAZE's garage assistant. A customer describes vehicle symptoms. Respond ONLY JSON: {guidance: string (2-3 sentences of practical, safety-aware general advice; you are NOT a mechanic and must not give a definitive diagnosis; recommend professional inspection for anything safety-related), categories: [1-3 service categories from this exact list: GENERAL_SERVICE, MECHANICAL, ELECTRICAL, TYRES, BODYWORK, DETAILING, MODIFICATIONS, AUDIO, INSPECTION, TOWING, ROADSIDE, OTHER]}. No diagnosis certainty.`

const schema = z.object({
  symptoms: z.string().trim().min(5, 'Describe the problem in a few words.').max(600),
})

/** Extract the first '{' … last '}' span and parse — tolerates markdown fences / chatter. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`ai-garage:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) {
    const wait = rl.retryAfterSec > 90 ? `${Math.ceil(rl.retryAfterSec / 60)} minutes` : `${rl.retryAfterSec} seconds`
    return fail(429, 'RATE_LIMITED', `Too many guidance requests. Please try again in about ${wait}.`)
  }

  const { symptoms } = await parseBody(req, schema)

  let guidance = ''
  let categories: string[] = []
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        { role: 'user', content: symptoms },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content ?? ''
    const parsed = extractJson(text) as { guidance?: unknown; categories?: unknown } | null
    if (!parsed || typeof parsed !== 'object') throw new Error('MALFORMED_AI_RESPONSE')
    guidance = typeof parsed.guidance === 'string' ? parsed.guidance.trim().slice(0, 1200) : ''
    if (!guidance) throw new Error('EMPTY_AI_GUIDANCE')
    // Keep only recognised categories, capped at 3 — drop anything invented.
    if (Array.isArray(parsed.categories)) {
      categories = parsed.categories
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim().toUpperCase())
        .filter((c): c is (typeof SERVICE_CATEGORIES)[number] => (SERVICE_CATEGORIES as readonly string[]).includes(c))
        .slice(0, 3)
    }
    if (categories.length === 0) categories = ['OTHER']
  } catch (e) {
    const errCode = e instanceof Error ? e.message : 'UNKNOWN'
    console.error('[ai:garage-assistant] attempt failed:', errCode)
    await db.aiUsage.create({ data: { userId: user.id, feature: 'garage-assistant', ok: false, error: errCode.slice(0, 200) } })
    return fail(503, 'AI_UNAVAILABLE', 'The AI assistant is temporarily unavailable. Please try again shortly.')
  }

  await db.aiUsage.create({ data: { userId: user.id, feature: 'garage-assistant', ok: true } })

  return ok({
    guidance,
    categories,
    categoryLabels: categories.map((c) => ({ category: c, label: SERVICE_CATEGORY_LABELS[c] ?? c })),
  })
})

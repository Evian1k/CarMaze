import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are CARMAZE's listing assistant. Write an honest, attractive vehicle description (80-150 words) for a Kenyan marketplace listing using ONLY the supplied facts. Do NOT invent specifications, ownership history, accident history, service history or claims not present. Never mention equipment or features that were not listed (no air conditioning, power steering, windows, interior condition, tyres etc. unless supplied). Never make generic condition claims like "clean" or "well maintained" — stick to the facts. If information is missing, write 'Details on request'. Plain text, no headings, no emojis.`

const schema = z.object({
  facts: z.object({
    make: z.string().trim().min(1).max(40).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    year: z.number().int().min(1950).max(2100).optional(),
    mileageKm: z.number().int().min(0).max(2_000_000).optional(),
    condition: z.string().trim().max(20).optional(),
    county: z.string().trim().max(40).optional(),
    features: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    notes: z.string().trim().max(600).optional(),
  }),
})

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`ai-listing:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) {
    const wait = rl.retryAfterSec > 90 ? `${Math.ceil(rl.retryAfterSec / 60)} minutes` : `${rl.retryAfterSec} seconds`
    return fail(429, 'RATE_LIMITED', `Too many drafts requested. Please try again in about ${wait}.`)
  }

  const { facts } = await parseBody(req, schema)

  // Compact the seller's own facts into the prompt — the model sees nothing else.
  const factLines: string[] = []
  if (facts.make) factLines.push(`Make: ${facts.make}`)
  if (facts.model) factLines.push(`Model: ${facts.model}`)
  if (facts.year) factLines.push(`Year: ${facts.year}`)
  if (typeof facts.mileageKm === 'number') factLines.push(`Mileage: ${facts.mileageKm.toLocaleString('en-KE')} km`)
  if (facts.condition) factLines.push(`Condition: ${facts.condition.replace(/_/g, ' ').toLowerCase()}`)
  if (facts.county) factLines.push(`Location: ${facts.county}`)
  if (facts.features && facts.features.length > 0) factLines.push(`Features: ${facts.features.join(', ')}`)
  if (facts.notes) factLines.push(`Seller notes: ${facts.notes}`)

  let description = ''
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        { role: 'user', content: factLines.length > 0 ? factLines.join('\n') : 'No facts supplied.' },
      ],
      thinking: { type: 'disabled' },
    })
    description = (completion.choices[0]?.message?.content ?? '').trim()
    if (!description) throw new Error('EMPTY_AI_RESPONSE')
  } catch (e) {
    const errCode = e instanceof Error ? e.message : 'UNKNOWN'
    console.error('[ai:listing-assistant] attempt failed:', errCode)
    await db.aiUsage.create({ data: { userId: user.id, feature: 'listing-assistant', ok: false, error: errCode.slice(0, 200) } })
    return fail(503, 'AI_UNAVAILABLE', 'The AI assistant is temporarily unavailable. Please try again shortly.')
  }

  await db.aiUsage.create({ data: { userId: user.id, feature: 'listing-assistant', ok: true } })

  return ok({ description })
})

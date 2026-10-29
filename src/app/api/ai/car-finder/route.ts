import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are CARMAZE's car-finder assistant for Kenya. Convert the buyer's description into search filters. Respond with ONLY JSON: {summary: string (1-2 sentences, friendly), filters: {q?, make?, bodyType?, county?, fuel?, transmission?, condition?, minPriceMinor?, maxPriceMinor?, minYear?, maxYear?}}. bodyType must be one of SUV SEDAN HATCHBACK PICKUP MINIVAN COUPE WAGON TRUCK MOTORBIKE or omitted. fuel: PETROL DIESEL HYBRID ELECTRIC. transmission: AUTOMATIC MANUAL. condition: BRAND_NEW FOREIGN_USED LOCAL_USED. Prices in KES cents (minor units): e.g. 4,000,000 KES = 400000000. Only include filters clearly implied. Never invent vehicle data.`

const schema = z.object({
  query: z.string().trim().min(5, 'Tell us a bit more — at least 5 characters.').max(600),
})

const BODY_TYPES = ['SUV', 'SEDAN', 'HATCHBACK', 'PICKUP', 'MINIVAN', 'COUPE', 'WAGON', 'TRUCK', 'MOTORBIKE']
const FUELS = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']
const TRANSMISSIONS = ['AUTOMATIC', 'MANUAL']
const CONDITIONS = ['BRAND_NEW', 'FOREIGN_USED', 'LOCAL_USED']

type RawFilters = {
  q?: unknown
  make?: unknown
  bodyType?: unknown
  county?: unknown
  fuel?: unknown
  transmission?: unknown
  condition?: unknown
  minPriceMinor?: unknown
  maxPriceMinor?: unknown
  minYear?: unknown
  maxYear?: unknown
}

type CoercedFilters = {
  q?: string
  make?: string
  bodyType?: string
  county?: string
  fuel?: string
  transmission?: string
  condition?: string
  minPriceMinor?: number
  maxPriceMinor?: number
  minYear?: number
  maxYear?: number
}

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

function asString(v: unknown, max = 60): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s.length > 0 ? s.slice(0, max) : undefined
}

function asEnum(v: unknown, allowed: string[]): string | undefined {
  const s = asString(v, 20)?.toUpperCase()
  return s && allowed.includes(s) ? s : undefined
}

function asInt(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : NaN
  if (!Number.isFinite(n)) return undefined
  const i = Math.round(n)
  return i >= min && i <= max ? i : undefined
}

/** Validate/coerce LLM output — any field we can't trust is dropped, never guessed. */
function coerceFilters(raw: unknown): CoercedFilters {
  const r = (raw ?? {}) as RawFilters
  const out: CoercedFilters = {}
  const q = asString(r.q, 80)
  const make = asString(r.make, 40)
  const county = asString(r.county, 40)
  if (q) out.q = q
  if (make) out.make = make
  if (county) out.county = county
  const bodyType = asEnum(r.bodyType, BODY_TYPES)
  const fuel = asEnum(r.fuel, FUELS)
  const transmission = asEnum(r.transmission, TRANSMISSIONS)
  const condition = asEnum(r.condition, CONDITIONS)
  if (bodyType) out.bodyType = bodyType
  if (fuel) out.fuel = fuel
  if (transmission) out.transmission = transmission
  if (condition) out.condition = condition
  const minPrice = asInt(r.minPriceMinor, 10000, 5_000_000_000)
  const maxPrice = asInt(r.maxPriceMinor, 10000, 5_000_000_000)
  if (minPrice) out.minPriceMinor = minPrice
  if (maxPrice) out.maxPriceMinor = maxPrice
  const minYear = asInt(r.minYear, 1950, 2100)
  const maxYear = asInt(r.maxYear, 1950, 2100)
  if (minYear) out.minYear = minYear
  if (maxYear) out.maxYear = maxYear
  return out
}

export const POST = route(async (req: NextRequest) => {
  // Rate limit FIRST — stricter for anonymous callers to prevent abuse.
  const user = await getSessionUser()
  const rl = user
    ? rateLimit(`ai-finder:${user.id}`, 15, 60 * 60 * 1000)
    : rateLimit(`ai-finder:${getIp(req)}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) {
    const wait = rl.retryAfterSec > 90 ? `${Math.ceil(rl.retryAfterSec / 60)} minutes` : `${rl.retryAfterSec} seconds`
    return fail(429, 'RATE_LIMITED', `Too many searches. Please try again in about ${wait}.`)
  }

  const body = await parseBody(req, schema)

  // Ask the LLM to translate the buyer's description into search filters.
  let summary = ''
  let filters: CoercedFilters = {}
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        { role: 'user', content: body.query },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content ?? ''
    const parsed = extractJson(text) as { summary?: unknown; filters?: unknown } | null
    if (!parsed || typeof parsed !== 'object') throw new Error('MALFORMED_AI_RESPONSE')
    summary = asString(parsed.summary, 400) ?? ''
    if (!summary) throw new Error('EMPTY_AI_SUMMARY')
    filters = coerceFilters(parsed.filters)
  } catch (e) {
    const errCode = e instanceof Error ? e.message : 'UNKNOWN'
    console.error('[ai:car-finder] attempt failed:', errCode)
    await db.aiUsage.create({ data: { userId: user?.id ?? null, feature: 'car-finder', ok: false, error: errCode.slice(0, 200) } })
    return fail(503, 'AI_UNAVAILABLE', 'The AI assistant is temporarily unavailable. Please try again shortly.')
  }

  // Query REAL published listings only — the AI never invents vehicles.
  const where: Prisma.VehicleWhereInput = { status: 'PUBLISHED' }
  const and: Prisma.VehicleWhereInput[] = []
  if (filters.q) {
    and.push({
      OR: [
        { make: { contains: filters.q } },
        { model: { contains: filters.q } },
        { description: { contains: filters.q } },
      ],
    })
  }
  if (filters.make) and.push({ make: { contains: filters.make } })
  if (filters.county) and.push({ county: { contains: filters.county } })
  if (filters.bodyType) and.push({ bodyType: filters.bodyType })
  if (filters.fuel) and.push({ fuel: filters.fuel })
  if (filters.transmission) and.push({ transmission: filters.transmission })
  if (filters.condition) and.push({ condition: filters.condition })
  if (filters.minPriceMinor || filters.maxPriceMinor) {
    and.push({ priceMinor: { gte: filters.minPriceMinor, lte: filters.maxPriceMinor } })
  }
  if (filters.minYear || filters.maxYear) {
    and.push({ year: { gte: filters.minYear, lte: filters.maxYear } })
  }
  if (and.length > 0) where.AND = and

  const rows = await db.vehicle.findMany({
    where,
    orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    take: 8,
    include: { photos: { orderBy: { order: 'asc' } }, org: { select: { name: true } } },
  })

  const vehicles = rows.map((v) => ({
    id: v.id,
    refCode: v.refCode,
    make: v.make,
    model: v.model,
    year: v.year,
    priceMinor: v.priceMinor,
    currency: v.currency,
    mileageKm: v.mileageKm,
    fuel: v.fuel,
    transmission: v.transmission,
    bodyType: v.bodyType,
    condition: v.condition,
    county: v.county,
    status: 'PUBLISHED' as const,
    featured: v.featured,
    photos: v.photos.map((p) => ({ url: p.url, order: p.order })),
    sellerType: v.sellerType,
    orgName: v.org?.name ?? null,
  }))

  let message = summary
  if (vehicles.length === 0) {
    message = `${summary} No current listings match — try widening the budget or body type.`
  }

  await db.aiUsage.create({ data: { userId: user?.id ?? null, feature: 'car-finder', ok: true } })

  return ok({ message, filters, vehicles })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { getIp } from '@/lib/api'
import { audit } from '@/lib/audit'

const ALLOWED_KEYS = ['contact', 'review_sla', 'policies', 'faqs', 'home_hero']

/** GET /api/admin/settings — all system settings, JSON-parsed (ADMIN/FOUNDER). */
export const GET = route(async () => {
  await requireRole('ADMIN', 'FOUNDER')
  const rows = await db.systemSetting.findMany({ orderBy: { key: 'asc' } })
  const settings = rows.map((r) => {
    let value: unknown = null
    try {
      value = JSON.parse(r.value)
    } catch {
      value = r.value // raw string if it was stored non-JSON — never crash the dashboard
    }
    return { key: r.key, value, updatedAt: r.updatedAt }
  })
  return ok({ settings, allowedKeys: ALLOWED_KEYS })
})

const putSchema = z.object({
  key: z.enum(['contact', 'review_sla', 'policies', 'faqs', 'home_hero']),
  value: z.unknown(),
})

/**
 * PUT /api/admin/settings — upsert one whitelisted setting key.
 * Audit records the key only (metadata stays small — values can be long).
 * Changes apply live: public routes read these rows on every request.
 */
export const PUT = route(async (req: NextRequest) => {
  const user = await requireRole('ADMIN', 'FOUNDER')
  const rl = rateLimit(`admin-settings:${user.id}:${getIp(req)}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many setting changes. Try again later.')

  const body = await parseBody(req, putSchema)
  if (!ALLOWED_KEYS.includes(body.key)) {
    // Defensive: zod enum already rejects unknown keys.
    return fail(400, 'UNKNOWN_SETTING_KEY', `Unknown setting key "${body.key}".`)
  }

  await db.systemSetting.upsert({
    where: { key: body.key },
    update: { value: JSON.stringify(body.value ?? null) },
    create: { key: body.key, value: JSON.stringify(body.value ?? null) },
  })
  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'SETTING_UPDATED',
    targetType: 'SYSTEM_SETTING',
    targetId: body.key,
    metadata: { key: body.key },
  })
  const row = await db.systemSetting.findUnique({ where: { key: body.key } })
  return ok({ key: body.key, value: row ? JSON.parse(row.value) : null, updatedAt: row?.updatedAt })
})

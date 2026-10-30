import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { getMembership } from '@/lib/orgs'
import { buildStorefrontPayload } from '@/lib/storefront'

export const dynamic = 'force-dynamic'

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

const timeString = z.string().trim().min(1).max(5)

const openingHoursSchema = z
  .record(z.string(), z.union([z.tuple([timeString, timeString]), z.null()]))
  .refine((v) => Object.keys(v).every((k) => (DAY_KEYS as readonly string[]).includes(k)), {
    message: 'openingHours keys must be mon..sun',
  })

const urlField = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((v) => v.startsWith('/') || v.startsWith('http://') || v.startsWith('https://'), {
    message: 'Must be a local (/…) or absolute http(s) URL',
  })

const patchSchema = z.object({
  logoUrl: urlField.nullable().optional(),
  coverUrl: urlField.nullable().optional(),
  gallery: z.array(urlField).max(8).optional(),
  openingHours: openingHoursSchema.optional(),
  specialities: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  faqs: z
    .array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(2000) }))
    .max(8)
    .optional(),
  serviceAreas: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  whatsappEnabled: z.boolean().optional(),
  callEnabled: z.boolean().optional(),
  responseMinutes: z.number().int().min(5).max(1440).optional(),
})

/** PATCH ?id=orgId — storefront editor for org OWNER/MANAGER. */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`storefront:${getIp(req)}:${user.id}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many updates. Try again shortly.')

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'VALIDATION_ERROR', 'Missing ?id= for the organisation to update.')

  const org = await db.org.findUnique({ where: { id } })
  if (!org || (org.type !== 'DEALER' && org.type !== 'GARAGE')) {
    throw new ApiError(404, 'NOT_FOUND', 'Business not found.')
  }

  const membership = await getMembership(id, user.id)
  if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
    throw new ApiError(403, 'FORBIDDEN', 'Only org owners or managers can edit the storefront.')
  }

  const body = await parseBody(req, patchSchema)

  await db.org.update({
    where: { id },
    data: {
      ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
      ...(body.coverUrl !== undefined ? { coverUrl: body.coverUrl } : {}),
      ...(body.gallery !== undefined ? { gallery: JSON.stringify(body.gallery) } : {}),
      ...(body.openingHours !== undefined ? { openingHours: JSON.stringify(body.openingHours) } : {}),
      ...(body.specialities !== undefined ? { specialities: JSON.stringify(body.specialities) } : {}),
      ...(body.faqs !== undefined ? { faqs: JSON.stringify(body.faqs) } : {}),
      ...(body.serviceAreas !== undefined ? { serviceAreas: JSON.stringify(body.serviceAreas) } : {}),
      ...(body.whatsappEnabled !== undefined ? { whatsappEnabled: body.whatsappEnabled } : {}),
      ...(body.callEnabled !== undefined ? { callEnabled: body.callEnabled } : {}),
      ...(body.responseMinutes !== undefined ? { responseMinutes: body.responseMinutes } : {}),
    },
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'STOREFRONT_UPDATED',
    targetType: 'ORG',
    targetId: id,
    metadata: { org: org.name, fields: Object.keys(body) },
  })

  const payload = await buildStorefrontPayload(id)
  if (!payload) throw new ApiError(404, 'NOT_FOUND', 'Business not found.')
  return ok(payload)
})

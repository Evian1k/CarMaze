import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { SERVICE_CATEGORIES } from '@/lib/format'

// ─────────────────────────── Guards ───────────────────────────

/** Verify the user is an OWNER/MANAGER member of an ACTIVE GARAGE org; returns the org. */
async function requireGarageAdmin(userId: string, orgId: string) {
  const org = await db.org.findUnique({ where: { id: orgId } })
  if (!org || org.type !== 'GARAGE') throw new ApiError(404, 'NOT_FOUND', 'Garage not found.')
  const membership = await db.orgMember.findFirst({
    where: { orgId, userId, role: { in: ['OWNER', 'MANAGER'] } },
  })
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Only garage owners or managers can manage services.')
  return org
}

const categorySchema = z.enum(SERVICE_CATEGORIES)

const createSchema = z.object({
  orgId: z.string().min(1),
  category: categorySchema,
  title: z.string().trim().min(3, 'Service title is required').max(120),
  description: z.string().trim().max(600).optional().or(z.literal('')),
  priceFromMinor: z.number().int().positive('Price must be greater than zero').max(10_000_000_000).nullable().optional(),
})

const updateSchema = z.object({
  category: categorySchema.optional(),
  title: z.string().trim().min(3, 'Service title is too short').max(120).optional(),
  description: z.string().trim().max(600).nullable().optional(),
  priceFromMinor: z.number().int().positive('Price must be greater than zero').max(10_000_000_000).nullable().optional(),
  active: z.boolean().optional(),
})

// ─────────────────────────── GET (public) ───────────────────────────

export const GET = route(async (req: NextRequest) => {
  const orgId = new URL(req.url).searchParams.get('orgId')
  if (!orgId) return fail(400, 'VALIDATION_ERROR', 'Missing ?orgId=.')

  const org = await db.org.findFirst({ where: { id: orgId, type: 'GARAGE', status: 'ACTIVE' } })
  if (!org) throw new ApiError(404, 'NOT_FOUND', 'Garage not found.')

  const services = await db.garageService.findMany({
    where: { orgId, active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, category: true, title: true, description: true, priceFromMinor: true, active: true, createdAt: true },
  })
  return ok({ services })
})

// ─────────────────────────── POST ───────────────────────────

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`garage-services:${getIp(req)}:${user.id}`, 40, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many changes. Try again shortly.')

  const body = await parseBody(req, createSchema)
  await requireGarageAdmin(user.id, body.orgId)

  const service = await db.garageService.create({
    data: {
      orgId: body.orgId,
      category: body.category,
      title: body.title,
      description: body.description || null,
      priceFromMinor: body.priceFromMinor ?? null,
      active: true,
    },
  })
  await audit({
    actorId: user.id, actorName: user.name,
    action: 'GARAGE_SERVICE_CREATED', targetType: 'GARAGE_SERVICE', targetId: service.id,
    metadata: { orgId: body.orgId, category: body.category },
  })
  return ok({ service }, { status: 201 })
})

// ─────────────────────────── PATCH ───────────────────────────

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'VALIDATION_ERROR', 'Missing ?id=.')

  const existing = await db.garageService.findUnique({ where: { id } })
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Service not found.')
  await requireGarageAdmin(user.id, existing.orgId)

  const body = await parseBody(req, updateSchema)
  const data: Record<string, unknown> = {}
  if (body.category !== undefined) data.category = body.category
  if (body.title !== undefined) data.title = body.title
  if (body.description !== undefined) data.description = body.description || null
  if (body.priceFromMinor !== undefined) data.priceFromMinor = body.priceFromMinor
  if (body.active !== undefined) data.active = body.active
  if (Object.keys(data).length === 0) return fail(400, 'VALIDATION_ERROR', 'Nothing to update.')

  const service = await db.garageService.update({ where: { id }, data })
  await audit({
    actorId: user.id, actorName: user.name,
    action: 'GARAGE_SERVICE_UPDATED', targetType: 'GARAGE_SERVICE', targetId: id,
    metadata: { orgId: existing.orgId, fields: Object.keys(data) },
  })
  return ok({ service })
})

// ─────────────────────────── DELETE (soft: active=false) ───────────────────────────

export const DELETE = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'VALIDATION_ERROR', 'Missing ?id=.')

  const existing = await db.garageService.findUnique({ where: { id } })
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Service not found.')
  await requireGarageAdmin(user.id, existing.orgId)

  const service = await db.garageService.update({ where: { id }, data: { active: false } })
  await audit({
    actorId: user.id, actorName: user.name,
    action: 'GARAGE_SERVICE_DEACTIVATED', targetType: 'GARAGE_SERVICE', targetId: id,
    metadata: { orgId: existing.orgId },
  })
  return ok({ service })
})

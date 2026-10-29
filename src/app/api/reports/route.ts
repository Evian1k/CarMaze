import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, requireRole, getIp } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

const createSchema = z.object({
  targetType: z.enum(['LISTING', 'POST', 'COMMENT', 'USER']),
  targetId: z.string().min(1),
  reason: z.string().trim().min(3).max(80),
  details: z.string().trim().max(1000).optional(),
})

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`report:${getIp(req)}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many reports submitted recently.')

  const body = await parseBody(req, createSchema)
  const report = await db.report.create({
    data: {
      reporterId: user.id,
      targetType: body.targetType,
      targetId: body.targetId,
      reason: body.reason,
      details: body.details || null,
    },
  })
  return ok({ report: { id: report.id } }, { status: 201 })
})

export const GET = route(async (req: NextRequest) => {
  await requireRole(...STAFF_ROLES)
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'OPEN'
  const reports = await db.report.findMany({
    where: status === 'ALL' ? {} : { status },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return ok({ reports })
})

const patchSchema = z.object({
  id: z.string(),
  status: z.enum(['RESOLVED', 'DISMISSED', 'OPEN']),
  resolutionNote: z.string().trim().max(1000).optional(),
})

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireRole(...STAFF_ROLES)
  const body = await parseBody(req, patchSchema)
  const report = await db.report.update({
    where: { id: body.id },
    data: { status: body.status, resolvedBy: user.id, resolutionNote: body.resolutionNote || null },
  })
  return ok({ report })
})

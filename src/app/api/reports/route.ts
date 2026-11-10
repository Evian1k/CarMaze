import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, requireRole, getIp } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { demoStaffMutationGuard } from '@/lib/demo'

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

/** Resolve who owns the reported content, for demo-sandbox decisions.
 * Missing target ⇒ null (demo sessions are then blocked, fail-closed). */
async function reportTargetOwner(targetType: string, targetId: string): Promise<{ subjectUserId?: string | null; subjectOrgId?: string | null } | null> {
  if (targetType === 'LISTING') {
    const v = await db.vehicle.findUnique({ where: { id: targetId }, select: { ownerId: true, orgId: true } })
    return v ? { subjectUserId: v.ownerId, subjectOrgId: v.orgId } : null
  }
  if (targetType === 'POST') {
    const p = await db.communityPost.findUnique({ where: { id: targetId }, select: { userId: true } })
    return p ? { subjectUserId: p.userId } : null
  }
  if (targetType === 'COMMENT') {
    const c = await db.postComment.findUnique({ where: { id: targetId }, select: { userId: true } })
    return c ? { subjectUserId: c.userId } : null
  }
  if (targetType === 'USER') {
    const u = await db.user.findUnique({ where: { id: targetId }, select: { id: true } })
    return u ? { subjectUserId: u.id } : null
  }
  return null
}

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireRole(...STAFF_ROLES)
  const body = await parseBody(req, patchSchema)
  // Demo sandbox: demo staff may only moderate reports whose CONTENT belongs
  // to the demo ecosystem (verified from the database, never from input).
  const report = await db.report.findUnique({
    where: { id: body.id },
    select: { targetType: true, targetId: true },
  })
  const owner = report ? await reportTargetOwner(report.targetType, report.targetId) : null
  if (owner) {
    await demoStaffMutationGuard(user, owner)
  } else {
    // Unknown target or unknown type: fail closed for demo sessions.
    await demoStaffMutationGuard(user, { platformWide: true })
  }
  const updated = await db.report.update({
    where: { id: body.id },
    data: { status: body.status, resolvedBy: user.id, resolutionNote: body.resolutionNote || null },
  })
  return ok({ report: updated })
})

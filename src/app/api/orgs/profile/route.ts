import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'

const patchSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  name: z.string().trim().min(2, 'Showroom name must be at least 2 characters').max(120).optional(),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  location: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email').max(120).optional().or(z.literal('')),
  town: z.string().trim().max(60).optional().or(z.literal('')),
  county: z.string().trim().min(2).max(60).optional(),
})

/**
 * PATCH /api/orgs/profile
 * Update a DEALER organisation profile. Only OWNER or MANAGER members of that
 * exact org may edit it: membership and role are verified server-side.
 */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, patchSchema)

  const membership = await db.orgMember.findUnique({
    where: { orgId_userId: { orgId: body.orgId, userId: user.id } },
    include: { org: { select: { id: true, type: true, name: true, status: true } } },
  })

  if (!membership || membership.org.type !== 'DEALER') {
    throw new ApiError(404, 'NOT_FOUND', 'Dealership not found for your account.')
  }
  if (!['OWNER', 'MANAGER'].includes(membership.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the dealership owner or a manager can edit the profile.')
  }

  const data: Record<string, string | null> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description || null
  if (body.location !== undefined) data.location = body.location || null
  if (body.phone !== undefined) data.phone = body.phone || null
  if (body.email !== undefined) data.email = body.email || null
  if (body.town !== undefined) data.town = body.town || null
  if (body.county !== undefined) data.county = body.county

  if (Object.keys(data).length === 0) {
    return fail(400, 'NOTHING_TO_UPDATE', 'No profile fields were provided.')
  }

  const org = await db.org.update({ where: { id: body.orgId }, data })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'ORG_PROFILE_UPDATED',
    targetType: 'ORG',
    targetId: org.id,
    metadata: { org: org.name, fields: Object.keys(data) },
  })

  return ok({ org })
})

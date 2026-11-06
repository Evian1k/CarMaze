import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  kind: z.enum(['BRANCH', 'WAREHOUSE']).optional(),
  address: z.string().trim().max(200).optional().nullable(),
  county: z.string().trim().min(2).max(60).optional(),
  town: z.string().trim().max(60).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  managerName: z.string().trim().max(80).optional().nullable(),
  operatingHours: z.record(z.string(), z.tuple([z.string(), z.string()]).or(z.null())).optional().nullable(),
  deliveryAreas: z.array(z.string().max(60)).max(20).optional().nullable(),
  status: z.enum(['ACTIVE', 'CLOSED']).optional(),
  isPrimary: z.boolean().optional(),
})

async function requireBranchAdmin(userId: string, branchId: string) {
  const branch = await db.orgBranch.findUnique({ where: { id: branchId }, include: { org: { select: { status: true } } } })
  if (!branch) throw new Error('NOT_FOUND')
  const membership = await db.orgMember.findFirst({
    where: { orgId: branch.orgId, userId, role: { in: ['OWNER', 'GM', 'OPERATIONS'] } },
  })
  if (!membership || branch.org.status !== 'ACTIVE') throw new Error('PERMISSION_DENIED')
  return branch
}

/** PATCH /api/supply/branches/[id]: update branch (owner/GM). */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  let branch
  try {
    branch = await requireBranchAdmin(user.id, id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'DENIED'
    return fail(msg === 'NOT_FOUND' ? 404 : 403, msg, msg === 'NOT_FOUND' ? 'Branch not found.' : 'Only the owner or general manager can edit branches.')
  }
  const body = await parseBody(req, patchSchema)
  if (body.isPrimary) {
    await db.orgBranch.updateMany({ where: { orgId: branch.orgId, isPrimary: true }, data: { isPrimary: false } })
  }
  const updated = await db.orgBranch.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.county !== undefined ? { county: body.county } : {}),
      ...(body.town !== undefined ? { town: body.town } : {}),
      ...(body.lat !== undefined ? { lat: body.lat } : {}),
      ...(body.lng !== undefined ? { lng: body.lng } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.managerName !== undefined ? { managerName: body.managerName } : {}),
      ...(body.operatingHours !== undefined ? { operatingHours: body.operatingHours ? JSON.stringify(body.operatingHours) : null } : {}),
      ...(body.deliveryAreas !== undefined ? { deliveryAreas: body.deliveryAreas ? JSON.stringify(body.deliveryAreas) : null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'BRANCH_UPDATED', targetType: 'ORG_BRANCH', targetId: id, metadata: { orgId: branch.orgId } })
  return ok({ branch: { ...updated, operatingHours: jsonParse(updated.operatingHours, null), deliveryAreas: jsonParse(updated.deliveryAreas, []) } })
})

/** DELETE: soft-close a branch (never hard delete: historical orders keep FKs). */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  let branch
  try {
    branch = await requireBranchAdmin(user.id, id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'DENIED'
    return fail(msg === 'NOT_FOUND' ? 404 : 403, msg, msg === 'NOT_FOUND' ? 'Branch not found.' : 'Only the owner or general manager can close branches.')
  }
  await db.orgBranch.update({ where: { id }, data: { status: 'CLOSED', isPrimary: false } })
  await audit({ actorId: user.id, actorName: user.name, action: 'BRANCH_CLOSED', targetType: 'ORG_BRANCH', targetId: id, metadata: { orgId: branch.orgId } })
  return ok({ closed: true })
})

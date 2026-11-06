import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireOwnOrg, jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

const branchSchema = z.object({
  orgId: z.string().min(1), // tenant id: checked against membership
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(1).max(12).toUpperCase(),
  kind: z.enum(['BRANCH', 'WAREHOUSE']).default('BRANCH'),
  address: z.string().trim().max(200).optional().nullable(),
  county: z.string().trim().min(2).max(60),
  town: z.string().trim().max(60).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  managerName: z.string().trim().max(80).optional().nullable(),
  operatingHours: z.record(z.string(), z.tuple([z.string(), z.string()]).or(z.null())).optional().nullable(),
  deliveryAreas: z.array(z.string().max(60)).max(20).optional().nullable(),
})

/**
 * GET /api/supply/branches?orgId=: branches/warehouses of a business the
 * requester belongs to. Used by all portals (garage branches, showroom
 * branches, supplier warehouses).
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgId = req.nextUrl.searchParams.get('orgId')
  if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required.')
  const ctx = await requireOwnOrg(user, 'SUPPLIER', undefined).catch(() => null)
  const membership = await db.orgMember.findFirst({ where: { orgId, userId: user.id } })
  if (!membership) return fail(403, 'NOT_A_MEMBER', 'You are not a member of this business.')
  const branches = await db.orgBranch.findMany({
    where: { orgId },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { productStocks: true, vehicles: true } } },
  })
  return ok({
    branches: branches.map((b) => ({
      ...b,
      operatingHours: jsonParse<Record<string, [string, string] | null> | null>(b.operatingHours, null),
      deliveryAreas: jsonParse<string[]>(b.deliveryAreas, []),
    })),
    viewerRole: membership.role,
    supplierCtx: Boolean(ctx),
  })
})

/** POST: create a branch/warehouse (owner or GM/operations). */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, branchSchema)
  const membership = await db.orgMember.findFirst({
    where: { orgId: body.orgId, userId: user.id, role: { in: ['OWNER', 'GM', 'OPERATIONS'] } },
    include: { org: { select: { type: true, status: true } } },
  })
  if (!membership || membership.org.status !== 'ACTIVE') {
    return fail(403, 'PERMISSION_DENIED', 'Only the business owner or general manager can create branches.')
  }
  const dup = await db.orgBranch.findUnique({ where: { orgId_code: { orgId: body.orgId, code: body.code } } })
  if (dup) return fail(409, 'CODE_EXISTS', 'A branch with this code already exists.')

  const first = (await db.orgBranch.count({ where: { orgId: body.orgId } })) === 0
  const branch = await db.orgBranch.create({
    data: {
      orgId: body.orgId,
      name: body.name,
      code: body.code,
      kind: body.kind,
      isPrimary: first,
      address: body.address ?? null,
      county: body.county,
      town: body.town ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      phone: body.phone ?? null,
      managerName: body.managerName ?? null,
      operatingHours: body.operatingHours ? JSON.stringify(body.operatingHours) : null,
      deliveryAreas: body.deliveryAreas ? JSON.stringify(body.deliveryAreas) : null,
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'BRANCH_CREATED', targetType: 'ORG_BRANCH', targetId: branch.id, metadata: { orgId: body.orgId, name: branch.name, kind: branch.kind } })
  return ok({ branch }, { status: 201 })
})

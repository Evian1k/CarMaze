import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'
import { jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/org/transfers?orgId= — inter-branch vehicle transfers for a
 * multi-branch showroom/garage. Complete custody chain via events.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgId = req.nextUrl.searchParams.get('orgId')
  if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required.')
  const membership = await getMembership(orgId, user.id)
  if (!membership) return fail(403, 'NOT_A_MEMBER', 'Not a member of this business.')
  const transfers = await db.vehicleTransfer.findMany({
    where: { orgId },
    include: {
      vehicle: { select: { id: true, refCode: true, make: true, model: true, year: true, status: true, branchId: true } },
      fromBranch: { select: { id: true, name: true, code: true, town: true } },
      toBranch: { select: { id: true, name: true, code: true, town: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 80,
  })
  return ok({
    transfers: transfers.map((t) => ({
      ...t,
      conditionOut: jsonParse<Record<string, unknown> | null>(t.conditionOutJson, null),
      conditionIn: jsonParse<Record<string, unknown> | null>(t.conditionInJson, null),
    })),
  })
})

const createSchema = z.object({
  orgId: z.string().min(1),
  vehicleId: z.string().min(1),
  toBranchId: z.string().min(1),
  note: z.string().max(300).optional(),
})

/** POST — request a transfer of a vehicle to another branch of the SAME company. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, createSchema)
  const membership = await getMembership(body.orgId, user.id)
  if (!membership || !['OWNER', 'GM', 'MANAGER', 'BRANCH_MANAGER', 'INVENTORY'].includes(membership.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Not authorised to request transfers.')
  }
  const vehicle = await db.vehicle.findFirst({ where: { id: body.vehicleId, orgId: body.orgId } })
  if (!vehicle) return fail(404, 'NOT_FOUND', 'Vehicle does not belong to your company.')
  if (vehicle.branchId === body.toBranchId) return fail(400, 'SAME_BRANCH', 'Vehicle is already at that branch.')
  const toBranch = await db.orgBranch.findFirst({ where: { id: body.toBranchId, orgId: body.orgId, status: 'ACTIVE' } })
  if (!toBranch) return fail(400, 'BAD_BRANCH', 'Target branch does not belong to your company.')
  if (['DISPATCHED', 'IN_TRANSIT'].includes(vehicle.status)) return fail(409, 'IN_TRANSIT', 'Vehicle appears to be in transit already.')

  const fromBranchId = vehicle.branchId ?? (await db.orgBranch.findFirst({ where: { orgId: body.orgId, isPrimary: true }, select: { id: true } }))?.id
  if (!fromBranchId) return fail(400, 'NO_SOURCE', 'Vehicle has no source branch; assign one first.')
  if (fromBranchId === body.toBranchId) return fail(400, 'SAME_BRANCH', 'Vehicle is already at that branch.')

  const transfer = await db.vehicleTransfer.create({
    data: {
      refCode: refCode('VTR', 6),
      orgId: body.orgId,
      vehicleId: vehicle.id,
      fromBranchId,
      toBranchId: body.toBranchId,
      requestedById: user.id,
      status: 'REQUESTED',
      events: { create: { type: 'REQUESTED', actorId: user.id, actorName: user.name, note: body.note ?? 'Transfer requested.' } },
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'VEHICLE_TRANSFER_REQUESTED', targetType: 'VEHICLE_TRANSFER', targetId: transfer.id, metadata: { ref: transfer.refCode, vehicle: vehicle.refCode } })
  return ok({ transfer, message: 'Transfer requested. It requires authorisation before dispatch.' }, { status: 201 })
})

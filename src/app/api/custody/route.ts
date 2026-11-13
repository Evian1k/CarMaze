import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notifyOrgMembers } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

const fuelLevels = ['E', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL'] as const

const createSchema = z.object({
  orgId: z.string().min(1),
  myVehicleId: z.string().min(1).optional(),
  vehicleDesc: z.string().trim().min(3).max(200),
  plate: z.string().trim().max(20).optional(),
  odometerKm: z.number().int().min(0).max(2_000_000).optional(),
  fuelLevel: z.enum(fuelLevels).optional(),
  conditionNotes: z.string().trim().max(2000).optional(),
  photos: z.array(z.string().trim().min(1).max(500)).max(6).optional(),
  valuables: z.string().trim().max(500).optional(),
  requestedWork: z.string().trim().min(10).max(4000),
  authorisedSpendMinor: z.number().int().min(0).max(9_999_999_999).optional(),
  roadTestAllowed: z.boolean(),
})

/**
 * POST: customer requests a protected handover of their vehicle to a garage
 * (Garage Vehicle Protection). Starts the custody lifecycle at
 * HANDOVER_REQUESTED.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`custody-create:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many handover requests. Try again later.')

  const body = await parseBody(req, createSchema)

  const org = await db.org.findUnique({ where: { id: body.orgId } })
  if (!org) throw new ApiError(404, 'NOT_FOUND', 'Garage not found.')
  if (org.type !== 'GARAGE') {
    throw new ApiError(400, 'INVALID_ORG', 'Vehicle protection handover is only available for garages.')
  }
  if (org.status !== 'ACTIVE') {
    throw new ApiError(400, 'ORG_INACTIVE', 'This garage is not currently accepting handovers.')
  }
  // DEMO SANDBOX: a demo session must not attach custody rows to a real
  // garage's operational dashboard. Handovers inside the demo garage
  // ecosystem (org flagged isDemo) remain fully explorable.
  if (user.isDemo && !org.isDemo) {
    return fail(403, 'DEMO_SANDBOXED', 'Demo mode: handover requests can only be created for garages inside the demo ecosystem.')
  }

  if (body.myVehicleId) {
    const myVehicle = await db.myVehicle.findUnique({ where: { id: body.myVehicleId } })
    if (!myVehicle || myVehicle.userId !== user.id) {
      throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found in My Garage.')
    }
  }

  const custody = await db.vehicleCustody.create({
    data: {
      refCode: refCode('HC-'),
      orgId: org.id,
      customerId: user.id,
      myVehicleId: body.myVehicleId ?? null,
      vehicleDesc: body.vehicleDesc,
      plate: body.plate ?? null,
      odometerKm: body.odometerKm ?? null,
      fuelLevel: body.fuelLevel ?? null,
      conditionNotes: body.conditionNotes ?? null,
      photos: body.photos ? JSON.stringify(body.photos) : null,
      valuables: body.valuables ?? null,
      requestedWork: body.requestedWork,
      authorisedSpendMinor: body.authorisedSpendMinor ?? null,
      roadTestAllowed: body.roadTestAllowed,
      status: 'HANDOVER_REQUESTED',
      events: {
        create: {
          type: 'HANDOVER',
          actorId: user.id,
          actorName: user.name,
          actorSide: 'CUSTOMER',
          note: 'Handover requested: customer drop-off pending.',
        },
      },
    },
  })

  await notifyOrgMembers(org.id, {
    type: 'CUSTODY_UPDATE',
    title: `New vehicle handover: ${custody.refCode}`,
    body: `${user.name} requested protected custody for ${custody.vehicleDesc}.`,
    link: '/garage-dashboard?tab=custody',
  })

  return ok({ custody: { id: custody.id, refCode: custody.refCode, status: custody.status, createdAt: custody.createdAt.toISOString() } })
})

/** GET ?mine=1 (customer) | ?org=1 (garage member) */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)

  if (url.searchParams.get('mine') === '1') {
    const custodies = await db.vehicleCustody.findMany({
      where: { customerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { org: { select: { name: true } } },
    })
    return ok({
      custodies: custodies.map((c) => ({
        id: c.id,
        refCode: c.refCode,
        orgId: c.orgId,
        orgName: c.org.name,
        vehicleDesc: c.vehicleDesc,
        plate: c.plate,
        status: c.status,
        requestedWork: c.requestedWork,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    })
  }

  if (url.searchParams.get('org') === '1') {
    const memberships = await db.orgMember.findMany({ where: { userId: user.id }, select: { orgId: true } })
    const custodies = await db.vehicleCustody.findMany({
      where: { orgId: { in: memberships.map((m) => m.orgId) } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { customer: { select: { name: true } } },
    })
    return ok({
      custodies: custodies.map((c) => ({
        id: c.id,
        refCode: c.refCode,
        customerId: c.customerId,
        customerName: c.customer.name,
        vehicleDesc: c.vehicleDesc,
        plate: c.plate,
        status: c.status,
        requestedWork: c.requestedWork,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    })
  }

  return fail(400, 'VALIDATION_ERROR', 'Provide ?mine=1 or ?org=1.')
})

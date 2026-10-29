import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'
import { STAFF_ROLES } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'

// ───────────────────────── helpers ─────────────────────────

function isStaffRole(roles: string[]): boolean {
  return STAFF_ROLES.some((r) => roles.includes(r))
}

async function myOrgIds(userId: string): Promise<string[]> {
  const memberships = await db.orgMember.findMany({ where: { userId }, select: { orgId: true } })
  return memberships.map((m) => m.orgId)
}

const offerInclude = {
  org: { select: { id: true, name: true } },
  vehicle: { select: { id: true, make: true, model: true, year: true, refCode: true, priceMinor: true, currency: true, status: true, ownerId: true } },
} as const

// ───────────────────────── GET /api/offers ─────────────────────────
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const params = new URL(req.url).searchParams

  if (params.get('vehicleId')) {
    // Offers on one vehicle — visible to the vehicle owner, its dealer org, or staff.
    const vehicleId = params.get('vehicleId') as string
    const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, ownerId: true, orgId: true } })
    if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found.')

    let allowed = isStaffRole(user.roles) || vehicle.ownerId === user.id
    if (!allowed && vehicle.orgId) {
      const membership = await db.orgMember.findFirst({ where: { orgId: vehicle.orgId, userId: user.id }, select: { id: true } })
      allowed = Boolean(membership)
    }
    if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'Only the seller can view offers on this vehicle.')

    const offers = await db.offer.findMany({
      where: { vehicleId },
      include: offerInclude,
      orderBy: { createdAt: 'desc' },
    })
    return ok({ offers })
  }

  if (params.get('incoming') === '1') {
    // All offers received on vehicles I own or my orgs own.
    const orgs = await myOrgIds(user.id)
    const offers = await db.offer.findMany({
      where: { vehicle: { OR: [{ ownerId: user.id }, { orgId: { in: orgs } }] } },
      include: offerInclude,
      orderBy: { createdAt: 'desc' },
    })
    return ok({ offers })
  }

  if (params.get('org') === '1') {
    // Offers my dealership(s) have sent.
    const orgs = await myOrgIds(user.id)
    const offers = await db.offer.findMany({
      where: { orgId: { in: orgs } },
      include: offerInclude,
      orderBy: { createdAt: 'desc' },
    })
    return ok({ offers })
  }

  return fail(400, 'BAD_REQUEST', 'Specify ?vehicleId=, ?incoming=1 or ?org=1.')
})

// ───────────────────────── POST /api/offers ─────────────────────────
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()

  const body = await parseBody(
    req,
    z.object({
      vehicleId: z.string().min(1),
      amountMinor: z.number().int().min(1000, 'Offer amount is too low').max(10_000_000_000),
      message: z.string().trim().max(500).optional(),
      days: z.number().int().min(1).max(30).optional(),
    })
  )

  // Only OWNER/MANAGER of an ACTIVE DEALER org can send offers.
  const memberships = await db.orgMember.findMany({
    where: { userId: user.id, role: { in: ['OWNER', 'MANAGER'] }, org: { type: 'DEALER', status: 'ACTIVE' } },
    include: { org: { select: { id: true, name: true } } },
  })
  const org = memberships[0]?.org
  if (!org) {
    throw new ApiError(403, 'DEALER_ONLY', 'Only verified dealerships can send offers on matched listings.')
  }

  const vehicle = await db.vehicle.findUnique({
    where: { id: body.vehicleId },
    select: { id: true, ownerId: true, orgId: true, sellerType: true, matchWithDealers: true, status: true, make: true, model: true, year: true, refCode: true },
  })
  if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found.')
  if (vehicle.sellerType !== 'PRIVATE' || vehicle.matchWithDealers !== true || vehicle.status !== 'PUBLISHED') {
    return fail(409, 'NOT_MATCHED', 'This seller isn\u2019t accepting dealer offers on this listing.')
  }
  if (vehicle.ownerId === user.id) {
    return fail(400, 'OWN_LISTING', 'You can\u2019t offer on your own listing.')
  }

  const days = body.days ?? 7
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

  const offer = await db.offer.create({
    data: {
      vehicleId: vehicle.id,
      orgId: org.id,
      amountMinor: body.amountMinor,
      message: body.message || null,
      status: 'PENDING',
      expiresAt,
    },
    include: offerInclude,
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'offer.created',
    targetType: 'VEHICLE',
    targetId: vehicle.id,
    metadata: { offerId: offer.id, orgId: org.id, amountMinor: body.amountMinor },
  })

  await notify({
    userId: vehicle.ownerId,
    type: 'OFFER',
    title: 'New dealer offer on your car',
    body: `${org.name} offered on your ${vehicle.make} ${vehicle.model} ${vehicle.year}. Contact stays private until you accept.`,
    link: '/my-listings',
  })

  return ok({ offer }, { status: 201 })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'
import { STAFF_ROLES } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'

type Ctx = { params: Promise<{ id: string }> }

function isStaffRole(roles: string[]): boolean {
  return STAFF_ROLES.some((r) => roles.includes(r))
}

// ───────────────────────── PATCH /api/offers/[id] ─────────────────────────
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const { action } = await parseBody(req, z.object({ action: z.enum(['accept', 'reject', 'withdraw']) }))

  const offer = await db.offer.findUnique({
    where: { id },
    include: {
      org: { select: { id: true, name: true } },
      vehicle: { select: { id: true, ownerId: true, orgId: true, status: true, make: true, model: true, year: true, refCode: true } },
    },
  })
  if (!offer) throw new ApiError(404, 'NOT_FOUND', 'Offer not found.')

  // ── Withdraw: the offering dealer org (OWNER/MANAGER) ──
  if (action === 'withdraw') {
    const membership = await db.orgMember.findFirst({
      where: { orgId: offer.orgId, userId: user.id, role: { in: ['OWNER', 'MANAGER'] } },
      select: { id: true },
    })
    if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Only the dealership that made this offer can withdraw it.')
    if (offer.status !== 'PENDING') return fail(409, 'NOT_PENDING', `This offer was already ${offer.status.toLowerCase()}.`)

    const updated = await db.offer.update({ where: { id }, data: { status: 'WITHDRAWN' } })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'offer.withdrawn',
      targetType: 'OFFER',
      targetId: id,
      metadata: { vehicleId: offer.vehicleId, orgId: offer.orgId },
    })
    return ok({ offer: updated })
  }

  // ── Accept / reject: the vehicle owner (or staff) ──
  if (!isStaffRole(user.roles) && offer.vehicle.ownerId !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the seller can decide on this offer.')
  }
  if (offer.status !== 'PENDING') return fail(409, 'NOT_PENDING', `This offer was already ${offer.status.toLowerCase()}.`)
  // Expiry is enforced server-side: an offer past its expiresAt is dead even
  // though a sweep has not yet flipped the row.
  if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
    await db.offer.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } })
    return fail(409, 'OFFER_EXPIRED', 'This offer has expired and can no longer be accepted.')
  }

  if (action === 'reject') {
    const updated = await db.offer.update({ where: { id }, data: { status: 'REJECTED' } })
    const members = await db.orgMember.findMany({
      where: { orgId: offer.orgId, role: { in: ['OWNER', 'MANAGER', 'SALES'] } },
      select: { userId: true },
    })
    await notifyMany(members.map((m) => m.userId), {
      type: 'OFFER_REJECTED',
      title: 'Your offer was rejected',
      body: `The seller of the ${offer.vehicle.make} ${offer.vehicle.model} ${offer.vehicle.year} declined your offer.`,
      link: '/dealer',
    })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'offer.rejected',
      targetType: 'OFFER',
      targetId: id,
      metadata: { vehicleId: offer.vehicleId, orgId: offer.orgId },
    })
    return ok({ offer: updated })
  }

  // ── Accept: offer → ACCEPTED, other pending offers → EXPIRED, vehicle → RESERVED ──
  if (offer.vehicle.status !== 'PUBLISHED' && offer.vehicle.status !== 'RESERVED') {
    return fail(409, 'VEHICLE_NOT_AVAILABLE', `The vehicle is currently ${offer.vehicle.status.toLowerCase()} and can't be reserved.`)
  }

  const [updated] = await db.$transaction([
    db.offer.update({ where: { id }, data: { status: 'ACCEPTED' } }),
    db.offer.updateMany({
      where: { vehicleId: offer.vehicleId, status: 'PENDING', id: { not: id } },
      data: { status: 'EXPIRED' },
    }),
    db.vehicle.update({ where: { id: offer.vehicleId }, data: { status: 'RESERVED' } }),
    db.listingEvent.create({
      data: {
        vehicleId: offer.vehicleId,
        from: offer.vehicle.status,
        to: 'RESERVED',
        actorId: user.id,
        actorName: user.name,
        note: `Reserved: offer from ${offer.org.name} accepted`,
      },
    }),
  ])

  const members = await db.orgMember.findMany({
    where: { orgId: offer.orgId },
    select: { userId: true },
  })
  await notifyMany(members.map((m) => m.userId), {
    type: 'OFFER_ACCEPTED',
    title: 'Your offer was accepted 🎉',
    body: `The ${offer.vehicle.make} ${offer.vehicle.model} ${offer.vehicle.year} (${offer.vehicle.refCode}) is now Reserved for your dealership. The seller will contact you to complete the sale.`,
    link: '/dealer',
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'offer.accepted',
    targetType: 'OFFER',
    targetId: id,
    metadata: { vehicleId: offer.vehicleId, orgId: offer.orgId, vehicleStatus: 'RESERVED' },
  })

  return ok({ offer: updated, vehicle: { id: offer.vehicleId, status: 'RESERVED' } })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'
import { getSessionUser, STAFF_ROLES } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'

type Ctx = { params: Promise<{ id: string }> }

function isStaffRole(roles: string[]): boolean {
  return STAFF_ROLES.some((r) => roles.includes(r))
}

/** Platform staff who may MUTATE listings — mirrors /api/admin/listings.
 * Read-only staff roles (SUPPORT, FINANCE) can view any listing for support
 * purposes but must not edit or delete a seller's work. */
const LISTING_MODERATOR_ROLES = ['REVIEWER', 'MODERATOR', 'ADMIN', 'FOUNDER'] as const

function isModeratorRole(roles: string[]): boolean {
  return LISTING_MODERATOR_ROLES.some((r) => roles.includes(r))
}

/** Owner, dealer seller (OWNER/MANAGER/SALES) or platform moderator can manage a listing. */
async function canManageVehicle(userId: string, roles: string[], vehicle: { ownerId: string; orgId: string | null }): Promise<boolean> {
  if (vehicle.ownerId === userId) return true
  if (isModeratorRole(roles)) return true
  if (!vehicle.orgId) return false
  const membership = await db.orgMember.findFirst({
    where: { orgId: vehicle.orgId, userId, role: { in: ['OWNER', 'MANAGER', 'SALES'] } },
    select: { id: true },
  })
  return Boolean(membership)
}

async function notifyStaffReviewers(vehicle: { id: string; refCode: string; make: string; model: string; year: number }, actorName: string) {
  const staff = await db.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ roles: { contains: 'REVIEWER' } }, { roles: { contains: 'ADMIN' } }],
    },
    select: { id: true },
  })
  await notifyMany(staff.map((s) => s.id), {
    type: 'LISTING_REVIEW',
    title: 'Listing submitted for review',
    body: `${vehicle.make} ${vehicle.model} ${vehicle.year} (${vehicle.refCode}) was submitted by ${actorName}.`,
    link: `/vehicle-detail/${vehicle.id}`,
  })
}

const editSchema = z.object({
  action: z.enum(['submit', 'mark_sold', 'delete']).optional(),
  make: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(80).optional(),
  year: z.number().int().min(1980).max(new Date().getFullYear() + 1).optional(),
  priceMinor: z.number().int().min(1).max(10_000_000_000).optional(),
  mileageKm: z.number().int().min(0).max(2_000_000).optional(),
  fuel: z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']).optional(),
  transmission: z.enum(['AUTOMATIC', 'MANUAL']).optional(),
  bodyType: z.enum(['SUV', 'SEDAN', 'HATCHBACK', 'PICKUP', 'MINIVAN', 'COUPE', 'WAGON', 'TRUCK', 'MOTORBIKE']).optional(),
  condition: z.enum(['BRAND_NEW', 'FOREIGN_USED', 'LOCAL_USED']).optional(),
  county: z.string().trim().min(1).max(40).optional(),
  town: z.string().trim().max(60).optional(),
  color: z.string().trim().min(1).max(40).optional(),
  engineCc: z.number().int().min(50).max(10_000).nullable().optional(),
  description: z.string().trim().min(30).max(4000).optional(),
  matchWithDealers: z.boolean().optional(),
  photos: z.array(z.string().min(1).max(300)).max(8).optional(),
})

// ───────────────────────── GET /api/vehicles/[id] ─────────────────────────
export const GET = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const vehicle = await db.vehicle.findUnique({
    where: { id },
    include: {
      photos: { orderBy: { order: 'asc' as const } },
      owner: { select: { id: true, name: true, roles: true } },
      org: {
        select: { id: true, name: true, county: true, town: true, phone: true, location: true, description: true, status: true, isDemo: true },
      },
    },
  })
  if (!vehicle) {
    throw new ApiError(404, 'NOT_FOUND', 'This listing is not available.')
  }

  // Non-published listings are only visible to owner / org member / staff.
  const sessionUser = await getSessionUser()
  let privileged = false
  if (sessionUser) {
    if (isStaffRole(sessionUser.roles) || vehicle.ownerId === sessionUser.id) {
      privileged = true
    } else if (vehicle.orgId) {
      const membership = await db.orgMember.findFirst({
        where: { orgId: vehicle.orgId, userId: sessionUser.id },
        select: { id: true },
      })
      privileged = Boolean(membership)
    }
  }

  if (vehicle.status !== 'PUBLISHED' && !privileged) {
    throw new ApiError(404, 'NOT_FOUND', 'This listing is not available.')
  }

  // Similar: same bodyType or make, price within ±40%, newest first.
  const priceFloor = Math.round(vehicle.priceMinor * 0.6)
  const priceCeil = Math.round(vehicle.priceMinor * 1.4)
  const similarRows = await db.vehicle.findMany({
    where: {
      status: 'PUBLISHED',
      id: { not: vehicle.id },
      AND: [
        { priceMinor: { gte: priceFloor, lte: priceCeil } },
        { OR: [{ bodyType: vehicle.bodyType }, { make: vehicle.make }] },
      ],
    },
    include: {
      photos: { orderBy: { order: 'asc' as const } },
      org: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 4,
  })

  const similar = similarRows.map((v) => ({
    id: v.id,
    refCode: v.refCode,
    make: v.make,
    model: v.model,
    year: v.year,
    priceMinor: v.priceMinor,
    currency: v.currency,
    mileageKm: v.mileageKm,
    fuel: v.fuel,
    transmission: v.transmission,
    bodyType: v.bodyType,
    condition: v.condition,
    county: v.county,
    status: v.status,
    featured: v.featured,
    sellerType: v.sellerType,
    orgName: v.org?.name ?? null,
    photos: v.photos,
  }))

  const payload = {
    id: vehicle.id,
    refCode: vehicle.refCode,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    priceMinor: vehicle.priceMinor,
    currency: vehicle.currency,
    mileageKm: vehicle.mileageKm,
    fuel: vehicle.fuel,
    transmission: vehicle.transmission,
    bodyType: vehicle.bodyType,
    engineCc: vehicle.engineCc,
    condition: vehicle.condition,
    county: vehicle.county,
    town: vehicle.town,
    color: vehicle.color,
    description: vehicle.description,
    sellerType: vehicle.sellerType,
    status: vehicle.status,
    matchWithDealers: vehicle.matchWithDealers,
    featured: vehicle.featured,
    views: vehicle.views,
    createdAt: vehicle.createdAt,
    photos: vehicle.photos.map((p) => ({ url: p.url, order: p.order })),
    // Private sellers are never exposed with contact details. The verified
    // marker reflects an approved SELLER (KYC) application: never a self-claim.
    owner: {
      name: vehicle.owner.name,
      verifiedSeller: vehicle.owner.roles.split(',').includes('SELLER_VERIFIED'),
    },
    // Business contact for dealer listings (org phone, not a personal number).
    org: vehicle.org,
    // Internal review feedback only reaches the seller side.
    ...(privileged ? { reviewNote: vehicle.reviewNote } : {}),
  }

  return ok({ vehicle: payload, similar })
})

// ───────────────────────── PATCH /api/vehicles/[id] ─────────────────────────
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const vehicle = await db.vehicle.findUnique({
    where: { id },
    select: { id: true, ownerId: true, orgId: true, status: true, refCode: true, make: true, model: true, year: true },
  })
  if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Listing not found.')

  const allowed = await canManageVehicle(user.id, user.roles, vehicle)
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You can only manage your own listings.')

  const { action, ...fields } = await parseBody(req, editSchema)
  const hasFields = Object.keys(fields).length > 0

  // ── Action: delete (DRAFT/REJECTED only) ──
  if (action === 'delete') {
    if (vehicle.status !== 'DRAFT' && vehicle.status !== 'REJECTED') {
      return fail(409, 'NOT_DELETABLE', 'Only drafts or rejected listings can be deleted. Mark published listings as sold instead.')
    }
    await db.vehicle.delete({ where: { id } })
    await audit({ actorId: user.id, actorName: user.name, action: 'vehicle.deleted', targetType: 'VEHICLE', targetId: id, metadata: { refCode: vehicle.refCode } })
    return ok({ deleted: true })
  }

  // ── Field edits (DRAFT / PENDING_REVIEW / REJECTED only) ──
  if (hasFields) {
    if (!['DRAFT', 'PENDING_REVIEW', 'REJECTED'].includes(vehicle.status)) {
      return fail(409, 'NOT_EDITABLE', `Listings in status ${vehicle.status} can no longer be edited.`)
    }
    const data: Record<string, unknown> = { ...fields }
    if (fields.town !== undefined) data.town = fields.town || null
    if (fields.engineCc !== undefined) data.engineCc = fields.engineCc ?? null
    if (fields.photos !== undefined) {
      data.photos = {
        deleteMany: {},
        create: fields.photos.map((url, i) => ({ url, order: i })),
      }
    }
    await db.vehicle.update({ where: { id }, data })
    await db.listingEvent.create({
      data: { vehicleId: id, to: vehicle.status, actorId: user.id, actorName: user.name, note: 'Listing details updated' },
    })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'vehicle.updated',
      targetType: 'VEHICLE',
      targetId: id,
      metadata: { refCode: vehicle.refCode, fields: Object.keys(fields) },
    })
  }

  // ── Action: submit (DRAFT/REJECTED → PENDING_REVIEW) ──
  if (action === 'submit') {
    if (vehicle.status === 'DRAFT' || vehicle.status === 'REJECTED') {
      await db.vehicle.update({ where: { id }, data: { status: 'PENDING_REVIEW', reviewNote: null } })
      await db.listingEvent.create({
        data: { vehicleId: id, from: vehicle.status, to: 'PENDING_REVIEW', actorId: user.id, actorName: user.name, note: 'Submitted for review' },
      })
      await notifyStaffReviewers(vehicle, user.name)
      await notify({
        userId: user.id,
        type: 'LISTING_SUBMITTED',
        title: 'Your listing was submitted',
        body: `${vehicle.make} ${vehicle.model} ${vehicle.year} is under review: target 24 business hours.`,
        link: '/my-listings',
      })
      await audit({
        actorId: user.id,
        actorName: user.name,
        action: 'vehicle.submitted',
        targetType: 'VEHICLE',
        targetId: id,
        metadata: { refCode: vehicle.refCode, from: vehicle.status, to: 'PENDING_REVIEW' },
      })
    } else if (vehicle.status !== 'PENDING_REVIEW') {
      return fail(409, 'INVALID_TRANSITION', `A listing in status ${vehicle.status} can't be submitted for review.`)
    }
  }

  // ── Action: mark_sold (PUBLISHED/RESERVED → SOLD) ──
  if (action === 'mark_sold') {
    if (vehicle.status !== 'PUBLISHED' && vehicle.status !== 'RESERVED') {
      return fail(409, 'INVALID_TRANSITION', `Only published or reserved listings can be marked as sold (current: ${vehicle.status}).`)
    }
    await db.vehicle.update({ where: { id }, data: { status: 'SOLD' } })
    await db.listingEvent.create({
      data: { vehicleId: id, from: vehicle.status, to: 'SOLD', actorId: user.id, actorName: user.name, note: 'Marked as sold by seller' },
    })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'vehicle.marked_sold',
      targetType: 'VEHICLE',
      targetId: id,
      metadata: { refCode: vehicle.refCode, from: vehicle.status, to: 'SOLD' },
    })
  }

  const updated = await db.vehicle.findUnique({
    where: { id },
    include: { photos: { orderBy: { order: 'asc' as const } }, org: { select: { id: true, name: true } } },
  })
  return ok({ vehicle: updated })
})

// ───────────────────────── DELETE /api/vehicles/[id] ─────────────────────────
export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const vehicle = await db.vehicle.findUnique({ where: { id }, select: { ownerId: true, status: true, refCode: true } })
  if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Listing not found.')

  if (vehicle.ownerId !== user.id && !isModeratorRole(user.roles)) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only delete your own listings.')
  }

  if (vehicle.status !== 'DRAFT' && vehicle.status !== 'REJECTED') {
    return fail(409, 'NOT_DELETABLE', 'Only drafts or rejected listings can be deleted.')
  }

  await db.vehicle.delete({ where: { id } })
  await audit({ actorId: user.id, actorName: user.name, action: 'vehicle.deleted', targetType: 'VEHICLE', targetId: id, metadata: { refCode: vehicle.refCode } })
  return ok({ deleted: true })
})

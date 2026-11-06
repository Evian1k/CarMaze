import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'

// ───────────────────────── helpers ─────────────────────────

type VehicleWithRelations = {
  id: string
  refCode: string
  make: string
  model: string
  year: number
  priceMinor: number
  currency: string
  mileageKm: number
  fuel: string
  transmission: string
  bodyType: string
  condition: string
  county: string
  status: string
  featured: boolean
  sellerType: string
  photos: { url: string; order: number }[]
  org?: { id: string; name: string; isDemo?: boolean } | null
  owner?: { isDemo?: boolean } | null
}

/** Public card shape (matches the VehicleCard component contract). */
function toCard(v: VehicleWithRelations) {
  return {
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
    orgIsDemo: (v.org?.isDemo ?? false) || (v.owner?.isDemo ?? false),
    photos: v.photos,
  }
}

function numParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key)
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

const vehicleSchema = z.object({
  make: z.string().trim().min(1, 'Make is required').max(40),
  model: z.string().trim().min(1, 'Model is required').max(80),
  year: z.number().int().min(1980, 'Year must be 1980 or later').max(new Date().getFullYear() + 1, 'Year is in the future'),
  priceMinor: z.number().int().min(1, 'Price is required').max(10_000_000_000),
  mileageKm: z.number().int().min(0, 'Mileage must be 0 or more').max(2_000_000),
  fuel: z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']),
  transmission: z.enum(['AUTOMATIC', 'MANUAL']),
  bodyType: z.enum(['SUV', 'SEDAN', 'HATCHBACK', 'PICKUP', 'MINIVAN', 'COUPE', 'WAGON', 'TRUCK', 'MOTORBIKE']),
  condition: z.enum(['BRAND_NEW', 'FOREIGN_USED', 'LOCAL_USED']),
  county: z.string().trim().min(1, 'County is required').max(40),
  town: z.string().trim().max(60).optional(),
  color: z.string().trim().min(1, 'Colour is required').max(40),
  engineCc: z.number().int().min(50).max(10_000).optional(),
  description: z.string().trim().min(30, 'Description must be at least 30 characters').max(4000),
  matchWithDealers: z.boolean().optional().default(false),
  photos: z.array(z.string().min(1).max(300)).max(8, 'Maximum of 8 photos').optional(),
  status: z.enum(['DRAFT', 'PENDING_REVIEW']),
  orgId: z.string().max(40).optional(),
})

/** Staff users who review listings. */
async function staffReviewerIds(): Promise<string[]> {
  const staff = await db.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ roles: { contains: 'REVIEWER' } }, { roles: { contains: 'ADMIN' } }],
    },
    select: { id: true },
  })
  return staff.map((s) => s.id)
}

/** ACTIVE DEALER orgs where the user is a seller (OWNER/MANAGER/SALES). */
async function sellerOrgIds(userId: string): Promise<string[]> {
  const memberships = await db.orgMember.findMany({
    where: {
      userId,
      role: { in: ['OWNER', 'MANAGER', 'SALES'] },
      org: { type: 'DEALER', status: 'ACTIVE' },
    },
    select: { orgId: true },
  })
  return memberships.map((m) => m.orgId)
}

/** Resolve posting org for a new listing. Throws 403 when spoofing orgId. */
function resolveOrgInput(
  roles: string[],
  wantedOrgId: string | undefined,
  memberOrgIds: string[]
): { orgId: string | null; sellerType: 'DEALER' | 'PRIVATE' } {
  const isDealerRole = roles.includes('DEALER_OWNER') || roles.includes('DEALER_STAFF')
  if (!isDealerRole) {
    if (wantedOrgId) {
      throw new ApiError(403, 'NOT_A_DEALER_MEMBER', 'Only verified dealer team members can list under a dealership.')
    }
    return { orgId: null, sellerType: 'PRIVATE' }
  }
  if (wantedOrgId) {
    if (!memberOrgIds.includes(wantedOrgId)) {
      throw new ApiError(403, 'NOT_A_DEALER_MEMBER', 'You are not a seller on this dealership.')
    }
    return { orgId: wantedOrgId, sellerType: 'DEALER' }
  }
  if (memberOrgIds.length > 0) return { orgId: memberOrgIds[0], sellerType: 'DEALER' }
  return { orgId: null, sellerType: 'PRIVATE' }
}

// ───────────────────────── GET /api/vehicles ─────────────────────────
export const GET = route(async (req: NextRequest) => {
  const params = new URL(req.url).searchParams

  // Seller dashboard listing (own + org vehicles, any status, with counts).
  // Optional orgId narrows to a single membership org (DealerOS inventory).
  if (params.get('mine') === '1') {
    const user = await requireUser()
    const memberships = await db.orgMember.findMany({ where: { userId: user.id }, select: { orgId: true } })
    const myOrgIds = memberships.map((m) => m.orgId)
    const wantedOrgId = params.get('orgId')?.trim()
    const orgScope = wantedOrgId && myOrgIds.includes(wantedOrgId) ? wantedOrgId : null
    const rows = await db.vehicle.findMany({
      where: orgScope
        ? { orgId: orgScope }
        : { OR: [{ ownerId: user.id }, { orgId: { in: myOrgIds } }] },
      include: {
        photos: { orderBy: { order: 'asc' as const } },
        org: { select: { id: true, name: true, isDemo: true } },
        _count: { select: { enquiries: true, offers: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const vehicles = rows.map((v) => ({
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
      town: v.town,
      color: v.color,
      description: v.description,
      sellerType: v.sellerType,
      status: v.status,
      reviewNote: v.reviewNote,
      matchWithDealers: v.matchWithDealers,
      featured: v.featured,
      views: v.views,
      createdAt: v.createdAt,
      orgId: v.orgId,
      orgName: v.org?.name ?? null,
      orgIsDemo: v.org?.isDemo ?? false,
      photos: v.photos,
      enquiryCount: v._count.enquiries,
      offerCount: v._count.offers,
    }))
    return ok({ vehicles })
  }

  // Public search — only PUBLISHED listings are ever visible here.
  const where: Record<string, unknown> = { status: 'PUBLISHED' }
  const and: Record<string, unknown>[] = []

  const q = params.get('q')?.trim()
  if (q) and.push({ OR: [{ make: { contains: q } }, { model: { contains: q } }] })
  const make = params.get('make')?.trim()
  if (make) and.push({ make: { contains: make } })
  const model = params.get('model')?.trim()
  if (model) and.push({ model: { contains: model } })
  const bodyType = params.get('bodyType')?.trim()
  if (bodyType) and.push({ bodyType })
  const county = params.get('county')?.trim()
  if (county) and.push({ county })
  const fuel = params.get('fuel')?.trim()
  if (fuel) and.push({ fuel })
  const transmission = params.get('transmission')?.trim()
  if (transmission) and.push({ transmission })
  const condition = params.get('condition')?.trim()
  if (condition) and.push({ condition })
  const sellerType = params.get('sellerType')?.trim()
  if (sellerType === 'DEALER' || sellerType === 'PRIVATE') and.push({ sellerType })

  if (params.get('verified') === '1') {
    and.push({ orgId: { not: null } })
    and.push({ org: { type: 'DEALER', status: 'ACTIVE' } })
  }

  // Showroom filter: public listings of one ACTIVE DEALER org only.
  const orgId = params.get('org')?.trim()
  if (orgId) {
    const org = await db.org.findUnique({ where: { id: orgId }, select: { id: true, type: true, status: true } })
    if (!org || org.type !== 'DEALER' || org.status !== 'ACTIVE') {
      return ok({ vehicles: [], total: 0, page: 1, perPage: 12 })
    }
    and.push({ orgId })
  }

  const minPrice = numParam(params, 'minPrice')
  if (minPrice !== undefined) and.push({ priceMinor: { gte: minPrice } })
  const maxPrice = numParam(params, 'maxPrice')
  if (maxPrice !== undefined) and.push({ priceMinor: { lte: maxPrice } })
  const minYear = numParam(params, 'minYear')
  if (minYear !== undefined) and.push({ year: { gte: minYear } })
  const maxYear = numParam(params, 'maxYear')
  if (maxYear !== undefined) and.push({ year: { lte: maxYear } })
  const maxMileage = numParam(params, 'maxMileage')
  if (maxMileage !== undefined) and.push({ mileageKm: { lte: maxMileage } })

  if (and.length > 0) where.AND = and

  const sort = params.get('sort') ?? 'newest'
  const orderBy =
    sort === 'price_asc' ? { priceMinor: 'asc' as const }
    : sort === 'price_desc' ? { priceMinor: 'desc' as const }
    : sort === 'mileage_asc' ? { mileageKm: 'asc' as const }
    : sort === 'views' ? { views: 'desc' as const }
    : { createdAt: 'desc' as const }

  const perPage = Math.min(48, Math.max(1, numParam(params, 'perPage') ?? 12))
  const page = Math.max(1, numParam(params, 'page') ?? 1)

  const [total, rows] = await Promise.all([
    db.vehicle.count({ where }),
    db.vehicle.findMany({
      where,
      include: {
        photos: { orderBy: { order: 'asc' as const } },
        org: { select: { id: true, name: true, isDemo: true } },
        owner: { select: { isDemo: true } },
      },
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  return ok({ vehicles: rows.map(toCard), total, page, perPage })
})

// ───────────────────────── POST /api/vehicles ─────────────────────────
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`vehicle-create:${user.id}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', `Listing limit reached. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
  }

  const body = await parseBody(req, vehicleSchema)
  const memberOrgIds = await sellerOrgIds(user.id)
  const { orgId, sellerType } = resolveOrgInput(user.roles, body.orgId, memberOrgIds)

  const vehicle = await db.vehicle.create({
    data: {
      refCode: refCode('CM', 6),
      ownerId: user.id,
      orgId,
      sellerType,
      make: body.make,
      model: body.model,
      year: body.year,
      priceMinor: body.priceMinor,
      mileageKm: body.mileageKm,
      fuel: body.fuel,
      transmission: body.transmission,
      bodyType: body.bodyType,
      engineCc: body.engineCc ?? null,
      condition: body.condition,
      county: body.county,
      town: body.town || null,
      color: body.color,
      description: body.description,
      matchWithDealers: body.matchWithDealers,
      status: body.status,
      photos: { create: (body.photos ?? []).map((url, i) => ({ url, order: i })) },
      events: {
        create: {
          to: body.status,
          actorId: user.id,
          actorName: user.name,
          note: body.status === 'PENDING_REVIEW' ? 'Listing submitted for review' : 'Draft created',
        },
      },
    },
    include: { photos: { orderBy: { order: 'asc' as const } }, org: { select: { id: true, name: true, isDemo: true } } },
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'vehicle.created',
    targetType: 'VEHICLE',
    targetId: vehicle.id,
    metadata: { refCode: vehicle.refCode, status: vehicle.status, sellerType },
  })

  if (body.status === 'PENDING_REVIEW') {
    const reviewerIds = await staffReviewerIds()
    await notifyMany(reviewerIds, {
      type: 'LISTING_REVIEW',
      title: 'New listing to review',
      body: `${vehicle.make} ${vehicle.model} ${vehicle.year} (${vehicle.refCode}) was submitted by ${user.name}.`,
      link: `/vehicle-detail/${vehicle.id}`,
    })
    await notify({
      userId: user.id,
      type: 'LISTING_SUBMITTED',
      title: 'Your listing was submitted',
      body: `${vehicle.make} ${vehicle.model} ${vehicle.year} is under review — target 24 business hours.`,
      link: '/my-listings',
    })
  } else {
    await notify({
      userId: user.id,
      type: 'LISTING_DRAFT',
      title: 'Draft saved',
      body: `${vehicle.make} ${vehicle.model} ${vehicle.year} (${vehicle.refCode}) was saved as a draft.`,
      link: '/my-listings',
    })
  }

  return ok({ vehicle }, { status: 201 })
})

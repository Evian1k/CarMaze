import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/* ─────────────────────────── helpers ─────────────────────────── */

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

const JOB_STATUSES = ['OPEN', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'] as const

const DRIVER_FIELDS = { id: true, name: true, phone: true, vehicleReg: true, vehicleType: true } as const

type JobRow = {
  id: string
  refCode: string
  status: string
  cargoDesc: string
  sizeClass: string
  pickupCounty: string
  pickupAddress: string
  pickupContactName: string
  pickupContactPhone: string
  dropCounty: string
  dropAddress: string
  dropContactName: string
  dropContactPhone: string
  requesterOrgName: string | null
  feeMinor: number
  otpHint: string | null
  qrToken: string | null
  podPhotos: string | null
  failReason: string | null
  pickupAt: Date | null
  deliveredAt: Date | null
  createdAt: Date
  updatedAt: Date
  partner?: { id: string; name: string; county: string; phone: string } | null
  driver?: { id: string; name: string; phone: string; vehicleReg: string | null; vehicleType: string | null } | null
  events?: { id: string; type: string; actorName: string; actorSide: string; note: string | null; createdAt: Date }[]
}

function baseJob(j: JobRow) {
  return {
    id: j.id,
    refCode: j.refCode,
    status: j.status,
    cargoDesc: j.cargoDesc,
    sizeClass: j.sizeClass,
    pickupCounty: j.pickupCounty,
    pickupAddress: j.pickupAddress,
    pickupContactName: j.pickupContactName,
    pickupContactPhone: j.pickupContactPhone,
    dropCounty: j.dropCounty,
    dropAddress: j.dropAddress,
    dropContactName: j.dropContactName,
    dropContactPhone: j.dropContactPhone,
    requesterOrgName: j.requesterOrgName,
    feeMinor: j.feeMinor,
    failReason: j.failReason,
    pickupAt: j.pickupAt,
    deliveredAt: j.deliveredAt,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  }
}

/** serialize for the partner board / partner job list. Contacts are part of
 * the job itself (the partner needs them to perform the delivery). OTP data
 * is NEVER exposed to partners. */
function forPartner(j: JobRow) {
  return {
    ...baseJob(j),
    driver: j.driver ?? null,
    podPhotos: j.podPhotos ? parseList(j.podPhotos) : [],
    events: (j.events ?? []).map((e) => ({ id: e.id, type: e.type, actorName: e.actorName, actorSide: e.actorSide, note: e.note, createdAt: e.createdAt })),
  }
}

/** serialize for the requester: partner/driver info, otpHint (never the hash),
 * full podPhotos once delivered, and the event timeline. */
function forMine(j: JobRow) {
  return {
    ...baseJob(j),
    partner: j.partner ? { id: j.partner.id, name: j.partner.name, county: j.partner.county, phone: j.partner.phone } : null,
    driver: j.driver ?? null,
    otpHint: j.otpHint,
    qrToken: j.qrToken,
    podPhotos: j.status === 'DELIVERED' && j.podPhotos ? parseList(j.podPhotos) : [],
    events: (j.events ?? []).map((e) => ({ id: e.id, type: e.type, actorName: e.actorName, actorSide: e.actorSide, note: e.note, createdAt: e.createdAt })),
  }
}

/* ─────────────────────────── GET ───────────────────────────
 * ?scope=self   → { partner | null } — branching for the logistics view
 * ?scope=open   → OPEN board for APPROVED partners
 * ?scope=partner→ the partner's own jobs (any status, with events)
 * ?scope=mine   → the requester's own jobs (with otpHint, partner, events)
 * &status=      → optional status filter (partner/mine)
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') ?? 'mine'
  const statusParam = url.searchParams.get('status')

  if (scope === 'self') {
    const partner = await db.logisticsPartner.findUnique({ where: { ownerUserId: user.id } })
    return ok({
      partner: partner
        ? {
            id: partner.id,
            refCode: partner.refCode,
            name: partner.name,
            partnerType: partner.partnerType,
            county: partner.county,
            town: partner.town,
            status: partner.status,
            verified: partner.verified,
            capabilities: parseList(partner.capabilities),
            serviceAreas: parseList(partner.serviceAreas),
            decisionNote: partner.decisionNote,
            createdAt: partner.createdAt,
          }
        : null,
    })
  }

  if (scope === 'open') {
    const partner = await db.logisticsPartner.findUnique({ where: { ownerUserId: user.id } })
    if (!partner) throw new ApiError(403, 'NOT_A_PARTNER', 'Only approved delivery partners can view the open request board.')
    if (partner.status === 'SUSPENDED') {
      throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is suspended — you cannot accept new deliveries. Contact CARMAZE support.')
    }
    if (partner.status !== 'APPROVED') {
      throw new ApiError(403, 'PARTNER_NOT_ACTIVE', 'Your partner account is not active yet.')
    }
    const jobs = await db.deliveryJob.findMany({
      where: { status: 'OPEN', requestedByUserId: { not: user.id } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return ok({ jobs: jobs.map((j) => baseJob(j)) })
  }

  if (scope === 'partner') {
    const partner = await db.logisticsPartner.findUnique({ where: { ownerUserId: user.id } })
    if (!partner) throw new ApiError(403, 'NOT_A_PARTNER', 'Only delivery partners have a job list.')
    const where: { partnerId: string; status?: string } = { partnerId: partner.id }
    if (statusParam) {
      if (!(JOB_STATUSES as readonly string[]).includes(statusParam)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Unknown status "${statusParam}".`)
      }
      where.status = statusParam
    }
    const jobs = await db.deliveryJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        driver: { select: DRIVER_FIELDS },
        events: { orderBy: { createdAt: 'asc' } },
      },
    })
    return ok({ jobs: jobs.map((j) => forPartner(j)) })
  }

  if (scope === 'mine') {
    const where: { requestedByUserId: string; status?: string } = { requestedByUserId: user.id }
    if (statusParam) {
      if (!(JOB_STATUSES as readonly string[]).includes(statusParam)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Unknown status "${statusParam}".`)
      }
      where.status = statusParam
    }
    const jobs = await db.deliveryJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        partner: { select: { id: true, name: true, county: true, phone: true } },
        driver: { select: DRIVER_FIELDS },
        events: { orderBy: { createdAt: 'asc' } },
      },
    })
    return ok({ jobs: jobs.map((j) => forMine(j)) })
  }

  throw new ApiError(400, 'BAD_SCOPE', 'Unknown scope. Use self | open | partner | mine.')
})

/* ─────────────────────────── POST — create a delivery request ─────────────────────────── */

const createSchema = z.object({
  cargoDesc: z.string().trim().min(5, 'Describe the cargo (at least 5 characters)').max(300),
  sizeClass: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
  pickupCounty: z.string().trim().min(2, 'Pickup county is required').max(60),
  pickupAddress: z.string().trim().min(5, 'Pickup address is required').max(200),
  pickupContactName: z.string().trim().min(2, 'Pickup contact name is required').max(80),
  pickupContactPhone: z.string().trim().min(9, 'Pickup contact phone is required').max(20),
  dropCounty: z.string().trim().min(2, 'Drop-off county is required').max(60),
  dropAddress: z.string().trim().min(5, 'Drop-off address is required').max(200),
  dropContactName: z.string().trim().min(2, 'Drop-off contact name is required').max(80),
  dropContactPhone: z.string().trim().min(9, 'Drop-off contact phone is required').max(20),
  requesterOrgId: z.string().trim().max(64).optional().or(z.literal('')),
})

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`dlv-create:${user.id}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', 'You have created many delivery requests recently. Please try again later.')
  }

  const body = await parseBody(req, createSchema)

  let requesterOrgId: string | null = null
  let requesterOrgName: string | null = null
  if (body.requesterOrgId) {
    const membership = await db.orgMember.findFirst({
      where: { orgId: body.requesterOrgId, userId: user.id },
      select: { id: true },
    })
    if (!membership) throw new ApiError(403, 'NOT_A_MEMBER', 'You are not a member of that business, so the request cannot be filed on its behalf.')
    const org = await db.org.findUnique({ where: { id: body.requesterOrgId }, select: { id: true, name: true } })
    if (!org) throw new ApiError(404, 'ORG_NOT_FOUND', 'That business could not be found.')
    requesterOrgId = org.id
    requesterOrgName = org.name
  }

  const job = await db.deliveryJob.create({
    data: {
      refCode: refCode('DLV', 6),
      requestedByUserId: user.id,
      requesterOrgId,
      requesterOrgName,
      cargoDesc: body.cargoDesc,
      sizeClass: body.sizeClass,
      pickupCounty: body.pickupCounty,
      pickupAddress: body.pickupAddress,
      pickupContactName: body.pickupContactName,
      pickupContactPhone: body.pickupContactPhone,
      dropCounty: body.dropCounty,
      dropAddress: body.dropAddress,
      dropContactName: body.dropContactName,
      dropContactPhone: body.dropContactPhone,
      status: 'OPEN',
      events: {
        create: {
          type: 'CREATED',
          actorId: user.id,
          actorName: user.name,
          actorSide: 'CUSTOMER',
          note: `Delivery requested — ${body.pickupCounty} → ${body.dropCounty}.`,
        },
      },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'DELIVERY_JOB_CREATED',
    targetType: 'DELIVERY_JOB',
    targetId: job.id,
    metadata: { ref: job.refCode, sizeClass: job.sizeClass, route: `${job.pickupCounty} → ${job.dropCounty}` },
  })

  return ok({ job: forMine(job) }, { status: 201 })
})

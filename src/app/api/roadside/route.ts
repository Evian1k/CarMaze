import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notify, notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const ROADSIDE_DISCLAIMER =
  'CARMAZE connects you with independent providers — this is not an emergency service. For emergencies call 999/112.'

const ISSUES = ['TOW', 'FLAT_TYRE', 'BATTERY', 'FUEL', 'ENGINE', 'LOCKOUT', 'OTHER'] as const

export const ISSUE_LABELS: Record<(typeof ISSUES)[number], string> = {
  TOW: 'Towing needed',
  FLAT_TYRE: 'Flat tyre',
  BATTERY: 'Battery / won\u2019t start',
  FUEL: 'Out of fuel',
  ENGINE: 'Engine breakdown',
  LOCKOUT: 'Locked out',
  OTHER: 'Other issue',
}

/** Users with OWNER/MANAGER memberships on ACTIVE GARAGE orgs offering TOWING or ROADSIDE. */
async function roadsideProviderOwnerIds(): Promise<string[]> {
  const members = await db.orgMember.findMany({
    where: {
      role: { in: ['OWNER', 'MANAGER'] },
      org: {
        type: 'GARAGE',
        status: 'ACTIVE',
        services: { some: { category: { in: ['TOWING', 'ROADSIDE'] }, active: true } },
      },
    },
    select: { userId: true },
    distinct: ['userId'],
  })
  return members.map((m) => m.userId)
}

// ─────────────────────────── POST ───────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  phone: z.string().trim().min(9, 'A reachable phone number is required').max(20),
  county: z.string().trim().min(2, 'County is required').max(60),
  location: z.string().trim().min(5, 'Describe where you are (road, landmark, direction)').max(200),
  issue: z.enum(ISSUES),
  details: z.string().trim().max(500).optional().or(z.literal('')),
})

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`roadside:${getIp(req)}:${user.id}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', `Request limit reached (5/hour). Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
  }

  const body = await parseBody(req, createSchema)

  const request = await db.roadsideRequest.create({
    data: {
      refCode: refCode('RSA', 6),
      userId: user.id,
      name: body.name,
      phone: body.phone,
      county: body.county,
      location: body.location,
      issue: body.issue,
      details: body.details || null,
      status: 'REQUESTED',
    },
  })

  const providers = await roadsideProviderOwnerIds()
  await notifyMany(providers, {
    type: 'ROADSIDE_REQUEST_NEW',
    title: `New roadside request near ${body.county}`,
    body: `${ISSUE_LABELS[body.issue]} — ${body.location}. Open Roadside to accept if you can assist.`,
    link: '/roadside',
  })

  await audit({
    actorId: user.id, actorName: user.name,
    action: 'ROADSIDE_REQUEST_CREATED', targetType: 'ROADSIDE_REQUEST', targetId: request.id,
    metadata: { ref: request.refCode, issue: body.issue, county: body.county },
  })

  return ok({ request, disclaimer: ROADSIDE_DISCLAIMER }, { status: 201 })
})

// ─────────────────────────── GET ───────────────────────────

export const GET = route(async (req: NextRequest) => {
  const url = new URL(req.url)

  // Honest public directory of ACTIVE garages offering TOWING/ROADSIDE services.
  if (url.searchParams.get('providers') === '1') {
    const orgs = await db.org.findMany({
      where: {
        type: 'GARAGE',
        status: 'ACTIVE',
        services: { some: { category: { in: ['TOWING', 'ROADSIDE'] }, active: true } },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, phone: true, county: true, town: true, location: true,
        services: {
          where: { category: { in: ['TOWING', 'ROADSIDE'] }, active: true },
          select: { category: true, title: true, priceFromMinor: true },
        },
      },
    })
    return ok({ providers: orgs, disclaimer: ROADSIDE_DISCLAIMER })
  }

  if (url.searchParams.get('mine') === '1') {
    const user = await requireUser()
    const requests = await db.roadsideRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    // providerOrgId is a plain reference (no Prisma relation) — resolve provider orgs separately.
    const providerIds = [...new Set(requests.map((r) => r.providerOrgId).filter((v): v is string => Boolean(v)))]
    const providers = await db.org.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, name: true, phone: true, county: true, town: true, location: true },
    })
    const providerById = new Map(providers.map((p) => [p.id, p]))
    return ok({
      requests: requests.map((r) => ({
        id: r.id, refCode: r.refCode, name: r.name, phone: r.phone, county: r.county,
        location: r.location, issue: r.issue, details: r.details, status: r.status,
        providerNote: r.providerNote, acceptedAt: r.acceptedAt, completedAt: r.completedAt, createdAt: r.createdAt,
        provider: r.providerOrgId ? providerById.get(r.providerOrgId) ?? null : null,
      })),
      disclaimer: ROADSIDE_DISCLAIMER,
    })
  }

  return fail(400, 'VALIDATION_ERROR', 'Specify ?mine=1 or ?providers=1.')
})

// ─────────────────────────── PATCH — accept | complete | cancel ───────────────────────────

const patchSchema = z.object({
  action: z.enum(['accept', 'complete', 'cancel']),
  orgId: z.string().optional(), // provider org when accepting (optional if unambiguous)
  providerNote: z.string().trim().max(300).optional(),
})

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'VALIDATION_ERROR', 'Missing ?id=.')

  const request = await db.roadsideRequest.findUnique({ where: { id } })
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Roadside request not found.')

  const body = await parseBody(req, patchSchema)

  if (body.action === 'accept') {
    // Provider side: must belong to a garage org offering TOWING/ROADSIDE.
    const memberships = await db.orgMember.findMany({
      where: {
        userId: user.id,
        org: {
          type: 'GARAGE',
          status: 'ACTIVE',
          services: { some: { category: { in: ['TOWING', 'ROADSIDE'] }, active: true } },
        },
      },
      include: { org: true },
      orderBy: { createdAt: 'asc' },
    })
    if (memberships.length === 0) {
      throw new ApiError(403, 'FORBIDDEN', 'Only garages with active Towing or Roadside services can accept requests.')
    }
    const org = body.orgId
      ? memberships.find((m) => m.orgId === body.orgId)?.org
      : memberships[0]?.org
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'That garage is not among your roadside-capable memberships.')

    if (request.status !== 'REQUESTED') {
      throw new ApiError(409, 'INVALID_STATE', `This request is already ${request.status.toLowerCase()}.`)
    }

    const updated = await db.roadsideRequest.update({
      where: { id: request.id },
      data: {
        status: 'ACCEPTED',
        providerOrgId: org.id,
        providerNote: body.providerNote || null,
        acceptedAt: new Date(),
      },
    })

    await notify({
      userId: request.userId,
      type: 'ROADSIDE_ACCEPTED',
      title: `Roadside request accepted — ${request.refCode}`,
      body: `${org.name} can assist you${org.phone ? `. Contact: ${org.phone}` : ''}${body.providerNote ? `. Note: ${body.providerNote}` : ''}.`,
      link: '/roadside',
    })

    await audit({
      actorId: user.id, actorName: user.name,
      action: 'ROADSIDE_ACCEPTED', targetType: 'ROADSIDE_REQUEST', targetId: request.id,
      metadata: { ref: request.refCode, orgId: org.id },
    })

    return ok({ request: { ...updated, provider: { id: org.id, name: org.name, phone: org.phone } } })
  }

  if (body.action === 'complete') {
    const isProvider = request.providerOrgId
      ? Boolean(await db.orgMember.findFirst({ where: { orgId: request.providerOrgId, userId: user.id } }))
      : false
    const isRequester = request.userId === user.id
    if (!isProvider && !isRequester) throw new ApiError(403, 'FORBIDDEN', 'Only the provider or requester can complete this request.')
    if (request.status !== 'ACCEPTED') {
      throw new ApiError(409, 'INVALID_STATE', `Only accepted requests can be completed (current: ${request.status}).`)
    }

    const updated = await db.roadsideRequest.update({
      where: { id: request.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })
    const providerOrg = request.providerOrgId
      ? await db.org.findUnique({ where: { id: request.providerOrgId }, select: { name: true } })
      : null
    await notify({
      userId: request.userId,
      type: 'ROADSIDE_COMPLETED',
      title: `Roadside assistance completed — ${request.refCode}`,
      body: providerOrg ? `${providerOrg.name} marked your request as completed.` : 'Your roadside request was marked as completed.',
      link: '/roadside',
    })
    await audit({
      actorId: user.id, actorName: user.name,
      action: 'ROADSIDE_COMPLETED', targetType: 'ROADSIDE_REQUEST', targetId: request.id,
      metadata: { ref: request.refCode, by: isProvider ? 'PROVIDER' : 'REQUESTER' },
    })
    return ok({ request: updated })
  }

  // action === 'cancel' — requester only, while REQUESTED or ACCEPTED.
  if (request.userId !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the requester can cancel this request.')
  }
  if (!['REQUESTED', 'ACCEPTED'].includes(request.status)) {
    throw new ApiError(409, 'INVALID_STATE', `Requests in state ${request.status} cannot be cancelled.`)
  }

  const updated = await db.roadsideRequest.update({
    where: { id: request.id },
    data: { status: 'CANCELLED' },
  })
  if (request.providerOrgId) {
    const members = await db.orgMember.findMany({ where: { orgId: request.providerOrgId }, select: { userId: true } })
    await notifyMany(members.map((m) => m.userId), {
      type: 'ROADSIDE_CANCELLED',
      title: `Roadside request cancelled — ${request.refCode}`,
      body: 'The requester cancelled this assistance request.',
      link: '/roadside',
    })
  }
  await audit({
    actorId: user.id, actorName: user.name,
    action: 'ROADSIDE_CANCELLED', targetType: 'ROADSIDE_REQUEST', targetId: request.id,
    metadata: { ref: request.refCode },
  })
  return ok({ request: updated })
})

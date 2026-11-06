import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'
import { SERVICE_CATEGORIES } from '@/lib/format'
import { isActorDemo } from '@/lib/request-context'

// ─────────────────────────── POST — customer creates a request ───────────────────────────

const createSchema = z.object({
  category: z.enum(SERVICE_CATEGORIES),
  vehicleDesc: z.string().trim().max(160).optional().or(z.literal('')),
  description: z.string().trim().min(15, 'Describe the work in at least 15 characters').max(2000),
  county: z.string().trim().min(2, 'County is required').max(60),
  town: z.string().trim().max(60).optional().or(z.literal('')),
  configId: z.string().trim().max(40).optional().or(z.literal('')),
  myVehicleId: z.string().trim().max(40).optional().or(z.literal('')),
})

/** Users with OWNER/MANAGER memberships on ACTIVE GARAGE orgs. When the
 * acting user is a demo account, only DEMO garages are included — a demo
 * request must never land in a real business's work queue. */
async function garageOwnerIds(orgFilter?: { services?: { some: { category: string; active: boolean } } }, demoOnly = false): Promise<string[]> {
  const members = await db.orgMember.findMany({
    where: {
      role: { in: ['OWNER', 'MANAGER'] },
      org: { type: 'GARAGE', status: 'ACTIVE', ...(demoOnly ? { isDemo: true } : {}), ...(orgFilter ?? {}) },
    },
    select: { userId: true },
    distinct: ['userId'],
  })
  return members.map((m) => m.userId)
}

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`service-request:${getIp(req)}:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', `You can send up to 10 quote requests per hour. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
  }

  const body = await parseBody(req, createSchema)

  // myVehicleId must belong to the user (link a "My Garage" vehicle).
  let myVehicleId: string | null = null
  if (body.myVehicleId) {
    const vehicle = await db.myVehicle.findFirst({ where: { id: body.myVehicleId, userId: user.id } })
    if (!vehicle) throw new ApiError(400, 'VALIDATION_ERROR', 'The selected vehicle was not found in your garage.')
    myVehicleId = vehicle.id
  }

  // configId must reference a saved 3D customizer configuration.
  let configId: string | null = null
  if (body.configId) {
    const config = await db.customizerConfig.findFirst({ where: { OR: [{ shareId: body.configId }, { id: body.configId }] } })
    if (!config) throw new ApiError(400, 'VALIDATION_ERROR', 'This 3D configuration link is no longer valid.')
    configId = config.shareId
  }

  const request = await db.serviceRequest.create({
    data: {
      refCode: refCode('SRQ', 6),
      customerId: user.id,
      category: body.category,
      vehicleDesc: body.vehicleDesc || null,
      description: body.description,
      county: body.county,
      town: body.town || null,
      configId,
      myVehicleId,
      status: 'OPEN',
    },
  })

  // Honest notification fan-out: garages offering this category first;
  // if nobody lists that category yet, all garage owners hear about it.
  // DEMO ISOLATION: demo requests fan out to demo garages only.
  const actorDemo = await isActorDemo()
  const targeted = await garageOwnerIds({ services: { some: { category: body.category, active: true } } }, actorDemo)
  const recipients = targeted.length > 0 ? targeted : await garageOwnerIds(undefined, actorDemo)
  await notifyMany(recipients, {
    type: 'SERVICE_REQUEST_NEW',
    title: `New service request in ${body.county}`,
    body: `${request.refCode} · ${body.category.replaceAll('_', ' ').toLowerCase()}${body.town ? ` · ${body.town}` : ''}. Open your dashboard to send a quote.`,
    link: '/garage-dashboard?tab=requests',
  })

  await audit({
    actorId: user.id, actorName: user.name,
    action: 'SERVICE_REQUEST_CREATED', targetType: 'SERVICE_REQUEST', targetId: request.id,
    metadata: { ref: request.refCode, category: body.category, county: body.county, fromCustomizer: Boolean(configId) },
  })

  return ok({ request }, { status: 201 })
})

// ─────────────────────────── GET — mine | org ───────────────────────────

export const GET = route(async (req: NextRequest) => {
  const url = new URL(req.url)

  // ── Customer view: my requests with quotes + booking (account contract) ──
  if (url.searchParams.get('mine') === '1') {
    const user = await requireUser()
    const requests = await db.serviceRequest.findMany({
      where: { customerId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, refCode: true, category: true, status: true, description: true,
        vehicleDesc: true, county: true, town: true, configId: true, createdAt: true,
        quotes: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, amountMinor: true, leadDays: true, message: true, status: true, createdAt: true,
            org: { select: { id: true, name: true } },
          },
        },
        booking: { select: { status: true, scheduledAt: true } },
      },
    })
    return ok({ requests })
  }

  // ── Garage view: eligible leads + requests this org already quoted ──
  if (url.searchParams.get('org') === '1') {
    const user = await requireUser()
    const memberships = await db.orgMember.findMany({
      where: { userId: user.id, org: { type: 'GARAGE', status: 'ACTIVE' } },
      include: { org: true },
      orderBy: { createdAt: 'asc' },
    })
    if (memberships.length === 0) throw new ApiError(403, 'FORBIDDEN', 'Garage membership required.')

    const requestedOrgId = url.searchParams.get('orgId')
    const activeOrg = requestedOrgId
      ? memberships.find((m) => m.orgId === requestedOrgId)?.org
      : memberships[0]?.org
    if (!activeOrg) throw new ApiError(404, 'NOT_FOUND', 'Garage not found among your memberships.')

    const activeServices = await db.garageService.findMany({
      where: { orgId: activeOrg.id, active: true },
      select: { category: true },
    })
    const categories = [...new Set(activeServices.map((s) => s.category))]

    // Eligible open leads in our categories…
    const eligible = await db.serviceRequest.findMany({
      where: { status: { in: ['OPEN', 'QUOTING'] }, category: { in: categories } },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        id: true, refCode: true, category: true, vehicleDesc: true, description: true,
        county: true, town: true, status: true, configId: true, createdAt: true,
        customer: { select: { name: true } },
        quotes: { where: { orgId: activeOrg.id }, select: quoteSelect },
      },
    })

    // …plus every request this org has quoted (any status). Never other garages' quotes.
    const quotedByUs = await db.serviceRequest.findMany({
      where: { quotes: { some: { orgId: activeOrg.id } } },
      orderBy: { updatedAt: 'desc' },
      take: 60,
      select: {
        id: true, refCode: true, category: true, vehicleDesc: true, description: true,
        county: true, town: true, status: true, configId: true, createdAt: true,
        customer: { select: { name: true } },
        quotes: { where: { orgId: activeOrg.id }, select: quoteSelect },
      },
    })

    const seen = new Set<string>()
    const merged = [...eligible, ...quotedByUs].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))

    const requests = merged.map((r) => ({
      id: r.id,
      refCode: r.refCode,
      category: r.category,
      vehicleDesc: r.vehicleDesc,
      description: r.description,
      county: r.county,
      town: r.town,
      status: r.status,
      configId: r.configId,
      createdAt: r.createdAt,
      customer: r.customer,
      myQuote: r.quotes[0] ?? null,
    }))

    return ok({
      org: { id: activeOrg.id, name: activeOrg.name, county: activeOrg.county },
      orgs: memberships.map((m) => ({ id: m.orgId, name: m.org.name })),
      requests,
    })
  }

  return fail(400, 'VALIDATION_ERROR', 'Specify ?mine=1 or ?org=1.')
})

const quoteSelect = {
  id: true,
  amountMinor: true,
  leadDays: true,
  message: true,
  status: true,
  createdAt: true,
} as const

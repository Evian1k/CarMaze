import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'
import { jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/supply/quotes —
 *   Garage members: their own quote requests (with offers).
 *   Supplier members: open requests matching their delivery areas.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgId = req.nextUrl.searchParams.get('orgId')
  if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required.')
  const membership = await getMembership(orgId, user.id)
  if (!membership) return fail(403, 'NOT_A_MEMBER', 'Not a member of this business.')
  const org = await db.org.findUnique({ where: { id: orgId } })

  if (org?.type === 'SUPPLIER') {
    const branchAreas = await db.orgBranch.findMany({ where: { orgId, status: 'ACTIVE' }, select: { deliveryAreas: true } })
    const areas = [...new Set(branchAreas.flatMap((b) => jsonParse<string[]>(b.deliveryAreas, [])))]
    const requests = await db.quoteRequest.findMany({
      where: {
        status: { in: ['OPEN', 'QUOTING'] },
        ...(areas.length ? { OR: [{ deliveryCounty: { in: areas } }, { deliveryCounty: null }] } : {}),
      },
      include: {
        createdBy: { select: { name: true } },
        offers: { where: { supplierOrgId: orgId } },
        _count: { select: { offers: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    })
    const garageIds = [...new Set(requests.map((r) => r.garageOrgId))]
    const garages = await db.org.findMany({ where: { id: { in: garageIds } }, select: { id: true, name: true, county: true, verified: true } })
    const garageMap = new Map(garages.map((g) => [g.id, g]))
    return ok({
      side: 'SUPPLIER',
      requests: requests.map((r) => ({
        id: r.id, refCode: r.refCode, title: r.title, description: r.description, partNumber: r.partNumber,
        photoUrl: r.photoUrl, vehicle: jsonParse<Record<string, unknown> | null>(r.vehicleJson, null),
        budgetMinor: r.budgetMinor, deliveryCounty: r.deliveryCounty, status: r.status,
        garage: garageMap.get(r.garageOrgId) ?? null, offerCount: r._count.offers, myOffer: r.offers[0] ?? null, createdAt: r.createdAt, expiresAt: r.expiresAt,
      })),
    })
  }

  const requests = await db.quoteRequest.findMany({
    where: { garageOrgId: orgId },
    include: {
      offers: { include: { supplier: { select: { id: true, name: true, county: true, verified: true, supplierRating: true } } }, orderBy: { amountMinor: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })
  return ok({
    side: 'GARAGE',
    requests: requests.map((r) => ({
      id: r.id, refCode: r.refCode, title: r.title, description: r.description, partNumber: r.partNumber,
      photoUrl: r.photoUrl, vehicle: jsonParse<Record<string, unknown> | null>(r.vehicleJson, null),
      budgetMinor: r.budgetMinor, deliveryCounty: r.deliveryCounty, status: r.status, createdAt: r.createdAt,
      offers: r.offers.map((o) => ({ ...o, items: jsonParse<unknown[]>(o.itemsJson, []) })),
    })),
  })
})

const createSchema = z.object({
  orgId: z.string().min(1),
  title: z.string().trim().min(4).max(120),
  description: z.string().trim().min(10).max(2000),
  partNumber: z.string().trim().max(60).optional().nullable(),
  photoUrl: z.string().max(300).optional().nullable(),
  vehicle: z.object({ make: z.string().max(50).optional(), model: z.string().max(60).optional(), year: z.number().int().optional(), engine: z.string().max(60).optional(), trim: z.string().max(60).optional() }).optional(),
  budgetMinor: z.number().int().min(0).optional().nullable(),
  deliveryCounty: z.string().trim().max(60).optional().nullable(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
})

/** POST — garage raises a Request-a-Part quotation (photo / SKU / part number
 * / description). Verified suppliers in the delivery area are notified. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`quote-req:${user.id}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many requests. Please try later.')
  const body = await parseBody(req, createSchema)
  const membership = await getMembership(body.orgId, user.id)
  if (!membership) return fail(403, 'NOT_A_MEMBER', 'Not a member of this business.')
  const org = await db.org.findUnique({ where: { id: body.orgId } })
  if (!org || org.type !== 'GARAGE' || org.status !== 'ACTIVE') return fail(403, 'FORBIDDEN', 'Only verified garages can request quotations.')

  const request = await db.quoteRequest.create({
    data: {
      refCode: refCode('QRF', 6),
      garageOrgId: body.orgId,
      createdById: user.id,
      title: body.title,
      description: body.description,
      partNumber: body.partNumber ?? null,
      photoUrl: body.photoUrl ?? null,
      vehicleJson: body.vehicle ? JSON.stringify(body.vehicle) : null,
      budgetMinor: body.budgetMinor ?? null,
      deliveryCounty: body.deliveryCounty ?? null,
      status: 'OPEN',
      expiresAt: new Date(Date.now() + body.expiresInDays * 24 * 3600 * 1000),
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'QUOTE_REQUEST_CREATED', targetType: 'QUOTE_REQUEST', targetId: request.id, metadata: { ref: request.refCode, orgId: body.orgId } })

  // notify verified suppliers whose delivery areas cover the county (or all if unspecified)
  const suppliers = await db.org.findMany({
    where: { type: 'SUPPLIER', status: 'ACTIVE', verified: true },
    select: { id: true },
  })
  let notified = 0
  for (const s of suppliers) {
    const branches = await db.orgBranch.findMany({ where: { orgId: s.id, status: 'ACTIVE' }, select: { deliveryAreas: true } })
    const areas = branches.flatMap((b) => jsonParse<string[]>(b.deliveryAreas, []))
    const match = !body.deliveryCounty || areas.length === 0 || areas.some((a) => a.toLowerCase() === body.deliveryCounty!.toLowerCase())
    if (!match) continue
    const members = await db.orgMember.findMany({ where: { orgId: s.id, role: { in: ['OWNER', 'OPERATIONS', 'SALES'] } }, select: { userId: true } })
    if (members.length === 0) continue
    await notifyMany(members.map((m) => m.userId), {
      type: 'QUOTE_REQUEST',
      title: `Quote request ${request.refCode}: ${body.title}`,
      body: `${org.name} needs a quotation${body.partNumber ? ` (part ${body.partNumber})` : ''}. Respond in the Supplier Portal.`,
      link: '/supplier?tab=quotes',
    })
    notified++
  }
  return ok({ request, notifiedSuppliers: notified, message: `Request sent to ${notified} supplier(s). Track responses in Procurement → Quote Requests.` }, { status: 201 })
})

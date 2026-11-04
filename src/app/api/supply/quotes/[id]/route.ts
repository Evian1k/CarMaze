import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** GET — quote request detail (garage owner or responding suppliers). */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const request = await db.quoteRequest.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      offers: { include: { supplier: { select: { id: true, name: true, county: true, town: true, verified: true, supplierRating: true } } }, orderBy: { amountMinor: 'asc' } },
    },
  })
  if (!request) return fail(404, 'NOT_FOUND', 'Quote request not found.')
  const garage = await db.org.findUnique({ where: { id: request.garageOrgId }, select: { id: true, name: true, county: true, verified: true } })
  const membership = await getMembership(request.garageOrgId, user.id)
  if (!membership) {
    // suppliers may view requests routed to them
    const isSupplier = await db.orgMember.findFirst({ where: { userId: user.id, org: { type: 'SUPPLIER' } } })
    if (!isSupplier) return fail(403, 'FORBIDDEN', 'Not authorised.')
  }
  return ok({
    request: {
      id: request.id, refCode: request.refCode, title: request.title, description: request.description,
      partNumber: request.partNumber, photoUrl: request.photoUrl,
      vehicle: request.vehicleJson ? JSON.parse(request.vehicleJson) : null,
      budgetMinor: request.budgetMinor, deliveryCounty: request.deliveryCounty,
      status: request.status, garage, createdAt: request.createdAt, expiresAt: request.expiresAt,
      offers: request.offers.map((o) => ({ ...o, items: o.itemsJson ? JSON.parse(o.itemsJson) : [] })),
    },
  })
})

const offerSchema = z.object({
  action: z.literal('offer'),
  amountMinor: z.number().int().min(100),
  leadDays: z.number().int().min(1).max(90).optional(),
  note: z.string().max(500).optional(),
  items: z.array(z.object({ name: z.string().max(120), partNumber: z.string().max(60).optional(), qty: z.number().int().min(1), unitPriceMinor: z.number().int().min(0) })).max(30).optional(),
})

const decideSchema = z.object({
  action: z.literal('decide'),
  offerId: z.string().min(1),
  decision: z.enum(['ACCEPTED', 'DECLINED']),
})

const closeSchema = z.object({ action: z.literal('close') })

const bodySchema = z.discriminatedUnion('action', [offerSchema, decideSchema, closeSchema])

/** POST — suppliers offer; garage accepts/declines/closes. */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const body = await parseBody(req, bodySchema)
  const request = await db.quoteRequest.findUnique({ where: { id } })
  if (!request) return fail(404, 'NOT_FOUND', 'Quote request not found.')

  if (body.action === 'offer') {
    const membership = await db.orgMember.findFirst({
      where: { userId: user.id, org: { type: 'SUPPLIER', status: 'ACTIVE', verified: true } },
      include: { org: { select: { id: true, name: true } } },
    })
    if (!membership) return fail(403, 'FORBIDDEN', 'Only verified suppliers can offer quotations.')
    if (request.status === 'CLOSED') return fail(409, 'CLOSED', 'This request is closed.')
    const offer = await db.quoteOffer.upsert({
      where: { requestId_supplierOrgId: { requestId: id, supplierOrgId: membership.orgId } },
      create: {
        requestId: id, supplierOrgId: membership.orgId,
        amountMinor: body.amountMinor, leadDays: body.leadDays ?? null,
        note: body.note ?? null, itemsJson: body.items ? JSON.stringify(body.items) : null,
      },
      update: {
        amountMinor: body.amountMinor, leadDays: body.leadDays ?? null,
        note: body.note ?? null, itemsJson: body.items ? JSON.stringify(body.items) : null,
        status: 'PENDING',
      },
    })
    await db.quoteRequest.update({ where: { id }, data: { status: 'QUOTING' } })
    const garageMembers = await db.orgMember.findMany({ where: { orgId: request.garageOrgId, role: { in: ['OWNER', 'GM', 'PROCUREMENT'] } }, select: { userId: true } })
    await notifyMany(garageMembers.map((m) => m.userId), {
      type: 'QUOTE_OFFER', title: `New quote on ${request.refCode}`,
      body: `${membership.org.name} quoted ${(body.amountMinor / 100).toLocaleString()} KES${body.leadDays ? ` — ${body.leadDays} day(s)` : ''}.`,
      link: '/procurement?tab=quotes',
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'QUOTE_OFFER_SUBMITTED', targetType: 'QUOTE_REQUEST', targetId: id, metadata: { supplier: membership.orgId, amount: body.amountMinor } })
    return ok({ offer }, { status: 201 })
  }

  if (body.action === 'decide') {
    const membership = await getMembership(request.garageOrgId, user.id)
    if (!membership || !['OWNER', 'GM', 'PROCUREMENT'].includes(membership.role)) {
      return fail(403, 'PERMISSION_DENIED', 'Only garage procurement/management decides on offers.')
    }
    const offer = await db.quoteOffer.findUnique({ where: { id: body.offerId } })
    if (!offer || offer.requestId !== id) return fail(404, 'NOT_FOUND', 'Offer not found.')
    await db.quoteOffer.update({ where: { id: offer.id }, data: { status: body.decision } })
    if (body.decision === 'ACCEPTED') {
      await db.quoteOffer.updateMany({ where: { requestId: id, id: { not: offer.id } }, data: { status: 'DECLINED' } })
      await db.quoteRequest.update({ where: { id }, data: { status: 'CLOSED' } })
      const supplierMembers = await db.orgMember.findMany({ where: { orgId: offer.supplierOrgId, role: { in: ['OWNER', 'OPERATIONS', 'SALES'] } }, select: { userId: true } })
      await notifyMany(supplierMembers.map((m) => m.userId), {
        type: 'QUOTE_ACCEPTED', title: `Quote accepted — ${request.refCode}`,
        body: 'Your quotation was accepted. The garage will follow up to place the order.',
        link: '/supplier?tab=quotes',
      })
    }
    await audit({ actorId: user.id, actorName: user.name, action: 'QUOTE_OFFER_DECIDED', targetType: 'QUOTE_REQUEST', targetId: id, metadata: { offer: offer.id, decision: body.decision } })
    return ok({ message: body.decision === 'ACCEPTED' ? 'Offer accepted. Place the order from the supplier\'s storefront when ready.' : 'Offer declined.' })
  }

  // close
  const membership = await getMembership(request.garageOrgId, user.id)
  if (!membership || !['OWNER', 'GM', 'PROCUREMENT'].includes(membership.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Only the garage closes its requests.')
  }
  await db.quoteRequest.update({ where: { id }, data: { status: 'CLOSED' } })
  return ok({ message: 'Request closed.' })
})

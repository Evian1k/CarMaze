import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** GET /api/memberships/manage — the customer's own memberships. */
export const GET = route(async () => {
  const user = await requireUser()
  const memberships = await db.businessMembership.findMany({
    where: { customerId: user.id },
    include: {
      tier: { select: { name: true, description: true, benefits: true, terms: true, discountCapPct: true } },
      org: { select: { id: true, name: true, type: true, county: true, town: true, logoUrl: true } },
      redemptions: { orderBy: { createdAt: 'desc' }, take: 10 },
      invoice: { select: { id: true, refCode: true, amountMinor: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  // expire stale ACTIVE memberships whose period has ended
  const now = new Date()
  for (const m of memberships) {
    if (m.status === 'ACTIVE' && m.currentPeriodEnd && m.currentPeriodEnd < now) {
      await db.businessMembership.update({ where: { id: m.id }, data: { status: 'EXPIRED' } })
      m.status = 'EXPIRED'
    }
  }
  return ok({
    memberships: memberships.map((m) => ({
      id: m.id,
      refCode: m.refCode,
      status: m.status,
      tierName: m.tier.name,
      description: m.tier.description,
      benefits: m.tier.benefits ? JSON.parse(m.tier.benefits) : [],
      terms: m.tier.terms,
      discountCapPct: m.tier.discountCapPct,
      business: m.org,
      billingPeriod: m.billingPeriod,
      startedAt: m.startedAt,
      currentPeriodEnd: m.currentPeriodEnd,
      redemptions: m.redemptions,
      invoice: m.invoice,
    })),
  })
})

const cancelSchema = z.object({ membershipId: z.string().min(1) })

/** PATCH — customer cancels (transparent, immediate; no auto-refund claim). */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, cancelSchema)
  const membership = await db.businessMembership.findFirst({ where: { id: body.membershipId, customerId: user.id } })
  if (!membership) return fail(404, 'NOT_FOUND', 'Membership not found.')
  if (membership.status !== 'ACTIVE' && membership.status !== 'PENDING_PAYMENT') {
    return fail(409, 'INVALID_STATE', 'Only active or pending memberships can be cancelled.')
  }
  await db.businessMembership.update({
    where: { id: membership.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })
  if (membership.status === 'PENDING_PAYMENT' && membership.invoiceId) {
    await db.invoice.update({ where: { id: membership.invoiceId }, data: { status: 'CANCELLED' } })
  }
  await audit({ actorId: user.id, actorName: user.name, action: 'MEMBERSHIP_CANCELLED', targetType: 'BUSINESS_MEMBERSHIP', targetId: membership.id, metadata: { ref: membership.refCode } })
  return ok({ message: 'Membership cancelled. Your benefits end immediately; any paid period is not refunded automatically — the business\'s cancellation terms apply.' })
})

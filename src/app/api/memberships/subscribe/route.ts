import { Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'

export const dynamic = 'force-dynamic'

const schema = z.object({
  tierId: z.string().min(1),
  billingPeriod: z.enum(['MONTHLY', 'YEARLY']),
})

/**
 * POST /api/memberships/subscribe: customer subscribes to a business
 * membership tier. HONEST BILLING (same policy as platform plans): this
 * creates a PENDING BusinessMembership + PENDING invoice. It becomes ACTIVE
 * only when the invoice is actually paid (M-Pesa callback with ResultCode 0
 * or FINANCE manual reconciliation): never on a frontend claim.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`membership-sub:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many subscription attempts. Please try later.')
  const body = await parseBody(req, schema)

  const tier = await db.membershipTier.findUnique({ where: { id: body.tierId }, include: { org: { select: { id: true, name: true, status: true, type: true } } } })
  if (!tier || !tier.active || tier.org.status !== 'ACTIVE') return fail(404, 'TIER_NOT_FOUND', 'This membership tier is not available.')
  if (!['GARAGE', 'DEALER'].includes(tier.org.type)) return fail(400, 'NOT_AVAILABLE', 'This business does not offer customer memberships.')

  const amount = body.billingPeriod === 'YEARLY'
    ? tier.priceYearlyMinor ?? tier.priceMonthlyMinor * 10
    : tier.priceMonthlyMinor
  const periodEnd = new Date(Date.now() + (body.billingPeriod === 'YEARLY' ? 365 : 30) * 24 * 3600 * 1000)

  // FINANCIAL CRITICAL SECTION: membership + invoice are created in ONE
  // transaction that re-checks the member limit and re-checks the
  // one-membership-per-customer rule at write time. The database
  // @@unique([orgId, customerId]) is the final backstop: two concurrent
  // subscribes can never both create payable rows (double charge).
  let membershipId: string
  let invoiceRef = ''
  let invoiceId = ''
  try {
    await db.$transaction(async (tx) => {
      if (tier.memberLimit !== null) {
        const activeCount = await tx.businessMembership.count({ where: { tierId: tier.id, status: 'ACTIVE' } })
        if (activeCount >= tier.memberLimit) {
          throw new ApiError(409, 'TIER_FULL', 'This tier has reached its member limit.')
        }
      }
      const existing = await tx.businessMembership.findFirst({
        where: { orgId: tier.orgId, customerId: user.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
      })
      if (existing) {
        throw new ApiError(409, 'ALREADY_MEMBER', existing.status === 'ACTIVE'
          ? 'You already hold an active membership with this business. Cancel it first to switch tiers.'
          : 'You already have a pending membership payment with this business.')
      }
      const invoice = await tx.invoice.create({
        data: {
          refCode: refCode('INV', 6),
          orgId: tier.orgId,
          userId: user.id,
          type: 'MEMBERSHIP',
          description: `${tier.name} membership (${body.billingPeriod.toLowerCase()}): ${tier.org.name} [membership:pending]`,
          amountMinor: amount,
          currency: 'KES',
          status: 'PENDING',
          periodStart: new Date(),
          periodEnd,
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      })
      const membership = await tx.businessMembership.create({
        data: {
          refCode: refCode('MEM', 6),
          tierId: tier.id,
          orgId: tier.orgId,
          customerId: user.id,
          billingPeriod: body.billingPeriod,
          status: 'PENDING_PAYMENT',
          currentPeriodEnd: periodEnd,
          invoiceId: invoice.id,
        },
      })
      await tx.invoice.update({ where: { id: invoice.id }, data: { description: invoice.description.replace('[membership:pending]', `[membership:${membership.id}]`) } })
      membershipId = membership.id
      invoiceRef = invoice.refCode
      invoiceId = invoice.id
    })
  } catch (e) {
    if (e instanceof ApiError) throw e
    // DB backstop: (orgId, customerId) unique — a concurrent subscribe won.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return fail(409, 'ALREADY_MEMBER', 'You already have a membership with this business (created concurrently).')
    }
    throw e
  }
  const membership = await db.businessMembership.findUniqueOrThrow({ where: { id: membershipId! } })
  const invoice = { id: invoiceId, refCode: invoiceRef, amountMinor: amount }

  const staff = await db.orgMember.findMany({ where: { orgId: tier.orgId, role: { in: ['OWNER', 'MANAGER', 'GM'] } }, select: { userId: true } })
  await notifyMany(staff.map((m) => m.userId), {
    type: 'MEMBERSHIP_PENDING',
    title: `New membership pending: ${tier.name}`,
    body: `${user.name} subscribed to ${tier.name}. Membership activates when payment is confirmed.`,
    link: tier.org.type === 'GARAGE' ? '/garage-dashboard?tab=memberships' : '/dealer?tab=memberships',
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'MEMBERSHIP_SUBSCRIBED', targetType: 'BUSINESS_MEMBERSHIP', targetId: membership.id, metadata: { ref: membership.refCode, tier: tier.name, period: body.billingPeriod, amount } })

  return ok({
    membership: { id: membership.id, refCode: membership.refCode, status: membership.status },
    invoice: { id: invoice.id, refCode: invoice.refCode, amountMinor: invoice.amountMinor },
    message: 'Membership created: complete the M-Pesa payment to activate. Benefits unlock only after payment confirmation.',
  }, { status: 201 })
})

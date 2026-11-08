import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'

const bodySchema = z.object({
  planCode: z.string().trim().min(2).max(40),
})

/**
 * POST /api/billing/subscribe: authenticated owners of an org whose type
 * matches the plan audience (DEALER_OWNER / GARAGE_OWNER / SUPPLIER_OWNER).
 *
 * IMPORTANT (honest billing): this creates a PENDING invoice only. The
 * subscription itself is NOT created or activated here; it is activated
 * exclusively when payment is confirmed (M-Pesa Daraja callback with
 * ResultCode 0, or a FINANCE manual reconciliation via mark-paid).
 */
const AUDIENCE_ROLE: Record<string, string> = {
  DEALER: 'DEALER_OWNER',
  GARAGE: 'GARAGE_OWNER',
  SUPPLIER: 'SUPPLIER_OWNER',
}
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`subscribe:${user.id}:${getIp(req)}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many subscription requests. Please try later.')

  const body = await parseBody(req, bodySchema)
  const plan = await db.plan.findUnique({ where: { code: body.planCode } })
  if (!plan || !plan.active) return fail(404, 'PLAN_NOT_FOUND', 'That plan does not exist or is no longer offered.')

  const requiredRole = AUDIENCE_ROLE[plan.audience]
  if (!requiredRole) {
    return fail(400, 'UNSUPPORTED_AUDIENCE', `Plan audience "${plan.audience}" is not supported.`)
  }
  const audienceLabel = plan.audience === 'DEALER' ? 'verified dealerships' : plan.audience === 'GARAGE' ? 'verified garages' : 'verified suppliers'
  if (!user.roles.includes(requiredRole)) {
    return fail(403, 'ROLE_REQUIRED', `This plan is for ${audienceLabel}. Your account must be an approved ${plan.audience.toLowerCase()} owner.`)
  }

  const memberships = await db.orgMember.findMany({
    where: { userId: user.id, org: { type: plan.audience, status: 'ACTIVE' } },
    include: { org: { select: { id: true, name: true, type: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (memberships.length === 0) {
    return fail(403, 'NO_ORG_MEMBERSHIP', `You need an active ${plan.audience.toLowerCase()} organisation to subscribe. Complete verification first.`)
  }
  const org = memberships[0].org

  const now = new Date()
  const periodEnd = new Date(now.getTime() + plan.intervalMonths * 30 * 24 * 60 * 60 * 1000)
  const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // `[plan:<code>]` suffix is parsed back by the activation helper when the
  // invoice is paid: no schema changes needed to recover the plan code.
  const invoice = await db.invoice.create({
    data: {
      refCode: refCode('INV', 6),
      orgId: org.id,
      userId: user.id,
      type: 'SUBSCRIPTION',
      description: `${plan.name} subscription: ${plan.intervalMonths} month(s) [plan:${plan.code}]`,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      status: 'PENDING',
      periodStart: now,
      periodEnd,
      dueDate,
    },
  })

  const existing = await db.subscription.findUnique({ where: { orgId: org.id } })
  const planChange = Boolean(existing && existing.planCode !== plan.code && existing.status === 'ACTIVE')

  await notify({
    userId: user.id,
    type: 'INVOICE_ISSUED',
    title: `Invoice ${invoice.refCode} issued`,
    body: `${plan.name}: KES ${(plan.priceMinor / 100).toLocaleString('en-KE')} for ${plan.intervalMonths} month(s). Pay via M-Pesa to activate.`,
    link: '/billing',
  })
  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'INVOICE_CREATED',
    targetType: 'INVOICE',
    targetId: invoice.id,
    metadata: { ref: invoice.refCode, plan: plan.code, orgId: org.id, amountMinor: invoice.amountMinor },
  })

  const message = planChange
    ? 'Invoice created: complete payment via M-Pesa or your account manager. Your plan change will apply after payment.'
    : existing
      ? 'Invoice created: complete payment via M-Pesa or your account manager. The renewal applies after payment.'
      : 'Invoice created: complete payment via M-Pesa or your account manager.'

  return ok({ invoice, message }, { status: 201 })
})

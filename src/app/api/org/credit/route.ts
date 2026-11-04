import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

/**
 * GET /api/org/credit?orgId= — business view of its customer credit
 * facilities (owner/GM/finance only). Balances are derived from the ledger.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgId = req.nextUrl.searchParams.get('orgId')
  if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required.')
  const membership = await getMembership(orgId, user.id)
  if (!membership || !['OWNER', 'GM', 'MANAGER', 'ACCOUNTANT', 'FINANCE'].includes(membership.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Not authorised for credit management.')
  }
  const facilities = await db.creditFacility.findMany({
    where: { orgId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      entries: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return ok({
    facilities: facilities.map((f) => {
      const outstanding = f.entries.reduce((bal, e) => bal + (e.paidAt ? 0 : e.amountMinor), 0)
      const overdue = f.entries.some((e) => e.amountMinor > 0 && !e.paidAt && e.dueDate && e.dueDate < new Date())
      return {
        id: f.id, refCode: f.refCode, customer: f.customer, limitMinor: f.limitMinor,
        depositMinor: f.depositMinor, status: f.status, terms: f.terms,
        outstandingMinor: Math.max(0, outstanding),
        availableMinor: Math.max(0, f.limitMinor - Math.max(0, outstanding)),
        overdue,
        approvedAt: f.approvedAt, createdAt: f.createdAt,
        entries: f.entries.slice(-30).reverse(),
      }
    }),
  })
})

const applySchema = z.object({
  orgId: z.string().min(1),
  requestedLimitMinor: z.number().int().min(10000).max(100_000_000),
  purpose: z.string().trim().max(300).optional(),
})

/**
 * POST — two flows:
 *  - Customer applies: { orgId, requestedLimitMinor, purpose } → creates
 *    PENDING_APPLICATION facility for the business to review. Applying never
 *    grants credit; a membership purchase never grants credit.
 *  - Business offers: { orgId, customerId, limitMinor, depositMinor, terms }
 *    → OFFERED; activates when the customer accepts the terms.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const raw = await req.json().catch(() => null) as { customerId?: string } | null

  if (raw?.customerId) {
    // business offers a facility
    const body = await parseBody(req, z.object({
      orgId: z.string().min(1),
      customerId: z.string().min(1),
      limitMinor: z.number().int().min(10000).max(100_000_000),
      depositMinor: z.number().int().min(0).max(100_000_000).default(0),
      terms: z.string().trim().min(10).max(3000),
    }))
    const membership = await getMembership(body.orgId, user.id)
    if (!membership || !['OWNER', 'GM', 'MANAGER', 'FINANCE'].includes(membership.role)) {
      return fail(403, 'PERMISSION_DENIED', 'Only management/finance offers credit facilities.')
    }
    const customer = await db.user.findUnique({ where: { id: body.customerId } })
    if (!customer) return fail(404, 'NO_CUSTOMER', 'No such customer account.')
    const facility = await db.creditFacility.upsert({
      where: { orgId_customerId: { orgId: body.orgId, customerId: body.customerId } },
      create: { refCode: refCode('CRD', 6), orgId: body.orgId, customerId: body.customerId, limitMinor: body.limitMinor, depositMinor: body.depositMinor, terms: body.terms, status: 'OFFERED' },
      update: { limitMinor: body.limitMinor, depositMinor: body.depositMinor, terms: body.terms, status: 'OFFERED' },
    })
    await notify({ userId: body.customerId, type: 'CREDIT_OFFER', title: 'Payment facility offer', body: 'A business you work with offered you a pay-later facility. Review and accept its terms in your account.', link: '/account?tab=subscriptions' })
    await audit({ actorId: user.id, actorName: user.name, action: 'CREDIT_OFFERED', targetType: 'CREDIT_FACILITY', targetId: facility.id, metadata: { limitMinor: body.limitMinor } })
    return ok({ facility, message: 'Offer sent. The facility activates only after the customer accepts the terms.' }, { status: 201 })
  }

  // customer application
  const body = await parseBody(req, applySchema)
  const org = await db.org.findFirst({ where: { id: body.orgId, status: 'ACTIVE', type: { in: ['GARAGE', 'DEALER'] } } })
  if (!org) return fail(404, 'NOT_FOUND', 'Business not found.')
  const existing = await db.creditFacility.findUnique({ where: { orgId_customerId: { orgId: body.orgId, customerId: user.id } } })
  if (existing && ['ACTIVE', 'OFFERED', 'PENDING_APPLICATION', 'SUSPENDED'].includes(existing.status)) {
    return fail(409, 'EXISTS', 'You already have a facility or application with this business.')
  }
  const facility = await db.creditFacility.upsert({
    where: { orgId_customerId: { orgId: body.orgId, customerId: user.id } },
    create: { refCode: refCode('CRD', 6), orgId: body.orgId, customerId: user.id, limitMinor: body.requestedLimitMinor, status: 'PENDING_APPLICATION' },
    update: { limitMinor: body.requestedLimitMinor, status: 'PENDING_APPLICATION' },
  })
  const managers = await db.orgMember.findMany({ where: { orgId: body.orgId, role: { in: ['OWNER', 'GM', 'MANAGER', 'FINANCE'] } }, select: { userId: true } })
  await notifyMany(managers.map((m) => m.userId), {
    type: 'CREDIT_APPLICATION',
    title: 'Customer credit application',
    body: `${user.name} applied for a pay-later facility (${(body.requestedLimitMinor / 100).toLocaleString()} KES). Review in your dashboard.`,
    link: org.type === 'GARAGE' ? '/garage-dashboard?tab=credit' : '/dealer?tab=credit',
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'CREDIT_APPLICATION', targetType: 'CREDIT_FACILITY', targetId: facility.id, metadata: { orgId: body.orgId, requested: body.requestedLimitMinor } })
  return ok({ facility, message: 'Application sent. Approval is entirely at the business\'s discretion — a membership never guarantees credit.' }, { status: 201 })
})

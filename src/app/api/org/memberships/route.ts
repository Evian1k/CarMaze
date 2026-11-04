import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getMembership } from '@/lib/orgs'
import { getFees } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/org/memberships?orgId= — business view of its membership
 * programme: tiers, members, revenue and redemptions (owner/manager only).
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgId = req.nextUrl.searchParams.get('orgId')
  if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required.')
  const membership = await getMembership(orgId, user.id)
  if (!membership || !['OWNER', 'GM', 'MANAGER', 'ACCOUNTANT', 'STAFF', 'SALES'].includes(membership.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Not authorised for membership management.')
  }
  const org = await db.org.findUnique({ where: { id: orgId }, select: { type: true, name: true } })
  if (!org || !['GARAGE', 'DEALER'].includes(org.type)) return fail(400, 'NOT_SUPPORTED', 'Customer memberships are for garages and showrooms.')

  const [tiers, members, invoices] = await Promise.all([
    db.membershipTier.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { memberships: true } } } }),
    db.businessMembership.findMany({
      where: { orgId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        tier: { select: { name: true } },
        redemptions: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.invoice.findMany({ where: { orgId, type: 'MEMBERSHIP' }, orderBy: { issuedAt: 'desc' }, take: 100 }),
  ])

  const active = members.filter((m) => m.status === 'ACTIVE')
  const revenue = invoices.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amountMinor, 0)
  const fees = await getFees()

  return ok({
    tiers: tiers.map((t) => ({ ...t, benefits: safeArr(t.benefits), branches: t.branchScope === 'SELECTED' ? safeArr(t.branchesJson) : null, memberCount: t._count.memberships })),
    members: members.map((m) => ({
      id: m.id, refCode: m.refCode, status: m.status, tier: m.tier.name,
      customer: m.customer, billingPeriod: m.billingPeriod,
      startedAt: m.startedAt, currentPeriodEnd: m.currentPeriodEnd,
      redemptions: m.redemptions,
    })),
    revenue: { grossMinor: revenue, paidCount: invoices.filter((i) => i.status === 'PAID').length, pendingCount: invoices.filter((i) => i.status === 'PENDING').length, platformFeePct: fees.membershipPlatformFeePct },
    activeCount: active.length,
  })
})

const tierSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional().nullable(),
  priceMonthlyMinor: z.number().int().min(0).max(10_000_000),
  priceYearlyMinor: z.number().int().min(0).max(100_000_000).optional().nullable(),
  benefits: z.array(z.string().max(140)).min(1).max(12),
  memberLimit: z.number().int().min(1).max(10_000).optional().nullable(),
  discountCapPct: z.number().int().min(0).max(80).optional().nullable(),
  branchScope: z.enum(['ALL', 'SELECTED']).default('ALL'),
  branches: z.array(z.string()).max(30).optional().nullable(),
  terms: z.string().max(2000).optional().nullable(),
})

/** POST — create a membership tier (owner/GM). */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, tierSchema)
  const membership = await getMembership(body.orgId, user.id)
  if (!membership || !['OWNER', 'GM', 'MANAGER'].includes(membership.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Only the owner or general manager builds membership tiers.')
  }
  const org = await db.org.findUnique({ where: { id: body.orgId }, select: { type: true, status: true, verified: true } })
  if (!org || org.status !== 'ACTIVE') return fail(400, 'INVALID_ORG', 'Business is not active.')
  if (!['GARAGE', 'DEALER'].includes(org.type)) return fail(400, 'NOT_SUPPORTED', 'Customer memberships are for garages and showrooms.')

  const tier = await db.membershipTier.create({
    data: {
      orgId: body.orgId,
      name: body.name,
      description: body.description ?? null,
      priceMonthlyMinor: body.priceMonthlyMinor,
      priceYearlyMinor: body.priceYearlyMinor ?? null,
      benefits: JSON.stringify(body.benefits),
      memberLimit: body.memberLimit ?? null,
      discountCapPct: body.discountCapPct ?? null,
      branchScope: body.branchScope,
      branchesJson: body.branchScope === 'SELECTED' && body.branches ? JSON.stringify(body.branches) : null,
      terms: body.terms ?? null,
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'MEMBERSHIP_TIER_CREATED', targetType: 'MEMBERSHIP_TIER', targetId: tier.id, metadata: { orgId: body.orgId, name: tier.name } })
  return ok({ tier: { ...tier, benefits: body.benefits } }, { status: 201 })
})

function safeArr(raw: string | null): string[] {
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}

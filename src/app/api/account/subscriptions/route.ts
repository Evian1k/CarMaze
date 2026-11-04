import { db } from '@/lib/db'
import { route, ok, requireUser } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/account/subscriptions — the customer's centralized subscription
 * dashboard data: business memberships (with benefits + redemption state),
 * trusted-customer programme memberships, approved credit facilities with
 * balances and schedules, and related invoices/receipts.
 */
export const GET = route(async () => {
  const user = await requireUser()

  const [memberships, trustMembers, facilities, invoices] = await Promise.all([
    db.businessMembership.findMany({
      where: { customerId: user.id },
      include: {
        tier: { select: { name: true, description: true, benefits: true, terms: true, discountCapPct: true, branchScope: true, branchesJson: true } },
        org: { select: { id: true, name: true, type: true, county: true, town: true, logoUrl: true } },
        redemptions: { orderBy: { createdAt: 'desc' }, take: 10 },
        invoice: { select: { id: true, refCode: true, amountMinor: true, status: true, issuedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.trustMember.findMany({
      where: { customerId: user.id },
      include: { programme: { include: { org: { select: { id: true, name: true, type: true, logoUrl: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.creditFacility.findMany({
      where: { customerId: user.id },
      include: {
        org: { select: { id: true, name: true, type: true, logoUrl: true } },
        entries: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.invoice.findMany({
      where: { userId: user.id, type: { in: ['MEMBERSHIP'] } },
      orderBy: { issuedAt: 'desc' },
      take: 30,
    }),
  ])

  // expire stale memberships
  const now = new Date()
  for (const m of memberships) {
    if (m.status === 'ACTIVE' && m.currentPeriodEnd && m.currentPeriodEnd < now) {
      await db.businessMembership.update({ where: { id: m.id }, data: { status: 'EXPIRED' } })
      m.status = 'EXPIRED'
    }
  }

  return ok({
    memberships: memberships.map((m) => ({
      id: m.id, refCode: m.refCode, status: m.status,
      tierName: m.tier.name, description: m.tier.description,
      benefits: m.tier.benefits ? JSON.parse(m.tier.benefits) : [],
      terms: m.tier.terms, discountCapPct: m.tier.discountCapPct,
      branchScope: m.tier.branchScope,
      business: m.org,
      billingPeriod: m.billingPeriod,
      startedAt: m.startedAt, currentPeriodEnd: m.currentPeriodEnd,
      redemptions: m.redemptions,
      invoice: m.invoice,
    })),
    trustProgrammes: trustMembers
      .filter((t) => t.label !== 'SUSPENDED')
      .map((t) => ({
        id: t.id, label: t.label,
        programme: { name: t.programme.name, description: t.programme.description, terms: t.programme.terms },
        business: t.programme.org,
        termsAcceptedAt: t.termsAcceptedAt,
        createdAt: t.createdAt,
      })),
    creditFacilities: facilities.map((f) => {
      const outstanding = f.entries.reduce((bal, e) => bal + (e.paidAt ? 0 : e.amountMinor), 0)
      return {
        id: f.id, refCode: f.refCode, status: f.status,
        business: f.org,
        limitMinor: f.limitMinor, depositMinor: f.depositMinor,
        outstandingMinor: Math.max(0, outstanding),
        availableMinor: Math.max(0, f.limitMinor - Math.max(0, outstanding)),
        terms: f.terms, termsAcceptedAt: f.termsAcceptedAt,
        entries: f.entries,
      }
    }),
    invoices,
    summary: {
      activeMemberships: memberships.filter((m) => m.status === 'ACTIVE').length,
      pendingPayments: invoices.filter((i) => i.status === 'PENDING').reduce((s, i) => s + i.amountMinor, 0),
      totalOutstandingCredit: facilities.reduce((s, f) => s + Math.max(0, f.entries.reduce((bal, e) => bal + (e.paidAt ? 0 : e.amountMinor), 0)), 0),
    },
  })
})

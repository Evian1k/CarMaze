import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, requireRole, fail } from '@/lib/api'
import { ROLE } from '@/lib/auth'
import { assertNotDemoStaffRead } from '@/lib/demo'
import { getFees } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/revenue: platform monetization dashboard.
 *
 * TRANSPARENCY RULE: gross transaction value is NEVER reported as platform
 * revenue. Platform revenue = commissions (recorded separately on completed
 * supply orders) + paid business subscriptions + paid promotional campaigns
 * + membership platform fees. Supplier sales totals are shown separately as
 * "marketplace GMV" context only.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireRole(ROLE.FINANCE, ROLE.ADMIN, ROLE.FOUNDER)
  // Platform financials are never exposed to demo sessions.
  assertNotDemoStaffRead(user, 'platform revenue')
  const sp = req.nextUrl.searchParams
  const country = sp.get('country') // reserved for future multi-country
  if (country && country !== 'KE') return fail(400, 'UNSUPPORTED', 'Only Kenya (KE) is live.')

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // ── Business subscriptions ──
  // All money totals use SQL aggregates (never unbounded table scans — the
  // ledger grows forever and this is a staff-facing hot endpoint).
  const [subsActive, subPaidSum, subPaidMonthSum] = await Promise.all([
    db.subscription.findMany({ where: { status: 'ACTIVE' }, include: { org: { select: { type: true, name: true, county: true } } } }),
    db.invoice.aggregate({ where: { type: 'SUBSCRIPTION', status: 'PAID' }, _sum: { amountMinor: true } }),
    db.invoice.aggregate({ where: { type: 'SUBSCRIPTION', status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amountMinor: true } }),
  ])
  const subPaidTotalMinor = subPaidSum._sum.amountMinor ?? 0
  const subPaidMonthMinor = subPaidMonthSum._sum.amountMinor ?? 0
  // MRR: latest paid subscription invoice per active subscription (bounded:
  // one indexed query per active sub — active subs are a small, finite set).
  const mrr = (await Promise.all(subsActive.map(async (s) => {
    const plan = await db.invoice.findFirst({
      where: { orgId: s.orgId, type: 'SUBSCRIPTION', status: 'PAID' },
      orderBy: { paidAt: 'desc' },
    })
    if (!plan) return 0
    const months = Math.max(1, plan.periodStart && plan.periodEnd ? Math.round((plan.periodEnd.getTime() - plan.periodStart.getTime()) / (30 * 24 * 3600 * 1000)) : 1)
    return Math.round(plan.amountMinor / months)
  }))).reduce((a, b) => a + b, 0)
  const byAudience = { DEALER: 0, GARAGE: 0, SUPPLIER: 0 }
  for (const s of subsActive) {
    if (s.org.type === 'DEALER') byAudience.DEALER++
    else if (s.org.type === 'GARAGE') byAudience.GARAGE++
    else if (s.org.type === 'SUPPLIER') byAudience.SUPPLIER++
  }

  // ── Supply commissions (recorded at release; never supplier GMV) ──
  const [commissionAllAgg, gmvAgg, releasedCount, commissionMonthAgg] = await Promise.all([
    db.purchaseOrder.aggregate({ where: { paymentStatus: { in: ['RELEASED', 'PARTIALLY_RELEASED'] } }, _sum: { platformFeeMinor: true } }),
    db.purchaseOrder.aggregate({ where: { paymentStatus: { in: ['RELEASED', 'PARTIALLY_RELEASED'] } }, _sum: { subtotalMinor: true } }),
    db.purchaseOrder.count({ where: { paymentStatus: { in: ['RELEASED', 'PARTIALLY_RELEASED'] } } }),
    db.purchaseOrder.aggregate({ where: { paymentStatus: { in: ['RELEASED', 'PARTIALLY_RELEASED'] }, updatedAt: { gte: monthStart } }, _sum: { platformFeeMinor: true } }),
  ])
  const commissionTotal = commissionAllAgg._sum.platformFeeMinor ?? 0
  const commissionMonth = commissionMonthAgg._sum.platformFeeMinor ?? 0
  const supplyGmv = gmvAgg._sum.subtotalMinor ?? 0

  // ── Promotions ──
  const [campaignTotalAgg, campaignMonthAgg, campaignCount] = await Promise.all([
    db.invoice.aggregate({ where: { type: 'CAMPAIGN', status: 'PAID' }, _sum: { amountMinor: true } }),
    db.invoice.aggregate({ where: { type: 'CAMPAIGN', status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amountMinor: true } }),
    db.invoice.count({ where: { type: 'CAMPAIGN', status: 'PAID' } }),
  ])
  const campaignTotal = campaignTotalAgg._sum.amountMinor ?? 0
  const campaignMonthMinor = campaignMonthAgg._sum.amountMinor ?? 0

  // ── Memberships (gross to businesses + platform fee portion) ──
  const membershipAgg = await db.invoice.aggregate({ where: { type: 'MEMBERSHIP', status: 'PAID' }, _sum: { amountMinor: true } })
  const fees = await getFees()
  const membershipGross = membershipAgg._sum.amountMinor ?? 0
  const membershipPlatformFee = Math.round(membershipGross * fees.membershipPlatformFeePct / 100)

  const platformRevenueTotal = subPaidTotalMinor + commissionTotal + campaignTotal + membershipPlatformFee
  const platformRevenueMonth = subPaidMonthMinor + commissionMonth + campaignMonthMinor

  // ── Churn & trials ──
  const [cancelledSubs, pastDueSubs] = await Promise.all([
    db.subscription.count({ where: { status: 'CANCELLED' } }),
    db.subscription.count({ where: { status: 'PAST_DUE' } }),
  ])

  // ── Failed renewals (overdue invoices) ──
  const overdueInvoices = await db.invoice.findMany({ where: { type: { in: ['SUBSCRIPTION'] }, status: 'PENDING', dueDate: { lt: now } }, select: { refCode: true, amountMinor: true, dueDate: true, org: { select: { name: true, type: true } } }, orderBy: { dueDate: 'asc' }, take: 100 })

  // ── Receivables ──
  const pendingInvoices = await db.invoice.aggregate({ where: { status: 'PENDING' }, _sum: { amountMinor: true }, _count: { amountMinor: true } })

  // ── monthly series (last 6 months) ──
  const months: { label: string; subs: number; commission: number; promo: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const [s, c, p] = await Promise.all([
      db.invoice.aggregate({ where: { type: 'SUBSCRIPTION', status: 'PAID', paidAt: { gte: start, lt: end } }, _sum: { amountMinor: true } }),
      db.purchaseOrder.aggregate({ where: { paymentStatus: { in: ['RELEASED', 'PARTIALLY_RELEASED'] }, updatedAt: { gte: start, lt: end } }, _sum: { platformFeeMinor: true } }),
      db.invoice.aggregate({ where: { type: 'CAMPAIGN', status: 'PAID', paidAt: { gte: start, lt: end } }, _sum: { amountMinor: true } }),
    ])
    months.push({
      label: start.toLocaleString('en-KE', { month: 'short' }),
      subs: s._sum.amountMinor ?? 0,
      commission: c._sum.platformFeeMinor ?? 0,
      promo: p._sum.amountMinor ?? 0,
    })
  }

  return ok({
    revenue: {
      platformRevenueTotalMinor: platformRevenueTotal,
      platformRevenueMonthMinor: platformRevenueMonth,
      arrMinor: mrr * 12,
      mrrMinor: mrr,
      subscriptions: { activeCount: subsActive.length, byAudience, paidInvoiceTotalMinor: subPaidTotalMinor, monthMinor: subPaidMonthMinor },
      commissions: { totalMinor: commissionTotal, monthMinor: commissionMonth, supplyGmvMinor: supplyGmv, releasedOrders: releasedCount, note: 'Commission is platform revenue; GMV is supplier transaction value, never booked as platform revenue.' },
      promotions: { totalMinor: campaignTotal, monthMinor: campaignMonthMinor, count: campaignCount },
      memberships: { grossMinor: membershipGross, platformFeeMinor: membershipPlatformFee, feePct: fees.membershipPlatformFeePct, note: 'Membership fees belong to the businesses; only the platform fee is platform revenue.' },
    },
    retention: {
      activeSubscriptions: subsActive.length,
      cancelled: cancelledSubs,
      pastDue: pastDueSubs,
      churnPct: subsActive.length + cancelledSubs > 0 ? Math.round((cancelledSubs / (subsActive.length + cancelledSubs)) * 1000) / 10 : 0,
      failedRenewals: overdueInvoices,
    },
    receivables: { pendingCount: pendingInvoices._count.amountMinor ?? 0, pendingMinor: pendingInvoices._sum.amountMinor ?? 0 },
    series: months,
    fees,
  })
})

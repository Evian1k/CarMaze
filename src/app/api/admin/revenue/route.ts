import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, requireRole, fail } from '@/lib/api'
import { ROLE } from '@/lib/auth'
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
  await requireRole(ROLE.FINANCE, ROLE.ADMIN, ROLE.FOUNDER)
  const sp = req.nextUrl.searchParams
  const country = sp.get('country') // reserved for future multi-country
  if (country && country !== 'KE') return fail(400, 'UNSUPPORTED', 'Only Kenya (KE) is live.')

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const yearStart = new Date(now.getFullYear(), 0, 1)

  // ── Business subscriptions ──
  const [subsActive, subInvoicesAll, subInvoicesMonth] = await Promise.all([
    db.subscription.findMany({ where: { status: 'ACTIVE' }, include: { org: { select: { type: true, name: true, county: true } } } }),
    db.invoice.findMany({ where: { type: 'SUBSCRIPTION', status: 'PAID' } }),
    db.invoice.findMany({ where: { type: 'SUBSCRIPTION', status: 'PAID', paidAt: { gte: monthStart } } }),
  ])
  const mrr = subsActive.reduce((sum, s) => {
    const plan = subInvoicesAll.filter((i) => i.orgId === s.orgId).sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))[0]
    if (!plan) return sum
    const months = Math.max(1, plan.periodStart && plan.periodEnd ? Math.round((plan.periodEnd.getTime() - plan.periodStart.getTime()) / (30 * 24 * 3600 * 1000)) : 1)
    return sum + Math.round(plan.amountMinor / months)
  }, 0)
  const byAudience = { DEALER: 0, GARAGE: 0, SUPPLIER: 0 }
  for (const s of subsActive) {
    if (s.org.type === 'DEALER') byAudience.DEALER++
    else if (s.org.type === 'GARAGE') byAudience.GARAGE++
    else if (s.org.type === 'SUPPLIER') byAudience.SUPPLIER++
  }

  // ── Supply commissions (recorded at release; never supplier GMV) ──
  const ordersMonth = await db.purchaseOrder.findMany({ where: { paymentStatus: { in: ['RELEASED', 'PARTIALLY_RELEASED'] }, updatedAt: { gte: monthStart } }, select: { platformFeeMinor: true, subtotalMinor: true } })
  const allReleased = await db.purchaseOrder.findMany({ where: { paymentStatus: { in: ['RELEASED', 'PARTIALLY_RELEASED'] } }, select: { platformFeeMinor: true, subtotalMinor: true, updatedAt: true } })
  const commissionTotal = allReleased.reduce((s, o) => s + o.platformFeeMinor, 0)
  const commissionMonth = ordersMonth.reduce((s, o) => s + o.platformFeeMinor, 0)
  const supplyGmv = allReleased.reduce((s, o) => s + o.subtotalMinor, 0)

  // ── Promotions ──
  const [campaignPaid, campaignPaidMonth] = await Promise.all([
    db.invoice.findMany({ where: { type: 'CAMPAIGN', status: 'PAID' } }),
    db.invoice.findMany({ where: { type: 'CAMPAIGN', status: 'PAID', paidAt: { gte: monthStart } } }),
  ])
  const campaignTotal = campaignPaid.reduce((s, i) => s + i.amountMinor, 0)

  // ── Memberships (gross to businesses + platform fee portion) ──
  const membershipPaid = await db.invoice.findMany({ where: { type: 'MEMBERSHIP', status: 'PAID' } })
  const fees = await getFees()
  const membershipGross = membershipPaid.reduce((s, i) => s + i.amountMinor, 0)
  const membershipPlatformFee = Math.round(membershipGross * fees.membershipPlatformFeePct / 100)

  const platformRevenueTotal = subInvoicesAll.reduce((s, i) => s + i.amountMinor, 0) + commissionTotal + campaignTotal + membershipPlatformFee
  const platformRevenueMonth = subInvoicesMonth.reduce((s, i) => s + i.amountMinor, 0) + commissionMonth + campaignPaidMonth.reduce((s, i) => s + i.amountMinor, 0)

  // ── Churn & trials ──
  const [cancelledSubs, pastDueSubs] = await Promise.all([
    db.subscription.count({ where: { status: 'CANCELLED' } }),
    db.subscription.count({ where: { status: 'PAST_DUE' } }),
  ])

  // ── Failed renewals (overdue invoices) ──
  const overdueInvoices = await db.invoice.findMany({ where: { type: { in: ['SUBSCRIPTION'] }, status: 'PENDING', dueDate: { lt: now } }, select: { refCode: true, amountMinor: true, dueDate: true, org: { select: { name: true, type: true } } } })

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
      subscriptions: { activeCount: subsActive.length, byAudience, paidInvoiceTotalMinor: subInvoicesAll.reduce((s, i) => s + i.amountMinor, 0), monthMinor: subInvoicesMonth.reduce((s, i) => s + i.amountMinor, 0) },
      commissions: { totalMinor: commissionTotal, monthMinor: commissionMonth, supplyGmvMinor: supplyGmv, releasedOrders: allReleased.length, note: 'Commission is platform revenue; GMV is supplier transaction value, never booked as platform revenue.' },
      promotions: { totalMinor: campaignTotal, monthMinor: campaignPaidMonth.reduce((s, i) => s + i.amountMinor, 0), count: campaignPaid.length },
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

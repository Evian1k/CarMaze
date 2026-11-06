import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail, requireRole, getIp } from '@/lib/api'
import { STAFF_ROLES } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

const REVIEWABLE = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED']

/**
 * GET /api/admin/overview: Control Center summary.
 * Every number is computed live from the database; no cached or fake values.
 */
export const GET = route(async (req: NextRequest) => {
  await requireRole(...STAFF_ROLES)
  const rl = rateLimit(`admin-overview:${getIp(req)}`, 60, 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many requests. Slow down.')

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    usersTotal, usersSuspended, usersNewWeek,
    dealersTotal, dealersActive, garagesTotal, garagesActive,
    dealerAppsPending, garageAppsPending,
    listingsPublished, listingsPending, listingsSold, listingsRejected, listingsDrafts,
    enquiriesTotal, enquiriesOpen,
    invoices,
    campaignsActive, campaignsPendingPayment,
    failedNotifications, failedPayments, openReports, openTickets, escalatedApplications,
    recentAudit, listingStatusGroups,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { status: 'SUSPENDED' } }),
    db.user.count({ where: { createdAt: { gte: weekAgo } } }),
    db.org.count({ where: { type: 'DEALER' } }),
    db.org.count({ where: { type: 'DEALER', status: 'ACTIVE' } }),
    db.org.count({ where: { type: 'GARAGE' } }),
    db.org.count({ where: { type: 'GARAGE', status: 'ACTIVE' } }),
    db.application.count({ where: { type: 'DEALER', status: { in: REVIEWABLE } } }),
    db.application.count({ where: { type: 'GARAGE', status: { in: REVIEWABLE } } }),
    db.vehicle.count({ where: { status: 'PUBLISHED' } }),
    db.vehicle.count({ where: { status: 'PENDING_REVIEW' } }),
    db.vehicle.count({ where: { status: 'SOLD' } }),
    db.vehicle.count({ where: { status: 'REJECTED' } }),
    db.vehicle.count({ where: { status: 'DRAFT' } }),
    db.enquiry.count(),
    db.enquiry.count({ where: { status: 'OPEN' } }),
    db.invoice.findMany({ select: { type: true, status: true, amountMinor: true } }),
    db.campaign.count({ where: { status: 'ACTIVE' } }),
    db.campaign.count({ where: { status: 'PENDING_PAYMENT' } }),
    db.notificationDelivery.count({ where: { status: 'FAILED' } }),
    db.paymentAttempt.count({ where: { status: 'FAILED' } }),
    db.report.count({ where: { status: 'OPEN' } }),
    db.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    db.application.count({ where: { escalated: true, status: { in: REVIEWABLE } } }),
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    db.vehicle.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  // Revenue aggregates from real invoice rows only.
  const types = ['SUBSCRIPTION', 'CAMPAIGN', 'LEAD_FEE']
  let paidTotalMinor = 0
  let pendingTotalMinor = 0
  let pendingCount = 0
  const byType = types.map((type) => {
    const rows = invoices.filter((i) => i.type === type)
    const paidMinor = rows.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amountMinor, 0)
    const pendingMinor = rows.filter((i) => i.status === 'PENDING' || i.status === 'OVERDUE').reduce((s, i) => s + i.amountMinor, 0)
    paidTotalMinor += paidMinor
    pendingTotalMinor += pendingMinor
    pendingCount += rows.filter((i) => i.status === 'PENDING' || i.status === 'OVERDUE').length
    return { type, paidMinor, pendingMinor }
  })

  return ok({
    users: { total: usersTotal, suspended: usersSuspended, newThisWeek: usersNewWeek },
    orgs: {
      dealers: { total: dealersTotal, active: dealersActive, pending: dealerAppsPending },
      garages: { total: garagesTotal, active: garagesActive, pending: garageAppsPending },
    },
    listings: {
      published: listingsPublished,
      pendingReview: listingsPending,
      sold: listingsSold,
      rejected: listingsRejected,
      drafts: listingsDrafts,
    },
    enquiries: { total: enquiriesTotal, open: enquiriesOpen },
    revenue: { paidTotalMinor, pendingCount, pendingTotalMinor, byType },
    campaigns: { active: campaignsActive, pendingPayment: campaignsPendingPayment },
    ops: {
      failedNotifications,
      failedPayments,
      openReports,
      openTickets,
      escalatedApplications,
    },
    recentAudit: recentAudit.map((a) => ({
      action: a.action,
      actorName: a.actorName,
      targetType: a.targetType,
      targetId: a.targetId,
      createdAt: a.createdAt,
    })),
    chart: {
      listingsByStatus: listingStatusGroups
        .map((g) => ({ status: g.status, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    },
  })
})

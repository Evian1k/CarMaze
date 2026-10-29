import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, ApiError, requireUser } from '@/lib/api'

const ACTIVE_LISTING_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'RESERVED']

/**
 * GET /api/dealer/dashboard?orgId=
 * Real aggregates for the signed-in dealer's organisation. Every number comes
 * from live database queries — nothing cached, nothing invented.
 * Defaults to the session's first DEALER org; pass ?orgId= to select another
 * org the user is a member of (tenant-isolated).
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const requestedOrgId = new URL(req.url).searchParams.get('orgId')

  const memberships = await db.orgMember.findMany({
    where: { userId: user.id, org: { type: 'DEALER' } },
    orderBy: { createdAt: 'asc' },
    include: { org: true },
  })

  if (memberships.length === 0) {
    throw new ApiError(403, 'NO_DEALER_ORG', 'You are not a member of a dealership yet.')
  }

  const membership = requestedOrgId
    ? memberships.find((m) => m.orgId === requestedOrgId)
    : memberships[0]
  if (!membership) {
    throw new ApiError(403, 'FORBIDDEN', 'You are not a member of that dealership.')
  }
  const orgId = membership.orgId

  const [org, subscription, vehicleGroups, viewAgg, enquiryGroups, offersPending, buyingRequestsOpen, staffCount, recentEnquiries, activeListings] =
    await Promise.all([
      db.org.findUnique({ where: { id: orgId } }),
      db.subscription.findUnique({ where: { orgId } }),
      db.vehicle.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
      db.vehicle.aggregate({ where: { orgId }, _sum: { views: true } }),
      db.enquiry.groupBy({ by: ['status'], where: { vehicle: { orgId } }, _count: { _all: true } }),
      db.offer.count({ where: { orgId, status: 'PENDING' } }),
      db.buyingRequest.count({ where: { orgId, status: 'OPEN' } }),
      db.orgMember.count({ where: { orgId } }),
      db.enquiry.findMany({
        where: { vehicle: { orgId } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          vehicle: { select: { id: true, make: true, model: true, year: true, priceMinor: true, currency: true } },
          user: { select: { name: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      db.vehicle.count({ where: { orgId, status: { in: ACTIVE_LISTING_STATUSES } } }),
    ])

  if (!org) throw new ApiError(404, 'NOT_FOUND', 'Dealership not found.')

  const vehicleCounts = Object.fromEntries(vehicleGroups.map((g) => [g.status, g._count._all]))
  const enquiryCounts = Object.fromEntries(enquiryGroups.map((g) => [g.status, g._count._all]))

  const plan = subscription ? await db.plan.findUnique({ where: { code: subscription.planCode } }) : null

  return ok({
    org: {
      id: org.id,
      name: org.name,
      type: org.type,
      regNo: org.regNo,
      county: org.county,
      town: org.town,
      location: org.location,
      phone: org.phone,
      email: org.email,
      description: org.description,
      status: org.status,
      createdAt: org.createdAt,
    },
    viewerRole: membership.role,
    subscription: subscription && plan
      ? {
          planCode: plan.code,
          planName: plan.name,
          status: subscription.status,
          startedAt: subscription.startedAt,
          currentPeriodEnd: subscription.currentPeriodEnd,
          listingLimit: plan.listingLimit,
          featuredLimit: plan.featuredLimit,
          staffLimit: plan.staffLimit,
        }
      : null,
    stats: {
      published: vehicleCounts['PUBLISHED'] ?? 0,
      pending: vehicleCounts['PENDING_REVIEW'] ?? 0,
      drafts: vehicleCounts['DRAFT'] ?? 0,
      sold: vehicleCounts['SOLD'] ?? 0,
      reserved: vehicleCounts['RESERVED'] ?? 0,
      totalViews: viewAgg._sum.views ?? 0,
      enquiriesOpen: enquiryCounts['OPEN'] ?? 0,
      enquiriesAnswered: enquiryCounts['ANSWERED'] ?? 0,
      offersPending,
      buyingRequestsOpen,
      staffCount,
    },
    recentEnquiries: recentEnquiries.map((e) => ({
      id: e.id,
      refCode: e.refCode,
      status: e.status,
      createdAt: e.createdAt,
      customerName: e.user.name,
      phone: e.phoneShare ? e.phone : null,
      vehicle: e.vehicle,
      lastMessage: e.messages[0]
        ? { senderName: e.messages[0].senderName, senderSide: e.messages[0].senderSide, body: e.messages[0].body, createdAt: e.messages[0].createdAt }
        : null,
    })),
    listingUsage: {
      used: activeListings,
      limit: plan?.listingLimit ?? null,
    },
  })
})

import { NextRequest } from 'next/server'
import { route, ok, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/privacy/export — Kenya DPA 2019 data-subject access export.
 *
 * Returns the requesting user's OWN personal data held by CARMAZE as a
 * downloadable JSON document. Strictly scoped to the caller: every query is
 * filtered by the session user id, so no other person's data can leak into
 * the export. Each download is audit-logged (data-subject access requests
 * are security-relevant events).
 *
 * NOT included by design: password hashes, MFA secrets, verification codes,
 * other users' data, and internal staff-only records about the account.
 */
export const GET = route(async (_req: NextRequest) => {
  const user = await requireUser()
  const uid = user.id

  const [
    account, vehicles, enquiries, serviceRequests, roadsideRequests,
    myVehicles, posts, comments, notifications, savedVehicles, savedSearches,
    memberships, businessMemberships, orders, customerOrders, reviews,
    testDrives, custodies, disputes, supportTickets, loyalty,
  ] = await Promise.all([
    db.user.findUnique({
      where: { id: uid },
      select: {
        id: true, email: true, name: true, phone: true, phoneVerified: true,
        emailVerified: true, mfaEnabled: true, roles: true, isDemo: true,
        status: true, referralCode: true, referredById: true, createdAt: true,
      },
    }),
    db.vehicle.findMany({ where: { ownerId: uid }, select: { refCode: true, make: true, model: true, year: true, priceMinor: true, status: true, createdAt: true } }),
    db.enquiry.findMany({ where: { userId: uid }, select: { refCode: true, vehicleId: true, message: true, status: true, createdAt: true } }),
    db.serviceRequest.findMany({ where: { customerId: uid }, select: { refCode: true, category: true, status: true, createdAt: true } }),
    db.roadsideRequest.findMany({ where: { userId: uid }, select: { refCode: true, status: true, createdAt: true } }),
    db.myVehicle.findMany({ where: { userId: uid }, select: { make: true, model: true, year: true, plate: true, createdAt: true } }),
    db.communityPost.findMany({ where: { userId: uid }, select: { title: true, status: true, createdAt: true } }),
    db.postComment.findMany({ where: { userId: uid }, select: { body: true, createdAt: true } }),
    db.notification.findMany({ where: { userId: uid }, select: { type: true, title: true, createdAt: true }, take: 500, orderBy: { createdAt: 'desc' } }),
    db.savedVehicle.findMany({ where: { userId: uid }, select: { vehicleId: true, createdAt: true } }),
    db.savedSearch.findMany({ where: { userId: uid } }),
    db.orgMember.findMany({ where: { userId: uid }, select: { org: { select: { name: true, type: true } }, role: true, createdAt: true } }),
    db.businessMembership.findMany({ where: { customerId: uid }, select: { refCode: true, status: true, startedAt: true, currentPeriodEnd: true } }),
    db.purchaseOrder.findMany({ where: { createdById: uid }, select: { refCode: true, totalMinor: true, status: true, paymentStatus: true, createdAt: true } }),
    db.customerOrder.findMany({ where: { buyerUserId: uid }, select: { refCode: true, totalMinor: true, status: true, createdAt: true } }),
    db.orgReview.findMany({ where: { authorId: uid }, select: { orgId: true, rating: true, comment: true, createdAt: true } }),
    db.testDrive.findMany({ where: { customerId: uid }, select: { refCode: true, scheduledAt: true, status: true } }),
    db.vehicleCustody.findMany({ where: { customerId: uid }, select: { refCode: true, vehicleDesc: true, status: true, receivedAt: true, createdAt: true } }),
    db.dispute.findMany({ where: { openedById: uid }, select: { refCode: true, reason: true, status: true, createdAt: true } }),
    db.supportTicket.findMany({ where: { userId: uid }, select: { refCode: true, subject: true, status: true, createdAt: true } }),
    db.loyaltyLedger.findMany({ where: { userId: uid }, select: { points: true, reason: true, createdAt: true } }),
  ])

  await audit({ actorId: uid, actorName: user.name, action: 'PRIVACY_DATA_EXPORTED', targetType: 'USER', targetId: uid })

  const payload = {
    document: 'CARMAZE personal data export (Kenya Data Protection Act, 2019 — data subject access)',
    generatedAt: new Date().toISOString(),
    account,
    marketplace: { vehicles, savedVehicles, savedSearches, enquiries, testDrives, reviews },
    garage: { serviceRequests, custodies, myVehicles },
    supplyAndOrders: { purchaseOrders: orders, customerOrders, memberships, businessMemberships },
    roadside: roadsideRequests,
    community: { posts, comments },
    support: { tickets: supportTickets, disputes },
    notifications,
    loyaltyLedger: loyalty,
  }

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="carmaze-data-export-${uid}.json"`,
      'Cache-Control': 'no-store',
    },
  })
})

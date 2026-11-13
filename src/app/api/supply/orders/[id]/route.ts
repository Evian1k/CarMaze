import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail } from '@/lib/api'
import { getMembership } from '@/lib/orgs'
import { jsonParse } from '@/lib/supply'
import { unseal } from '@/lib/secret-box'
import { assertNotDemoStaffRead } from '@/lib/demo'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/supply/orders/[id]: full order detail for authorised parties
 * (garage members / supplier members / platform staff). Includes items,
 * revisions, delivery + events, payment state, inspection and disputes.
 * The handover OTP is never exposed here; only a hint.
 */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUserSafe()
  if (!user) return fail(401, 'UNAUTHENTICATED', 'Please sign in to continue.')

  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      garage: { select: { id: true, name: true, county: true, town: true, verified: true } },
      supplier: { select: { id: true, name: true, county: true, town: true, verified: true, supplierRating: true, phone: true, email: true } },
      destinationBranch: { select: { id: true, name: true, code: true, address: true, town: true, county: true, lat: true, lng: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true, mpn: true, brand: true, condition: true, images: true, warrantyMonths: true, returnable: true, authenticityVerified: true } } } },
      revisions: { orderBy: { createdAt: 'desc' } },
      delivery: { include: { events: { orderBy: { createdAt: 'asc' } }, supplierBranch: { select: { id: true, name: true, code: true, address: true, town: true, county: true, lat: true, lng: true } } } },
      payment: true,
      refunds: { orderBy: { createdAt: 'desc' } },
      disputes: { orderBy: { createdAt: 'desc' }, include: { events: { orderBy: { createdAt: 'asc' } } } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!order) return fail(404, 'NOT_FOUND', 'Order not found.')

  const membership = await getMembership(order.garageOrgId, user.id)
  const supplierMembership = await getMembership(order.supplierOrgId, user.id)
  const isStaff = !user.isDemo && user.roles.some((r) => ['SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER'].includes(r))
  if (!membership && !supplierMembership && !isStaff) {
    return fail(403, 'FORBIDDEN', 'You are not authorised to view this order.')
  }
  // A demo staff session reaching a REAL order only via the platform-staff
  // branch must be blocked: the payload carries payment, commission and
  // OTP-hint data for real procurement.
  if (!membership && !supplierMembership) assertNotDemoStaffRead(user, 'purchase order records')

  const side = supplierMembership ? 'SUPPLIER' : 'GARAGE'
  const viewerRole = side === 'SUPPLIER' ? supplierMembership?.role ?? '' : membership?.role ?? ''
  return ok({
    side,
    role: viewerRole,
    order: {
      id: order.id,
      refCode: order.refCode,
      status: order.status,
      paymentStatus: order.paymentStatus,
      inspectionStatus: order.inspectionStatus,
      garage: order.garage,
      supplier: order.supplier,
      destinationBranch: order.destinationBranch,
      items: order.items.map((i) => ({
        id: i.id, productId: i.productId, name: i.product.name, sku: i.product.sku, mpn: i.product.mpn,
        brand: i.product.brand, condition: i.product.condition, image: safeFirst(i.product.images),
        warrantyMonths: i.product.warrantyMonths, returnable: i.product.returnable,
        authenticityVerified: i.product.authenticityVerified,
        qty: i.qty, unitPriceMinor: i.unitPriceMinor, lineTotalMinor: i.lineTotalMinor,
        fulfilBranchId: i.fulfilBranchId, qtyDelivered: i.qtyDelivered, qtyAccepted: i.qtyAccepted, note: i.note,
      })),
      revisions: order.revisions.map((r) => ({ id: r.id, changes: jsonParse<unknown[]>(r.changesJson, []), newTotalMinor: r.newTotalMinor, note: r.note, status: r.status, createdAt: r.createdAt })),
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      taxMinor: order.taxMinor,
      platformFeeMinor: order.platformFeeMinor,
      totalMinor: order.totalMinor,
      acceptedTotalMinor: order.acceptedTotalMinor,
      currency: order.currency,
      supplierNote: order.supplierNote,
      deliveryMethod: order.deliveryMethod,
      delivery: order.delivery ? {
        id: order.delivery.id,
        refCode: order.delivery.refCode,
        method: order.delivery.method,
        status: order.delivery.status,
        supplierBranch: order.delivery.supplierBranch,
        meetup: jsonParse<{ lat?: number; lng?: number; address?: string } | null>(order.delivery.meetupJson, null),
        meetupAgreedByGarage: order.delivery.meetupAgreedByGarage,
        meetupAgreedBySupplier: order.delivery.meetupAgreedBySupplier,
        scheduledFor: order.delivery.scheduledFor,
        windowLabel: order.delivery.windowLabel,
        courierName: order.delivery.courierName,
        driverName: order.delivery.driverName,
        driverPhone: order.delivery.driverPhone,
        vehicleReg: order.delivery.vehicleReg,
        deliveryRef: order.delivery.deliveryRef,
        dispatchEvidence: jsonParse<string[]>(order.delivery.dispatchEvidence, []),
        dispatchedAt: order.delivery.dispatchedAt,
        expectedAt: order.delivery.expectedAt,
        otpHint: order.delivery.otpHint,
        // The QR token is a handover credential: only the receiving side may
        // hold it. The supplier keeps their own confirmation channel. The raw
        // value is unsealed from the sealed box (or the legacy plaintext row) —
        // the database itself stores only the hash.
        qrToken: side === 'GARAGE' ? (order.delivery.qrToken ?? unseal(order.delivery.qrTokenEnc)) : null,
        deliveredAt: order.delivery.deliveredAt,
        handover: jsonParse<Record<string, unknown> | null>(order.delivery.handoverJson, null),
        garageConfirmAt: order.delivery.garageConfirmAt,
        supplierConfirmAt: order.delivery.supplierConfirmAt,
        failedReason: order.delivery.failedReason,
        feeMinor: order.delivery.feeMinor,
        events: order.delivery.events,
      } : null,
      payment: order.payment,
      refunds: order.refunds,
      disputes: order.disputes.map((d) => ({ ...d, evidence: jsonParse<unknown[]>(d.evidence, []) })),
      events: order.events,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
  })
})

async function requireUserSafe() {
  const { getSessionUser } = await import('@/lib/auth')
  return getSessionUser()
}

function safeFirst(raw: string | null): string | null {
  try { return raw ? (JSON.parse(raw) as string[])[0] ?? null : null } catch { return null }
}

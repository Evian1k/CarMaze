import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole } from '@/lib/api'
import { ROLE, hasRole } from '@/lib/auth'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'
import { staffUserIds } from '@/lib/orgs'
import { jsonParse, getFees, poEvent } from '@/lib/supply'
import { assertDemoResourceGuard } from '@/lib/demo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/supply: platform staff console for the Automotive Supply
 * Network: supplier applications, verification queue, product moderation,
 * counterfeit reports, disputes, order/payment monitoring, low-risk scores.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireRole(ROLE.SUPPORT, ROLE.REVIEWER, ROLE.MODERATOR, ROLE.FINANCE, ROLE.ADMIN, ROLE.FOUNDER)
  const sp = req.nextUrl.searchParams

  const [applications, suppliers, pendingProducts, disputedOrders, openDisputes, recentOrders, counterfeitReports, refunds] = await Promise.all([
    db.application.findMany({
      where: { type: 'SUPPLIER', status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED'] } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { submittedAt: 'asc' },
      take: 50,
    }),
    db.org.findMany({
      where: { type: 'SUPPLIER', status: 'ACTIVE' },
      select: {
        id: true, name: true, regNo: true, county: true, verified: true, supplierRiskScore: true, createdAt: true, status: true,
        _count: { select: { products: true, branches: true, poAsSupplier: true, reviews: true } },
        subscription: { select: { planCode: true, status: true, currentPeriodEnd: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.product.findMany({
      where: { status: 'PUBLISHED', authenticityVerified: false },
      select: { id: true, refCode: true, name: true, sku: true, brand: true, provenance: true, createdAt: true, supplier: { select: { id: true, name: true, verified: true } } },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    db.purchaseOrder.findMany({
      where: { status: 'DISPUTED' },
      select: { id: true, refCode: true, totalMinor: true, paymentStatus: true, updatedAt: true, garage: { select: { name: true } }, supplier: { select: { name: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, select: { refCode: true, reason: true, amountFrozenMinor: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    }),
    db.dispute.findMany({
      where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      include: {
        order: { select: { refCode: true, totalMinor: true, paymentStatus: true, garage: { select: { name: true } }, supplier: { select: { name: true } } } },
        customerOrder: { select: { refCode: true, totalMinor: true, paymentStatus: true, status: true, buyer: { select: { name: true } }, supplier: { select: { name: true } }, invoice: { select: { refCode: true, status: true } } } },
        events: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    db.purchaseOrder.findMany({
      where: sp.get('orders') === 'all' ? {} : { status: { in: ['SUBMITTED', 'AWAITING_APPROVAL', 'CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED'] } },
      select: { id: true, refCode: true, status: true, paymentStatus: true, totalMinor: true, createdAt: true, garage: { select: { name: true } }, supplier: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    db.securityIncident.count({ where: { category: 'OTHER', status: { in: ['OPEN', 'UNDER_REVIEW'] } } }).catch(() => 0),
    db.refund.findMany({
      where: { status: { in: ['REQUESTED', 'APPROVED'] } },
      include: { order: { select: { refCode: true, totalMinor: true, paymentStatus: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ])

  // DEMO SANDBOX: applicant contact details (email) are real personal data the
  // demo catalog promises to hide — strip them for demo staff viewers.
  return ok({
    applications: applications.map((a) => ({
      ...a,
      documents: jsonParse<{ name: string; url: string }[]>(a.documents, []),
      user: user.isDemo && a.user ? { ...a.user, email: null } : a.user,
    })),
    suppliers,
    pendingProducts,
    disputedOrders,
    openDisputes,
    recentOrders,
    refundQueue: refunds,
    counterfeitSignalCount: counterfeitReports,
  })
})

const actionSchema = z.discriminatedUnion('action', [
  // supplier verification: never automatic
  z.object({ action: z.literal('verify-supplier'), orgId: z.string().min(1), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('unverify-supplier'), orgId: z.string().min(1), note: z.string().max(500) }),
  z.object({ action: z.literal('suspend-supplier'), orgId: z.string().min(1), note: z.string().max(500) }),
  z.object({ action: z.literal('restore-supplier'), orgId: z.string().min(1), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('risk-score'), orgId: z.string().min(1), score: z.number().int().min(0).max(100), note: z.string().max(300) }),
  // supplier application decisions
  z.object({ action: z.literal('approve-application'), applicationId: z.string().min(1), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('reject-application'), applicationId: z.string().min(1), note: z.string().max(500) }),
  // product moderation & authenticity (independent from business verification)
  z.object({ action: z.literal('verify-authenticity'), productId: z.string().min(1), note: z.string().max(500) }),
  z.object({ action: z.literal('revoke-authenticity'), productId: z.string().min(1), note: z.string().max(500) }),
  z.object({ action: z.literal('suspend-product'), productId: z.string().min(1), note: z.string().max(500) }),
  z.object({ action: z.literal('republish-product'), productId: z.string().min(1), note: z.string().max(300).optional() }),
  // disputes
  z.object({ action: z.literal('dispute-note'), disputeId: z.string().min(1), note: z.string().max(1000) }),
  z.object({ action: z.literal('dispute-status'), disputeId: z.string().min(1), status: z.enum(['UNDER_REVIEW', 'OPEN']) }),
  z.object({
    action: z.literal('resolve-dispute'),
    disputeId: z.string().min(1),
    resolution: z.enum(['REFUND_FULL', 'REFUND_PARTIAL', 'REPLACEMENT', 'REJECTED']),
    note: z.string().max(1000),
    refundAmountMinor: z.number().int().min(0).optional(),
  }),
  // payments
  z.object({ action: z.literal('reconcile-payment'), orderId: z.string().min(1), providerRef: z.string().min(3).max(80), note: z.string().max(300).optional() }),
  z.object({ action: z.literal('process-refund'), refundId: z.string().min(1), decision: z.enum(['APPROVED', 'PROCESSED', 'REJECTED']), providerRef: z.string().max(80).optional(), note: z.string().max(300).optional() }),
])

/** Resolve the demo-ecosystem subject of a supply-console action from the
 * database (owner user or owning org). Returns null when the record does not
 * exist: demo sessions are then blocked rather than trusted. */
async function supplyActionSubject(body: { action: string; orgId?: string; applicationId?: string; productId?: string; disputeId?: string; orderId?: string; refundId?: string }): Promise<{ ownerId?: string | null; orgId?: string | null } | null> {
  switch (body.action) {
    case 'verify-supplier':
    case 'unverify-supplier':
    case 'suspend-supplier':
    case 'restore-supplier':
    case 'risk-score':
      return { orgId: body.orgId ?? null }
    case 'approve-application':
    case 'reject-application': {
      const app = body.applicationId ? await db.application.findUnique({ where: { id: body.applicationId }, select: { userId: true } }) : null
      return app ? { ownerId: app.userId } : null
    }
    case 'verify-authenticity':
    case 'revoke-authenticity':
    case 'suspend-product':
    case 'republish-product': {
      const product = body.productId ? await db.product.findUnique({ where: { id: body.productId }, select: { supplierOrgId: true } }) : null
      return product ? { orgId: product.supplierOrgId } : null
    }
    case 'dispute-note':
    case 'dispute-status':
    case 'resolve-dispute': {
      const dispute = body.disputeId ? await db.dispute.findUnique({ where: { id: body.disputeId }, select: { orderId: true, customerOrderId: true, order: { select: { garageOrgId: true, supplierOrgId: true } }, customerOrder: { select: { buyerUserId: true, supplierOrgId: true } } } }) : null
      if (!dispute) return null
      if (dispute.order) return { orgId: dispute.order.garageOrgId || dispute.order.supplierOrgId }
      if (dispute.customerOrder) return { ownerId: dispute.customerOrder.buyerUserId, orgId: dispute.customerOrder.supplierOrgId }
      return null
    }
    case 'reconcile-payment': {
      const order = body.orderId ? await db.purchaseOrder.findUnique({ where: { id: body.orderId }, select: { garageOrgId: true, supplierOrgId: true } }) : null
      return order ? { orgId: order.garageOrgId || order.supplierOrgId } : null
    }
    case 'process-refund': {
      const refund = body.refundId ? await db.refund.findUnique({ where: { id: body.refundId }, include: { order: { select: { garageOrgId: true, supplierOrgId: true } } } }) : null
      return refund?.order ? { orgId: refund.order.garageOrgId || refund.order.supplierOrgId } : null
    }
    default:
      return null
  }
}

/** POST: all sensitive actions are logged to the audit trail. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireRole(ROLE.SUPPORT, ROLE.REVIEWER, ROLE.MODERATOR, ROLE.FINANCE, ROLE.ADMIN, ROLE.FOUNDER)
  const body = await parseBody(req, actionSchema)
  const staffSide = 'ADMIN' as const

  // FINANCE SPLIT: reconciling a payment marks an invoice PAID and processing
  // a refund moves money state: restricted to FINANCE/ADMIN/FOUNDER instead
  // of every staff role.
  if ((body.action === 'reconcile-payment' || body.action === 'process-refund') && !hasRole(user, ROLE.FINANCE, ROLE.ADMIN, ROLE.FOUNDER)) {
    return fail(403, 'FINANCE_ONLY', 'Payment reconciliation and refunds are restricted to the Finance department.')
  }

  // DEMO SANDBOX: demo staff may only run console actions whose subject
  // belongs to the demo ecosystem. The subject is resolved from the database,
  // never from client-supplied ownership claims.
  if (user.isDemo) {
    const subject = await supplyActionSubject(body)
    if (!subject) return fail(403, 'DEMO_SANDBOXED', 'Demo mode: the record for this action could not be resolved, so it has been blocked.')
    await assertDemoResourceGuard(user, subject)
  }

  switch (body.action) {
    case 'verify-supplier': {
      const org = await db.org.findFirst({ where: { id: body.orgId, type: 'SUPPLIER' } })
      if (!org) return fail(404, 'NOT_FOUND', 'Supplier not found.')
      if (org.verified) return fail(409, 'ALREADY_VERIFIED', 'Supplier is already verified.')
      await db.org.update({ where: { id: org.id }, data: { verified: true } })
      const members = await db.orgMember.findMany({ where: { orgId: org.id }, select: { userId: true } })
      await notifyMany(members.map((m) => m.userId), { type: 'SUPPLIER_VERIFIED', title: 'Supplier verification approved', body: 'Your business is now verified on the Automotive Supply Network.', link: '/supplier' })
      await audit({ actorId: user.id, actorName: user.name, action: 'SUPPLIER_VERIFIED', targetType: 'ORG', targetId: org.id, metadata: { note: body.note } })
      return ok({ message: `${org.name} is now verified.` })
    }
    case 'unverify-supplier': {
      const org = await db.org.findFirst({ where: { id: body.orgId, type: 'SUPPLIER' } })
      if (!org) return fail(404, 'NOT_FOUND', 'Supplier not found.')
      await db.org.update({ where: { id: org.id }, data: { verified: false } })
      await audit({ actorId: user.id, actorName: user.name, action: 'SUPPLIER_VERIFICATION_REVOKED', targetType: 'ORG', targetId: org.id, metadata: { note: body.note } })
      return ok({ message: 'Verification revoked.' })
    }
    case 'suspend-supplier': {
      const org = await db.org.findFirst({ where: { id: body.orgId, type: 'SUPPLIER' } })
      if (!org) return fail(404, 'NOT_FOUND', 'Supplier not found.')
      await db.org.update({ where: { id: org.id }, data: { status: 'SUSPENDED', verified: false } })
      await db.product.updateMany({ where: { supplierOrgId: org.id, status: 'PUBLISHED' }, data: { status: 'SUSPENDED' } })
      await audit({ actorId: user.id, actorName: user.name, action: 'SUPPLIER_SUSPENDED', targetType: 'ORG', targetId: org.id, metadata: { note: body.note } })
      return ok({ message: `${org.name} suspended and delisted.` })
    }
    case 'restore-supplier': {
      const org = await db.org.findFirst({ where: { id: body.orgId, type: 'SUPPLIER' } })
      if (!org) return fail(404, 'NOT_FOUND', 'Supplier not found.')
      await db.org.update({ where: { id: org.id }, data: { status: 'ACTIVE' } })
      await audit({ actorId: user.id, actorName: user.name, action: 'SUPPLIER_RESTORED', targetType: 'ORG', targetId: org.id, metadata: { note: body.note } })
      return ok({ message: 'Supplier restored (products require manual republish review).' })
    }
    case 'risk-score': {
      await db.org.update({ where: { id: body.orgId }, data: { supplierRiskScore: body.score } })
      await audit({ actorId: user.id, actorName: user.name, action: 'SUPPLIER_RISK_UPDATED', targetType: 'ORG', targetId: body.orgId, metadata: { score: body.score, note: body.note } })
      return ok({ message: `Risk score set to ${body.score}.` })
    }
    case 'approve-application': {
      const app = await db.application.findUnique({ where: { id: body.applicationId } })
      if (!app || app.type !== 'SUPPLIER') return fail(404, 'NOT_FOUND', 'Application not found.')
      if (app.orgId) return fail(409, 'ALREADY_APPROVED', 'Application already approved.')
      let org = await db.org.findFirst({ where: { name: app.orgName, type: 'SUPPLIER' } })
      if (!org) {
        org = await db.org.create({
          data: {
            type: 'SUPPLIER', name: app.orgName, regNo: app.regNo, county: app.county, town: app.town,
            location: app.physicalAddress, phone: app.phone, email: app.email,
            description: app.notes, verified: false,
            specialities: app.categories,
          },
        })
      }
      await db.orgMember.upsert({
        where: { orgId_userId: { orgId: org.id, userId: app.userId } },
        create: { orgId: org.id, userId: app.userId, role: 'OWNER' },
        update: {},
      })
      const buyer = await db.user.findUnique({ where: { id: app.userId } })
      if (buyer && !buyer.roles.split(',').includes('SUPPLIER_OWNER')) {
        await db.user.update({ where: { id: buyer.id }, data: { roles: `${buyer.roles},SUPPLIER_OWNER` } })
      }
      await db.application.update({
        where: { id: app.id },
        data: { status: 'APPROVED', orgId: org.id, decisionNote: body.note ?? null, events: { create: { type: 'APPROVED', actorId: user.id, actorName: user.name, note: body.note ?? 'Documents reviewed. Business account created: verification (listing) follows separately.' } } },
      })
      await notify({ userId: app.userId, type: 'SUPPLIER_APPROVED', title: 'Supplier application approved', body: `${app.orgName} is registered. Add your warehouses and products in the Supplier Portal. Verification status shows once platform review completes.`, link: '/supplier' })
      await audit({ actorId: user.id, actorName: user.name, action: 'SUPPLIER_APPLICATION_APPROVED', targetType: 'APPLICATION', targetId: app.id, metadata: { orgId: org.id } })
      return ok({ message: 'Application approved. Supplier business account created (unverified until listing review).' })
    }
    case 'reject-application': {
      const app = await db.application.findUnique({ where: { id: body.applicationId } })
      if (!app || app.type !== 'SUPPLIER') return fail(404, 'NOT_FOUND', 'Application not found.')
      await db.application.update({
        where: { id: app.id },
        data: { status: 'REJECTED', decisionNote: body.note, events: { create: { type: 'REJECTED', actorId: user.id, actorName: user.name, note: body.note } } },
      })
      await notify({ userId: app.userId, type: 'SUPPLIER_REJECTED', title: `Application ${app.refCode} rejected`, body: body.note, link: '/supply' })
      await audit({ actorId: user.id, actorName: user.name, action: 'SUPPLIER_APPLICATION_REJECTED', targetType: 'APPLICATION', targetId: app.id, metadata: { note: body.note } })
      return ok({ message: 'Application rejected.' })
    }
    case 'verify-authenticity': {
      const product = await db.product.findUnique({ where: { id: body.productId } })
      if (!product) return fail(404, 'NOT_FOUND', 'Product not found.')
      await db.product.update({
        where: { id: product.id },
        data: {
          authenticityVerified: true,
          provenance: JSON.stringify({ ...(jsonParse<Record<string, unknown>>(product.provenance, {})), authenticator: 'ADMIN', verifiedAt: new Date().toISOString(), note: body.note }),
        },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'PRODUCT_AUTHENTICITY_VERIFIED', targetType: 'PRODUCT', targetId: product.id, metadata: { note: body.note } })
      return ok({ message: 'Product authenticity independently verified by CARMAZE.' })
    }
    case 'revoke-authenticity': {
      const product = await db.product.findUnique({ where: { id: body.productId } })
      if (!product) return fail(404, 'NOT_FOUND', 'Product not found.')
      await db.product.update({ where: { id: product.id }, data: { authenticityVerified: false } })
      await audit({ actorId: user.id, actorName: user.name, action: 'PRODUCT_AUTHENTICITY_REVOKED', targetType: 'PRODUCT', targetId: product.id, metadata: { note: body.note } })
      return ok({ message: 'Authenticity mark removed.' })
    }
    case 'suspend-product': {
      await db.product.update({ where: { id: body.productId }, data: { status: 'SUSPENDED' } })
      await audit({ actorId: user.id, actorName: user.name, action: 'PRODUCT_SUSPENDED', targetType: 'PRODUCT', targetId: body.productId, metadata: { note: body.note } })
      return ok({ message: 'Product suspended from the catalogue.' })
    }
    case 'republish-product': {
      await db.product.update({ where: { id: body.productId }, data: { status: 'PUBLISHED' } })
      await audit({ actorId: user.id, actorName: user.name, action: 'PRODUCT_REPUBLISHED', targetType: 'PRODUCT', targetId: body.productId })
      return ok({ message: 'Product republished.' })
    }
    case 'dispute-note': {
      const dispute = await db.dispute.findUnique({ where: { id: body.disputeId } })
      if (!dispute) return fail(404, 'NOT_FOUND', 'Dispute not found.')
      await db.disputeEvent.create({ data: { disputeId: dispute.id, type: 'NOTE', actorId: user.id, actorName: user.name, note: body.note } })
      await audit({ actorId: user.id, actorName: user.name, action: 'DISPUTE_NOTE', targetType: 'DISPUTE', targetId: dispute.id })
      return ok({ message: 'Note added to the dispute file.' })
    }
    case 'dispute-status': {
      await db.dispute.update({ where: { id: body.disputeId }, data: { status: body.status } })
      await db.disputeEvent.create({ data: { disputeId: body.disputeId, type: 'STATUS_CHANGE', actorId: user.id, actorName: user.name, note: `Status set to ${body.status}` } })
      await audit({ actorId: user.id, actorName: user.name, action: 'DISPUTE_STATUS_CHANGED', targetType: 'DISPUTE', targetId: body.disputeId, metadata: { status: body.status } })
      return ok({ message: 'Dispute status updated.' })
    }
    case 'resolve-dispute': {
      const dispute = await db.dispute.findUnique({ where: { id: body.disputeId }, include: { order: true, customerOrder: { include: { supplier: { select: { id: true, name: true } } } } } })
      if (!dispute) return fail(404, 'NOT_FOUND', 'Dispute not found.')
      if (dispute.status === 'RESOLVED' || dispute.status === 'CLOSED') return fail(409, 'ALREADY_RESOLVED', 'Dispute already resolved.')

      // ── Consumer (B2C) parts-order dispute ──
      if (dispute.customerOrderId) {
        const order = dispute.customerOrder
        if (!order) return fail(404, 'NOT_FOUND', 'Dispute has no linked consumer order.')
        await db.dispute.update({
          where: { id: dispute.id },
          data: { status: 'RESOLVED', resolution: body.resolution, resolutionNote: body.note, resolvedBy: user.name, resolvedAt: new Date() },
        })
        await db.disputeEvent.create({ data: { disputeId: dispute.id, type: 'RESOLUTION', actorId: user.id, actorName: user.name, note: `${body.resolution}: ${body.note}` } })
        if (body.resolution === 'REJECTED') {
          // Complaint not upheld: the delivered order stands as completed.
          await db.customerOrder.update({ where: { id: order.id }, data: { status: 'COMPLETED', completedAt: order.completedAt ?? new Date() } })
          await db.customerOrderEvent.create({ data: { orderId: order.id, type: 'NOTE', actorSide: 'SYSTEM', actorName: user.name, note: `Dispute ${dispute.refCode} not upheld: ${body.note}` } })
        } else if (body.resolution === 'REPLACEMENT') {
          // Re-enters fulfilment: the supplier re-dispatches, the buyer confirms receipt again.
          await db.customerOrder.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } })
          await db.customerOrderEvent.create({ data: { orderId: order.id, type: 'NOTE', actorSide: 'SYSTEM', actorName: user.name, note: `Dispute ${dispute.refCode} resolved by replacement. The supplier re-dispatches; confirm receipt when it arrives.` } })
        }
        // REFUND_FULL / REFUND_PARTIAL: the decision is recorded; the money
        // movement itself happens when FINANCE refunds the linked invoice via
        // the invoice refund endpoint (which completes the order). We never
        // mark a refund as done here.
        await notify({
          userId: order.buyerUserId,
          type: 'DISPUTE_RESOLVED',
          title: `Dispute ${dispute.refCode} resolved: ${body.resolution.replaceAll('_', ' ').toLowerCase()}`,
          body: body.note,
          link: '/account?tab=orders',
        })
        await notifyMany((await db.orgMember.findMany({ where: { orgId: order.supplierOrgId }, select: { userId: true } })).map((m) => m.userId), {
          type: 'DISPUTE_RESOLVED',
          title: `Dispute ${dispute.refCode} resolved`,
          body: `${body.resolution}: ${body.note}`,
          link: '/supplier?tab=consumer-orders',
        })
        await audit({ actorId: user.id, actorName: user.name, action: 'DISPUTE_RESOLVED', targetType: 'DISPUTE', targetId: dispute.id, metadata: { resolution: body.resolution, note: body.note, customerOrder: order.refCode } })
        return ok({ message: `Dispute resolved (${body.resolution}).${body.resolution.includes('REFUND') ? ' Finance will process the refund on the order invoice.' : ''}` })
      }

      // ── Garage↔Supplier purchase-order dispute ──
      if (!dispute.order) return fail(404, 'NOT_FOUND', 'Dispute has no linked order.')
      await db.dispute.update({
        where: { id: dispute.id },
        data: { status: 'RESOLVED', resolution: body.resolution, resolutionNote: body.note, resolvedBy: user.name, resolvedAt: new Date() },
      })
      await db.disputeEvent.create({ data: { disputeId: dispute.id, type: 'RESOLUTION', actorId: user.id, actorName: user.name, note: `${body.resolution}: ${body.note}` } })
      if (body.resolution === 'REFUND_FULL' || body.resolution === 'REFUND_PARTIAL') {
        const amount = body.resolution === 'REFUND_FULL' ? dispute.order.totalMinor : (body.refundAmountMinor ?? 0)
        if (amount > 0) {
          await db.refund.create({
            data: { refCode: refCode('RFD', 6), orderId: dispute.orderId!, paymentAuthId: (await db.paymentAuthorization.findUnique({ where: { orderId: dispute.orderId! } }))?.id, amountMinor: amount, kind: body.resolution === 'REFUND_FULL' ? 'FULL' : 'PARTIAL', reason: `Dispute ${dispute.refCode}: ${body.note.slice(0, 200)}`, status: 'REQUESTED', requestedById: user.id },
          })
        }
        if (dispute.order.paymentStatus === 'PROTECTED') {
          await db.purchaseOrder.update({ where: { id: dispute.orderId! }, data: { paymentStatus: body.resolution === 'REFUND_FULL' ? 'REFUNDED' : 'PARTIALLY_RELEASED' } })
        }
        // Financial integrity: a refund decision must remove the escrow value it
        // covers. FULL → the authorization can no longer be released against;
        // PARTIAL → the released amount is capped at the remaining escrow by the
        // release gate (amountMinor − refundedAmountMinor). Without this, a
        // garage could release protected funds AND keep a queued refund.
        const auth = await db.paymentAuthorization.findUnique({ where: { orderId: dispute.orderId! } })
        if (auth && amount > 0 && ['PROTECTED', 'PENDING'].includes(auth.status)) {
          const totalRefunded = Math.min(auth.amountMinor, (auth.refundedAmountMinor ?? 0) + amount)
          await db.paymentAuthorization.update({
            where: { id: auth.id },
            data: {
              refundedAmountMinor: totalRefunded,
              ...(body.resolution === 'REFUND_FULL' && totalRefunded >= auth.amountMinor ? { status: 'REFUNDED' } : {}),
            },
          })
        }
      }
      await db.purchaseOrder.update({ where: { id: dispute.orderId! }, data: { status: body.resolution === 'REJECTED' ? 'COMPLETED' : 'INSPECTED' } })
      // A dispute resolution that upholds the order (no refund) un-holds the
      // supplier settlement: the funds were protected and delivery stood.
      if (body.resolution === 'REJECTED') {
        await db.settlement.updateMany({ where: { orderId: dispute.orderId!, status: 'ON_HOLD' }, data: { status: 'PENDING' } })
      }
      await audit({ actorId: user.id, actorName: user.name, action: 'DISPUTE_RESOLVED', targetType: 'DISPUTE', targetId: dispute.id, metadata: { resolution: body.resolution, note: body.note } })
      await notifyMany(await staffUserIds('ADMIN', 'SUPPORT'), { type: 'DISPUTE_RESOLVED', title: `Dispute ${dispute.refCode} resolved`, body: body.resolution, link: '/admin?tab=disputes' })
      // Both parties must learn the outcome: previously only staff were told.
      await notifyMany((await db.orgMember.findMany({ where: { orgId: dispute.order!.garageOrgId }, select: { userId: true } })).map((m) => m.userId), { type: 'DISPUTE_RESOLVED', title: `Dispute ${dispute.refCode} resolved`, body: `${body.resolution.replaceAll('_', ' ').toLowerCase()}: ${body.note}`, link: '/procurement?tab=orders' })
      await notifyMany((await db.orgMember.findMany({ where: { orgId: dispute.order!.supplierOrgId }, select: { userId: true } })).map((m) => m.userId), { type: 'DISPUTE_RESOLVED', title: `Dispute ${dispute.refCode} resolved`, body: `${body.resolution.replaceAll('_', ' ').toLowerCase()}: ${body.note}`, link: '/supplier?tab=orders' })
      return ok({ message: `Dispute resolved (${body.resolution}).${body.resolution.includes('REFUND') ? ' Refund queued for finance processing.' : ''}` })
    }
    case 'reconcile-payment': {
      const order = await db.purchaseOrder.findUnique({ where: { id: body.orderId }, include: { payment: true } })
      if (!order) return fail(404, 'NOT_FOUND', 'Order not found.')
      if (order.paymentStatus === 'PROTECTED') return fail(409, 'ALREADY_PROTECTED', 'Order payment already protected.')
      if (order.status === 'DISPUTED') return fail(409, 'ORDER_DISPUTED', 'The order is under dispute: resolve the dispute first; reconciliation while frozen would bypass the dispute hold.')
      const fees = await getFees()
      await db.paymentAuthorization.upsert({
        where: { orderId: order.id },
        create: { refCode: refCode('PAY', 6), orderId: order.id, provider: 'MANUAL_RECONCILED', status: 'PROTECTED', amountMinor: order.totalMinor, checkoutRef: body.providerRef, protectedAt: new Date(), resultDesc: body.note ?? 'Reconciled against provider statement' },
        update: { provider: 'MANUAL_RECONCILED', status: 'PROTECTED', checkoutRef: body.providerRef, protectedAt: new Date(), resultDesc: body.note ?? 'Reconciled against provider statement' },
      })
      await db.purchaseOrder.update({ where: { id: order.id }, data: { paymentStatus: 'PROTECTED' } })
      if (order.invoiceId) await db.invoice.update({ where: { id: order.invoiceId }, data: { status: 'PAID', paidAt: new Date(), paidVia: 'MANUAL' } })
      await poEvent(order.id, { type: 'PAYMENT', actorId: user.id, actorName: user.name, actorSide: staffSide, note: `Payment reconciled (provider ref ${body.providerRef}). Funds protected pending inspection.` })
      await audit({ actorId: user.id, actorName: user.name, action: 'ORDER_PAYMENT_RECONCILED', targetType: 'PURCHASE_ORDER', targetId: order.id, metadata: { providerRef: body.providerRef } })
      await notifyMany((await db.orgMember.findMany({ where: { orgId: order.garageOrgId }, select: { userId: true } })).map((m) => m.userId), { type: 'ORDER_PAYMENT', title: `Payment protected: ${order.refCode}`, body: 'Finance confirmed the payment. The supplier can now dispatch; funds release after your inspection.', link: '/procurement?tab=orders' })
      return ok({ message: 'Payment reconciled and protected. Supplier can dispatch.' })
    }
    case 'process-refund': {
      const refund = await db.refund.findUnique({ where: { id: body.refundId }, include: { order: true } })
      if (!refund) return fail(404, 'NOT_FOUND', 'Refund not found.')
      if (refund.status === 'PROCESSED') return fail(409, 'ALREADY_PROCESSED', 'Refund already processed.')
      // Money integrity: PROCESSED states money left the platform — it requires
      // the external reference of the actual reversal (provider statement,
      // M-Pesa reversal code, bank ref). And bookkeeping can never refund more
      // than the payment collected.
      if (body.decision === 'PROCESSED' && (!body.providerRef || body.providerRef.trim().length < 3)) {
        return fail(400, 'PROVIDER_REF_REQUIRED', 'Recording a refund as PROCESSED requires the external provider reference of the actual reversal.')
      }
      const auth = await db.paymentAuthorization.findUnique({ where: { orderId: refund.orderId } })
      if (body.decision === 'PROCESSED' && auth && (auth.refundedAmountMinor ?? 0) + refund.amountMinor > auth.amountMinor) {
        return fail(409, 'REFUND_EXCEEDS_PAYMENT', `Refund of ${(refund.amountMinor / 100).toLocaleString()} KES would exceed the ${(auth.amountMinor / 100).toLocaleString()} KES collected for this order.`)
      }
      await db.refund.update({
        where: { id: refund.id },
        data: { status: body.decision, processedBy: user.name, processedAt: new Date(), providerRef: body.providerRef ?? null },
      })
      if (body.decision === 'PROCESSED') {
        const payment = auth ?? await db.paymentAuthorization.findUnique({ where: { orderId: refund.orderId } })
        if (payment) {
          const totalRefunded = payment.refundedAmountMinor + refund.amountMinor
          await db.paymentAuthorization.update({
            where: { id: payment.id },
            data: { refundedAmountMinor: totalRefunded, status: totalRefunded >= payment.amountMinor ? 'REFUNDED' : payment.status },
          })
        }
        await audit({ actorId: user.id, actorName: user.name, action: 'REFUND_PROCESSED', targetType: 'PURCHASE_ORDER', targetId: refund.orderId, metadata: { amount: refund.amountMinor, providerRef: body.providerRef } })
      } else {
        await audit({ actorId: user.id, actorName: user.name, action: `REFUND_${body.decision}`, targetType: 'PURCHASE_ORDER', targetId: refund.orderId, metadata: { note: body.note } })
      }
      return ok({ message: `Refund ${body.decision.toLowerCase()}.` })
    }
  }
})

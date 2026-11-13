import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { refCode, sixDigitCode } from '@/lib/ids'
import { notify, notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { assertNotDemoStaffRead } from '@/lib/demo'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// Absolute lifetime of a consumer-order collection code from dispatch.
const ORDER_CODE_TTL_MS = 72 * 60 * 60 * 1000

// ───────────────────────────── Helpers ─────────────────────────────

function safeFirstImage(raw: string | null): string | null {
  try {
    return raw ? (JSON.parse(raw) as string[])[0] ?? null : null
  } catch {
    return null
  }
}

const SUPPLIER_NOTIFY_ROLES = ['OWNER', 'OPERATIONS', 'WAREHOUSE', 'SALES']

async function notifySupplierMembers(orgId: string, input: { type: string; title: string; body?: string; link: string }) {
  const members = await db.orgMember.findMany({
    where: { orgId, role: { in: SUPPLIER_NOTIFY_ROLES } },
    select: { userId: true },
  })
  await notifyMany(members.map((m) => m.userId), input)
}

async function orderEvent(orderId: string, params: { type: string; actorSide: 'CUSTOMER' | 'SUPPLIER' | 'SYSTEM'; actorId?: string | null; actorName: string; note?: string }) {
  await db.customerOrderEvent.create({
    data: {
      orderId,
      type: params.type,
      actorSide: params.actorSide,
      actorId: params.actorId ?? null,
      actorName: params.actorName,
      note: params.note ?? null,
    },
  })
}

// ───────────────────────────── GET ─────────────────────────────

/**
 * GET /api/orders/[id]: full consumer-order detail for authorised parties:
 * the buyer, platform staff, or a member of the supplier org.
 * Events are returned newest-first. The delivery OTP is never exposed here.
 */
export const GET = route<Ctx>(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()

  const order = await db.customerOrder.findUnique({
    where: { id },
    include: {
      buyer: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true, county: true, verified: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true, images: true, condition: true, warrantyMonths: true } } } },
      invoice: { select: { id: true, refCode: true, status: true, amountMinor: true, dueDate: true } },
      events: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!order) return fail(404, 'NOT_FOUND', 'Order not found.')

  // fulfillmentBranchId has no Prisma relation on CustomerOrder; load it directly.
  const fulfillmentBranch = order.fulfillmentBranchId
    ? await db.orgBranch.findUnique({ where: { id: order.fulfillmentBranchId }, select: { id: true, name: true, town: true } })
    : null

  const isBuyer = order.buyerUserId === user.id
  const isStaff = hasRole(user, ...STAFF_ROLES)
  const supplierMembership = isBuyer || isStaff
    ? null
    : await db.orgMember.findFirst({ where: { orgId: order.supplierOrgId, userId: user.id } })
  if (!isBuyer && !isStaff && !supplierMembership) {
    return fail(403, 'FORBIDDEN', 'You are not authorised to view this order.')
  }
  // Staff view of a REAL customer order exposes the buyer's phone/address —
  // closed to demo sessions.
  if (isStaff && !isBuyer) assertNotDemoStaffRead(user, 'customer order records')

  return ok({
    side: isBuyer ? 'BUYER' : isStaff ? 'STAFF' : 'SUPPLIER',
    role: supplierMembership?.role ?? null,
    order: {
      id: order.id,
      refCode: order.refCode,
      status: order.status,
      paymentStatus: order.paymentStatus,
      buyer: order.buyer,
      supplier: order.supplier,
      county: order.county,
      address: order.address,
      phone: order.phone,
      notes: order.notes,
      deliveryMethod: order.deliveryMethod,
      deliveryFeeMinor: order.deliveryFeeMinor,
      totalMinor: order.totalMinor,
      currency: order.currency,
      courierName: order.courierName,
      otpHint: order.otpHint,
      fulfillmentBranchId: order.fulfillmentBranchId,
      fulfillmentBranch,
      rejectedReason: order.rejectedReason,
      deliveredAt: order.deliveredAt,
      completedAt: order.completedAt,
      itemCount: order.items.length,
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        name: i.product.name,
        sku: i.product.sku,
        qty: i.qty,
        unitPriceMinor: i.unitPriceMinor,
        lineTotalMinor: i.lineTotalMinor,
        image: safeFirstImage(i.product.images),
        condition: i.product.condition,
        warrantyMonths: i.product.warrantyMonths,
      })),
      invoice: order.invoice,
      events: order.events.map((e) => ({
        id: e.id,
        type: e.type,
        actorSide: e.actorSide,
        actorId: e.actorId,
        actorName: e.actorName,
        note: e.note,
        createdAt: e.createdAt,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
  })
})

// ───────────────────────────── POST (actions) ─────────────────────────────

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept'),
    fulfillmentBranchId: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal('reject'),
    reason: z.string().trim().min(5, 'Give the customer a reason (min 5 characters)').max(500),
  }),
  z.object({
    action: z.literal('dispatch'),
    courierName: z.string().trim().min(2, 'Name the courier').max(120),
  }),
  z.object({
    action: z.literal('delivered'),
    code: z.string().trim().min(4).max(12),
  }),
  z.object({ action: z.literal('confirm') }),
  z.object({ action: z.literal('cancel') }),
  z.object({
    action: z.literal('dispute'),
    reason: z.enum(['MISSING_ITEMS', 'DAMAGED', 'WRONG_ITEM', 'COUNTERFEIT', 'NOT_RECEIVED', 'OTHER']),
    details: z.string().trim().min(20, 'Describe the problem in at least 20 characters so the supplier and our disputes team can act on it').max(2000),
  }),
])

/**
 * POST /api/orders/[id]: lifecycle actions on a consumer order.
 *  Supplier: accept (stock leaves the shelf, PENDING invoice issued),
 *            reject (reason required), dispatch (collection code generated
 *            and delivered to the buyer's in-app notifications), mark delivered
 *            (verifies the buyer's collection code).
 *  Buyer:    cancel (only while SUBMITTED), confirm receipt (DELIVERED → COMPLETED).
 */
export const POST = route<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const body = await parseBody(req, actionSchema)

  const order = await db.customerOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, name: true } } } },
    },
  })
  if (!order) return fail(404, 'NOT_FOUND', 'Order not found.')

  const isBuyer = order.buyerUserId === user.id
  // Supplier fulfilment actions require an ACTIVE supplier org.
  const supplierMembership = await db.orgMember.findFirst({ where: { orgId: order.supplierOrgId, userId: user.id, org: { status: 'ACTIVE' } } })

  // Authorisation: supplier actions need membership of order.supplierOrgId
  // AND a fulfilment-capable role (mirrors the supply role matrix
  // `order.respond`: OWNER, OPERATIONS, WAREHOUSE). Finance/accounting or
  // read-only members cannot accept, dispatch or hand over orders.
  const FULFILMENT_ROLES = ['OWNER', 'OPERATIONS', 'WAREHOUSE']
  if (['accept', 'reject', 'dispatch', 'delivered'].includes(body.action)) {
    if (!supplierMembership) return fail(403, 'FORBIDDEN', 'Only the supplier can perform this action.')
    if (!FULFILMENT_ROLES.includes(supplierMembership.role)) {
      return fail(403, 'FORBIDDEN', 'Your role does not permit order fulfilment actions.')
    }
  }
  if (['confirm', 'cancel'].includes(body.action) && !isBuyer) {
    return fail(403, 'FORBIDDEN', 'Only the buyer can perform this action.')
  }
  if (body.action === 'dispute' && !isBuyer) {
    return fail(403, 'FORBIDDEN', 'Only the buyer can open a dispute on this order.')
  }

  switch (body.action) {
    // ── Supplier: accept ────────────────────────────────────────────────
    case 'accept': {
      if (order.status !== 'SUBMITTED') {
        return fail(409, 'INVALID_STATE', `This order is ${order.status} and can no longer be accepted.`)
      }

      const activeBranches = await db.orgBranch.findMany({
        where: { orgId: order.supplierOrgId, status: 'ACTIVE' },
        select: { id: true, name: true },
      })
      if (activeBranches.length === 0) {
        return fail(409, 'NO_BRANCH', 'Add an active branch or warehouse before accepting orders.')
      }
      const stocks = await db.productStock.findMany({
        where: {
          productId: { in: order.items.map((i) => i.productId) },
          branch: { orgId: order.supplierOrgId, status: 'ACTIVE' },
        },
      })

      const availableAt = (branchId: string, productId: string): number => {
        const s = stocks.find((st) => st.branchId === branchId && st.productId === productId)
        return s ? s.qtyOnHand - s.qtyReserved : 0
      }
      const coversOrder = (branchId: string): boolean =>
        order.items.every((it) => availableAt(branchId, it.productId) >= it.qty)

      let chosen: { id: string; name: string } | null = null
      if (body.fulfillmentBranchId) {
        const b = activeBranches.find((x) => x.id === body.fulfillmentBranchId)
        if (!b) return fail(400, 'BAD_BRANCH', 'Choose a branch that belongs to your business.')
        chosen = b
      } else {
        // Auto-pick the branch with the most stock that can cover every line.
        const orgTotal = (branchId: string): number =>
          stocks.filter((s) => s.branchId === branchId).reduce((sum, s) => sum + (s.qtyOnHand - s.qtyReserved), 0)
        const fitting = activeBranches.filter((b) => coversOrder(b.id)).sort((a, b) => orgTotal(b.id) - orgTotal(a.id))
        chosen = fitting[0] ?? null
      }
      if (!chosen) {
        return fail(409, 'INSUFFICIENT_STOCK', 'No single branch can cover every line of this order. Restock, choose another branch explicitly, or reject the order.')
      }

      // Verify the chosen branch covers each line (explicit selection included).
      for (const it of order.items) {
        const avail = availableAt(chosen.id, it.productId)
        if (avail < it.qty) {
          const line = order.items.find((x) => x.productId === it.productId)!
          return fail(409, 'INSUFFICIENT_STOCK', `${line.product.name}: only ${avail} unit(s) available at ${chosen.name}.`, { productId: line.productId, available: avail })
        }
      }

      const dueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000)
      const chosenBranch = chosen
      const updated = await db.$transaction(async (tx) => {
        // Oversell guard: stock cover is re-checked INSIDE the transaction and
        // each decrement is conditional (qtyOnHand must still cover the line).
        // Two concurrent accepts of competing orders can never both take the
        // same units — the loser gets a clean INSUFFICIENT_STOCK and NO
        // invoice is minted (the whole transaction rolls back).
        for (const it of order.items) {
          const decremented = await tx.productStock.updateMany({
            where: { productId: it.productId, branchId: chosenBranch.id, qtyOnHand: { gte: it.qty } },
            data: { qtyOnHand: { decrement: it.qty } },
          })
          if (decremented.count === 0) {
            const line = order.items.find((x) => x.productId === it.productId)!
            throw new ApiError(409, 'INSUFFICIENT_STOCK', `${line.product.name}: stock at ${chosenBranch.name} was taken by another order while you were accepting. Nothing was recorded.`)
          }
          await tx.stockMovement.create({
            data: {
              branchId: chosenBranch.id,
              productId: it.productId,
              delta: -it.qty,
              reason: 'SALE',
              refType: 'MANUAL',
              refId: order.id,
              note: `Sold via consumer order ${order.refCode}`,
              actorId: user.id,
              actorName: user.name,
            },
          })
        }
        const invoice = await tx.invoice.create({
          data: {
            refCode: refCode('INV', 6),
            orgId: order.supplierOrgId,
            userId: order.buyerUserId,
            type: 'PARTS_ORDER',
            description: `Parts order ${order.refCode}: ${order.supplier.name}`,
            amountMinor: order.totalMinor,
            currency: order.currency,
            status: 'PENDING',
            dueDate,
          },
        })
        // Conditional status flip: a concurrent accept/reject cannot double-
        // issue invoices for one order.
        const flipped = await tx.customerOrder.updateMany({
          where: { id: order.id, status: { in: ['SUBMITTED', 'CONFIRMED'] } },
          data: {
            status: 'ACCEPTED',
            fulfillmentBranchId: chosenBranch.id,
            invoiceId: invoice.id,
          },
        })
        if (flipped.count === 0) {
          throw new ApiError(409, 'INVALID_STATE', 'Order state moved concurrently; nothing was recorded.')
        }
        return tx.customerOrder.findUniqueOrThrow({ where: { id: order.id } })
      })

      await orderEvent(order.id, {
        type: 'ACCEPTED',
        actorSide: 'SUPPLIER',
        actorId: user.id,
        actorName: user.name,
        note: `Accepted: fulfilment from ${chosenBranch.name}. Invoice issued, payable within 7 days.`,
      })
      await notify({
        userId: order.buyerUserId,
        type: 'CUSTOMER_ORDER_ACCEPTED',
        title: `Order ${order.refCode} accepted`,
        body: `${order.supplier.name} accepted your order (KES ${(order.totalMinor / 100).toLocaleString()}). An invoice is ready: pay it from Account → Orders.`,
        link: '/account?tab=orders',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTOMER_ORDER_ACCEPTED', targetType: 'CUSTOMER_ORDER', targetId: order.id, metadata: { ref: order.refCode, branchId: chosenBranch.id } })

      return ok({ order: { id: updated.id, refCode: updated.refCode, status: updated.status }, message: 'Order accepted. The customer has been notified and an invoice issued.' })
    }

    // ── Supplier: reject ────────────────────────────────────────────────
    case 'reject': {
      if (order.status !== 'SUBMITTED') {
        return fail(409, 'INVALID_STATE', `This order is ${order.status}. Only orders awaiting acceptance can be rejected.`)
      }
      await db.customerOrder.update({
        where: { id: order.id },
        data: { status: 'REJECTED', rejectedReason: body.reason },
      })
      await orderEvent(order.id, { type: 'REJECTED', actorSide: 'SUPPLIER', actorId: user.id, actorName: user.name, note: body.reason })
      await notify({
        userId: order.buyerUserId,
        type: 'CUSTOMER_ORDER_REJECTED',
        title: `Order ${order.refCode} was rejected`,
        body: `${order.supplier.name}: ${body.reason}`,
        link: '/account?tab=orders',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTOMER_ORDER_REJECTED', targetType: 'CUSTOMER_ORDER', targetId: order.id, metadata: { ref: order.refCode, reason: body.reason } })

      return ok({ order: { id: order.id, refCode: order.refCode, status: 'REJECTED' }, message: 'Order rejected. The customer has been notified.' })
    }

    // ── Supplier: dispatch ──────────────────────────────────────────────
    case 'dispatch': {
      if (!['ACCEPTED', 'CONFIRMED'].includes(order.status)) {
        return fail(409, 'INVALID_STATE', `Orders can be dispatched once accepted: this order is ${order.status}.`)
      }
      const code = sixDigitCode()
      const updated = await db.customerOrder.update({
        where: { id: order.id },
        data: {
          status: 'DISPATCHED',
          courierName: body.courierName,
          otpHash: bcrypt.hashSync(code, 10),
          otpHint: code.slice(-4),
          // Absolute TTL: the collection code is valid for 72 hours from
          // dispatch; a code that outlives the delivery window is dead.
          otpExpiresAt: new Date(Date.now() + ORDER_CODE_TTL_MS),
        },
      })
      await orderEvent(order.id, {
        type: 'DISPATCHED',
        actorSide: 'SUPPLIER',
        actorId: user.id,
        actorName: user.name,
        note: `Dispatched via ${body.courierName}. Collection code sent to the customer.`,
      })
      // The full collection code is delivered to the buyer through their in-app
      // notifications: the only channel that actually exists on this deployment.
      await notify({
        userId: order.buyerUserId,
        type: 'CUSTOMER_ORDER_DISPATCHED',
        title: `Order ${order.refCode} dispatched`,
        body: `Your order ${order.refCode} has been dispatched by ${body.courierName}. Share this collection code with the courier: ${code}`,
        link: '/account?tab=orders',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTOMER_ORDER_DISPATCHED', targetType: 'CUSTOMER_ORDER', targetId: order.id, metadata: { ref: order.refCode, courier: body.courierName } })

      return ok({ order: { id: updated.id, refCode: updated.refCode, status: updated.status }, message: 'Marked dispatched. The collection code was sent to the customer\'s notifications.' })
    }

    // ── Supplier: mark delivered ────────────────────────────────────────
    case 'delivered': {
      if (order.status !== 'DISPATCHED') {
        return fail(409, 'INVALID_STATE', `Only dispatched orders can be marked delivered; this order is ${order.status}.`)
      }
      // Brute-force guard on the buyer's 6-digit collection code.
      const rl = rateLimit(`order-code:${order.id}:${user.id}`, 5, 10 * 60 * 1000)
      if (!rl.allowed) {
        return fail(429, 'RATE_LIMITED', `Too many verification attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
      }
      // Absolute expiry on the collection code.
      if (order.otpExpiresAt && order.otpExpiresAt.getTime() < Date.now()) {
        return fail(403, 'CODE_EXPIRED', 'This collection code has expired (72-hour validity from dispatch). Contact support to re-issue it.')
      }
      if (!order.otpHash || !bcrypt.compareSync(body.code, order.otpHash)) {
        throw new ApiError(403, 'INVALID_CODE', 'That collection code does not match. Ask the customer for the code from their notification.')
      }
      const now = new Date()
      await db.customerOrder.update({
        where: { id: order.id },
        data: { status: 'DELIVERED', deliveredAt: now },
      })
      await orderEvent(order.id, { type: 'DELIVERED', actorSide: 'SUPPLIER', actorId: user.id, actorName: user.name, note: 'Delivered: collection code verified.' })
      await notify({
        userId: order.buyerUserId,
        type: 'CUSTOMER_ORDER_DELIVERED',
        title: `Order ${order.refCode} delivered`,
        body: 'Please confirm receipt from Account → Orders once you have checked the items.',
        link: '/account?tab=orders',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTOMER_ORDER_DELIVERED', targetType: 'CUSTOMER_ORDER', targetId: order.id, metadata: { ref: order.refCode } })

      return ok({ order: { id: order.id, refCode: order.refCode, status: 'DELIVERED' }, message: 'Marked delivered. The customer has been asked to confirm receipt.' })
    }

    // ── Buyer: confirm receipt ──────────────────────────────────────────
    case 'confirm': {
      if (order.status !== 'DELIVERED') {
        return fail(409, 'INVALID_STATE', `You can confirm receipt once the order is delivered; it is currently ${order.status}.`)
      }
      const now = new Date()
      await db.customerOrder.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', completedAt: now },
      })
      await orderEvent(order.id, { type: 'COMPLETED', actorSide: 'CUSTOMER', actorId: user.id, actorName: user.name, note: 'Customer confirmed receipt.' })
      await notifySupplierMembers(order.supplierOrgId, {
        type: 'CUSTOMER_ORDER_COMPLETED',
        title: `Order ${order.refCode} completed`,
        body: `${user.name} confirmed receipt. The order is complete.`,
        link: '/supplier?tab=consumer-orders',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTOMER_ORDER_COMPLETED', targetType: 'CUSTOMER_ORDER', targetId: order.id, metadata: { ref: order.refCode } })

      return ok({ order: { id: order.id, refCode: order.refCode, status: 'COMPLETED' }, message: 'Receipt confirmed. Thanks!' })
    }

    // ── Buyer: cancel ───────────────────────────────────────────────────
    case 'cancel': {
      if (order.status !== 'SUBMITTED') {
        return fail(409, 'INVALID_STATE', 'Orders can only be cancelled while awaiting the supplier\'s response. Contact the supplier for anything already accepted.')
      }
      await db.customerOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      })
      await orderEvent(order.id, { type: 'CANCELLED', actorSide: 'CUSTOMER', actorId: user.id, actorName: user.name, note: 'Customer cancelled before acceptance.' })
      await notifySupplierMembers(order.supplierOrgId, {
        type: 'CUSTOMER_ORDER_CANCELLED',
        title: `Order ${order.refCode} cancelled`,
        body: `${user.name} cancelled the order before you responded.`,
        link: '/supplier?tab=consumer-orders',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTOMER_ORDER_CANCELLED', targetType: 'CUSTOMER_ORDER', targetId: order.id, metadata: { ref: order.refCode } })

      return ok({ order: { id: order.id, refCode: order.refCode, status: 'CANCELLED' }, message: 'Order cancelled.' })
    }

    // ── Buyer: open a dispute ─────────────────────────────────────────
    case 'dispute': {
      if (!['DELIVERED', 'COMPLETED'].includes(order.status)) {
        return fail(409, 'INVALID_STATE', `Disputes can be opened on delivered or completed orders; this order is ${order.status}. For orders still in progress, contact the supplier via the order thread or support.`)
      }
      const existing = await db.dispute.findFirst({ where: { customerOrderId: order.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } } })
      if (existing) {
        return fail(409, 'DISPUTE_EXISTS', `This order already has an open dispute (${existing.refCode}). Our disputes team is on it.`)
      }
      const dispute = await db.$transaction(async (tx) => {
        const d = await tx.dispute.create({
          data: {
            refCode: refCode('DSP', 6),
            customerOrderId: order.id,
            openedById: user.id,
            openedBySide: 'CUSTOMER',
            reason: body.reason,
            details: body.details,
            status: 'OPEN',
            amountFrozenMinor: order.paymentStatus === 'PAID' ? order.totalMinor : null,
            events: { create: { type: 'CREATED', actorId: user.id, actorName: user.name, note: `Dispute opened by the customer: ${body.reason}. ${body.details}` } },
          },
        })
        await tx.customerOrder.update({ where: { id: order.id }, data: { status: 'DISPUTED' } })
        await tx.customerOrderEvent.create({
          data: { orderId: order.id, type: 'DISPUTED', actorSide: 'CUSTOMER', actorId: user.id, actorName: user.name, note: `Dispute ${d.refCode} opened (${body.reason}).` },
        })
        return d
      })
      await notifySupplierMembers(order.supplierOrgId, {
        type: 'CUSTOMER_ORDER_DISPUTED',
        title: `Dispute ${dispute.refCode} opened on order ${order.refCode}`,
        body: `${user.name} reported: ${body.reason.toLowerCase().replace('_', ' ')}. Respond honestly and promptly: our disputes team reviews every case.`,
        link: '/supplier?tab=consumer-orders',
      })
      const staff = await db.user.findMany({
        where: { AND: [{ status: 'ACTIVE' }, { OR: [{ roles: { contains: 'MODERATOR' } }, { roles: { contains: 'ADMIN' } }, { roles: { contains: 'FOUNDER' } }] }] },
        select: { id: true },
      })
      await notifyMany(staff.map((s) => s.id), {
        type: 'DISPUTE_OPENED',
        title: `Consumer dispute ${dispute.refCode}: ${order.refCode}`,
        body: `${body.reason} on order ${order.refCode} from ${order.supplier.name}. Review in the supply console.`,
        link: '/admin?tab=supply',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTOMER_ORDER_DISPUTED', targetType: 'DISPUTE', targetId: dispute.id, metadata: { ref: dispute.refCode, order: order.refCode, reason: body.reason } })

      return ok({ order: { id: order.id, refCode: order.refCode, status: 'DISPUTED' }, dispute: { refCode: dispute.refCode }, message: 'Dispute opened. Our disputes team has been notified: you will see the outcome here.' })
    }
  }
})

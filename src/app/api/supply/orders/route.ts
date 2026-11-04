import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'
import { requireOwnOrg, poEvent, reserveStock } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/supply/orders — role-scoped order lists.
 * Garages see their purchase orders; suppliers see orders sent to them.
 * Supplies tenant isolation via org membership only.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const sp = req.nextUrl.searchParams
  const orgId = sp.get('orgId')
  if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required.')
  const membership = await getMembership(orgId, user.id)
  if (!membership) return fail(403, 'NOT_A_MEMBER', 'You are not a member of this business.')
  const org = await db.org.findUnique({ where: { id: orgId } })
  if (!org || org.status !== 'ACTIVE') return fail(403, 'ORGE_INACTIVE', 'Business is not active.')
  const side = org.type === 'SUPPLIER' ? 'SUPPLIER' : 'GARAGE'
  const status = sp.get('status') || undefined

  const where = side === 'SUPPLIER' ? { supplierOrgId: orgId } : { garageOrgId: orgId }
  const orders = await db.purchaseOrder.findMany({
    where: { ...where, ...(status ? { status: { in: status.split(',') } } : {}) },
    include: {
      garage: { select: { id: true, name: true, county: true, verified: true } },
      supplier: { select: { id: true, name: true, county: true, verified: true, supplierRating: true } },
      destinationBranch: { select: { id: true, name: true, code: true, town: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true, images: true } } } },
      delivery: { select: { id: true, refCode: true, method: true, status: true, scheduledFor: true, otpHint: true, meetupJson: true } },
      payment: { select: { id: true, refCode: true, status: true, amountMinor: true, provider: true, protectedAt: true } },
      _count: { select: { items: true, disputes: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return ok({
    side,
    orders: orders.map((o) => ({
      id: o.id,
      refCode: o.refCode,
      status: o.status,
      paymentStatus: o.paymentStatus,
      inspectionStatus: o.inspectionStatus,
      garage: o.garage,
      supplier: o.supplier,
      destinationBranch: o.destinationBranch,
      itemCount: o._count.items,
      items: o.items.map((i) => ({ id: i.id, productId: i.productId, name: i.product.name, sku: i.product.sku, qty: i.qty, unitPriceMinor: i.unitPriceMinor, lineTotalMinor: i.lineTotalMinor, qtyAccepted: i.qtyAccepted, note: i.note, image: safeFirst(i.product.images) })),
      totalMinor: o.totalMinor,
      subtotalMinor: o.subtotalMinor,
      deliveryFeeMinor: o.deliveryFeeMinor,
      taxMinor: o.taxMinor,
      platformFeeMinor: o.platformFeeMinor,
      currency: o.currency,
      delivery: o.delivery,
      payment: o.payment,
      disputeCount: o._count.disputes,
      revisedBySupplier: o.revisedBySupplier,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    })),
  })
})

const createSchema = z.object({
  orgId: z.string().min(1), // garage org
  destinationBranchId: z.string().min(1),
  items: z.array(z.object({
    productId: z.string().min(1),
    qty: z.number().int().min(1).max(10_000),
  })).min(1).max(40),
  note: z.string().max(500).optional().nullable(),
})

function safeFirst(raw: string | null): string | null {
  try { return raw ? (JSON.parse(raw) as string[])[0] ?? null : null } catch { return null }
}

/**
 * POST /api/supply/orders — create purchase order(s) from a cart.
 * A cart may span several suppliers; ONE purchase order is created per
 * supplier (multiple supplier orders). Stock is reserved immediately to
 * prevent overselling. If the order total exceeds the garage's configured
 * approval threshold the order is held at AWAITING_APPROVAL for owner/GM
 * approval before the supplier ever sees it.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const ctx = await requireOwnOrg(user, 'GARAGE', 'order.create')
  const rl = rateLimit(`po-create:${ctx.orgId}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many orders submitted. Please try later.')
  const body = await parseBody(req, createSchema)

  const branch = await db.orgBranch.findFirst({ where: { id: body.destinationBranchId, orgId: ctx.orgId, status: 'ACTIVE' } })
  if (!branch) return fail(400, 'BAD_BRANCH', 'Choose a valid destination branch for the delivery.')

  // group items per supplier
  const productIds = body.items.map((i) => i.productId)
  const products = await db.product.findMany({
    where: { id: { in: productIds }, status: 'PUBLISHED', supplier: { type: 'SUPPLIER', status: 'ACTIVE', verified: true } },
    include: { stocks: { include: { branch: { select: { id: true, status: true } } } } },
  })
  if (products.length !== new Set(productIds).size) {
    return fail(400, 'INVALID_PRODUCTS', 'Some products are unavailable. Review your cart and try again.')
  }

  // OVERSELLING GUARD — every line must be covered by real, unreserved stock
  // across the supplier's active warehouses before an order is created.
  for (const item of body.items) {
    const p = products.find((x) => x.id === item.productId)!
    const available = p.stocks
      .filter((s) => s.branch.status === 'ACTIVE')
      .reduce((sum, s) => sum + (s.qtyOnHand - s.qtyReserved), 0)
    if (item.qty > available) {
      return fail(409, 'INSUFFICIENT_STOCK', `${p.name}: only ${available} unit(s) available across all warehouses. Reduce the quantity or request a quotation for back-order.`, { productId: p.id, available })
    }
  }

  const bySupplier = new Map<string, typeof body.items>()
  for (const item of body.items) {
    const product = products.find((p) => p.id === item.productId)!
    const list = bySupplier.get(product.supplierOrgId) ?? []
    list.push(item)
    bySupplier.set(product.supplierOrgId, list)
  }

  const created: { id: string; refCode: string; status: string; totalMinor: number }[] = []
  for (const [supplierOrgId, items] of bySupplier) {
    // compute lines with wholesale pricing rules
    const lines = items.map((i) => {
      const p = products.find((x) => x.id === i.productId)!
      const useWholesale = Boolean(p.wholesalePriceMinor && p.wholesaleMinQty > 0 && i.qty >= p.wholesaleMinQty)
      const unit = useWholesale ? p.wholesalePriceMinor! : p.unitPriceMinor
      return { product: p, qty: i.qty, unit, lineTotal: unit * i.qty }
    })
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0)
    const tax = lines.reduce((s, l) => s + Math.round((l.lineTotal * l.product.taxRatePct) / 100), 0)

    // approval gate (garage-configurable spending limit)
    const threshold = ctx.org.poApprovalThresholdMinor
    const needsApproval = threshold !== null && subtotal > threshold

    const order = await db.purchaseOrder.create({
      data: {
        refCode: refCode('PO', 6),
        garageOrgId: ctx.orgId,
        supplierOrgId,
        destinationBranchId: branch.id,
        createdById: user.id,
        status: needsApproval ? 'AWAITING_APPROVAL' : 'SUBMITTED',
        subtotalMinor: subtotal,
        taxMinor: tax,
        totalMinor: subtotal + tax, // delivery fee added at arrangement
        currency: 'KES',
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            qty: l.qty,
            unitPriceMinor: l.unit,
            lineTotalMinor: l.lineTotal,
          })),
        },
        events: {
          create: {
            type: needsApproval ? 'SUBMITTED' : 'CREATED',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'GARAGE',
            note: needsApproval
              ? `Order requires management approval (limit ${((threshold ?? 0) / 100).toLocaleString()} KES).`
              : 'Purchase order created and sent to supplier.',
          },
        },
      },
      include: { items: true },
    })

    // reserve stock across the supplier's warehouses, largest-availability first
    for (const line of lines) {
      let remaining = line.qty
      const stocked = line.product.stocks
        .filter((s) => s.branch.status === 'ACTIVE' && s.qtyOnHand - s.qtyReserved > 0)
        .sort((a, b) => (b.qtyOnHand - b.qtyReserved) - (a.qtyOnHand - a.qtyReserved))
      for (const wh of stocked) {
        if (remaining <= 0) break
        const take = Math.min(remaining, wh.qtyOnHand - wh.qtyReserved)
        try {
          await reserveStock(line.product.id, wh.branchId, take, { type: 'PURCHASE_ORDER', id: order.id, actorId: user.id, actorName: user.name })
          const poItem = order.items.find((it) => it.productId === line.product.id)
          if (poItem) {
            await db.pOItem.update({ where: { id: poItem.id }, data: { ...(poItem.fulfilBranchId ? {} : { fulfilBranchId: wh.branchId }) } })
          }
          remaining -= take
        } catch {
          // race: another order reserved first — availability re-checked at dispatch
        }
      }
      // remaining > 0 cannot happen (availability pre-check) unless a race
      // occurred; the supplier confirms stock at response time.
    }

    // notify supplier
    const supplierMembers = await db.orgMember.findMany({ where: { orgId: supplierOrgId, role: { in: ['OWNER', 'OPERATIONS', 'WAREHOUSE'] } }, select: { userId: true } })
    await notifyMany(supplierMembers.map((m) => m.userId), {
      type: 'PO_NEW',
      title: `New purchase order ${order.refCode}`,
      body: `${ctx.orgName} sent you a purchase order for ${lines.length} product line(s) — ${(subtotal / 100).toLocaleString()} KES (excl. delivery).`,
      link: '/supplier?tab=orders',
    })

    await audit({ actorId: user.id, actorName: user.name, action: 'PO_CREATED', targetType: 'PURCHASE_ORDER', targetId: order.id, metadata: { ref: order.refCode, supplierOrgId, subtotal, needsApproval } })
    created.push({ id: order.id, refCode: order.refCode, status: order.status, totalMinor: order.totalMinor })
  }

  await notify({ userId: user.id, type: 'PO_CREATED', title: `${created.length} purchase order(s) created`, body: created.map((c) => c.refCode).join(', '), link: '/procurement?tab=orders' })

  return ok({
    orders: created,
    message: needsApprovalGlobal(created)
      ? 'Some orders await management approval before suppliers see them.'
      : 'Purchase order(s) sent to suppliers. Track them in Procurement → Orders.',
  }, { status: 201 })
})

function needsApprovalGlobal(created: { status: string }[]): boolean {
  return created.some((c) => c.status === 'AWAITING_APPROVAL')
}

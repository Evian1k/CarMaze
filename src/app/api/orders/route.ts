import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, requireUser, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// ───────────────────────────── Constants ─────────────────────────────

/** Flat nationwide courier fee for DIRECT delivery (KES 250 in minor units). */
const DIRECT_DELIVERY_FEE_MINOR = 25_000
/** Supplier roles that receive new consumer-order notifications. */
const SUPPLIER_NOTIFY_ROLES = ['OWNER', 'OPERATIONS', 'WAREHOUSE', 'SALES']

// ───────────────────────────── Helpers ─────────────────────────────

function safeFirstImage(raw: string | null): string | null {
  try {
    return raw ? (JSON.parse(raw) as string[])[0] ?? null : null
  } catch {
    return null
  }
}

// ───────────────────────────── GET ─────────────────────────────

/**
 * GET /api/orders — consumer parts orders.
 *  - ?scope=supplier&orgId=X → supplier member view (orders sent to that org)
 *    with counts by status. Membership + org type are verified server-side.
 *  - default → the caller's own orders as a buyer.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const sp = req.nextUrl.searchParams

  if (sp.get('scope') === 'supplier') {
    const orgId = sp.get('orgId')
    if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required for the supplier scope.')

    const membership = await db.orgMember.findFirst({ where: { orgId, userId: user.id } })
    if (!membership) return fail(403, 'NOT_A_MEMBER', 'You are not a member of this business.')
    const org = await db.org.findUnique({ where: { id: orgId } })
    if (!org) return fail(404, 'NOT_FOUND', 'Business not found.')
    if (org.type !== 'SUPPLIER') return fail(403, 'NOT_A_SUPPLIER', 'This view is only available to supplier businesses.')
    if (org.status !== 'ACTIVE') return fail(403, 'ORG_INACTIVE', 'This business is not active.')

    const orders = await db.customerOrder.findMany({
      where: { supplierOrgId: orgId },
      include: {
        buyer: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, images: true } } } },
        invoice: { select: { id: true, refCode: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const grouped = await db.customerOrder.groupBy({
      by: ['status'],
      where: { supplierOrgId: orgId },
      _count: { _all: true },
    })
    const counts: Record<string, number> = {}
    for (const g of grouped) counts[g.status] = g._count._all

    return ok({
      side: 'SUPPLIER',
      counts,
      orders: orders.map((o) => ({
        id: o.id,
        refCode: o.refCode,
        status: o.status,
        paymentStatus: o.paymentStatus,
        buyer: o.buyer,
        deliveryMethod: o.deliveryMethod,
        county: o.county,
        address: o.address,
        phone: o.phone,
        notes: o.notes,
        courierName: o.courierName,
        fulfillmentBranchId: o.fulfillmentBranchId,
        rejectedReason: o.rejectedReason,
        itemCount: o.items.length,
        items: o.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          name: i.product.name,
          sku: i.product.sku,
          qty: i.qty,
          unitPriceMinor: i.unitPriceMinor,
          lineTotalMinor: i.lineTotalMinor,
          image: safeFirstImage(i.product.images),
        })),
        deliveryFeeMinor: o.deliveryFeeMinor,
        totalMinor: o.totalMinor,
        currency: o.currency,
        invoice: o.invoice,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
    })
  }

  // Default — the caller's own orders as a buyer.
  const orders = await db.customerOrder.findMany({
    where: { buyerUserId: user.id },
    include: {
      supplier: { select: { id: true, name: true, county: true, verified: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true, images: true } } } },
      invoice: { select: { id: true, refCode: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return ok({
    orders: orders.map((o) => ({
      id: o.id,
      refCode: o.refCode,
      status: o.status,
      paymentStatus: o.paymentStatus,
      supplier: o.supplier,
      deliveryMethod: o.deliveryMethod,
      county: o.county,
      address: o.address,
      phone: o.phone,
      notes: o.notes,
      courierName: o.courierName,
      otpHint: o.otpHint,
      rejectedReason: o.rejectedReason,
      deliveredAt: o.deliveredAt,
      completedAt: o.completedAt,
      itemCount: o.items.length,
      items: o.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        name: i.product.name,
        sku: i.product.sku,
        qty: i.qty,
        unitPriceMinor: i.unitPriceMinor,
        lineTotalMinor: i.lineTotalMinor,
        image: safeFirstImage(i.product.images),
      })),
      deliveryFeeMinor: o.deliveryFeeMinor,
      totalMinor: o.totalMinor,
      currency: o.currency,
      invoice: o.invoice,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    })),
  })
})

// ───────────────────────────── POST (customer creates) ─────────────────────────────

const phoneLoose = /^(\+?254|0)\d{9}$/ // 0712345678 / 254712345678 / +254712345678

const createSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    qty: z.number().int().min(1).max(99),
  })).min(1).max(40),
  county: z.string().trim().min(3).max(60),
  address: z.string().trim().min(5).max(300),
  phone: z.string().trim().regex(phoneLoose, 'Enter a valid Kenyan phone number (e.g. 0712 345 678)'),
  notes: z.string().trim().max(500).optional(),
  deliveryMethod: z.enum(['DIRECT', 'COLLECTION']).default('DIRECT'),
})

/**
 * POST /api/orders — a signed-in customer orders parts from verified suppliers.
 * A cart may span several suppliers: ONE order is created per supplier.
 * Prices ALWAYS come from product.unitPriceMinor (never the client). Stock is
 * checked per item (a single branch must cover the line) but NOT decremented —
 * stock leaves the shelf when the supplier accepts the order.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`co-create:${user.id}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many orders submitted. Please try again later.')

  const body = await parseBody(req, createSchema)

  const productIds = body.items.map((i) => i.productId)
  if (new Set(productIds).size !== productIds.length) {
    return fail(400, 'DUPLICATE_ITEMS', 'Each product can appear only once — merge duplicate lines into one quantity.')
  }
  const products = await db.product.findMany({
    where: {
      id: { in: productIds },
      status: 'PUBLISHED',
      supplier: { type: 'SUPPLIER', status: 'ACTIVE', verified: true },
    },
    include: {
      supplier: { select: { name: true } },
      stocks: { include: { branch: { select: { id: true, status: true } } } },
    },
  })
  if (products.length !== new Set(productIds).size) {
    return fail(400, 'INVALID_PRODUCTS', 'Some products are unavailable. Review your order and try again.')
  }

  // Overselling guard — each line must be covered by unreserved stock at a
  // SINGLE branch (the supplier fulfils from one branch when accepting).
  for (const item of body.items) {
    const p = products.find((x) => x.id === item.productId)!
    const bestBranch = p.stocks
      .filter((s) => s.branch.status === 'ACTIVE')
      .reduce((max, s) => Math.max(max, s.qtyOnHand - s.qtyReserved), 0)
    if (item.qty > bestBranch) {
      return fail(409, 'INSUFFICIENT_STOCK', `${p.name}: only ${bestBranch} unit(s) available at a single warehouse. Reduce the quantity or try again later.`, { productId: p.id, available: bestBranch })
    }
  }

  // Group items per supplier — one order per supplier.
  const bySupplier = new Map<string, typeof body.items>()
  for (const item of body.items) {
    const product = products.find((p) => p.id === item.productId)!
    const list = bySupplier.get(product.supplierOrgId) ?? []
    list.push(item)
    bySupplier.set(product.supplierOrgId, list)
  }

  const created: { id: string; refCode: string; status: string; totalMinor: number; currency: string; supplierOrgId: string; supplierName: string }[] = []

  for (const [supplierOrgId, items] of bySupplier) {
    const lines = items.map((i) => {
      const p = products.find((x) => x.id === i.productId)!
      return { product: p, qty: i.qty, unit: p.unitPriceMinor, lineTotal: p.unitPriceMinor * i.qty }
    })
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0)
    const deliveryFeeMinor = body.deliveryMethod === 'COLLECTION' ? 0 : DIRECT_DELIVERY_FEE_MINOR
    const totalMinor = subtotal + deliveryFeeMinor
    const supplierName = products.find((p) => p.supplierOrgId === supplierOrgId)!.supplier.name

    const order = await db.$transaction(async (tx) =>
      tx.customerOrder.create({
        data: {
          refCode: refCode('COR', 6),
          buyerUserId: user.id,
          supplierOrgId,
          status: 'SUBMITTED',
          county: body.county,
          address: body.address,
          phone: body.phone,
          notes: body.notes ?? null,
          deliveryMethod: body.deliveryMethod,
          deliveryFeeMinor,
          totalMinor,
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
              type: 'CREATED',
              actorSide: 'CUSTOMER',
              actorId: user.id,
              actorName: user.name,
              note: body.deliveryMethod === 'COLLECTION'
                ? 'Order placed — customer will collect from the supplier.'
                : 'Order placed — delivery to the customer requested.',
            },
          },
        },
        include: { items: true },
      })
    )

    created.push({ id: order.id, refCode: order.refCode, status: order.status, totalMinor: order.totalMinor, currency: order.currency, supplierOrgId, supplierName })

    // Notify the supplier's operations-side members.
    const members = await db.orgMember.findMany({
      where: { orgId: supplierOrgId, role: { in: SUPPLIER_NOTIFY_ROLES } },
      select: { userId: true },
    })
    await notifyMany(members.map((m) => m.userId), {
      type: 'CUSTOMER_ORDER_NEW',
      title: `New consumer order ${order.refCode}`,
      body: `${user.name} ordered ${lines.length} product line(s) — KES ${(totalMinor / 100).toLocaleString()} (${body.deliveryMethod === 'COLLECTION' ? 'customer collection' : 'delivery'}).`,
      link: '/supplier?tab=consumer-orders',
    })

    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'CUSTOMER_ORDER_CREATED',
      targetType: 'CUSTOMER_ORDER',
      targetId: order.id,
      metadata: { ref: order.refCode, supplierOrgId, totalMinor, deliveryMethod: body.deliveryMethod },
    })
  }

  return ok({
    orders: created,
    message: created.length > 1
      ? `${created.length} orders placed — one per supplier. Track them in Account → Orders.`
      : 'Order placed. Track it in Account → Orders.',
  }, { status: 201 })
})

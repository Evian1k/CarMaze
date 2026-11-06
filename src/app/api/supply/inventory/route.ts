import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireOrgMember } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/supply/inventory?orgId=&productId=&branchId=: stock levels for a
 * supplier's own warehouses (tenant isolated). Garages see only aggregated
 * availability through the catalogue/product detail endpoints.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgId = req.nextUrl.searchParams.get('orgId')
  if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required.')
  await requireOrgMember(user, orgId, 'stock.read')
  const productId = req.nextUrl.searchParams.get('productId') || undefined
  const branchId = req.nextUrl.searchParams.get('branchId') || undefined

  const rows = await db.productStock.findMany({
    where: { branch: { orgId, ...(branchId ? { id: branchId } : {}) }, ...(productId ? { productId } : {}) },
    include: {
      product: { select: { id: true, name: true, sku: true, refCode: true, unitPriceMinor: true, wholesalePriceMinor: true } },
      branch: { select: { id: true, name: true, code: true, kind: true, status: true } },
    },
    orderBy: { product: { name: 'asc' } },
    take: 500,
  })
  // low stock = at or below reorder level
  return ok({
    inventory: rows.map((r) => ({
      id: r.id, productId: r.productId, productName: r.product.name, sku: r.product.sku,
      refCode: r.product.refCode, unitPriceMinor: r.product.unitPriceMinor,
      branchId: r.branchId, branchName: r.branch.name, branchCode: r.branch.code, branchKind: r.branch.kind,
      qtyOnHand: r.qtyOnHand, qtyReserved: r.qtyReserved, available: r.qtyOnHand - r.qtyReserved,
      reorderLevel: r.reorderLevel, low: r.qtyOnHand - r.qtyReserved <= r.reorderLevel,
    })),
  })
})

const adjustSchema = z.object({
  orgId: z.string().min(1),
  productId: z.string().min(1),
  branchId: z.string().min(1),
  setQtyOnHand: z.number().int().min(0).optional(), // absolute set (restock/adjust)
  reorderLevel: z.number().int().min(0).optional(),
  note: z.string().max(300).optional(),
})

/**
 * POST: restock/adjust inventory. Writes a StockMovement audit row for every
 * change. Reservations are never touched here (they belong to live orders).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, adjustSchema)
  await requireOrgMember(user, body.orgId, 'stock.write')

  const product = await db.product.findFirst({ where: { id: body.productId, supplierOrgId: body.orgId } })
  if (!product) return fail(404, 'PRODUCT_NOT_FOUND', 'Product does not belong to your business.')
  const branch = await db.orgBranch.findFirst({ where: { id: body.branchId, orgId: body.orgId } })
  if (!branch) return fail(404, 'BRANCH_NOT_FOUND', 'Warehouse does not belong to your business.')

  const existing = await db.productStock.findUnique({ where: { productId_branchId: { productId: body.productId, branchId: body.branchId } } })
  const before = existing?.qtyOnHand ?? 0
  const after = body.setQtyOnHand ?? before

  const row = await db.productStock.upsert({
    where: { productId_branchId: { productId: body.productId, branchId: body.branchId } },
    create: { productId: body.productId, branchId: body.branchId, qtyOnHand: after, reorderLevel: body.reorderLevel ?? 0 },
    update: {
      ...(body.setQtyOnHand !== undefined ? { qtyOnHand: after } : {}),
      ...(body.reorderLevel !== undefined ? { reorderLevel: body.reorderLevel } : {}),
    },
  })
  if (after !== before) {
    await db.stockMovement.create({
      data: {
        branchId: body.branchId, productId: body.productId,
        delta: after - before, reason: after > before ? 'RESTOCK' : 'ADJUST',
        refType: 'MANUAL', note: body.note ?? `Stock ${after > before ? 'increased' : 'reduced'} from ${before} to ${after}`,
        actorId: user.id, actorName: user.name,
      },
    })
  }
  await audit({ actorId: user.id, actorName: user.name, action: 'STOCK_ADJUSTED', targetType: 'PRODUCT', targetId: body.productId, metadata: { branchId: body.branchId, before, after } })
  return ok({ stock: row })
})

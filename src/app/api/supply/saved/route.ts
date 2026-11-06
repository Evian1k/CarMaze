import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** GET /api/supply/saved: the requester's saved suppliers and products. */
export const GET = route(async () => {
  const user = await requireUser()
  const items = await db.savedSupplyItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  })
  const supplierIds = items.filter((i) => i.targetType === 'SUPPLIER').map((i) => i.targetId)
  const productIds = items.filter((i) => i.targetType === 'PRODUCT').map((i) => i.targetId)
  const [suppliers, products] = await Promise.all([
    supplierIds.length ? db.org.findMany({
      where: { id: { in: supplierIds }, type: 'SUPPLIER' },
      select: { id: true, name: true, county: true, town: true, logoUrl: true, verified: true, supplierRating: true },
    }) : [],
    productIds.length ? db.product.findMany({
      where: { id: { in: productIds }, status: 'PUBLISHED' },
      select: { id: true, name: true, sku: true, unitPriceMinor: true, currency: true, images: true, supplier: { select: { name: true } } },
    }) : [],
  ])
  return ok({
    suppliers: suppliers.map((s) => ({ ...s, image: s.logoUrl })),
    products: products.map((p) => ({ ...p, image: safeFirst(p.images) })),
  })
})

function safeFirst(raw: string | null): string | null {
  try { return raw ? (JSON.parse(raw) as string[])[0] ?? null : null } catch { return null }
}

const postSchema = z.object({
  targetType: z.enum(['SUPPLIER', 'PRODUCT']),
  targetId: z.string().min(1),
})

/** POST: save a supplier or product. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, postSchema)
  if (body.targetType === 'SUPPLIER') {
    const exists = await db.org.findFirst({ where: { id: body.targetId, type: 'SUPPLIER', status: 'ACTIVE' } })
    if (!exists) return fail(404, 'NOT_FOUND', 'Supplier not found.')
  } else {
    const exists = await db.product.findFirst({ where: { id: body.targetId, status: 'PUBLISHED' } })
    if (!exists) return fail(404, 'NOT_FOUND', 'Product not found.')
  }
  const saved = await db.savedSupplyItem.upsert({
    where: { userId_targetType_targetId: { userId: user.id, targetType: body.targetType, targetId: body.targetId } },
    create: { userId: user.id, targetType: body.targetType, targetId: body.targetId },
    update: {},
  })
  return ok({ saved }, { status: 201 })
})

/** DELETE ?targetType=&targetId=: unsave. */
export const DELETE = route(async (req: NextRequest) => {
  const user = await requireUser()
  const targetType = req.nextUrl.searchParams.get('targetType')
  const targetId = req.nextUrl.searchParams.get('targetId')
  if (!targetType || !targetId) return fail(400, 'BAD_REQUEST', 'targetType and targetId are required.')
  await db.savedSupplyItem.deleteMany({ where: { userId: user.id, targetType, targetId } })
  return ok({ deleted: true })
})

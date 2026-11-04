import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  productId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional().nullable(),
  orderId: z.string().optional().nullable(),
})

/**
 * POST /api/supply/reviews — review a product. Ratings come only from real
 * users; when an orderId is supplied the review is marked verifiedPurchase
 * after checking the order belongs to the author and contains the product
 * and was completed (COMPLETED / INSPECTED).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`product-review:${user.id}`, 10, 24 * 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many reviews recently.')
  const body = await parseBody(req, schema)

  const product = await db.product.findUnique({ where: { id: body.productId } })
  if (!product || product.status !== 'PUBLISHED') return fail(404, 'NOT_FOUND', 'Product not found.')

  let verified = false
  if (body.orderId) {
    const order = await db.purchaseOrder.findFirst({
      where: {
        id: body.orderId,
        supplierOrgId: product.supplierOrgId,
        createdById: user.id,
        status: { in: ['COMPLETED', 'INSPECTED'] },
        items: { some: { productId: body.productId } },
      },
    })
    verified = Boolean(order)
  }

  const existing = await db.productReview.findUnique({ where: { productId_authorId: { productId: body.productId, authorId: user.id } } })
  if (existing) return fail(409, 'ALREADY_REVIEWED', 'You already reviewed this product.')

  await db.productReview.create({
    data: { productId: body.productId, authorId: user.id, rating: body.rating, comment: body.comment ?? null, verifiedPurchase: verified, refOrderId: verified ? body.orderId ?? null : null },
  })
  const agg = await db.productReview.aggregate({ where: { productId: body.productId }, _avg: { rating: true }, _count: { rating: true } })
  await db.product.update({ where: { id: body.productId }, data: { ratingAvg: agg._avg.rating, ratingCount: agg._count.rating } })
  return ok({ message: 'Review recorded.', verifiedPurchase: verified }, { status: 201 })
})

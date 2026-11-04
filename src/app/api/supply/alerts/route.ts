import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireOwnOrg } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/** GET — garage stock alerts (procurement intelligence). */
export const GET = route(async () => {
  const user = await requireUser()
  const ctx = await requireOwnOrg(user, 'GARAGE')
  const alerts = await db.garageStockAlert.findMany({
    where: { garageOrgId: ctx.orgId },
    include: {
      product: {
        select: {
          id: true, name: true, sku: true, unitPriceMinor: true, currency: true, images: true,
          supplier: { select: { id: true, name: true, verified: true } },
          stocks: { select: { qtyOnHand: true, qtyReserved: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok({
    alerts: alerts.map((a) => {
      const available = a.product.stocks.reduce((s, x) => s + (x.qtyOnHand - x.qtyReserved), 0)
      return { id: a.id, minQty: a.minQty, active: a.active, product: { ...a.product, availableQty: available, image: safeFirst(a.product.images) } }
    }),
  })
})

const postSchema = z.object({
  productId: z.string().min(1),
  minQty: z.number().int().min(1).max(1000).default(1),
})

/** POST — create/update a low-stock alert for the garage. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const ctx = await requireOwnOrg(user, 'GARAGE', 'stock.write')
  const body = await parseBody(req, postSchema)
  const product = await db.product.findFirst({ where: { id: body.productId, status: 'PUBLISHED' } })
  if (!product) return fail(404, 'NOT_FOUND', 'Product not found.')
  const alert = await db.garageStockAlert.upsert({
    where: { garageOrgId_productId: { garageOrgId: ctx.orgId, productId: body.productId } },
    create: { garageOrgId: ctx.orgId, productId: body.productId, minQty: body.minQty },
    update: { minQty: body.minQty, active: true },
  })
  return ok({ alert }, { status: 201 })
})

/** DELETE ?productId= — remove alert. */
export const DELETE = route(async (req: NextRequest) => {
  const user = await requireUser()
  const ctx = await requireOwnOrg(user, 'GARAGE')
  const productId = req.nextUrl.searchParams.get('productId')
  if (!productId) return fail(400, 'BAD_REQUEST', 'productId is required.')
  await db.garageStockAlert.deleteMany({ where: { garageOrgId: ctx.orgId, productId } })
  return ok({ deleted: true })
})

function safeFirst(raw: string | null): string | null {
  try { return raw ? (JSON.parse(raw) as string[])[0] ?? null : null } catch { return null }
}

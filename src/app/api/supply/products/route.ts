import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { requireOwnOrg, jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z.string().trim().min(3).max(140),
  sku: z.string().trim().min(2).max(40),
  mpn: z.string().trim().max(60).optional().nullable(),
  oemRef: z.string().trim().max(60).optional().nullable(),
  brand: z.string().trim().max(60).optional().nullable(),
  categoryId: z.string().min(1),
  description: z.string().trim().min(10).max(4000),
  condition: z.enum(['NEW', 'REFURBISHED', 'USED']),
  unitPriceMinor: z.number().int().min(100).max(1_000_000_000),
  wholesalePriceMinor: z.number().int().min(0).optional().nullable(),
  wholesaleMinQty: z.number().int().min(0).max(10_000).default(0),
  taxRatePct: z.number().min(0).max(50).default(0),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
  returnable: z.boolean().default(false),
  images: z.array(z.string().max(300)).max(8).default([]),
  tags: z.array(z.string().max(40)).max(12).default([]),
  vehicleMakes: z.array(z.string().max(40)).max(30).default([]),
  batchTracked: z.boolean().default(false),
  serialTracked: z.boolean().default(false),
  provenanceNote: z.string().max(1000).optional().nullable(),
  publish: z.boolean().default(false),
})

/**
 * GET /api/supply/products: supplier's own catalogue (tenant-isolated).
 * POST: create a product (SUPPLIER business, catalogue.write permission).
 * Provenance notes are supplier-supplied evidence only; authenticityVerified
 * is NEVER settable here: only platform admins can verify authenticity.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const ctx = await requireOwnOrg(user, 'SUPPLIER', 'catalogue.read')
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') || undefined
  const q = sp.get('q')?.trim()
  const products = await db.product.findMany({
    where: {
      supplierOrgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { mpn: { contains: q } }] } : {}),
    },
    include: {
      category: { select: { slug: true, name: true } },
      stocks: { select: { branchId: true, qtyOnHand: true, qtyReserved: true } },
      _count: { select: { poItems: true, reviews: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return ok({
    products: products.map((p) => ({
      ...p,
      images: jsonParse<string[]>(p.images, []),
      tags: jsonParse<string[]>(p.tags, []),
      vehicleMakes: jsonParse<string[]>(p.vehicleMakes, []),
    })),
  })
})

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const ctx = await requireOwnOrg(user, 'SUPPLIER', 'catalogue.write')
  const rl = rateLimit(`product-create:${ctx.orgId}`, 100, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many product changes. Try later.')
  const body = await parseBody(req, createSchema)

  const category = await db.productCategory.findUnique({ where: { id: body.categoryId } })
  if (!category || !category.active) return fail(400, 'BAD_CATEGORY', 'Choose a valid product category.')

  const dup = await db.product.findUnique({ where: { supplierOrgId_sku: { supplierOrgId: ctx.orgId, sku: body.sku } } })
  if (dup) return fail(409, 'SKU_EXISTS', 'You already have a product with this SKU.')

  const product = await db.product.create({
    data: {
      refCode: refCode('PRD', 6),
      supplierOrgId: ctx.orgId,
      categoryId: body.categoryId,
      name: body.name,
      sku: body.sku,
      mpn: body.mpn ?? null,
      oemRef: body.oemRef ?? null,
      brand: body.brand ?? null,
      description: body.description,
      condition: body.condition,
      unitPriceMinor: body.unitPriceMinor,
      wholesalePriceMinor: body.wholesalePriceMinor || null,
      wholesaleMinQty: body.wholesaleMinQty,
      taxRatePct: body.taxRatePct,
      warrantyMonths: body.warrantyMonths,
      returnable: body.returnable,
      images: JSON.stringify(body.images),
      tags: JSON.stringify(body.tags),
      vehicleMakes: JSON.stringify(body.vehicleMakes),
      batchTracked: body.batchTracked,
      serialTracked: body.serialTracked,
      provenance: body.provenanceNote ? JSON.stringify({ provenanceNote: body.provenanceNote, authenticator: null }) : null,
      status: body.publish ? 'PUBLISHED' : 'DRAFT',
      priceHistory: { create: { priceMinor: body.unitPriceMinor, reason: 'LIST' } },
    },
  })
  await audit({
    actorId: user.id, actorName: user.name,
    action: 'PRODUCT_CREATED', targetType: 'PRODUCT', targetId: product.id,
    metadata: { ref: product.refCode, orgId: ctx.orgId, publish: body.publish },
  })
  return ok({ product, message: body.publish ? 'Product published to the supply catalogue.' : 'Product saved as draft.' }, { status: 201 })
})

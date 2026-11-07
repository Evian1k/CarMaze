import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, requireUserOptional } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getOwnOrg, requireOrgMember, jsonParse, availableQty } from '@/lib/supply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().trim().min(3).max(140).optional(),
  mpn: z.string().trim().max(60).optional().nullable(),
  oemRef: z.string().trim().max(60).optional().nullable(),
  brand: z.string().trim().max(60).optional().nullable(),
  categoryId: z.string().optional(),
  description: z.string().trim().min(10).max(4000).optional(),
  condition: z.enum(['NEW', 'REFURBISHED', 'USED']).optional(),
  unitPriceMinor: z.number().int().min(100).optional(),
  wholesalePriceMinor: z.number().int().min(0).optional().nullable(),
  wholesaleMinQty: z.number().int().min(0).optional(),
  taxRatePct: z.number().min(0).max(50).optional(),
  warrantyMonths: z.number().int().min(0).max(120).optional(),
  returnable: z.boolean().optional(),
  images: z.array(z.string().max(300)).max(8).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  vehicleMakes: z.array(z.string().max(40)).max(30).optional(),
  provenanceNote: z.string().max(1000).optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
})

/** GET /api/supply/products/[id]: public detail for published products,
 * full detail for the owning supplier. Includes real compatibility records,
 * per-warehouse availability, price history and reviews. */
export const GET = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUserOptional()
  const product = await db.product.findUnique({
    where: { id },
    include: {
      category: { select: { slug: true, name: true } },
      supplier: {
        select: { id: true, name: true, county: true, town: true, location: true, verified: true, supplierRating: true, logoUrl: true, coverUrl: true, description: true, phone: true, email: true, type: true, status: true },
      },
      stocks: { include: { branch: { select: { id: true, name: true, code: true, kind: true, county: true, town: true, status: true } } } },
      compat: true,
      reviews: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 },
      priceHistory: { orderBy: { createdAt: 'desc' }, take: 30 },
    },
  })
  if (!product || product.supplier.status !== 'ACTIVE') return fail(404, 'NOT_FOUND', 'Product not found.')

  const isOwner = user ? await getOwnOrg(user, 'SUPPLIER').then((c) => c?.orgId === product.supplierOrgId).catch(() => false) : false
  if (product.status !== 'PUBLISHED' && !isOwner) return fail(404, 'NOT_FOUND', 'Product not found.')

  const available = product.stocks
    .filter((s) => s.branch.status === 'ACTIVE')
    .reduce((sum, s) => sum + (s.qtyOnHand - s.qtyReserved), 0)

  // Contact details are only published for verified suppliers (and always for
  // the owning supplier): mirrors GET /api/suppliers/[id].
  const showContacts = product.supplier.verified || isOwner

  return ok({
    product: {
      ...product,
      supplier: {
        ...product.supplier,
        phone: showContacts ? product.supplier.phone : null,
        email: showContacts ? product.supplier.email : null,
      },
      images: jsonParse<string[]>(product.images, []),
      tags: jsonParse<string[]>(product.tags, []),
      vehicleMakes: jsonParse<string[]>(product.vehicleMakes, []),
      stocks: product.stocks.map((s) => ({
        branchId: s.branch.id, branchName: s.branch.name, kind: s.branch.kind, county: s.branch.county, town: s.branch.town,
        available: Math.max(0, s.qtyOnHand - s.qtyReserved),
        // exact warehouse quantities are private to the supplier
        ...(isOwner ? { qtyOnHand: s.qtyOnHand, qtyReserved: s.qtyReserved, reorderLevel: s.reorderLevel } : {}),
      })),
      availableQty: available,
      provenance: jsonParse<{ provenanceNote?: string } | null>(product.provenance, null),
      reviews: product.reviews.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, verifiedPurchase: r.verifiedPurchase, author: r.author.name, createdAt: r.createdAt })),
    },
    isOwner,
  })
})

/** PATCH: owning supplier updates product. Price changes append history. */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const product = await db.product.findUnique({ where: { id } })
  if (!product) return fail(404, 'NOT_FOUND', 'Product not found.')
  const member = await requireOrgMember(user, product.supplierOrgId, 'catalogue.write')
  const body = await parseBody(req, patchSchema)

  if (body.categoryId) {
    const category = await db.productCategory.findUnique({ where: { id: body.categoryId } })
    if (!category || !category.active) return fail(400, 'BAD_CATEGORY', 'Choose a valid product category.')
  }

  const priceChanged = body.unitPriceMinor !== undefined && body.unitPriceMinor !== product.unitPriceMinor
  const updated = await db.product.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.mpn !== undefined ? { mpn: body.mpn } : {}),
      ...(body.oemRef !== undefined ? { oemRef: body.oemRef } : {}),
      ...(body.brand !== undefined ? { brand: body.brand } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.condition !== undefined ? { condition: body.condition } : {}),
      ...(body.unitPriceMinor !== undefined ? { unitPriceMinor: body.unitPriceMinor } : {}),
      ...(body.wholesalePriceMinor !== undefined ? { wholesalePriceMinor: body.wholesalePriceMinor } : {}),
      ...(body.wholesaleMinQty !== undefined ? { wholesaleMinQty: body.wholesaleMinQty } : {}),
      ...(body.taxRatePct !== undefined ? { taxRatePct: body.taxRatePct } : {}),
      ...(body.warrantyMonths !== undefined ? { warrantyMonths: body.warrantyMonths } : {}),
      ...(body.returnable !== undefined ? { returnable: body.returnable } : {}),
      ...(body.images !== undefined ? { images: JSON.stringify(body.images) } : {}),
      ...(body.tags !== undefined ? { tags: JSON.stringify(body.tags) } : {}),
      ...(body.vehicleMakes !== undefined ? { vehicleMakes: JSON.stringify(body.vehicleMakes) } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.provenanceNote !== undefined
        ? { provenance: body.provenanceNote ? JSON.stringify({ provenanceNote: body.provenanceNote, authenticator: null }) : null }
        : {}),
      ...(priceChanged ? { priceHistory: { create: { priceMinor: body.unitPriceMinor!, reason: 'UPDATE' } } } : {}),
    },
  })
  await audit({
    actorId: user.id, actorName: user.name,
    action: 'PRODUCT_UPDATED', targetType: 'PRODUCT', targetId: id,
    metadata: { orgId: member.orgId, priceChanged, newPrice: body.unitPriceMinor ?? null },
  })
  return ok({ product: updated })
})

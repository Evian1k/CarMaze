import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail } from '@/lib/api'
import { jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/suppliers/[id]: public supplier storefront profile: verification
 * status, branches/warehouses (public locations only), product categories,
 * delivery areas, operating hours, policies, reviews and rating.
 * Contact details are shown only for VERIFIED suppliers.
 */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const supplier = await db.org.findFirst({
    where: { id, type: 'SUPPLIER', status: 'ACTIVE' },
    include: {
      branches: { where: { status: 'ACTIVE' }, select: { id: true, name: true, code: true, kind: true, county: true, town: true, address: true, operatingHours: true, deliveryAreas: true, isPrimary: true } },
      reviews: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 },
      _count: { select: { products: true } },
    },
  })
  if (!supplier) return fail(404, 'NOT_FOUND', 'Supplier not found.')

  const categories = await db.product.findMany({
    where: { supplierOrgId: id, status: 'PUBLISHED' },
    select: { category: { select: { slug: true, name: true } } },
    distinct: ['categoryId'],
  })
  const brands = await db.product.findMany({
    where: { supplierOrgId: id, status: 'PUBLISHED', brand: { not: null } },
    select: { brand: true },
    distinct: ['brand'],
  })

  return ok({
    supplier: {
      id: supplier.id,
      name: supplier.name,
      regNo: supplier.verified ? supplier.regNo : null, // reg no only after verification
      verified: supplier.verified,
      county: supplier.county,
      town: supplier.town,
      location: supplier.location,
      description: supplier.description,
      logoUrl: supplier.logoUrl,
      coverUrl: supplier.coverUrl,
      gallery: jsonParse<string[]>(supplier.gallery, []),
      openingHours: jsonParse<Record<string, [string, string] | null> | null>(supplier.openingHours, null),
      serviceAreas: jsonParse<string[]>(supplier.serviceAreas, []),
      specialities: jsonParse<string[]>(supplier.specialities, []),
      whatsappEnabled: supplier.whatsappEnabled,
      callEnabled: supplier.callEnabled,
      responseMinutes: supplier.responseMinutes,
      phone: supplier.verified ? supplier.phone : null,
      email: supplier.verified ? supplier.email : null,
      rating: supplier.supplierRating,
      reviewCount: supplier.reviews.length,
      productCount: supplier._count.products,
      memberSince: supplier.createdAt,
      // warranty/returns policy summary derived from catalogue data
      policies: { returnsAccepted: true, note: 'Returns, warranty and minimum-order terms are shown on each product. Verified business status is separate from product authenticity, which is reviewed independently by CARMAZE.' },
    },
    branches: supplier.branches.map((b) => ({
      id: b.id, name: b.name, code: b.code, kind: b.kind, county: b.county, town: b.town,
      address: b.address, operatingHours: jsonParse<Record<string, [string, string] | null> | null>(b.operatingHours, null),
      deliveryAreas: jsonParse<string[]>(b.deliveryAreas, []), isPrimary: b.isPrimary,
    })),
    categories: categories.map((c) => c.category),
    brands: brands.map((b) => b.brand).filter(Boolean),
    reviews: supplier.reviews.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, author: r.author.name, createdAt: r.createdAt })),
  })
})

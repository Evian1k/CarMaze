import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'
import { jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/supply/catalogue — public product catalogue search for the
 * Automotive Supply Network. Filters: q, category, brand, make, model, year,
 * condition, supplier, featured, inStock, sort, page. Compatibility filtering
 * uses real fitment records only — never invented.
 */
export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const q = sp.get('q')?.trim()
  const category = sp.get('category')
  const brand = sp.get('brand')
  const make = sp.get('make')
  const model = sp.get('model')
  const year = sp.get('year') ? Number(sp.get('year')) : undefined
  const condition = sp.get('condition')
  const supplierId = sp.get('supplier')
  const featured = sp.get('featured') === '1'
  const inStock = sp.get('inStock') === '1'
  const sort = sp.get('sort') || 'relevance' // relevance|price_asc|price_desc|newest|rating
  const page = Math.max(1, Number(sp.get('page') || 1))
  const pageSize = Math.min(48, Math.max(6, Number(sp.get('pageSize') || 24)))

  const AND: Record<string, unknown>[] = [{ status: 'PUBLISHED', supplier: { type: 'SUPPLIER', status: 'ACTIVE' } }]

  if (q) {
    AND.push({
      OR: [
        { name: { contains: q } },
        { description: { contains: q } },
        { sku: { contains: q } },
        { mpn: { contains: q } },
        { oemRef: { contains: q } },
        { brand: { contains: q } },
      ],
    })
  }
  if (category) {
    // include child categories (one-level tree)
    const children = await db.productCategory.findMany({ where: { parentSlug: category }, select: { id: true } })
    const cat = await db.productCategory.findUnique({ where: { slug: category }, select: { id: true } })
    const ids = [cat?.id, ...children.map((c) => c.id)].filter(Boolean) as string[]
    AND.push({ categoryId: { in: ids } })
  }
  if (brand) AND.push({ brand: { equals: brand } })
  if (condition) AND.push({ condition: { equals: condition } })
  if (supplierId) AND.push({ supplierOrgId: supplierId })
  if (featured) AND.push({ featured: true })
  if (make) {
    // vehicle makes JSON quick filter + structured compatibility rows
    AND.push({
      OR: [
        { vehicleMakes: { contains: make } },
        { compat: { some: { make: { equals: make }, OR: model ? [{ model: { equals: model } }, { model: null }] : undefined } } },
      ],
    })
  }
  if (model && !make) {
    AND.push({ compat: { some: { model: { equals: model } } } })
  }
  if (year) {
    AND.push({
      OR: [
        { compat: { some: { AND: [{ OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] }, { OR: [{ yearTo: null }, { yearTo: { gte: year } }] }] } } },
      ],
    })
  }
  if (inStock) {
    AND.push({ stocks: { some: {} } })
  }

  const orderBy: Record<string, string>[] = []
  if (sort === 'price_asc') orderBy.push({ unitPriceMinor: 'asc' })
  else if (sort === 'price_desc') orderBy.push({ unitPriceMinor: 'desc' })
  else if (sort === 'newest') orderBy.push({ createdAt: 'desc' })
  else if (sort === 'rating') orderBy.push({ ratingAvg: 'desc' })
  else orderBy.push({ featured: 'desc' }, { createdAt: 'desc' })

  const [total, products] = await Promise.all([
    db.product.count({ where: { AND } }),
    db.product.findMany({
      where: { AND },
      include: {
        category: { select: { slug: true, name: true } },
        supplier: {
          select: {
            id: true, name: true, county: true, town: true, verified: true,
            supplierRating: true, logoUrl: true, type: true,
          },
        },
        stocks: { select: { qtyOnHand: true, qtyReserved: true } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return ok({
    total,
    page,
    pageSize,
    products: products.map((p) => {
      const available = p.stocks.reduce((s, x) => s + (x.qtyOnHand - x.qtyReserved), 0)
      return {
        id: p.id,
        refCode: p.refCode,
        name: p.name,
        sku: p.sku,
        mpn: p.mpn,
        brand: p.brand,
        condition: p.condition,
        unitPriceMinor: p.unitPriceMinor,
        wholesalePriceMinor: p.wholesalePriceMinor,
        wholesaleMinQty: p.wholesaleMinQty,
        currency: p.currency,
        image: jsonParse<string[]>(p.images, [])[0] ?? null,
        tags: jsonParse<string[]>(p.tags, []),
        category: p.category,
        supplier: {
          id: p.supplier.id,
          name: p.supplier.name,
          county: p.supplier.county,
          town: p.supplier.town,
          verified: p.supplier.verified,
          rating: p.supplier.supplierRating,
          logoUrl: p.supplier.logoUrl,
        },
        authenticityVerified: p.authenticityVerified,
        featured: p.featured,
        ratingAvg: p.ratingAvg,
        ratingCount: p.ratingCount,
        availableQty: available,
        inStock: available > 0,
        createdAt: p.createdAt,
      }
    }),
  })
})

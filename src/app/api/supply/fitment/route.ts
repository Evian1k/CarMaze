import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'
import { availableQty } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/supply/fitment?make=&model=&year=&engine=&q=
 * Vehicle Part Compatibility Engine — returns products with REAL fitment
 * records matching the given vehicle, each with an explicit `fit` verdict:
 *   MATCH       — structured record matches
 *   POSSIBLE    — brand-level match only (make matches, no model record)
 *   NO_FITMENT  — product exists but has no fitment data (never claimed to fit)
 * Nothing is ever invented: products without records are clearly marked.
 */
export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const make = sp.get('make')?.trim()
  const model = sp.get('model')?.trim()
  const year = sp.get('year') ? Number(sp.get('year')) : undefined
  const q = sp.get('q')?.trim()

  if (!make && !q) {
    return ok({ products: [], message: 'Provide a vehicle make (and optionally model/year) or a search term.' })
  }

  // candidate products
  const candidates = await db.product.findMany({
    where: {
      status: 'PUBLISHED',
      supplier: { type: 'SUPPLIER', status: 'ACTIVE', verified: true },
      ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { mpn: { contains: q } }, { brand: { contains: q } }] } : {}),
      ...(make ? { OR: [{ vehicleMakes: { contains: make } }, { compat: { some: { make: { equals: make } } } }] } : {}),
    },
    include: {
      compat: true,
      category: { select: { slug: true, name: true } },
      supplier: { select: { id: true, name: true, county: true, town: true, verified: true, supplierRating: true } },
      stocks: { select: { qtyOnHand: true, qtyReserved: true } },
    },
    take: 120,
  })

  type FitResult = {
    id: string; refCode: string; name: string; sku: string; brand: string | null
    condition: string; unitPriceMinor: number; wholesalePriceMinor: number | null
    currency: string; image: string | null
    category: { slug: string; name: string }
    supplier: { id: string; name: string; county: string; town: string | null; verified: boolean; supplierRating: number | null }
    fit: 'MATCH' | 'POSSIBLE' | 'NO_FITMENT'
    fitRecords: { make: string; model: string | null; yearFrom: number | null; yearTo: number | null; engine: string | null; verified: boolean }[]
    availableQty: number
  }
  const results: FitResult[] = []
  for (const p of candidates) {
    let fit: 'MATCH' | 'POSSIBLE' | 'NO_FITMENT' = 'NO_FITMENT'
    const matching = p.compat.filter((c) => {
      if (c.make.toLowerCase() !== (make ?? '').toLowerCase()) return false
      if (model && c.model && c.model.toLowerCase() !== model.toLowerCase()) return false
      if (year) {
        if (c.yearFrom && year < c.yearFrom) return false
        if (c.yearTo && year > c.yearTo) return false
      }
      return true
    })
    if (matching.length > 0) fit = 'MATCH'
    else if (make && jsonMakes(p.vehicleMakes).some((m) => m.toLowerCase() === make.toLowerCase())) fit = 'POSSIBLE'

    const available = p.stocks.reduce((s, x) => s + (x.qtyOnHand - x.qtyReserved), 0)
    results.push({
      id: p.id,
      refCode: p.refCode,
      name: p.name,
      sku: p.sku,
      brand: p.brand,
      condition: p.condition,
      unitPriceMinor: p.unitPriceMinor,
      wholesalePriceMinor: p.wholesalePriceMinor,
      currency: p.currency,
      image: safeArr(p.images)[0] ?? null,
      category: p.category,
      supplier: p.supplier,
      fit,
      fitRecords: matching.slice(0, 4).map((c) => ({ make: c.make, model: c.model, yearFrom: c.yearFrom, yearTo: c.yearTo, engine: c.engine, verified: c.verified })),
      availableQty: available,
    })
  }

  results.sort((a, b) => {
    const rank = { MATCH: 0, POSSIBLE: 1, NO_FITMENT: 2 } as const
    if (rank[a.fit] !== rank[b.fit]) return rank[a.fit] - rank[b.fit]
    return a.unitPriceMinor - b.unitPriceMinor
  })

  const matchCount = results.filter((r) => r.fit === 'MATCH').length
  return ok({
    products: results,
    summary: {
      matches: matchCount,
      note: matchCount === 0
        ? 'No verified fitment records match this vehicle. Check the part number search or request a part from suppliers — never assume an unlisted part fits.'
        : `${matchCount} product(s) list a compatibility record for this vehicle.`,
    },
  })
})

function safeArr(raw: string | null): string[] {
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}
function jsonMakes(raw: string | null): string[] {
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}

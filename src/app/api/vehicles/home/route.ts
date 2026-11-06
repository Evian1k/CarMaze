import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** Homepage payload: published listings only, cache-friendly. */
export const GET = route(async (_req: NextRequest) => {
  const include = {
    photos: { orderBy: { order: 'asc' as const } },
    org: { select: { id: true, name: true } },
  } as const

  const [recentRows, featuredRows, publishedListings, verifiedDealers, garages] = await Promise.all([
    db.vehicle.findMany({
      where: { status: 'PUBLISHED' },
      include,
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    db.vehicle.findMany({
      where: { status: 'PUBLISHED', featured: true },
      include,
      orderBy: { createdAt: 'desc' },
      take: 4,
    }),
    db.vehicle.count({ where: { status: 'PUBLISHED' } }),
    db.org.count({ where: { type: 'DEALER', status: 'ACTIVE' } }),
    db.org.count({ where: { type: 'GARAGE', status: 'ACTIVE' } }),
  ])

  const toCard = (v: (typeof recentRows)[number]) => ({
    id: v.id,
    refCode: v.refCode,
    make: v.make,
    model: v.model,
    year: v.year,
    priceMinor: v.priceMinor,
    currency: v.currency,
    mileageKm: v.mileageKm,
    fuel: v.fuel,
    transmission: v.transmission,
    bodyType: v.bodyType,
    condition: v.condition,
    county: v.county,
    status: v.status,
    featured: v.featured,
    sellerType: v.sellerType,
    orgName: v.org?.name ?? null,
    photos: v.photos,
  })

  // Real promotion metrics: every homepage render that shows the featured
  // strip records one impression for each ACTIVE campaign on those vehicles
  // (single updateMany, only counted rows in the actual response).
  const featuredIds = featuredRows.map((v) => v.id)
  if (featuredIds.length > 0) {
    await db.campaign.updateMany({
      where: { vehicleId: { in: featuredIds }, status: 'ACTIVE' },
      data: { impressions: { increment: 1 } },
    })
  }

  return ok(
    {
      recent: recentRows.map(toCard),
      featured: featuredRows.map(toCard),
      stats: { publishedListings, verifiedDealers, garages },
    },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
  )
})

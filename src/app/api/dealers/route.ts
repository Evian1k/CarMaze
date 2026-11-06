import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dealers: public showroom directory.
 * ACTIVE DEALER orgs with their live listing count and latest 3 published vehicles.
 */
export const GET = route(async (_req: NextRequest) => {
  const orgs = await db.org.findMany({
    where: { type: 'DEALER', status: 'ACTIVE' },
    select: { id: true, name: true, county: true, town: true, location: true, description: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const vehicles = await db.vehicle.findMany({
    where: { status: 'PUBLISHED', orgId: { in: orgs.length > 0 ? orgs.map((o) => o.id) : ['__none__'] } },
    include: {
      photos: { orderBy: { order: 'asc' as const } },
      org: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const byOrg = new Map<string, typeof vehicles>()
  for (const v of vehicles) {
    if (!v.orgId) continue
    const list = byOrg.get(v.orgId) ?? []
    list.push(v)
    byOrg.set(v.orgId, list)
  }

  const toCard = (v: (typeof vehicles)[number]) => ({
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

  const dealers = orgs
    .map((o) => {
      const list = byOrg.get(o.id) ?? []
      return {
        id: o.id,
        name: o.name,
        county: o.county,
        town: o.town,
        location: o.location,
        description: o.description,
        createdAt: o.createdAt,
        listingCount: list.length,
        vehicles: list.slice(0, 3).map(toCard),
      }
    })
    .sort((a, b) => b.listingCount - a.listingCount || a.name.localeCompare(b.name))

  return ok({ dealers })
})

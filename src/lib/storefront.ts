import { db } from '@/lib/db'
import { parseJson } from '@/lib/json'

export type OpeningHours = Record<string, [string, string] | null>
export type StorefrontFaq = { q: string; a: string }

export type VehicleCard = {
  id: string
  refCode: string
  make: string
  model: string
  year: number
  priceMinor: number
  currency: string
  mileageKm: number
  fuel: string
  transmission: string
  bodyType: string
  condition: string
  county: string
  status: string
  featured: boolean
  sellerType: string
  orgName: string | null
  photos: { id: string; vehicleId: string; url: string; order: number }[]
}

export type StorefrontPayload = {
  org: {
    id: string
    type: string
    name: string
    county: string
    town: string | null
    location: string | null
    description: string | null
    phone: string | null
    logoUrl: string | null
    coverUrl: string | null
    gallery: string[]
    openingHours: OpeningHours
    specialities: string[]
    faqs: StorefrontFaq[]
    serviceAreas: string[]
    whatsappEnabled: boolean
    callEnabled: boolean
    responseMinutes: number | null
    createdAt: string
  }
  verified: true
  rating: { avg: number; count: number }
  reviews: { id: string; rating: number; comment: string | null; authorName: string; createdAt: string }[]
  services?: { id: string; category: string; title: string; description: string | null; priceFromMinor: number | null }[]
  vehicles?: VehicleCard[]
  stats: {
    memberSince: string
    reviewCount: number
    serviceCount?: number
    listingCount?: number
    completedJobs?: number
  }
}

function toVehicleCard(v: {
  id: string
  refCode: string
  make: string
  model: string
  year: number
  priceMinor: number
  currency: string
  mileageKm: number
  fuel: string
  transmission: string
  bodyType: string
  condition: string
  county: string
  status: string
  featured: boolean
  sellerType: string
  org: { name: string } | null
  photos: { id: string; vehicleId: string; url: string; order: number }[]
}): VehicleCard {
  return {
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
  }
}

/**
 * Assemble the full public storefront payload for an org.
 * Returns null when the org does not exist, is not a DEALER/GARAGE, or is not
 * ACTIVE — callers translate that into a 404.
 */
export async function buildStorefrontPayload(orgId: string): Promise<StorefrontPayload | null> {
  const org = await db.org.findUnique({ where: { id: orgId } })
  if (!org || (org.type !== 'DEALER' && org.type !== 'GARAGE') || org.status !== 'ACTIVE') return null

  const [reviewAgg, reviews, services, vehicles, completedJobs] = await Promise.all([
    db.orgReview.aggregate({ where: { orgId: org.id }, _avg: { rating: true }, _count: { rating: true } }),
    db.orgReview.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { author: { select: { name: true } } },
    }),
    org.type === 'GARAGE'
      ? db.garageService.findMany({
          where: { orgId: org.id, active: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, category: true, title: true, description: true, priceFromMinor: true },
        })
      : Promise.resolve([]),
    org.type === 'DEALER'
      ? db.vehicle.findMany({
          where: { orgId: org.id, status: 'PUBLISHED' },
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: { photos: { orderBy: { order: 'asc' } }, org: { select: { name: true } } },
        })
      : Promise.resolve([]),
    org.type === 'GARAGE' ? db.booking.count({ where: { orgId: org.id, status: 'COMPLETED' } }) : Promise.resolve(0),
  ])

  const listingCount =
    org.type === 'DEALER' ? await db.vehicle.count({ where: { orgId: org.id, status: 'PUBLISHED' } }) : 0

  const avg = reviewAgg._avg.rating ? Math.round(reviewAgg._avg.rating * 10) / 10 : 0

  return {
    org: {
      id: org.id,
      type: org.type,
      name: org.name,
      county: org.county,
      town: org.town,
      location: org.location,
      description: org.description,
      phone: org.phone,
      logoUrl: org.logoUrl,
      coverUrl: org.coverUrl,
      gallery: parseJson<string[]>(org.gallery, []),
      openingHours: parseJson<OpeningHours>(org.openingHours, {}),
      specialities: parseJson<string[]>(org.specialities, []),
      faqs: parseJson<StorefrontFaq[]>(org.faqs, []),
      serviceAreas: parseJson<string[]>(org.serviceAreas, []),
      whatsappEnabled: org.whatsappEnabled,
      callEnabled: org.callEnabled,
      responseMinutes: org.responseMinutes,
      createdAt: org.createdAt.toISOString(),
    },
    verified: true,
    rating: { avg, count: reviewAgg._count.rating },
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      authorName: r.author.name,
      createdAt: r.createdAt.toISOString(),
    })),
    ...(org.type === 'GARAGE' ? { services } : {}),
    ...(org.type === 'DEALER' ? { vehicles: vehicles.map(toVehicleCard) } : {}),
    stats: {
      memberSince: org.createdAt.toISOString(),
      reviewCount: reviewAgg._count.rating,
      ...(org.type === 'GARAGE' ? { serviceCount: services.length, completedJobs } : {}),
      ...(org.type === 'DEALER' ? { listingCount } : {}),
    },
  }
}

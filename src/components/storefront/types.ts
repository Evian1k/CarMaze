// CARMAZE — shared storefront types (public business pages).
// Mirrors the GET /api/orgs/<orgId>/storefront contract exactly.

import type { VehicleCardData } from '@/components/marketplace/vehicle-card'

export type OpeningHours = Record<string, [string, string] | null>

/** Week keys in the API contract order (mon-first). */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = (typeof DAY_KEYS)[number]

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

export type StorefrontOrg = {
  id: string
  type: 'GARAGE' | 'DEALER'
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
  faqs: { q: string; a: string }[]
  serviceAreas: string[]
  whatsappEnabled: boolean
  callEnabled: boolean
  responseMinutes: number | null
  createdAt: string
}

export type StorefrontReview = {
  id: string
  rating: number
  comment: string | null
  authorName: string
  createdAt: string
}

export type StorefrontService = {
  id: string
  category: string
  title: string
  description: string | null
  priceFromMinor: number | null
}

export type StorefrontStats = {
  memberSince: string | number
  reviewCount: number
  serviceCount?: number
  listingCount?: number
  completedJobs?: number
}

export type StorefrontData = {
  verified: boolean
  org: StorefrontOrg
  rating: { avg: number; count: number }
  reviews: StorefrontReview[]
  services?: StorefrontService[]
  vehicles?: VehicleCardData[]
  stats: StorefrontStats
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'
import { PARTNER_CATEGORIES, parseServiceAreas } from '@/lib/partners'

export const dynamic = 'force-dynamic'

/**
 * GET /api/partners: public Partner Network directory.
 *
 * Only partners with status APPROVED **and** verified=true are ever listed.
 * Filters: ?category= (exact enum), ?county= (matches partner county OR any of
 * its declared service areas), ?q= (case-insensitive match on name/description).
 *
 * Public-safe fields ONLY: notes, contactName, email and rejectionReason are
 * staff-side data and must never appear in this response.
 */
export const GET = route(async (req: NextRequest) => {
  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const county = url.searchParams.get('county')?.trim()
  const q = url.searchParams.get('q')?.trim().toLowerCase() || ''

  // Exact-match filters go to SQL; SQLite has no case-insensitive `contains`
  // in Prisma and serviceAreas is a JSON string, so q/county filter in memory
  // (the directory is small: verified partners only).
  const rows = await db.partner.findMany({
    where: {
      status: 'APPROVED',
      verified: true,
      ...(category ? { category } : {}),
    },
  })

  const partners = rows
    .map((p) => ({
      id: p.id,
      refCode: p.refCode,
      name: p.name,
      category: p.category,
      county: p.county,
      serviceAreas: parseServiceAreas(p.serviceAreas),
      description: p.description,
      logoUrl: p.logoUrl,
      coverUrl: p.coverUrl,
      phone: p.phone,
      whatsapp: p.whatsapp,
      website: p.website,
      rating: p.rating,
      referrals: p.referrals,
      createdAt: p.createdAt,
    }))
    .filter((p) => {
      if (county && p.county !== county && !p.serviceAreas.includes(county)) return false
      if (q && !`${p.name} ${p.description ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    // Best rated first (unrated partners last), then alphabetical by name.
    .sort((a, b) => {
      if (a.rating == null && b.rating != null) return 1
      if (a.rating != null && b.rating == null) return -1
      if (a.rating != null && b.rating != null && a.rating !== b.rating) return b.rating - a.rating
      return a.name.localeCompare(b.name)
    })

  return ok({ partners, categories: PARTNER_CATEGORIES })
})

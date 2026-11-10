import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

// ─────────────────────────── Helpers ───────────────────────────

type OrgRow = { id: string; name: string; county: string; town: string | null; location: string | null; description: string | null; phone: string | null }

type GarageSummary = {
  org: OrgRow
  services: { id: string; category: string; title: string; description: string | null; priceFromMinor: number | null }[]
  rating: { avg: number; count: number }
  reviewCount: number
}

async function ratingFor(orgIds: string[]): Promise<Map<string, { avg: number; count: number }>> {
  if (orgIds.length === 0) return new Map()
  const grouped = await db.orgReview.groupBy({
    by: ['orgId'],
    where: { orgId: { in: orgIds } },
    _avg: { rating: true },
    _count: { rating: true },
  })
  const map = new Map<string, { avg: number; count: number }>()
  for (const g of grouped) {
    map.set(g.orgId, { avg: g._avg.rating ? Math.round(g._avg.rating * 10) / 10 : 0, count: g._count.rating })
  }
  return map
}

// ─────────────────────────── GET ───────────────────────────

export const GET = route(async (req: NextRequest) => {
  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const county = url.searchParams.get('county')

  // ── Garage member dashboard feed: my orgs with services, ratings, stats ──
  if (url.searchParams.get('mine') === '1') {
    const user = await requireUser()
    const memberships = await db.orgMember.findMany({
      where: { userId: user.id, org: { type: 'GARAGE' } },
      include: { org: true },
      orderBy: { createdAt: 'asc' },
    })
    const orgs = memberships.map((m) => m.org)
    if (orgs.length === 0) return ok({ garages: [] })

    const orgIds = orgs.map((o) => o.id)
    const ratings = await ratingFor(orgIds)

    const garages = await Promise.all(
      orgs.map(async (org) => {
        const services = await db.garageService.findMany({
          where: { orgId: org.id },
          orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
        })

        // Active categories this org offers → eligible open lead pool.
        const activeCategories = [...new Set(services.filter((s) => s.active).map((s) => s.category))]
        const openRequests = activeCategories.length
          ? await db.serviceRequest.count({
              where: { status: { in: ['OPEN', 'QUOTING'] }, category: { in: activeCategories } },
            })
          : 0

        const quoted = await db.quote.count({ where: { orgId: org.id } })
        const booked = await db.booking.count({ where: { orgId: org.id, status: { in: ['CONFIRMED', 'IN_PROGRESS'] } } })
        const completed = await db.booking.count({ where: { orgId: org.id, status: 'COMPLETED' } })
        const pendingBookings = await db.booking.count({ where: { orgId: org.id, status: 'CONFIRMED' } })

        return {
          org: {
            id: org.id, name: org.name, county: org.county, town: org.town,
            location: org.location, description: org.description, phone: org.phone, status: org.status,
          },
          // The caller's membership role in THIS org: lets the UI hide
          // owner/manager-only affordances for staff (server re-checks every
          // mutation; this is UX alignment, not the boundary).
          viewerRole: memberships.find((m) => m.orgId === org.id)?.role ?? 'STAFF',
          services,
          rating: ratings.get(org.id) ?? { avg: 0, count: 0 },
          stats: { openRequests, quoted, booked, completed, pendingBookings },
          subscription: await db.subscription.findUnique({
            where: { orgId: org.id },
            select: { planCode: true, status: true, currentPeriodEnd: true },
          }),
        }
      })
    )

    return ok({ garages })
  }

  // ── Public directory ──
  const where = {
    type: 'GARAGE' as const,
    status: 'ACTIVE' as const,
    ...(county ? { county } : {}),
    ...(category ? { services: { some: { category, active: true } } } : {}),
  }

  const orgs = await db.org.findMany({
    where,
    select: { id: true, name: true, county: true, town: true, location: true, description: true, phone: true },
    orderBy: { createdAt: 'asc' },
  })

  const orgIds = orgs.map((o) => o.id)
  const [ratings, allServices] = await Promise.all([
    ratingFor(orgIds),
    db.garageService.findMany({
      where: { orgId: { in: orgIds }, active: true },
      select: { id: true, orgId: true, category: true, title: true, description: true, priceFromMinor: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  const servicesByOrg = new Map<string, GarageSummary['services']>()
  for (const s of allServices) {
    const list = servicesByOrg.get(s.orgId) ?? []
    list.push({ id: s.id, category: s.category, title: s.title, description: s.description, priceFromMinor: s.priceFromMinor })
    servicesByOrg.set(s.orgId, list)
  }

  const garages = orgs
    .map((org) => {
      const rating = ratings.get(org.id) ?? { avg: 0, count: 0 }
      return { org, services: servicesByOrg.get(org.id) ?? [], rating, reviewCount: rating.count }
    })
    // Best rated first, then most reviewed, then alphabetical.
    .sort((a, b) => b.rating.avg - a.rating.avg || b.reviewCount - a.reviewCount || a.org.name.localeCompare(b.org.name))

  return ok({ garages })
})

// ─────────────────────────── PATCH (org profile, garage owner/manager) ───────────────────────────

const patchSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  location: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(20).optional(),
  town: z.string().trim().max(60).optional(),
})

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`garage-profile:${getIp(req)}:${user.id}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many updates. Try again shortly.')

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'VALIDATION_ERROR', 'Missing ?id= for the garage to update.')

  const org = await db.org.findUnique({ where: { id } })
  if (!org || org.type !== 'GARAGE') throw new ApiError(404, 'NOT_FOUND', 'Garage not found.')

  const membership = await db.orgMember.findFirst({
    where: { orgId: id, userId: user.id, role: { in: ['OWNER', 'MANAGER'] } },
  })
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Only garage owners or managers can update the profile.')

  const body = await parseBody(req, patchSchema)
  if (body.name !== undefined || body.description !== undefined || body.location !== undefined || body.phone !== undefined || body.town !== undefined) {
    const updated = await db.org.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.location !== undefined ? { location: body.location || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.town !== undefined ? { town: body.town || null } : {}),
      },
    })
    await audit({
      actorId: user.id, actorName: user.name,
      action: 'GARAGE_PROFILE_UPDATED', targetType: 'ORG', targetId: id,
      metadata: { fields: Object.keys(body) },
    })
    return ok({ org: { id: updated.id, name: updated.name, county: updated.county, town: updated.town, location: updated.location, phone: updated.phone, description: updated.description } })
  }

  return fail(400, 'VALIDATION_ERROR', 'Nothing to update. Provide name, description, location, phone or town.')
})

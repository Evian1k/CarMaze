import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail, requireRole, getIp } from '@/lib/api'
import { ROLE } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** GET /api/admin/logistics — delivery-partner list for staff with live job
 * stats and owner contact. ADMIN | FOUNDER only. */
export const GET = route(async (req: NextRequest) => {
  await requireRole(ROLE.ADMIN, ROLE.FOUNDER)
  const rl = rateLimit(`admin-logistics:${getIp(req)}`, 60, 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many requests. Slow down.')

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const where = status ? { status } : {}

  const [partners, jobGroups, driverGroups] = await Promise.all([
    db.logisticsPartner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    }),
    db.deliveryJob.groupBy({ by: ['partnerId', 'status'], _count: { _all: true }, where: { partnerId: { not: null } } }),
    db.driver.groupBy({ by: ['partnerId'], _count: { _all: true } }),
  ])

  const jobStats = new Map<string, { total: number; completed: number; failed: number; active: number }>()
  for (const g of jobGroups) {
    if (!g.partnerId) continue
    const s = jobStats.get(g.partnerId) ?? { total: 0, completed: 0, failed: 0, active: 0 }
    s.total += g._count._all
    if (g.status === 'DELIVERED') s.completed += g._count._all
    if (g.status === 'FAILED') s.failed += g._count._all
    if (g.status === 'ASSIGNED' || g.status === 'PICKED_UP' || g.status === 'IN_TRANSIT') s.active += g._count._all
    jobStats.set(g.partnerId, s)
  }
  const driverCounts = new Map(driverGroups.map((g) => [g.partnerId, g._count._all]))

  const statusCounts: Record<string, number> = {}
  for (const p of partners) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1

  return ok({
    partners: partners.map((p) => ({
      id: p.id,
      refCode: p.refCode,
      name: p.name,
      partnerType: p.partnerType,
      regNo: p.regNo,
      county: p.county,
      town: p.town,
      phone: p.phone,
      email: p.email,
      representative: p.representative,
      status: p.status,
      verified: p.verified,
      decisionNote: p.decisionNote,
      capabilities: parseList(p.capabilities),
      serviceAreas: parseList(p.serviceAreas),
      documents: parseList(p.documents).length,
      appliedAt: p.appliedAt,
      reviewedAt: p.reviewedAt,
      reviewedByName: p.reviewedByName,
      createdAt: p.createdAt,
      owner: p.owner,
      drivers: driverCounts.get(p.id) ?? 0,
      stats: jobStats.get(p.id) ?? { total: 0, completed: 0, failed: 0, active: 0 },
      lastEvent: p.events[0] ?? null,
    })),
    counts: { total: partners.length, byStatus: statusCounts },
  })
})

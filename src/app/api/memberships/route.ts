import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/memberships — public discovery of Business Membership programmes
 * offered by verified garages and showrooms. A membership from one business
 * never applies to another business; branch applicability is explicit.
 */
export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const orgId = sp.get('orgId') || undefined
  const type = sp.get('type') // GARAGE | DEALER
  const q = sp.get('q')?.trim()

  const orgs = await db.org.findMany({
    where: {
      status: 'ACTIVE',
      verified: true,
      type: type ? { in: type === 'GARAGE' ? ['GARAGE'] : ['DEALER'] } : { in: ['GARAGE', 'DEALER'] },
      ...(orgId ? { id: orgId } : {}),
      ...(q ? { name: { contains: q } } : {}),
    },
    select: {
      id: true, name: true, type: true, county: true, town: true, logoUrl: true, coverUrl: true, verified: true,
      membershipTiers: { where: { active: true }, orderBy: { priceMonthlyMinor: 'asc' } },
      branches: { where: { status: 'ACTIVE' }, select: { id: true, name: true, code: true, town: true, county: true } },
    },
    orderBy: { name: 'asc' },
    take: 60,
  })

  return ok({
    programmes: orgs
      .filter((o) => o.membershipTiers.length > 0)
      .map((o) => ({
        org: { id: o.id, name: o.name, type: o.type, county: o.county, town: o.town, logoUrl: o.logoUrl, coverUrl: o.coverUrl, verified: o.verified },
        branches: o.branches,
        tiers: o.membershipTiers.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          priceMonthlyMinor: t.priceMonthlyMinor,
          priceYearlyMinor: t.priceYearlyMinor,
          benefits: safeArr(t.benefits),
          memberLimit: t.memberLimit,
          discountCapPct: t.discountCapPct,
          branchScope: t.branchScope,
          branches: t.branchScope === 'SELECTED' ? safeArr(t.branchesJson) : null,
          terms: t.terms,
        })),
      })),
  })
})

function safeArr(raw: string | null): string[] {
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, requireUser } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'

/**
 * GET /api/settlements — supplier settlement ledger.
 *
 *  - Suppliers see settlements for organisations they belong to (any member
 *    role can view; only FINANCE/ADMIN/FOUNDER can act on them).
 *  - Platform staff (FINANCE/ADMIN/FOUNDER) may pass ?scope=all for the full
 *    operations ledger, optionally filtered by ?status= and ?orgId=.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope')
  const status = url.searchParams.get('status') || undefined
  const orgParam = url.searchParams.get('orgId') || undefined
  const isStaff = hasRole(user, ...STAFF_ROLES)

  const where: Record<string, unknown> = {}
  if (isStaff && scope === 'all') {
    if (orgParam) where.orgId = orgParam
  } else {
    const memberships = await db.orgMember.findMany({ where: { userId: user.id }, select: { orgId: true } })
    const orgIds = memberships.map((m) => m.orgId)
    const visible = orgParam && orgIds.includes(orgParam) ? [orgParam] : orgIds
    where.orgId = { in: visible }
  }
  if (status) where.status = status

  const settlements = await db.settlement.findMany({
    where,
    include: {
      org: { select: { id: true, name: true, type: true } },
      order: { select: { id: true, refCode: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const totals = {
    pendingNetMinor: settlements.filter((s) => s.status === 'PENDING').reduce((a, s) => a + s.netMinor, 0),
    processingNetMinor: settlements.filter((s) => s.status === 'PROCESSING').reduce((a, s) => a + s.netMinor, 0),
    settledNetMinor: settlements.filter((s) => s.status === 'SETTLED').reduce((a, s) => a + s.netMinor, 0),
    onHoldNetMinor: settlements.filter((s) => s.status === 'ON_HOLD').reduce((a, s) => a + s.netMinor, 0),
  }

  return ok({ settlements, totals })
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail } from '@/lib/api'
import { requireUser } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'

/**
 * GET /api/billing/invoices: scoped, never leaky:
 *   ?org=1   → invoices of organisations the caller belongs to
 *              (OrgMember role OWNER / MANAGER / FINANCE), with payment attempts.
 *   ?mine=1  → invoices issued to the caller personally (private sellers, etc).
 *   staff (no scope) → ALL invoices for the Control Center Billing tab
 *              (SUPPORT / REVIEWER / MODERATOR / FINANCE / ADMIN / FOUNDER).
 *
 * Everything is filtered by real ownership; there is no way to read another
 * org's invoices without staff roles.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status')
  const statusWhere = statusFilter && statusFilter !== 'ALL' ? { status: statusFilter } : {}

  if (url.searchParams.get('org') === '1') {
    const memberships = await db.orgMember.findMany({
      where: { userId: user.id, role: { in: ['OWNER', 'MANAGER', 'FINANCE'] } },
      select: { orgId: true },
    })
    const orgIds = memberships.map((m) => m.orgId)
    if (orgIds.length === 0) return fail(403, 'NO_ORG_MEMBERSHIP', 'You do not belong to an organisation with billing access.')
    const invoices = await db.invoice.findMany({
      where: { orgId: { in: orgIds }, ...statusWhere },
      orderBy: { issuedAt: 'desc' },
      include: { payments: { orderBy: { createdAt: 'desc' } }, org: { select: { name: true, type: true } } },
      take: 200,
    })
    return ok({ invoices, scope: 'org' })
  }

  if (url.searchParams.get('mine') === '1') {
    const invoices = await db.invoice.findMany({
      where: { userId: user.id, ...statusWhere },
      orderBy: { issuedAt: 'desc' },
      include: { payments: { orderBy: { createdAt: 'desc' } }, org: { select: { name: true, type: true } } },
      take: 200,
    })
    return ok({ invoices, scope: 'mine' })
  }

  if (!hasRole(user, ...STAFF_ROLES)) {
    return fail(403, 'FORBIDDEN', 'Specify ?org=1 or ?mine=1 to list invoices you own.')
  }

  // Staff view: all invoices for the Control Center.
  const invoices = await db.invoice.findMany({
    where: statusWhere,
    orderBy: { issuedAt: 'desc' },
    include: { payments: { orderBy: { createdAt: 'desc' } }, org: { select: { name: true, type: true } } },
    take: 300,
  })
  return ok({ invoices, scope: 'all' })
})

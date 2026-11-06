import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, requireUser } from '@/lib/api'

/**
 * GET /api/orgs/me
 * Session bootstrap for DealerOS / GarageOS state machines.
 * Returns every org membership for the signed-in user plus their latest
 * DEALER application (with full event timeline): or null when they never
 * applied. Drives the dealer view's "not applied / pending / approved" states.
 */
export const GET = route(async (_req: NextRequest) => {
  const user = await requireUser()

  const memberships = await db.orgMember.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: {
      orgId: true,
      role: true,
      createdAt: true,
      org: { select: { id: true, name: true, type: true, status: true, county: true, town: true } },
    },
  })

  const application = await db.application.findFirst({
    where: { userId: user.id, type: 'DEALER' },
    orderBy: { updatedAt: 'desc' },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })

  return ok({ memberships, application: application ?? null })
})

import { getSessionUser } from '@/lib/auth'
import { route, ok } from '@/lib/api'
import { db } from '@/lib/db'

export const GET = route(async () => {
  const user = await getSessionUser()
  if (!user) return ok({ user: null })

  // Provide the user's organisation memberships so portals can route correctly.
  const memberships = await db.orgMember.findMany({
    where: { userId: user.id },
    include: { org: { select: { id: true, name: true, type: true, status: true } } },
  })

  return ok({
    user,
    memberships: memberships.map((m) => ({ orgId: m.orgId, role: m.role, org: m.org })),
  })
})

import { getSessionUser, getSessionDemoInfo } from '@/lib/auth'
import { route, ok } from '@/lib/api'
import { db } from '@/lib/db'

export const GET = route(async () => {
  const user = await getSessionUser()
  if (!user) return ok({ user: null })

  // Demo-scope info for the DEMO MODE banner (decoded from the session JWT).
  const demo = await getSessionDemoInfo()

  // Provide the user's organisation memberships so portals can route correctly.
  const memberships = await db.orgMember.findMany({
    where: { userId: user.id },
    include: { org: { select: { id: true, name: true, type: true, status: true } } },
  })

  // Onboarding application progress per platform type — lets gates show the
  // real review state instead of a client-side guess (applicants only ever
  // see their own applications here).
  const applications = await db.application.findMany({
    where: { userId: user.id },
    select: { id: true, refCode: true, type: true, status: true, orgName: true, submittedAt: true, decisionNote: true, infoRequestedAt: true, correctionsDueAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return ok({
    user,
    memberships: memberships.map((m) => ({ orgId: m.orgId, role: m.role, org: m.org })),
    applications,
    demo,
  })
})

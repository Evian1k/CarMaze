import { db } from '@/lib/db'
import { route, ok, requireUser } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/partners/requests/mine: the signed-in user's referral requests,
 * newest first, with the partner's public identity for display.
 */
export const GET = route(async () => {
  const user = await requireUser()
  const requests = await db.partnerRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      refCode: true,
      name: true,
      phone: true,
      county: true,
      message: true,
      status: true,
      createdAt: true,
      partner: { select: { id: true, name: true, refCode: true, category: true } },
    },
  })
  return ok({ requests })
})

import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, getIp } from '@/lib/api'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/vehicles/[id]/view — increments views with per-IP+vehicle dedupe.
 * A ViewEvent row (unique key) marks "already counted in the last 24h".
 * Old rows are pruned opportunistically.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params

  const vehicle = await db.vehicle.findUnique({ where: { id }, select: { id: true, views: true } })
  if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Listing not found.')

  const ip = getIp(req)
  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 32)
  const key = `vehicle:${id}:${ipHash}`

  try {
    await db.viewEvent.create({ data: { key } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Already counted for this IP+vehicle recently.
      return ok({ views: vehicle.views })
    }
    throw e
  }

  // Opportunistic prune of stale dedupe rows (roughly 1 in 20 requests).
  if (Math.random() < 0.05) {
    db.viewEvent
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
      .catch(() => {})
  }

  const updated = await db.vehicle.update({
    where: { id },
    data: { views: { increment: 1 } },
    select: { views: true },
  })

  // Real promotion metrics: a counted view of a promoted listing is one
  // campaign interaction (the viewer reached the listing) — increment clicks
  // for every ACTIVE campaign on this vehicle. Deduped short-circuits above
  // never reach this, so repeat views from the same IP are not double-counted.
  await db.campaign.updateMany({
    where: { vehicleId: id, status: 'ACTIVE' },
    data: { clicks: { increment: 1 } },
  })

  return ok({ views: updated.views })
})

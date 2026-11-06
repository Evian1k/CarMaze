import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'

/** GET /api/billing/plans: PUBLIC. Active subscription plans + campaign packages. */
export const GET = route(async (req: NextRequest) => {
  const rl = rateLimit(`plans:${getIp(req)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return ok({ plans: [], packages: [], rateLimited: true })
  }
  const [plans, packages] = await Promise.all([
    db.plan.findMany({ where: { active: true }, orderBy: { priceMinor: 'asc' } }),
    db.campaignPackage.findMany({ where: { active: true }, orderBy: { priceMinor: 'asc' } }),
  ])
  return ok({
    plans: plans.map((p) => ({ ...p, features: JSON.parse(p.features || '[]') as string[] })),
    packages,
  })
})

import { NextRequest } from 'next/server'
import { route, ok, fail, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { contextSessionUser } from '@/lib/request-context'

/**
 * POST /api/security/access-denied — record repeated frontend route-probe
 * attempts in the audit trail. Best-effort and rate-limited; the real security
 * boundary remains the per-endpoint backend authorisation checks.
 */
export const POST = route(async (req: NextRequest) => {
  const ip = getIp(req)
  const rl = rateLimit(`access-denied:${ip}`, 20, 15 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many reports.')

  let view = 'unknown'
  try {
    const body = (await req.json()) as { view?: unknown }
    if (typeof body?.view === 'string') view = body.view.replace(/[^\w\-/?]/g, '').slice(0, 60) || 'unknown'
  } catch {
    /* body optional */
  }

  const user = await contextSessionUser()
  await audit({
    actorId: user?.id ?? null,
    actorName: user?.name ?? null,
    action: 'ACCESS_DENIED_ATTEMPT',
    targetType: 'VIEW',
    targetId: view,
    metadata: { ip, roles: user?.roles ?? [] },
  })
  return ok({ recorded: true })
})

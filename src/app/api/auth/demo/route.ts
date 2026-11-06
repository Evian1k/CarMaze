import { NextRequest } from 'next/server'
import { route, ok, fail, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { demoCatalog, startDemoSession } from '@/lib/demo'

/**
 * GET /api/auth/demo — public catalog of ENABLED demo experiences for the
 * sign-in page. Returns labels/descriptions only; credentials never leave the
 * server, so the frontend has nothing to leak.
 */
export const GET = route(async () => {
  const roles = await demoCatalog()
  return ok({ roles })
})

/**
 * POST /api/auth/demo — start a secure demo session for a roleKey.
 * The mapping roleKey → demo account is resolved server-side from the
 * DemoAccount registry; no password is involved or accepted.
 */
export const POST = route(async (req: NextRequest) => {
  const ip = getIp(req)

  // Generous enough to explore every role in one sitting; still bounded
  // against scripted abuse.
  const rl = rateLimit(`demo-signin:${ip}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many demo sign-in attempts. Try again in a few minutes.')

  let body: { role?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'INVALID_JSON', 'Request body must be valid JSON.')
  }
  const role = typeof body?.role === 'string' ? body.role.trim() : ''
  if (!role) return fail(400, 'MISSING_ROLE', 'Specify which demo role to explore.')

  const session = await startDemoSession(role, ip)
  return ok(session)
})

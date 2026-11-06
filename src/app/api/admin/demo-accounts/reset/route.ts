import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole } from '@/lib/api'
import { audit } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'

/** Reset lock — only one demo-data reset may run at a time. */
let resetInFlight: { running: boolean; startedAt: number } = { running: false, startedAt: 0 }

/**
 * POST /api/admin/demo-accounts/reset — restore demo data to its seeded
 * baseline by re-running the idempotent seed.
 *
 * HONESTY: on this deployment the entire database is demo/seed data, so the
 * reset restores the FULL seeded baseline. Every signed-in session ends
 * (users are recreated with fresh ids). The response reports exactly that.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireRole('ADMIN', 'FOUNDER')
  if (user.isDemo) return fail(403, 'DEMO_SANDBOXED', 'Demo mode: resetting demo data is disabled for demo accounts.')

  const rl = rateLimit(`demo-reset:${user.id}`, 3, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Reset was run recently. Please wait before resetting again.')

  const body = await parseBody(req, z.object({ confirm: z.literal('RESET_DEMO_DATA') }))
  void body

  if (resetInFlight.running) {
    return fail(409, 'RESET_IN_PROGRESS', 'A demo data reset is already running. Please wait.')
  }
  resetInFlight = { running: true, startedAt: Date.now() }

  try {
    const { spawn } = await import('child_process')
    const result = await new Promise<{ code: number | null; stderr: string; timedOut: boolean }>((resolve) => {
      const child = spawn('bun', ['prisma/seed.ts'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => { stderr += String(d).slice(0, 4000) })
      const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } resolve({ code: null, stderr, timedOut: true }) }, 120_000)
      child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, stderr: `${stderr}\n${String(err)}`, timedOut: false }) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr, timedOut: false }) })
    })

    if (result.code === 0) {
      await db.demoAccount.updateMany({ data: { lastResetAt: new Date(), resetCount: { increment: 1 } } })
      await audit({ actorId: user.id, actorName: user.name, action: 'DEMO_DATA_RESET', targetType: 'SYSTEM', targetId: 'demo-seed', metadata: { durationMs: Date.now() - resetInFlight.startedAt } })
      return ok({
        reset: true,
        message: 'Demo data reset complete. The full seeded baseline was restored; all sessions have ended and users must sign in again.',
        allSessionsEnded: true,
      })
    }
    console.error('[demo-reset] seed failed', result.code, result.stderr)
    return fail(500, 'RESET_FAILED', `Demo data reset failed (exit ${result.code ?? (result.timedOut ? 'timeout' : 'error')}). The seed is transactional per section; check server logs.`)
  } finally {
    resetInFlight = { running: false, startedAt: 0 }
  }
})

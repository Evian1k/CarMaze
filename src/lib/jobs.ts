import { createLogger } from '@/lib/logger'
import { runApplicationSweep, cleanupExpiredResetTokens } from '@/lib/sweeps'
import { audit } from '@/lib/audit'

/**
 * Scheduled-job runner for this single-process deployment.
 *
 * Started once per server process from src/instrumentation.ts. Interval jobs:
 *  - every 60 min: application SLA sweep (same rules as the admin endpoint)
 *  - every 24 h: expired password-reset token cleanup
 *
 * Guards:
 *  - ENABLE_JOBS=false disables everything (e.g. secondary workers)
 *  - a globalThis flag makes it hot-reload/once-per-process safe
 *  - every run is audit-logged so automation leaves the same trail as staff
 */

const log = createLogger('jobs')

type JobState = { started?: boolean; timers: NodeJS.Timeout[] }

const g = globalThis as typeof globalThis & { __carmazeJobs?: JobState }

export function startScheduledJobs(): void {
  if (process.env.ENABLE_JOBS === 'false') {
    log.info('scheduled jobs disabled by ENABLE_JOBS=false')
    return
  }
  if (g.__carmazeJobs?.started) return
  g.__carmazeJobs = { started: true, timers: [] }
  log.info('scheduled jobs started')

  const register = (name: string, intervalMs: number, run: () => Promise<string>) => {
    const timer = setInterval(() => {
      void (async () => {
        try {
          const summary = await run()
          log.info(`job ${name} completed`, { summary })
        } catch (e) {
          log.error(`job ${name} failed`, { error: e instanceof Error ? e.message : String(e) })
        }
      })()
    }, intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
    g.__carmazeJobs?.timers.push(timer)
  }

  // Application SLA sweep: hourly (the 12h idempotency window in the rules
  // means hourly runs can only ever add one reminder per application per day).
  register('application-sla-sweep', 60 * 60 * 1000, async () => {
    const stats = await runApplicationSweep()
    await audit({ action: 'APPLICATION_SWEEP', metadata: { ...stats, source: 'scheduled-job' } })
    return JSON.stringify(stats)
  })

  // Expired password-reset token cleanup: daily.
  register('reset-token-cleanup', 24 * 60 * 60 * 1000, async () => {
    const removed = await cleanupExpiredResetTokens(7)
    await audit({ action: 'RESET_TOKEN_CLEANUP', metadata: { removed, source: 'scheduled-job' } })
    return `${removed} expired tokens removed`
  })
}

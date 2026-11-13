import { createLogger } from '@/lib/logger'
import {
  runApplicationSweep,
  cleanupExpiredResetTokens,
  runSubscriptionExpirySweep,
  runCampaignExpirySweep,
  cleanupExpiredVerificationCodes,
  runOfferExpirySweep,
} from '@/lib/sweeps'
import { audit } from '@/lib/audit'

/**
 * Scheduled-job runner for this single-process deployment.
 *
 * Started once per server process from src/instrumentation.ts. Interval jobs:
 *  - every 60 min: application SLA sweep (same rules as the admin endpoint)
 *  - every 60 min: subscription expiry (3-day grace → PAST_DUE + owner notice)
 *  - every 60 min: campaign expiry (ACTIVE past endsAt → ENDED)
 *  - every 60 min: offer expiry (PENDING past expiresAt → EXPIRED)
 *  - every 24 h: expired password-reset token cleanup
 *  - every 24 h: expired verification-code cleanup
 *
 * Guards:
 *  - ENABLE_JOBS=false disables everything (e.g. secondary workers)
 *  - a globalThis flag makes it hot-reload/once-per-process safe
 *  - every run is audit-logged so automation leaves the same trail as staff
 *  - every job is idempotent (safe to re-run; no duplicate side effects)
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

  // Subscription expiry: hourly (3-day grace → PAST_DUE; owner notified once).
  register('subscription-expiry-sweep', 60 * 60 * 1000, async () => {
    const stats = await runSubscriptionExpirySweep()
    if (stats.expired > 0) await audit({ action: 'SUBSCRIPTION_EXPIRY_SWEEP', metadata: { ...stats, source: 'scheduled-job' } })
    return JSON.stringify(stats)
  })

  // Campaign expiry: hourly (ACTIVE past endsAt → ENDED; owner notified once).
  register('campaign-expiry-sweep', 60 * 60 * 1000, async () => {
    const stats = await runCampaignExpirySweep()
    if (stats.ended > 0) await audit({ action: 'CAMPAIGN_EXPIRY_SWEEP', metadata: { ...stats, source: 'scheduled-job' } })
    return JSON.stringify(stats)
  })

  // Offer expiry: hourly (PENDING past expiresAt → EXPIRED; dealership notified).
  register('offer-expiry-sweep', 60 * 60 * 1000, async () => {
    const stats = await runOfferExpirySweep()
    if (stats.expired > 0) await audit({ action: 'OFFER_EXPIRY_SWEEP', metadata: { ...stats, source: 'scheduled-job' } })
    return JSON.stringify(stats)
  })

  // Expired password-reset token cleanup: daily.
  register('reset-token-cleanup', 24 * 60 * 60 * 1000, async () => {
    const removed = await cleanupExpiredResetTokens(7)
    await audit({ action: 'RESET_TOKEN_CLEANUP', metadata: { removed, source: 'scheduled-job' } })
    return `${removed} expired tokens removed`
  })

  // Expired verification-code cleanup: daily (codes already expire on check;
  // this removes the leftover values so they never linger in storage).
  register('verification-code-cleanup', 24 * 60 * 60 * 1000, async () => {
    const stats = await cleanupExpiredVerificationCodes()
    return JSON.stringify(stats)
  })
}

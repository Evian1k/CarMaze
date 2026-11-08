/**
 * Next.js instrumentation hook — runs once per server process on boot
 * (dev and production). Used to start the scheduled-job runner.
 */
export async function register(): Promise<void> {
  // Never run during the production build phase.
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  const { startScheduledJobs } = await import('@/lib/jobs')
  startScheduledJobs()
}

import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'
import { mpesaConfigured } from '@/lib/mpesa'

/** Health check — real DB connectivity + honest integration status. */
export const GET = route(async () => {
  let dbStatus = 'connected'
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    dbStatus = 'error'
  }
  return ok({
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    service: 'carmaze',
    time: new Date().toISOString(),
    checks: {
      database: dbStatus,
      mpesa: mpesaConfigured() ? 'configured' : 'not_configured',
      email: process.env.SMTP_URL ? 'configured' : 'not_configured',
      sms: process.env.SMS_API_KEY ? 'configured' : 'not_configured',
      ai: 'managed_sdk',
    },
  })
})

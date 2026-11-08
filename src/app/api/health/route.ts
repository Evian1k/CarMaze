import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'
import { mpesaConfigured, mpesaB2cConfigured } from '@/lib/mpesa'
import { emailProviderConfigured } from '@/lib/providers/email'
import { smsProviderConfigured, smsProviderName } from '@/lib/providers/sms'

/** Health check: real DB connectivity + honest integration status. */
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
      mpesa_b2c: mpesaB2cConfigured() ? 'configured' : 'not_configured',
      email: emailProviderConfigured() ? 'configured' : 'not_configured',
      sms: smsProviderConfigured() ? `configured (${smsProviderName()})` : 'not_configured',
      ai: 'managed_sdk',
    },
  })
})

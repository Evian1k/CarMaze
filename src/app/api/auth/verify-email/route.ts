import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/api'
import { route, ok, fail, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { sixDigitCode } from '@/lib/ids'

const schema = z.object({
  action: z.enum(['request', 'confirm']),
  code: z.string().optional(),
})

/**
 * Email address verification.
 * HONESTY NOTE: this deployment has no SMTP configured, so the request action
 * returns the generated code in the response and clearly labels it as a
 * development-mode code. It is never represented as a real email delivery.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)

  if (body.action === 'request') {
    const rl = rateLimit(`verify-email:${user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many verification requests. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
    const code = sixDigitCode()
    await db.user.update({ where: { id: user.id }, data: { emailCode: code } })
    const smtpConfigured = Boolean(process.env.SMTP_URL)
    return ok({
      sent: true,
      channel: smtpConfigured ? 'email' : 'dev',
      devCode: smtpConfigured ? undefined : code,
      message: smtpConfigured
        ? 'A verification code was sent to your email address.'
        : 'Email delivery is not configured on this deployment — showing the development code instead. This is not a real email delivery.',
    })
  }

  const record = await db.user.findUnique({ where: { id: user.id } })
  if (!record?.emailCode || !body.code || record.emailCode !== body.code.trim()) {
    return fail(400, 'INVALID_CODE', 'That verification code is not correct.')
  }
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true, emailCode: null } })
  await audit({ actorId: user.id, actorName: user.name, action: 'EMAIL_VERIFIED', targetType: 'USER', targetId: user.id })
  return ok({ verified: true })
})

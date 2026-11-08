import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/api'
import { route, ok, fail, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { sixDigitCode } from '@/lib/ids'
import { emailProviderConfigured, sendEmail } from '@/lib/providers/email'

const schema = z.object({
  action: z.enum(['request', 'confirm']),
  code: z.string().optional(),
})

/**
 * Email address verification.
 *
 *  - SMTP configured (SMTP_URL): the code is sent by the real provider and
 *    NEVER returned in the response.
 *  - No provider, production: honest 503 — the code is never leaked in an
 *    HTTP response, because without a provider it could not be delivered.
 *  - No provider, development only: the code is returned explicitly labelled
 *    as a development-mode code (sandbox affordance, never in production).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)

  if (body.action === 'request') {
    const rl = rateLimit(`verify-email:${user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many verification requests. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
    const code = sixDigitCode()
    await db.user.update({ where: { id: user.id }, data: { emailCode: code } })

    if (emailProviderConfigured()) {
      const result = await sendEmail({
        to: user.email,
        subject: `CARMAZE verification code: ${code}`,
        text: `Your CARMAZE email verification code is ${code}. If you did not request this, ignore this email.`,
      })
      if (result.accepted) {
        return ok({ sent: true, channel: 'email', message: 'A verification code was sent to your email address.' })
      }
      return fail(502, 'SEND_FAILED', `The verification email could not be sent (${result.detail}). Please try again shortly.`)
    }

    if (process.env.NODE_ENV === 'production') {
      return fail(503, 'CHANNEL_NOT_CONFIGURED', 'Email delivery is not configured on this deployment. Contact CARMAZE support to verify your account.')
    }

    return ok({
      sent: true,
      channel: 'dev',
      devCode: code,
      message: 'Email delivery is not configured on this deployment; showing the development code instead. This is not a real email delivery.',
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

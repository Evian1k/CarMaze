import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
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

const CODE_TTL_MS = 10 * 60 * 1000 // codes always expire
const MAX_ATTEMPTS = 5 // confirm attempts per code, then it is invalidated

/**
 * Email address verification.
 *
 *  - SMTP configured (SMTP_URL): the code is sent by the real provider and
 *    NEVER returned in the response.
 *  - No provider, production: honest 503 — the code is never leaked in an
 *    HTTP response, because without a provider it could not be delivered.
 *  - No provider, development only: the code is returned explicitly labelled
 *    as a development-mode code (sandbox affordance, never in production).
 *
 * Code lifecycle: expires after 10 minutes, at most 5 confirm attempts
 * (then it is invalidated and a new one must be requested), single-use,
 * request rate-limited (5/h) and confirm rate-limited (10/h).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)

  if (body.action === 'request') {
    const rl = rateLimit(`verify-email:${user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many verification requests. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
    const code = sixDigitCode()
    // Codes are hashed at rest like every other secret (bcrypt, cost 10): a
    // database leak must not expose live verification codes.
    await db.user.update({
      where: { id: user.id },
      data: { emailCode: await bcrypt.hash(code, 10), emailCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS), emailCodeAttempts: 0 },
    })

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
  if (!record?.emailCode || !body.code) {
    return fail(400, 'INVALID_CODE', 'That verification code is not correct.')
  }

  const rl = rateLimit(`verify-email-confirm:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many confirmation attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  // Expiry: a code older than its TTL is dead even if the value still matches.
  if (record.emailCodeExpiresAt && record.emailCodeExpiresAt.getTime() < Date.now()) {
    await db.user.update({ where: { id: user.id }, data: { emailCode: null, emailCodeExpiresAt: null, emailCodeAttempts: 0 } })
    return fail(400, 'CODE_EXPIRED', 'That verification code has expired. Request a new one.')
  }

  // Attempt cap: brute-forcing a 6-digit code is capped, then invalidated.
  if (record.emailCodeAttempts >= MAX_ATTEMPTS) {
    await db.user.update({ where: { id: user.id }, data: { emailCode: null, emailCodeExpiresAt: null, emailCodeAttempts: 0 } })
    return fail(400, 'TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Request a new verification code.')
  }

  const codeMatches = await bcrypt.compare(body.code.trim(), record.emailCode)
  if (!codeMatches) {
    await db.user.update({ where: { id: user.id }, data: { emailCodeAttempts: { increment: 1 } } })
    const left = Math.max(0, MAX_ATTEMPTS - record.emailCodeAttempts - 1)
    return fail(400, 'INVALID_CODE', `That verification code is not correct. ${left} attempt${left === 1 ? '' : 's'} remaining.`)
  }

  // Single use: success clears the code, its expiry and the attempt counter.
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true, emailCode: null, emailCodeExpiresAt: null, emailCodeAttempts: 0 } })
  await audit({ actorId: user.id, actorName: user.name, action: 'EMAIL_VERIFIED', targetType: 'USER', targetId: user.id })
  return ok({ verified: true })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/api'
import { route, ok, fail, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { sixDigitCode } from '@/lib/ids'
import { smsProviderConfigured, sendSms } from '@/lib/providers/sms'

const schema = z.object({
  action: z.enum(['request', 'confirm']),
  code: z.string().optional(),
})

/**
 * Phone contact verification.
 *
 *  - SMS provider configured (SMS_PROVIDER + SMS_API_KEY): the code is sent
 *    by the real provider and NEVER returned in the response.
 *  - No provider, production: honest 503 — the code is never leaked in an
 *    HTTP response, because without a gateway it could not be delivered.
 *  - No provider, development only: the code is returned explicitly labelled
 *    as a development-mode code (sandbox affordance, never in production).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)

  if (body.action === 'request') {
    if (!user.phone) return fail(400, 'NO_PHONE', 'Add a phone number to your profile first.')
    const rl = rateLimit(`verify-phone:${user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many verification requests. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
    const code = sixDigitCode()
    await db.user.update({ where: { id: user.id }, data: { phoneCode: code } })

    if (smsProviderConfigured()) {
      const result = await sendSms({ to: user.phone, message: `Your CARMAZE phone verification code is ${code}. If you did not request this, ignore this message.` })
      if (result.accepted) {
        return ok({ sent: true, channel: 'sms', message: 'A verification code was sent to your phone.' })
      }
      return fail(502, 'SEND_FAILED', `The verification SMS could not be sent (${result.detail}). Please try again shortly.`)
    }

    if (process.env.NODE_ENV === 'production') {
      return fail(503, 'CHANNEL_NOT_CONFIGURED', 'SMS delivery is not configured on this deployment. Contact CARMAZE support to verify your phone number.')
    }

    return ok({
      sent: true,
      channel: 'dev',
      devCode: code,
      message: 'SMS gateway is not configured on this deployment; showing the development code instead. This is not a real SMS delivery.',
    })
  }

  const record = await db.user.findUnique({ where: { id: user.id } })
  if (!record?.phoneCode || !body.code || record.phoneCode !== body.code.trim()) {
    return fail(400, 'INVALID_CODE', 'That verification code is not correct.')
  }
  await db.user.update({ where: { id: user.id }, data: { phoneVerified: true, phoneCode: null } })
  await audit({ actorId: user.id, actorName: user.name, action: 'PHONE_VERIFIED', targetType: 'USER', targetId: user.id })
  return ok({ verified: true })
})

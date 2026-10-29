import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/api'
import { route, ok, fail, parseBody } from '@/lib/api'
import { sixDigitCode } from '@/lib/ids'

const schema = z.object({
  action: z.enum(['request', 'confirm']),
  code: z.string().optional(),
})

/**
 * Phone contact verification.
 * HONESTY NOTE: this deployment has no SMS gateway configured, so the request
 * action returns the generated code in the response and clearly labels it as
 * a development-mode code. It is never represented as a real SMS delivery.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)

  if (body.action === 'request') {
    if (!user.phone) return fail(400, 'NO_PHONE', 'Add a phone number to your profile first.')
    const code = sixDigitCode()
    await db.user.update({ where: { id: user.id }, data: { phoneCode: code } })
    const smsConfigured = Boolean(process.env.SMS_API_KEY)
    return ok({
      sent: true,
      channel: smsConfigured ? 'sms' : 'dev',
      devCode: smsConfigured ? undefined : code,
      message: smsConfigured
        ? 'A verification code was sent to your phone.'
        : 'SMS gateway is not configured on this deployment — showing the development code instead. This is not a real SMS delivery.',
    })
  }

  const record = await db.user.findUnique({ where: { id: user.id } })
  if (!record?.phoneCode || !body.code || record.phoneCode !== body.code.trim()) {
    return fail(400, 'INVALID_CODE', 'That verification code is not correct.')
  }
  await db.user.update({ where: { id: user.id }, data: { phoneVerified: true, phoneCode: null } })
  return ok({ verified: true })
})

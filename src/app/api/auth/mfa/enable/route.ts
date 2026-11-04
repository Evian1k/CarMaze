import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/api'
import { route, ok, fail, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { verifyTotp } from '@/lib/totp'

const schema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
})

/**
 * Step 2 of TOTP enrolment: confirm a code from the authenticator app, then
 * switch MFA on. Rate limited to keep code guessing impractical.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)

  const rl = rateLimit(`mfa-enable:${user.id}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  const record = await db.user.findUnique({ where: { id: user.id } })
  if (!record?.totpSecret) return fail(400, 'NO_SETUP', 'Start the authenticator setup first.')
  if (record.mfaEnabled) return fail(409, 'MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled on this account.')

  if (!verifyTotp(record.totpSecret, body.code)) {
    return fail(400, 'INVALID_CODE', 'That code is not correct. Make sure your device clock is accurate and try the next code.')
  }

  await db.user.update({ where: { id: user.id }, data: { mfaEnabled: true } })
  await audit({ actorId: user.id, actorName: user.name, action: 'MFA_ENABLED', targetType: 'USER', targetId: user.id })

  return ok({ enabled: true })
})

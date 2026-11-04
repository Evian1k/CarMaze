import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { createSession } from '@/lib/auth'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { verifyMfaChallenge, verifyTotp } from '@/lib/totp'

const schema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
})

/**
 * Second sign-in step for MFA-enabled accounts: exchange a short-lived MFA
 * challenge token + valid TOTP code for a full session cookie. Deliberately
 * anonymous — the challenge token (not a session cookie) carries the identity.
 */
export const POST = route(async (req: NextRequest) => {
  const ip = getIp(req)
  const body = await parseBody(req, schema)

  const rl = rateLimit(`mfa-verify:${ip}`, 15, 15 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  const userId = await verifyMfaChallenge(body.mfaToken)
  if (!userId) return fail(401, 'MFA_SESSION_EXPIRED', 'Your sign-in session expired. Please sign in again.')

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user || user.status !== 'ACTIVE' || !user.mfaEnabled || !user.totpSecret) {
    return fail(401, 'MFA_SESSION_EXPIRED', 'Your sign-in session expired. Please sign in again.')
  }

  if (!verifyTotp(user.totpSecret, body.code)) {
    await audit({ action: 'MFA_LOGIN_FAILED', targetType: 'USER', targetId: user.id, metadata: { ip } })
    return fail(400, 'INVALID_CODE', 'That code is not correct. Check your authenticator app and try again.')
  }

  await createSession(user.id)
  await audit({ actorId: user.id, actorName: user.name, action: 'MFA_LOGIN_SUCCESS', targetType: 'USER', targetId: user.id, metadata: { ip } })

  return ok({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      department: user.department,
      roles: user.roles.split(','),
      status: user.status,
    },
  })
})

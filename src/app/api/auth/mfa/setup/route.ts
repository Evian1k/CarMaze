import { db } from '@/lib/db'
import { requireUser } from '@/lib/api'
import { route, ok, fail } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { generateTotpSecret, totpUri } from '@/lib/totp'

/**
 * Step 1 of TOTP enrolment: generate a fresh base32 secret and save it on the
 * user (mfaEnabled stays false until a valid code confirms enrolment).
 */
export const POST = route(async () => {
  const user = await requireUser()

  const rl = rateLimit(`mfa-setup:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many setup attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  const record = await db.user.findUnique({ where: { id: user.id } })
  if (!record) return fail(401, 'UNAUTHENTICATED', 'Please sign in to continue.')
  if (record.mfaEnabled) return fail(409, 'MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled on this account.')

  const secret = generateTotpSecret()
  await db.user.update({ where: { id: user.id }, data: { totpSecret: secret, mfaEnabled: false } })
  await audit({ actorId: user.id, actorName: user.name, action: 'MFA_SETUP_STARTED', targetType: 'USER', targetId: user.id })

  return ok({ secret, uri: totpUri(secret, record.email) })
})

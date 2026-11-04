import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/api'
import { verifyPassword } from '@/lib/auth'
import { route, ok, fail, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const schema = z.object({
  password: z.string().min(1, 'Enter your password to confirm'),
})

/** Turn TOTP MFA off — requires the current password as proof of identity. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)

  const rl = rateLimit(`mfa-disable:${user.id}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  const record = await db.user.findUnique({ where: { id: user.id } })
  if (!record?.mfaEnabled) return fail(400, 'MFA_NOT_ENABLED', 'Two-factor authentication is not enabled on this account.')

  if (!(await verifyPassword(body.password, record.passwordHash))) {
    await audit({ actorId: user.id, actorName: user.name, action: 'MFA_DISABLE_FAILED', targetType: 'USER', targetId: user.id })
    return fail(403, 'WRONG_PASSWORD', 'That password is not correct.')
  }

  await db.user.update({ where: { id: user.id }, data: { totpSecret: null, mfaEnabled: false } })
  await audit({ actorId: user.id, actorName: user.name, action: 'MFA_DISABLED', targetType: 'USER', targetId: user.id })

  return ok({ enabled: false })
})

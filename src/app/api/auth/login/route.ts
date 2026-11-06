import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, createSession } from '@/lib/auth'
import { signMfaChallenge } from '@/lib/totp'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export const POST = route(async (req: NextRequest) => {
  const ip = getIp(req)
  const body = await parseBody(req, loginSchema)

  const rl = rateLimit(`login:${ip}:${body.email}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many sign-in attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  const user = await db.user.findUnique({ where: { email: body.email } })
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    await audit({ action: 'LOGIN_FAILED', targetType: 'USER', targetId: body.email, metadata: { ip } })
    return fail(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.')
  }
  if (user.status !== 'ACTIVE') {
    return fail(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support@carmaze.co.ke.')
  }

  // MFA-enabled accounts get a short-lived challenge instead of a session:
  // the client completes sign-in via POST /api/auth/mfa/verify.
  if (user.mfaEnabled && user.totpSecret) {
    const mfaToken = await signMfaChallenge(user.id)
    await audit({ actorId: user.id, actorName: user.name, action: 'MFA_CHALLENGE', targetType: 'USER', targetId: user.id, metadata: { ip } })
    return ok({ mfaRequired: true, mfaToken })
  }

  await createSession(user.id)
  await audit({ actorId: user.id, actorName: user.name, action: 'LOGIN_SUCCESS', targetType: 'USER', targetId: user.id, metadata: { ip } })

  return ok({
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone, phoneVerified: user.phoneVerified, roles: user.roles.split(','), status: user.status },
  })
})

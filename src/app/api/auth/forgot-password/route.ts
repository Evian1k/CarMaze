import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
})

const RESET_TTL_MS = 60 * 60 * 1000 // reset links live 60 minutes

/** Case-insensitive email lookup (SQLite has no mode:'insensitive'; LIKE is
 * ASCII case-insensitive so verify the candidate matches exactly). */
async function findUserByEmail(email: string) {
  const exact = await db.user.findFirst({ where: { email } })
  if (exact) return exact
  const candidate = await db.user.findFirst({ where: { email: { contains: email } } })
  if (candidate && candidate.email.toLowerCase() === email.toLowerCase()) return candidate
  return null
}

/**
 * Password reset request. NEVER reveals whether the account exists: the
 * response is always a generic success. HONESTY NOTE: this deployment has no
 * SMTP configured, so when an account matches (non-production only) the raw
 * reset token is returned as a clearly-labelled development link instead of
 * pretending an email was sent.
 */
export const POST = route(async (req: NextRequest) => {
  const ip = getIp(req)
  const body = await parseBody(req, schema)

  const rl = rateLimit(`forgot-password:${ip}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many reset requests. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  const user = await findUserByEmail(body.email)

  if (user && user.status === 'ACTIVE') {
    // One live token per user: drop previous unused tokens first.
    await db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } })
    const token = randomBytes(32).toString('hex')
    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'), // raw token is never stored
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
        requestIp: ip,
      },
    })
    // No email address in audit metadata; the action is already linked via userId.
    await audit({ action: 'PASSWORD_RESET_REQUESTED', targetType: 'USER', targetId: user.id, metadata: { userId: user.id } })

    const smtpConfigured = Boolean(process.env.SMTP_URL)
    if (!smtpConfigured && process.env.NODE_ENV !== 'production') {
      return ok({
        ok: true,
        message: 'If an account exists for that address, a reset link has been issued.',
        devResetToken: token,
        devResetPath: `#/signin?reset=${token}`,
        devNotice: 'Email delivery is not configured on this deployment; use this development reset link.',
      })
    }
  }

  return ok({
    ok: true,
    message: 'If an account exists for that address, a reset link has been issued.',
  })
})

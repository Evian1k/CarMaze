import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const schema = z.object({
  token: z.string().trim().min(16).max(128),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
})

/** Consume a password reset token and set the new password. */
export const POST = route(async (req: NextRequest) => {
  const ip = getIp(req)
  const rl = rateLimit(`reset-password:${ip}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  const body = await parseBody(req, schema)
  const tokenHash = createHash('sha256').update(body.token).digest('hex')

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  })
  if (!record) return fail(404, 'INVALID_TOKEN', 'This reset link is invalid or has already been used.')
  if (record.expiresAt.getTime() < Date.now()) return fail(400, 'TOKEN_EXPIRED', 'This reset link has expired. Request a new one.')
  if (record.usedAt) return fail(400, 'TOKEN_USED', 'This reset link has already been used. Request a new one.')

  const passwordHash = await hashPassword(body.password)
  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // Session revocation: bumping the version invalidates every session
        // token issued before this reset (checked on each request).
        sessionVersion: { increment: 1 },
      },
    }),
    db.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ])

  await audit({
    actorId: record.user.id,
    actorName: record.user.name,
    action: 'PASSWORD_RESET_COMPLETED',
    targetType: 'USER',
    targetId: record.user.id,
    metadata: { ip },
  })

  return ok({ ok: true, message: 'Your password has been reset. You can now sign in with your new password.' })
})

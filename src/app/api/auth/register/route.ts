import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, createSession } from '@/lib/auth'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your full name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  phone: z.string().trim().regex(/^(\+?254|0)[17]\d{8}$/, 'Enter a valid Kenyan phone number (e.g. 0712 345 678)').optional().or(z.literal('')),
})

export const POST = route(async (req: NextRequest) => {
  const ip = getIp(req)
  const rl = rateLimit(`register:${ip}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many sign-up attempts. Try again in ${rl.retryAfterSec}s.`)

  const body = await parseBody(req, registerSchema)

  const existing = await db.user.findUnique({ where: { email: body.email } })
  if (existing) return fail(409, 'EMAIL_TAKEN', 'An account with this email already exists. Try signing in.')

  const user = await db.user.create({
    data: {
      name: body.name,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      phone: body.phone || null,
      roles: 'CUSTOMER,SELLER',
    },
  })

  await createSession(user.id)
  await audit({ actorId: user.id, actorName: user.name, action: 'USER_REGISTERED', targetType: 'USER', targetId: user.id })

  return ok({
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone, phoneVerified: user.phoneVerified, roles: user.roles.split(','), status: user.status },
  })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, parseBody, fail, getIp } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(3000),
})

export const POST = route(async (req: NextRequest) => {
  const rl = rateLimit(`support:${getIp(req)}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many messages sent. Please try later.')

  const body = await parseBody(req, schema)
  const user = await getSessionUser()
  const ticket = await db.supportTicket.create({
    data: {
      refCode: refCode('SUP', 6),
      userId: user?.id ?? null,
      name: body.name,
      email: body.email,
      subject: body.subject,
      message: body.message,
    },
  })
  return ok({ ticket: { refCode: ticket.refCode } }, { status: 201 })
})

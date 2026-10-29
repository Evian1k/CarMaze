import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, parseBody, requireUser, fail } from '@/lib/api'

const schema = z.object({
  phone: z.string().trim().regex(/^(\+?254|0)[17]\d{8}$/, 'Enter a valid Kenyan phone number').optional().or(z.literal('')),
})

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)
  await db.user.update({
    where: { id: user.id },
    data: { phone: body.phone || null, ...(body.phone && body.phone !== user.phone ? { phoneVerified: false } : {}) },
  })
  return ok({ success: true })
})

export const GET = route(async () => {
  const user = await requireUser()
  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, phone: true, phoneVerified: true, roles: true, createdAt: true },
  })
  if (!record) return fail(404, 'NOT_FOUND', 'Account not found.')
  return ok({ user: record })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, parseBody, requireUser } from '@/lib/api'

export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)

  if (url.searchParams.get('count')) {
    const unread = await db.notification.count({ where: { userId: user.id, readAt: null } })
    return ok({ unread })
  }

  const take = Math.min(50, Number(url.searchParams.get('take') || 25))
  const unreadOnly = url.searchParams.get('unread') === '1'
  const notifications = await db.notification.findMany({
    where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
  })
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } })
  return ok({ notifications, unread })
})

const patchSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
})

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, patchSchema)
  if (body.all) {
    await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } })
  } else if (body.ids?.length) {
    await db.notification.updateMany({ where: { userId: user.id, id: { in: body.ids }, readAt: null }, data: { readAt: new Date() } })
  }
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } })
  return ok({ success: true, unread })
})

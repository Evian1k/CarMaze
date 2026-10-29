import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'

const MAX_SEARCHES = 20

// ───────────────────────── GET /api/saved-searches ─────────────────────────
export const GET = route(async () => {
  const user = await requireUser()
  const searches = await db.savedSearch.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, query: true, alertsOn: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return ok({ searches })
})

// ───────────────────────── POST /api/saved-searches ─────────────────────────
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const { name, query } = await parseBody(
    req,
    z.object({
      name: z.string().trim().min(1, 'Name is required').max(60),
      query: z.string().max(500),
    })
  )

  const count = await db.savedSearch.count({ where: { userId: user.id } })
  if (count >= MAX_SEARCHES) {
    return fail(409, 'LIMIT_REACHED', `You can save up to ${MAX_SEARCHES} searches. Remove one first.`)
  }

  try {
    const search = await db.savedSearch.create({ data: { userId: user.id, name, query } })
    return ok({ search: { id: search.id, name: search.name, query: search.query, createdAt: search.createdAt } }, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return fail(409, 'NAME_EXISTS', 'You already have a saved search with that name.')
    }
    throw e
  }
})

// ───────────────────────── DELETE /api/saved-searches ─────────────────────────
export const DELETE = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'BAD_REQUEST', 'id query parameter is required.')

  const removed = await db.savedSearch.deleteMany({ where: { id, userId: user.id } })
  if (removed.count === 0) throw new ApiError(404, 'NOT_FOUND', 'Saved search not found.')
  return ok({ removed: removed.count })
})

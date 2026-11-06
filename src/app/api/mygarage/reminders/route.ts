import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, getIp, ApiError } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const DAY_MS = 24 * 60 * 60 * 1000

const createSchema = z.object({
  myVehicleId: z.string().min(1),
  type: z.enum(['SERVICE', 'INSURANCE', 'INSPECTION', 'LICENSE', 'CUSTOM']),
  title: z.string().trim().min(2, 'Give the reminder a short title').max(80),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  intervalDays: z.coerce.number().int().min(1).max(3650).optional(),
})

const patchSchema = z.object({
  status: z.enum(['ACTIVE', 'DONE', 'DISMISSED']),
  title: z.string().trim().min(2).max(80).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  intervalDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
})

async function assertOwnedReminder(id: string, userId: string) {
  const reminder = await db.reminder.findUnique({ where: { id }, include: { myVehicle: true } })
  if (!reminder || reminder.myVehicle.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'Reminder not found.')
  return reminder
}

// GET /api/mygarage/reminders: ACTIVE first (by dueDate asc), then DONE/DISMISSED; with owning vehicle summary.
export const GET = route(async () => {
  const user = await requireUser()
  const reminders = await db.reminder.findMany({
    where: { myVehicle: { userId: user.id } },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    include: { myVehicle: { select: { make: true, model: true, plate: true } } },
  })
  // Explicit ordering: ACTIVE reminders first (dueDate asc), non-ACTIVE after (dueDate asc).
  reminders.sort((a, b) => {
    const aActive = a.status === 'ACTIVE' ? 0 : 1
    const bActive = b.status === 'ACTIVE' ? 0 : 1
    if (aActive !== bActive) return aActive - bActive
    return a.dueDate.getTime() - b.dueDate.getTime()
  })
  return ok({
    reminders: reminders.map((r) => ({
      id: r.id,
      myVehicleId: r.myVehicleId,
      type: r.type,
      title: r.title,
      dueDate: r.dueDate,
      intervalDays: r.intervalDays,
      status: r.status,
      createdAt: r.createdAt,
      vehicle: { make: r.myVehicle.make, model: r.myVehicle.model, plate: r.myVehicle.plate },
    })),
  })
})

// POST /api/mygarage/reminders: create an in-app reminder on an owned vehicle.
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`mygarage-reminder:${user.id}:${getIp(req)}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many reminders created recently. Try again later.')

  const body = await parseBody(req, createSchema)
  const vehicle = await db.myVehicle.findUnique({ where: { id: body.myVehicleId } })
  if (!vehicle || vehicle.userId !== user.id) throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found in your garage.')

  const reminder = await db.reminder.create({
    data: {
      myVehicleId: vehicle.id,
      type: body.type,
      title: body.title,
      dueDate: new Date(`${body.dueDate}T00:00:00.000Z`),
      intervalDays: body.intervalDays ?? null,
      status: 'ACTIVE',
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'REMINDER_CREATED', targetType: 'REMINDER', targetId: reminder.id, metadata: { myVehicleId: vehicle.id, type: body.type } })
  return ok({ reminder }, { status: 201 })
})

// PATCH /api/mygarage/reminders?id=: owner updates status/fields.
// Real recurring logic: marking DONE on a reminder with intervalDays creates the next occurrence.
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'BAD_REQUEST', 'id query parameter is required.')

  const reminder = await assertOwnedReminder(id, user.id)
  const body = await parseBody(req, patchSchema)

  const updated = await db.reminder.update({
    where: { id: reminder.id },
    data: {
      status: body.status,
      title: body.title ?? undefined,
      dueDate: body.dueDate ? new Date(`${body.dueDate}T00:00:00.000Z`) : undefined,
      intervalDays: body.intervalDays !== undefined ? body.intervalDays : undefined,
    },
  })

  let next: Awaited<ReturnType<typeof db.reminder.create>> | null = null
  if (body.status === 'DONE' && updated.intervalDays && updated.intervalDays > 0) {
    let nextDue = updated.dueDate.getTime()
    const now = Date.now()
    let guard = 0
    // Roll forward until the next occurrence is in the future (handles long-overdue completions).
    do {
      nextDue += updated.intervalDays * DAY_MS
      guard += 1
    } while (nextDue <= now && guard < 100)
    next = await db.reminder.create({
      data: {
        myVehicleId: updated.myVehicleId,
        type: updated.type,
        title: updated.title,
        dueDate: new Date(nextDue),
        intervalDays: updated.intervalDays,
        status: 'ACTIVE',
      },
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'REMINDER_RECURRING_RESCHEDULED', targetType: 'REMINDER', targetId: next.id, metadata: { from: reminder.id, dueDate: next.dueDate } })
  }

  await audit({ actorId: user.id, actorName: user.name, action: 'REMINDER_UPDATED', targetType: 'REMINDER', targetId: reminder.id, metadata: { status: body.status } })
  return ok({ reminder: updated, next })
})

// DELETE /api/mygarage/reminders?id=: owner only.
export const DELETE = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'BAD_REQUEST', 'id query parameter is required.')

  const reminder = await assertOwnedReminder(id, user.id)
  await db.reminder.delete({ where: { id: reminder.id } })
  await audit({ actorId: user.id, actorName: user.name, action: 'REMINDER_DELETED', targetType: 'REMINDER', targetId: reminder.id })
  return ok({ deleted: true })
})

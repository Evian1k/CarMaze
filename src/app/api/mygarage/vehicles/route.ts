import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const vehicleInput = z.object({
  make: z.string().trim().min(1, 'Make is required').max(40),
  model: z.string().trim().min(1, 'Model is required').max(60),
  year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 2).optional().nullable(),
  plate: z.string().trim().max(20).optional().nullable(),
  color: z.string().trim().max(30).optional().nullable(),
  mileageKm: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
  purchaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .nullable()
    .or(z.literal('')),
  purchasePriceMinor: z.coerce.number().int().min(0).max(10_000_000_000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

function dateFromIso(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

// GET /api/mygarage/vehicles: session user's own vehicles with records + reminders.
export const GET = route(async () => {
  const user = await requireUser()
  const vehicles = await db.myVehicle.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      records: { orderBy: { date: 'desc' } },
      reminders: { orderBy: [{ status: 'asc' }, { dueDate: 'asc' }] },
    },
  })
  return ok({ vehicles })
})

// POST /api/mygarage/vehicles: add a vehicle to the signed-in user's garage.
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`mygarage-vehicle:${user.id}:${getIp(req)}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many vehicles added recently. Try again later.')

  const body = await parseBody(req, vehicleInput)
  const vehicle = await db.myVehicle.create({
    data: {
      userId: user.id,
      make: body.make,
      model: body.model,
      year: body.year ?? null,
      plate: body.plate ? body.plate.toUpperCase() : null,
      color: body.color ?? null,
      mileageKm: body.mileageKm ?? null,
      purchaseDate: dateFromIso(body.purchaseDate || null),
      purchasePriceMinor: body.purchasePriceMinor ?? null,
      notes: body.notes ?? null,
    },
    include: { records: { orderBy: { date: 'desc' } }, reminders: { orderBy: [{ status: 'asc' }, { dueDate: 'asc' }] } },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'MY_VEHICLE_CREATED', targetType: 'MY_VEHICLE', targetId: vehicle.id })
  return ok({ vehicle }, { status: 201 })
})

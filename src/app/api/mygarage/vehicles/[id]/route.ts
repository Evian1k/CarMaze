import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<Record<string, string>> }

const patchSchema = z.object({
  make: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(60).optional(),
  year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 2).nullable().optional(),
  plate: z.string().trim().max(20).nullable().optional(),
  color: z.string().trim().max(30).nullable().optional(),
  mileageKm: z.coerce.number().int().min(0).max(2_000_000).nullable().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional().or(z.literal('').transform(() => null)),
  purchasePriceMinor: z.coerce.number().int().min(0).max(10_000_000_000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

async function ownedVehicle(id: string, userId: string) {
  const vehicle = await db.myVehicle.findUnique({ where: { id } })
  if (!vehicle || vehicle.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found in your garage.')
  return vehicle
}

// PATCH /api/mygarage/vehicles/[id] — owner-only partial update.
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const vehicle = await ownedVehicle(id, user.id)
  const body = await parseBody(req, patchSchema)

  const updated = await db.myVehicle.update({
    where: { id: vehicle.id },
    data: {
      make: body.make ?? undefined,
      model: body.model ?? undefined,
      year: body.year !== undefined ? body.year : undefined,
      plate: body.plate !== undefined ? (body.plate ? body.plate.toUpperCase() : null) : undefined,
      color: body.color ?? undefined,
      mileageKm: body.mileageKm ?? undefined,
      purchaseDate: body.purchaseDate !== undefined ? (body.purchaseDate ? new Date(`${body.purchaseDate}T00:00:00.000Z`) : null) : undefined,
      purchasePriceMinor: body.purchasePriceMinor ?? undefined,
      notes: body.notes ?? undefined,
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'MY_VEHICLE_UPDATED', targetType: 'MY_VEHICLE', targetId: vehicle.id, metadata: { fields: Object.keys(body) } })
  return ok({ vehicle: updated })
})

// DELETE /api/mygarage/vehicles/[id] — owner-only; cascades records + reminders.
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const vehicle = await ownedVehicle(id, user.id)
  await db.myVehicle.delete({ where: { id: vehicle.id } })
  await audit({ actorId: user.id, actorName: user.name, action: 'MY_VEHICLE_DELETED', targetType: 'MY_VEHICLE', targetId: vehicle.id, metadata: { make: vehicle.make, model: vehicle.model } })
  return ok({ deleted: true })
})

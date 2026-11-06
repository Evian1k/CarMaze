import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, getIp, ApiError } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const createSchema = z.object({
  myVehicleId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  type: z.enum(['SERVICE', 'REPAIR', 'INSPECTION', 'MODIFICATION', 'OTHER']),
  description: z.string().trim().max(2000).optional(),
  costMinor: z.coerce.number().int().min(0).max(10_000_000_000).optional(),
  mileageKm: z.coerce.number().int().min(0).max(2_000_000).optional(),
  garageOrgId: z.string().trim().max(64).optional(),
})

async function assertOwnedVehicle(myVehicleId: string, userId: string) {
  const vehicle = await db.myVehicle.findUnique({ where: { id: myVehicleId } })
  if (!vehicle || vehicle.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found in your garage.')
  return vehicle
}

// GET /api/mygarage/records?vehicleId=: owner-only convenience listing (records are embedded in vehicles GET).
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const vehicleId = new URL(req.url).searchParams.get('vehicleId')
  if (!vehicleId) return fail(400, 'BAD_REQUEST', 'vehicleId query parameter is required.')
  const vehicle = await db.myVehicle.findUnique({ where: { id: vehicleId } })
  if (!vehicle || vehicle.userId !== user.id) return ok({ records: [] })
  const records = await db.serviceRecord.findMany({ where: { myVehicleId: vehicle.id }, orderBy: { date: 'desc' } })
  return ok({ records })
})

// POST /api/mygarage/records: log a service/repair/inspection entry on an owned vehicle.
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`mygarage-record:${user.id}:${getIp(req)}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many records added recently. Try again later.')

  const body = await parseBody(req, createSchema)
  const vehicle = await assertOwnedVehicle(body.myVehicleId, user.id)

  const record = await db.serviceRecord.create({
    data: {
      myVehicleId: vehicle.id,
      date: new Date(`${body.date}T00:00:00.000Z`),
      type: body.type,
      description: body.description || null,
      costMinor: body.costMinor ?? null,
      mileageKm: body.mileageKm ?? null,
      garageOrgId: body.garageOrgId || null,
    },
  })

  // Keep the vehicle's known mileage in sync when a newer odometer reading is logged.
  if (body.mileageKm !== undefined && (vehicle.mileageKm === null || body.mileageKm > vehicle.mileageKm)) {
    await db.myVehicle.update({ where: { id: vehicle.id }, data: { mileageKm: body.mileageKm } })
  }

  await audit({ actorId: user.id, actorName: user.name, action: 'SERVICE_RECORD_CREATED', targetType: 'SERVICE_RECORD', targetId: record.id, metadata: { myVehicleId: vehicle.id, type: body.type } })
  return ok({ record }, { status: 201 })
})

// DELETE /api/mygarage/records?id=: owner of the vehicle only.
export const DELETE = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'BAD_REQUEST', 'id query parameter is required.')

  const record = await db.serviceRecord.findUnique({ where: { id }, include: { myVehicle: true } })
  if (!record || record.myVehicle.userId !== user.id) throw new ApiError(404, 'NOT_FOUND', 'Record not found.')

  await db.serviceRecord.delete({ where: { id: record.id } })
  await audit({ actorId: user.id, actorName: user.name, action: 'SERVICE_RECORD_DELETED', targetType: 'SERVICE_RECORD', targetId: record.id })
  return ok({ deleted: true })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'

// ───────────────────────── GET /api/saved-vehicles ─────────────────────────
export const GET = route(async () => {
  const user = await requireUser()
  const rows = await db.savedVehicle.findMany({
    where: {
      userId: user.id,
      // Draft/rejected listings keep their details private: a saved reference
      // only reveals vehicle data the caller may already see publicly (their
      // own listings are always included).
      vehicle: { OR: [{ status: 'PUBLISHED' }, { ownerId: user.id }] },
    },
    include: {
      vehicle: {
        include: {
          photos: { orderBy: { order: 'asc' as const } },
          org: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  const saved = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    vehicle: {
      id: r.vehicle.id,
      refCode: r.vehicle.refCode,
      make: r.vehicle.make,
      model: r.vehicle.model,
      year: r.vehicle.year,
      priceMinor: r.vehicle.priceMinor,
      currency: r.vehicle.currency,
      mileageKm: r.vehicle.mileageKm,
      fuel: r.vehicle.fuel,
      transmission: r.vehicle.transmission,
      bodyType: r.vehicle.bodyType,
      condition: r.vehicle.condition,
      county: r.vehicle.county,
      status: r.vehicle.status,
      featured: r.vehicle.featured,
      sellerType: r.vehicle.sellerType,
      orgName: r.vehicle.org?.name ?? null,
      photos: r.vehicle.photos,
    },
  }))
  return ok({ saved })
})

// ───────────────────────── POST /api/saved-vehicles ─────────────────────────
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const { vehicleId } = await parseBody(req, z.object({ vehicleId: z.string().min(1) }))

  const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, status: true, ownerId: true } })
  if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found.')
  // Only published marketplace vehicles (or the owner's own records) can be saved:
  // saving must never become a side channel into unpublished listing data.
  if (vehicle.status !== 'PUBLISHED' && vehicle.ownerId !== user.id) {
    throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found.')
  }

  try {
    const saved = await db.savedVehicle.create({ data: { userId: user.id, vehicleId } })
    return ok({ saved: { id: saved.id } }, { status: 201 })
  } catch (e) {
    // Already saved: treat as idempotent success.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await db.savedVehicle.findUnique({
        where: { userId_vehicleId: { userId: user.id, vehicleId } },
        select: { id: true },
      })
      return ok({ saved: { id: existing?.id ?? null }, alreadySaved: true })
    }
    throw e
  }
})

// ───────────────────────── DELETE /api/saved-vehicles ─────────────────────────
export const DELETE = route(async (req: NextRequest) => {
  const user = await requireUser()
  const vehicleId = new URL(req.url).searchParams.get('vehicleId')
  if (!vehicleId) return fail(400, 'BAD_REQUEST', 'vehicleId query parameter is required.')

  const removed = await db.savedVehicle.deleteMany({ where: { userId: user.id, vehicleId } })
  return ok({ removed: removed.count })
})

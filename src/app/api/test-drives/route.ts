import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notifyOrgMembers } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

const fuelLevels = ['E', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL'] as const

const createSchema = z.object({
  vehicleId: z.string().min(1),
  scheduledAt: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'scheduledAt must be a valid ISO date' }),
  licenceConfirmed: z.boolean(),
})

/** POST — customer books a test drive for a published dealership vehicle. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`testdrive-create:${user.id}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many test drive requests. Try again later.')

  const body = await parseBody(req, createSchema)

  if (body.licenceConfirmed !== true) {
    throw new ApiError(400, 'LICENCE_REQUIRED', 'You must confirm you hold a valid driving licence.')
  }

  const vehicle = await db.vehicle.findUnique({ where: { id: body.vehicleId } })
  if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found.')
  if (vehicle.status !== 'PUBLISHED') {
    throw new ApiError(400, 'NOT_AVAILABLE', 'This vehicle is not available for test drives.')
  }
  if (!vehicle.orgId) {
    throw new ApiError(400, 'NOT_AVAILABLE', 'Test drives are only available for dealership vehicles.')
  }

  const scheduledAt = new Date(body.scheduledAt)
  const min = Date.now() + 60 * 60 * 1000
  const max = Date.now() + 60 * 24 * 60 * 60 * 1000
  if (scheduledAt.getTime() < min) {
    throw new ApiError(400, 'INVALID_TIME', 'Choose a slot at least 1 hour from now.')
  }
  if (scheduledAt.getTime() > max) {
    throw new ApiError(400, 'INVALID_TIME', 'Choose a slot within the next 60 days.')
  }

  const testDrive = await db.testDrive.create({
    data: {
      refCode: refCode('TD-'),
      orgId: vehicle.orgId,
      vehicleId: vehicle.id,
      customerId: user.id,
      scheduledAt,
      licenceConfirmed: true,
      status: 'REQUESTED',
    },
  })

  await notifyOrgMembers(vehicle.orgId, {
    type: 'TEST_DRIVE_UPDATE',
    title: `New test drive request — ${testDrive.refCode}`,
    body: `${user.name} requested a test drive of the ${vehicle.make} ${vehicle.model} on ${scheduledAt.toLocaleString('en-KE')}.`,
    link: '/dealer?tab=testdrives',
  })

  return ok({
    testDrive: {
      id: testDrive.id,
      refCode: testDrive.refCode,
      vehicleId: testDrive.vehicleId,
      scheduledAt: testDrive.scheduledAt.toISOString(),
      status: testDrive.status,
      createdAt: testDrive.createdAt.toISOString(),
    },
  })
})

/** GET ?mine=1 (customer) | ?org=1 (dealer member) */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)

  const shapeVehicle = (v: { id: string; make: string; model: string; year: number; photos: { url: string }[] }) => ({
    id: v.id,
    make: v.make,
    model: v.model,
    year: v.year,
    photo: v.photos[0]?.url ?? null,
  })

  if (url.searchParams.get('mine') === '1') {
    const testDrives = await db.testDrive.findMany({
      where: { customerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: { select: { id: true, make: true, model: true, year: true, photos: { orderBy: { order: 'asc' }, take: 1, select: { url: true } } } },
        org: { select: { name: true } },
      },
    })
    return ok({
      testDrives: testDrives.map((td) => ({
        id: td.id,
        refCode: td.refCode,
        vehicleId: td.vehicleId,
        vehicle: shapeVehicle(td.vehicle),
        orgId: td.orgId,
        orgName: td.org.name,
        scheduledAt: td.scheduledAt.toISOString(),
        status: td.status,
        createdAt: td.createdAt.toISOString(),
      })),
    })
  }

  if (url.searchParams.get('org') === '1') {
    const memberships = await db.orgMember.findMany({ where: { userId: user.id }, select: { orgId: true } })
    const testDrives = await db.testDrive.findMany({
      where: { orgId: { in: memberships.map((m) => m.orgId) } },
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: { select: { id: true, make: true, model: true, year: true, photos: { orderBy: { order: 'asc' }, take: 1, select: { url: true } } } },
        org: { select: { name: true } },
        customer: { select: { name: true } },
      },
    })
    return ok({
      testDrives: testDrives.map((td) => ({
        id: td.id,
        refCode: td.refCode,
        vehicleId: td.vehicleId,
        vehicle: shapeVehicle(td.vehicle),
        orgId: td.orgId,
        orgName: td.org.name,
        customerName: td.customer.name,
        scheduledAt: td.scheduledAt.toISOString(),
        status: td.status,
        createdAt: td.createdAt.toISOString(),
      })),
    })
  }

  return fail(400, 'VALIDATION_ERROR', 'Provide ?mine=1 or ?org=1.')
})

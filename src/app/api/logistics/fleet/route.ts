import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const VEHICLE_TYPES = ['MOTORBIKE', 'PICKUP', 'VAN', 'TRUCK', 'TOW_TRUCK'] as const

async function requireActivePartner(userId: string) {
  const partner = await db.logisticsPartner.findUnique({ where: { ownerUserId: userId } })
  if (!partner) throw new ApiError(403, 'NOT_A_PARTNER', 'Only approved delivery partners manage a fleet.')
  if (partner.status === 'SUSPENDED') {
    throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is suspended: fleet management is disabled. Contact CARMAZE support.')
  }
  if (partner.status !== 'APPROVED') {
    throw new ApiError(403, 'PARTNER_NOT_ACTIVE', 'Your partner account is not active yet.')
  }
  return partner
}

/** GET /api/logistics/fleet: the partner's drivers, newest first, with the
 * count of non-terminal jobs each driver is currently carrying. */
export const GET = route(async () => {
  const user = await requireUser()
  const partner = await requireActivePartner(user.id)

  const drivers = await db.driver.findMany({
    where: { partnerId: partner.id },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          jobs: { where: { status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] } } },
        },
      },
    },
  })

  return ok({
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      licenseNo: d.licenseNo,
      vehicleReg: d.vehicleReg,
      vehicleType: d.vehicleType,
      status: d.status,
      activeJobs: d._count.jobs,
      createdAt: d.createdAt,
    })),
  })
})

const createSchema = z.object({
  name: z.string().trim().min(2, 'Driver name is required').max(80),
  phone: z.string().trim().min(9, 'A reachable phone number is required').max(20),
  licenseNo: z.string().trim().max(60).optional().or(z.literal('')),
  vehicleReg: z.string().trim().max(20).optional().or(z.literal('')),
  vehicleType: z.enum(VEHICLE_TYPES).optional().or(z.literal('')),
})

/** POST /api/logistics/fleet: add a driver (starts ACTIVE). Rate limited to
 * 30 creates/hour per partner. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const partner = await requireActivePartner(user.id)

  const rl = rateLimit(`fleet-create:${partner.id}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many driver additions in a short time. Please try again later.')

  const body = await parseBody(req, createSchema)

  const driver = await db.driver.create({
    data: {
      partnerId: partner.id,
      name: body.name,
      phone: body.phone,
      licenseNo: body.licenseNo || null,
      vehicleReg: body.vehicleReg || null,
      vehicleType: body.vehicleType || null,
      status: 'ACTIVE',
    },
  })

  return ok(
    {
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        licenseNo: driver.licenseNo,
        vehicleReg: driver.vehicleReg,
        vehicleType: driver.vehicleType,
        status: driver.status,
        activeJobs: 0,
        createdAt: driver.createdAt,
      },
    },
    { status: 201 },
  )
})

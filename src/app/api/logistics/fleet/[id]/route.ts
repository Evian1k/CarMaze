import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const VEHICLE_TYPES = ['MOTORBIKE', 'PICKUP', 'VAN', 'TRUCK', 'TOW_TRUCK'] as const

async function requireActivePartner(userId: string) {
  const partner = await db.logisticsPartner.findUnique({ where: { ownerUserId: userId } })
  if (!partner) throw new ApiError(403, 'NOT_A_PARTNER', 'Only approved delivery partners manage a fleet.')
  if (partner.status === 'SUSPENDED') {
    throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is suspended — fleet management is disabled. Contact CARMAZE support.')
  }
  if (partner.status !== 'APPROVED') {
    throw new ApiError(403, 'PARTNER_NOT_ACTIVE', 'Your partner account is not active yet.')
  }
  return partner
}

async function loadOwnDriver(id: string, partnerId: string) {
  const driver = await db.driver.findUnique({ where: { id } })
  if (!driver || driver.partnerId !== partnerId) {
    throw new ApiError(404, 'NOT_FOUND', 'Driver not found in your fleet.')
  }
  return driver
}

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(9).max(20).optional(),
  licenseNo: z.string().trim().max(60).optional().or(z.literal('')),
  vehicleReg: z.string().trim().max(20).optional().or(z.literal('')),
  vehicleType: z.enum(VEHICLE_TYPES).optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
})

/** PATCH /api/logistics/fleet/[id] — update driver details and/or toggle
 * ACTIVE ⇄ INACTIVE. Inactive drivers cannot be selected when accepting jobs. */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const partner = await requireActivePartner(user.id)
  const { id } = await ctx.params
  await loadOwnDriver(id, partner.id)

  const body = await parseBody(req, patchSchema)

  const driver = await db.driver.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.licenseNo !== undefined ? { licenseNo: body.licenseNo || null } : {}),
      ...(body.vehicleReg !== undefined ? { vehicleReg: body.vehicleReg || null } : {}),
      ...(body.vehicleType !== undefined ? { vehicleType: body.vehicleType || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    },
  })

  return ok({
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
  })
})

/** DELETE /api/logistics/fleet/[id] — remove a driver, but only when they are
 * not carrying any active deliveries (ASSIGNED / PICKED_UP / IN_TRANSIT). */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const partner = await requireActivePartner(user.id)
  const { id } = await ctx.params
  const driver = await loadOwnDriver(id, partner.id)

  const activeJobs = await db.deliveryJob.count({
    where: { driverId: driver.id, status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] } },
  })
  if (activeJobs > 0) {
    return fail(409, 'DRIVER_BUSY', `${driver.name} is carrying ${activeJobs} active deliver${activeJobs === 1 ? 'y' : 'ies'}. Mark them inactive instead, or wait until their deliveries finish before deleting.`)
  }

  await db.driver.delete({ where: { id } })
  return ok({ ok: true, message: `${driver.name} removed from your fleet.` })
})

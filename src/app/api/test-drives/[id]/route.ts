import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, ApiError, requireUser, parseBody, type RouteCtx } from '@/lib/api'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'
import { notifyOrgMembers } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

type Ctx = RouteCtx

function invalid(message: string): never {
  throw new ApiError(400, 'INVALID_TRANSITION', message)
}

const fuelLevels = ['E', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL'] as const
const fuelSchema = z.enum(fuelLevels).optional()
const odometerSchema = z.number().int().min(0).max(2_000_000)

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm') }),
  z.object({
    action: z.literal('start'),
    odometerOut: odometerSchema,
    fuelOut: fuelSchema,
    conditionOut: z.string().trim().max(1000).optional(),
    releasedBy: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal('complete'),
    odometerIn: odometerSchema,
    fuelIn: fuelSchema,
    conditionIn: z.string().trim().max(1000).optional(),
    returnedBy: z.string().trim().min(2).max(120),
  }),
  z.object({ action: z.literal('no-show') }),
  z.object({ action: z.literal('cancel'), note: z.string().trim().max(1000).optional() }),
])

/**
 * PATCH: test-drive appointment lifecycle.
 * ORG: confirm → start → complete, plus no-show / cancel.
 * CUSTOMER: cancel only (until the drive starts).
 */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params

  const testDrive = await db.testDrive.findUnique({
    where: { id },
    include: {
      vehicle: { select: { id: true, make: true, model: true } },
      org: { select: { id: true, name: true } },
    },
  })
  if (!testDrive) throw new ApiError(404, 'NOT_FOUND', 'Test drive not found.')

  const isCustomer = testDrive.customerId === user.id
  if (!isCustomer) {
    // Org-side actions require an ACTIVE org (suspended showroom cannot act).
    const membership = await db.orgMember.findFirst({ where: { orgId: testDrive.orgId, userId: user.id, org: { status: 'ACTIVE' } } })
    if (!membership) throw new ApiError(403, 'FORBIDDEN', 'You are not part of this test drive.')
  }

  const body = await parseBody(req, patchSchema)
  const now = new Date()
  const vehicleLabel = `${testDrive.vehicle.make} ${testDrive.vehicle.model}`

  switch (body.action) {
    case 'confirm': {
      if (isCustomer) throw new ApiError(403, 'FORBIDDEN', 'Only the dealership team can confirm a test drive.')
      if (testDrive.status !== 'REQUESTED') invalid('Only a requested test drive can be confirmed.')
      const updated = await db.testDrive.update({ where: { id }, data: { status: 'CONFIRMED' } })
      await notify({
        userId: testDrive.customerId,
        type: 'TEST_DRIVE_UPDATE',
        title: `Test drive confirmed: ${testDrive.refCode}`,
        body: `${testDrive.org.name} confirmed your ${vehicleLabel} test drive. See you there!`,
        link: '/account?tab=testdrives',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'TESTDRIVE_CONFIRMED', targetType: 'TEST_DRIVE', targetId: id, metadata: { refCode: testDrive.refCode } })
      return ok({ testDrive: { id: updated.id, refCode: updated.refCode, status: updated.status } })
    }

    case 'start': {
      if (isCustomer) throw new ApiError(403, 'FORBIDDEN', 'Only the dealership team can start a test drive.')
      if (testDrive.status !== 'CONFIRMED') invalid('Only a confirmed test drive can start.')
      const updated = await db.testDrive.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: now,
          odometerOut: body.odometerOut,
          fuelOut: body.fuelOut ?? undefined,
          conditionOut: body.conditionOut ?? undefined,
          releasedBy: body.releasedBy,
        },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'TESTDRIVE_STARTED', targetType: 'TEST_DRIVE', targetId: id, metadata: { refCode: testDrive.refCode, releasedBy: body.releasedBy, odometerOut: body.odometerOut } })
      return ok({ testDrive: { id: updated.id, refCode: updated.refCode, status: updated.status, startedAt: updated.startedAt?.toISOString() ?? null } })
    }

    case 'complete': {
      if (isCustomer) throw new ApiError(403, 'FORBIDDEN', 'Only the dealership team can complete a test drive.')
      if (testDrive.status !== 'IN_PROGRESS') invalid('Only an in-progress test drive can be completed.')
      const updated = await db.testDrive.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          endedAt: now,
          odometerIn: body.odometerIn,
          fuelIn: body.fuelIn ?? undefined,
          conditionIn: body.conditionIn ?? undefined,
          returnedBy: body.returnedBy,
        },
      })
      await notify({
        userId: testDrive.customerId,
        type: 'TEST_DRIVE_UPDATE',
        title: `Test drive completed: ${testDrive.refCode}`,
        body: `Thanks for driving the ${vehicleLabel} with ${testDrive.org.name}. Interested? Send the dealer a message.`,
        link: '/account?tab=testdrives',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'TESTDRIVE_COMPLETED', targetType: 'TEST_DRIVE', targetId: id, metadata: { refCode: testDrive.refCode, returnedBy: body.returnedBy, odometerIn: body.odometerIn } })
      return ok({ testDrive: { id: updated.id, refCode: updated.refCode, status: updated.status, endedAt: updated.endedAt?.toISOString() ?? null } })
    }

    case 'no-show': {
      if (isCustomer) throw new ApiError(403, 'FORBIDDEN', 'Only the dealership team can mark a no-show.')
      if (!['REQUESTED', 'CONFIRMED'].includes(testDrive.status)) {
        invalid(`A test drive in state ${testDrive.status} cannot be marked as a no-show.`)
      }
      const updated = await db.testDrive.update({ where: { id }, data: { status: 'NO_SHOW' } })
      await audit({ actorId: user.id, actorName: user.name, action: 'TESTDRIVE_NO_SHOW', targetType: 'TEST_DRIVE', targetId: id, metadata: { refCode: testDrive.refCode } })
      return ok({ testDrive: { id: updated.id, refCode: updated.refCode, status: updated.status } })
    }

    case 'cancel': {
      if (!['REQUESTED', 'CONFIRMED'].includes(testDrive.status)) {
        invalid(`A test drive in state ${testDrive.status} can no longer be cancelled.`)
      }
      const updated = await db.testDrive.update({
        where: { id },
        data: { status: 'CANCELLED', notes: body.note ?? undefined },
      })
      if (isCustomer) {
        await notifyOrgMembers(testDrive.orgId, {
          type: 'TEST_DRIVE_UPDATE',
          title: `Test drive cancelled: ${testDrive.refCode}`,
          body: `${user.name} cancelled the ${vehicleLabel} test drive${body.note ? `: ${body.note}` : '.'}`,
          link: '/dealer?tab=testdrives',
        })
      } else {
        await notify({
          userId: testDrive.customerId,
          type: 'TEST_DRIVE_UPDATE',
          title: `Test drive cancelled: ${testDrive.refCode}`,
          body: `${testDrive.org.name} cancelled your ${vehicleLabel} test drive${body.note ? `: ${body.note}` : '.'}`,
          link: '/account?tab=testdrives',
        })
      }
      await audit({ actorId: user.id, actorName: user.name, action: 'TESTDRIVE_CANCELLED', targetType: 'TEST_DRIVE', targetId: id, metadata: { refCode: testDrive.refCode, by: isCustomer ? 'CUSTOMER' : 'ORG' } })
      return ok({ testDrive: { id: updated.id, refCode: updated.refCode, status: updated.status } })
    }
  }
})

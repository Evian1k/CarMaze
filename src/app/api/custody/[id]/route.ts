import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { route, ok, fail, ApiError, requireUser, parseBody, type RouteCtx } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'
import { notifyOrgMembers, staffUserIds } from '@/lib/orgs'
import { parseJson } from '@/lib/json'

export const dynamic = 'force-dynamic'

type Ctx = RouteCtx

function invalid(message: string): never {
  throw new ApiError(400, 'INVALID_TRANSITION', message)
}

async function loadCustody(id: string) {
  const custody = await db.vehicleCustody.findUnique({
    where: { id },
    include: {
      org: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
      events: { orderBy: { createdAt: 'asc' } },
      roadTests: { orderBy: { requestedAt: 'asc' } },
      collectionAuth: true,
    },
  })
  if (!custody) throw new ApiError(404, 'NOT_FOUND', 'Custody record not found.')
  return custody
}

function iso(d: Date): string {
  return d.toISOString()
}

/** GET — full custody record for participants (customer owner or garage member). */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const custody = await loadCustody(id)

  const isCustomer = custody.customerId === user.id
  if (!isCustomer) {
    const membership = await db.orgMember.findFirst({ where: { orgId: custody.orgId, userId: user.id } })
    if (!membership) throw new ApiError(403, 'FORBIDDEN', 'You are not part of this custody record.')
  }

  return ok({
    custody: {
      id: custody.id,
      refCode: custody.refCode,
      orgId: custody.orgId,
      orgName: custody.org.name,
      customerId: custody.customerId,
      customerName: custody.customer.name,
      myVehicleId: custody.myVehicleId,
      vehicleDesc: custody.vehicleDesc,
      plate: custody.plate,
      odometerKm: custody.odometerKm,
      fuelLevel: custody.fuelLevel,
      conditionNotes: custody.conditionNotes,
      photos: parseJson<string[]>(custody.photos, []),
      valuables: custody.valuables,
      requestedWork: custody.requestedWork,
      authorisedSpendMinor: custody.authorisedSpendMinor,
      roadTestAllowed: custody.roadTestAllowed,
      status: custody.status,
      receivedAt: custody.receivedAt ? iso(custody.receivedAt) : null,
      receivedByStaffName: custody.receivedByStaffName,
      readyAt: custody.readyAt ? iso(custody.readyAt) : null,
      completedWork: custody.completedWork,
      finalOdometerKm: custody.finalOdometerKm,
      finalNotes: custody.finalNotes,
      completionPhotos: parseJson<string[]>(custody.completionPhotos, []),
      costMinor: custody.costMinor,
      collectedAt: custody.collectedAt ? iso(custody.collectedAt) : null,
      collectedByName: custody.collectedByName,
      returnedAt: custody.returnedAt ? iso(custody.returnedAt) : null,
      createdAt: iso(custody.createdAt),
      updatedAt: iso(custody.updatedAt),
      events: custody.events.map((e) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorId: e.actorId,
        actorName: e.actorName,
        actorSide: e.actorSide,
        note: e.note,
        createdAt: iso(e.createdAt),
      })),
      roadTests: custody.roadTests.map((rt) => ({
        id: rt.id,
        purpose: rt.purpose,
        driverName: rt.driverName,
        startOdometerKm: rt.startOdometerKm,
        endOdometerKm: rt.endOdometerKm,
        requestedAt: iso(rt.requestedAt),
        authorisedAt: rt.authorisedAt ? iso(rt.authorisedAt) : null,
        startedAt: rt.startedAt ? iso(rt.startedAt) : null,
        endedAt: rt.endedAt ? iso(rt.endedAt) : null,
        status: rt.status,
        notes: rt.notes,
        incident: rt.incident,
      })),
      // authCodeHash is NEVER exposed — only metadata for verification UX.
      collectionAuth: custody.collectionAuth
        ? {
            collectorName: custody.collectionAuth.collectorName,
            collectorPhone: custody.collectionAuth.collectorPhone,
            codeHint: custody.collectionAuth.codeHint,
            expiresAt: iso(custody.collectionAuth.expiresAt),
            usedAt: custody.collectionAuth.usedAt ? iso(custody.collectionAuth.usedAt) : null,
            revokedAt: custody.collectionAuth.revokedAt ? iso(custody.collectionAuth.revokedAt) : null,
          }
        : null,
    },
  })
})

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('receive'), staffName: z.string().trim().min(2).max(120) }),
  z.object({
    action: z.literal('status'),
    status: z.enum(['INSPECTION', 'AWAITING_APPROVAL', 'WORK_IN_PROGRESS', 'READY_FOR_COLLECTION']),
    note: z.string().trim().max(2000).optional(),
    completedWork: z.string().trim().max(4000).optional(),
    finalOdometerKm: z.number().int().min(0).max(2_000_000).optional(),
    finalNotes: z.string().trim().max(2000).optional(),
    completionPhotos: z.array(z.string().trim().min(1).max(500)).max(6).optional(),
    costMinor: z.number().int().min(0).max(9_999_999_999).optional(),
  }),
  z.object({ action: z.literal('note'), note: z.string().trim().min(1).max(2000) }),
  z.object({
    action: z.literal('request-roadtest'),
    purpose: z.string().trim().min(3).max(300),
    driverName: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal('start-roadtest'),
    roadTestId: z.string().min(1),
    startOdometerKm: z.number().int().min(0).max(2_000_000),
  }),
  z.object({
    action: z.literal('end-roadtest'),
    roadTestId: z.string().min(1),
    endOdometerKm: z.number().int().min(0).max(2_000_000),
    notes: z.string().trim().max(2000).optional(),
    incident: z.boolean().optional(),
  }),
  z.object({ action: z.literal('authorize-roadtest'), roadTestId: z.string().min(1) }),
  z.object({ action: z.literal('decline-roadtest'), roadTestId: z.string().min(1), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('collect-self') }),
  z.object({ action: z.literal('dispute'), note: z.string().trim().min(10).max(4000) }),
])

const WORK_STATUSES = ['INSPECTION', 'AWAITING_APPROVAL', 'WORK_IN_PROGRESS'] as const
const STATUS_ACTION_FROM = ['RECEIVED', 'INSPECTION', 'AWAITING_APPROVAL', 'WORK_IN_PROGRESS', 'ROAD_TEST_REQUESTED'] as const

/**
 * PATCH — custody lifecycle transitions.
 * ORG actions: receive, status, note, request-roadtest, start-roadtest, end-roadtest.
 * CUSTOMER actions: authorize-roadtest, decline-roadtest, collect-self, dispute.
 * Every transition is guarded; violations return 400 INVALID_TRANSITION.
 */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const custody = await loadCustody(id)

  const isCustomer = custody.customerId === user.id
  const membership = isCustomer ? null : await db.orgMember.findFirst({ where: { orgId: custody.orgId, userId: user.id } })
  if (!isCustomer && !membership) throw new ApiError(403, 'FORBIDDEN', 'You are not part of this custody record.')

  const requireOrg = () => {
    if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Only the garage team can perform this action.')
  }
  const requireCustomer = () => {
    if (!isCustomer) throw new ApiError(403, 'FORBIDDEN', 'Only the vehicle owner can perform this action.')
  }

  const body = await parseBody(req, patchSchema)
  const now = new Date()
  const orgLink = { type: 'CUSTODY_UPDATE' as const, link: '/garage-dashboard?tab=custody' }

  const loadRoadTest = async (roadTestId: string) => {
    const rt = await db.roadTest.findUnique({ where: { id: roadTestId } })
    if (!rt || rt.custodyId !== id) throw new ApiError(404, 'NOT_FOUND', 'Road test not found.')
    return rt
  }

  switch (body.action) {
    // ─────────────────────────── ORG: receive ───────────────────────────
    case 'receive': {
      requireOrg()
      if (custody.status !== 'HANDOVER_REQUESTED') {
        invalid('The vehicle can only be received once, from a handover request.')
      }
      await db.$transaction([
        db.vehicleCustody.update({
          where: { id },
          data: { status: 'RECEIVED', receivedAt: now, receivedByStaffName: body.staffName },
        }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'STATUS_CHANGE',
            fromStatus: custody.status,
            toStatus: 'RECEIVED',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'ORG',
            note: `Vehicle received by ${body.staffName}.`,
          },
        }),
      ])
      await notify({
        userId: custody.customerId,
        type: 'CUSTODY_UPDATE',
        title: `Your vehicle was received — ${custody.refCode}`,
        body: `${custody.org.name} received your ${custody.vehicleDesc}. Track progress in Vehicle Protection.`,
        link: '/account?tab=protection',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_RECEIVED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode, staffName: body.staffName } })
      return ok({ custody: { id, refCode: custody.refCode, status: 'RECEIVED' } })
    }

    // ─────────────────────────── ORG: status ───────────────────────────
    case 'status': {
      requireOrg()
      if (!(STATUS_ACTION_FROM as readonly string[]).includes(custody.status)) {
        invalid(`Cannot change status while the custody record is ${custody.status}.`)
      }
      if (
        body.status === 'READY_FOR_COLLECTION' &&
        (!body.completedWork || body.completedWork.trim().length < 5)
      ) {
        invalid('A completed work summary (min 5 characters) is required to mark the vehicle ready for collection.')
      }
      const data: Prisma.VehicleCustodyUpdateInput = { status: body.status }
      if (body.status === 'READY_FOR_COLLECTION') data.readyAt = now
      if (body.completedWork !== undefined) data.completedWork = body.completedWork
      if (body.finalOdometerKm !== undefined) data.finalOdometerKm = body.finalOdometerKm
      if (body.finalNotes !== undefined) data.finalNotes = body.finalNotes
      if (body.completionPhotos !== undefined) data.completionPhotos = JSON.stringify(body.completionPhotos)
      if (body.costMinor !== undefined) data.costMinor = body.costMinor

      await db.$transaction([
        db.vehicleCustody.update({ where: { id }, data }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'STATUS_CHANGE',
            fromStatus: custody.status,
            toStatus: body.status,
            actorId: user.id,
            actorName: user.name,
            actorSide: 'ORG',
            note: body.note ?? (body.status === 'READY_FOR_COLLECTION' ? 'Work completed — ready for collection.' : null),
          },
        }),
      ])
      if (body.status === 'READY_FOR_COLLECTION') {
        await notify({
          userId: custody.customerId,
          type: 'CUSTODY_UPDATE',
          title: `Ready for collection — ${custody.refCode}`,
          body: `Your ${custody.vehicleDesc} is ready for collection at ${custody.org.name}.`,
          link: '/account?tab=protection',
        })
      }
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_STATUS_CHANGED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode, from: custody.status, to: body.status } })
      return ok({ custody: { id, refCode: custody.refCode, status: body.status } })
    }

    // ─────────────────────────── ORG: note ───────────────────────────
    case 'note': {
      requireOrg()
      await db.custodyEvent.create({
        data: { custodyId: id, type: 'NOTE', actorId: user.id, actorName: user.name, actorSide: 'ORG', note: body.note },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_NOTE_ADDED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode } })
      return ok({ custody: { id, refCode: custody.refCode, status: custody.status } })
    }

    // ─────────────────────── ORG: request-roadtest ───────────────────────
    case 'request-roadtest': {
      requireOrg()
      if (!(WORK_STATUSES as readonly string[]).includes(custody.status)) {
        invalid('A road test can only be requested while the vehicle is under inspection or work.')
      }
      const active = await db.roadTest.findFirst({
        where: { custodyId: id, status: { in: ['REQUESTED', 'AUTHORISED', 'IN_PROGRESS'] } },
      })
      if (active) invalid('There is already an active road test for this vehicle.')
      await db.$transaction([
        db.roadTest.create({
          data: { custodyId: id, purpose: body.purpose, driverName: body.driverName, status: 'REQUESTED' },
        }),
        db.vehicleCustody.update({ where: { id }, data: { status: 'ROAD_TEST_REQUESTED' } }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'ROAD_TEST',
            fromStatus: custody.status,
            toStatus: 'ROAD_TEST_REQUESTED',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'ORG',
            note: `Road test requested — ${body.purpose} (driver: ${body.driverName}).`,
          },
        }),
      ])
      await notify({
        userId: custody.customerId,
        type: 'CUSTODY_UPDATE',
        title: `Road test requested — ${custody.refCode}`,
        body: `${custody.org.name} asks permission to road test your ${custody.vehicleDesc}: ${body.purpose}.`,
        link: '/account?tab=protection',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_ROADTEST_REQUESTED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode, purpose: body.purpose } })
      return ok({ custody: { id, refCode: custody.refCode, status: 'ROAD_TEST_REQUESTED' } })
    }

    // ─────────────────────── ORG: start-roadtest ───────────────────────
    case 'start-roadtest': {
      requireOrg()
      const rt = await loadRoadTest(body.roadTestId)
      if (rt.status !== 'AUTHORISED') invalid('Only an authorised road test can be started.')
      await db.$transaction([
        db.roadTest.update({
          where: { id: rt.id },
          data: { status: 'IN_PROGRESS', startedAt: now, startOdometerKm: body.startOdometerKm },
        }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'ROAD_TEST',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'ORG',
            note: `Road test started (odometer ${body.startOdometerKm} km, driver: ${rt.driverName}).`,
          },
        }),
      ])
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_ROADTEST_STARTED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode, roadTestId: rt.id } })
      return ok({ custody: { id, refCode: custody.refCode, status: custody.status }, roadTest: { id: rt.id, status: 'IN_PROGRESS' } })
    }

    // ─────────────────────── ORG: end-roadtest ───────────────────────
    case 'end-roadtest': {
      requireOrg()
      const rt = await loadRoadTest(body.roadTestId)
      if (rt.status !== 'IN_PROGRESS') invalid('Only an in-progress road test can be ended.')
      const incident = body.incident ?? false
      await db.$transaction([
        db.roadTest.update({
          where: { id: rt.id },
          data: {
            status: 'COMPLETED',
            endedAt: now,
            endOdometerKm: body.endOdometerKm,
            notes: body.notes ?? undefined,
            incident,
          },
        }),
        db.vehicleCustody.update({ where: { id }, data: { status: 'WORK_IN_PROGRESS' } }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'ROAD_TEST',
            fromStatus: custody.status,
            toStatus: 'WORK_IN_PROGRESS',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'ORG',
            note: incident ? 'Road test ended — incident reported.' : `Road test ended (odometer ${body.endOdometerKm} km).`,
          },
        }),
      ])
      if (incident) {
        await db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'NOTE',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'ORG',
            note: `Road-test incident recorded during ${custody.refCode}.`,
          },
        })
        await notify({
          userId: custody.customerId,
          type: 'CUSTODY_UPDATE',
          title: `Road test incident — ${custody.refCode}`,
          body: `The garage reported an incident during the road test of your ${custody.vehicleDesc}. See the custody timeline for details.`,
          link: '/account?tab=protection',
        })
      }
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_ROADTEST_ENDED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode, roadTestId: rt.id, incident } })
      return ok({ custody: { id, refCode: custody.refCode, status: 'WORK_IN_PROGRESS' }, roadTest: { id: rt.id, status: 'COMPLETED' } })
    }

    // ─────────────────── CUSTOMER: authorize-roadtest ───────────────────
    case 'authorize-roadtest': {
      requireCustomer()
      const rt = await loadRoadTest(body.roadTestId)
      if (rt.status !== 'REQUESTED') invalid('Only a requested road test can be authorised.')
      await db.$transaction([
        db.roadTest.update({ where: { id: rt.id }, data: { status: 'AUTHORISED', authorisedAt: now } }),
        db.vehicleCustody.update({ where: { id }, data: { status: 'WORK_IN_PROGRESS' } }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'ROAD_TEST',
            fromStatus: custody.status,
            toStatus: 'WORK_IN_PROGRESS',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'CUSTOMER',
            note: 'Customer authorised the road test.',
          },
        }),
      ])
      await notifyOrgMembers(custody.orgId, {
        ...orgLink,
        title: `Road test authorised — ${custody.refCode}`,
        body: `${user.name} authorised the road test of the ${custody.vehicleDesc}.`,
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_ROADTEST_AUTHORISED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode, roadTestId: rt.id } })
      return ok({ custody: { id, refCode: custody.refCode, status: 'WORK_IN_PROGRESS' }, roadTest: { id: rt.id, status: 'AUTHORISED' } })
    }

    // ─────────────────── CUSTOMER: decline-roadtest ───────────────────
    case 'decline-roadtest': {
      requireCustomer()
      const rt = await loadRoadTest(body.roadTestId)
      if (rt.status !== 'REQUESTED') invalid('Only a requested road test can be declined.')
      await db.$transaction([
        db.roadTest.update({
          where: { id: rt.id },
          data: { status: 'DECLINED', notes: body.note ?? undefined },
        }),
        db.vehicleCustody.update({ where: { id }, data: { status: 'WORK_IN_PROGRESS' } }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'ROAD_TEST',
            fromStatus: custody.status,
            toStatus: 'WORK_IN_PROGRESS',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'CUSTOMER',
            note: body.note ? `Customer declined the road test — ${body.note}` : 'Customer declined the road test.',
          },
        }),
      ])
      await notifyOrgMembers(custody.orgId, {
        ...orgLink,
        title: `Road test declined — ${custody.refCode}`,
        body: `${user.name} declined the road test of the ${custody.vehicleDesc}.`,
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_ROADTEST_DECLINED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode, roadTestId: rt.id } })
      return ok({ custody: { id, refCode: custody.refCode, status: 'WORK_IN_PROGRESS' }, roadTest: { id: rt.id, status: 'DECLINED' } })
    }

    // ─────────────────── CUSTOMER: collect-self ───────────────────
    case 'collect-self': {
      requireCustomer()
      if (custody.status !== 'READY_FOR_COLLECTION') {
        invalid('The vehicle is not ready for collection yet.')
      }
      await db.$transaction([
        db.vehicleCustody.update({
          where: { id },
          data: { status: 'RETURNED', collectedAt: now, collectedByName: user.name, returnedAt: now },
        }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'COLLECTION',
            fromStatus: custody.status,
            toStatus: 'RETURNED',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'CUSTOMER',
            note: 'Customer collected the vehicle in person.',
          },
        }),
      ])
      await notifyOrgMembers(custody.orgId, {
        ...orgLink,
        title: `Vehicle collected — ${custody.refCode}`,
        body: `${user.name} collected the ${custody.vehicleDesc}.`,
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_COLLECTED_SELF', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode } })
      return ok({ custody: { id, refCode: custody.refCode, status: 'RETURNED' } })
    }

    // ─────────────────── CUSTOMER: dispute ───────────────────
    case 'dispute': {
      requireCustomer()
      if (custody.status === 'RETURNED') {
        invalid('A returned custody record cannot be disputed — contact CARMAZE support instead.')
      }
      const incident = await db.securityIncident.create({
        data: {
          refCode: refCode('INC-'),
          category: 'DAMAGE_IN_CUSTODY',
          reporterId: user.id,
          reporterSide: 'CUSTOMER',
          orgId: custody.orgId,
          custodyId: custody.id,
          vehicleDesc: custody.vehicleDesc,
          title: `Custody dispute ${custody.refCode}`,
          details: body.note,
          status: 'OPEN',
        },
      })
      await db.incidentEvent.create({
        data: {
          incidentId: incident.id,
          type: 'CREATED',
          actorId: user.id,
          actorName: user.name,
          note: 'Incident opened automatically from a custody dispute.',
        },
      })
      await db.$transaction([
        db.vehicleCustody.update({ where: { id }, data: { status: 'DISPUTED' } }),
        db.custodyEvent.create({
          data: {
            custodyId: id,
            type: 'INCIDENT',
            fromStatus: custody.status,
            toStatus: 'DISPUTED',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'CUSTOMER',
            note: `Dispute opened (${incident.refCode}): ${body.note}`,
          },
        }),
      ])
      const staff = await staffUserIds('ADMIN', 'FOUNDER')
      await notifyMany(staff, {
        type: 'INCIDENT_CREATED',
        title: `Custody dispute — ${custody.refCode}`,
        body: `${user.name} disputed custody at ${custody.org.name}. Review the incident queue.`,
        link: '/admin?tab=incidents',
      })
      await notifyOrgMembers(custody.orgId, {
        ...orgLink,
        title: `Custody dispute opened — ${custody.refCode}`,
        body: `${user.name} raised a dispute on the ${custody.vehicleDesc}. CARMAZE security has been notified.`,
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CUSTODY_DISPUTED', targetType: 'VEHICLE_CUSTODY', targetId: id, metadata: { refCode: custody.refCode, incidentId: incident.id } })
      return ok({ custody: { id, refCode: custody.refCode, status: 'DISPUTED' }, incident: { id: incident.id, refCode: incident.refCode } })
    }
  }
})

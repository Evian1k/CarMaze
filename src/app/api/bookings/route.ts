import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody } from '@/lib/api'
import { hasRole } from '@/lib/auth'
import { notify, notifyMany } from '@/lib/notify'
import { audit as writeAudit } from '@/lib/audit'

// NOTE: audit is imported once below (see `recordAudit`) to keep call sites uniform.
async function recordAudit(actorId: string, actorName: string, action: string, targetId: string, metadata: Record<string, unknown>) {
  await writeAudit({ actorId, actorName, action, targetType: 'BOOKING', targetId, metadata })
}

// ─────────────────────────── GET ───────────────────────────

export const GET = route(async (req: NextRequest) => {
  const url = new URL(req.url)

  // ── Garage view: bookings for my org(s), with customer contact ──
  if (url.searchParams.get('org') === '1') {
    const user = await requireUser()
    // Authorisation requires BOTH the platform role AND an org membership —
    // revoking either immediately removes access.
    if (!hasRole(user, 'GARAGE_OWNER', 'GARAGE_STAFF')) {
      throw new ApiError(403, 'ROLE_REQUIRED', 'Garage access has not been granted to this account.')
    }
    const memberships = await db.orgMember.findMany({
      where: { userId: user.id, org: { type: 'GARAGE', status: 'ACTIVE' } },
      select: { orgId: true },
    })
    if (memberships.length === 0) throw new ApiError(403, 'FORBIDDEN', 'Garage membership required.')
    const orgIds = memberships.map((m) => m.orgId)
    const requestedOrgId = url.searchParams.get('orgId')
    const where = { orgId: requestedOrgId && orgIds.includes(requestedOrgId) ? requestedOrgId : { in: orgIds } }

    const bookings = await db.booking.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, requestId: true, orgId: true, scheduledAt: true, status: true, notes: true, createdAt: true, updatedAt: true,
        org: { select: { id: true, name: true } },
        request: {
          select: {
            id: true, refCode: true, category: true, description: true, vehicleDesc: true,
            county: true, town: true, status: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    })
    return ok({ bookings })
  }

  // ── Customer view: my bookings ──
  if (url.searchParams.get('mine') === '1') {
    const user = await requireUser()
    const bookings = await db.booking.findMany({
      where: { request: { customerId: user.id } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, requestId: true, scheduledAt: true, status: true, notes: true, createdAt: true, updatedAt: true,
        org: { select: { id: true, name: true, phone: true, county: true, town: true, location: true } },
        request: { select: { id: true, refCode: true, category: true, status: true, description: true } },
      },
    })
    return ok({ bookings })
  }

  return fail(400, 'VALIDATION_ERROR', 'Specify ?org=1 or ?mine=1.')
})

// ─────────────────────────── PATCH — state machine ───────────────────────────

const patchSchema = z.object({
  action: z.enum(['schedule', 'start', 'complete', 'cancel']),
  scheduledAt: z.string().optional(), // ISO datetime for 'schedule'
  notes: z.string().trim().max(1000).optional(),
})

async function loadBooking(id: string) {
  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      request: {
        select: {
          id: true, refCode: true, customerId: true, category: true, status: true,
          customer: { select: { id: true, name: true } },
        },
      },
      org: { select: { id: true, name: true } },
    },
  })
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.')
  return booking
}

async function requireOrgMember(userId: string, orgId: string) {
  const membership = await db.orgMember.findFirst({ where: { orgId, userId } })
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Garage membership required for this action.')
  return membership
}

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'VALIDATION_ERROR', 'Missing ?id=.')

  const booking = await loadBooking(id)
  const body = await parseBody(req, patchSchema)
  const isGarageSide = Boolean(await db.orgMember.findFirst({ where: { orgId: booking.orgId, userId: user.id } }))
  const isCustomer = booking.request.customerId === user.id

  switch (body.action) {
    case 'schedule': {
      await requireOrgMember(user.id, booking.orgId)
      if (!['CONFIRMED', 'IN_PROGRESS'].includes(booking.status)) {
        throw new ApiError(409, 'INVALID_STATE', `Only confirmed bookings can be scheduled (current: ${booking.status}).`)
      }
      if (!body.scheduledAt) throw new ApiError(400, 'VALIDATION_ERROR', 'Provide scheduledAt (ISO date/time).')
      const when = new Date(body.scheduledAt)
      if (Number.isNaN(when.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', 'scheduledAt is not a valid date/time.')

      const updated = await db.booking.update({
        where: { id: booking.id },
        data: { scheduledAt: when },
      })
      await notify({
        userId: booking.request.customerId,
        type: 'BOOKING_SCHEDULED',
        title: `Booking scheduled — ${booking.request.refCode}`,
        body: `${booking.org.name} scheduled your service for ${when.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}.`,
        link: '/account?tab=requests',
      })
      await recordAudit(user.id, user.name, 'BOOKING_SCHEDULED', booking.id, { requestRef: booking.request.refCode, scheduledAt: when.toISOString() })
      return ok({ booking: updated })
    }

    case 'start': {
      await requireOrgMember(user.id, booking.orgId)
      if (booking.status !== 'CONFIRMED') {
        throw new ApiError(409, 'INVALID_STATE', `Only confirmed bookings can be started (current: ${booking.status}).`)
      }
      const updated = await db.booking.update({
        where: { id: booking.id },
        data: { status: 'IN_PROGRESS' },
      })
      await db.serviceRequest.update({ where: { id: booking.requestId }, data: { status: 'IN_PROGRESS' } })
      await notify({
        userId: booking.request.customerId,
        type: 'BOOKING_STARTED',
        title: `Work started — ${booking.request.refCode}`,
        body: `${booking.org.name} started work on your vehicle.`,
        link: '/account?tab=requests',
      })
      await recordAudit(user.id, user.name, 'BOOKING_STARTED', booking.id, { requestRef: booking.request.refCode })
      return ok({ booking: updated })
    }

    case 'complete': {
      await requireOrgMember(user.id, booking.orgId)
      if (booking.status !== 'IN_PROGRESS') {
        throw new ApiError(409, 'INVALID_STATE', `Only in-progress bookings can be completed (current: ${booking.status}).`)
      }
      const updated = await db.booking.update({
        where: { id: booking.id },
        data: { status: 'COMPLETED', notes: body.notes ?? booking.notes },
      })
      await db.serviceRequest.update({ where: { id: booking.requestId }, data: { status: 'COMPLETED' } })
      await notify({
        userId: booking.request.customerId,
        type: 'BOOKING_COMPLETED',
        title: `Service completed — ${booking.request.refCode}`,
        body: `${booking.org.name} marked your service as completed. How did it go? Leave a review.`,
        link: '/garages',
      })
      // Loyalty: a completed service earns the customer +250 points. Guarded by
      // a ledger check (userId + reason + refId) so re-completions/retries never
      // double-award; points failure NEVER fails the booking transition.
      try {
        const alreadyAwarded = await db.loyaltyLedger.findFirst({
          where: { userId: booking.request.customerId, reason: 'SERVICE_COMPLETED', refId: booking.id },
        })
        if (!alreadyAwarded) {
          await db.loyaltyLedger.create({
            data: {
              userId: booking.request.customerId,
              points: 250,
              reason: 'SERVICE_COMPLETED',
              refType: 'BOOKING',
              refId: booking.id,
              note: `Service completed — ${booking.org.name}`,
            },
          })
        }
      } catch (e) {
        console.error('[bookings] loyalty award failed (ignored)', e)
      }
      await recordAudit(user.id, user.name, 'BOOKING_COMPLETED', booking.id, { requestRef: booking.request.refCode, notes: Boolean(body.notes) })
      return ok({ booking: updated })
    }

    case 'cancel': {
      if (!isGarageSide && !isCustomer) throw new ApiError(403, 'FORBIDDEN', 'Only the customer or the garage can cancel this booking.')
      if (!['CONFIRMED', 'IN_PROGRESS'].includes(booking.status)) {
        throw new ApiError(409, 'INVALID_STATE', `Bookings in state ${booking.status} cannot be cancelled.`)
      }
      const updated = await db.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED', notes: body.notes ?? booking.notes },
      })
      await db.serviceRequest.update({ where: { id: booking.requestId }, data: { status: 'CANCELLED' } })
      const members = await db.orgMember.findMany({ where: { orgId: booking.orgId }, select: { userId: true } })
      await notifyMany(members.map((m) => m.userId), {
        type: 'BOOKING_CANCELLED',
        title: `Booking cancelled — ${booking.request.refCode}`,
        body: `${isCustomer ? 'The customer' : 'The garage'} cancelled this booking${body.notes ? `: ${body.notes}` : '.'}`,
        link: '/garage-dashboard?tab=bookings',
      })
      if (!isCustomer) {
        await notify({
          userId: booking.request.customerId,
          type: 'BOOKING_CANCELLED',
          title: `Booking cancelled — ${booking.request.refCode}`,
          body: `${booking.org.name} cancelled your booking${body.notes ? `: ${body.notes}` : '.'}`,
          link: '/account?tab=requests',
        })
      }
      await recordAudit(user.id, user.name, 'BOOKING_CANCELLED', booking.id, { requestRef: booking.request.refCode, by: isCustomer ? 'CUSTOMER' : 'GARAGE' })
      return ok({ booking: updated })
    }
  }
})

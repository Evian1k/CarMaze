import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { sixDigitCode, shareId } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/* ─────────────────────────── helpers ─────────────────────────── */

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function money(kesMinor: number): string {
  return (kesMinor / 100).toLocaleString('en-KE')
}

const JOB_INCLUDE = {
  partner: { select: { id: true, name: true, county: true, phone: true, ownerUserId: true } },
  driver: { select: { id: true, name: true, phone: true, vehicleReg: true, vehicleType: true } },
  events: { orderBy: { createdAt: 'asc' } },
} as const

async function loadJob(id: string) {
  const job = await db.deliveryJob.findUnique({ where: { id }, include: JOB_INCLUDE })
  if (!job) throw new ApiError(404, 'NOT_FOUND', 'Delivery not found.')
  return job
}

function baseJob(j: Awaited<ReturnType<typeof loadJob>>) {
  return {
    id: j.id,
    refCode: j.refCode,
    status: j.status,
    cargoDesc: j.cargoDesc,
    sizeClass: j.sizeClass,
    pickupCounty: j.pickupCounty,
    pickupAddress: j.pickupAddress,
    pickupContactName: j.pickupContactName,
    pickupContactPhone: j.pickupContactPhone,
    dropCounty: j.dropCounty,
    dropAddress: j.dropAddress,
    dropContactName: j.dropContactName,
    dropContactPhone: j.dropContactPhone,
    requesterOrgName: j.requesterOrgName,
    feeMinor: j.feeMinor,
    failReason: j.failReason,
    pickupAt: j.pickupAt,
    deliveredAt: j.deliveredAt,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    partner: j.partner ? { id: j.partner.id, name: j.partner.name, county: j.partner.county, phone: j.partner.phone } : null,
    driver: j.driver,
    events: j.events.map((e) => ({ id: e.id, type: e.type, actorName: e.actorName, actorSide: e.actorSide, note: e.note, createdAt: e.createdAt })),
  }
}

/* ─────────────────────────── GET — detail ───────────────────────────
 * Requester: otpHint + events + podPhotos (never otpHash).
 * Assigned partner owner: contacts + events (NO otp data at all).
 * Staff: like the requester (read-only oversight). */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const job = await loadJob(id)

  const isRequester = job.requestedByUserId === user.id
  const isPartnerOwner = Boolean(job.partner && job.partner.ownerUserId === user.id)
  const isStaff = hasRole(user, ...STAFF_ROLES)
  if (!isRequester && !isPartnerOwner && !isStaff) {
    throw new ApiError(403, 'FORBIDDEN', 'You cannot view this delivery.')
  }

  const base = baseJob(job)
  if (isRequester || isStaff) {
    return ok({
      job: {
        ...base,
        otpHint: job.otpHint,
        qrToken: job.qrToken,
        podPhotos: job.status === 'DELIVERED' && job.podPhotos ? parseList(job.podPhotos) : [],
      },
    })
  }
  // partner owner — no OTP fields whatsoever
  return ok({ job: base })
})

/* ─────────────────────────── POST — lifecycle actions ─────────────────────────── */

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept'),
    driverId: z.string().trim().min(1, 'Select the driver who will handle this delivery'),
    feeMinor: z.number().int('Fee must be a whole amount').min(1, 'Quote a fee above zero').max(10_000_000, 'Fee is above the platform maximum (KES 100,000)'),
  }),
  z.object({
    action: z.literal('decline'),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({ action: z.literal('pickup') }),
  z.object({ action: z.literal('transit') }),
  z.object({
    action: z.literal('deliver'),
    // 6-digit drop-off code OR the requester's QR token (12-14 alphanumeric)
    otp: z.string().trim().regex(/^(\d{6}|[A-Z0-9]{12,14})$/, 'Enter the 6-digit drop-off code or scan the requester QR'),
    photos: z.array(z.string().trim().min(1).max(300)).min(1, 'Attach at least one proof-of-delivery photo').max(6, 'At most 6 photos'),
  }),
  z.object({
    action: z.literal('fail'),
    reason: z.string().trim().min(10, 'Explain what went wrong (at least 10 characters)').max(500),
  }),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().trim().max(500).optional(),
  }),
])

export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const job = await loadJob(id)
  const body = await parseBody(req, actionSchema)

  const isRequester = job.requestedByUserId === user.id
  const partner = await db.logisticsPartner.findUnique({ where: { ownerUserId: user.id } })
  if (!isRequester && !partner) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the requester or a delivery partner can act on this delivery.')
  }

  /* ── partner actions ── */
  if (body.action === 'accept') {
    if (!partner) throw new ApiError(403, 'FORBIDDEN', 'Only delivery partners can accept deliveries.')
    if (partner.status === 'SUSPENDED') {
      throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is suspended — you cannot accept deliveries. Contact CARMAZE support.')
    }
    if (partner.status !== 'APPROVED') {
      throw new ApiError(403, 'PARTNER_NOT_ACTIVE', 'Your partner account is not active yet.')
    }
    if (job.status !== 'OPEN') {
      throw new ApiError(409, 'INVALID_STATE', `This request is no longer open (it is ${job.status}).`)
    }
    if (job.requestedByUserId === user.id) {
      throw new ApiError(400, 'SELF_REQUEST', 'You cannot accept your own delivery request.')
    }
    const driver = await db.driver.findFirst({
      where: { id: body.driverId, partnerId: partner.id, status: 'ACTIVE' },
    })
    if (!driver) {
      throw new ApiError(400, 'INVALID_DRIVER', 'Select one of your ACTIVE drivers. Add or reactivate drivers in the Fleet tab.')
    }

    // Delivery OTP — generated at acceptance, delivered to the requester via
    // in-app notification only. The raw code is never returned to the partner.
    // A QR token is also issued: the requester renders it as a scannable code
    // and the partner can confirm delivery with either the 6-digit code or
    // the scanned token.
    const otp = sixDigitCode()
    const otpHash = await bcrypt.hash(otp, 10)
    const qrToken = shareId(12)

    const updated = await db.deliveryJob.update({
      where: { id },
      data: {
        partnerId: partner.id,
        driverId: driver.id,
        feeMinor: body.feeMinor,
        status: 'ASSIGNED',
        otpHash,
        otpHint: otp.slice(-2),
        qrToken,
        events: {
          create: {
            type: 'ASSIGNED',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'PARTNER',
            note: `Accepted by ${partner.name} — driver ${driver.name}. Quoted fee KES ${money(body.feeMinor)}.`,
          },
        },
      },
      include: JOB_INCLUDE,
    })

    await notify({
      userId: job.requestedByUserId,
      type: 'DLV_ASSIGNED',
      title: `Delivery ${job.refCode} accepted by ${partner.name}`,
      body: `Fee KES ${money(body.feeMinor)}. Your drop-off verification code is ${otp}. Share it only when you receive the cargo.`,
      link: '/logistics',
    })

    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'LOGISTICS_JOB_ACCEPTED',
      targetType: 'DELIVERY_JOB',
      targetId: id,
      metadata: { ref: job.refCode, partnerId: partner.id, driverId: driver.id, feeMinor: body.feeMinor },
    })

    return ok({ job: { ...baseJob(updated), podPhotos: [] }, message: `Delivery ${job.refCode} accepted. The requester was notified with their drop-off code.` })
  }

  if (body.action === 'decline') {
    if (!partner) throw new ApiError(403, 'FORBIDDEN', 'Only delivery partners can decline deliveries.')
    if (partner.status === 'SUSPENDED') {
      throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is suspended.')
    }
    if (job.status !== 'OPEN') {
      throw new ApiError(409, 'INVALID_STATE', `This request is no longer open (it is ${job.status}).`)
    }
    // Declining only records that this partner passed — the job stays OPEN for
    // other partners. No status change.
    const updated = await db.deliveryJob.update({
      where: { id },
      data: {
        events: {
          create: {
            type: 'NOTE',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'PARTNER',
            note: `${partner.name} passed on this request${body.note ? `: ${body.note}` : '.'}`,
          },
        },
      },
      include: JOB_INCLUDE,
    })
    return ok({ job: { ...baseJob(updated), podPhotos: [] }, message: 'Noted — the request stays open for other partners.' })
  }

  // Every remaining partner action requires this job to be assigned to THEM.
  if (!isRequester && (!job.partner || job.partner.ownerUserId !== user.id)) {
    throw new ApiError(403, 'FORBIDDEN', 'This delivery is not assigned to your company.')
  }

  if (body.action === 'pickup') {
    if (!partner) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned delivery partner can pick up.')
    if (partner.status !== 'APPROVED') throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is not active.')
    if (job.status !== 'ASSIGNED') {
      throw new ApiError(409, 'INVALID_STATE', `Pickup requires an ASSIGNED delivery (this one is ${job.status}).`)
    }
    const now = new Date()
    const updated = await db.deliveryJob.update({
      where: { id },
      data: {
        status: 'PICKED_UP',
        pickupAt: now,
        events: { create: { type: 'PICKED_UP', actorId: user.id, actorName: user.name, actorSide: 'PARTNER', note: `Cargo collected by ${job.driver?.name ?? 'the driver'}.` } },
      },
      include: JOB_INCLUDE,
    })
    await notify({
      userId: job.requestedByUserId,
      type: 'DLV_PICKED_UP',
      title: `Delivery ${job.refCode} picked up`,
      body: `${partner.name} collected your cargo at ${now.toLocaleString('en-KE')}. You will be notified when it is in transit and delivered.`,
      link: '/logistics',
    })
    return ok({ job: { ...baseJob(updated), podPhotos: [] }, message: `Delivery ${job.refCode} marked as picked up.` })
  }

  if (body.action === 'transit') {
    if (!partner) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned delivery partner can update transit.')
    if (partner.status !== 'APPROVED') throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is not active.')
    if (job.status !== 'PICKED_UP') {
      throw new ApiError(409, 'INVALID_STATE', `Transit requires a PICKED_UP delivery (this one is ${job.status}).`)
    }
    const updated = await db.deliveryJob.update({
      where: { id },
      data: {
        status: 'IN_TRANSIT',
        events: { create: { type: 'IN_TRANSIT', actorId: user.id, actorName: user.name, actorSide: 'PARTNER', note: 'Cargo is on the way to the drop-off point.' } },
      },
      include: JOB_INCLUDE,
    })
    await notify({
      userId: job.requestedByUserId,
      type: 'DLV_IN_TRANSIT',
      title: `Delivery ${job.refCode} in transit`,
      body: `Your cargo is on the way to ${job.dropCounty}. Have your 6-digit drop-off code ready — share it only when you receive the cargo.`,
      link: '/logistics',
    })
    return ok({ job: { ...baseJob(updated), podPhotos: [] }, message: `Delivery ${job.refCode} marked in transit.` })
  }

  if (body.action === 'deliver') {
    if (!partner) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned delivery partner can confirm delivery.')
    if (partner.status !== 'APPROVED') throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is not active.')
    if (job.status !== 'IN_TRANSIT') {
      throw new ApiError(409, 'INVALID_STATE', `Delivery confirmation requires an IN_TRANSIT delivery (this one is ${job.status}).`)
    }
    if (!job.otpHash) {
      throw new ApiError(409, 'INVALID_STATE', 'This delivery has no verification code on record.')
    }
    const verified = /^\d{6}$/.test(body.otp)
      ? await bcrypt.compare(body.otp, job.otpHash)
      : Boolean(job.qrToken) && body.otp === job.qrToken
    if (!verified) {
      return fail(400, 'OTP_INVALID', 'That drop-off code does not match this delivery. Ask the requester to read it from their notifications or QR.')
    }
    const now = new Date()
    const updated = await db.deliveryJob.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        podPhotos: JSON.stringify(body.photos),
        deliveredAt: now,
        events: { create: { type: 'DELIVERED', actorId: user.id, actorName: user.name, actorSide: 'PARTNER', note: `Delivered and verified with the drop-off code. ${body.photos.length} proof photo(s) attached.` } },
      },
      include: JOB_INCLUDE,
    })
    await notify({
      userId: job.requestedByUserId,
      type: 'DLV_DELIVERED',
      title: `Delivery ${job.refCode} delivered`,
      body: `${partner.name} completed the delivery at ${now.toLocaleString('en-KE')} — verified with your code. Agreed fee: KES ${money(job.feeMinor)}.`,
      link: '/logistics',
    })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'LOGISTICS_JOB_DELIVERED',
      targetType: 'DELIVERY_JOB',
      targetId: id,
      metadata: { ref: job.refCode, partnerId: partner.id, feeMinor: job.feeMinor, photos: body.photos.length },
    })
    return ok({ job: { ...baseJob(updated), podPhotos: body.photos }, message: `Delivery ${job.refCode} confirmed as delivered.` })
  }

  if (body.action === 'fail') {
    if (!partner) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned delivery partner can report a failure.')
    if (partner.status !== 'APPROVED') throw new ApiError(403, 'PARTNER_SUSPENDED', 'Your partner account is not active.')
    if (!['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status)) {
      throw new ApiError(409, 'INVALID_STATE', `Failures can only be reported on active deliveries (this one is ${job.status}).`)
    }
    const updated = await db.deliveryJob.update({
      where: { id },
      data: {
        status: 'FAILED',
        failReason: body.reason,
        events: { create: { type: 'FAILED', actorId: user.id, actorName: user.name, actorSide: 'PARTNER', note: body.reason } },
      },
      include: JOB_INCLUDE,
    })
    await notify({
      userId: job.requestedByUserId,
      type: 'DLV_FAILED',
      title: `Delivery ${job.refCode} was not completed`,
      body: `${partner.name} reported: ${body.reason}`,
      link: '/logistics',
    })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'LOGISTICS_JOB_FAILED',
      targetType: 'DELIVERY_JOB',
      targetId: id,
      metadata: { ref: job.refCode, partnerId: partner.id, reason: body.reason },
    })
    return ok({ job: { ...baseJob(updated), podPhotos: [] }, message: `Delivery ${job.refCode} reported as failed.` })
  }

  /* ── requester action: cancel (OPEN or ASSIGNED only) ── */
  if (body.action === 'cancel') {
    if (!isRequester) throw new ApiError(403, 'FORBIDDEN', 'Only the requester can cancel a delivery.')
    if (!['OPEN', 'ASSIGNED'].includes(job.status)) {
      throw new ApiError(409, 'INVALID_STATE', `Only OPEN or ASSIGNED deliveries can be cancelled (this one is ${job.status}).`)
    }
    const updated = await db.deliveryJob.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        events: {
          create: {
            type: 'CANCELLED',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'CUSTOMER',
            note: body.reason ? `Cancelled by the requester: ${body.reason}` : 'Cancelled by the requester.',
          },
        },
      },
      include: JOB_INCLUDE,
    })
    if (job.status === 'ASSIGNED' && job.partner) {
      await notify({
        userId: job.partner.ownerUserId,
        type: 'DLV_CANCELLED',
        title: `Delivery ${job.refCode} cancelled by the requester`,
        body: body.reason ? `Reason: ${body.reason}` : 'The requester cancelled this delivery before pickup.',
        link: '/logistics',
      })
    }
    return ok({ job: { ...baseJob(updated), podPhotos: [] }, message: `Delivery ${job.refCode} cancelled.` })
  }

  throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown action.')
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, ApiError, parseBody, requireRole } from '@/lib/api'
import { STAFF_ROLES } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'
import { appendPartnerNote, parseServiceAreas, parsePartnerNotes } from '@/lib/partners'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/admin/partners/[id] — staff moderation of a partner application
 * or listing. Discriminated on `action`:
 *
 *  - approve     → status APPROVED, verified=true, rejectionReason cleared
 *  - reject      → status REJECTED, requires `reason` (10–1000 chars) → rejectionReason
 *  - suspend     → status SUSPENDED, requires `reason` (10–1000 chars).
 *                  Reason is stored in `rejectionReason` (the single "status
 *                  reason" field; cleared again on approve/reactivate).
 *  - reactivate  → status APPROVED — only valid from SUSPENDED (else 409)
 *  - note        → appends {by, at, text} to the JSON notes array (staff-only)
 *
 * Every action writes an AuditLog (PARTNER_APPROVED / PARTNER_REJECTED /
 * PARTNER_SUSPENDED / PARTNER_REACTIVATED / PARTNER_NOTED). Partners are
 * businesses, not accounts — where a registered user matches the partner's
 * email, they receive an honest in-app notification; otherwise delivery is
 * skipped (never faked).
 */
const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({
    action: z.literal('reject'),
    reason: z.string().trim().min(10, 'Give the applicant a real reason (10+ characters)').max(1000),
  }),
  z.object({
    action: z.literal('suspend'),
    reason: z.string().trim().min(10, 'Explain why the listing is suspended (10+ characters)').max(1000),
  }),
  z.object({ action: z.literal('reactivate') }),
  z.object({ action: z.literal('note'), text: z.string().trim().min(2).max(1000) }),
])

export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const staff = await requireRole(...STAFF_ROLES)
  const { id } = await ctx.params
  const body = await parseBody(req, patchSchema)

  const partner = await db.partner.findUnique({ where: { id } })
  if (!partner) throw new ApiError(404, 'NOT_FOUND', 'Partner not found.')

  let updated = partner

  switch (body.action) {
    case 'approve': {
      updated = await db.partner.update({
        where: { id },
        data: { status: 'APPROVED', verified: true, rejectionReason: null },
      })
      await audit({
        actorId: staff.id, actorName: staff.name,
        action: 'PARTNER_APPROVED', targetType: 'PARTNER', targetId: id,
        metadata: { ref: partner.refCode },
      })
      await notifyPartnerContact(partner.email, {
        type: 'PARTNER_APPROVED',
        title: `${partner.name} is live on the CARMAZE Partner Network`,
        body: 'Business verification is complete — your listing is now visible in the public Partner Network directory.',
        link: '/partners',
      })
      break
    }

    case 'reject': {
      updated = await db.partner.update({
        where: { id },
        data: { status: 'REJECTED', verified: false, rejectionReason: body.reason },
      })
      await audit({
        actorId: staff.id, actorName: staff.name,
        action: 'PARTNER_REJECTED', targetType: 'PARTNER', targetId: id,
        metadata: { ref: partner.refCode, reason: body.reason },
      })
      await notifyPartnerContact(partner.email, {
        type: 'PARTNER_REJECTED',
        title: `Partner application ${partner.refCode} was not approved`,
        body: `Reason: ${body.reason} — you are welcome to reapply once the issue is addressed. No payment is charged for applying.`,
        link: '/partners',
      })
      break
    }

    case 'suspend': {
      if (partner.status === 'SUSPENDED') {
        return ok({ partner: serialize(partner), message: 'Partner was already suspended.' })
      }
      updated = await db.partner.update({
        where: { id },
        data: { status: 'SUSPENDED', rejectionReason: body.reason },
      })
      await audit({
        actorId: staff.id, actorName: staff.name,
        action: 'PARTNER_SUSPENDED', targetType: 'PARTNER', targetId: id,
        metadata: { ref: partner.refCode, reason: body.reason },
      })
      await notifyPartnerContact(partner.email, {
        type: 'PARTNER_SUSPENDED',
        title: `${partner.name} listing suspended`,
        body: `Your CARMAZE Partner Network listing was suspended. Reason: ${body.reason}`,
        link: '/partners',
      })
      break
    }

    case 'reactivate': {
      if (partner.status !== 'SUSPENDED') {
        throw new ApiError(409, 'INVALID_STATE', 'Only suspended partners can be reactivated.')
      }
      updated = await db.partner.update({
        where: { id },
        data: { status: 'APPROVED', verified: true, rejectionReason: null },
      })
      await audit({
        actorId: staff.id, actorName: staff.name,
        action: 'PARTNER_REACTIVATED', targetType: 'PARTNER', targetId: id,
        metadata: { ref: partner.refCode },
      })
      await notifyPartnerContact(partner.email, {
        type: 'PARTNER_REACTIVATED',
        title: `${partner.name} listing reactivated`,
        body: 'Your CARMAZE Partner Network listing is live again after review.',
        link: '/partners',
      })
      break
    }

    case 'note': {
      // Read-modify-write inside a transaction so concurrent notes never drop.
      updated = await db.$transaction(async (tx) => {
        const fresh = await tx.partner.findUnique({ where: { id } })
        if (!fresh) throw new ApiError(404, 'NOT_FOUND', 'Partner not found.')
        return tx.partner.update({
          where: { id },
          data: { notes: appendPartnerNote(fresh.notes, staff.name, body.text) },
        })
      })
      await audit({
        actorId: staff.id, actorName: staff.name,
        action: 'PARTNER_NOTED', targetType: 'PARTNER', targetId: id,
        metadata: { ref: partner.refCode },
      })
      break
    }
  }

  return ok({ partner: serialize(updated) })
})

function serialize(p: NonNullable<Awaited<ReturnType<typeof db.partner.findUnique>>>) {
  return { ...p, serviceAreas: parseServiceAreas(p.serviceAreas), notesList: parsePartnerNotes(p.notes) }
}

/** Partner rows hold business contacts, not user accounts — notify the
 * matching registered user when one exists, otherwise skip honestly. */
async function notifyPartnerContact(
  email: string | null,
  input: { type: string; title: string; body?: string; link?: string },
): Promise<void> {
  if (!email) return
  const contact = await db.user.findFirst({
    where: { email, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!contact) return
  try {
    await notify({ userId: contact.id, ...input })
  } catch (e) {
    console.error('[admin/partners] notify contact failed', e)
  }
}

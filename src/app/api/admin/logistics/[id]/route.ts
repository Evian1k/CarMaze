import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, parseBody, requireRole, ApiError } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { ROLE } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  action: z.enum(['suspend', 'reinstate', 'note']),
  note: z.string().trim().max(2000).optional(),
})

function serializePartner(p: Awaited<ReturnType<typeof loadPartner>>) {
  return {
    id: p.id,
    refCode: p.refCode,
    name: p.name,
    partnerType: p.partnerType,
    status: p.status,
    verified: p.verified,
    decisionNote: p.decisionNote,
    ownerUserId: p.ownerUserId,
    reviewedByName: p.reviewedByName,
    reviewedAt: p.reviewedAt,
    updatedAt: p.updatedAt,
  }
}

async function loadPartner(id: string) {
  const partner = await db.logisticsPartner.findUnique({ where: { id } })
  if (!partner) throw new ApiError(404, 'NOT_FOUND', 'Delivery partner not found.')
  return partner
}

/** PATCH /api/admin/logistics/[id]: staff moderation of a delivery partner:
 * suspend (blocks all partner actions), reinstate, or leave a note on the
 * partner timeline. ADMIN | FOUNDER only. */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const staffUser = await requireRole(ROLE.ADMIN, ROLE.FOUNDER)
  const { id } = await ctx.params
  const partner = await loadPartner(id)
  // DEMO SANDBOX: demo admins may only moderate demo-ecosystem partners.
  await demoStaffMutationGuard(staffUser, { subjectUserId: partner.ownerUserId })
  const body = await parseBody(req, patchSchema)

  if (body.action === 'suspend') {
    if (!body.note || body.note.length < 5) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Give a clear suspension reason (at least 5 characters): it is shown to the partner.')
    }
    if (partner.status === 'SUSPENDED') {
      throw new ApiError(409, 'INVALID_STATE', 'This partner is already suspended.')
    }
    const updated = await db.logisticsPartner.update({
      where: { id },
      data: {
        status: 'SUSPENDED',
        verified: false,
        decisionNote: body.note,
        reviewedAt: new Date(),
        reviewedByName: 'CARMAZE staff',
        events: { create: { type: 'SUSPENDED', actorName: 'CARMAZE staff', note: body.note } },
      },
    })
    await audit({
      action: 'LOGISTICS_PARTNER_SUSPENDED',
      targetType: 'LOGISTICS_PARTNER',
      targetId: id,
      metadata: { ref: partner.refCode, reason: body.note },
    })
    await notify({
      userId: partner.ownerUserId,
      type: 'LOGISTICS_PARTNER_SUSPENDED',
      title: `Delivery partner account suspended: ${partner.name}`,
      body: `${body.note} Your delivery operations are paused. Contact CARMAZE support to resolve this.`,
      link: '/logistics',
    })
    return ok({ partner: serializePartner(updated) })
  }

  if (body.action === 'reinstate') {
    if (partner.status !== 'SUSPENDED') {
      throw new ApiError(409, 'INVALID_STATE', 'Only suspended partners can be reinstated.')
    }
    const updated = await db.logisticsPartner.update({
      where: { id },
      data: {
        status: 'APPROVED',
        verified: true,
        decisionNote: body.note ?? null,
        reviewedAt: new Date(),
        reviewedByName: 'CARMAZE staff',
        events: { create: { type: 'REINSTATED', actorName: 'CARMAZE staff', note: body.note || 'Partner reinstated after review.' } },
      },
    })
    await audit({
      action: 'LOGISTICS_PARTNER_REINSTATED',
      targetType: 'LOGISTICS_PARTNER',
      targetId: id,
      metadata: { ref: partner.refCode },
    })
    await notify({
      userId: partner.ownerUserId,
      type: 'LOGISTICS_PARTNER_REINSTATED',
      title: `Delivery partner account reinstated: ${partner.name}`,
      body: body.note || 'Your account is active again. You can accept deliveries and manage your fleet.',
      link: '/logistics',
    })
    return ok({ partner: serializePartner(updated) })
  }

  // note
  if (!body.note || body.note.length < 2) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Write the note text.')
  }
  const updated = await db.logisticsPartner.update({
    where: { id },
    data: { events: { create: { type: 'NOTE', actorName: 'CARMAZE staff', note: body.note } } },
  })
  return ok({ partner: serializePartner(updated) })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getMembership } from '@/lib/orgs'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'

/**
 * GET /api/org/trust?orgId= — the business's Trusted Customer Programme
 * (private). Labels are internal business relationship markers — they are
 * never exposed to other businesses and are NOT credit ratings.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgId = req.nextUrl.searchParams.get('orgId')
  if (!orgId) return fail(400, 'BAD_REQUEST', 'orgId is required.')
  const membership = await getMembership(orgId, user.id)
  if (!membership) return fail(403, 'NOT_A_MEMBER', 'Not a member of this business.')
  const programme = await db.trustProgramme.findUnique({
    where: { orgId },
    include: {
      members: { include: { customer: { select: { id: true, name: true, phone: true } } }, orderBy: { createdAt: 'desc' }, take: 200 },
    },
  })
  return ok({ programme })
})

const createSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  terms: z.string().trim().max(3000).optional().nullable(),
})

const memberSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), orgId: z.string(), customerEmail: z.string().trim().toLowerCase(), label: z.enum(['NEW', 'REGULAR', 'LOYAL', 'PREFERRED', 'TRUSTED']).default('NEW'), note: z.string().max(300).optional() }),
  z.object({ action: z.literal('label'), memberId: z.string(), label: z.enum(['NEW', 'REGULAR', 'LOYAL', 'PREFERRED', 'TRUSTED', 'SUSPENDED']), note: z.string().max(300).optional() }),
  z.object({ action: z.literal('remove'), memberId: z.string() }),
])

/** POST — create programme / invite customer / change label / remove. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const raw = await req.json().catch(() => null) as { action?: string } | null

  if (raw?.action === 'invite' || raw?.action === 'label' || raw?.action === 'remove') {
    const body = await parseBody(req, memberSchema)
    let orgId: string | undefined
    if (body.action === 'invite') {
      orgId = body.orgId
    } else {
      const member = await db.trustMember.findUnique({ where: { id: body.memberId }, include: { programme: { select: { orgId: true } } } })
      orgId = member?.programme.orgId
    }
    if (!orgId) return fail(404, 'NOT_FOUND', 'Programme member not found.')
    const membership = await getMembership(orgId, user.id)
    if (!membership || !['OWNER', 'GM', 'MANAGER'].includes(membership.role)) {
      return fail(403, 'PERMISSION_DENIED', 'Only the owner or general manager manages the trust programme.')
    }
    const programme = await db.trustProgramme.findUnique({ where: { orgId } })
    if (!programme) return fail(404, 'NO_PROGRAMME', 'Create the programme first.')

    if (body.action === 'invite') {
      const customer = await db.user.findUnique({ where: { email: body.customerEmail } })
      if (!customer) return fail(404, 'NO_CUSTOMER', 'No CARMAZE account with that email. Customers must register first.')
      const member = await db.trustMember.upsert({
        where: { programmeId_customerId: { programmeId: programme.id, customerId: customer.id } },
        create: { programmeId: programme.id, customerId: customer.id, label: body.label, invitedById: user.id, note: body.note ?? null },
        update: { label: body.label, note: body.note ?? null },
      })
      await notify({
        userId: customer.id,
        type: 'TRUST_INVITE',
        title: `You've been added to ${programme.name}`,
        body: 'A business added you to its Trusted Customer Programme. Review the programme terms in your account.',
        link: '/account?tab=subscriptions',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'TRUST_MEMBER_INVITED', targetType: 'TRUST_MEMBER', targetId: member.id, metadata: { label: body.label } })
      return ok({ member, message: 'Customer invited. They see the programme terms and must accept them.' }, { status: 201 })
    }
    if (body.action === 'label') {
      const member = await db.trustMember.update({ where: { id: body.memberId }, data: { label: body.label, note: body.note ?? undefined } })
      await audit({ actorId: user.id, actorName: user.name, action: 'TRUST_MEMBER_LABELLED', targetType: 'TRUST_MEMBER', targetId: body.memberId, metadata: { label: body.label } })
      return ok({ member })
    }
    await db.trustMember.delete({ where: { id: body.memberId } })
    await audit({ actorId: user.id, actorName: user.name, action: 'TRUST_MEMBER_REMOVED', targetType: 'TRUST_MEMBER', targetId: body.memberId })
    return ok({ removed: true })
  }

  const body = await parseBody(req, createSchema)
  const membership = await getMembership(body.orgId, user.id)
  if (!membership || !['OWNER', 'GM', 'MANAGER'].includes(membership.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Only the owner or general manager creates the programme.')
  }
  const programme = await db.trustProgramme.upsert({
    where: { orgId: body.orgId },
    create: { orgId: body.orgId, name: body.name, description: body.description ?? null, terms: body.terms ?? null },
    update: { name: body.name, description: body.description ?? null, terms: body.terms ?? null },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'TRUST_PROGRAMME_SAVED', targetType: 'TRUST_PROGRAMME', targetId: programme.id, metadata: { orgId: body.orgId } })
  return ok({ programme }, { status: 201 })
})

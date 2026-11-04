import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getMembership } from '@/lib/orgs'
import { jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

const schema = z.object({
  membershipId: z.string().min(1),
  benefit: z.string().trim().min(2).max(140),
  refType: z.string().max(40).optional(),
  refId: z.string().optional(),
})

/**
 * POST /api/org/memberships/redeem — business staff records a member's
 * benefit redemption. The unique [membership, benefit, periodKey] constraint
 * makes duplicate redemption of the same benefit in the same period
 * impossible at the database level — not just hidden in the UI.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)
  const membership = await db.businessMembership.findUnique({ where: { id: body.membershipId } })
  if (!membership) return fail(404, 'NOT_FOUND', 'Membership not found.')
  const staff = await getMembership(membership.orgId, user.id)
  if (!staff || !['OWNER', 'GM', 'MANAGER', 'STAFF', 'SALES', 'MECHANIC', 'BRANCH_MANAGER'].includes(staff.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Not authorised to record redemptions for this business.')
  }
  if (membership.status !== 'ACTIVE') return fail(409, 'NOT_ACTIVE', 'Membership is not active — benefits cannot be redeemed.')
  if (membership.currentPeriodEnd && membership.currentPeriodEnd < new Date()) {
    return fail(409, 'EXPIRED', 'Membership period has ended.')
  }

  const tier = await db.membershipTier.findUnique({ where: { id: membership.tierId } })
  const benefits = jsonParse<string[]>(tier?.benefits, [])
  if (benefits.length > 0 && !benefits.some((b) => b === body.benefit)) {
    return fail(400, 'BENEFIT_NOT_IN_TIER', 'That benefit is not part of this membership tier.')
  }

  const now = new Date()
  const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  try {
    const redemption = await db.membershipRedemption.create({
      data: { membershipId: membership.id, benefit: body.benefit, periodKey, refType: body.refType ?? null, refId: body.refId ?? null },
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'MEMBERSHIP_BENEFIT_REDEEMED', targetType: 'BUSINESS_MEMBERSHIP', targetId: membership.id, metadata: { benefit: body.benefit, periodKey } })
    return ok({ redemption, message: 'Benefit redemption recorded.' }, { status: 201 })
  } catch {
    return fail(409, 'ALREADY_REDEEMED', 'This benefit was already redeemed for the current period.')
  }
})

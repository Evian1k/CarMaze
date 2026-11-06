import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getMembership } from '@/lib/orgs'
import { jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  priceMonthlyMinor: z.number().int().min(0).optional(),
  priceYearlyMinor: z.number().int().min(0).optional().nullable(),
  benefits: z.array(z.string().max(140)).min(1).max(12).optional(),
  memberLimit: z.number().int().min(1).optional().nullable(),
  discountCapPct: z.number().int().min(0).max(80).optional().nullable(),
  branchScope: z.enum(['ALL', 'SELECTED']).optional(),
  branches: z.array(z.string()).optional().nullable(),
  terms: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional(),
})

/** PATCH: update / archive a tier (owner/GM). */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const tier = await db.membershipTier.findUnique({ where: { id } })
  if (!tier) return fail(404, 'NOT_FOUND', 'Tier not found.')
  const membership = await getMembership(tier.orgId, user.id)
  if (!membership || !['OWNER', 'GM', 'MANAGER'].includes(membership.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Only the owner or general manager edits tiers.')
  }
  const body = await parseBody(req, patchSchema)
  const updated = await db.membershipTier.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.priceMonthlyMinor !== undefined ? { priceMonthlyMinor: body.priceMonthlyMinor } : {}),
      ...(body.priceYearlyMinor !== undefined ? { priceYearlyMinor: body.priceYearlyMinor } : {}),
      ...(body.benefits !== undefined ? { benefits: JSON.stringify(body.benefits) } : {}),
      ...(body.memberLimit !== undefined ? { memberLimit: body.memberLimit } : {}),
      ...(body.discountCapPct !== undefined ? { discountCapPct: body.discountCapPct } : {}),
      ...(body.branchScope !== undefined ? { branchScope: body.branchScope } : {}),
      ...(body.branches !== undefined ? { branchesJson: body.branches ? JSON.stringify(body.branches) : null } : {}),
      ...(body.terms !== undefined ? { terms: body.terms } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'MEMBERSHIP_TIER_UPDATED', targetType: 'MEMBERSHIP_TIER', targetId: id })
  return ok({ tier: { ...updated, benefits: jsonParse(updated.benefits, []) } })
})

/** DELETE: archive a tier (soft; existing memberships keep their terms). */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const tier = await db.membershipTier.findUnique({ where: { id } })
  if (!tier) return fail(404, 'NOT_FOUND', 'Tier not found.')
  const membership = await getMembership(tier.orgId, user.id)
  if (!membership || !['OWNER', 'GM', 'MANAGER'].includes(membership.role)) {
    return fail(403, 'PERMISSION_DENIED', 'Only the owner or general manager archives tiers.')
  }
  await db.membershipTier.update({ where: { id }, data: { active: false } })
  await audit({ actorId: user.id, actorName: user.name, action: 'MEMBERSHIP_TIER_ARCHIVED', targetType: 'MEMBERSHIP_TIER', targetId: id })
  return ok({ archived: true })
})

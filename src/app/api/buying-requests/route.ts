import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'

// ───────────────────────── helpers ─────────────────────────

async function myDealerOrgIds(userId: string): Promise<string[]> {
  const memberships = await db.orgMember.findMany({
    where: { userId, org: { type: 'DEALER', status: 'ACTIVE' } },
    select: { orgId: true },
  })
  return memberships.map((m) => m.orgId)
}

// ───────────────────────── GET /api/buying-requests ─────────────────────────
export const GET = route(async (req: NextRequest) => {
  const params = new URL(req.url).searchParams

  if (params.get('board') === '1') {
    // Public board of what verified dealers are sourcing right now.
    const requests = await db.buyingRequest.findMany({
      where: { status: 'OPEN', org: { type: 'DEALER', status: 'ACTIVE' } },
      include: { org: { select: { id: true, name: true, county: true, town: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return ok({ requests })
  }

  if (params.get('mine') === '1') {
    const user = await requireUser()
    const orgIds = await myDealerOrgIds(user.id)
    if (orgIds.length === 0) return ok({ requests: [] })
    const requests = await db.buyingRequest.findMany({
      where: { orgId: { in: orgIds } },
      include: { org: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return ok({ requests })
  }

  return fail(400, 'BAD_REQUEST', 'Specify ?board=1 or ?mine=1.')
})

// ───────────────────────── POST /api/buying-requests ─────────────────────────
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgIds = await myDealerOrgIds(user.id)
  if (orgIds.length === 0) {
    throw new ApiError(403, 'DEALER_ONLY', 'Only verified dealer team members can post buying requests.')
  }

  const body = await parseBody(
    req,
    z.object({
      make: z.string().trim().min(1, 'Make is required').max(40),
      model: z.string().trim().max(60).optional(),
      yearFrom: z.number().int().min(1980).max(new Date().getFullYear() + 1).optional(),
      yearTo: z.number().int().min(1980).max(new Date().getFullYear() + 1).optional(),
      budgetMinor: z.number().int().min(1).max(10_000_000_000).optional(),
      notes: z.string().trim().max(1000).optional(),
    })
  )

  const request = await db.buyingRequest.create({
    data: {
      orgId: orgIds[0],
      make: body.make,
      model: body.model || null,
      yearFrom: body.yearFrom ?? null,
      yearTo: body.yearTo ?? null,
      budgetMinor: body.budgetMinor ?? null,
      notes: body.notes || null,
    },
    include: { org: { select: { id: true, name: true } } },
  })
  return ok({ request }, { status: 201 })
})

// ───────────────────────── PATCH /api/buying-requests ─────────────────────────
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail(400, 'BAD_REQUEST', 'id query parameter is required.')

  const { status } = await parseBody(req, z.object({ status: z.literal('CLOSED') }))

  const request = await db.buyingRequest.findUnique({ where: { id }, select: { id: true, orgId: true } })
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Buying request not found.')

  const membership = await db.orgMember.findFirst({
    where: { orgId: request.orgId, userId: user.id, role: { in: ['OWNER', 'MANAGER'] } },
    select: { id: true },
  })
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Only your dealership\u2019s managers can close this request.')

  const updated = await db.buyingRequest.update({ where: { id }, data: { status } })
  return ok({ request: updated })
})

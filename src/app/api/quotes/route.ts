import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'

// ─────────────────────────── POST: garage sends a quote ───────────────────────────

const quoteSchema = z.object({
  requestId: z.string().min(1),
  orgId: z.string().min(1).optional(),
  amountMinor: z.number().int().positive('Quote amount must be greater than zero').max(10_000_000_000),
  leadDays: z.number().int().min(0).max(365).optional().nullable(),
  message: z.string().trim().max(1200).optional().or(z.literal('')),
})

/** Resolve which garage org is quoting: explicit orgId → membership check, else unambiguous inference. */
async function resolveQuotingOrg(userId: string, requestId: string, orgId?: string) {
  const memberships = await db.orgMember.findMany({
    where: { userId, role: { in: ['OWNER', 'MANAGER'] }, org: { type: 'GARAGE', status: 'ACTIVE' } },
    include: { org: true },
    orderBy: { createdAt: 'asc' },
  })
  if (memberships.length === 0) throw new ApiError(403, 'FORBIDDEN', 'Garage owner or manager membership required.')

  if (orgId) {
    const match = memberships.find((m) => m.orgId === orgId)
    if (!match) throw new ApiError(403, 'FORBIDDEN', 'You are not an owner or manager of this garage.')
    return match.org
  }

  const request = await db.serviceRequest.findUnique({ where: { id: requestId }, select: { category: true } })
  if (request) {
    const offering = await db.garageService.findMany({
      where: { orgId: { in: memberships.map((m) => m.orgId) }, category: request.category, active: true },
      select: { orgId: true },
    })
    const offeringOrgIds = [...new Set(offering.map((o) => o.orgId))]
    if (offeringOrgIds.length === 1) {
      return memberships.find((m) => m.orgId === offeringOrgIds[0])!.org
    }
  }
  if (memberships.length === 1) return memberships[0].org
  throw new ApiError(400, 'ORG_REQUIRED', 'You manage more than one garage: specify which garage is quoting (orgId).')
}

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`quote:${getIp(req)}:${user.id}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', `Quote limit reached (30/hour). Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
  }

  const body = await parseBody(req, quoteSchema)

  const request = await db.serviceRequest.findUnique({ where: { id: body.requestId } })
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Service request not found.')
  if (!['OPEN', 'QUOTING'].includes(request.status)) {
    throw new ApiError(409, 'INVALID_STATE', `This request is ${request.status} and no longer accepting quotes.`)
  }

  const org = await resolveQuotingOrg(user.id, request.id, body.orgId)

  // The garage must actively offer the requested category.
  const offersCategory = await db.garageService.findFirst({
    where: { orgId: org.id, category: request.category, active: true },
  })
  if (!offersCategory) {
    throw new ApiError(409, 'CATEGORY_NOT_OFFERED', `Add an active "${request.category.replaceAll('_', ' ').toLowerCase()}" service to your garage before quoting on this request.`)
  }

  // One quote per org per request; upsert keeps our own quote current.
  const existing = await db.quote.findUnique({
    where: { requestId_orgId: { requestId: request.id, orgId: org.id } },
  })
  if (existing?.status === 'ACCEPTED') {
    throw new ApiError(409, 'QUOTE_ACCEPTED', 'The customer already accepted this quote: manage it under Bookings.')
  }

  const quote = existing
    ? await db.quote.update({
        where: { id: existing.id },
        data: {
          amountMinor: body.amountMinor,
          leadDays: body.leadDays ?? null,
          message: body.message || null,
          status: 'PENDING',
        },
      })
    : await db.quote.create({
        data: {
          requestId: request.id,
          orgId: org.id,
          amountMinor: body.amountMinor,
          leadDays: body.leadDays ?? null,
          message: body.message || null,
          status: 'PENDING',
        },
      })

  if (request.status === 'OPEN') {
    await db.serviceRequest.update({ where: { id: request.id }, data: { status: 'QUOTING' } })
  }

  await notify({
    userId: request.customerId,
    type: 'QUOTE_RECEIVED',
    title: `New quote on your service request ${request.refCode}`,
    body: `${org.name} quoted for your ${request.category.replaceAll('_', ' ').toLowerCase()} request. Compare quotes in your account.`,
    link: '/account?tab=requests',
  })

  await audit({
    actorId: user.id, actorName: user.name,
    action: existing ? 'QUOTE_UPDATED' : 'QUOTE_SENT',
    targetType: 'QUOTE', targetId: quote.id,
    metadata: { requestRef: request.refCode, orgId: org.id, amountMinor: body.amountMinor },
  })

  return ok({ quote }, { status: existing ? 200 : 201 })
})

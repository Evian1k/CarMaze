import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  name: z.string().trim().min(2, 'Your name is required').max(80),
  phone: z.string().trim().min(9, 'A reachable phone number is required').max(20),
  county: z.string().trim().min(2, 'County / area is required').max(60),
  message: z
    .string()
    .trim()
    .min(10, 'Tell the partner what you need (at least 10 characters)')
    .max(1000),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
})

/**
 * POST /api/partners/[id]/request — send a referral request to a partner.
 * Requires a signed-in account (any role). The partner must be APPROVED and
 * verified. Creates a PartnerRequest, bumps the partner's referral counter
 * (one transaction), audits the referral and notifies the requester with the
 * reference code they can quote when the partner follows up.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const rl = rateLimit(`partner-request:${user.id}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many requests sent. Please try again later.')

  const { id } = await ctx.params
  const body = await parseBody(req, schema)

  const partner = await db.partner.findUnique({ where: { id } })
  // Unknown id and "exists but not listed" look identical — no existence leak.
  if (!partner || partner.status !== 'APPROVED' || !partner.verified) {
    throw new ApiError(404, 'NOT_FOUND', 'This partner is not currently accepting requests.')
  }

  const request = await db.$transaction(async (tx) => {
    const created = await tx.partnerRequest.create({
      data: {
        refCode: refCode('PRQ', 6),
        partnerId: partner.id,
        userId: user.id,
        name: body.name,
        phone: body.phone,
        email: body.email || null,
        county: body.county,
        message: body.message,
      },
    })
    await tx.partner.update({
      where: { id: partner.id },
      data: { referrals: { increment: 1 } },
    })
    return created
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'PARTNER_REQUEST',
    targetType: 'PARTNER',
    targetId: partner.id,
    metadata: { requestId: request.id, ref: request.refCode, partnerRef: partner.refCode },
  })

  await notify({
    userId: user.id,
    type: 'PARTNER_REQUEST_SENT',
    title: `Request sent to ${partner.name} — ${request.refCode}`,
    body: `Your request was delivered to ${partner.name}. Quote ref ${request.refCode} when they call, and track its status under Partner Network → My requests.`,
    link: '/partners',
  })

  return ok({ refCode: request.refCode }, { status: 201 })
})

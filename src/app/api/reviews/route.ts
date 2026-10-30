import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

// Reviews are earned, never bought: a customer may review a business only
// after a real, completed engagement with it.
//   GARAGE → at least one COMPLETED service Booking with that garage.
//   DEALER → at least one COMPLETED test-drive appointment at that showroom.
// One review per (org, author); authors may update their own rating.

// ─────────────────────────── GET (public, per org) ───────────────────────────

export const GET = route(async (req: NextRequest) => {
  const orgId = new URL(req.url).searchParams.get('orgId')
  if (!orgId) return fail(400, 'VALIDATION_ERROR', 'Missing ?orgId=.')

  const org = await db.org.findFirst({ where: { id: orgId } })
  if (!org) throw new ApiError(404, 'NOT_FOUND', 'Business not found.')

  const reviews = await db.orgReview.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, rating: true, comment: true, createdAt: true, author: { select: { name: true } } },
  })

  const agg = await db.orgReview.aggregate({ where: { orgId }, _avg: { rating: true }, _count: { rating: true } })
  const summary = {
    avg: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0,
    count: agg._count.rating,
  }

  // Reviews show the author's first name only.
  return ok({
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      author: { name: r.author.name.split(' ')[0] },
    })),
    summary,
  })
})

// ─────────────────────────── POST (auth, earned via completed engagement) ───────────────────────────

const reviewSchema = z.object({
  orgId: z.string().min(1),
  rating: z.number().int().min(1, 'Rating must be 1–5').max(5, 'Rating must be 1–5'),
  comment: z.string().trim().max(1000).optional().or(z.literal('')),
})

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`review:${getIp(req)}:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many review attempts. Try again shortly.')

  const body = await parseBody(req, reviewSchema)

  const org = await db.org.findFirst({ where: { id: body.orgId } })
  if (!org) throw new ApiError(404, 'NOT_FOUND', 'Business not found.')

  // Earned reviews only — the qualifying engagement depends on the org type.
  if (org.type === 'GARAGE') {
    const completedBooking = await db.booking.findFirst({
      where: { orgId: org.id, status: 'COMPLETED', request: { customerId: user.id } },
    })
    if (!completedBooking) {
      throw new ApiError(403, 'NOT_EARNED', 'You can review a garage after completing a booked service with it.')
    }
  } else {
    const completedTestDrive = await db.testDrive.findFirst({
      where: { orgId: org.id, customerId: user.id, status: 'COMPLETED' },
    })
    if (!completedTestDrive) {
      throw new ApiError(403, 'NOT_EARNED', 'You can review a showroom after completing a test drive with it.')
    }
  }

  // Upsert on (orgId, authorId) — authors may update their own rating.
  const existing = await db.orgReview.findUnique({
    where: { orgId_authorId: { orgId: org.id, authorId: user.id } },
  })

  const review = existing
    ? await db.orgReview.update({
        where: { id: existing.id },
        data: { rating: body.rating, comment: body.comment || null },
      })
    : await db.orgReview.create({
        data: { orgId: org.id, authorId: user.id, rating: body.rating, comment: body.comment || null },
      })

  // Loyalty: first publication of a review earns +100 points. Updates never
  // re-award, and the ledger check (userId + reason + refId) makes this
  // idempotent even if creation were retried. Points failure NEVER fails the review.
  if (!existing) {
    try {
      const alreadyAwarded = await db.loyaltyLedger.findFirst({
        where: { userId: user.id, reason: 'REVIEW_EARNED', refId: review.id },
      })
      if (!alreadyAwarded) {
        await db.loyaltyLedger.create({
          data: {
            userId: user.id,
            points: 100,
            reason: 'REVIEW_EARNED',
            refType: 'ORG_REVIEW',
            refId: review.id,
            note: `Review published — ${org.name}`,
          },
        })
      }
    } catch (e) {
      console.error('[reviews] loyalty award failed (ignored)', e)
    }
  }

  await audit({
    actorId: user.id, actorName: user.name,
    action: existing ? 'REVIEW_UPDATED' : 'REVIEW_CREATED',
    targetType: 'ORG_REVIEW', targetId: review.id,
    metadata: { orgId: org.id, orgType: org.type, rating: body.rating },
  })

  return ok({
    review: {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      author: { name: user.name.split(' ')[0] },
    },
  })
})

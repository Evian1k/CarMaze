import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, requireUser } from '@/lib/api'
import { shareId } from '@/lib/ids'

// ───────────────────── CARMAZE Loyalty & Referrals ─────────────────────
// One transparent, read-only summary of the signed-in customer's points.
// Points are earned only through real, verifiable activity — they are never
// purchasable and have no cash value. The rules below are the single source
// of truth shared with the UI (no hidden multipliers, no invented rewards).

export const REFERRAL_SIGNUP_POINTS = 500
export const REFERRAL_SIGNUP_CAP = 50

const RULES = [
  {
    title: 'Invite a friend',
    detail: 'Earn 500 points when someone signs up with your referral link.',
    points: 500,
  },
  {
    title: 'Share a verified garage review',
    detail: 'Earn 100 points after your review of a completed service is published.',
    points: 100,
  },
  {
    title: 'Complete a garage service',
    detail: 'Earn 250 points when a garage marks your job completed.',
    points: 250,
  },
] as const

const FINE_PRINT = 'Points have no cash value. Points cannot be bought. CARMAZE may adjust rules with notice.'

/** Lazily create the caller's referral code — an 8-char code from the same
 * unambiguous alphabet as other CARMAZE share IDs, retried on the (astronomically
 * unlikely) unique-collision. Returns the user row with a code guaranteed present. */
async function ensureReferralCode(userId: string) {
  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  })
  if (existing?.referralCode) return existing.referralCode

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shareId(8) // e.g. "K7QW3M9X" — A–Z minus I/O + 2–9
    try {
      const updated = await db.user.update({
        where: { id: userId },
        data: { referralCode: code },
        select: { referralCode: true },
      })
      return updated.referralCode as string
    } catch {
      // Unique violation (P2002) — collided with an existing code; retry.
    }
  }
  // Practically unreachable; surface as an error rather than inventing a code.
  throw new Error('Could not allocate a unique referral code')
}

// ─────────────────────────── GET (auth) ───────────────────────────

export const GET = route(async (_req: NextRequest) => {
  const user = await requireUser()

  const referralCode = await ensureReferralCode(user.id)

  const [agg, entries, referralCount, referralAwards] = await Promise.all([
    db.loyaltyLedger.aggregate({ where: { userId: user.id }, _sum: { points: true } }),
    db.loyaltyLedger.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db.user.count({ where: { referredById: user.id } }),
    db.loyaltyLedger.count({ where: { userId: user.id, reason: 'REFERRAL_SIGNUP' } }),
  ])

  return ok({
    points: agg._sum.points ?? 0,
    referralCode,
    referralCount,
    referralsAvailable: Math.max(0, REFERRAL_SIGNUP_CAP - referralAwards),
    entries: entries.map((e) => ({
      id: e.id,
      points: e.points,
      reason: e.reason,
      refType: e.refType,
      refId: e.refId,
      note: e.note,
      createdAt: e.createdAt,
    })),
    rules: RULES,
    finePrint: FINE_PRINT,
  })
})

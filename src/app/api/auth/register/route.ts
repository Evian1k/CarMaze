import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, createSession } from '@/lib/auth'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your full name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  phone: z.string().trim().regex(/^(\+?254|0)[17]\d{8}$/, 'Enter a valid Kenyan phone number (e.g. 0712 345 678)').optional().or(z.literal('')),
  ref: z.string().trim().min(1).max(32).optional(), // referral code from the invite link — attribution only
})

const REFERRAL_SIGNUP_POINTS = 500
const REFERRAL_SIGNUP_CAP = 50

/** Resolve a referral code to its owner, case-insensitively (SQLite stores
 * codes uppercase; `contains` maps to LIKE which is case-insensitive for ASCII).
 * Returns null for unknown/garbage codes — registration still succeeds. */
async function findReferrer(code: string) {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null

  const exact = await db.user.findFirst({ where: { referralCode: normalized } })
  if (exact) return exact

  // Case variant of a valid code (e.g. "k7qw3m9x"): LIKE scan, then verify the
  // candidate's code matches exactly case-insensitively (no partial matches).
  const candidate = await db.user.findFirst({ where: { referralCode: { contains: normalized } } })
  if (candidate && candidate.referralCode?.toUpperCase() === normalized) return candidate

  return null
}

/** Best-effort referral attribution — runs AFTER the account is created and
 * NEVER blocks or fails registration. Guards (each silently skips the award):
 * unknown code · referrer suspended · self-referral (same email) · referrer
 * already earned the max 50 referral-signup awards. */
async function attributeReferral(newUserId: string, newUserName: string, newUserEmail: string, refCode: string) {
  try {
    const referrer = await findReferrer(refCode)
    if (!referrer) return
    if (referrer.status !== 'ACTIVE') return
    if (referrer.email.toLowerCase() === newUserEmail.toLowerCase()) return // self-referral
    const priorAwards = await db.loyaltyLedger.count({
      where: { userId: referrer.id, reason: 'REFERRAL_SIGNUP' },
    })
    if (priorAwards >= REFERRAL_SIGNUP_CAP) return

    await db.$transaction([
      db.user.update({
        where: { id: newUserId },
        data: { referredById: referrer.id, referredAt: new Date() },
      }),
      db.loyaltyLedger.create({
        data: {
          userId: referrer.id,
          points: REFERRAL_SIGNUP_POINTS,
          reason: 'REFERRAL_SIGNUP',
          refType: 'USER',
          refId: newUserId,
          note: `${newUserName} joined CARMAZE with your referral link`,
        },
      }),
    ])

    await notify({
      userId: referrer.id,
      type: 'LOYALTY_POINTS',
      title: `You earned ${REFERRAL_SIGNUP_POINTS} points — a friend joined CARMAZE`,
      body: `${newUserName} signed up with your referral link. Your points are in Rewards → My Account.`,
      link: '/account?tab=rewards',
    })
  } catch (e) {
    // Attribution is optional enrichment — log and let registration succeed.
    console.error('[register] referral attribution failed (ignored)', e)
  }
}

export const POST = route(async (req: NextRequest) => {
  const ip = getIp(req)
  const rl = rateLimit(`register:${ip}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Too many sign-up attempts. Try again in ${rl.retryAfterSec}s.`)

  const body = await parseBody(req, registerSchema)

  const existing = await db.user.findUnique({ where: { email: body.email } })
  if (existing) return fail(409, 'EMAIL_TAKEN', 'An account with this email already exists. Try signing in.')

  const user = await db.user.create({
    data: {
      name: body.name,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      phone: body.phone || null,
      roles: 'CUSTOMER,SELLER',
    },
  })

  if (body.ref) await attributeReferral(user.id, user.name, user.email, body.ref)

  await createSession(user.id)
  await audit({ actorId: user.id, actorName: user.name, action: 'USER_REGISTERED', targetType: 'USER', targetId: user.id })

  return ok({
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone, phoneVerified: user.phoneVerified, roles: user.roles.split(','), status: user.status },
  })
})

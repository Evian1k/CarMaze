import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { hashPassword } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'

const INVITE_ROLES = ['SALES', 'MANAGER', 'FINANCE', 'STAFF'] as const

const postSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120),
  name: z.string().trim().min(2, 'Full name is required').max(80),
  role: z.enum(INVITE_ROLES),
})

function requireDealerOrgId(raw: string | null): string {
  if (!raw) throw new ApiError(400, 'VALIDATION_ERROR', 'orgId is required.')
  return raw
}

async function requireMember(orgId: string, userId: string, roles: string[]) {
  const membership = await db.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    include: { org: { select: { id: true, type: true, name: true, status: true } } },
  })
  if (!membership || membership.org.type !== 'DEALER') {
    throw new ApiError(404, 'NOT_FOUND', 'Dealership not found for your account.')
  }
  if (!roles.includes(membership.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the dealership owner or a manager can manage staff.')
  }
  return membership
}

/** Resolve the staff seat limit from the org's subscription plan (default 2). */
async function staffLimitFor(orgId: string): Promise<number> {
  // Entitlement integrity mirrors lib/entitlements.ts: an expired subscription
  // (past the 3-day grace) must not keep granting paid seat limits.
  const subscription = await db.subscription.findUnique({ where: { orgId } })
  if (!subscription || subscription.status !== 'ACTIVE') return 2
  if (subscription.currentPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000 < Date.now()) return 2
  const plan = await db.plan.findUnique({ where: { code: subscription.planCode } })
  return plan?.staffLimit ?? 2
}

// Unambiguous alphabet (no I, O, 0, 1, l) for shareable passwords.
const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function generatePassword(len = 12): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length]
  return out
}

/**
 * GET /api/orgs/staff?orgId=
 * List dealership team members. OWNER or MANAGER only.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const orgId = requireDealerOrgId(new URL(req.url).searchParams.get('orgId'))
  await requireMember(orgId, user.id, ['OWNER', 'MANAGER'])

  const [members, staffLimit] = await Promise.all([
    db.orgMember.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { name: true, email: true, status: true } },
      },
    }),
    staffLimitFor(orgId),
  ])

  return ok({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      status: m.user.status,
      createdAt: m.createdAt,
    })),
    staffLimit,
  })
})

/**
 * POST /api/orgs/staff: invite a team member. OWNER only.
 * If the email is not registered, an account is provisioned and a generated
 * 12-character password is returned ONCE in this response (hashed in the DB).
 * Enforces the subscription plan's staffLimit (default 2 without a plan).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, postSchema)

  // DEMO SANDBOX: staff invites provision REAL user accounts (with a real,
  // one-time password). Demo sessions must never mint real credentials or
  // attach real people to an organisation.
  if (user.isDemo) {
    return fail(403, 'DEMO_SANDBOXED', 'Demo mode: staff invites are disabled because they create real user accounts. Use an authorised dealership owner account to invite your team.')
  }

  const rl = rateLimit(`staff-create:${body.orgId}:${getIp(req)}:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', `Too many staff invites. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
  }

  const membership = await requireMember(body.orgId, user.id, ['OWNER'])

  const seatLimit = await staffLimitFor(body.orgId)
  const currentCount = await db.orgMember.count({ where: { orgId: body.orgId } })
  if (currentCount >= seatLimit) {
    return fail(402, 'PLAN_LIMIT', `Upgrade your plan to add more staff; your plan allows ${seatLimit} team member${seatLimit === 1 ? '' : 's'}.`)
  }

  const org = membership.org
  let createdUser = false
  let oneTimePassword: string | undefined

  let target = await db.user.findUnique({ where: { email: body.email } })
  if (!target) {
    oneTimePassword = generatePassword(12)
    target = await db.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(oneTimePassword),
        roles: 'CUSTOMER,DEALER_STAFF',
        status: 'ACTIVE',
      },
    })
    createdUser = true
  }

  const existing = await db.orgMember.findUnique({
    where: { orgId_userId: { orgId: body.orgId, userId: target.id } },
  })
  if (existing) {
    return fail(409, 'ALREADY_MEMBER', `${target.email} is already part of ${org.name}.`)
  }

  const member = await db.orgMember.create({
    data: { orgId: body.orgId, userId: target.id, role: body.role },
  })

  await notify({
    userId: target.id,
    type: 'ORG_STAFF_ADDED',
    title: `You now work with ${org.name} on CARMAZE`,
    body: `${user.name} added you to the ${org.name} team as ${body.role.toLowerCase()}. Sign in with your CARMAZE account to see the DealerOS tools.`,
    link: '/dealer',
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'ORG_STAFF_ADDED',
    targetType: 'ORG',
    targetId: body.orgId,
    metadata: { org: org.name, memberEmail: target.email, role: body.role, accountCreated: createdUser },
  })

  return ok(
    {
      member: { id: member.id, userId: target.id, name: target.name, email: target.email, role: member.role, status: target.status, createdAt: member.createdAt },
      ...(createdUser && oneTimePassword ? { oneTimePassword } : {}),
      ...(createdUser ? { note: 'A new CARMAZE account was created. Share this password securely: it is shown only once.' } : {}),
    },
    { status: 201 }
  )
})

/**
 * DELETE /api/orgs/staff?memberId=&orgId=: remove a team member. OWNER only.
 * The OWNER member cannot be removed. If the removed user has no other dealer
 * org membership, the DEALER_STAFF role is stripped from their roles.
 */
export const DELETE = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)
  const orgId = requireDealerOrgId(url.searchParams.get('orgId'))
  const memberId = url.searchParams.get('memberId')
  if (!memberId) throw new ApiError(400, 'VALIDATION_ERROR', 'memberId is required.')

  const membership = await requireMember(orgId, user.id, ['OWNER'])

  const member = await db.orgMember.findFirst({ where: { id: memberId, orgId }, include: { user: { select: { id: true, email: true, roles: true } } } })
  if (!member) throw new ApiError(404, 'NOT_FOUND', 'Team member not found.')
  if (member.role === 'OWNER') {
    return fail(409, 'OWNER_UNREMOVABLE', 'The dealership owner cannot be removed.')
  }

  await db.orgMember.delete({ where: { id: member.id } })

  const otherDealerMemberships = await db.orgMember.count({
    where: { userId: member.userId, org: { type: 'DEALER' }, orgId: { not: orgId } },
  })
  if (otherDealerMemberships === 0 && member.user.roles.includes('DEALER_STAFF')) {
    const dbUser = await db.user.findUnique({ where: { id: member.userId } })
    if (dbUser) {
      const roles = dbUser.roles.split(',').filter((r) => r && r !== 'DEALER_STAFF').join(',')
      await db.user.update({ where: { id: member.userId }, data: { roles: roles || 'CUSTOMER' } })
    }
  }

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'ORG_STAFF_REMOVED',
    targetType: 'ORG',
    targetId: orgId,
    metadata: { org: membership.org.name, memberEmail: member.user.email },
  })

  return ok({ removed: true })
})

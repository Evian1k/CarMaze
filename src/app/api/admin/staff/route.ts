import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireRole, getIp } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { STAFF_ROLES, hashPassword } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'

/**
 * Company staff management (Super Admin capability).
 *
 * GET /api/admin/staff — list every user holding at least one staff role.
 * POST /api/admin/staff — invite a company staff member with a one-time password.
 *
 * Scope note: this endpoint can only grant the four operational staff roles
 * (SUPPORT, REVIEWER, MODERATOR, FINANCE). ADMIN / FOUNDER accounts can only
 * be promoted by the Super Admin through a separate, more privileged flow —
 * deliberately out of scope here (see ROLE_NOT_ALLOWED below).
 */

const STAFF_DEPARTMENTS = [
  'BUSINESS_VERIFICATION',
  'SUPPORT',
  'FINANCE',
  'DISPUTES',
  'FRAUD',
  'MODERATION',
  'TECHNICAL',
] as const

const ASSIGNABLE_STAFF_ROLES = ['SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE'] as const

const postSchema = z.object({
  name: z.string().trim().min(2, 'Full name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120),
  // Parsed as a plain string so ADMIN/FOUNDER attempts get the explicit
  // ROLE_NOT_ALLOWED error (not a generic validation error) — the restriction
  // is a policy rule, not a typo.
  role: z.string().trim().toUpperCase(),
  department: z.enum(STAFF_DEPARTMENTS),
  phone: z.string().trim().max(24).optional().or(z.literal('')),
})

/**
 * GET /api/admin/staff — company staff directory. ADMIN/FOUNDER only.
 * Roles are stored as a comma-separated string, so the staff filter runs in
 * JS (the SQLite connector cannot match inside CSV columns reliably).
 */
export const GET = route(async () => {
  await requireRole('ADMIN', 'FOUNDER')

  const rows = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500, // generous scan window; pilot-scale dataset (same window as /api/admin/users)
    select: { id: true, name: true, email: true, roles: true, department: true, status: true, createdAt: true },
  })

  const staff = rows
    .filter((u) => u.roles.split(',').some((r) => STAFF_ROLES.includes(r)))
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      roles: u.roles.split(',').filter(Boolean),
      department: u.department,
      status: u.status,
      createdAt: u.createdAt,
    }))

  return ok({ staff, departments: STAFF_DEPARTMENTS })
})

// Unambiguous alphabet (no I, O, 0, 1, l) for shareable passwords — same
// generation as /api/orgs/staff so every one-time password feels consistent.
const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function generatePassword(len = 12): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length]
  return out
}

/**
 * POST /api/admin/staff — invite a company staff member. ADMIN/FOUNDER only.
 *
 * The generated 12-character password is returned ONCE in this response and is
 * only ever persisted as a bcrypt hash (cost 10) — never in plaintext.
 *
 * HONEST DELIVERY NOTE: the new staff member gets an in-app notification only.
 * Production SMTP email delivery of the one-time password is a documented
 * remaining integration (the notify() helper records EMAIL as FAILED while no
 * SMTP_URL is configured). The password MUST be shared out-of-band by the
 * inviting administrator.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireRole('ADMIN', 'FOUNDER')
  // DEMO SANDBOX: inviting real staff accounts is never allowed from a demo session.
  await demoStaffMutationGuard(user, { platformWide: true })

  const rl = rateLimit(`staff-invite:${user.id}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', `Too many staff invites. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
  }

  const body = await parseBody(req, postSchema)

  if (!(ASSIGNABLE_STAFF_ROLES as readonly string[]).includes(body.role)) {
    throw new ApiError(
      400,
      'ROLE_NOT_ALLOWED',
      'Only SUPPORT, REVIEWER, MODERATOR and FINANCE roles can be granted here. ADMIN/FOUNDER promotion is a Super Admin action outside this endpoint.'
    )
  }

  const existing = await db.user.findUnique({ where: { email: body.email } })
  if (existing) {
    return fail(409, 'EMAIL_EXISTS', `${body.email} already has a CARMAZE account.`)
  }

  const oneTimePassword = generatePassword(12)

  const created = await db.user.create({
    data: {
      email: body.email,
      name: body.name,
      passwordHash: await hashPassword(oneTimePassword), // bcrypt cost 10 — plaintext never stored
      roles: `CUSTOMER,${body.role}`,
      status: 'ACTIVE',
      department: body.department,
      phone: body.phone || null,
    },
  })

  await notify({
    userId: created.id,
    type: 'STAFF_ACCOUNT_CREATED',
    title: 'Your CARMAZE company staff account was created',
    body: 'Your company staff account was created — sign in with the one-time password provided by your administrator.',
    link: '/account',
  })

  // NEVER include the password (or its hash) in the audit trail.
  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'STAFF_CREATED',
    targetType: 'USER',
    targetId: created.id,
    metadata: { email: created.email, role: body.role, department: body.department },
  })

  return ok(
    {
      user: { id: created.id, name: created.name, email: created.email, role: body.role, department: body.department },
      oneTimePassword,
      note: 'Share this password securely — it will not be shown again.',
    },
    { status: 201 }
  )
})

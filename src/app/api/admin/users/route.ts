import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, ApiError, parseBody, requireRole } from '@/lib/api'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'

/**
 * GET /api/admin/users?q= — staff user directory with org memberships.
 * Search is case-insensitive across name/email (filtered in JS because the
 * SQLite connector does not support case-insensitive `contains`).
 */
export const GET = route(async (req: NextRequest) => {
  await requireRole('SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER')
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim().toLowerCase()

  const rows = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500, // generous scan window; pilot-scale dataset
    include: { orgMemberships: { include: { org: { select: { name: true, type: true } } } } },
  })
  const filtered = q
    ? rows.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    : rows
  const users = filtered.slice(0, 50).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles.split(',').filter(Boolean),
    phone: u.phone,
    status: u.status,
    createdAt: u.createdAt,
    memberships: u.orgMemberships.map((m) => ({ orgName: m.org.name, orgType: m.org.type, role: m.role })),
  }))
  return ok({ users, total: filtered.length, truncated: filtered.length > 50 })
})

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  note: z.string().trim().max(500).optional(),
})

/**
 * PATCH /api/admin/users — suspend / reactivate accounts (ADMIN/FOUNDER only).
 * Guards: you cannot suspend yourself, and nobody can suspend a FOUNDER.
 *
 * JWT honesty: sessions are stateless, so suspension does not instantly kill
 * issued tokens — getSessionUser() rejects SUSPENDED users on every request,
 * which effectively locks API access immediately, but the cookie itself
 * remains valid until expiry. Sessions remain valid until expiry; tokens
 * rotate in production.
 */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireRole('ADMIN', 'FOUNDER')
  const body = await parseBody(req, patchSchema)

  const target = await db.user.findUnique({ where: { id: body.id } })
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'User not found.')
  if (target.id === user.id) throw new ApiError(409, 'SELF_ACTION', 'You cannot change your own access status.')
  if (target.roles.split(',').includes('FOUNDER')) {
    throw new ApiError(403, 'FOUNDER_PROTECTED', 'Founder accounts cannot be suspended or reactivated here.')
  }

  const updated = await db.user.update({
    where: { id: target.id },
    data: { status: body.status },
  })

  await notify({
    userId: target.id,
    type: body.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_RESTORED',
    title: body.status === 'SUSPENDED' ? 'Your account has been suspended' : 'Your account has been restored',
    body: body.status === 'SUSPENDED'
      ? (body.note || 'Access was suspended by the CARMAZE team. Contact support for details.')
      : 'Your account is active again. Welcome back.',
    link: '/account',
  })
  await audit({
    actorId: user.id,
    actorName: user.name,
    action: body.status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
    targetType: 'USER',
    targetId: target.id,
    metadata: { email: target.email, note: body.note ?? null },
  })

  return ok({
    user: { id: updated.id, email: updated.email, status: updated.status },
    message: body.status === 'SUSPENDED'
      ? 'Account suspended. Sessions remain valid until expiry; tokens rotate in production.'
      : 'Account reactivated.',
  })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, ApiError, parseBody, requireRole } from '@/lib/api'
import { STAFF_ROLES } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'

/**
 * PATCH /api/admin/staff/[id] — manage a company staff member. ADMIN/FOUNDER only.
 *
 * Actions (audited as STAFF_<ACTION> with the target user id):
 *  - set_department → reassign the staff department
 *  - set_role       → swap the operational staff role (SUPPORT/REVIEWER/
 *                     MODERATOR/FINANCE). ADMIN/FOUNDER holders are out of
 *                     scope — only the Super Admin can change admin roles.
 *  - suspend        → status SUSPENDED. Session honesty: JWTs are stateless,
 *                     but getSessionUser() rejects non-ACTIVE users on EVERY
 *                     request — so suspension kills API access immediately
 *                     despite the cookie remaining technically valid.
 *  - reactivate     → status ACTIVE again
 *  - remove_staff   → strip ALL staff roles from the roles string (leaving
 *                     CUSTOMER and any non-staff roles) and clear department
 *
 * Guards: the target must hold a staff role; FOUNDER accounts can never be
 * acted on (FOUNDER_PROTECTED); you cannot suspend or remove your own access
 * (CANNOT_MODIFY_SELF).
 */

type Ctx = { params: Promise<{ id: string }> }

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

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_department'), department: z.enum(STAFF_DEPARTMENTS) }),
  z.object({ action: z.literal('set_role'), role: z.enum(ASSIGNABLE_STAFF_ROLES) }),
  z.object({ action: z.literal('suspend'), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('reactivate') }),
  z.object({ action: z.literal('remove_staff') }),
])

export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireRole('ADMIN', 'FOUNDER')
  const { id } = await ctx.params
  const body = await parseBody(req, patchSchema)

  const target = await db.user.findUnique({ where: { id } })
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'Staff member not found.')

  const targetRoles = target.roles.split(',').filter(Boolean)
  if (!targetRoles.some((r) => STAFF_ROLES.includes(r))) {
    throw new ApiError(409, 'NOT_STAFF', 'This account does not hold a company staff role.')
  }
  if (targetRoles.includes('FOUNDER')) {
    throw new ApiError(403, 'FOUNDER_PROTECTED', 'Founder accounts cannot be modified here.')
  }
  if ((body.action === 'suspend' || body.action === 'remove_staff') && target.id === user.id) {
    throw new ApiError(400, 'CANNOT_MODIFY_SELF', 'You cannot remove or suspend your own staff access.')
  }

  let updated = target
  let message = 'Staff member updated.'

  switch (body.action) {
    case 'set_department': {
      updated = await db.user.update({ where: { id }, data: { department: body.department } })
      message = 'Department updated.'
      await audit({
        actorId: user.id,
        actorName: user.name,
        action: 'STAFF_DEPARTMENT_SET',
        targetType: 'USER',
        targetId: id,
        metadata: { email: target.email, department: body.department },
      })
      break
    }

    case 'set_role': {
      // Admin accounts are outside the assignable set — demoting/promoting an
      // ADMIN through this endpoint would bypass the Super Admin flow.
      if (targetRoles.includes('ADMIN')) {
        throw new ApiError(
          400,
          'ROLE_NOT_ALLOWED',
          'Admin accounts cannot be reassigned here. ADMIN/FOUNDER role changes are a Super Admin action outside this endpoint.'
        )
      }
      const previous = ASSIGNABLE_STAFF_ROLES.find((r) => targetRoles.includes(r)) ?? null
      // Keep every non-assignable role (CUSTOMER, org roles, …) in place and
      // swap exactly one operational staff role.
      const roles = [...targetRoles.filter((r) => !(ASSIGNABLE_STAFF_ROLES as readonly string[]).includes(r)), body.role].join(',')
      updated = await db.user.update({ where: { id }, data: { roles } })
      message = 'Role updated.'
      await audit({
        actorId: user.id,
        actorName: user.name,
        action: 'STAFF_ROLE_SET',
        targetType: 'USER',
        targetId: id,
        metadata: { email: target.email, from: previous, to: body.role },
      })
      break
    }

    case 'suspend': {
      updated = await db.user.update({ where: { id }, data: { status: 'SUSPENDED' } })
      message =
        'Staff access suspended. The session check rejects suspended accounts on every request, so access ends immediately despite the stateless JWT.'
      await notify({
        userId: target.id,
        type: 'ACCOUNT_SUSPENDED',
        title: 'Your staff access has been suspended',
        body: body.note || 'Access was suspended by the CARMAZE team. Contact your administrator for details.',
        link: '/account',
      })
      await audit({
        actorId: user.id,
        actorName: user.name,
        action: 'STAFF_SUSPENDED',
        targetType: 'USER',
        targetId: id,
        metadata: { email: target.email, note: body.note ?? null },
      })
      break
    }

    case 'reactivate': {
      updated = await db.user.update({ where: { id }, data: { status: 'ACTIVE' } })
      message = 'Staff account reactivated.'
      await notify({
        userId: target.id,
        type: 'ACCOUNT_RESTORED',
        title: 'Your staff access has been restored',
        body: 'Your account is active again. Welcome back.',
        link: '/account',
      })
      await audit({
        actorId: user.id,
        actorName: user.name,
        action: 'STAFF_REACTIVATED',
        targetType: 'USER',
        targetId: id,
        metadata: { email: target.email },
      })
      break
    }

    case 'remove_staff': {
      const removedRoles = targetRoles.filter((r) => STAFF_ROLES.includes(r))
      const roles = targetRoles.filter((r) => !STAFF_ROLES.includes(r)).join(',') || 'CUSTOMER'
      updated = await db.user.update({ where: { id }, data: { roles, department: null } })
      message = 'Staff access removed — the account continues as a regular customer account.'
      await notify({
        userId: target.id,
        type: 'STAFF_ACCESS_REMOVED',
        title: 'Your company staff access was removed',
        body: 'Your CARMAZE staff access was removed by an administrator. You can still use CARMAZE as a regular account.',
        link: '/account',
      })
      await audit({
        actorId: user.id,
        actorName: user.name,
        action: 'STAFF_ACCESS_REMOVED',
        targetType: 'USER',
        targetId: id,
        metadata: { email: target.email, removedRoles },
      })
      break
    }
  }

  return ok({
    staff: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      roles: updated.roles.split(',').filter(Boolean),
      department: updated.department,
      status: updated.status,
      createdAt: updated.createdAt,
    },
    message,
  })
})

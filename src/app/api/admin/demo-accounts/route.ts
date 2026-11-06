import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireRole } from '@/lib/api'
import { audit } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'

/**
 * GET /api/admin/demo-accounts — demo account registry + recent demo sign-ins.
 * ADMIN/FOUNDER only. Demo users are blocked from managing the demo system.
 */
export const GET = route(async () => {
  const user = await requireRole('ADMIN', 'FOUNDER')
  if (user.isDemo) {
    // Demo admins may look, but never manage the demo system itself.
    const accounts = await db.demoAccount.findMany({
      select: { roleKey: true, label: true, description: true, enabled: true, sessionMinutes: true, dashboard: true, restrictedNote: true },
      orderBy: { createdAt: 'asc' },
    })
    return ok({ accounts, sessions: [], canManage: false })
  }

  const accounts = await db.demoAccount.findMany({ orderBy: { createdAt: 'asc' } })
  const logins = await db.auditLog.findMany({
    where: { action: 'DEMO_LOGIN' },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, createdAt: true, targetId: true, metadata: true },
  })
  return ok({
    accounts,
    sessions: logins.map((l) => {
      let meta: Record<string, unknown> = {}
      try { meta = l.metadata ? JSON.parse(l.metadata) : {} } catch { /* ignore */ }
      return { id: l.id, createdAt: l.createdAt, roleKey: (meta as { roleKey?: string }).roleKey ?? null }
    }),
    canManage: true,
  })
})

const patchSchema = z.object({
  roleKey: z.string().min(1),
  enabled: z.boolean().optional(),
  sessionMinutes: z.number().int().min(15).max(24 * 60).optional(),
})

/** PATCH /api/admin/demo-accounts — enable/disable a demo role, adjust session length. */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireRole('ADMIN', 'FOUNDER')
  if (user.isDemo) return fail(403, 'DEMO_SANDBOXED', 'Demo mode: managing the demo system is disabled for demo accounts.')

  const body = await parseBody(req, patchSchema)
  const account = await db.demoAccount.findUnique({ where: { roleKey: body.roleKey } })
  if (!account) throw new ApiError(404, 'NOT_FOUND', 'Demo account not found.')

  const updated = await db.demoAccount.update({
    where: { roleKey: body.roleKey },
    data: {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.sessionMinutes !== undefined ? { sessionMinutes: body.sessionMinutes } : {}),
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'DEMO_ACCOUNT_UPDATED', targetType: 'DEMO_ACCOUNT', targetId: updated.id, metadata: { roleKey: updated.roleKey, enabled: updated.enabled, sessionMinutes: updated.sessionMinutes } })
  return ok({ account: updated })
})

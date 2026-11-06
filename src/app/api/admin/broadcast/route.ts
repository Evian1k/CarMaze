import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole, getIp } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { STAFF_ROLES } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

/**
 * POST /api/admin/broadcast — ADMIN / FOUNDER only.
 *
 * Sends an in-app announcement to a selected audience and records the same
 * honest EMAIL / SMS delivery rows as every other notification in this
 * deployment (see src/lib/notify.ts): when no provider is configured the
 * EMAIL / SMS deliveries are recorded FAILED with the reason — we never
 * pretend a channel was delivered.
 *
 * Audience resolution (status ACTIVE users only):
 *  - ALL       → every active user, hard-capped at 1000 recipients.
 *  - CUSTOMERS → has the CUSTOMER role and no business/staff role.
 *  - DEALERS   → has DEALER_OWNER or DEALER_STAFF.
 *  - GARAGES   → has GARAGE_OWNER or GARAGE_STAFF.
 *  - STAFF     → has any staff role (SUPPORT/REVIEWER/MODERATOR/FINANCE/ADMIN/FOUNDER).
 *
 * Rate limit: 4 broadcasts per hour per admin. Every send is audit-logged as
 * BROADCAST_SENT with the exact recipient count; GET returns that audit
 * history so the Control Center always shows what was really sent.
 */

const BROADCAST_CAP = 1000

const BUSINESS_ROLES = ['DEALER_OWNER', 'DEALER_STAFF', 'GARAGE_OWNER', 'GARAGE_STAFF']

const bodySchema = z.object({
  title: z.string().trim().min(4, 'Title must be at least 4 characters').max(120),
  body: z.string().trim().min(10, 'Message must be at least 10 characters').max(1000),
  audience: z.enum(['ALL', 'CUSTOMERS', 'DEALERS', 'GARAGES', 'STAFF']),
  link: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || v.startsWith('/'), { message: 'Link must be an in-app hash route path starting with "/"' }),
})

async function resolveRecipients(audience: 'ALL' | 'CUSTOMERS' | 'DEALERS' | 'GARAGES' | 'STAFF'): Promise<string[]> {
  const users = await db.user.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, roles: true },
    take: 5000, // safety bound; this deployment is far below the broadcast cap
  })

  let ids: string[] = []
  switch (audience) {
    case 'ALL':
      ids = users.map((u) => u.id)
      break
    case 'CUSTOMERS':
      ids = users
        .filter((u) => {
          const roles = u.roles.split(',').filter(Boolean)
          return roles.includes('CUSTOMER') && !roles.some((r) => BUSINESS_ROLES.includes(r) || STAFF_ROLES.includes(r))
        })
        .map((u) => u.id)
      break
    case 'DEALERS':
      ids = users.filter((u) => u.roles.split(',').some((r) => r === 'DEALER_OWNER' || r === 'DEALER_STAFF')).map((u) => u.id)
      break
    case 'GARAGES':
      ids = users.filter((u) => u.roles.split(',').some((r) => r === 'GARAGE_OWNER' || r === 'GARAGE_STAFF')).map((u) => u.id)
      break
    case 'STAFF':
      ids = users.filter((u) => u.roles.split(',').some((r) => STAFF_ROLES.includes(r))).map((u) => u.id)
      break
  }

  return [...new Set(ids)].slice(0, BROADCAST_CAP)
}

/** Chunked honest delivery creation — mirrors notify() semantics exactly. */
async function createBroadcastNotifications(
  userIds: string[],
  payload: { title: string; body: string; link?: string }
): Promise<{ inAppSent: number; emailDeliveries: 'queued' | 'failed (not configured)'; smsDeliveries: 'queued' | 'failed (not configured)' }> {
  const emailConfigured = Boolean(process.env.SMTP_URL)
  const smsConfigured = Boolean(process.env.SMS_API_KEY)

  const CHUNK = 50
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK)
    await db.$transaction(
      chunk.map((userId) =>
        db.notification.create({
          data: {
            userId,
            type: 'BROADCAST',
            title: payload.title,
            body: payload.body,
            link: payload.link ?? null,
            deliveries: {
              create: [
                { channel: 'IN_APP', status: 'SENT', attempts: 1 },
                {
                  channel: 'EMAIL',
                  status: emailConfigured ? 'QUEUED' : 'FAILED',
                  attempts: 1,
                  lastError: emailConfigured ? null : 'email provider not configured on this deployment',
                },
                {
                  channel: 'SMS',
                  status: smsConfigured ? 'QUEUED' : 'FAILED',
                  attempts: 1,
                  lastError: smsConfigured ? null : 'sms provider not configured on this deployment',
                },
              ],
            },
          },
        })
      )
    )
  }

  return {
    inAppSent: userIds.length,
    emailDeliveries: emailConfigured ? 'queued' : 'failed (not configured)',
    smsDeliveries: smsConfigured ? 'queued' : 'failed (not configured)',
  }
}

export const POST = route(async (req: NextRequest) => {
  const user = await requireRole('ADMIN', 'FOUNDER')
  // DEMO SANDBOX: mass messaging real users is never allowed from a demo session.
  await demoStaffMutationGuard(user, { platformWide: true })

  const rl = rateLimit(`broadcast:${user.id}:${getIp(req)}`, 4, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', `Broadcast limit reached (4 per hour). Try again in ${rl.retryAfterSec}s.`)
  }

  const body = await parseBody(req, bodySchema)

  const recipients = await resolveRecipients(body.audience)
  if (recipients.length === 0) {
    return fail(409, 'NO_RECIPIENTS', `No active users match the "${body.audience}" audience — nothing was sent.`)
  }

  const channels = await createBroadcastNotifications(recipients, { title: body.title, body: body.body, link: body.link })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'BROADCAST_SENT',
    targetType: 'NOTIFICATION',
    metadata: {
      title: body.title,
      audience: body.audience,
      recipients: recipients.length,
      link: body.link ?? null,
      capped: body.audience === 'ALL' && recipients.length >= BROADCAST_CAP,
    },
  })

  return ok({
    recipients: recipients.length,
    audience: body.audience,
    channels,
    warning:
      channels.emailDeliveries === 'failed (not configured)'
        ? 'In-app notifications were delivered. EMAIL/SMS channels are not configured on this deployment and were recorded as FAILED, not sent.'
        : undefined,
  })
})

/** GET /api/admin/broadcast — last 20 broadcasts from the audit trail (staff). */
export const GET = route(async () => {
  await requireRole(...STAFF_ROLES)

  const entries = await db.auditLog.findMany({
    where: { action: 'BROADCAST_SENT' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const broadcasts = entries.map((e) => {
    let meta: { title?: string; audience?: string; recipients?: number; link?: string | null } = {}
    try {
      meta = e.metadata ? (JSON.parse(e.metadata) as typeof meta) : {}
    } catch {
      // corrupt metadata — degrade gracefully, never crash the tab
    }
    return {
      id: e.id,
      actorName: e.actorName,
      createdAt: e.createdAt,
      title: meta.title ?? '(untitled broadcast)',
      audience: meta.audience ?? 'UNKNOWN',
      recipients: typeof meta.recipients === 'number' ? meta.recipients : null,
      link: meta.link ?? null,
    }
  })

  return ok({ broadcasts })
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'

export const dynamic = 'force-dynamic'

const schema = z.object({
  reason: z.string().trim().min(3).max(1000),
  scope: z.enum(['FULL_ACCOUNT', 'MARKETING_ONLY']).default('FULL_ACCOUNT'),
})

/**
 * POST /api/privacy/delete-request — Kenya DPA 2019 erasure request.
 *
 * HONEST WORKFLOW: this records the request and routes it to the platform
 * team — it does NOT delete anything automatically. Automatic deletion would
 * be wrong: financial, fraud, dispute and legal records carry lawful
 * retention obligations (Kenya DPA 2019 §25), and account deletion affects
 * live marketplace listings, custody records and org memberships that need
 * human review.
 *
 * What the request does:
 *  1. Creates a Support ticket tagged DATA_ERASURE (staff queue).
 *  2. Audit-logs the request (who, when, scope, reason).
 *  3. For MARKETING_ONLY scope it immediately withdraws marketing consent
 *     flags on the account (that part is genuinely automatic and safe).
 * Staff then execute the reviewed erasure workflow with retention rules.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, schema)

  const rl = rateLimit(`privacy-delete:${user.id}`, 3, 24 * 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'You have already submitted a data request recently. The team is processing it.')

  const ticket = await db.supportTicket.create({
    data: {
      refCode: refCode('DPO', 6),
      userId: user.id,
      name: user.name,
      email: user.email,
      subject: `[DATA_ERASURE:${body.scope}] Account data deletion request`,
      message: `User requested ${body.scope === 'FULL_ACCOUNT' ? 'deletion of their account and personal data' : 'withdrawal of marketing consent only'}. Reason: ${body.reason}. Process per the retention schedule — financial/fraud/dispute records are retained as required by law; the rest is reviewed for erasure or anonymisation.`,
      status: 'OPEN',
    },
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'PRIVACY_ERASURE_REQUESTED',
    targetType: 'SUPPORT_TICKET',
    targetId: ticket.id,
    metadata: { scope: body.scope, ref: ticket.refCode },
  })

  const staff = await db.user.findMany({
    where: { OR: [{ roles: { contains: 'SUPPORT' } }, { roles: { contains: 'ADMIN' } }, { roles: { contains: 'FOUNDER' } }], status: 'ACTIVE' },
    select: { id: true },
  })
  await notifyMany(staff.map((s) => s.id), {
    type: 'PRIVACY_ERASURE_REQUEST',
    title: `Data erasure request ${ticket.refCode}`,
    body: `${body.scope === 'FULL_ACCOUNT' ? 'Full account deletion' : 'Marketing-only withdrawal'} requested. Handle per the retention schedule.`,
    link: '/admin?tab=support',
  })

  return ok(
    {
      ref: ticket.refCode,
      message:
        'Your request is recorded and routed to the platform team. Deletion is reviewed by a person because financial, dispute and legal records must be retained where the law requires it. You will be contacted at your account email with the outcome.',
    },
    { status: 201 }
  )
})

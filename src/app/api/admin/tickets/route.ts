import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, ApiError, parseBody, requireRole } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { audit } from '@/lib/audit'

/** GET /api/admin/tickets?status=: support queue (any staff). */
export const GET = route(async (req: NextRequest) => {
  await requireRole('SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER')
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'ALL'
  const tickets = await db.supportTicket.findMany({
    where: status === 'ALL' ? {} : { status },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return ok({ tickets })
})

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['IN_PROGRESS', 'RESOLVED']),
  response: z.string().trim().max(3000).optional(),
})

/** PATCH /api/admin/tickets: progress / resolve with an optional response. */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireRole('SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER')
  const body = await parseBody(req, patchSchema)

  const ticket = await db.supportTicket.findUnique({ where: { id: body.id } })
  if (!ticket) throw new ApiError(404, 'NOT_FOUND', 'Ticket not found.')
  // DEMO SANDBOX: demo support may only progress demo-ecosystem tickets.
  await demoStaffMutationGuard(user, { subjectUserId: ticket.userId })
  if (ticket.status === 'RESOLVED') {
    return ok({ ticket, message: 'Ticket was already resolved.' })
  }

  const updated = await db.supportTicket.update({
    where: { id: ticket.id },
    data: { status: body.status, response: body.response ?? ticket.response },
  })

  // If the submitter is a registered user, tell them honestly in-app.
  if (ticket.userId) {
    const { notify } = await import('@/lib/notify')
    await notify({
      userId: ticket.userId,
      type: 'SUPPORT_TICKET_UPDATED',
      title: `Support ticket ${ticket.refCode} ${body.status === 'RESOLVED' ? 'resolved' : 'updated'}`,
      body: body.response || 'Our support team updated your ticket.',
      link: '/account',
    })
  }

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: body.status === 'RESOLVED' ? 'TICKET_RESOLVED' : 'TICKET_IN_PROGRESS',
    targetType: 'SUPPORT_TICKET',
    targetId: ticket.id,
    metadata: { ref: ticket.refCode, responded: Boolean(body.response) },
  })

  return ok({ ticket: updated })
})

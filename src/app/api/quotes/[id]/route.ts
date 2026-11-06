import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, ApiError, requireUser, parseBody } from '@/lib/api'
import { notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  action: z.enum(['accept', 'decline']),
})

export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const body = await parseBody(req, patchSchema)

  const quote = await db.quote.findUnique({
    where: { id },
    include: {
      request: { select: { id: true, refCode: true, customerId: true, category: true, status: true } },
      org: { select: { id: true, name: true } },
    },
  })
  if (!quote) throw new ApiError(404, 'NOT_FOUND', 'Quote not found.')

  // Only the customer who owns the service request can accept or decline.
  if (quote.request.customerId !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the customer who made this request can respond to quotes.')
  }
  if (quote.status !== 'PENDING') {
    throw new ApiError(409, 'INVALID_STATE', `This quote is already ${quote.status.toLowerCase()}.`)
  }
  if (!['OPEN', 'QUOTING'].includes(quote.request.status)) {
    throw new ApiError(409, 'INVALID_STATE', `This request is ${quote.request.status.toLowerCase()}: quotes can no longer be changed.`)
  }

  if (body.action === 'accept') {
    const booking = await db.booking.create({
      data: {
        requestId: quote.request.id,
        orgId: quote.org.id,
        status: 'CONFIRMED',
        scheduledAt: null,
      },
    })

    await db.quote.update({ where: { id: quote.id }, data: { status: 'ACCEPTED' } })

    // Expire all other pending quotes on this request.
    await db.quote.updateMany({
      where: { requestId: quote.request.id, status: 'PENDING', id: { not: quote.id } },
      data: { status: 'EXPIRED' },
    })

    await db.serviceRequest.update({ where: { id: quote.request.id }, data: { status: 'BOOKED' } })

    const members = await db.orgMember.findMany({ where: { orgId: quote.org.id }, select: { userId: true } })
    await notifyMany(members.map((m) => m.userId), {
      type: 'QUOTE_ACCEPTED',
      title: `Quote accepted: ${quote.request.refCode}`,
      body: `${user.name} accepted your quote. The booking is confirmed: schedule it under Bookings.`,
      link: '/garage-dashboard?tab=bookings',
    })

    await audit({
      actorId: user.id, actorName: user.name,
      action: 'QUOTE_ACCEPTED', targetType: 'QUOTE', targetId: quote.id,
      metadata: { requestRef: quote.request.refCode, orgId: quote.org.id, bookingId: booking.id },
    })

    return ok({ quote: { id: quote.id, status: 'ACCEPTED' }, booking: { id: booking.id, status: booking.status } })
  }

  // action === 'decline'
  await db.quote.update({ where: { id: quote.id }, data: { status: 'DECLINED' } })

  const pendingLeft = await db.quote.count({ where: { requestId: quote.request.id, status: 'PENDING' } })
  if (pendingLeft === 0 && quote.request.status === 'QUOTING') {
    await db.serviceRequest.update({ where: { id: quote.request.id }, data: { status: 'OPEN' } })
  }

  await audit({
    actorId: user.id, actorName: user.name,
    action: 'QUOTE_DECLINED', targetType: 'QUOTE', targetId: quote.id,
    metadata: { requestRef: quote.request.refCode, orgId: quote.org.id },
  })

  return ok({ quote: { id: quote.id, status: 'DECLINED' } })
})
